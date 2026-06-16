package ai.openclaw.wear

import ai.openclaw.common.wear.WearRelayProtocol
import ai.openclaw.wear.audio.AudioCapture
import ai.openclaw.wear.audio.AudioEndpointDetector
import ai.openclaw.wear.audio.AudioEndpointEvent
import ai.openclaw.wear.audio.AudioEndpointReason
import ai.openclaw.wear.audio.AudioEndpointingConfig
import ai.openclaw.wear.audio.AudioPlayer
import ai.openclaw.wear.audio.CompressedAudioDecoder
import ai.openclaw.wear.audio.WearAudioCapture
import ai.openclaw.wear.client.PhoneRelayAudioResponse
import ai.openclaw.wear.client.PhoneRelayAudioStreamEvent
import ai.openclaw.wear.client.PhoneRelayClient
import ai.openclaw.wear.client.WearPhoneRelay
import ai.openclaw.wear.speech.AndroidSpeechDictation
import ai.openclaw.wear.speech.SpeechDictationEvent
import ai.openclaw.wear.speech.WatchSpeechDictation
import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicInteger

class WatchViewModel private constructor(
  app: Application,
  dependencies: Dependencies?,
) : AndroidViewModel(app) {
  constructor(app: Application) : this(app, null)

  internal constructor(
    app: Application,
    audioCapture: WearAudioCapture,
    relayClient: WearPhoneRelay,
  ) : this(app, Dependencies(audioCapture, relayClient, UnavailableSpeechDictation))

  internal constructor(
    app: Application,
    audioCapture: WearAudioCapture,
    relayClient: WearPhoneRelay,
    speechDictation: WatchSpeechDictation,
  ) : this(app, Dependencies(audioCapture, relayClient, speechDictation))

  companion object {
    private const val TAG = WatchApp.TAG
    private const val DEBUG_TURN_TAG = "OpenClawWearDebugTurn"
    private const val DEBUG_CHUNK_BYTES = AudioPlayer.SAMPLE_RATE * 2 / 5
    private const val DEBUG_PHONE_WAIT_ATTEMPTS = 20

    // Gentle boost applied to the final MP3 TTS file before it is played on the watch speaker.
    // Value chosen empirically: loud enough on watch speakers without clipping the 16-bit PCM range.
    private const val FINAL_MP3_AUDIO_GAIN = 1.2
    private const val PROCESSING_TURN_TIMEOUT_MS = 60_000L
    private val DEFAULT_ENDPOINTING_CONFIG = AudioEndpointingConfig()
    private val ALLOWED_DEBUG_STATES = setOf(WatchState.Idle, WatchState.CheckingPhone)
  }

  enum class WatchState {
    Idle,
    CheckingPhone,
    Recording,
    Processing,
    Playing,
    Error,
    ;

    val keepsScreenAwake: Boolean
      get() =
        when (this) {
          Recording,
          Processing,
          Playing,
          -> true

          Idle,
          CheckingPhone,
          Error,
          -> false
        }
  }

  private val _state = MutableStateFlow(WatchState.Idle)
  val state: StateFlow<WatchState> = _state

  private val _statusText = MutableStateFlow("Tap mic to speak")
  val statusText: StateFlow<String> = _statusText

  private val _hasMicPermission = MutableStateFlow(false)
  val hasMicPermission: StateFlow<Boolean> = _hasMicPermission

  private val audioCapture: WearAudioCapture = dependencies?.audioCapture ?: AudioCapture(app, viewModelScope)
  private val audioPlayer = AudioPlayer(app, viewModelScope)
  private val compressedAudioDecoder = CompressedAudioDecoder()
  private val relayClient: WearPhoneRelay = dependencies?.relayClient ?: PhoneRelayClient(app, viewModelScope)
  private val speechDictation: WatchSpeechDictation = dependencies?.speechDictation ?: AndroidSpeechDictation(app)
  // Uses android.util.Log directly; tests run under Robolectric where Log is a no-op.

  private var isRecording = false
  private var isDictating = false
  private var activeTurnId: String? = null
  private var processingWatchdogJob: Job? = null
  private val recordingLock = Any()

  // Debug turns are launched from the UI thread and can be cancelled from
  // onRetry() (which may run on a different dispatcher), and we read this
  // generation from background coroutines while comparing it to a local copy.
  // Atomic guarantees the increment is visible to subsequent reads.
  private val debugGeneration = AtomicInteger(0)

  init {
    viewModelScope.launch {
      relayClient.phoneConnected.collect { connected ->
        if (!connected) {
          if (_state.value != WatchState.Idle && _state.value != WatchState.Error) {
            failTurn("Phone disconnected")
          } else {
            _statusText.value = "Waiting for phone..."
          }
        } else {
          if (_state.value == WatchState.CheckingPhone || _state.value == WatchState.Idle) {
            transitionTo(WatchState.Idle, "Tap mic to speak")
          }
        }
      }
    }

    viewModelScope.launch {
      relayClient.statusUpdates.collect { status ->
        _statusText.value = status
      }
    }

    viewModelScope.launch {
      relayClient.audioResponses.collect { response ->
        if (_state.value == WatchState.Processing && isActiveTurnResponse(response.turnId) && response.audioBytes.isNotEmpty()) {
          if (response.format == WearRelayProtocol.RESPONSE_FORMAT_OGG_OPUS || response.format == WearRelayProtocol.RESPONSE_FORMAT_MP3) {
            playCompressedResponse(response)
          } else {
            activeTurnId = null
            playPcmResponse(response)
          }
        }
      }
    }

    viewModelScope.launch {
      relayClient.audioStreamEvents.collect { event ->
        when (event) {
          is PhoneRelayAudioStreamEvent.Chunk -> {
            if (!isActiveTurnResponse(event.turnId) || event.audioBytes.isEmpty()) return@collect
            // Streaming chunks are always PCM_24K under the current relay; format
            // negotiation has not landed (see PhoneRelayAudioStreamEvent.Chunk kdoc).
            if (_state.value == WatchState.Processing) {
              transitionTo(WatchState.Playing, "Playing response...")
              audioPlayer.startStream(
                onComplete = {
                  transitionTo(WatchState.Idle, "Tap mic to speak")
                },
                onError = {
                  failTurn("Audio playback unavailable")
                },
                debugTurnId = event.turnId,
              )
            }
            val appended = _state.value == WatchState.Playing && audioPlayer.appendStream(event.audioBytes)
            if (!appended && _state.value == WatchState.Playing) {
              failTurn("Audio playback unavailable")
            }
          }
          is PhoneRelayAudioStreamEvent.Done -> {
            if (!isActiveTurnResponse(event.turnId)) return@collect
            activeTurnId = null
            audioPlayer.finishStream()
          }
        }
      }
    }

    viewModelScope.launch {
      relayClient.errors.collect { error ->
        failTurn(error)
      }
    }
  }

  fun onPermissionGranted() {
    _hasMicPermission.value = true
    if (_state.value == WatchState.Error) {
      transitionTo(WatchState.Idle, "Tap mic to speak")
    }
  }

  fun onPermissionDenied() {
    _hasMicPermission.value = false
    _statusText.value = "Microphone permission required"
  }

  fun onMicButtonDown() {
    if (_state.value != WatchState.Idle) return
    if (!_hasMicPermission.value) {
      _statusText.value = "Microphone permission required"
      return
    }
    if (!relayClient.isPhoneConnected()) {
      _statusText.value = "Phone not connected"
      return
    }
    if (startDictationTurn()) return
    startRawAudioTurn()
  }

  private fun startDictationTurn(): Boolean {
    if (!speechDictation.isAvailable()) return false
    isDictating = true
    val started = speechDictation.start(::handleDictationEvent)
    if (!started) {
      isDictating = false
      return false
    }
    transitionTo(WatchState.Recording, "Listening...")
    return true
  }

  private fun startRawAudioTurn() {
    isRecording = true
    val turnId = relayClient.sendStartRecording()
    if (turnId == null) {
      isRecording = false
      transitionTo(WatchState.Idle, "Phone not connected")
      return
    }
    activeTurnId = turnId
    val captureStarted =
      audioCapture.start(
        turnId = turnId,
        onChunk = { chunk ->
          relayClient.sendAudioChunk(turnId, chunk)
        },
        endpointingConfig = DEFAULT_ENDPOINTING_CONFIG,
        onEndpoint = { endpoint ->
          viewModelScope.launch {
            completeStoppedRecording(turnId, RecordingCompletion.AutoEndpoint(endpoint))
          }
        },
      )
    if (!captureStarted) {
      failTurn("Microphone unavailable")
      return
    }
    transitionTo(WatchState.Recording, "Listening...")
  }

  fun onMicButtonUp() {
    if (isDictating) {
      speechDictation.stopListening()
      transitionTo(WatchState.Recording, "Processing speech...")
      return
    }
    val turnId = claimRecordingCompletion() ?: return
    audioCapture.stop {
      sendRecordingEnd(turnId, RecordingCompletion.Manual)
    }
  }

  fun onRetry() {
    isRecording = false
    isDictating = false
    activeTurnId = null
    debugGeneration.incrementAndGet()
    speechDictation.cancel()
    audioCapture.stop(discardPending = true)
    audioPlayer.stop()
    relayClient.sendCancel()
    transitionTo(
      WatchState.Idle,
      "Tap mic to speak",
    )
  }

  fun runDebugPcmTurn(pcmBytes: ByteArray) {
    runDebugPcmTurnInternal(pcmBytes, useEndpointing = false)
  }

  fun runDebugEndpointPcmTurn(pcmBytes: ByteArray) {
    runDebugPcmTurnInternal(pcmBytes, useEndpointing = true)
  }

  private fun runDebugPcmTurnInternal(
    pcmBytes: ByteArray,
    useEndpointing: Boolean,
  ) {
    if (!Log.isLoggable(DEBUG_TURN_TAG, Log.VERBOSE)) return
    val debugKind = if (useEndpointing) "debug endpoint pcm turn" else "debug pcm turn"
    if (pcmBytes.isEmpty()) {
      Log.w(DEBUG_TURN_TAG, "$debugKind ignored: empty input")
      return
    }
    if (_state.value != WatchState.Idle) {
      Log.w(DEBUG_TURN_TAG, "$debugKind ignored: state=${_state.value}")
      return
    }
    val generation = debugGeneration.incrementAndGet()
    Log.d(DEBUG_TURN_TAG, "starting $debugKind bytes=${pcmBytes.size}")
    viewModelScope.launch {
      var attempts = 0
      while (!relayClient.isPhoneConnected() && attempts < DEBUG_PHONE_WAIT_ATTEMPTS) {
        if (generation != debugGeneration.get() || _state.value !in ALLOWED_DEBUG_STATES) return@launch
        attempts++
        transitionTo(WatchState.CheckingPhone, "Checking phone...")
        delay(500)
      }
      if (generation != debugGeneration.get() || _state.value !in ALLOWED_DEBUG_STATES) return@launch
      if (!relayClient.isPhoneConnected()) {
        transitionTo(WatchState.Idle, "Phone not connected")
        Log.w(DEBUG_TURN_TAG, "$debugKind aborted: phone not connected")
        return@launch
      }
      val turnId =
        relayClient.sendStartRecording() ?: run {
          transitionTo(WatchState.Idle, "Phone not connected")
          Log.w(DEBUG_TURN_TAG, "$debugKind aborted: no relay phone node")
          return@launch
        }
      if (generation != debugGeneration.get() || _state.value !in ALLOWED_DEBUG_STATES) {
        relayClient.sendCancel()
        return@launch
      }
      activeTurnId = turnId
      isRecording = useEndpointing
      val status = if (useEndpointing) "Sending endpoint debug audio..." else "Sending debug audio..."
      transitionTo(WatchState.Recording, status)
      delay(200)
      val detector =
        if (useEndpointing) AudioEndpointDetector(AudioPlayer.SAMPLE_RATE, DEFAULT_ENDPOINTING_CONFIG) else null
      var offset = 0
      while (offset < pcmBytes.size && activeTurnId == turnId) {
        val end = minOf(offset + DEBUG_CHUNK_BYTES, pcmBytes.size)
        val chunk = pcmBytes.copyOfRange(offset, end)
        relayClient.sendAudioChunk(turnId, chunk)
        offset = end
        val event = detector?.process(chunk)
        if (event is AudioEndpointEvent.Endpoint) {
          completeStoppedRecording(turnId, RecordingCompletion.AutoEndpoint(event))
          Log.d(DEBUG_TURN_TAG, "$debugKind auto-ended bytesSent=$offset inputBytes=${pcmBytes.size}")
          return@launch
        }
        delay(20)
      }
      val finishEndpoint = detector?.finish()
      if (finishEndpoint != null && activeTurnId == turnId) {
        completeStoppedRecording(turnId, RecordingCompletion.AutoEndpoint(finishEndpoint))
        Log.d(DEBUG_TURN_TAG, "$debugKind finished bytesSent=$offset inputBytes=${pcmBytes.size}")
      } else if (activeTurnId == turnId) {
        if (useEndpointing) {
          failTurn("Endpoint not detected")
          Log.w(DEBUG_TURN_TAG, "$debugKind failed: endpoint not detected")
        } else {
          relayClient.sendEndRecording(turnId)
          transitionToProcessing("Processing...")
          Log.d(DEBUG_TURN_TAG, "$debugKind sent bytes=${pcmBytes.size}")
        }
      }
    }
  }

  fun runDebugPcmPlayback(
    pcmBytes: ByteArray,
    debugRunId: String?,
  ) {
    if (!Log.isLoggable(DEBUG_TURN_TAG, Log.VERBOSE)) return
    if (pcmBytes.isEmpty() || _state.value != WatchState.Idle) return
    Log.d(DEBUG_TURN_TAG, "starting debug pcm playback bytes=${pcmBytes.size}")
    transitionTo(WatchState.Playing, "Playing debug audio...")
    audioPlayer.play(
      pcmBytes,
      onComplete = {
        transitionTo(WatchState.Idle, "Tap mic to speak")
      },
      onError = {
        failTurn("Audio playback unavailable")
      },
      debugTurnId = debugRunId?.takeIf { it.isNotBlank() } ?: "direct-playback",
    )
  }

  fun runDebugCompressedPlayback(
    audioBytes: ByteArray,
    fileExtension: String,
    debugRunId: String?,
  ) {
    if (!Log.isLoggable(DEBUG_TURN_TAG, Log.VERBOSE)) return
    if (audioBytes.isEmpty() || _state.value != WatchState.Idle) return
    val generation = debugGeneration.incrementAndGet()
    val turnId = debugRunId?.takeIf { it.isNotBlank() } ?: "direct-compressed-playback"
    Log.d(DEBUG_TURN_TAG, "starting debug compressed playback bytes=${audioBytes.size} extension=$fileExtension")
    transitionTo(WatchState.Processing, "Decoding debug audio...")
    viewModelScope.launch {
      val startedAtMs = System.currentTimeMillis()
      val decoded =
        try {
          compressedAudioDecoder.decodeToPcm48kMono(audioBytes, fileExtension)
        } catch (err: Throwable) {
          Log.w(DEBUG_TURN_TAG, "debug compressed decode failed: ${err.message}")
          failTurn("Audio decode unavailable")
          return@launch
        }
      if (generation != debugGeneration.get() || _state.value != WatchState.Processing) return@launch
      val decodeMs = System.currentTimeMillis() - startedAtMs
      Log.d(
        DEBUG_TURN_TAG,
        "debug compressed decoded inputBytes=${audioBytes.size} pcmBytes=${decoded.pcm48kMono.size} sourceRate=${decoded.sourceSampleRateHz} sourceChannels=${decoded.sourceChannels} decodeMs=$decodeMs",
      )
      transitionTo(WatchState.Playing, "Playing debug audio...")
      audioPlayer.playPcm48k(
        decoded.pcm48kMono,
        onComplete = {
          transitionTo(WatchState.Idle, "Tap mic to speak")
        },
        onError = {
          failTurn("Audio playback unavailable")
        },
        debugTurnId = turnId,
      )
    }
  }

  private fun playPcmResponse(response: PhoneRelayAudioResponse) {
    transitionTo(WatchState.Playing, "Playing response...")
    audioPlayer.play(
      response.audioBytes,
      onComplete = {
        transitionTo(WatchState.Idle, "Tap mic to speak")
      },
      onError = {
        failTurn("Audio playback unavailable")
      },
      debugTurnId = response.turnId,
    )
  }

  private fun playCompressedResponse(response: PhoneRelayAudioResponse) {
    transitionTo(WatchState.Processing, "Decoding response...")
    // Response has arrived; the no-response watchdog must not fire during decode.
    processingWatchdogJob?.cancel()
    processingWatchdogJob = null
    viewModelScope.launch {
      val startedAtMs = System.currentTimeMillis()
      val extension =
        when (response.format) {
          WearRelayProtocol.RESPONSE_FORMAT_MP3 -> ".mp3"
          else -> ".opus"
        }
      val volumeGain =
        when (response.format) {
          WearRelayProtocol.RESPONSE_FORMAT_MP3 -> FINAL_MP3_AUDIO_GAIN
          else -> 1.0
        }
      val decoded =
        try {
          compressedAudioDecoder.decodeToPcm48kMono(response.audioBytes, extension, volumeGain)
        } catch (err: Throwable) {
          Log.w(DEBUG_TURN_TAG, "response decode failed: ${err.message}")
          if (!isActiveTurnResponse(response.turnId) || _state.value != WatchState.Processing) return@launch
          failTurn("Audio decode unavailable")
          return@launch
        }
      if (!isActiveTurnResponse(response.turnId) || _state.value != WatchState.Processing) return@launch
      activeTurnId = null
      val decodeMs = System.currentTimeMillis() - startedAtMs
      Log.d(
        DEBUG_TURN_TAG,
        "response decoded format=${response.format} inputBytes=${response.audioBytes.size} pcmBytes=${decoded.pcm48kMono.size} sourceRate=${decoded.sourceSampleRateHz} sourceChannels=${decoded.sourceChannels} decodeMs=$decodeMs",
      )
      transitionTo(WatchState.Playing, "Playing response...")
      audioPlayer.playPcm48k(
        decoded.pcm48kMono,
        onComplete = {
          transitionTo(WatchState.Idle, "Tap mic to speak")
        },
        onError = {
          failTurn("Audio playback unavailable")
        },
        debugTurnId = response.turnId,
      )
    }
  }

  private fun transitionTo(
    newState: WatchState,
    message: String,
  ) {
    if (newState != WatchState.Processing) {
      processingWatchdogJob?.cancel()
      processingWatchdogJob = null
    }
    _state.value = newState
    _statusText.value = message
    Log.d(TAG, "state=$newState msg=$message")
  }

  private fun transitionToProcessing(message: String) {
    transitionTo(WatchState.Processing, message)
    armProcessingWatchdog()
  }

  private fun armProcessingWatchdog() {
    val turnId = activeTurnId ?: return
    processingWatchdogJob?.cancel()
    processingWatchdogJob =
      viewModelScope.launch {
        delay(PROCESSING_TURN_TIMEOUT_MS)
        if (_state.value == WatchState.Processing && activeTurnId == turnId) {
          Log.w(TAG, "processing watchdog timed out turnId=$turnId")
          failTurn("Voice failed: response timed out")
        }
      }
  }

  private fun failTurn(message: String) {
    isRecording = false
    isDictating = false
    activeTurnId = null
    speechDictation.cancel()
    audioCapture.stop(discardPending = true)
    audioPlayer.stop()
    relayClient.sendCancel()
    transitionTo(WatchState.Error, message)
  }

  private fun isActiveTurnResponse(turnId: String?): Boolean {
    val active = activeTurnId ?: return false
    return turnId == null || turnId == active
  }

  override fun onCleared() {
    super.onCleared()
    speechDictation.destroy()
    audioCapture.stop(discardPending = true)
    audioPlayer.stop()
    activeTurnId = null
    processingWatchdogJob?.cancel()
    processingWatchdogJob = null
    relayClient.disconnect()
  }

  private fun completeStoppedRecording(
    turnId: String?,
    completion: RecordingCompletion,
  ) {
    if (claimRecordingCompletion(turnId) == null) return
    sendRecordingEnd(turnId, completion)
  }

  private fun claimRecordingCompletion(expectedTurnId: String? = activeTurnId): String? =
    synchronized(recordingLock) {
      val turnId = activeTurnId
      if (!isRecording || turnId == null || expectedTurnId != turnId) return@synchronized null
      isRecording = false
      turnId
    }

  private fun sendRecordingEnd(
    turnId: String?,
    completion: RecordingCompletion,
  ) {
    when (completion) {
      RecordingCompletion.Manual ->
        Log.d(DEBUG_TURN_TAG, "recording completion source=manual turnId=$turnId")
      is RecordingCompletion.AutoEndpoint ->
        Log.d(
          DEBUG_TURN_TAG,
          "recording completion source=endpoint turnId=$turnId reason=${completion.endpoint.reason} totalMs=${completion.endpoint.totalAudioMs} speechMs=${completion.endpoint.speechMs} trailingSilenceMs=${completion.endpoint.trailingSilenceMs}",
        )
    }
    if (completion is RecordingCompletion.AutoEndpoint && completion.endpoint.reason == AudioEndpointReason.NoSpeech) {
      relayClient.sendCancel()
      activeTurnId = null
      transitionTo(WatchState.Idle, "Tap mic to speak")
      return
    }
    relayClient.sendEndRecording(turnId)
    if (activeTurnId == turnId) {
      transitionToProcessing("Processing...")
    }
  }

  private fun handleDictationEvent(event: SpeechDictationEvent) {
    if (!isDictating) return
    when (event) {
      SpeechDictationEvent.Listening ->
        transitionTo(WatchState.Recording, "Listening...")
      SpeechDictationEvent.SpeechStarted ->
        transitionTo(WatchState.Recording, "Listening...")
      SpeechDictationEvent.SpeechEnded ->
        transitionTo(WatchState.Recording, "Processing speech...")
      is SpeechDictationEvent.PartialTranscript -> {
        val text = event.text.trim()
        if (text.isNotEmpty()) {
          _statusText.value = "Heard: $text"
        }
      }
      is SpeechDictationEvent.FinalTranscript -> {
        val text = event.text.trim()
        isDictating = false
        speechDictation.destroy()
        if (text.isEmpty()) {
          showRecoverableDictationError("No speech recognized")
          return
        }
        val turnId = relayClient.sendTextTurn(text)
        if (turnId == null) {
          transitionTo(WatchState.Idle, "Phone not connected")
          return
        }
        activeTurnId = turnId
        transitionToProcessing("Processing...")
      }
      is SpeechDictationEvent.Error -> {
        isDictating = false
        speechDictation.destroy()
        showRecoverableDictationError(event.message)
      }
    }
  }

  private fun showRecoverableDictationError(message: String) {
    transitionTo(WatchState.Error, message)
    viewModelScope.launch {
      delay(1_200)
      if (!isDictating && activeTurnId == null && _state.value == WatchState.Error) {
        transitionTo(WatchState.Idle, "Tap mic to speak")
      }
    }
  }

  private sealed class RecordingCompletion {
    data object Manual : RecordingCompletion()

    data class AutoEndpoint(
      val endpoint: AudioEndpointEvent.Endpoint,
    ) : RecordingCompletion()
  }

  private data class Dependencies(
    val audioCapture: WearAudioCapture,
    val relayClient: WearPhoneRelay,
    val speechDictation: WatchSpeechDictation,
  )
}

private object UnavailableSpeechDictation : WatchSpeechDictation {
  override fun isAvailable(): Boolean = false

  override fun start(onEvent: (SpeechDictationEvent) -> Unit): Boolean = false

  override fun stopListening() {}

  override fun cancel() {}

  override fun destroy() {}
}
