package ai.openclaw.app.voice

import android.Manifest
import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.abs
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject

internal class RealtimeVoiceManager(
  private val context: Context,
  private val scope: CoroutineScope,
  private val session: ai.openclaw.app.gateway.GatewaySession,
  private val resolveMainSessionKey: () -> String,
  private val json: Json = Json { ignoreUnknownKeys = true },
) : VoiceEngineController {
  companion object {
    private const val tag = "RealtimeVoice"
    private const val sampleRate = 16_000
    private const val channelCount = 1
    private const val bytesPerSample = 2
    private const val minRecordBufferBytes = 4096
    private const val maxConversationEntries = 40
    private const val playbackResumeDelayMs = 350L
  }

  private val audioPlayer = RealtimeAudioStreamPlayer()

  private val _micEnabled = kotlinx.coroutines.flow.MutableStateFlow(false)
  override val micEnabled = _micEnabled

  private val _micCooldown = kotlinx.coroutines.flow.MutableStateFlow(false)
  override val micCooldown = _micCooldown

  private val _isListening = kotlinx.coroutines.flow.MutableStateFlow(false)
  override val isListening = _isListening

  private val _statusText = kotlinx.coroutines.flow.MutableStateFlow("Mic off")
  override val statusText = _statusText

  private val _liveTranscript = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)
  override val liveTranscript = _liveTranscript

  private val _queuedMessages = kotlinx.coroutines.flow.MutableStateFlow<List<String>>(emptyList())
  override val queuedMessages = _queuedMessages

  private val _conversation = kotlinx.coroutines.flow.MutableStateFlow<List<VoiceConversationEntry>>(emptyList())
  override val conversation = _conversation

  private val _inputLevel = kotlinx.coroutines.flow.MutableStateFlow(0f)
  override val inputLevel = _inputLevel

  private val _isSending = kotlinx.coroutines.flow.MutableStateFlow(false)
  override val isSending = _isSending

  private var gatewayConnected = false
  private var realtimeSessionId: String? = null
  private var activeRecorder: AudioRecord? = null
  private var recordJob: Job? = null
  private var senderJob: Job? = null
  private var chunkChannel: Channel<ByteArray>? = null
  private val conversationEntriesByItemId = LinkedHashMap<String, String>()
  private var speakerEnabled = true
  private var assistantPlaybackPause = false
  private var playbackResumeJob: Job? = null
  private val streamingLock = Mutex()
  private val streamingGeneration = AtomicLong(0L)
  private val ttsPauseLock = Any()
  private var ttsPauseDepth = 0
  private var resumeMicAfterTts = false

  override fun setMicEnabled(enabled: Boolean) {
    if (_micEnabled.value == enabled) return
    _micEnabled.value = enabled
    if (enabled) {
      scope.launch {
        ensureSessionAndRecording()
      }
      return
    }
    scope.launch {
      stopRealtimeSession(reason = "mic disabled")
    }
  }

  override suspend fun pauseForTts() {
    val shouldPause =
      synchronized(ttsPauseLock) {
        ttsPauseDepth += 1
        if (ttsPauseDepth > 1) return@synchronized false
        resumeMicAfterTts = _micEnabled.value
        val active = resumeMicAfterTts || _isListening.value
        if (!active) return@synchronized false
        _isListening.value = false
        _inputLevel.value = 0f
        true
      }
    if (!shouldPause) return
    stopStreamingLoop()
    _statusText.value = "Speaking…"
  }

  override suspend fun resumeAfterTts() {
    val shouldResume =
      synchronized(ttsPauseLock) {
        if (ttsPauseDepth == 0) return@synchronized false
        ttsPauseDepth -= 1
        if (ttsPauseDepth > 0) return@synchronized false
        val resume = resumeMicAfterTts && _micEnabled.value
        resumeMicAfterTts = false
        resume
      }
    if (!shouldResume) return
    ensureSessionAndRecording()
  }

  override fun onGatewayConnectionChanged(connected: Boolean) {
    gatewayConnected = connected
    if (!connected) {
      playbackResumeJob?.cancel()
      playbackResumeJob = null
      assistantPlaybackPause = false
      val disconnectedGeneration = streamingGeneration.get()
      scope.launch {
        stopStreamingLoop(expectedGeneration = disconnectedGeneration)
      }
      realtimeSessionId = null
      conversationEntriesByItemId.clear()
      audioPlayer.stop()
      _isSending.value = false
      _isListening.value = false
      _inputLevel.value = 0f
      _liveTranscript.value = null
      _statusText.value = if (_micEnabled.value) "Live mode waiting for the gateway" else "Mic off"
      return
    }
    if (_micEnabled.value) {
      scope.launch {
        ensureSessionAndRecording()
      }
    }
  }

  override fun handleGatewayEvent(event: String, payloadJson: String?) {
    if (event != "realtime.session" || payloadJson.isNullOrBlank()) return
    val payload =
      try {
        json.parseToJsonElement(payloadJson).asObjectOrNull()
      } catch (_: Throwable) {
        null
      } ?: return

    val eventSessionId = payload["sessionId"].asStringOrNull() ?: return
    val currentSessionId = realtimeSessionId ?: return
    if (eventSessionId != currentSessionId) return

    when (payload["type"].asStringOrNull()) {
      "session.created" -> {
        _statusText.value = "Live session ready"
      }
      "session.state.changed" -> {
        when (payload["state"].asStringOrNull()) {
          "listening" -> {
            _isSending.value = false
            _statusText.value = "Listening live"
          }
          "thinking" -> {
            _isSending.value = true
            _statusText.value = "Thinking live…"
          }
          "speaking" -> {
            _isSending.value = true
            _statusText.value = if (speakerEnabled) "Playing live reply…" else "Live reply muted"
          }
          "idle" -> {
            _isSending.value = false
            _statusText.value = if (_micEnabled.value) "Waiting for you" else "Mic off"
          }
          "closed" -> {
            closeRemoteSession(reason = if (_micEnabled.value) "Live session ended" else "Mic off")
          }
        }
      }
      "transcript.updated" -> {
        val item = payload["item"].asObjectOrNull() ?: return
        handleTranscriptUpdate(item)
      }
      "assistant.turn.updated" -> {
        when (payload["turn"].asObjectOrNull()?.get("state").asStringOrNull()) {
          "thinking" -> {
            _isSending.value = true
            _statusText.value = "Thinking live…"
          }
          "speaking" -> {
            _isSending.value = true
            _statusText.value = if (speakerEnabled) "Playing live reply…" else "Live reply muted"
          }
          "completed", "interrupted", "idle" -> {
            _isSending.value = false
            scheduleResumeAfterPlayback()
          }
        }
      }
      "audio.output" -> {
        val audio = payload["audio"].asObjectOrNull() ?: return
        handleAudioOutput(audio)
      }
      "interrupt.acknowledged" -> {
        audioPlayer.stop()
        assistantPlaybackPause = false
        scheduleResumeAfterPlayback()
      }
      "fallback.changed" -> {
        _statusText.value = "Live mode fell back to text-first replies"
      }
      "session.error" -> {
        val message = payload["message"].asStringOrNull()?.trim().orEmpty()
        if (message.isNotEmpty()) {
          appendConversation(VoiceConversationRole.Assistant, message, isStreaming = false)
          _statusText.value = "Live session error"
        }
      }
      "transport.state.changed" -> {
        when (payload["state"].asStringOrNull()) {
          "signaling", "connecting" -> _statusText.value = "Starting live session…"
          "failed" -> _statusText.value = "Live connection failed"
          "closed" -> _statusText.value = if (_micEnabled.value) "Live connection closed" else "Mic off"
        }
      }
      "session.closed" -> {
        val reason = payload["reason"].asStringOrNull()?.trim().orEmpty()
        closeRemoteSession(reason = reason.ifEmpty { if (_micEnabled.value) "Live session ended" else "Mic off" })
      }
    }
  }

  private fun closeRemoteSession(reason: String) {
    playbackResumeJob?.cancel()
    playbackResumeJob = null
    realtimeSessionId = null
    conversationEntriesByItemId.clear()
    scope.launch {
      stopStreamingLoop()
    }
    audioPlayer.stop()
    assistantPlaybackPause = false
    _isSending.value = false
    _isListening.value = false
    _inputLevel.value = 0f
    _liveTranscript.value = null
    _statusText.value = reason
  }

  override fun setPlaybackEnabled(enabled: Boolean) {
    if (speakerEnabled == enabled) return
    speakerEnabled = enabled
    if (!enabled) {
      audioPlayer.stop()
      assistantPlaybackPause = false
      scheduleResumeAfterPlayback()
    }
  }

  override fun stopPlayback() {
    audioPlayer.stop()
    assistantPlaybackPause = false
    scheduleResumeAfterPlayback()
    val sessionId = realtimeSessionId ?: return
    scope.launch {
      runCatching {
        session.request(
          "realtime.session.interrupt",
          buildJsonObject {
            put("sessionId", JsonPrimitive(sessionId))
            put("target", JsonPrimitive("assistant"))
          }.toString(),
        )
      }
    }
  }

  private suspend fun ensureSessionAndRecording() {
    if (!_micEnabled.value) return
    if (!gatewayConnected) {
      _statusText.value = "Live mode waiting for the gateway"
      return
    }
    if (!hasMicPermission()) {
      _micEnabled.value = false
      _statusText.value = "Microphone permission required"
      return
    }
    if (realtimeSessionId == null) {
      _statusText.value = "Starting live session…"
      _isSending.value = true
      val created = createRealtimeSession()
      if (!created) {
        _isSending.value = false
        return
      }
    }
    if (ttsPauseDepth > 0 || assistantPlaybackPause) {
      _isListening.value = false
      _inputLevel.value = 0f
      return
    }
    startStreamingLoop()
    _isListening.value = true
    _isSending.value = false
    _statusText.value = "Listening live"
  }

  private suspend fun createRealtimeSession(): Boolean {
    return try {
      val payload =
        buildJsonObject {
          put("transport", JsonPrimitive("desktop"))
          put("fallbackEnabled", JsonPrimitive(true))
          put(
            "capabilities",
            buildJsonArray {
              add(JsonPrimitive("audioInput"))
            },
          )
          put("sessionKey", JsonPrimitive(resolveMainSessionKey()))
        }
      val response = session.requestDetailed("realtime.session.create", payload.toString(), timeoutMs = 20_000)
      if (!response.ok) {
        _statusText.value = response.error?.message ?: "Couldn't start live session"
        false
      } else {
        val root = response.payloadJson?.let { json.parseToJsonElement(it).asObjectOrNull() }
        val sessionId = root?.get("sessionId").asStringOrNull()?.trim().orEmpty()
        if (sessionId.isEmpty()) {
          _statusText.value = "Couldn't start live session"
          false
        } else {
          realtimeSessionId = sessionId
          conversationEntriesByItemId.clear()
          val mode = root?.get("mode").asStringOrNull()?.trim()
          _statusText.value = if (mode == "fallback") "Live mode fell back to text-first replies" else "Listening live"
          true
        }
      }
    } catch (err: Throwable) {
      _statusText.value = "Live mode unavailable: ${err.message ?: err::class.simpleName}"
      false
    }
  }

  private suspend fun startStreamingLoop() {
    streamingLock.withLock {
      if (recordJob?.isActive == true || senderJob?.isActive == true) return
      streamingGeneration.incrementAndGet()
      val chunkTarget = Channel<ByteArray>(capacity = Channel.UNLIMITED)
      chunkChannel = chunkTarget
      senderJob =
        scope.launch(Dispatchers.IO) {
          while (isActive) {
            val chunk = try {
              chunkTarget.receive()
            } catch (_: CancellationException) {
              break
            }
            val sessionId = realtimeSessionId ?: continue
            try {
              val payload =
                buildJsonObject {
                  put("sessionId", JsonPrimitive(sessionId))
                  put("audioBase64", JsonPrimitive(Base64.encodeToString(chunk, Base64.NO_WRAP)))
                  put("sampleRate", JsonPrimitive(sampleRate))
                  put("channels", JsonPrimitive(channelCount))
                }
              session.request("realtime.session.input.audio", payload.toString(), timeoutMs = 15_000)
            } catch (err: Throwable) {
              Log.w(tag, "audio chunk send failed: ${err.message ?: err::class.simpleName}")
              _statusText.value = "Live audio send failed"
            }
          }
        }
      recordJob =
        scope.launch(Dispatchers.IO) {
          runRecordLoop(chunkTarget)
        }
    }
  }

  private suspend fun stopStreamingLoop(expectedGeneration: Long? = null) {
    streamingLock.withLock {
      if (expectedGeneration != null && expectedGeneration != streamingGeneration.get()) return
      val currentRecordJob = recordJob
      recordJob = null
      currentRecordJob?.cancelAndJoin()
      releaseRecorder()
      val currentChannel = chunkChannel
      chunkChannel = null
      currentChannel?.close()
      val currentSenderJob = senderJob
      senderJob = null
      currentSenderJob?.cancelAndJoin()
      _isListening.value = false
      _inputLevel.value = 0f
    }
  }

  private suspend fun stopRealtimeSession(reason: String) {
    playbackResumeJob?.cancel()
    playbackResumeJob = null
    stopStreamingLoop()
    audioPlayer.stop()
    assistantPlaybackPause = false
    val sessionId = realtimeSessionId
    realtimeSessionId = null
    conversationEntriesByItemId.clear()
    if (sessionId != null && gatewayConnected) {
      runCatching {
        session.request(
          "realtime.session.close",
          buildJsonObject {
            put("sessionId", JsonPrimitive(sessionId))
            put("reason", JsonPrimitive(reason))
          }.toString(),
        )
      }
    }
    _isSending.value = false
    _liveTranscript.value = null
    _statusText.value = if (_micEnabled.value) "Waiting for you" else "Mic off"
  }

  private suspend fun runRecordLoop(chunkTarget: Channel<ByteArray>) {
    val minBufferSize =
      AudioRecord.getMinBufferSize(
        sampleRate,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
      )
    if (minBufferSize <= 0) {
      _statusText.value = "AudioRecord buffer unavailable"
      return
    }

    val readBuffer = ByteArray(maxOf(minBufferSize, minRecordBufferBytes))
    val record =
      AudioRecord(
        MediaRecorder.AudioSource.MIC,
        sampleRate,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        maxOf(minBufferSize, minRecordBufferBytes),
      )
    activeRecorder = record

    if (record.state != AudioRecord.STATE_INITIALIZED) {
      _statusText.value = "AudioRecord failed to initialize"
      releaseRecorder()
      return
    }

    try {
      record.startRecording()
      while (scope.isActive && _micEnabled.value && realtimeSessionId != null) {
        val bytesRead = record.read(readBuffer, 0, readBuffer.size)
        if (bytesRead <= 0) {
          delay(20)
          continue
        }
        _inputLevel.value = pcmLevel(readBuffer, bytesRead)
        chunkTarget.send(readBuffer.copyOf(bytesRead))
      }
    } finally {
      releaseRecorder()
      _inputLevel.value = 0f
    }
  }

  private fun releaseRecorder() {
    val record = activeRecorder ?: return
    activeRecorder = null
    runCatching { record.stop() }
    record.release()
  }

  private fun handleTranscriptUpdate(item: JsonObject) {
    val itemId = item["itemId"].asStringOrNull()?.trim().orEmpty()
    if (itemId.isEmpty()) return
    val text = item["text"].asStringOrNull().orEmpty()
    val role =
      when (item["role"].asStringOrNull()) {
        "assistant" -> VoiceConversationRole.Assistant
        else -> VoiceConversationRole.User
      }
    val isStreaming = item["status"].asStringOrNull() != "final"
    upsertConversation(itemId = itemId, role = role, text = text, isStreaming = isStreaming)
    if (role == VoiceConversationRole.User) {
      _liveTranscript.value = text.takeIf { isStreaming && it.isNotBlank() }
    }
  }

  private fun handleAudioOutput(audio: JsonObject) {
    val pcmBase64 = audio["pcm16Base64"].asStringOrNull()?.trim().orEmpty()
    if (pcmBase64.isEmpty()) return
    if (!speakerEnabled) return
    val sampleRate = audio["sampleRate"].asIntOrNull() ?: return
    val pcm = try {
      Base64.decode(pcmBase64, Base64.DEFAULT)
    } catch (_: Throwable) {
      return
    }
    pauseRecorderForPlayback()
    scope.launch {
      try {
        audioPlayer.enqueuePcm16(pcm, sampleRate)
      } catch (err: Throwable) {
        Log.w(tag, "audio playback failed: ${err.message ?: err::class.simpleName}")
      }
    }
  }

  private fun pauseRecorderForPlayback() {
    if (assistantPlaybackPause) return
    assistantPlaybackPause = true
    playbackResumeJob?.cancel()
    scope.launch {
      stopStreamingLoop()
      _statusText.value = "Speaking…"
    }
  }

  private fun scheduleResumeAfterPlayback() {
    if (!assistantPlaybackPause) {
      if (_micEnabled.value && gatewayConnected && ttsPauseDepth == 0) {
        _statusText.value = "Listening"
      }
      return
    }
    playbackResumeJob?.cancel()
    playbackResumeJob =
      scope.launch {
        delay(playbackResumeDelayMs)
        audioPlayer.stop()
        assistantPlaybackPause = false
        if (_micEnabled.value && gatewayConnected && ttsPauseDepth == 0) {
          ensureSessionAndRecording()
        }
      }
  }

  private fun appendConversation(
    role: VoiceConversationRole,
    text: String,
    isStreaming: Boolean,
  ): String {
    val id = UUID.randomUUID().toString()
    _conversation.value =
      (_conversation.value + VoiceConversationEntry(id = id, role = role, text = text, isStreaming = isStreaming))
        .takeLast(maxConversationEntries)
    return id
  }

  private fun updateConversationEntry(id: String, text: String, isStreaming: Boolean) {
    val current = _conversation.value
    if (current.isEmpty()) return
    val index = current.indexOfFirst { it.id == id }
    if (index < 0) return
    val entry = current[index]
    if (entry.text == text && entry.isStreaming == isStreaming) return
    val updated = current.toMutableList()
    updated[index] = entry.copy(text = text, isStreaming = isStreaming)
    _conversation.value = updated
  }

  private fun upsertConversation(
    itemId: String,
    role: VoiceConversationRole,
    text: String,
    isStreaming: Boolean,
  ) {
    val existingId = conversationEntriesByItemId[itemId]
    if (existingId == null) {
      conversationEntriesByItemId[itemId] = appendConversation(role = role, text = text, isStreaming = isStreaming)
      while (conversationEntriesByItemId.size > maxConversationEntries) {
        val oldest = conversationEntriesByItemId.entries.firstOrNull() ?: break
        conversationEntriesByItemId.remove(oldest.key)
      }
      return
    }
    updateConversationEntry(existingId, text, isStreaming)
  }

  private fun hasMicPermission(): Boolean {
    return (
      ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
        android.content.pm.PackageManager.PERMISSION_GRANTED
      )
  }

  private fun pcmLevel(buffer: ByteArray, length: Int): Float {
    if (length < 2) return 0f
    var total = 0.0
    var samples = 0
    var index = 0
    while (index + 1 < length) {
      val value =
        ((buffer[index + 1].toInt() shl 8) or (buffer[index].toInt() and 0xFF)).toShort().toInt()
      total += abs(value).toDouble()
      samples += 1
      index += 2
    }
    if (samples == 0) return 0f
    return ((total / samples.toDouble()) / Short.MAX_VALUE.toDouble()).toFloat().coerceIn(0f, 1f)
  }
}

private fun kotlinx.serialization.json.JsonElement?.asObjectOrNull(): JsonObject? =
  this as? JsonObject

private fun kotlinx.serialization.json.JsonElement?.asStringOrNull(): String? =
  (this as? JsonPrimitive)?.content

private fun kotlinx.serialization.json.JsonElement?.asIntOrNull(): Int? =
  (this as? JsonPrimitive)?.content?.toIntOrNull()
