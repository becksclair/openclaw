package ai.openclaw.app.wear

import ai.openclaw.app.gateway.GatewaySession
import ai.openclaw.common.wear.WearReasoningLevel
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
import kotlinx.coroutines.delay
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
  private val canHandleMessages: () -> Boolean = { true },
  private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) {
  constructor(
    context: Context,
    gatewaySession: GatewaySession,
    wearTargetSessionKeyProvider: () -> String,
    canHandleMessages: () -> Boolean = { true },
  ) : this(
    gateway = GatewaySessionWearGateway(gatewaySession),
    wearTargetSessionKeyProvider = wearTargetSessionKeyProvider,
    transport = GoogleWearRelayTransport(context),
    canHandleMessages = canHandleMessages,
    scope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
  )

  companion object {
    private const val TAG = "WearAudioRelay"

    // ~1 minute of 200ms chunks prevents unbounded buffered audio growth.
    private const val MAX_AUDIO_CHUNKS = 300
    private const val RECENT_COMPLETED_TURN_IDS_LIMIT = 32

    // A watch that disconnects mid-recording never sends PATH_END, so without a
    // ceiling the relay stays stuck recording and rejects every later turn. This
    // matches the MAX_AUDIO_CHUNKS budget (~300 * 200ms) so a healthy turn always
    // ends via PATH_END or the buffer cap before the watchdog ever fires.
    private const val MAX_RECORDING_MS = 60_000L

    internal fun isWatchMessagePath(path: String): Boolean = WearRelayProtocol.parseWatchMessagePath(path) != null
  }

  private val json = Json { ignoreUnknownKeys = true }

  private val listenerRegistrationLock = Any()

  // Inbound audio is keyed by chunkIndex, not appended in arrival order: the
  // Wearable Data Layer does not guarantee message ordering, so a benign reorder
  // (e.g. chunk 1 before chunk 0) must buffer and fill in, never fail the turn.
  // The contiguity check at PATH_END (stopRecording) detects a real middle drop.
  // Touched only inside turnStateLock critical sections, so it needs no separate
  // lock that would otherwise race a publish-then-clear window.
  private val audioChunks = mutableMapOf<Int, ByteArray>()
  private val turnStateLock = Any()
  private val recentCompletedTurnIds = ArrayDeque<String>()
  private val recentCompletedTurnIdSet = mutableSetOf<String>()
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

  @Volatile private var activeReasoningLevel: String = WearReasoningLevel.DEFAULT

  @Volatile private var activeTargetSessionKey: String? = null

  @Volatile private var listenerRegistered = false

  internal val isListeningForWatchMessages: Boolean
    get() = listenerRegistered

  init {
    connect()
  }

  fun connect(): Boolean {
    synchronized(listenerRegistrationLock) {
      if (listenerRegistered) return false
      transport.addListener(watchMessageListener)
      listenerRegistered = true
    }
    Log.d(TAG, "registered foreground watch message listener")
    return true
  }

  fun handleWatchMessage(
    path: String,
    data: ByteArray,
    sourceNodeId: String? = null,
  ) {
    val watchMessage = parseWatchMessagePath(path) ?: return
    if (!canHandleMessages()) {
      Log.d(TAG, "watch message ignored until gateway is connected")
      return
    }
    Log.d(TAG, "watch message received: path=$path bytes=${data.size} sourceNodeId=$sourceNodeId")
    when (watchMessage.path) {
      WearRelayProtocol.PATH_START -> startRecording(sourceNodeId, watchMessage.turnId, parseWearRelayStartPayload(data))
      WearRelayProtocol.PATH_AUDIO_CHUNK ->
        // parseWatchMessagePath only returns PATH_AUDIO_CHUNK with a numeric index.
        receiveAudioChunk(data, sourceNodeId, watchMessage.turnId, watchMessage.chunkIndex ?: return)
      WearRelayProtocol.PATH_END -> stopRecording(sourceNodeId, watchMessage.turnId)
      WearRelayProtocol.PATH_TEXT -> startTextTurn(sourceNodeId, watchMessage.turnId, parseWearRelayTextPayload(data))
      WearRelayProtocol.PATH_CANCEL -> cancel(sourceNodeId, watchMessage.turnId)
    }
  }

  private fun startRecording(
    sourceNodeId: String? = null,
    turnId: String,
    startPayload: WearRelayStartPayload? = null,
  ) {
    val currentTurnId: String
    val recordingGeneration: Long
    synchronized(turnStateLock) {
      if (isRecording) {
        if (activeWatchTurnId != null && isActiveWatchNode(sourceNodeId) && isActiveWatchTurn(turnId)) {
          updateActiveStartPayloadMetadata(startPayload)
        }
        return
      }
      // A late/stale chunk for an already-finished turn must not auto-start a
      // fresh gateway STT/chat run, so reject completed turn ids up front.
      if (isRecentCompletedTurnId(turnId)) {
        return
      }
      if (activeWatchTurnId != null && !isActiveWatchTurn(turnId)) {
        return
      }
      if (activeWatchTurnId != null && !isActiveWatchNode(sourceNodeId)) {
        Log.w(TAG, "ignoring start from non-active watch node")
        return
      }
      if (activeWatchTurnId != null && isActiveWatchNode(sourceNodeId) && isActiveWatchTurn(turnId)) {
        updateActiveStartPayloadMetadata(startPayload)
        return
      }
      turnCounter.incrementAndGet()
      activeSession?.cancel()
      activeSession = null
      activeWatchNodeId = sourceNodeId
      activeWatchTurnId = turnId
      isRecording = true
      activeResponseFormat = chooseResponseFormat(startPayload)
      activeReasoningLevel = WearReasoningLevel.normalize(startPayload?.reasoningLevel)
      activeTargetSessionKey = wearTargetSessionKeyProvider()
      audioChunks.clear()
      currentTurnId = turnId
      recordingGeneration = turnCounter.get()
    }
    // turnCounter is bumped on every real end/cancel/new-turn, so a completed
    // turn turns this pending watchdog into an automatic no-op.
    scope.launch {
      delay(MAX_RECORDING_MS)
      reapStaleRecording(recordingGeneration)
    }
    sendStatus("Recording...", currentTurnId)
  }

  private fun updateActiveStartPayloadMetadata(startPayload: WearRelayStartPayload?) {
    if (startPayload == null) return
    activeResponseFormat = chooseResponseFormat(startPayload)
    activeReasoningLevel = WearReasoningLevel.normalize(startPayload.reasoningLevel)
  }

  private fun reapStaleRecording(recordingGeneration: Long) {
    val staleTurnId: String?
    synchronized(turnStateLock) {
      if (!isRecording || !isCurrentTurn(recordingGeneration)) return
      turnCounter.incrementAndGet()
      isRecording = false
      activeSession?.cancel()
      activeSession = null
      staleTurnId = activeWatchTurnId
      activeWatchNodeId = null
      activeWatchTurnId = null
      activeTargetSessionKey = null
      activeReasoningLevel = WearReasoningLevel.DEFAULT
      audioChunks.clear()
      // Block a chunk arriving just after lease expiry from reviving this turn.
      if (staleTurnId != null) rememberCompletedTurnId(staleTurnId)
    }
    Log.w(TAG, "recording lease expired; reaping stale turn=$staleTurnId")
    if (staleTurnId != null) {
      sendError("Recording timed out", staleTurnId)
    }
  }

  private fun startTextTurn(
    sourceNodeId: String? = null,
    turnId: String,
    textPayload: WearRelayTextPayload? = null,
  ) {
    val transcript = textPayload?.text?.trim().orEmpty()
    val counterTurnId: Long
    val watchTurnId: String
    val targetNodeId: String?
    val responseFormat: String
    val reasoningLevel: String
    val targetSessionKey: String
    synchronized(turnStateLock) {
      if (activeWatchTurnId != null && !isActiveWatchTurn(turnId)) {
        return
      }
      if (activeWatchTurnId != null && !isActiveWatchNode(sourceNodeId)) {
        Log.w(TAG, "ignoring text turn from non-active watch node")
        return
      }
      if (isRecentCompletedTurnId(turnId)) {
        return
      }
      turnCounter.incrementAndGet()
      activeSession?.cancel()
      activeSession = null
      activeWatchNodeId = sourceNodeId
      activeWatchTurnId = turnId
      isRecording = false
      activeResponseFormat = chooseResponseFormat(textPayload?.acceptedResponseFormats.orEmpty())
      activeReasoningLevel = WearReasoningLevel.normalize(textPayload?.reasoningLevel)
      activeTargetSessionKey = wearTargetSessionKeyProvider()
      counterTurnId = turnCounter.get()
      watchTurnId = turnId
      targetNodeId = activeWatchNodeId
      responseFormat = activeResponseFormat
      reasoningLevel = activeReasoningLevel
      targetSessionKey = activeTargetSessionKey.orEmpty()
      audioChunks.clear()
      rememberCompletedTurnId(turnId)
    }
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
          reasoningLevel = reasoningLevel,
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
    turnId: String,
    chunkIndex: Int,
  ) {
    val shouldStartRecording = synchronized(turnStateLock) { !isRecording && !isRecentCompletedTurnId(turnId) }
    if (shouldStartRecording) {
      Log.d(TAG, "starting watch turn from first audio chunk")
      startRecording(sourceNodeId, turnId)
    }
    var outcome: AudioChunkOutcome
    val targetNodeId: String?
    synchronized(turnStateLock) {
      // The recording phase is what stores chunks. A chunk arriving after stop/
      // cancel/completion (not recording, wrong turn, or an already-finished id)
      // must be ignored, never mutate buffers or cancel the now-live session that
      // stopRecording launched. This is the post-stop/late-chunk safety gate.
      val recordingThisTurn = isRecording && isActiveWatchTurn(turnId) && !isRecentCompletedTurnId(turnId)
      if (!recordingThisTurn || !isActiveWatchNode(sourceNodeId)) {
        Log.d(TAG, "ignoring audio chunk outside the active recording turn")
        return
      }
      targetNodeId = activeWatchNodeId
      // Index-keyed store tolerates reorders/duplicates: a later index simply
      // buffers, an earlier index fills its slot. The PATH_END contiguity check
      // (stopRecording) decides whether the assembled run has a real middle hole.
      audioChunks[chunkIndex] = chunk
      outcome =
        if (audioChunks.size > MAX_AUDIO_CHUNKS) {
          // Genuine overload (not a gap): more distinct chunks than a healthy turn
          // can produce. Stop + tear down via the BUFFER_FULL path, as before.
          AudioChunkOutcome.BUFFER_FULL
        } else {
          AudioChunkOutcome.STORED
        }
    }
    when (outcome) {
      AudioChunkOutcome.BUFFER_FULL -> {
        Log.w(TAG, "Audio buffer full - stopping recording")
        stopRecording(sourceNodeId = targetNodeId, turnId = turnId)
      }
      AudioChunkOutcome.STORED -> Unit
    }
  }

  private enum class AudioChunkOutcome { STORED, BUFFER_FULL }

  fun stopRecording(
    sourceNodeId: String? = null,
    turnId: String,
  ) {
    val counterTurnId: Long
    val watchTurnId: String
    val targetNodeId: String?
    val responseFormat: String
    val reasoningLevel: String
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
      watchTurnId = turnId
      targetNodeId = activeWatchNodeId
      responseFormat = activeResponseFormat
      reasoningLevel = activeReasoningLevel
      targetSessionKey = activeTargetSessionKey.orEmpty()
      val chunkCount = audioChunks.size
      val maxIndex = audioChunks.keys.maxOrNull()
      // Contiguous means indices form 0..(count-1) with no hole below the max
      // received index. Reorders that fully filled in pass here; a real middle
      // drop leaves a hole and the max index exceeds count-1.
      val contiguous = maxIndex != null && maxIndex == chunkCount - 1
      capturedFrames =
        when {
          chunkCount == 0 -> {
            if (isCurrentTurn(counterTurnId)) {
              sendError("No audio recorded", watchTurnId)
            }
            // No transcribable audio: tear down and remember the id so a late
            // chunk for this turn cannot auto-start a fresh recording.
            tearDownTurn(watchTurnId)
            null
          }
          !contiguous -> {
            // A hole below the max index is a real dropped chunk; transcribing
            // the holey buffer would garble the turn, so fail it instead.
            if (isCurrentTurn(counterTurnId)) {
              sendError("audio dropped", watchTurnId)
            }
            Log.w(TAG, "audio dropped on turn=$watchTurnId (received $chunkCount chunks, maxIndex=$maxIndex)")
            tearDownTurn(watchTurnId)
            null
          }
          else ->
            // Assemble in ascending index order so reorders are corrected before STT.
            (0 until chunkCount).map { audioChunks.getValue(it) }.also { audioChunks.clear() }
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
          reasoningLevel = reasoningLevel,
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
    reasoningLevel: String,
    targetNodeId: String?,
    watchTurnId: String,
    counterTurnId: Long,
    isActiveSession: () -> Boolean,
  ): WearSttTtsSession =
    WearSttTtsSession(
      scope = scope,
      gateway = gateway,
      sessionKey = targetSessionKey,
      responseFormat = responseFormat,
      requestedReasoningLevel = reasoningLevel,
      onAudioResponse = { audioResponse ->
        val active = synchronized(turnStateLock) { isActiveSession() }
        if (active) {
          // Suspends until the send awaits Data Layer delivery. A throw here
          // propagates into the session so the turn fails and routes through
          // onError -> sendError (PATH_ERROR) instead of a swallowed log line.
          sendAudioResponse(audioResponse, watchTurnId, counterTurnId)
        }
      },
      onStatus = { status ->
        val active = synchronized(turnStateLock) { isActiveSession() }
        if (active) {
          sendStatus(status, watchTurnId)
        }
      },
      onError = { error ->
        val active = synchronized(turnStateLock) { isActiveSession() }
        if (active) {
          sendError(error, watchTurnId)
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
            activeReasoningLevel = WearReasoningLevel.DEFAULT
            // Remember the finished turn so a late/stale chunk for it cannot
            // auto-start a fresh gateway run.
            rememberCompletedTurnId(watchTurnId)
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
      // A null turnId is the lifecycle teardown path (disconnect/cancel()) and
      // force-cancels any active turn; a watch-initiated cancel must match strictly.
      val turnMatches = turnId == null || isActiveWatchTurn(turnId)
      if (!isActiveWatchNode(sourceNodeId) || !turnMatches) {
        Log.w(TAG, "ignoring cancel from non-active watch node")
        return
      }
      turnCounter.incrementAndGet()
      isRecording = false
      activeSession?.cancel()
      activeSession = null
      val cancelledTurnId = activeWatchTurnId
      activeWatchNodeId = null
      activeWatchTurnId = null
      activeTargetSessionKey = null
      activeReasoningLevel = WearReasoningLevel.DEFAULT
      audioChunks.clear()
      // A cancelled turn is finished; block a late chunk from reviving it.
      if (cancelledTurnId != null) rememberCompletedTurnId(cancelledTurnId)
    }
  }

  fun handleGatewayEvent(
    event: String,
    payloadJson: String?,
  ) {
    activeSession?.handleGatewayEvent(event, payloadJson)
  }

  fun disconnect() {
    cancel()
    synchronized(listenerRegistrationLock) {
      if (!listenerRegistered) return
      transport.removeListener(watchMessageListener)
      listenerRegistered = false
    }
  }

  // Shared stopRecording teardown for the no-audio and dropped-chunk branches:
  // free buffered chunks, remember the id so a late chunk cannot auto-start a
  // fresh recording, and release the active node/turn/session-key slot. Caller
  // holds turnStateLock and has already set isRecording = false.
  private fun tearDownTurn(turnId: String) {
    audioChunks.clear()
    rememberCompletedTurnId(turnId)
    activeWatchNodeId = null
    activeWatchTurnId = null
    activeTargetSessionKey = null
    activeReasoningLevel = WearReasoningLevel.DEFAULT
  }

  private fun isCurrentTurn(turnId: Long): Boolean = turnCounter.get() == turnId

  private fun completeActiveTurn(turnId: String?) {
    synchronized(turnStateLock) {
      if (turnId != null && activeWatchTurnId != turnId) return
      val completedTurnId = turnId ?: activeWatchTurnId
      activeSession = null
      activeWatchNodeId = null
      activeWatchTurnId = null
      activeTargetSessionKey = null
      activeReasoningLevel = WearReasoningLevel.DEFAULT
      // Block a late/stale chunk from auto-starting a fresh run for a turn that
      // already finished.
      if (completedTurnId != null) rememberCompletedTurnId(completedTurnId)
    }
  }

  private fun isActiveWatchNode(sourceNodeId: String?): Boolean {
    val activeNodeId = activeWatchNodeId ?: return true
    return sourceNodeId == null || sourceNodeId == activeNodeId
  }

  // Strict: an inbound turn must match the active turn exactly. Inbound turn ids
  // are always non-null (parseWatchMessagePath guarantees it), so there is no
  // wildcard match against a missing id.
  private fun isActiveWatchTurn(turnId: String): Boolean = turnId == activeWatchTurnId

  private fun isRecentCompletedTurnId(turnId: String): Boolean = recentCompletedTurnIdSet.contains(turnId)

  private fun rememberCompletedTurnId(turnId: String) {
    if (!recentCompletedTurnIdSet.add(turnId)) return
    recentCompletedTurnIds.addLast(turnId)
    while (recentCompletedTurnIds.size > RECENT_COMPLETED_TURN_IDS_LIMIT) {
      val removed = recentCompletedTurnIds.removeFirst()
      recentCompletedTurnIdSet.remove(removed)
    }
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

  // Prefer Ogg-Opus: smallest payload over the Wear Data Layer (stays under the ~90KB
  // message cap), watch-native decode, and the gateway passes ElevenLabs opus_48000_64
  // (verified Ogg-Opus) straight through without transcoding. Fall back to mp3, then PCM.
  private fun chooseResponseFormat(acceptedResponseFormats: List<String>): String =
    if (acceptedResponseFormats.contains(WearRelayProtocol.RESPONSE_FORMAT_OGG_OPUS)) {
      WearRelayProtocol.RESPONSE_FORMAT_OGG_OPUS
    } else if (acceptedResponseFormats.contains(WearRelayProtocol.RESPONSE_FORMAT_MP3)) {
      WearRelayProtocol.RESPONSE_FORMAT_MP3
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
    turnId: String,
  ) {
    val payload = json.encodeToString(WearRelayStatusPayload(state = "processing", message = message, turnId = turnId))
    sendMessage(WearRelayProtocol.PATH_STATUS, payload.toByteArray())
  }

  private fun sendError(
    message: String,
    turnId: String,
  ) {
    val payload = json.encodeToString(WearRelayErrorPayload(message = message, turnId = turnId))
    sendMessage(WearRelayProtocol.PATH_ERROR, payload.toByteArray())
  }

  // Single canonical delivery path: always chunk over the indexed
  // "<base>/<turnId>/<index>" + "/done" wire protocol (a small response is just
  // chunkCount == 1). Suspends until every send awaits Data Layer delivery, so
  // the caller (the session's completion path) treats the awaited return as the
  // delivery signal and a throw as a turn failure. No swallow-and-log here:
  // failures propagate so the watch is told via PATH_ERROR.
  private suspend fun sendAudioResponse(
    audioResponse: WearAudioResponse,
    turnId: String,
    counterTurnId: Long,
  ) {
    val audioBytes = audioResponse.audioBytes
    val format = audioResponse.format
    val maxChunkSize = WearRelayProtocol.MAX_MESSAGE_BYTES
    val targetNodeId = synchronized(turnStateLock) { activeWatchNodeId }
    val startedAtMs = SystemClock.elapsedRealtime()
    if (!isCurrentTurn(counterTurnId)) return
    val targetNodes = if (targetNodeId != null) listOf(targetNodeId) else transport.connectedNodeIds()
    if (targetNodes.isEmpty()) {
      // No reachable node means delivery cannot happen; fail the turn instead of
      // silently abandoning it so the session marks the turn errored.
      throw IllegalStateException("watch unreachable: no connected nodes")
    }
    val responseBasePath = WearRelayProtocol.turnPath(WearRelayProtocol.PATH_AUDIO_RESPONSE, turnId)
    Log.d(TAG, "audio response send start turn=$turnId format=$format bytes=${audioBytes.size} maxChunkBytes=$maxChunkSize")
    var offset = 0
    var chunkIndex = 0
    do {
      if (!isCurrentTurn(counterTurnId)) return
      val end = minOf(offset + maxChunkSize, audioBytes.size)
      sendToNodeIds(targetNodes, "$responseBasePath/$chunkIndex", audioBytes.copyOfRange(offset, end))
      offset = end
      chunkIndex++
      // Empty audio still emits one chunk so the watch sees chunkCount == 1.
    } while (offset < audioBytes.size)
    if (!isCurrentTurn(counterTurnId)) return
    sendToNodeIds(
      targetNodes,
      "$responseBasePath/done",
      json.encodeToString(WearRelayAudioDonePayload(chunkCount = chunkIndex, turnId = turnId, format = format)).toByteArray(),
    )
    sendToNodeIds(
      targetNodes,
      WearRelayProtocol.PATH_STATUS,
      json.encodeToString(WearRelayStatusPayload(state = "processing", message = "Response received", turnId = turnId)).toByteArray(),
    )
    Log.d(
      TAG,
      "audio response send done turn=$turnId format=$format bytes=${audioBytes.size} chunks=$chunkIndex elapsedMs=${SystemClock.elapsedRealtime() - startedAtMs}",
    )
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
