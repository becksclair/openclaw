package ai.openclaw.wear.client

import ai.openclaw.common.wear.WearRelayAudioDonePayload
import ai.openclaw.common.wear.WearRelayErrorPayload
import ai.openclaw.common.wear.WearRelayProtocol
import ai.openclaw.common.wear.WearRelayStartPayload
import ai.openclaw.common.wear.WearRelayStatusPayload
import ai.openclaw.common.wear.WearRelayTextPayload
import android.content.Context
import android.util.Log
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.NodeClient
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

internal data class PhoneRelayAudioResponse(
  val turnId: String,
  val audioBytes: ByteArray,
  val format: String = WearRelayProtocol.RESPONSE_FORMAT_PCM_24K,
)

internal interface WearPhoneRelay {
  val phoneConnected: StateFlow<Boolean>
  val statusUpdates: SharedFlow<String>
  val audioResponses: SharedFlow<PhoneRelayAudioResponse>
  val errors: SharedFlow<String>

  fun isPhoneConnected(): Boolean

  fun sendStartRecording(reasoningLevel: String): String?

  fun sendTextTurn(
    text: String,
    reasoningLevel: String,
  ): String?

  fun sendEndRecording(turnId: String?)

  fun sendCancel()

  fun sendAudioChunk(
    turnId: String?,
    chunk: ByteArray,
  )

  fun disconnect()
}

internal class PhoneRelayClient(
  private val context: Context,
  private val scope: CoroutineScope,
) : WearPhoneRelay {
  companion object {
    private const val TAG = "OpenClawWearRelay"
    private const val CAPABILITY_PHONE_APP = "openclaw_relay_phone"
    private const val AUDIO_RESPONSE_PATH = WearRelayProtocol.PATH_AUDIO_RESPONSE

    private const val MAX_OUTBOUND_MESSAGES = 64

    // Per-send Data Layer timeout. One hung node send fails fast and the drain
    // loop continues instead of stalling the whole turn.
    private const val SEND_TIMEOUT_MS = 4_000L
  }

  private val messageClient: MessageClient = Wearable.getMessageClient(context)
  private val nodeClient: NodeClient = Wearable.getNodeClient(context)
  private val json = Json { ignoreUnknownKeys = true }
  private val audioDebugCapture = WireAudioDebugCapture(context)

  private val _phoneConnected = MutableStateFlow(false)
  override val phoneConnected: StateFlow<Boolean> = _phoneConnected

  private val _statusUpdates = MutableSharedFlow<String>(extraBufferCapacity = 16)
  override val statusUpdates: SharedFlow<String> = _statusUpdates

  private val _audioResponses = MutableSharedFlow<PhoneRelayAudioResponse>(extraBufferCapacity = 4)
  override val audioResponses: SharedFlow<PhoneRelayAudioResponse> = _audioResponses

  private val _errors = MutableSharedFlow<String>(extraBufferCapacity = 4)
  override val errors: SharedFlow<String> = _errors

  private var messageListener: MessageClient.OnMessageReceivedListener? = null
  private val outboundMessages = Channel<OutboundMessage>(MAX_OUTBOUND_MESSAGES)
  private var connectionMonitorJob: Job? = null

  @Volatile private var relayPhoneNodeIds: Set<String> = emptySet()

  private val activeTurn = AtomicReference<ActiveTurn?>(null)

  // Monotonic per-turn watch->phone audio chunk index, reset at turn start. The
  // phone uses the sequence to detect a dropped chunk instead of transcribing a
  // silently shortened buffer.
  private val outboundChunkIndex = AtomicInteger(0)

  private val activeTurnId: String?
    get() = activeTurn.get()?.turnId

  private val activeRelayPhoneNodeId: String?
    get() = activeTurn.get()?.phoneNodeId

  private val bufferedAudioReceiver =
    BufferedAudioResponseReceiver(
      scope = scope,
      activeTurnId = { activeTurnId },
      completeActiveTurn = ::completeActiveTurn,
      emitAudioResponse = ::emitAudioResponse,
      emitError = { _errors.emit(it) },
    )

  init {
    processOutboundMessages()
    if (isWearableApiAvailable()) {
      setupMessageListener()
      startConnectionMonitor()
    } else {
      scope.launch {
        _errors.emit("Wear OS services unavailable")
      }
    }
  }

  override fun isPhoneConnected(): Boolean = _phoneConnected.value

  override fun sendStartRecording(reasoningLevel: String): String? {
    val payload =
      json
        .encodeToString(
          WearRelayStartPayload(
            acceptedResponseFormats = WearRelayProtocol.ACCEPTED_RESPONSE_FORMATS,
            reasoningLevel = reasoningLevel,
          ),
        ).toByteArray()
    return beginTurn(WearRelayProtocol.PATH_START, payload)
  }

  override fun sendTextTurn(
    text: String,
    reasoningLevel: String,
  ): String? {
    val trimmed = text.trim()
    if (trimmed.isEmpty()) return null
    val payload =
      json
        .encodeToString(
          WearRelayTextPayload(
            text = trimmed,
            acceptedResponseFormats = WearRelayProtocol.ACCEPTED_RESPONSE_FORMATS,
            reasoningLevel = reasoningLevel,
          ),
        ).toByteArray()
    return beginTurn(WearRelayProtocol.PATH_TEXT, payload)
  }

  private fun beginTurn(
    path: String,
    payload: ByteArray,
  ): String? {
    // A new turn must not inherit partial chunks from a prior response
    resetAudioAccumulator()
    val phoneNodeId = selectRelayPhoneNodeId()
    if (phoneNodeId == null) {
      _phoneConnected.value = false
      scope.launch {
        _errors.emit("Phone not connected")
      }
      return null
    }
    val turnId = UUID.randomUUID().toString()
    outboundChunkIndex.set(0)
    activeTurn.set(ActiveTurn(turnId = turnId, phoneNodeId = phoneNodeId))
    sendMessage(
      path = WearRelayProtocol.turnPath(path, turnId),
      data = payload,
      targetNodeId = phoneNodeId,
      requiredActiveTurnId = turnId,
    )
    return turnId
  }

  override fun sendEndRecording(turnId: String?) {
    if (turnId == null || activeTurnId != turnId) return
    sendMessage(
      path = WearRelayProtocol.turnPath(WearRelayProtocol.PATH_END, turnId),
      data = byteArrayOf(),
      requiredActiveTurnId = turnId,
    )
  }

  override fun sendCancel() {
    val turnId = activeTurnId
    val phoneNodeId = activeRelayPhoneNodeId
    resetAudioAccumulator()
    drainOutboundMessages()
    activeTurn.set(null)
    if (turnId == null) return
    // Cancel is scoped to a turn. If no turn is active there is nothing to
    // cancel on the phone side; stale state is reset above by draining messages.
    sendMessage(WearRelayProtocol.turnPath(WearRelayProtocol.PATH_CANCEL, turnId), byteArrayOf(), phoneNodeId)
  }

  private fun resetAudioAccumulator() {
    bufferedAudioReceiver.reset()
  }

  override fun sendAudioChunk(
    turnId: String?,
    chunk: ByteArray,
  ) {
    if (turnId == null || activeTurnId != turnId) return
    if (chunk.size > WearRelayProtocol.MAX_MESSAGE_BYTES) return
    val chunkIndex = outboundChunkIndex.getAndIncrement()
    sendMessage(
      path = WearRelayProtocol.audioChunkPath(turnId, chunkIndex),
      data = chunk,
      requiredActiveTurnId = turnId,
    )
  }

  override fun disconnect() {
    connectionMonitorJob?.cancel()
    connectionMonitorJob = null
    messageListener?.let { messageClient.removeListener(it) }
    messageListener = null
    resetAudioAccumulator()
    drainOutboundMessages()
    // Q3: close the outbound channel so processOutboundMessages exits cleanly
    // instead of leaking a coroutine waiting on a never-resumed receive.
    outboundMessages.close()
  }

  private fun isWearableApiAvailable(): Boolean {
    val apiAvailability = GoogleApiAvailability.getInstance()
    val result = apiAvailability.isGooglePlayServicesAvailable(context)
    return result == ConnectionResult.SUCCESS
  }

  private fun setupMessageListener() {
    val listener =
      MessageClient.OnMessageReceivedListener { event ->
        when {
          event.path == WearRelayProtocol.PATH_STATUS -> handleStatusMessage(event)
          event.path == WearRelayProtocol.PATH_ERROR -> handleErrorMessage(event)
          // Audio responses are always turn-scoped ("<base>/<turnId>/..."); a bare
          // base path carries no turn and is ignored.
          event.path.startsWith("$AUDIO_RESPONSE_PATH/") -> handleAudioMessage(event)
        }
      }
    messageClient.addListener(listener)
    messageListener = listener
  }

  private fun handleAudioMessage(event: MessageEvent) {
    if (!isActiveRelayPhoneNode(event.sourceNodeId)) return
    // Every phone->watch audio path is turn-scoped: "<base>/<turnId>" for a
    // single-message PCM response, "<base>/<turnId>/<chunkIndex>" or
    // "<base>/<turnId>/done" for chunked streams, and "<base>/<turnId>/format/<fmt>"
    // for a formatted single message. A bare or empty turn segment is dropped.
    val parts = event.path.removePrefix("$AUDIO_RESPONSE_PATH/").split("/")
    val turnId = parts.getOrNull(0)?.takeIf { it.isNotEmpty() } ?: return
    if (!isActiveTurn(turnId)) return
    when (parts.size) {
      1 -> handleAudioResponseMessage(turnId = turnId, data = event.data)
      2 -> {
        val suffix = parts[1]
        if (suffix == "done") {
          handleAudioDone(data = event.data)
        } else {
          handleAudioChunk(chunkIndex = suffix.toIntOrNull(), data = event.data)
        }
      }
      3 -> {
        if (parts[1] == "format") {
          handleAudioResponseMessage(turnId = turnId, data = event.data, format = parts[2])
        }
      }
      else -> {}
    }
  }

  private fun handleAudioDone(data: ByteArray) {
    bufferedAudioReceiver.acceptDone(
      chunkCount = parseAudioDoneChunkCount(data),
      format = normalizeResponseFormat(parseAudioDoneFormat(data)),
    )
  }

  private fun handleAudioChunk(
    chunkIndex: Int?,
    data: ByteArray,
  ) {
    bufferedAudioReceiver.acceptChunk(chunkIndex = chunkIndex, data = data)
  }

  // Strict equality only. Every inbound response path and payload carries a
  // non-null turn id, so a null/mismatched id is cross-turn contamination and
  // must be rejected rather than treated as a wildcard match.
  private fun isActiveTurn(turnId: String): Boolean = turnId == activeTurnId

  private fun isActiveRelayPhoneNode(sourceNodeId: String?): Boolean {
    val activeNodeId = activeRelayPhoneNodeId ?: return true
    return sourceNodeId == activeNodeId
  }

  private fun parseAudioDoneChunkCount(data: ByteArray): Int? {
    val payload = data.decodeToString()
    return runCatching {
      json.decodeFromString<WearRelayAudioDonePayload>(payload).chunkCount.takeIf { it >= 0 }
    }.getOrNull()
  }

  private fun parseAudioDoneFormat(data: ByteArray): String {
    val payload = data.decodeToString()
    return runCatching {
      json.decodeFromString<WearRelayAudioDonePayload>(payload).format.takeIf { it.isNotBlank() }
    }.getOrNull() ?: WearRelayProtocol.RESPONSE_FORMAT_PCM_24K
  }

  private fun emitAudioResponse(
    turnId: String,
    audioResponse: PhoneRelayAudioResponse,
  ) {
    if (!isActiveTurn(turnId)) return
    if (audioResponse.audioBytes.isNotEmpty()) {
      Log.d(TAG, "audio response received turnId=$turnId format=${audioResponse.format} bytes=${audioResponse.audioBytes.size}")
      audioDebugCapture.captureWholeResponse(turnId = turnId, data = audioResponse.audioBytes)
      completeActiveTurn(turnId)
      scope.launch {
        _audioResponses.emit(audioResponse.copy(turnId = turnId))
      }
    }
  }

  private fun handleStatusMessage(event: MessageEvent) {
    if (!isActiveRelayPhoneNode(event.sourceNodeId)) return
    val payload = event.data.decodeToString()
    val status = runCatching { json.decodeFromString<WearRelayStatusPayload>(payload) }.getOrNull() ?: return
    if (!isActiveTurn(status.turnId)) return
    scope.launch {
      _statusUpdates.emit(status.message)
    }
  }

  private fun handleErrorMessage(event: MessageEvent) {
    if (!isActiveRelayPhoneNode(event.sourceNodeId)) return
    val payload = event.data.decodeToString()
    val error = runCatching { json.decodeFromString<WearRelayErrorPayload>(payload) }.getOrNull() ?: return
    if (!isActiveTurn(error.turnId)) return
    completeActiveTurn(error.turnId)
    scope.launch {
      _errors.emit(error.message)
    }
  }

  private fun handleAudioResponseMessage(
    turnId: String,
    data: ByteArray,
    format: String = WearRelayProtocol.RESPONSE_FORMAT_PCM_24K,
  ) {
    if (data.isEmpty()) return
    emitAudioResponse(
      turnId,
      PhoneRelayAudioResponse(turnId = turnId, audioBytes = data, format = normalizeResponseFormat(format)),
    )
  }

  private fun normalizeResponseFormat(format: String): String =
    when (format) {
      WearRelayProtocol.RESPONSE_FORMAT_OGG_OPUS -> WearRelayProtocol.RESPONSE_FORMAT_OGG_OPUS
      WearRelayProtocol.RESPONSE_FORMAT_MP3 -> WearRelayProtocol.RESPONSE_FORMAT_MP3
      else -> WearRelayProtocol.RESPONSE_FORMAT_PCM_24K
    }

  private fun completeActiveTurn(turnId: String) {
    val active = activeTurn.get() ?: return
    // Only the owning turn may complete itself; a stale id must not clear a
    // newer active turn.
    if (turnId != active.turnId) return
    activeTurn.compareAndSet(active, null)
  }

  private fun sendMessage(
    path: String,
    data: ByteArray,
    targetNodeId: String? = activeRelayPhoneNodeId,
    requiredActiveTurnId: String? = null,
  ) {
    if (isStaleOutboundMessage(requiredActiveTurnId)) return
    val message =
      OutboundMessage(
        path = path,
        data = data,
        targetNodeId = targetNodeId,
        requiredActiveTurnId = requiredActiveTurnId,
      )
    val result = outboundMessages.trySend(message)
    if (result.isSuccess) return
    if (result.isClosed) {
      Log.w(TAG, "dropping outbound message after disconnect: $path")
      return
    }
    if (path.startsWith(WearRelayProtocol.PATH_AUDIO_CHUNK)) {
      Log.w(TAG, "dropping audio chunk because outbound relay queue is full")
      return
    }
    scope.launch {
      try {
        if (isStaleOutboundMessage(message.requiredActiveTurnId)) return@launch
        outboundMessages.send(message)
      } catch (err: kotlinx.coroutines.channels.ClosedSendChannelException) {
        Log.w(TAG, "outbound channel closed while sending $path: ${err.message}")
      }
    }
  }

  private fun drainOutboundMessages() {
    while (outboundMessages.tryReceive().isSuccess) {
      // Discard stale queued messages before canceling or disconnecting a turn.
    }
  }

  private fun processOutboundMessages() {
    scope.launch(Dispatchers.IO) {
      for (message in outboundMessages) {
        if (isStaleOutboundMessage(message.requiredActiveTurnId)) continue
        try {
          val targetNodeId = message.targetNodeId
          if (targetNodeId != null) {
            // Fast path: send directly to the known relay node instead of querying
            // connectedNodes for every chunk in an audio turn.
            sendBounded(targetNodeId, message.path, message.data)
            _phoneConnected.value = true
            continue
          }
          val nodes = nodeClient.connectedNodes.await().filter { it.id in relayPhoneNodeIds }
          if (nodes.isEmpty()) {
            _phoneConnected.value = false
            continue
          }
          nodes.forEach { node ->
            sendBounded(node.id, message.path, message.data)
          }
          _phoneConnected.value = true
        } catch (err: Throwable) {
          // Rethrow real loop cancellation (scope shutdown) so the drain
          // coroutine exits; a per-send SEND_TIMEOUT_MS timeout is a Timeout
          // CancellationException and is handled here by failing fast.
          if (err is CancellationException && err !is TimeoutCancellationException) throw err
          Log.w(TAG, "sendMessage failed: ${err.message}")
          _phoneConnected.value = false
        }
      }
    }
  }

  // One stuck Data Layer send must not wedge the whole turn; bound each send so
  // the drain loop keeps moving on start/audio/end/cancel after a hung node.
  private suspend fun sendBounded(
    nodeId: String,
    path: String,
    data: ByteArray,
  ) {
    withTimeout(SEND_TIMEOUT_MS) {
      messageClient.sendMessage(nodeId, path, data).await()
    }
  }

  private fun isStaleOutboundMessage(requiredActiveTurnId: String?): Boolean = requiredActiveTurnId != null && activeTurnId != requiredActiveTurnId

  private fun startConnectionMonitor() {
    if (connectionMonitorJob != null) return
    connectionMonitorJob =
      scope.launch(Dispatchers.IO) {
        while (true) {
          val connected = refreshPhoneConnection()
          delay(if (connected) 10_000 else 1_000)
        }
      }
  }

  private suspend fun refreshPhoneConnection(): Boolean {
    val nodeIds =
      runCatching {
        reachableRelayPhoneNodeIds()
      }.onFailure { err ->
        Log.w(TAG, "refreshPhoneConnection failed: ${err.message}")
      }.getOrDefault(emptySet())
    relayPhoneNodeIds = nodeIds
    val connected = nodeIds.isNotEmpty()
    _phoneConnected.value = connected
    return connected
  }

  private fun selectRelayPhoneNodeId(): String? = relayPhoneNodeIds.sorted().firstOrNull()

  private suspend fun reachableRelayPhoneNodeIds(): Set<String> {
    val capabilityInfo =
      Wearable
        .getCapabilityClient(context)
        .getCapability(
          CAPABILITY_PHONE_APP,
          com.google.android.gms.wearable.CapabilityClient.FILTER_REACHABLE,
        ).await()
    return capabilityInfo.nodes.mapTo(mutableSetOf()) { it.id }
  }

  private data class OutboundMessage(
    val path: String,
    val data: ByteArray,
    val targetNodeId: String?,
    val requiredActiveTurnId: String?,
  )

  private data class ActiveTurn(
    val turnId: String,
    val phoneNodeId: String,
  )
}
