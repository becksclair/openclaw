package ai.openclaw.wear.client

import android.content.Context
import android.util.Log
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.NodeClient
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference

class PhoneRelayClient(
  private val context: Context,
  private val scope: CoroutineScope,
) {
  companion object {
    private const val TAG = "OpenClawWearRelay"
    private const val CAPABILITY_PHONE_APP = "openclaw_relay_phone"
    private const val PATH_START = "/openclaw/watch/start"
    private const val PATH_END = "/openclaw/watch/end"
    private const val PATH_CANCEL = "/openclaw/watch/cancel"
    private const val PATH_STATUS = "/openclaw/watch/status"
    private const val PATH_ERROR = "/openclaw/watch/error"
    private const val PATH_AUDIO_CHUNK = "/openclaw/watch/audio/chunk"

    // MessageClient enforces a ~100 KB per-message ceiling; keep a safe margin.
    private const val MAX_MESSAGE_BYTES = 90_000
    private const val AUDIO_RESPONSE_PATH = "/openclaw/watch/audio"
    private const val AUDIO_STREAM_RESPONSE_PATH = "/openclaw/watch/audio/stream"

    private const val MAX_OUTBOUND_MESSAGES = 64
    const val RESPONSE_FORMAT_PCM_24K = "pcm_24000"
    const val RESPONSE_FORMAT_OGG_OPUS = "ogg_opus"
  }

  private val messageClient: MessageClient = Wearable.getMessageClient(context)
  private val nodeClient: NodeClient = Wearable.getNodeClient(context)
  private val json = Json { ignoreUnknownKeys = true }
  private val audioDebugCapture = WireAudioDebugCapture(context)

  private val _phoneConnected = MutableStateFlow(false)
  val phoneConnected: StateFlow<Boolean> = _phoneConnected

  private val _statusUpdates = MutableSharedFlow<String>(extraBufferCapacity = 16)
  val statusUpdates: SharedFlow<String> = _statusUpdates

  private val _audioResponses = MutableSharedFlow<AudioResponse>(extraBufferCapacity = 4)
  val audioResponses: SharedFlow<AudioResponse> = _audioResponses

  // DROP_OLDEST keeps the latest audio frames flowing rather than backpressuring
  // the assembler when a slow collector falls behind. Collectors get a typed
  // "playback unavailable" failure if they actually missed events; here we
  // optimise for liveness, since stalled audio is worse than slightly chopped
  // audio for push-to-talk playback.
  private val _audioStreamEvents =
    MutableSharedFlow<AudioStreamEvent>(
      extraBufferCapacity = 64,
      onBufferOverflow = kotlinx.coroutines.channels.BufferOverflow.DROP_OLDEST,
    )
  val audioStreamEvents: SharedFlow<AudioStreamEvent> = _audioStreamEvents

  private val _errors = MutableSharedFlow<String>(extraBufferCapacity = 4)
  val errors: SharedFlow<String> = _errors

  private var messageListener: MessageClient.OnMessageReceivedListener? = null
  private val outboundMessages = Channel<OutboundMessage>(MAX_OUTBOUND_MESSAGES)
  private var connectionMonitorJob: Job? = null

  @Volatile private var relayPhoneNodeIds: Set<String> = emptySet()

  private val activeTurn = AtomicReference<ActiveTurn?>(null)

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

  private val streamingAudioReceiver =
    StreamingAudioResponseReceiver(
      scope = scope,
      activeTurnId = { activeTurnId },
      completeActiveTurn = ::completeActiveTurn,
      emitStreamEvent = ::enqueueAudioStreamEvent,
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

  fun isPhoneConnected(): Boolean = _phoneConnected.value

  fun sendStartRecording(): String? {
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
    activeTurn.set(ActiveTurn(turnId = turnId, phoneNodeId = phoneNodeId))
    // Response streaming stays disabled until streaming has format negotiation and decode coverage.
    sendMessage(
      turnPath(PATH_START, turnId),
      json
        .encodeToString(
          StartPayload(
            responseStreaming = false,
            acceptedResponseFormats = listOf(RESPONSE_FORMAT_OGG_OPUS, RESPONSE_FORMAT_PCM_24K),
          ),
        ).toByteArray(),
      phoneNodeId,
    )
    return turnId
  }

  fun sendEndRecording(turnId: String?) {
    if (turnId == null || activeTurnId != turnId) return
    sendMessage(turnPath(PATH_END, turnId), byteArrayOf())
  }

  fun sendCancel() {
    val turnId = activeTurnId
    val phoneNodeId = activeRelayPhoneNodeId
    resetAudioAccumulator()
    drainOutboundMessages()
    activeTurn.set(null)
    sendMessage(turnPath(PATH_CANCEL, turnId), byteArrayOf(), phoneNodeId)
  }

  private fun resetAudioAccumulator() {
    bufferedAudioReceiver.reset()
    streamingAudioReceiver.reset()
  }

  fun sendAudioChunk(
    turnId: String?,
    chunk: ByteArray,
  ) {
    if (turnId == null || activeTurnId != turnId) return
    if (chunk.size > MAX_MESSAGE_BYTES) return
    sendMessage(turnPath(PATH_AUDIO_CHUNK, turnId), chunk)
  }

  fun disconnect() {
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
          event.path == PATH_STATUS -> handleStatusMessage(event)
          event.path == PATH_ERROR -> handleErrorMessage(event)
          event.path == AUDIO_STREAM_RESPONSE_PATH || event.path.startsWith("$AUDIO_STREAM_RESPONSE_PATH/") ->
            handleAudioStreamMessage(event)
          // Single-message audio response (small payload)
          event.path == AUDIO_RESPONSE_PATH || event.path.startsWith("$AUDIO_RESPONSE_PATH/") -> handleAudioMessage(event)
        }
      }
    messageClient.addListener(listener)
    messageListener = listener
  }

  private fun handleAudioMessage(event: MessageEvent) {
    if (!isActiveRelayPhoneNode(event.sourceNodeId)) return
    if (event.path == AUDIO_RESPONSE_PATH) {
      handleAudioResponseMessage(turnId = null, data = event.data)
      return
    }
    val parts = event.path.removePrefix("$AUDIO_RESPONSE_PATH/").split("/")
    when (parts.size) {
      1 -> {
        val suffix = parts[0]
        if (suffix == "done") {
          handleAudioDone(turnId = null, data = event.data)
        } else if (suffix.toIntOrNull() == null) {
          handleAudioResponseMessage(turnId = suffix.takeIf { it.isNotEmpty() }, data = event.data)
        } else {
          handleAudioChunk(turnId = null, chunkIndex = suffix.toInt(), data = event.data)
        }
      }
      2 -> {
        val turnId = parts[0].takeIf { it.isNotEmpty() }
        if (!isActiveTurn(turnId)) return
        val suffix = parts[1]
        if (suffix == "done") {
          handleAudioDone(turnId = turnId, data = event.data)
        } else {
          handleAudioChunk(turnId = turnId, chunkIndex = suffix.toIntOrNull(), data = event.data)
        }
      }
      3 -> {
        val turnId = parts[0].takeIf { it.isNotEmpty() }
        if (!isActiveTurn(turnId)) return
        if (parts[1] == "format") {
          handleAudioResponseMessage(turnId = turnId, data = event.data, format = parts[2])
        }
      }
      else -> {}
    }
  }

  private fun handleAudioStreamMessage(event: MessageEvent) {
    if (!isActiveRelayPhoneNode(event.sourceNodeId)) return
    val parts = event.path.removePrefix("$AUDIO_STREAM_RESPONSE_PATH/").split("/")
    if (parts.size != 2) return
    val turnId = parts[0].takeIf { it.isNotEmpty() }
    if (!isActiveTurn(turnId)) return
    val suffix = parts[1]
    if (suffix == "done") {
      handleAudioStreamDone(turnId = turnId, data = event.data)
      return
    }
    handleAudioStreamChunk(turnId = turnId, chunkIndex = suffix.toIntOrNull(), data = event.data)
  }

  private fun handleAudioStreamChunk(
    turnId: String?,
    chunkIndex: Int?,
    data: ByteArray,
  ) {
    if (chunkIndex != null) {
      audioDebugCapture.captureStreamChunk(turnId = turnId, chunkIndex = chunkIndex, data = data)
    }
    streamingAudioReceiver.acceptChunk(chunkIndex = chunkIndex, data = data)
  }

  private fun handleAudioStreamDone(
    turnId: String?,
    data: ByteArray,
  ) {
    val chunkCount = parseAudioDoneChunkCount(data)
    if (chunkCount != null) {
      audioDebugCapture.captureStreamDone(turnId = turnId, chunkCount = chunkCount)
    }
    streamingAudioReceiver.acceptDone(chunkCount)
  }

  private fun handleAudioDone(
    turnId: String?,
    data: ByteArray,
  ) {
    bufferedAudioReceiver.acceptDone(
      turnId = turnId,
      chunkCount = parseAudioDoneChunkCount(data),
      format = normalizeResponseFormat(parseAudioDoneFormat(data)),
    )
  }

  private fun handleAudioChunk(
    turnId: String?,
    chunkIndex: Int?,
    data: ByteArray,
  ) {
    bufferedAudioReceiver.acceptChunk(chunkIndex = chunkIndex, data = data)
  }

  private fun isActiveTurn(turnId: String?): Boolean {
    val active = activeTurnId ?: return false
    return turnId == null || turnId == active
  }

  private fun isActiveRelayPhoneNode(sourceNodeId: String?): Boolean {
    val activeNodeId = activeRelayPhoneNodeId ?: return true
    return sourceNodeId == activeNodeId
  }

  private fun turnPath(
    basePath: String,
    turnId: String?,
  ): String = turnId?.let { "$basePath/$it" } ?: basePath

  private fun parseAudioDoneChunkCount(data: ByteArray): Int? {
    val payload = data.decodeToString()
    return runCatching {
      json.decodeFromString<AudioDonePayload>(payload).chunkCount.takeIf { it >= 0 }
    }.getOrNull()
  }

  private fun parseAudioDoneFormat(data: ByteArray): String {
    val payload = data.decodeToString()
    return runCatching {
      json.decodeFromString<AudioDonePayload>(payload).format.takeIf { it.isNotBlank() }
    }.getOrNull() ?: RESPONSE_FORMAT_PCM_24K
  }

  private fun emitAudioResponse(
    turnId: String?,
    audioResponse: AudioResponse?,
  ) {
    if (!isActiveTurn(turnId)) return
    if (audioResponse?.audioBytes?.isNotEmpty() == true) {
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
    val status = runCatching { json.decodeFromString<StatusPayload>(payload) }.getOrNull()
    if (!isActiveTurn(status?.turnId)) return
    status?.let {
      scope.launch {
        _statusUpdates.emit(it.message)
      }
    }
  }

  private fun handleErrorMessage(event: MessageEvent) {
    if (!isActiveRelayPhoneNode(event.sourceNodeId)) return
    val payload = event.data.decodeToString()
    val error = runCatching { json.decodeFromString<ErrorPayload>(payload) }.getOrNull()
    if (!isActiveTurn(error?.turnId)) return
    error?.let {
      completeActiveTurn(it.turnId)
      scope.launch {
        _errors.emit(it.message)
      }
    }
  }

  private fun handleAudioResponseMessage(
    turnId: String?,
    data: ByteArray,
    format: String = RESPONSE_FORMAT_PCM_24K,
  ) {
    if (data.isEmpty()) return
    emitAudioResponse(
      turnId,
      AudioResponse(turnId = null, audioBytes = data, format = normalizeResponseFormat(format)),
    )
  }

  private fun normalizeResponseFormat(format: String): String =
    when (format) {
      RESPONSE_FORMAT_OGG_OPUS -> RESPONSE_FORMAT_OGG_OPUS
      else -> RESPONSE_FORMAT_PCM_24K
    }

  private fun completeActiveTurn(turnId: String?) {
    val active = activeTurn.get() ?: return
    if (turnId != null && turnId != active.turnId) return
    activeTurn.compareAndSet(active, null)
  }

  private fun sendMessage(
    path: String,
    data: ByteArray,
    targetNodeId: String? = activeRelayPhoneNodeId,
  ) {
    val message = OutboundMessage(path = path, data = data, targetNodeId = targetNodeId)
    val result = outboundMessages.trySend(message)
    if (result.isSuccess) return
    if (result.isClosed) {
      Log.w(TAG, "dropping outbound message after disconnect: $path")
      return
    }
    if (path.startsWith(PATH_AUDIO_CHUNK)) {
      Log.w(TAG, "dropping audio chunk because outbound relay queue is full")
      return
    }
    scope.launch {
      try {
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
        try {
          val nodeIds = message.targetNodeId?.let(::setOf) ?: relayPhoneNodeIds
          val nodes = nodeClient.connectedNodes.await().filter { it.id in nodeIds }
          if (nodes.isEmpty()) {
            _phoneConnected.value = false
            continue
          }
          nodes.forEach { node ->
            messageClient.sendMessage(node.id, message.path, message.data).await()
          }
          _phoneConnected.value = true
        } catch (err: Throwable) {
          Log.w(TAG, "sendMessage failed: ${err.message}")
          _phoneConnected.value = false
        }
      }
    }
  }

  private fun enqueueAudioStreamEvent(event: AudioStreamEvent) {
    // SharedFlow has DROP_OLDEST overflow + a 64-frame buffer; tryEmit() is
    // synchronous and never suspends. If we still cannot enqueue (collector not
    // attached yet), drop and log: stalling on emit() under a slow collector
    // would block the assembler thread and the watch playback path.
    if (!_audioStreamEvents.tryEmit(event)) {
      Log.w(TAG, "dropping audio stream event because no collector is ready")
    }
  }

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

  @Serializable
  private data class StartPayload(
    val responseStreaming: Boolean,
    val acceptedResponseFormats: List<String> = emptyList(),
  )

  @Serializable
  private data class StatusPayload(
    val state: String,
    val message: String,
    val turnId: String? = null,
  )

  @Serializable
  private data class ErrorPayload(
    val message: String,
    val turnId: String? = null,
  )

  @Serializable
  private data class AudioDonePayload(
    val chunkCount: Int,
    val format: String = RESPONSE_FORMAT_PCM_24K,
  )

  private data class OutboundMessage(
    val path: String,
    val data: ByteArray,
    val targetNodeId: String?,
  )

  private data class ActiveTurn(
    val turnId: String,
    val phoneNodeId: String,
  )

  data class AudioResponse(
    val turnId: String?,
    val audioBytes: ByteArray,
    val format: String = RESPONSE_FORMAT_PCM_24K,
  )

  sealed interface AudioStreamEvent {
    val turnId: String?

    /**
     * Streaming-format negotiation has not landed; the assembler currently only
     * receives PCM_24K chunks. The format field is intentionally absent here
     * (vs. the per-message [AudioResponse]) so we cannot accidentally claim a
     * non-PCM format that the playback path is not yet wired to decode.
     */
    data class Chunk(
      override val turnId: String?,
      val audioBytes: ByteArray,
    ) : AudioStreamEvent

    data class Done(
      override val turnId: String?,
      val chunkCount: Int,
    ) : AudioStreamEvent
  }
}
