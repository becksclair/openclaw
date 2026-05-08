package ai.openclaw.app.voice

import ai.openclaw.app.gateway.GatewaySession
import android.content.Context
import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import java.util.concurrent.atomic.AtomicInteger

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
  private var relaySessionId: String? = null
  private var startJob: Job? = null
  private var audioSendFailures = 0
  private var recorderStarted = false
  private val pendingPlaybackChunks = AtomicInteger(0)

  fun start(
    config: RealtimeTalkConfig,
    sessionKey: String,
  ) {
    if (startJob != null) return
    startJob =
      scope.launch {
        try {
          if (!isConnected()) {
            onStatus("Gateway not connected")
            return@launch
          }
          onStatus("Connecting realtime voice…")
          val relay = createRelaySession(config = config, sessionKey = sessionKey)
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
    onListening(false)
    onSpeaking(false)
    recorderStarted = false
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
    if (eventRelaySessionId != relaySessionId) return
    when (event) {
      RealtimeTalkRelayEvent.Ready -> handleReady()
      is RealtimeTalkRelayEvent.Audio -> {
        pendingPlaybackChunks.incrementAndGet()
        onSpeaking(true)
        scope.launch {
          try {
            if (relaySessionId != eventRelaySessionId) return@launch
            runCatching { player.writeBase64(event.audioBase64) }
          } finally {
            if (pendingPlaybackChunks.decrementAndGet() <= 0) {
              pendingPlaybackChunks.set(0)
              if (relaySessionId == eventRelaySessionId) {
                onSpeaking(false)
              }
            }
          }
        }
      }
      RealtimeTalkRelayEvent.Clear -> {
        pendingPlaybackChunks.set(0)
        scope.launch {
          if (relaySessionId != eventRelaySessionId) return@launch
          player.clear()
          onSpeaking(false)
        }
      }
      RealtimeTalkRelayEvent.Mark -> acknowledgeMarkAfterPlayback()
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
        onStatus("Off")
        stop(notifyGateway = false)
        if (event.reason == "error") {
          onUnavailable()
        }
      }
    }
  }

  private fun handleReady() {
    val id = relaySessionId ?: return
    if (recorderStarted) return
    scope.launch {
      try {
        player.start()
        if (relaySessionId != id) {
          player.stop()
          return@launch
        }
        recorder.start { audioBase64 ->
          if (relaySessionId != id) return@start
          sendAudioFrame(id, audioBase64)
        }
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

  private fun acknowledgeMarkAfterPlayback() {
    val id = relaySessionId ?: return
    scope.launch {
      waitForPlaybackIdle()
      if (relaySessionId != id) return@launch
      runCatching {
        session.request(
          "talk.realtime.relayMark",
          buildJsonObject { put("relaySessionId", JsonPrimitive(id)) }.toString(),
          timeoutMs = 5_000,
        )
      }
    }
  }

  private suspend fun waitForPlaybackIdle() {
    while (pendingPlaybackChunks.get() > 0) {
      delay(20)
    }
    player.waitUntilDrained()
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
}

private data class RealtimeTalkSessionResult(
  val relaySessionId: String,
)

private fun JsonElement?.managerAsObjectOrNull(): JsonObject? = this as? JsonObject

private fun JsonElement?.managerAsStringOrNull(): String? = (this as? JsonPrimitive)?.contentOrNull
