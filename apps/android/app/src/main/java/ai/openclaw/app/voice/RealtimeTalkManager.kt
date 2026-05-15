package ai.openclaw.app.voice

import ai.openclaw.app.gateway.GatewaySession
import android.content.Context
import android.os.SystemClock
import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.roundToInt

internal class RealtimeTalkManager(
  private val context: Context,
  private val scope: CoroutineScope,
  private val session: GatewaySession,
  private val isConnected: () -> Boolean,
  private val onStatus: (String) -> Unit,
  private val onListening: (Boolean) -> Unit,
  private val onSpeaking: (Boolean) -> Unit,
  private val onConsult: suspend (String?) -> String,
  private val onUnavailable: () -> Unit,
  private val recorder: RealtimeAudioCapture = RealtimeAudioRecorder(context = context, scope = scope),
  private val player: RealtimeAudioPlayback = RealtimeAudioPlayer(),
) {
  private companion object {
    private const val tag = "RealtimeTalk"
    private const val agentConsultToolName = "openclaw_agent_consult"
  }

  private val json = Json { ignoreUnknownKeys = true }
  private val jitterController = RealtimePlaybackJitterController()
  private var relaySessionId: String? = null
  private var startJob: Job? = null
  private var audioSendFailures = 0
  private var recorderStarted = false
  private val pendingPlaybackChunks = AtomicInteger(0)
  private var playbackGeneration = 0
  private val playbackEvents = Channel<PlaybackEvent>(Channel.UNLIMITED)

  @Volatile
  private var playbackOutputActive = false

  private var playbackDrainJob: Job? = null
  private var playbackDrainToken = 0
  private var lastSuppressedInputTraceAtMs = 0L

  init {
    scope.launch {
      for (event in playbackEvents) {
        handlePlaybackEvent(event)
      }
    }
  }

  fun start(
    config: RealtimeTalkConfig,
    sessionKey: String,
  ) {
    if (startJob != null) {
      Log.d(tag, "start ignored; already starting")
      return
    }
    startJob =
      scope.launch {
        try {
          Log.d(tag, "start provider=${config.provider}")
          if (!isConnected()) {
            onStatus("Gateway not connected")
            return@launch
          }
          onStatus("Connecting realtime voice…")
          Log.d(tag, "relay session request start")
          val relay = createRelaySession(config = config, sessionKey = sessionKey)
          Log.d(tag, "relay session request ok")
          relaySessionId = relay.relaySessionId
          audioSendFailures = 0
          recorderStarted = false
          onStatus("Realtime connecting…")
        } catch (err: CancellationException) {
          throw err
        } catch (err: Throwable) {
          Log.w(tag, "start failed: ${err.message ?: err::class.simpleName}")
          onStatus("Realtime unavailable")
          stop()
          onUnavailable()
        } finally {
          startJob = null
        }
      }
  }

  fun stop(notifyGateway: Boolean = true) {
    startJob?.cancel()
    startJob = null
    recorder.stop()
    player.stop()
    playbackDrainJob?.cancel()
    playbackDrainJob = null
    onListening(false)
    onSpeaking(false)
    recorderStarted = false
    playbackGeneration += 1
    playbackDrainToken += 1
    playbackOutputActive = false
    jitterController.reset()
    player.configureJitterBuffer(jitterController.currentTargets().prebufferMs)
    pendingPlaybackChunks.set(0)
    val id = relaySessionId
    relaySessionId = null
    audioSendFailures = 0
    if (notifyGateway && id != null) {
      scope.launch {
        runCatching {
          session.request(
            "talk.realtime.relayStop",
            buildJsonObject { put("relaySessionId", JsonPrimitive(id)) }.toString(),
            timeoutMs = 5_000,
          )
        }
      }
    }
  }

  fun handleRelayEvent(
    eventRelaySessionId: String,
    event: RealtimeTalkRelayEvent,
  ) {
    if (eventRelaySessionId != relaySessionId) {
      Log.d(tag, "ignore stale relay event type=${event::class.simpleName}")
      return
    }
    when (event) {
      RealtimeTalkRelayEvent.Ready -> {
        Log.d(tag, "relay ready")
        handleReady()
      }
      is RealtimeTalkRelayEvent.Audio -> {
        updatePlaybackJitter()
        enqueuePlaybackAudio(eventRelaySessionId, event.audioBase64)
      }
      RealtimeTalkRelayEvent.Clear -> {
        invalidatePlaybackForClear()
        if (playbackEvents.trySend(PlaybackEvent.Clear(eventRelaySessionId, playbackGeneration)).isFailure) {
          updateSpeakingAfterClear(eventRelaySessionId, playbackGeneration)
        }
      }
      RealtimeTalkRelayEvent.Mark ->
        playbackEvents.trySend(PlaybackEvent.Mark(eventRelaySessionId, playbackGeneration))
      is RealtimeTalkRelayEvent.Transcript -> {
        if (event.role == "user") {
          onStatus(if (event.final) "Thinking…" else "Listening: ${event.text}")
        }
      }
      is RealtimeTalkRelayEvent.ToolCall -> handleToolCall(eventRelaySessionId, event)
      is RealtimeTalkRelayEvent.Error -> {
        Log.w(tag, "relay error: ${event.message}")
        onStatus("Realtime failed")
        stop()
        onUnavailable()
      }
      is RealtimeTalkRelayEvent.Close -> {
        Log.d(tag, "relay close reason=${event.reason}")
        onStatus("Off")
        stop(notifyGateway = false)
        if (event.reason == "error") {
          onUnavailable()
        }
      }
    }
  }

  fun injectInputAudioBase64(audioBase64: String) {
    val id = relaySessionId
    if (id == null) {
      Log.w(tag, "debug audio injection ignored; no active relay session")
      return
    }
    scope.launch {
      sendAudioFrame(id, audioBase64)
    }
  }

  fun hasActiveRelaySession(): Boolean = relaySessionId != null

  fun sendUserMessage(text: String) {
    val id = relaySessionId
    if (id == null) {
      Log.w(tag, "debug text injection ignored; no active relay session")
      return
    }
    val message = text.trim()
    if (message.isEmpty()) {
      return
    }
    scope.launch {
      runCatching {
        session.request(
          "talk.realtime.relayUserMessage",
          buildJsonObject {
            put("relaySessionId", JsonPrimitive(id))
            put("text", JsonPrimitive(message))
          }.toString(),
          timeoutMs = 8_000,
        )
      }.onFailure { err ->
        if (relaySessionId == id) {
          Log.w(tag, "text relay failed: ${err.message ?: err::class.simpleName}")
        }
      }
    }
  }

  private suspend fun handlePlaybackEvent(event: PlaybackEvent) {
    if (relaySessionId != event.relaySessionId || playbackGeneration != event.generation) {
      return
    }
    when (event) {
      is PlaybackEvent.Audio -> {
        var wroteAudio = false
        try {
          runCatching { player.writeBase64(event.audioBase64) }
            .onSuccess { wroteAudio = true }
        } finally {
          if (wroteAudio) {
            schedulePlaybackDrain(event.relaySessionId, event.generation)
          }
          finishPlaybackChunk(event.relaySessionId, event.generation)
        }
      }
      is PlaybackEvent.Clear -> {
        runCatching { player.clear() }
          .onFailure { err -> Log.w(tag, "playback clear failed: ${err.message ?: err::class.simpleName}") }
        updateSpeakingAfterClear(event.relaySessionId, event.generation)
      }
      is PlaybackEvent.Mark ->
        runCatching { acknowledgeMarkAfterPlayback(event.relaySessionId, event.generation) }
          .onFailure { err -> Log.w(tag, "playback mark failed: ${err.message ?: err::class.simpleName}") }
    }
  }

  private fun finishPlaybackChunk(
    eventRelaySessionId: String,
    generation: Int,
  ) {
    if (relaySessionId != eventRelaySessionId || playbackGeneration != generation) return
    if (pendingPlaybackChunks.decrementAndGet() <= 0) {
      pendingPlaybackChunks.set(0)
    }
  }

  private fun updateSpeakingAfterClear(
    eventRelaySessionId: String,
    generation: Int,
  ) {
    if (relaySessionId != eventRelaySessionId || playbackGeneration != generation) return
    if (pendingPlaybackChunks.get() <= 0) {
      onSpeaking(false)
    }
  }

  private fun invalidatePlaybackForClear() {
    playbackGeneration += 1
    playbackDrainToken += 1
    playbackDrainJob?.cancel()
    playbackDrainJob = null
    playbackOutputActive = false
    jitterController.resetResponse()
    player.configureJitterBuffer(jitterController.currentTargets().prebufferMs)
    pendingPlaybackChunks.set(0)
  }

  private fun enqueuePlaybackAudio(
    eventRelaySessionId: String,
    audioBase64: String,
  ) {
    val generation = playbackGeneration
    pendingPlaybackChunks.incrementAndGet()
    playbackOutputActive = true
    onSpeaking(true)
    if (playbackEvents.trySend(PlaybackEvent.Audio(eventRelaySessionId, generation, audioBase64)).isFailure) {
      finishPlaybackChunk(eventRelaySessionId, generation)
    }
  }

  private fun schedulePlaybackDrain(
    eventRelaySessionId: String,
    generation: Int,
  ) {
    playbackDrainToken += 1
    val token = playbackDrainToken
    val drainIdleMs = jitterController.currentTargets().drainIdleMs
    playbackDrainJob?.cancel()
    playbackDrainJob =
      scope.launch {
        delay(drainIdleMs)
        player.waitUntilDrained()
        if (relaySessionId != eventRelaySessionId || playbackGeneration != generation || playbackDrainToken != token) {
          return@launch
        }
        if (pendingPlaybackChunks.get() <= 0) {
          playbackOutputActive = false
          onSpeaking(false)
        }
      }
  }

  private fun handleReady() {
    val id = relaySessionId ?: return
    if (recorderStarted) return
    scope.launch {
      try {
        Log.d(tag, "playback start")
        player.configureJitterBuffer(jitterController.currentTargets().prebufferMs)
        player.start()
        if (relaySessionId != id) {
          player.stop()
          return@launch
        }
        recorder.start { audioBase64 ->
          if (relaySessionId != id) return@start
          if (shouldSuppressInputAudioDuringPlayback()) return@start
          sendAudioFrame(id, audioBase64)
        }
        Log.d(tag, "recorder start")
        if (relaySessionId != id) {
          recorder.stop()
          player.stop()
          return@launch
        }
        recorderStarted = true
        onListening(true)
        onStatus("Listening")
      } catch (err: CancellationException) {
        throw err
      } catch (err: Throwable) {
        Log.w(tag, "ready failed: ${err.message ?: err::class.simpleName}")
        onStatus("Realtime unavailable")
        stop()
        onUnavailable()
      }
    }
  }

  private suspend fun createRelaySession(
    config: RealtimeTalkConfig,
    sessionKey: String,
  ): RealtimeTalkSessionResult {
    val response =
      session.request(
        "talk.realtime.session",
        buildJsonObject {
          put("sessionKey", JsonPrimitive(sessionKey.ifBlank { "main" }))
          put("provider", JsonPrimitive(config.provider))
          put("transport", JsonPrimitive("gateway-relay"))
          config.model?.let { put("model", JsonPrimitive(it)) }
          config.voice?.let { put("voice", JsonPrimitive(it)) }
        }.toString(),
        timeoutMs = 15_000,
      )
    val obj = json.parseToJsonElement(response).managerAsObjectOrNull() ?: throw IllegalStateException("Invalid realtime session response")
    val relaySessionId = obj["relaySessionId"].managerAsStringOrNull()?.trim().orEmpty()
    if (relaySessionId.isEmpty()) throw IllegalStateException("Missing realtime relay session")
    return RealtimeTalkSessionResult(relaySessionId = relaySessionId)
  }

  private suspend fun acknowledgeMarkAfterPlayback(
    id: String,
    generation: Int,
  ) {
    player.waitUntilDrained()
    if (relaySessionId != id || playbackGeneration != generation) return
    runCatching {
      session.request(
        "talk.realtime.relayMark",
        buildJsonObject { put("relaySessionId", JsonPrimitive(id)) }.toString(),
        timeoutMs = 5_000,
      )
    }
  }

  private fun updatePlaybackJitter() {
    val targets = jitterController.observeAudioChunk(SystemClock.elapsedRealtime())
    player.configureJitterBuffer(targets.prebufferMs)
    val observedGapMs = targets.observedGapMs ?: return
    RealtimeAudioTrace.recordEvent(
      "jitter-target",
      mapOf(
        "observedGapMs" to observedGapMs.toString(),
        "adaptiveGapMs" to targets.adaptiveGapMs.roundToInt().toString(),
        "prebufferMs" to targets.prebufferMs.toString(),
        "drainIdleMs" to targets.drainIdleMs.toString(),
      ),
    )
  }

  private suspend fun sendAudioFrame(
    relaySessionId: String,
    audioBase64: String,
  ) {
    runCatching {
      session.request(
        "talk.realtime.relayAudio",
        buildJsonObject {
          put("relaySessionId", JsonPrimitive(relaySessionId))
          put("audioBase64", JsonPrimitive(audioBase64))
        }.toString(),
        timeoutMs = 8_000,
      )
    }.onSuccess {
      if (this.relaySessionId != relaySessionId) return
      audioSendFailures = 0
    }.onFailure { err ->
      if (this.relaySessionId != relaySessionId) return
      audioSendFailures += 1
      Log.w(tag, "audio relay failed: ${err.message ?: err::class.simpleName}")
      if (audioSendFailures >= 3) {
        onStatus("Realtime failed")
        stop()
        onUnavailable()
      } else {
        onStatus("Realtime connection is slow")
      }
    }
  }

  private fun handleToolCall(
    eventRelaySessionId: String,
    event: RealtimeTalkRelayEvent.ToolCall,
  ) {
    if (event.name != agentConsultToolName) {
      submitToolResult(
        eventRelaySessionId,
        event.callId,
        JsonObject(mapOf("error" to JsonPrimitive("Tool \"${event.name}\" not available in Android Talk"))),
      )
      return
    }
    scope.launch {
      onStatus("Thinking…")
      val result =
        runCatching { onConsult(event.argumentsJson) }
          .fold(
            onSuccess = { JsonObject(mapOf("result" to JsonPrimitive(it))) },
            onFailure = { JsonObject(mapOf("error" to JsonPrimitive(it.message ?: "OpenClaw tool call failed"))) },
          )
      submitToolResult(eventRelaySessionId, event.callId, result)
      if (relaySessionId == eventRelaySessionId) {
        onStatus("Listening")
      }
    }
  }

  private fun submitToolResult(
    eventRelaySessionId: String,
    callId: String,
    result: JsonObject,
  ) {
    if (relaySessionId != eventRelaySessionId) return
    scope.launch {
      runCatching {
        session.request(
          "talk.realtime.relayToolResult",
          buildJsonObject {
            put("relaySessionId", JsonPrimitive(eventRelaySessionId))
            put("callId", JsonPrimitive(callId))
            put("result", result)
          }.toString(),
          timeoutMs = 10_000,
        )
      }
    }
  }

  private fun shouldSuppressInputAudioDuringPlayback(): Boolean {
    if (!playbackOutputActive && pendingPlaybackChunks.get() <= 0) {
      return false
    }
    val now = System.currentTimeMillis()
    if (now - lastSuppressedInputTraceAtMs >= 500) {
      lastSuppressedInputTraceAtMs = now
      RealtimeAudioTrace.recordEvent("drop-input-audio", mapOf("reason" to "playback-active"))
    }
    return true
  }
}

private data class RealtimeTalkSessionResult(
  val relaySessionId: String,
)

internal data class RealtimeJitterTargets(
  val prebufferMs: Int,
  val drainIdleMs: Long,
  val adaptiveGapMs: Double,
  val observedGapMs: Long? = null,
)

internal class RealtimePlaybackJitterController {
  private companion object {
    private const val initialPrebufferMs = 1_600
    private const val minPrebufferMs = 1_600
    private const val maxPrebufferMs = 2_400
    private const val minDrainIdleMs = 1_300L
    private const val maxDrainIdleMs = 2_800L
    private const val minObservedGapMs = 80L
    private const val maxObservedGapMs = 2_500L
    private const val decayWeight = 0.07
  }

  private var lastAudioAtMs: Long? = null
  private var adaptiveGapMs = initialAdaptiveGapMs()
  private var currentTargets =
    RealtimeJitterTargets(
      prebufferMs = initialPrebufferMs,
      drainIdleMs = targetsForGap(initialAdaptiveGapMs()).drainIdleMs,
      adaptiveGapMs = adaptiveGapMs,
    )

  fun currentTargets(): RealtimeJitterTargets = currentTargets.copy(observedGapMs = null)

  fun observeAudioChunk(nowMs: Long): RealtimeJitterTargets {
    val previousAudioAtMs = lastAudioAtMs
    lastAudioAtMs = nowMs
    val observedGapMs = previousAudioAtMs?.let { nowMs - it }
    if (observedGapMs == null || observedGapMs !in minObservedGapMs..maxObservedGapMs) {
      return currentTargets()
    }

    adaptiveGapMs =
      if (observedGapMs > adaptiveGapMs) {
        observedGapMs.toDouble()
      } else {
        adaptiveGapMs * (1.0 - decayWeight) + observedGapMs * decayWeight
      }
    currentTargets = targetsForGap(adaptiveGapMs).copy(observedGapMs = observedGapMs)
    return currentTargets
  }

  fun resetResponse() {
    lastAudioAtMs = null
  }

  fun reset() {
    lastAudioAtMs = null
    adaptiveGapMs = initialAdaptiveGapMs()
    currentTargets =
      RealtimeJitterTargets(
        prebufferMs = initialPrebufferMs,
        drainIdleMs = targetsForGap(adaptiveGapMs).drainIdleMs,
        adaptiveGapMs = adaptiveGapMs,
      )
  }

  private fun targetsForGap(gapMs: Double): RealtimeJitterTargets =
    RealtimeJitterTargets(
      prebufferMs = (gapMs * 1.2 + 400.0).roundToInt().coerceIn(minPrebufferMs, maxPrebufferMs),
      drainIdleMs = (gapMs * 1.15 + 150.0).roundToInt().toLong().coerceIn(minDrainIdleMs, maxDrainIdleMs),
      adaptiveGapMs = gapMs,
    )

  private fun initialAdaptiveGapMs(): Double = (initialPrebufferMs - 400.0) / 1.2
}

private sealed class PlaybackEvent(
  val relaySessionId: String,
  val generation: Int,
) {
  class Audio(
    relaySessionId: String,
    generation: Int,
    val audioBase64: String,
  ) : PlaybackEvent(relaySessionId, generation)

  class Clear(
    relaySessionId: String,
    generation: Int,
  ) : PlaybackEvent(relaySessionId, generation)

  class Mark(
    relaySessionId: String,
    generation: Int,
  ) : PlaybackEvent(relaySessionId, generation)
}

private fun JsonElement?.managerAsObjectOrNull(): JsonObject? = this as? JsonObject

private fun JsonElement?.managerAsStringOrNull(): String? = (this as? JsonPrimitive)?.contentOrNull
