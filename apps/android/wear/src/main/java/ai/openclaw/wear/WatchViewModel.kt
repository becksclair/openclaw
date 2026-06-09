package ai.openclaw.wear

import ai.openclaw.wear.audio.AudioCapture
import ai.openclaw.wear.audio.AudioPlayer
import ai.openclaw.wear.audio.CompressedAudioDecoder
import ai.openclaw.wear.client.PhoneRelayClient
import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicInteger

class WatchViewModel(
  app: Application,
) : AndroidViewModel(app) {
  companion object {
    private const val TAG = WatchApp.TAG
    private const val DEBUG_TURN_TAG = "OpenClawWearDebugTurn"
    private const val DEBUG_CHUNK_BYTES = AudioPlayer.SAMPLE_RATE * 2 / 5
    private const val DEBUG_PHONE_WAIT_ATTEMPTS = 20
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

  private val audioCapture = AudioCapture(app, viewModelScope)
  private val audioPlayer = AudioPlayer(app, viewModelScope)
  private val compressedAudioDecoder = CompressedAudioDecoder()
  private val relayClient = PhoneRelayClient(app, viewModelScope)

  private var isRecording = false
  private var activeTurnId: String? = null

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
          if (response.format == PhoneRelayClient.RESPONSE_FORMAT_OGG_OPUS) {
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
          is PhoneRelayClient.AudioStreamEvent.Chunk -> {
            if (!isActiveTurnResponse(event.turnId) || event.audioBytes.isEmpty()) return@collect
            // Streaming chunks are always PCM_24K under the current relay; format
            // negotiation has not landed (see AudioStreamEvent.Chunk kdoc).
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
          is PhoneRelayClient.AudioStreamEvent.Done -> {
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
    isRecording = true
    val turnId = relayClient.sendStartRecording()
    if (turnId == null) {
      isRecording = false
      transitionTo(WatchState.Idle, "Phone not connected")
      return
    }
    activeTurnId = turnId
    val captureStarted =
      audioCapture.start { chunk ->
        relayClient.sendAudioChunk(turnId, chunk)
      }
    if (!captureStarted) {
      failTurn("Microphone unavailable")
      return
    }
    transitionTo(WatchState.Recording, "Listening...")
  }

  fun onMicButtonUp() {
    if (!isRecording) return
    isRecording = false
    val turnId = activeTurnId
    audioCapture.stop {
      relayClient.sendEndRecording(turnId)
      if (activeTurnId == turnId) {
        transitionTo(WatchState.Processing, "Processing...")
      }
    }
  }

  fun onRetry() {
    isRecording = false
    activeTurnId = null
    debugGeneration.incrementAndGet()
    audioCapture.stop(discardPending = true)
    audioPlayer.stop()
    relayClient.sendCancel()
    transitionTo(
      WatchState.Idle,
      "Tap mic to speak",
    )
  }

  fun runDebugPcmTurn(pcmBytes: ByteArray) {
    if (!Log.isLoggable(DEBUG_TURN_TAG, Log.VERBOSE)) return
    if (pcmBytes.isEmpty() || _state.value != WatchState.Idle) return
    val generation = debugGeneration.incrementAndGet()
    Log.d(DEBUG_TURN_TAG, "starting debug pcm turn bytes=${pcmBytes.size}")
    viewModelScope.launch {
      var attempts = 0
      while (!relayClient.isPhoneConnected() && attempts < DEBUG_PHONE_WAIT_ATTEMPTS) {
        if (generation != debugGeneration.get() || _state.value !in setOf(WatchState.Idle, WatchState.CheckingPhone)) return@launch
        attempts++
        transitionTo(WatchState.CheckingPhone, "Checking phone...")
        delay(500)
      }
      if (generation != debugGeneration.get() || _state.value !in setOf(WatchState.Idle, WatchState.CheckingPhone)) return@launch
      if (!relayClient.isPhoneConnected()) {
        transitionTo(WatchState.Idle, "Phone not connected")
        Log.w(DEBUG_TURN_TAG, "debug pcm turn aborted: phone not connected")
        return@launch
      }
      val turnId =
        relayClient.sendStartRecording() ?: run {
          transitionTo(WatchState.Idle, "Phone not connected")
          Log.w(DEBUG_TURN_TAG, "debug pcm turn aborted: no relay phone node")
          return@launch
        }
      if (generation != debugGeneration.get() || _state.value !in setOf(WatchState.Idle, WatchState.CheckingPhone)) {
        relayClient.sendCancel()
        return@launch
      }
      activeTurnId = turnId
      transitionTo(WatchState.Recording, "Sending debug audio...")
      delay(200)
      var offset = 0
      while (offset < pcmBytes.size && activeTurnId == turnId) {
        val end = minOf(offset + DEBUG_CHUNK_BYTES, pcmBytes.size)
        relayClient.sendAudioChunk(turnId, pcmBytes.copyOfRange(offset, end))
        offset = end
        delay(20)
      }
      if (activeTurnId == turnId) {
        relayClient.sendEndRecording(turnId)
        transitionTo(WatchState.Processing, "Processing...")
        Log.d(DEBUG_TURN_TAG, "debug pcm turn sent bytes=${pcmBytes.size}")
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

  private fun playPcmResponse(response: PhoneRelayClient.AudioResponse) {
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

  private fun playCompressedResponse(response: PhoneRelayClient.AudioResponse) {
    transitionTo(WatchState.Processing, "Decoding response...")
    viewModelScope.launch {
      val startedAtMs = System.currentTimeMillis()
      val decoded =
        try {
          compressedAudioDecoder.decodeToPcm48kMono(response.audioBytes, ".opus")
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
    _state.value = newState
    _statusText.value = message
    Log.d(TAG, "state=$newState msg=$message")
  }

  private fun failTurn(message: String) {
    isRecording = false
    activeTurnId = null
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
    audioCapture.stop(discardPending = true)
    audioPlayer.stop()
    activeTurnId = null
    relayClient.disconnect()
  }
}
