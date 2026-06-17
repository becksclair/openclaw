package ai.openclaw.app.wear

import ai.openclaw.app.gateway.GatewaySession
import ai.openclaw.common.wear.WearRelayAudioDonePayload
import ai.openclaw.common.wear.WearRelayErrorPayload
import ai.openclaw.common.wear.WearRelayProtocol
import ai.openclaw.common.wear.WearRelayStartPayload
import ai.openclaw.common.wear.WearRelayStatusPayload
import ai.openclaw.common.wear.WearRelayTextPayload
import android.content.Context
import android.os.SystemClock
import android.util.Log
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.util.concurrent.atomic.AtomicLong

/**
 * Coordinates between the Wear OS watch and the gateway for push-to-talk
 * voice turns. Manages the Wearable Data Layer communication and the
 * per-turn [WearSttTtsSession] lifecycle.
 */
class WearAudioRelay internal constructor(
  private val gateway: WearGateway,
  private val wearTargetSessionKeyProvider: () -> String,
  private val transport: WearRelayTransport,
  private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) {
  constructor(
    context: Context,
    gatewaySession: GatewaySession,
    wearTargetSessionKeyProvider: () -> String,
  ) : this(
    gateway = GatewaySessionWearGateway(gatewaySession),
    wearTargetSessionKeyProvider = wearTargetSessionKeyProvider,
    transport = GoogleWearRelayTransport(context),
    scope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
  )

  companion object {
    private const val TAG = "WearAudioRelay"

    // ~1 minute of 200ms chunks prevents unbounded buffered audio growth.
    private const val MAX_AUDIO_CHUNKS = 300

    internal fun isWatchMessagePath(path: String): Boolean = WearRelayProtocol.parseWatchMessagePath(path) != null
  }

  private val json = Json { ignoreUnknownKeys = true }

  private val listenerRegistrationLock = Any()
  private val audioBuffer = mutableListOf<ByteArray>()
  private val audioBufferLock = Any()
  private val turnStateLock = Any()
  private val turnCounter = AtomicLong(0)
  private val watchMessageListener =
    WearRelayMessageListener { path, data, sourceNodeId ->
      handleWatchMessage(path, data, sourceNodeId)
    }

  @Volatile private var activeSession: WearSttTtsSession? = null

  @Volatile private var isRecording = false

  @Volatile private var activeWatchNodeId: String? = null

  @Volatile private var activeWatchTurnId: String? = null

  @Volatile private var activeResponseFormat: String = WearRelayProtocol.RESPONSE_FORMAT_PCM_24K

  @Volatile private var activeTargetSessionKey: String? = null

  @Volatile private var listenerRegistered = false

  internal val isListeningForWatchMessages: Boolean
    get() = listenerRegistered

  init {
    connect()
  }

  fun connect() {
    synchronized(listenerRegistrationLock) {
      if (listenerRegistered) return
      transport.addListener(watchMessageListener)
      listenerRegistered = true
    }
    Log.d(TAG, "registered foreground watch message listener")
  }

  fun handleWatchMessage(
    path: String,
    data: ByteArray,
    sourceNodeId: String? = null,
  ) {
    val watchMessage = parseWatchMessagePath(path) ?: return
    Log.d(TAG, "watch message received: path=$path bytes=${data.size} sourceNodeId=$sourceNodeId")
    when (watchMessage.path) {
      WearRelayProtocol.PATH_START -> startRecording(sourceNodeId, watchMessage.turnId, parseWearRelayStartPayload(data))
      WearRelayProtocol.PATH_AUDIO_CHUNK -> receiveAudioChunk(data, sourceNodeId, watchMessage.turnId)
      WearRelayProtocol.PATH_END -> stopRecording(sourceNodeId, watchMessage.turnId)
      WearRelayProtocol.PATH_TEXT -> startTextTurn(sourceNodeId, watchMessage.turnId, parseWearRelayTextPayload(data))
      WearRelayProtocol.PATH_CANCEL -> cancel(sourceNodeId, watchMessage.turnId)
    }
  }

  private fun startRecording(
    sourceNodeId: String? = null,
    turnId: String? = null,
    startPayload: WearRelayStartPayload? = null,
  ) {
    val currentTurnId: String?
    synchronized(turnStateLock) {
      if (isRecording) {
        return
      }
      if (activeWatchTurnId != null && !isActiveWatchTurn(turnId)) {
        return
      }
      if (activeWatchTurnId != null && isActiveWatchNode(sourceNodeId) && isActiveWatchTurn(turnId)) {
        return
      }
      turnCounter.incrementAndGet()
      activeSession?.cancel()
      activeSession = null
      activeWatchNodeId = sourceNodeId
      activeWatchTurnId = turnId
      isRecording = true
      activeResponseFormat = chooseResponseFormat(startPayload)
      activeTargetSessionKey = wearTargetSessionKeyProvider()
      currentTurnId = activeWatchTurnId
    }
    synchronized(audioBufferLock) { audioBuffer.clear() }
    sendStatus("Recording...", currentTurnId)
  }

  private fun startTextTurn(
    sourceNodeId: String? = null,
    turnId: String? = null,
    textPayload: WearRelayTextPayload? = null,
  ) {
    val transcript = textPayload?.text?.trim().orEmpty()
    val counterTurnId: Long
    val watchTurnId: String?
    val targetNodeId: String?
    val responseFormat: String
    val targetSessionKey: String
    synchronized(turnStateLock) {
      turnCounter.incrementAndGet()
      activeSession?.cancel()
      activeSession = null
      activeWatchNodeId = sourceNodeId
      activeWatchTurnId = turnId
      isRecording = false
      activeResponseFormat = chooseResponseFormat(textPayload?.acceptedResponseFormats.orEmpty())
      activeTargetSessionKey = wearTargetSessionKeyProvider()
      counterTurnId = turnCounter.get()
      watchTurnId = activeWatchTurnId
      targetNodeId = activeWatchNodeId
      responseFormat = activeResponseFormat
      targetSessionKey = activeTargetSessionKey ?: wearTargetSessionKeyProvider()
    }
    synchronized(audioBufferLock) { audioBuffer.clear() }
    if (transcript.isEmpty()) {
      sendError("No speech recognized", turnId)
      completeActiveTurn(turnId)
      return
    }
    scope.launch {
      if (!isCurrentTurn(counterTurnId)) return@launch
      Log.d(TAG, "watch text turn captured chars=${transcript.length}")
      lateinit var session: WearSttTtsSession

      fun isActiveSession(): Boolean = isCurrentTurn(counterTurnId) && activeSession === session
      session =
        createResponseSession(
          targetSessionKey = targetSessionKey,
          responseFormat = responseFormat,
          targetNodeId = targetNodeId,
          watchTurnId = watchTurnId,
          counterTurnId = counterTurnId,
          isActiveSession = ::isActiveSession,
        )
      val shouldStart =
        synchronized(turnStateLock) {
          val current = isCurrentTurn(counterTurnId)
          if (current) activeSession = session
          current
        }
      if (!shouldStart) {
        session.cancel()
        return@launch
      }
      session.startTranscript(transcript)
    }
  }

  fun receiveAudioChunk(
    chunk: ByteArray,
    sourceNodeId: String? = null,
    turnId: String? = null,
  ) {
    val shouldStartRecording = synchronized(turnStateLock) { !isRecording }
    if (shouldStartRecording) {
      Log.d(TAG, "starting watch turn from first audio chunk")
      startRecording(sourceNodeId, turnId)
    }
    val stopTarget =
      synchronized(turnStateLock) {
        if (!isActiveWatchNode(sourceNodeId) || !isActiveWatchTurn(turnId)) {
          Log.w(TAG, "ignoring audio chunk from non-active watch node")
          return
        }
        activeWatchNodeId to activeWatchTurnId
      }
    var shouldStopRecording = false
    synchronized(audioBufferLock) {
      if (audioBuffer.size >= MAX_AUDIO_CHUNKS) {
        Log.w(TAG, "Audio buffer full - stopping recording")
        shouldStopRecording = true
      } else {
        audioBuffer.add(chunk)
      }
    }
    if (shouldStopRecording) {
      stopRecording(sourceNodeId = stopTarget.first, turnId = stopTarget.second)
    }
  }

  fun stopRecording(
    sourceNodeId: String? = null,
    turnId: String? = null,
  ) {
    val counterTurnId: Long
    val watchTurnId: String?
    val targetNodeId: String?
    val responseFormat: String
    val targetSessionKey: String
    val capturedFrames: List<ByteArray>?
    synchronized(turnStateLock) {
      if (!isRecording) return
      if (!isActiveWatchNode(sourceNodeId) || !isActiveWatchTurn(turnId)) {
        Log.w(TAG, "ignoring stop from non-active watch node")
        return
      }
      isRecording = false
      counterTurnId = turnCounter.get()
      watchTurnId = activeWatchTurnId
      targetNodeId = activeWatchNodeId
      responseFormat = activeResponseFormat
      targetSessionKey = activeTargetSessionKey ?: wearTargetSessionKeyProvider()
      capturedFrames =
        synchronized(audioBufferLock) {
          if (audioBuffer.isEmpty()) {
            if (isCurrentTurn(counterTurnId)) {
              sendError("No audio recorded", watchTurnId)
            }
            activeWatchTurnId = null
            activeTargetSessionKey = null
            null
          } else {
            audioBuffer.toList()
          }
        }
    }
    if (capturedFrames == null) return
    scope.launch {
      if (!isCurrentTurn(counterTurnId)) return@launch
      Log.d(TAG, "watch turn captured ${capturedFrames.size} audio frames (${summarizePcm16Audio(capturedFrames)})")
      Log.d(TAG, "watch turn using transcription, chat, and talk.speak")

      lateinit var session: WearSttTtsSession

      fun isActiveSession(): Boolean = isCurrentTurn(counterTurnId) && activeSession === session
      session =
        createResponseSession(
          targetSessionKey = targetSessionKey,
          responseFormat = responseFormat,
          targetNodeId = targetNodeId,
          watchTurnId = watchTurnId,
          counterTurnId = counterTurnId,
          isActiveSession = ::isActiveSession,
        )
      val shouldStart =
        synchronized(turnStateLock) {
          val current = isCurrentTurn(counterTurnId)
          if (current) activeSession = session
          current
        }
      if (!shouldStart) {
        session.cancel()
        return@launch
      }
      session.start(capturedFrames)
    }
  }

  private fun createResponseSession(
    targetSessionKey: String,
    responseFormat: String,
    targetNodeId: String?,
    watchTurnId: String?,
    counterTurnId: Long,
    isActiveSession: () -> Boolean,
  ): WearSttTtsSession =
    WearSttTtsSession(
      scope = scope,
      gateway = gateway,
      sessionKey = targetSessionKey,
      responseFormat = responseFormat,
      onAudioResponse = { audioResponse ->
        val active = synchronized(turnStateLock) { isActiveSession() }
        if (active) {
          sendAudioResponse(audioResponse, watchTurnId, counterTurnId)
        }
      },
      onStatus = { status ->
        val (active, currentTurnId) = synchronized(turnStateLock) { isActiveSession() to activeWatchTurnId }
        if (active) {
          sendStatus(status, currentTurnId)
        }
      },
      onError = { error ->
        val (active, currentTurnId) = synchronized(turnStateLock) { isActiveSession() to activeWatchTurnId }
        if (active) {
          sendError(error, currentTurnId)
        }
      },
      onComplete = { completedSession ->
        synchronized(turnStateLock) {
          if (activeSession === completedSession) {
            activeSession = null
            if (activeWatchNodeId == targetNodeId) {
              activeWatchNodeId = null
            }
            if (activeWatchTurnId == watchTurnId) {
              activeWatchTurnId = null
            }
            activeTargetSessionKey = null
          }
        }
      },
    )

  fun cancel() {
    cancel(sourceNodeId = null, turnId = null)
  }

  private fun cancel(
    sourceNodeId: String?,
    turnId: String?,
  ) {
    synchronized(turnStateLock) {
      if (!isActiveWatchNode(sourceNodeId) || !isActiveWatchTurn(turnId)) {
        Log.w(TAG, "ignoring cancel from non-active watch node")
        return
      }
      turnCounter.incrementAndGet()
      isRecording = false
      activeSession?.cancel()
      activeSession = null
      activeWatchNodeId = null
      activeWatchTurnId = null
      activeTargetSessionKey = null
    }
    synchronized(audioBufferLock) { audioBuffer.clear() }
  }

  fun handleGatewayEvent(
    event: String,
    payloadJson: String?,
  ) {
    activeSession?.handleGatewayEvent(event, payloadJson)
  }

  fun disconnect() {
    scope.coroutineContext.cancelChildren()
    cancel()
    synchronized(listenerRegistrationLock) {
      if (!listenerRegistered) return
      transport.removeListener(watchMessageListener)
      listenerRegistered = false
    }
  }

  private fun isCurrentTurn(turnId: Long): Boolean = turnCounter.get() == turnId

  private fun completeActiveTurn(turnId: String?) {
    synchronized(turnStateLock) {
      if (turnId != null && activeWatchTurnId != turnId) return
      activeSession = null
      activeWatchNodeId = null
      activeWatchTurnId = null
    }
  }

  private fun isActiveWatchNode(sourceNodeId: String?): Boolean {
    val activeNodeId = activeWatchNodeId ?: return true
    return sourceNodeId == null || sourceNodeId == activeNodeId
  }

  private fun isActiveWatchTurn(turnId: String?): Boolean {
    val activeTurnId = activeWatchTurnId ?: return true
    return turnId == null || turnId == activeTurnId
  }

  private fun parseWatchMessagePath(path: String) = WearRelayProtocol.parseWatchMessagePath(path)

  private fun parseWearRelayStartPayload(data: ByteArray): WearRelayStartPayload? {
    if (data.isEmpty()) return null
    return runCatching { json.decodeFromString<WearRelayStartPayload>(data.decodeToString()) }.getOrNull()
  }

  private fun parseWearRelayTextPayload(data: ByteArray): WearRelayTextPayload? {
    if (data.isEmpty()) return null
    return runCatching { json.decodeFromString<WearRelayTextPayload>(data.decodeToString()) }.getOrNull()
  }

  private fun chooseResponseFormat(startPayload: WearRelayStartPayload?): String = chooseResponseFormat(startPayload?.acceptedResponseFormats.orEmpty())

  private fun chooseResponseFormat(acceptedResponseFormats: List<String>): String =
    if (acceptedResponseFormats.contains(WearRelayProtocol.RESPONSE_FORMAT_MP3)) {
      WearRelayProtocol.RESPONSE_FORMAT_MP3
    } else if (acceptedResponseFormats.contains(WearRelayProtocol.RESPONSE_FORMAT_OGG_OPUS)) {
      WearRelayProtocol.RESPONSE_FORMAT_OGG_OPUS
    } else {
      WearRelayProtocol.RESPONSE_FORMAT_PCM_24K
    }

  private fun summarizePcm16Audio(frames: List<ByteArray>): String {
    var sampleCount = 0
    var nonZeroSamples = 0
    var peak = 0
    for (bytes in frames) {
      var index = 0
      while (index + 1 < bytes.size) {
        val sample = ((bytes[index].toInt() and 0xff) or (bytes[index + 1].toInt() shl 8)).toShort().toInt()
        val abs = if (sample == Short.MIN_VALUE.toInt()) Short.MAX_VALUE.toInt() else kotlin.math.abs(sample)
        sampleCount += 1
        if (sample != 0) nonZeroSamples += 1
        if (abs > peak) peak = abs
        index += 2
      }
    }
    return "samples=$sampleCount nonZero=$nonZeroSamples peak=$peak"
  }

  private fun sendStatus(
    message: String,
    turnId: String? = activeWatchTurnId,
  ) {
    val payload = json.encodeToString(WearRelayStatusPayload(state = "processing", message = message, turnId = turnId))
    sendMessage(WearRelayProtocol.PATH_STATUS, payload.toByteArray())
  }

  private fun sendError(
    message: String,
    turnId: String? = activeWatchTurnId,
  ) {
    val payload = json.encodeToString(WearRelayErrorPayload(message = message, turnId = turnId))
    sendMessage(WearRelayProtocol.PATH_ERROR, payload.toByteArray())
  }

  private fun sendAudioResponse(
    audioResponse: WearAudioResponse,
    turnId: String?,
    counterTurnId: Long,
  ) {
    val audioBytes = audioResponse.audioBytes
    val format = audioResponse.format
    // Audio might be large; if it exceeds message size limit, chunk it.
    // MessageClient has a ~100 KB limit. Chunks are indexed and reassembled by
    // the watch, so sequential indexed sends are sufficient.
    val maxChunkSize = WearRelayProtocol.MAX_MESSAGE_BYTES
    val targetNodeId = synchronized(turnStateLock) { activeWatchNodeId }
    if (audioBytes.size <= maxChunkSize) {
      scope.launch {
        try {
          val startedAtMs = SystemClock.elapsedRealtime()
          if (!isCurrentTurn(counterTurnId)) return@launch
          sendMessageSuspending(audioResponsePath(turnId, format), audioBytes, targetNodeId)
          sendMessageSuspending(WearRelayProtocol.PATH_STATUS, json.encodeToString(WearRelayStatusPayload(state = "processing", message = "Response received", turnId = turnId)).toByteArray(), targetNodeId)
          Log.d(TAG, "audio response send done turn=$turnId format=$format bytes=${audioBytes.size} elapsedMs=${SystemClock.elapsedRealtime() - startedAtMs}")
        } catch (err: Throwable) {
          Log.w(TAG, "sendAudioResponse failed: ${err.message}")
        }
      }
      return
    }
    scope.launch {
      try {
        val startedAtMs = SystemClock.elapsedRealtime()
        if (!isCurrentTurn(counterTurnId)) return@launch
        val targetNodes =
          if (targetNodeId != null) {
            listOf(targetNodeId)
          } else {
            transport.connectedNodeIds()
          }
        if (targetNodes.isEmpty()) {
          // No connected nodes means the watch is no longer reachable. There is
          // nothing to deliver the response to; broadcasting a status message
          // would also have no destinations. Cancel the session before clearing
          // the active-turn fields so the session's still-running work (any
          // in-flight talk.speak / audio decode) is torn down rather than
          // orphaned: once activeSession is nulled, the session's own
          // onComplete callback can no longer match and will skip its cleanup.
          Log.w(TAG, "chunked audio response: no connected nodes; abandoning turn=$turnId")
          synchronized(turnStateLock) { activeSession?.cancel() }
          completeActiveTurn(turnId)
          return@launch
        }
        var offset = 0
        var chunkIndex = 0
        val responseBasePath = turnPath(WearRelayProtocol.PATH_AUDIO_RESPONSE, turnId)
        Log.d(
          TAG,
          "audio response chunked send start turn=$turnId format=$format bytes=${audioBytes.size} maxChunkBytes=$maxChunkSize",
        )
        while (offset < audioBytes.size) {
          if (!isCurrentTurn(counterTurnId)) return@launch
          val end = minOf(offset + maxChunkSize, audioBytes.size)
          val chunk = audioBytes.copyOfRange(offset, end)
          sendToNodeIds(targetNodes, "$responseBasePath/$chunkIndex", chunk)
          offset = end
          chunkIndex++
        }
        if (!isCurrentTurn(counterTurnId)) return@launch
        sendToNodeIds(
          targetNodes,
          "${turnPath(WearRelayProtocol.PATH_AUDIO_RESPONSE, turnId)}/done",
          json.encodeToString(WearRelayAudioDonePayload(chunkCount = chunkIndex, turnId = turnId, format = format)).toByteArray(),
        )
        sendToNodeIds(
          targetNodes,
          WearRelayProtocol.PATH_STATUS,
          json
            .encodeToString(WearRelayStatusPayload(state = "processing", message = "Response received", turnId = turnId))
            .toByteArray(),
        )
        Log.d(
          TAG,
          "audio response chunked send done turn=$turnId format=$format bytes=${audioBytes.size} chunks=$chunkIndex elapsedMs=${SystemClock.elapsedRealtime() - startedAtMs}",
        )
      } catch (err: Throwable) {
        Log.w(TAG, "chunked audio response failed: ${err.message}")
      }
    }
  }

  private fun sendMessage(
    path: String,
    data: ByteArray,
  ) {
    val targetNodeId = activeWatchNodeId
    scope.launch {
      try {
        sendMessageSuspending(path, data, targetNodeId)
      } catch (err: Throwable) {
        Log.w(TAG, "sendMessage failed: ${err.message}")
      }
    }
  }

  private suspend fun sendMessageSuspending(
    path: String,
    data: ByteArray,
    targetNodeId: String? = activeWatchNodeId,
  ) {
    if (targetNodeId != null) {
      transport.sendToNode(targetNodeId, path, data)
    } else {
      sendToNodeIds(transport.connectedNodeIds(), path, data)
    }
  }

  private suspend fun sendToNodeIds(
    nodeIds: List<String>,
    path: String,
    data: ByteArray,
  ) {
    for (nodeId in nodeIds) {
      transport.sendToNode(nodeId, path, data)
    }
  }

  private fun audioResponsePath(
    turnId: String?,
    format: String,
  ): String {
    val base = turnPath(WearRelayProtocol.PATH_AUDIO_RESPONSE, turnId)
    return if (format == WearRelayProtocol.RESPONSE_FORMAT_PCM_24K) base else "$base/format/$format"
  }

  private fun turnPath(
    basePath: String,
    turnId: String?,
  ): String = turnId?.let { "$basePath/$it" } ?: basePath
}

internal fun interface WearRelayMessageListener {
  fun onMessage(
    path: String,
    data: ByteArray,
    sourceNodeId: String?,
  )
}

internal interface WearRelayTransport {
  fun addListener(listener: WearRelayMessageListener)

  fun removeListener(listener: WearRelayMessageListener)

  suspend fun connectedNodeIds(): List<String>

  suspend fun sendToNode(
    nodeId: String,
    path: String,
    data: ByteArray,
  )
}

private class GoogleWearRelayTransport(
  context: Context,
) : WearRelayTransport {
  private val messageClient: MessageClient = Wearable.getMessageClient(context)
  private val nodeClient = Wearable.getNodeClient(context)
  private val listenerLock = Any()
  private var relayListener: WearRelayMessageListener? = null
  private var messageListener: MessageClient.OnMessageReceivedListener? = null

  override fun addListener(listener: WearRelayMessageListener) {
    val newListener =
      MessageClient.OnMessageReceivedListener { event ->
        listener.onMessage(event.path, event.data, event.sourceNodeId)
      }
    synchronized(listenerLock) {
      messageListener?.let { messageClient.removeListener(it) }
      relayListener = listener
      messageListener = newListener
      messageClient.addListener(newListener)
    }
  }

  override fun removeListener(listener: WearRelayMessageListener) {
    synchronized(listenerLock) {
      if (relayListener != listener) return
      val currentListener = messageListener ?: return
      relayListener = null
      messageListener = null
      messageClient.removeListener(currentListener)
    }
  }

  override suspend fun connectedNodeIds(): List<String> = nodeClient.connectedNodes.await().map { it.id }

  override suspend fun sendToNode(
    nodeId: String,
    path: String,
    data: ByteArray,
  ) {
    messageClient.sendMessage(nodeId, path, data).await()
  }
}
