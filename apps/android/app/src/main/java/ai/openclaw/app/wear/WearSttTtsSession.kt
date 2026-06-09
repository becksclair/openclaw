package ai.openclaw.app.wear

import ai.openclaw.app.gateway.GatewaySession
import ai.openclaw.app.voice.ChatEventText
import ai.openclaw.audio.AndroidCompressedAudioDecoder
import ai.openclaw.audio.PcmAudio
import android.util.Base64
import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/**
 * One-shot Wear push-to-talk turn that uses the stable STT -> chat -> TTS path.
 */
internal class WearSttTtsSession(
  private val scope: CoroutineScope,
  private val session: GatewaySession,
  private val sessionKey: String,
  private val responseFormat: String = RESPONSE_FORMAT_PCM_24K,
  private val onAudioResponse: (WearAudioResponse) -> Unit,
  private val onStatus: (String) -> Unit,
  private val onError: (String) -> Unit,
  private val onComplete: (WearSttTtsSession) -> Unit,
) {
  companion object {
    private const val TAG = "WearSttTtsSession"
    private const val INPUT_SAMPLE_RATE_HZ = 24_000
    private const val TRANSCRIPTION_SAMPLE_RATE_HZ = 8_000
    private const val MAX_APPEND_AUDIO_BYTES = 128 * 1024
    private const val TRANSCRIPTION_READY_TIMEOUT_MS = 8_000L
    private const val TRANSCRIPTION_TIMEOUT_MS = 25_000L
    private const val CHAT_TIMEOUT_MS = 120_000L
    private const val CHAT_HISTORY_FALLBACK_TIMEOUT_MS = 25_000L
    private const val SPEAK_TIMEOUT_MS = 120_000L
    private const val WATCH_OUTPUT_SAMPLE_RATE_HZ = 24_000
    const val RESPONSE_FORMAT_PCM_24K = "pcm_24000"
    const val RESPONSE_FORMAT_OGG_OPUS = "ogg_opus"
  }

  private val json = Json { ignoreUnknownKeys = true }

  @Volatile private var transcriptionSessionId: String? = null

  @Volatile private var pendingRunIdKeys: Set<String> = emptySet()

  @Volatile private var transcriptSignal: CompletableDeferred<String>? = null

  @Volatile private var chatFinalSignal: CompletableDeferred<String>? = null

  private val startLock = Any()

  @Volatile private var startJob: Job? = null

  // Single-closer guard: cancel() and the start job's finally block can race to
  // close the gateway transcription session. The first to flip this flag owns
  // the close call; the other side becomes a no-op.
  private val transcriptionClosing = AtomicBoolean(false)

  fun start(audioFrames: List<ByteArray>) {
    synchronized(startLock) {
      if (startJob != null) return
      startJob =
        scope.launch {
          var phase = "starting"
          var sttSessionId: String? = null
          var transcriptionClosed = false
          try {
            if (audioFrames.isEmpty()) {
              onError("No audio recorded")
              return@launch
            }
            phase = "creating transcription session"
            onStatus("Transcribing...")
            sttSessionId = createTranscriptionSession()
            transcriptionSessionId = sttSessionId
            // The gateway relay is ready to accept audio as soon as talk.session.create
            // returns successfully; the "ready" talk.event is informational only.
            Log.d(TAG, "transcription session created id=${sttSessionId.shortForLog()}")

            phase = "sending audio"
            val transcriptWaiter = CompletableDeferred<String>()
            transcriptSignal = transcriptWaiter
            val transcriptionAudio = withContext(Dispatchers.Default) { pcm24kFramesToPcmu8k(audioFrames) }
            Log.d(TAG, "sending transcription audio bytes=${transcriptionAudio.size}")
            sendTranscriptionAudio(sttSessionId, transcriptionAudio)

            phase = "closing transcription session"
            closeTranscriptionSession(sttSessionId)
            transcriptionClosed = true

            phase = "waiting for transcript"
            val transcript = withTimeout(TRANSCRIPTION_TIMEOUT_MS) { transcriptWaiter.await() }.trim()
            if (transcript.isEmpty()) {
              onError("No transcript received")
              return@launch
            }

            phase = "sending chat"
            onStatus("Thinking...")
            val chatWaiter = CompletableDeferred<String>()
            chatFinalSignal = chatWaiter
            val chatStartedAtSeconds = System.currentTimeMillis().toDouble() / 1_000.0
            val runId = sendChat(transcript)
            // sendChat already pre-registered the idempotency key as an acceptable runId;
            // narrow the acceptable set to the parsed gateway runId once we know it.
            // Both keys remain accepted here so a final event that fires between
            // chat.send returning and this line cannot be missed.
            pendingRunIdKeys = pendingRunIdKeys + runId
            Log.d(TAG, "chat.send ok runId=${runId.shortForLog()} transcriptChars=${transcript.length}")

            phase = "waiting for assistant"
            val assistantText =
              withTimeoutOrNull(CHAT_TIMEOUT_MS) { chatWaiter.await() }
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
                ?: run {
                  Log.w(TAG, "chat final missing text or timed out runId=${runId.shortForLog()}; attempting history fallback")
                  fetchLatestAssistantText(chatStartedAtSeconds, CHAT_HISTORY_FALLBACK_TIMEOUT_MS)?.trim()
                }.orEmpty()
            if (assistantText.isEmpty()) {
              onError("No assistant response received")
              return@launch
            }
            Log.d(TAG, "assistant text ok chars=${assistantText.length}")

            phase = "synthesizing speech"
            onStatus("Synthesizing speech...")
            val spokenAudio = speakAssistantText(assistantText)
            if (spokenAudio.audioBytes.isEmpty()) {
              onError("Talk speech returned empty audio")
              return@launch
            }
            onAudioResponse(spokenAudio)
          } catch (_: TimeoutCancellationException) {
            Log.w(TAG, "session timed out while $phase")
            onError("Voice failed: timed out while $phase")
          } catch (err: CancellationException) {
            throw err
          } catch (err: Throwable) {
            Log.w(TAG, "session failed while $phase: ${err.message}")
            onError("Voice failed: ${err.message}")
          } finally {
            synchronized(startLock) { startJob = null }
            transcriptionSessionId = null
            pendingRunIdKeys = emptySet()
            transcriptSignal = null
            chatFinalSignal = null
            transcriptionClosing.set(false)
            if (sttSessionId != null && !transcriptionClosed) {
              withContext(NonCancellable) {
                runCatching { closeTranscriptionSession(sttSessionId) }
              }
            }
            onComplete(this@WearSttTtsSession)
          }
        }
    }
  }

  fun handleGatewayEvent(
    event: String,
    payloadJson: String?,
  ) {
    when (event) {
      "talk.event" -> handleTranscriptionEvent(payloadJson)
      "chat" -> handleChatEvent(payloadJson)
    }
  }

  private fun handleTranscriptionEventReady() {
    // "ready" is informational; the relay buffers audio without it. Logged for diagnostics.
    Log.d(TAG, "transcription session ready event received id=${transcriptionSessionId?.shortForLog() ?: "-"}")
  }

  fun cancel() {
    val runIds = pendingRunIdKeys
    val chatSessionKey = sessionKey.ifBlank { "main" }
    synchronized(startLock) {
      startJob?.cancel()
      startJob = null
    }
    transcriptSignal?.cancel()
    chatFinalSignal?.cancel()
    transcriptSignal = null
    chatFinalSignal = null
    val sttSessionId = transcriptionSessionId
    transcriptionSessionId = null
    pendingRunIdKeys = emptySet()
    for (runId in runIds) {
      if (runId.isNotBlank()) {
        scope.launch { runCatching { abortChatRun(chatSessionKey, runId) } }
      }
    }
    if (sttSessionId != null) {
      scope.launch { runCatching { closeTranscriptionSession(sttSessionId) } }
    }
  }

  private suspend fun createTranscriptionSession(): String {
    val response =
      session.request(
        "talk.session.create",
        buildJsonObject {
          put("mode", JsonPrimitive("transcription"))
          put("transport", JsonPrimitive("gateway-relay"))
          put("brain", JsonPrimitive("none"))
          put("transcriptionMode", JsonPrimitive("buffered"))
        }.toString(),
        timeoutMs = 15_000,
      )
    val root = json.parseToJsonElement(response).asObjectOrNull() ?: throw IllegalStateException("Invalid transcription session response")
    val sessionId = root["transcriptionSessionId"].asStringOrNull() ?: root["sessionId"].asStringOrNull()
    if (sessionId.isNullOrBlank()) {
      throw IllegalStateException("Missing transcription session")
    }
    return sessionId
  }

  private suspend fun sendTranscriptionAudio(
    sessionId: String,
    audioBytes: ByteArray,
  ) {
    var offset = 0
    while (offset < audioBytes.size) {
      val end = minOf(offset + MAX_APPEND_AUDIO_BYTES, audioBytes.size)
      val chunk = audioBytes.copyOfRange(offset, end)
      session.request(
        "talk.session.appendAudio",
        buildJsonObject {
          put("sessionId", JsonPrimitive(sessionId))
          put("audioBase64", JsonPrimitive(Base64.encodeToString(chunk, Base64.NO_WRAP)))
        }.toString(),
        timeoutMs = 8_000,
      )
      offset = end
    }
  }

  private suspend fun closeTranscriptionSession(sessionId: String) {
    if (!transcriptionClosing.compareAndSet(false, true)) return
    try {
      session.request(
        "talk.session.close",
        buildJsonObject { put("sessionId", JsonPrimitive(sessionId)) }.toString(),
        timeoutMs = 5_000,
      )
    } catch (err: Throwable) {
      transcriptionClosing.set(false)
      throw err
    }
  }

  private suspend fun abortChatRun(
    chatSessionKey: String,
    runId: String,
  ) {
    session.request(
      "chat.abort",
      buildJsonObject {
        put("sessionKey", JsonPrimitive(chatSessionKey))
        put("runId", JsonPrimitive(runId))
      }.toString(),
      timeoutMs = 5_000,
    )
  }

  private suspend fun sendChat(transcript: String): String {
    val idempotencyKey = UUID.randomUUID().toString()
    // Pre-register the idempotency key as an acceptable runId BEFORE chat.send returns.
    // This closes the race where a fast chat "final" event arrives mid-request carrying
    // either the idempotency key or the parsed gateway runId; both will be accepted.
    pendingRunIdKeys = setOf(idempotencyKey)
    Log.d(TAG, "chat.send start sessionKey=${sessionKey.ifBlank { "main" }} chars=${transcript.length}")
    val response =
      session.request(
        "chat.send",
        buildJsonObject {
          put("sessionKey", JsonPrimitive(sessionKey.ifBlank { "main" }))
          put("message", JsonPrimitive(transcript))
          put("thinking", JsonPrimitive("low"))
          put("timeoutMs", JsonPrimitive(30_000))
          put("idempotencyKey", JsonPrimitive(idempotencyKey))
        }.toString(),
        timeoutMs = 15_000,
      )
    val parsedRunId = parseRunId(response) ?: idempotencyKey
    pendingRunIdKeys = setOf(idempotencyKey, parsedRunId)
    return parsedRunId
  }

  private suspend fun speakAssistantText(text: String): WearAudioResponse {
    val requestedFormat = if (responseFormat == RESPONSE_FORMAT_OGG_OPUS) "opus" else RESPONSE_FORMAT_PCM_24K
    val response =
      session.request(
        "talk.speak",
        buildJsonObject {
          put("text", JsonPrimitive(text))
          put("outputFormat", JsonPrimitive(requestedFormat))
        }.toString(),
        timeoutMs = SPEAK_TIMEOUT_MS,
      )
    val root = json.parseToJsonElement(response).asObjectOrNull() ?: throw IllegalStateException("Invalid talk.speak response")
    val audioBase64 = root["audioBase64"].asStringOrNull() ?: throw IllegalStateException("talk.speak returned no audio")
    val audioBytes = Base64.decode(audioBase64, Base64.NO_WRAP)
    val outputFormat = root["outputFormat"].asStringOrNull()
    val mimeType = root["mimeType"].asStringOrNull()
    val fileExtension = root["fileExtension"].asStringOrNull()
    Log.d(TAG, "talk.speak ok bytes=${audioBytes.size} format=${outputFormat ?: mimeType ?: fileExtension ?: "unknown"}")
    if (responseFormat == RESPONSE_FORMAT_OGG_OPUS && isOggOpusAudio(outputFormat, mimeType, fileExtension)) {
      return WearAudioResponse(audioBytes = audioBytes, format = RESPONSE_FORMAT_OGG_OPUS)
    }
    return WearAudioResponse(
      audioBytes = decodeTalkSpeakAudio(audioBytes, outputFormat, mimeType, fileExtension),
      format = RESPONSE_FORMAT_PCM_24K,
    )
  }

  private fun isOggOpusAudio(
    outputFormat: String?,
    mimeType: String?,
    fileExtension: String?,
  ): Boolean {
    val normalizedFormat = outputFormat?.trim()?.lowercase().orEmpty()
    val normalizedMime = mimeType?.trim()?.lowercase().orEmpty()
    val normalizedExtension = fileExtension?.trim()?.lowercase().orEmpty()
    return normalizedFormat == "opus" ||
      normalizedFormat.startsWith("opus_") ||
      normalizedExtension == ".opus" ||
      (normalizedMime == "audio/ogg" && normalizedFormat.contains("opus"))
  }

  private fun handleTranscriptionEvent(payloadJson: String?) {
    if (payloadJson.isNullOrBlank()) return
    val obj = runCatching { json.parseToJsonElement(payloadJson).asObjectOrNull() }.getOrNull() ?: return
    val sessionId = obj["transcriptionSessionId"].asStringOrNull() ?: obj["sessionId"].asStringOrNull()
    if (sessionId != transcriptionSessionId) return
    when (obj["type"].asStringOrNull()) {
      "ready" -> handleTranscriptionEventReady()
      "partial" -> {
        val text = obj["text"].asStringOrNull()?.trim().orEmpty()
        if (text.isNotEmpty()) onStatus("Heard: $text")
      }
      "transcript" -> {
        val text = obj["text"].asStringOrNull()?.trim().orEmpty()
        Log.d(TAG, "transcript event chars=${text.length}")
        if (text.isNotEmpty()) transcriptSignal?.safeComplete(text)
      }
      "close" -> {
        if (obj["reason"].asStringOrNull() == "error") {
          transcriptSignal?.safeCompleteExceptionally(IllegalStateException("transcription failed"))
        }
      }
      "error" -> {
        val message =
          obj["message"]
            .asStringOrNull()
            ?.trim()
            .orEmpty()
            .ifEmpty { "transcription failed" }
        transcriptSignal?.safeCompleteExceptionally(IllegalStateException(message))
      }
    }
  }

  private fun handleChatEvent(payloadJson: String?) {
    if (payloadJson.isNullOrBlank()) return
    val obj = runCatching { json.parseToJsonElement(payloadJson).asObjectOrNull() }.getOrNull() ?: return
    val acceptedRunIds = pendingRunIdKeys
    if (acceptedRunIds.isEmpty()) return
    val eventRunId = obj["runId"].asStringOrNull() ?: return
    if (eventRunId !in acceptedRunIds) {
      Log.d(TAG, "chat runId mismatch event=${eventRunId.shortForLog()} pending=${acceptedRunIds.size}")
      return
    }
    val state = obj["state"].asStringOrNull()
    Log.d(TAG, "chat event arrived runId=${eventRunId.shortForLog()} state=$state")
    when (state) {
      "final" -> {
        val text = ChatEventText.assistantTextFromPayload(obj)?.trim().orEmpty()
        chatFinalSignal?.safeComplete(text)
      }
      "error" -> {
        val message =
          obj["errorMessage"]
            .asStringOrNull()
            ?.trim()
            .orEmpty()
            .ifEmpty { "chat failed" }
        chatFinalSignal?.safeCompleteExceptionally(IllegalStateException(message))
      }
      "aborted" -> chatFinalSignal?.safeCompleteExceptionally(IllegalStateException("chat aborted"))
    }
  }

  private suspend fun fetchLatestAssistantText(
    sinceSeconds: Double,
    timeoutMs: Long,
  ): String? {
    val deadline = System.currentTimeMillis() + timeoutMs
    var delayMs = 300L
    while (System.currentTimeMillis() < deadline) {
      val text = fetchLatestAssistantText(sinceSeconds)
      if (!text.isNullOrBlank()) return text
      delay(delayMs)
      delayMs = (delayMs * 2).coerceAtMost(4_000L)
    }
    return null
  }

  private suspend fun fetchLatestAssistantText(sinceSeconds: Double): String? {
    val key = sessionKey.ifBlank { "main" }
    val response = session.request("chat.history", "{\"sessionKey\":\"$key\"}")
    val root = json.parseToJsonElement(response).asObjectOrNull() ?: return null
    val messages = root["messages"] as? JsonArray ?: return null
    for (item in messages.reversed()) {
      val obj = item.asObjectOrNull() ?: continue
      if (obj["role"].asStringOrNull() != "assistant") continue
      val timestamp = obj["timestamp"].asDoubleOrNull()
      if (timestamp != null && timestamp <= sinceSeconds) continue
      val content = obj["content"] as? JsonArray ?: continue
      val text =
        content
          .mapNotNull { entry ->
            entry
              .asObjectOrNull()
              ?.get("text")
              ?.asStringOrNull()
              ?.trim()
          }.filter { it.isNotEmpty() }
      if (text.isNotEmpty()) return text.joinToString("\n")
    }
    return null
  }

  private fun parseRunId(response: String): String? =
    runCatching {
      json
        .parseToJsonElement(response)
        .asObjectOrNull()
        ?.get("runId")
        .asStringOrNull()
    }.getOrNull()

  private fun pcm24kFramesToPcmu8k(frames: List<ByteArray>): ByteArray =
    PcmAudio.pcm16MonoFramesToPcmu(
      frames,
      inputSampleRateHz = INPUT_SAMPLE_RATE_HZ,
      targetSampleRateHz = TRANSCRIPTION_SAMPLE_RATE_HZ,
    )

  private suspend fun decodeTalkSpeakAudio(
    audioBytes: ByteArray,
    outputFormat: String?,
    mimeType: String?,
    fileExtension: String?,
  ): ByteArray {
    val normalizedFormat = outputFormat?.trim()?.lowercase().orEmpty()
    val normalizedMime = mimeType?.trim()?.lowercase().orEmpty()
    val normalizedExtension = fileExtension?.trim()?.lowercase().orEmpty()
    if (normalizedFormat == "pcm" || normalizedFormat == "pcm_24000") {
      return audioBytes
    }
    if (normalizedFormat == "wav" || normalizedFormat.endsWith("-wav") || normalizedExtension == ".wav") {
      return PcmAudio.extractPcm16MonoWav(audioBytes, expectedSampleRateHz = WATCH_OUTPUT_SAMPLE_RATE_HZ)
    }
    val compressedExtension =
      when {
        normalizedExtension.isNotEmpty() -> normalizedExtension
        normalizedMime == "audio/mpeg" || normalizedFormat == "mp3" || normalizedFormat.startsWith("mp3_") -> ".mp3"
        normalizedMime == "audio/ogg" || normalizedFormat == "opus" || normalizedFormat.startsWith("opus_") -> ".ogg"
        normalizedMime == "audio/webm" || normalizedFormat.endsWith("-webm") -> ".webm"
        else -> null
      }
    if (compressedExtension != null) {
      return decodeCompressedAudioToPcm24k(audioBytes, compressedExtension)
    }
    throw IllegalStateException("talk.speak returned unsupported audio format ${outputFormat ?: mimeType ?: fileExtension ?: "unknown"}")
  }

  private suspend fun decodeCompressedAudioToPcm24k(
    audioBytes: ByteArray,
    fileExtension: String,
  ): ByteArray =
    AndroidCompressedAudioDecoder
      .decodeToPcmMono(
        audioBytes = audioBytes,
        fileExtension = fileExtension,
        targetSampleRateHz = WATCH_OUTPUT_SAMPLE_RATE_HZ,
        tempFilePrefix = "wear-talk-speak-",
        errorContext = "talk.speak compressed audio",
      ).pcmMono

  private fun kotlinx.serialization.json.JsonElement?.asObjectOrNull(): JsonObject? = this as? JsonObject

  private fun kotlinx.serialization.json.JsonElement?.asStringOrNull(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content

  private fun kotlinx.serialization.json.JsonElement?.asDoubleOrNull(): Double? = (this as? JsonPrimitive)?.content?.toDoubleOrNull()

  private fun String.shortForLog(): String = if (length <= 8) this else take(8)

  private fun <T> CompletableDeferred<T>.safeCompleteExceptionally(error: Throwable) {
    runCatching { completeExceptionally(error) }
  }

  private fun <T> CompletableDeferred<T>.safeComplete(value: T) {
    runCatching { complete(value) }
  }
}

internal data class WearAudioResponse(
  val audioBytes: ByteArray,
  val format: String,
)
