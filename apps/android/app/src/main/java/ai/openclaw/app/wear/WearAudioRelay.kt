package ai.openclaw.app.wear

import ai.openclaw.app.gateway.GatewaySession
import android.content.Context
import android.util.Log
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.Node
import com.google.android.gms.wearable.NodeClient
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.util.concurrent.atomic.AtomicLong

/**
 * Coordinates between the Wear OS watch and the gateway for push-to-talk
 * voice turns. Manages the Wearable Data Layer communication and the
 * per-turn [WearSttTtsSession] lifecycle.
 */
class WearAudioRelay(
  private val context: Context,
  private val gatewaySession: GatewaySession,
  private val wearTargetSessionKeyProvider: () -> String,
) {
  companion object {
    private const val TAG = "WearAudioRelay"
    private const val PATH_START = "/openclaw/watch/start"
    private const val PATH_END = "/openclaw/watch/end"
    private const val PATH_CANCEL = "/openclaw/watch/cancel"
    private const val PATH_AUDIO_CHUNK = "/openclaw/watch/audio/chunk"
    private const val PATH_STATUS = "/openclaw/watch/status"
    private const val PATH_ERROR = "/openclaw/watch/error"
    private const val PATH_AUDIO_RESPONSE = "/openclaw/watch/audio"
    private const val MAX_MESSAGE_BYTES = 90_000

    // ~1 minute of 200ms chunks prevents unbounded buffered audio growth.
    private const val MAX_AUDIO_CHUNKS = 300

    internal fun isWatchMessagePath(path: String): Boolean =
      path.matchesWatchPath(PATH_START) ||
        path.matchesWatchPath(PATH_END) ||
        path.matchesWatchPath(PATH_CANCEL) ||
        path.matchesWatchPath(PATH_AUDIO_CHUNK)

    private fun String.matchesWatchPath(basePath: String): Boolean = this == basePath || startsWith("$basePath/")
  }

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val messageClient: MessageClient = Wearable.getMessageClient(context)
  private val nodeClient: NodeClient = Wearable.getNodeClient(context)
  private val json = Json { ignoreUnknownKeys = true }

  private val audioBuffer = mutableListOf<ByteArray>()
  private val audioBufferLock = Any()
  private val turnCounter = AtomicLong(0)
  private val watchMessageListener =
    MessageClient.OnMessageReceivedListener { event ->
      handleWatchMessage(event.path, event.data, event.sourceNodeId)
    }

  @Volatile private var activeSession: WearSttTtsSession? = null

  @Volatile private var isRecording = false

  @Volatile private var activeWatchNodeId: String? = null

  @Volatile private var activeWatchTurnId: String? = null

  @Volatile private var activeResponseFormat: String = WearSttTtsSession.RESPONSE_FORMAT_PCM_24K

  @Volatile private var activeTargetSessionKey: String? = null

  init {
    messageClient.addListener(watchMessageListener)
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
      PATH_START -> startRecording(sourceNodeId, watchMessage.turnId, parseStartPayload(data))
      PATH_AUDIO_CHUNK -> receiveAudioChunk(data, sourceNodeId, watchMessage.turnId)
      PATH_END -> stopRecording(sourceNodeId, watchMessage.turnId)
      PATH_CANCEL -> cancel(sourceNodeId, watchMessage.turnId)
    }
  }

  private fun startRecording(
    sourceNodeId: String? = null,
    turnId: String? = null,
    startPayload: StartPayload? = null,
  ) {
    if (isRecording) {
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
    synchronized(audioBufferLock) { audioBuffer.clear() }
    sendStatus("Recording...")
  }

  fun receiveAudioChunk(
    chunk: ByteArray,
    sourceNodeId: String? = null,
    turnId: String? = null,
  ) {
    if (!isRecording) {
      Log.d(TAG, "starting watch turn from first audio chunk")
      startRecording(sourceNodeId, turnId)
    }
    if (!isActiveWatchNode(sourceNodeId) || !isActiveWatchTurn(turnId)) {
      Log.w(TAG, "ignoring audio chunk from non-active watch node")
      return
    }
    var shouldStopRecording = false
    synchronized(audioBufferLock) {
      if (audioBuffer.size >= MAX_AUDIO_CHUNKS) {
        Log.w(TAG, "Audio buffer full - stopping recording")
        shouldStopRecording = true
      } else {
        audioBuffer.add(chunk.copyOf())
      }
    }
    if (shouldStopRecording) stopRecording(turnId = activeWatchTurnId)
  }

  fun stopRecording(
    sourceNodeId: String? = null,
    turnId: String? = null,
  ) {
    if (!isRecording) return
    if (!isActiveWatchNode(sourceNodeId) || !isActiveWatchTurn(turnId)) {
      Log.w(TAG, "ignoring stop from non-active watch node")
      return
    }
    isRecording = false
    val counterTurnId = turnCounter.get()
    val watchTurnId = activeWatchTurnId

    val capturedFrames =
      synchronized(audioBufferLock) {
        if (audioBuffer.isEmpty()) {
          if (isCurrentTurn(counterTurnId)) {
            sendError("No audio recorded", watchTurnId)
          }
          if (activeWatchTurnId == watchTurnId) {
            activeWatchTurnId = null
          }
          activeTargetSessionKey = null
          return
        }
        audioBuffer.toList()
      }
    val targetNodeId = activeWatchNodeId
    val responseFormat = activeResponseFormat
    val targetSessionKey = activeTargetSessionKey ?: wearTargetSessionKeyProvider()
    scope.launch {
      if (!isCurrentTurn(counterTurnId)) return@launch
      Log.d(TAG, "watch turn captured ${capturedFrames.size} audio frames (${summarizePcm16Audio(capturedFrames)})")
      Log.d(TAG, "watch turn using transcription, chat, autoTTS reuse, and talk.speak fallback")

      lateinit var session: WearSttTtsSession

      fun isActiveSession(): Boolean = isCurrentTurn(counterTurnId) && activeSession === session
      session =
        WearSttTtsSession(
          scope = scope,
          session = gatewaySession,
          sessionKey = targetSessionKey,
          responseFormat = responseFormat,
          onAudioResponse = { audioResponse ->
            if (isActiveSession()) {
              sendAudioResponse(audioResponse, watchTurnId, counterTurnId)
            }
          },
          onStatus = { status ->
            if (isActiveSession()) {
              sendStatus(status)
            }
          },
          onError = { error ->
            if (isActiveSession()) {
              sendError(error)
            }
          },
          onComplete = { completedSession ->
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
          },
        )
      if (!isCurrentTurn(counterTurnId)) {
        session.cancel()
        return@launch
      }
      activeSession = session
      session.start(capturedFrames)
    }
  }

  fun cancel() {
    cancel(sourceNodeId = null, turnId = null)
  }

  private fun cancel(
    sourceNodeId: String?,
    turnId: String?,
  ) {
    if (!isActiveWatchNode(sourceNodeId) || !isActiveWatchTurn(turnId)) {
      Log.w(TAG, "ignoring cancel from non-active watch node")
      return
    }
    turnCounter.incrementAndGet()
    isRecording = false
    synchronized(audioBufferLock) { audioBuffer.clear() }
    activeSession?.cancel()
    activeSession = null
    activeWatchNodeId = null
    activeWatchTurnId = null
    activeTargetSessionKey = null
  }

  fun handleGatewayEvent(
    event: String,
    payloadJson: String?,
  ) {
    activeSession?.handleGatewayEvent(event, payloadJson)
  }

  fun disconnect() {
    cancel()
    messageClient.removeListener(watchMessageListener)
    scope.cancel()
  }

  private fun isCurrentTurn(turnId: Long): Boolean = turnCounter.get() == turnId

  private fun completeActiveTurn(turnId: String?) {
    if (turnId != null && activeWatchTurnId != turnId) return
    activeSession = null
    activeWatchNodeId = null
    activeWatchTurnId = null
  }

  private fun isActiveWatchNode(sourceNodeId: String?): Boolean {
    val activeNodeId = activeWatchNodeId ?: return true
    return sourceNodeId == null || sourceNodeId == activeNodeId
  }

  private fun isActiveWatchTurn(turnId: String?): Boolean {
    val activeTurnId = activeWatchTurnId ?: return true
    return turnId == null || turnId == activeTurnId
  }

  private fun parseWatchMessagePath(path: String): WatchMessagePath? {
    for (basePath in listOf(PATH_START, PATH_END, PATH_CANCEL, PATH_AUDIO_CHUNK)) {
      if (path == basePath) return WatchMessagePath(basePath, null)
      val prefix = "$basePath/"
      if (path.startsWith(prefix)) {
        return WatchMessagePath(basePath, path.removePrefix(prefix).takeIf { it.isNotEmpty() })
      }
    }
    return null
  }

  private fun parseStartPayload(data: ByteArray): StartPayload? {
    if (data.isEmpty()) return null
    return runCatching { json.decodeFromString<StartPayload>(data.decodeToString()) }.getOrNull()
  }

  private fun chooseResponseFormat(startPayload: StartPayload?): String =
    if (startPayload?.acceptedResponseFormats?.contains(WearSttTtsSession.RESPONSE_FORMAT_OGG_OPUS) == true) {
      WearSttTtsSession.RESPONSE_FORMAT_OGG_OPUS
    } else {
      WearSttTtsSession.RESPONSE_FORMAT_PCM_24K
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
    val payload = json.encodeToString(StatusPayload(state = "processing", message = message, turnId = turnId))
    sendMessage(PATH_STATUS, payload.toByteArray())
  }

  private fun sendError(
    message: String,
    turnId: String? = activeWatchTurnId,
  ) {
    val payload = json.encodeToString(ErrorPayload(message = message, turnId = turnId))
    sendMessage(PATH_ERROR, payload.toByteArray())
  }

  private fun sendAudioResponse(
    audioResponse: WearAudioResponse,
    turnId: String?,
    counterTurnId: Long,
  ) {
    val audioBytes = audioResponse.audioBytes
    val format = audioResponse.format
    // Audio might be large; if it exceeds message size limit, chunk it.
    // MessageClient has a ~100 KB limit, and per-path message ordering is not
    // guaranteed across separate sends, so serialize chunks, done, and status
    // in a single coroutine.
    val maxChunkSize = MAX_MESSAGE_BYTES
    if (format == WearSttTtsSession.RESPONSE_FORMAT_PCM_24K && audioBytes.size <= maxChunkSize) {
      val targetNodeId = activeWatchNodeId
      scope.launch {
        try {
          sendMessageSuspending(turnPath(PATH_AUDIO_RESPONSE, turnId), audioBytes, targetNodeId)
          sendMessageSuspending(PATH_STATUS, json.encodeToString(StatusPayload(state = "processing", message = "Response received", turnId = turnId)).toByteArray(), targetNodeId)
        } catch (err: Throwable) {
          Log.w(TAG, "sendAudioResponse failed: ${err.message}")
        }
      }
      return
    }
    if (format == WearSttTtsSession.RESPONSE_FORMAT_OGG_OPUS && audioBytes.size <= maxChunkSize) {
      val targetNodeId = activeWatchNodeId
      scope.launch {
        try {
          sendMessageSuspending("${turnPath(PATH_AUDIO_RESPONSE, turnId)}/format/$format", audioBytes, targetNodeId)
          sendMessageSuspending(PATH_STATUS, json.encodeToString(StatusPayload(state = "processing", message = "Response received", turnId = turnId)).toByteArray(), targetNodeId)
        } catch (err: Throwable) {
          Log.w(TAG, "sendAudioResponse failed: ${err.message}")
        }
      }
      return
    }
    val targetNodeId = activeWatchNodeId
    scope.launch {
      try {
        if (!isCurrentTurn(counterTurnId)) return@launch
        val targetNodes =
          if (targetNodeId != null) {
            listOf(targetNodeId)
          } else {
            nodeClient.connectedNodes.await().map { it.id }
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
          activeSession?.cancel()
          completeActiveTurn(turnId)
          return@launch
        }
        var offset = 0
        var chunkIndex = 0
        while (offset < audioBytes.size) {
          if (!isCurrentTurn(counterTurnId)) return@launch
          val end = minOf(offset + maxChunkSize, audioBytes.size)
          val chunk = audioBytes.copyOfRange(offset, end)
          sendToNodeIds(targetNodes, "${turnPath(PATH_AUDIO_RESPONSE, turnId)}/$chunkIndex", chunk)
          offset = end
          chunkIndex++
        }
        sendToNodeIds(
          targetNodes,
          "${turnPath(PATH_AUDIO_RESPONSE, turnId)}/done",
          json.encodeToString(AudioDonePayload(chunkCount = chunkIndex, turnId = turnId, format = format)).toByteArray(),
        )
        sendToNodeIds(
          targetNodes,
          PATH_STATUS,
          json
            .encodeToString(StatusPayload(state = "processing", message = "Response received", turnId = turnId))
            .toByteArray(),
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
    scope.launch {
      try {
        sendMessageSuspending(path, data)
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
      sendToNode(targetNodeId, path, data)
    } else {
      val nodes = nodeClient.connectedNodes.await()
      sendToNodes(nodes, path, data)
    }
  }

  private suspend fun sendToNodes(
    nodes: List<Node>,
    path: String,
    data: ByteArray,
  ) {
    for (node in nodes) {
      sendToNode(node.id, path, data)
    }
  }

  private suspend fun sendToNodeIds(
    nodeIds: List<String>,
    path: String,
    data: ByteArray,
  ) {
    for (nodeId in nodeIds) {
      sendToNode(nodeId, path, data)
    }
  }

  private suspend fun sendToNode(
    nodeId: String,
    path: String,
    data: ByteArray,
  ) {
    messageClient.sendMessage(nodeId, path, data).await()
  }

  @Serializable
  private data class StartPayload(
    val responseStreaming: Boolean = false,
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
    val turnId: String? = null,
    val format: String = WearSttTtsSession.RESPONSE_FORMAT_PCM_24K,
  )

  private data class WatchMessagePath(
    val path: String,
    val turnId: String?,
  )

  private fun turnPath(
    basePath: String,
    turnId: String?,
  ): String = turnId?.let { "$basePath/$it" } ?: basePath
}
