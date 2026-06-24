package ai.openclaw.wear

import ai.openclaw.audio.PcmAudio
import ai.openclaw.common.wear.WearReasoningLevel
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
import ai.openclaw.wear.client.PhoneRelayClient
import ai.openclaw.wear.client.WearPhoneRelay
import ai.openclaw.wear.speech.AndroidSpeechDictation
import ai.openclaw.wear.speech.DictationErrorKind
import ai.openclaw.wear.speech.SpeechDictationEvent
import ai.openclaw.wear.speech.WatchSpeechDictation
import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import android.media.AudioManager
import android.os.Build
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.atomic.AtomicInteger
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

internal const val DEFAULT_FINAL_TTS_PLAYBACK_GAIN = 1.5
internal const val MIN_TTS_PLAYBACK_GAIN = 0.5
internal const val MAX_TTS_PLAYBACK_GAIN = 4.0
internal const val TTS_PLAYBACK_GAIN_STEP = 0.1
internal const val ROTARY_CONTROL_MODE_MEDIA_VOLUME = "media_volume"
internal const val ROTARY_CONTROL_MODE_TTS_GAIN = "tts_gain"

internal fun applyFinalTtsPlaybackGain(
  pcm: ByteArray,
  gain: Double,
): ByteArray = PcmAudio.applyPcm16VolumeGain(pcm, gain)

internal fun clampTtsPlaybackGain(gain: Double): Double =
  gain
    .takeIf { it.isFinite() }
    ?.coerceIn(MIN_TTS_PLAYBACK_GAIN, MAX_TTS_PLAYBACK_GAIN)
    ?: DEFAULT_FINAL_TTS_PLAYBACK_GAIN

internal fun adjustTtsPlaybackGain(
  gain: Double,
  steps: Int,
): Double {
  val stepped = ((gain + steps * TTS_PLAYBACK_GAIN_STEP) * 10.0).roundToInt() / 10.0
  return clampTtsPlaybackGain(stepped)
}

internal fun peakAbsPcm16(pcm: ByteArray): Int {
  var peak = 0
  val sampleBytes = pcm.size - (pcm.size % 2)
  for (offset in 0 until sampleBytes step 2) {
    peak = maxOf(peak, abs(PcmAudio.readPcm16Sample(pcm, offset).toLong()).coerceAtMost(Short.MAX_VALUE.toLong()).toInt())
  }
  return peak
}

data class VolumeOverlayState(
  val visible: Boolean = false,
  val title: String = "",
  val value: String = "",
  val detail: String = "",
)

internal data class MediaVolumeState(
  val min: Int,
  val current: Int,
  val max: Int,
) {
  val percent: Int
    get() {
      val range = max - min
      if (range <= 0) return 0
      return (((current - min).toDouble() / range) * 100.0).roundToInt().coerceIn(0, 100)
    }
}

internal interface MediaVolumeController {
  fun readState(): MediaVolumeState?

  fun adjustBy(steps: Int): MediaVolumeState?
}

private class AndroidMediaVolumeController(context: Context) : MediaVolumeController {
  private val context = context

  private fun audioManager(): AudioManager? =
    runCatching { context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager }.getOrNull()

  override fun readState(): MediaVolumeState? {
    val manager = audioManager() ?: return null
    if (manager.isVolumeFixed) return null
    val max = manager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
    val min = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) manager.getStreamMinVolume(AudioManager.STREAM_MUSIC) else 0
    val current = manager.getStreamVolume(AudioManager.STREAM_MUSIC).coerceIn(min, max)
    if (max <= min) return null
    return MediaVolumeState(min = min, current = current, max = max)
  }

  override fun adjustBy(steps: Int): MediaVolumeState? {
    val manager = audioManager() ?: return null
    val state = readState() ?: return null
    val target = (state.current + steps).coerceIn(state.min, state.max)
    manager.setStreamVolume(AudioManager.STREAM_MUSIC, target, 0)
    return readState() ?: state.copy(current = target)
  }
}

internal interface WatchAudioPlayback {
  fun play(
    pcmBytes: ByteArray,
    onComplete: () -> Unit,
    onError: () -> Unit = onComplete,
    debugTurnId: String? = null,
  )

  fun playPcm48k(
    pcmBytes: ByteArray,
    onComplete: () -> Unit,
    onError: () -> Unit = onComplete,
    debugTurnId: String? = null,
  )

  fun stop()
}

private class AudioPlayerPlayback(
  context: Context,
  scope: kotlinx.coroutines.CoroutineScope,
) : WatchAudioPlayback {
  private val player = AudioPlayer(context, scope)

  override fun play(
    pcmBytes: ByteArray,
    onComplete: () -> Unit,
    onError: () -> Unit,
    debugTurnId: String?,
  ) = player.play(pcmBytes, onComplete = onComplete, onError = onError, debugTurnId = debugTurnId)

  override fun playPcm48k(
    pcmBytes: ByteArray,
    onComplete: () -> Unit,
    onError: () -> Unit,
    debugTurnId: String?,
  ) = player.playPcm48k(pcmBytes, onComplete = onComplete, onError = onError, debugTurnId = debugTurnId)

  override fun stop() = player.stop()
}

internal class RotaryStepAccumulator(
  private val pixelsPerStep: Float = 48f,
  private val maxStepsPerEvent: Int = 3,
) {
  private var remainder = 0f

  fun consume(verticalScrollPixels: Float): Int {
    remainder += verticalScrollPixels
    val rawSteps = (remainder / pixelsPerStep).toInt()
    if (rawSteps == 0) return 0
    val steps = rawSteps.coerceIn(-maxStepsPerEvent, maxStepsPerEvent)
    remainder -= steps * pixelsPerStep
    return steps
  }

  fun reset() {
    remainder = 0f
  }
}

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

  internal constructor(
    app: Application,
    audioCapture: WearAudioCapture,
    relayClient: WearPhoneRelay,
    speechDictation: WatchSpeechDictation,
    audioPlayer: WatchAudioPlayback,
    mediaVolumeController: MediaVolumeController,
  ) : this(app, Dependencies(audioCapture, relayClient, speechDictation, audioPlayer, mediaVolumeController))

  companion object {
    private const val TAG = WatchApp.TAG
    private const val DEBUG_TURN_TAG = "OpenClawWearDebugTurn"
    private const val DEBUG_CHUNK_BYTES = AudioPlayer.SAMPLE_RATE * 2 / 5
    private const val PHONE_CONNECTION_WAIT_TIMEOUT_MS = 10_000L
    private const val DEBUG_PHONE_CONNECTION_POLL_INTERVAL_MS = 500L

    // Boost final TTS PCM at the watch playback boundary so provider artifacts
    // stay unchanged on the wire while the watch speaker gets local loudness
    // compensation across PCM, MP3, and Ogg/Opus responses.
    private const val PROCESSING_TURN_TIMEOUT_MS = 180_000L
    private const val VOLUME_OVERLAY_HIDE_MS = 1_200L
    private const val SETTINGS_PREFS_NAME = "openclaw.watch.settings"
    private const val PREF_AGENT_REASONING_LEVEL = "agent_reasoning_level"
    private const val PREF_ROTARY_CONTROL_MODE = "rotary_control_mode"
    internal const val PREF_TTS_PLAYBACK_GAIN = "tts_playback_gain"
    internal val DEFAULT_ENDPOINTING_CONFIG = AudioEndpointingConfig(endSilenceMs = 1_200)
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
          // Keep the screen on while the watch is capturing audio or playing a
          // response. Remote Processing has no local activity, so let the screen
          // sleep rather than burning battery waiting on the phone.
          Recording,
          CheckingPhone,
          Playing,
          -> true

          Idle,
          Processing,
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

  private val settingsPrefs: SharedPreferences? =
    runCatching { app.getSharedPreferences(SETTINGS_PREFS_NAME, Application.MODE_PRIVATE) }.getOrNull()
  private val _reasoningLevel = MutableStateFlow(WearReasoningLevel.normalize(settingsPrefs?.getString(PREF_AGENT_REASONING_LEVEL, null)))
  val reasoningLevel: StateFlow<String> = _reasoningLevel
  private val _rotaryControlMode = MutableStateFlow(normalizeRotaryControlMode(settingsPrefs?.getString(PREF_ROTARY_CONTROL_MODE, null)))
  val rotaryControlMode: StateFlow<String> = _rotaryControlMode
  private val _ttsPlaybackGain = MutableStateFlow(readPersistedTtsPlaybackGain(settingsPrefs))
  val ttsPlaybackGain: StateFlow<Double> = _ttsPlaybackGain
  private val _volumeOverlay = MutableStateFlow(VolumeOverlayState())
  val volumeOverlay: StateFlow<VolumeOverlayState> = _volumeOverlay

  private val audioCapture: WearAudioCapture = dependencies?.audioCapture ?: AudioCapture(app, viewModelScope)
  private val audioPlayer: WatchAudioPlayback = dependencies?.audioPlayer ?: AudioPlayerPlayback(app, viewModelScope)
  private val mediaVolumeController: MediaVolumeController = dependencies?.mediaVolumeController ?: AndroidMediaVolumeController(app)
  private val compressedAudioDecoder = CompressedAudioDecoder()
  private val relayClient: WearPhoneRelay = dependencies?.relayClient ?: PhoneRelayClient(app, viewModelScope)
  private val speechDictation: WatchSpeechDictation = dependencies?.speechDictation ?: AndroidSpeechDictation(app)
  // Uses android.util.Log directly; tests run under Robolectric where Log is a no-op.

  private var isRecording = false
  private var isDictating = false
  private var pendingDictationText: String? = null
  private var activeTurnId: String? = null
  private var processingWatchdogJob: Job? = null
  private var assistantStartJob: Job? = null
  private var compressedDecodeJob: Job? = null
  private var volumeOverlayJob: Job? = null
  private val rotaryAccumulator = RotaryStepAccumulator()

  private fun cancelAssistantStartJob() {
    assistantStartJob?.cancel()
    assistantStartJob = null
  }

  private fun resetTurnState() {
    isRecording = false
    isDictating = false
    pendingDictationText = null
    activeTurnId = null
    cancelAssistantStartJob()
    compressedDecodeJob?.cancel()
    compressedDecodeJob = null
  }

  private val recordingLock = Any()

  // Debug turns are launched from the UI thread and can be cancelled from
  // onRetry() (which may run on a different dispatcher), and we read this
  // generation from background coroutines while comparing it to a local copy.
  // Atomic guarantees the increment is visible to subsequent reads.
  private val debugGeneration = AtomicInteger(0)
  private val playbackGeneration = AtomicInteger(0)

  init {
    viewModelScope.launch {
      relayClient.phoneConnected.collect { connected ->
        if (!connected) {
          // Only capture/processing turns depend on the phone link. Whole-buffer
          // playback is fully local, so a disconnect during Playing (or Idle/Error)
          // must not fail it; leave playback running and surface the wait status.
          when (_state.value) {
            WatchState.Recording,
            WatchState.Processing,
            WatchState.CheckingPhone,
            -> failTurn("Phone disconnected")

            WatchState.Idle,
            WatchState.Playing,
            WatchState.Error,
            -> _statusText.value = "Waiting for phone..."
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
        if (_state.value == WatchState.Idle || _state.value == WatchState.Error) return@collect
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
      relayClient.errors.collect { error ->
        if (_state.value == WatchState.Idle || _state.value == WatchState.Error) return@collect
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

  fun setReasoningLevel(level: String) {
    val normalized = WearReasoningLevel.normalize(level)
    _reasoningLevel.value = normalized
    settingsPrefs?.edit()?.putString(PREF_AGENT_REASONING_LEVEL, normalized)?.apply()
  }

  fun setRotaryControlMode(mode: String) {
    val normalized = normalizeRotaryControlMode(mode)
    rotaryAccumulator.reset()
    _rotaryControlMode.value = normalized
    settingsPrefs?.edit()?.putString(PREF_ROTARY_CONTROL_MODE, normalized)?.apply()
  }

  fun onRotaryVolumeDelta(verticalScrollPixels: Float): Boolean {
    val steps = rotaryAccumulator.consume(verticalScrollPixels)
    if (steps == 0) return false
    return when (_rotaryControlMode.value) {
      ROTARY_CONTROL_MODE_TTS_GAIN -> adjustTtsGainBy(steps)
      else -> adjustMediaVolumeBy(steps)
    }
  }

  fun onMicButtonDown() {
    if (_state.value != WatchState.Idle) return
    startUserVoiceTurn()
  }

  fun onAssistantInvocation() {
    if (_state.value != WatchState.Idle && _state.value != WatchState.CheckingPhone) return
    cancelAssistantStartJob()
    assistantStartJob =
      viewModelScope
        .launch {
          val started = waitForAssistantPhoneConnection()
          if (started) {
            startUserVoiceTurn()
          }
        }.also { job ->
          job.invokeOnCompletion {
            if (assistantStartJob == job) {
              assistantStartJob = null
            }
          }
        }
  }

  private fun startUserVoiceTurn() {
    playbackGeneration.incrementAndGet()
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

  private suspend fun waitForAssistantPhoneConnection(): Boolean {
    if (relayClient.isPhoneConnected()) return true
    transitionTo(WatchState.CheckingPhone, "Checking phone...")
    val connected =
      withTimeoutOrNull(PHONE_CONNECTION_WAIT_TIMEOUT_MS) {
        relayClient.phoneConnected.first { it }
      }
    if (connected != true) {
      transitionTo(WatchState.Idle, "Phone not connected")
    }
    return connected == true
  }

  private fun startDictationTurn(): Boolean {
    if (!speechDictation.isAvailable()) return false
    isDictating = true
    pendingDictationText = null
    val started = speechDictation.start(::handleDictationEvent)
    if (!started) {
      isDictating = false
      pendingDictationText = null
      return false
    }
    transitionTo(WatchState.Recording, "Listening...")
    return true
  }

  private fun startRawAudioTurn() {
    isRecording = true
    val turnId = relayClient.sendStartRecording(reasoningLevel.value)
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
            completeStoppedRecording(turnId, endpoint)
          }
        },
      )
    if (!captureStarted) {
      failTurn("Microphone unavailable")
      return
    }
    transitionTo(WatchState.Recording, "Listening...")
  }

  fun onCancelTurn() {
    resetTurnState()
    debugGeneration.incrementAndGet()
    playbackGeneration.incrementAndGet()
    speechDictation.cancel()
    audioCapture.stop(discardPending = true)
    audioPlayer.stop()
    relayClient.sendCancel()
    transitionTo(WatchState.Idle, "Tap mic to speak")
  }

  fun onRetry() {
    onCancelTurn()
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
      var waitedMs = 0L
      while (!relayClient.isPhoneConnected() && waitedMs < PHONE_CONNECTION_WAIT_TIMEOUT_MS) {
        if (generation != debugGeneration.get() || _state.value !in ALLOWED_DEBUG_STATES) return@launch
        transitionTo(WatchState.CheckingPhone, "Checking phone...")
        delay(DEBUG_PHONE_CONNECTION_POLL_INTERVAL_MS)
        waitedMs += DEBUG_PHONE_CONNECTION_POLL_INTERVAL_MS
      }
      if (generation != debugGeneration.get() || _state.value !in ALLOWED_DEBUG_STATES) return@launch
      if (!relayClient.isPhoneConnected()) {
        transitionTo(WatchState.Idle, "Phone not connected")
        Log.w(DEBUG_TURN_TAG, "$debugKind aborted: phone not connected")
        return@launch
      }
      val turnId =
        relayClient.sendStartRecording(reasoningLevel.value) ?: run {
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
          completeStoppedRecording(turnId, event)
          Log.d(DEBUG_TURN_TAG, "$debugKind auto-ended bytesSent=$offset inputBytes=${pcmBytes.size}")
          return@launch
        }
        delay(20)
      }
      val finishEndpoint = detector?.finish()
      if (finishEndpoint != null && activeTurnId == turnId) {
        completeStoppedRecording(turnId, finishEndpoint)
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
    val generation = playbackGeneration.incrementAndGet()
    transitionTo(WatchState.Playing, "Playing debug audio...")
    audioPlayer.play(
      pcmBytes,
      onComplete = {
        completePlayback(generation)
      },
      onError = {
        failPlayback(generation)
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
    compressedDecodeJob?.cancel()
    val decodeJob =
      viewModelScope.launch {
        val startedAtMs = System.currentTimeMillis()
        val decoded =
          try {
            compressedAudioDecoder.decodeToPcm48kMono(audioBytes, fileExtension)
          } catch (err: Throwable) {
            if (err is CancellationException) throw err
            Log.w(DEBUG_TURN_TAG, "debug compressed decode failed: ${err.message}")
            if (generation != debugGeneration.get() || _state.value != WatchState.Processing) return@launch
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
        val playback = playbackGeneration.incrementAndGet()
        audioPlayer.playPcm48k(
          decoded.pcm48kMono,
          onComplete = {
            completePlayback(playback)
          },
          onError = {
            failPlayback(playback)
          },
          debugTurnId = turnId,
        )
      }
    trackCompressedDecodeJob(decodeJob)
  }

  private fun playPcmResponse(response: PhoneRelayAudioResponse) {
    val generation = playbackGeneration.incrementAndGet()
    transitionTo(WatchState.Playing, "Playing response...")
    audioPlayer.play(
      applyAndLogFinalTtsPlaybackGain(response.audioBytes, response.format),
      onComplete = {
        completePlayback(generation)
      },
      onError = {
        failPlayback(generation)
      },
      debugTurnId = response.turnId,
    )
  }

  private fun playCompressedResponse(response: PhoneRelayAudioResponse) {
    transitionTo(WatchState.Processing, "Decoding response...")
    // Response has arrived; the no-response watchdog must not fire during decode.
    processingWatchdogJob?.cancel()
    processingWatchdogJob = null
    compressedDecodeJob?.cancel()
    val decodeJob =
      viewModelScope.launch {
        val startedAtMs = System.currentTimeMillis()
        val extension =
          when (response.format) {
            WearRelayProtocol.RESPONSE_FORMAT_MP3 -> ".mp3"
            else -> ".opus"
          }
        val decoded =
          try {
            compressedAudioDecoder.decodeToPcm48kMono(response.audioBytes, extension)
          } catch (err: Throwable) {
            if (err is CancellationException) throw err
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
        val playbackPcm = applyAndLogFinalTtsPlaybackGain(decoded.pcm48kMono, response.format)
        transitionTo(WatchState.Playing, "Playing response...")
        val playback = playbackGeneration.incrementAndGet()
        audioPlayer.playPcm48k(
          playbackPcm,
          onComplete = {
            completePlayback(playback)
          },
          onError = {
            failPlayback(playback)
          },
          debugTurnId = response.turnId,
        )
      }
    trackCompressedDecodeJob(decodeJob)
  }

  private fun applyAndLogFinalTtsPlaybackGain(
    pcm: ByteArray,
    format: String,
  ): ByteArray {
    val gain = readCurrentTtsPlaybackGain()
    val boosted = applyFinalTtsPlaybackGain(pcm, gain)
    Log.d(
      DEBUG_TURN_TAG,
      "final tts playback gain format=$format gain=$gain bytes=${pcm.size} peakBefore=${peakAbsPcm16(pcm)} peakAfter=${peakAbsPcm16(boosted)}",
    )
    return boosted
  }

  private fun adjustMediaVolumeBy(steps: Int): Boolean {
    val volume = mediaVolumeController.adjustBy(steps)
    if (volume == null) {
      showVolumeOverlay(VolumeOverlayState(visible = true, title = "Media volume unavailable"))
      return false
    }
    showVolumeOverlay(
      VolumeOverlayState(
        visible = true,
        title = "Media volume",
        value = "${volume.percent}%",
        detail = "${volume.current} / ${volume.max}",
      ),
    )
    return true
  }

  private fun adjustTtsGainBy(steps: Int): Boolean {
    val current = readCurrentTtsPlaybackGain()
    val adjusted = adjustTtsPlaybackGain(current, steps)
    persistTtsPlaybackGain(adjusted)
    showVolumeOverlay(
      VolumeOverlayState(
        visible = true,
        title = "TTS gain",
        value = formatTtsPlaybackGain(adjusted),
        detail = "Default ${formatTtsPlaybackGain(DEFAULT_FINAL_TTS_PLAYBACK_GAIN)}",
      ),
    )
    return adjusted != current
  }

  private fun showVolumeOverlay(overlay: VolumeOverlayState) {
    _volumeOverlay.value = overlay
    volumeOverlayJob?.cancel()
    volumeOverlayJob =
      viewModelScope.launch {
        delay(VOLUME_OVERLAY_HIDE_MS)
        if (_volumeOverlay.value == overlay) {
          _volumeOverlay.value = VolumeOverlayState()
        }
      }
  }

  private fun readCurrentTtsPlaybackGain(): Double {
    val gain = readPersistedTtsPlaybackGain(settingsPrefs)
    _ttsPlaybackGain.value = gain
    return gain
  }

  private fun persistTtsPlaybackGain(gain: Double) {
    val clamped = clampTtsPlaybackGain(gain)
    _ttsPlaybackGain.value = clamped
    settingsPrefs?.edit()?.putLong(PREF_TTS_PLAYBACK_GAIN, clamped.toRawBits())?.apply()
  }

  private fun trackCompressedDecodeJob(decodeJob: Job) {
    compressedDecodeJob = decodeJob
    decodeJob.invokeOnCompletion {
      if (compressedDecodeJob == decodeJob) {
        compressedDecodeJob = null
      }
    }
  }

  private fun completePlayback(generation: Int) {
    if (generation != playbackGeneration.get() || _state.value != WatchState.Playing) return
    transitionTo(WatchState.Idle, "Tap mic to speak")
  }

  private fun failPlayback(generation: Int) {
    if (generation != playbackGeneration.get() || _state.value != WatchState.Playing) return
    failTurn("Audio playback unavailable")
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
    resetTurnState()
    playbackGeneration.incrementAndGet()
    speechDictation.cancel()
    audioCapture.stop(discardPending = true)
    audioPlayer.stop()
    relayClient.sendCancel()
    transitionTo(WatchState.Error, message)
  }

  private fun isActiveTurnResponse(turnId: String): Boolean = turnId == activeTurnId

  override fun onCleared() {
    super.onCleared()
    speechDictation.destroy()
    audioCapture.stop(discardPending = true)
    audioPlayer.stop()
    resetTurnState()
    processingWatchdogJob?.cancel()
    processingWatchdogJob = null
    relayClient.disconnect()
  }

  private fun completeStoppedRecording(
    turnId: String?,
    endpoint: AudioEndpointEvent.Endpoint,
  ) {
    if (claimRecordingCompletion(turnId) == null) return
    Log.d(
      DEBUG_TURN_TAG,
      "recording completion source=endpoint turnId=$turnId reason=${endpoint.reason} totalMs=${endpoint.totalAudioMs} speechMs=${endpoint.speechMs} trailingSilenceMs=${endpoint.trailingSilenceMs}",
    )
    if (endpoint.reason == AudioEndpointReason.NoSpeech) {
      relayClient.sendCancel()
      resetTurnState()
      transitionTo(WatchState.Idle, "Tap mic to speak")
      return
    }
    relayClient.sendEndRecording(turnId)
    if (activeTurnId == turnId) {
      transitionToProcessing("Processing...")
    }
  }

  private fun claimRecordingCompletion(expectedTurnId: String? = activeTurnId): String? =
    synchronized(recordingLock) {
      val turnId = activeTurnId
      if (!isRecording || turnId == null || expectedTurnId != turnId) return@synchronized null
      isRecording = false
      turnId
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
          pendingDictationText = text
          _statusText.value = text
        }
      }
      is SpeechDictationEvent.FinalTranscript -> {
        val text = event.text.trim().ifEmpty { pendingDictationText.orEmpty() }
        isDictating = false
        pendingDictationText = null
        speechDictation.destroy()
        if (text.isEmpty()) {
          showRecoverableDictationError("No speech recognized")
          return
        }
        submitDictationText(text)
      }
      is SpeechDictationEvent.Error -> {
        val text = pendingDictationText.orEmpty()
        isDictating = false
        pendingDictationText = null
        speechDictation.destroy()
        // Only salvage a partial when the recognizer merely heard nothing usable.
        // Transient (network/client/audio) errors may have truncated the partial,
        // so route to a recoverable error instead of submitting truncated text.
        if (event.kind == DictationErrorKind.NoSpeech && text.isNotEmpty()) {
          submitDictationText(text)
          return
        }
        showRecoverableDictationError(event.message)
      }
    }
  }

  private fun submitDictationText(text: String) {
    val turnId = relayClient.sendTextTurn(text, reasoningLevel.value)
    if (turnId == null) {
      transitionTo(WatchState.Idle, "Phone not connected")
      return
    }
    activeTurnId = turnId
    transitionToProcessing("Processing...")
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

  private data class Dependencies(
    val audioCapture: WearAudioCapture,
    val relayClient: WearPhoneRelay,
    val speechDictation: WatchSpeechDictation,
    val audioPlayer: WatchAudioPlayback? = null,
    val mediaVolumeController: MediaVolumeController? = null,
  )
}

internal fun normalizeRotaryControlMode(mode: String?): String =
  when (mode) {
    ROTARY_CONTROL_MODE_TTS_GAIN -> ROTARY_CONTROL_MODE_TTS_GAIN
    else -> ROTARY_CONTROL_MODE_MEDIA_VOLUME
  }

internal fun formatTtsPlaybackGain(gain: Double): String = String.format(Locale.US, "%.1fx", clampTtsPlaybackGain(gain))

private fun readPersistedTtsPlaybackGain(settingsPrefs: SharedPreferences?): Double {
  val value =
    settingsPrefs
      ?.all
      ?.get(WatchViewModel.PREF_TTS_PLAYBACK_GAIN)
      ?: return DEFAULT_FINAL_TTS_PLAYBACK_GAIN
  return clampTtsPlaybackGain(
    when (value) {
      is Long -> Double.fromBits(value)
      is Float -> value.toDouble()
      is String -> value.toDoubleOrNull() ?: DEFAULT_FINAL_TTS_PLAYBACK_GAIN
      is Int -> value.toDouble()
      else -> DEFAULT_FINAL_TTS_PLAYBACK_GAIN
    },
  )
}

private object UnavailableSpeechDictation : WatchSpeechDictation {
  override fun isAvailable(): Boolean = false

  override fun start(onEvent: (SpeechDictationEvent) -> Unit): Boolean = false

  override fun stopListening() {}

  override fun cancel() {}

  override fun destroy() {}
}
