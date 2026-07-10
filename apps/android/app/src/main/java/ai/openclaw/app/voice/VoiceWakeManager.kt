package ai.openclaw.app.voice

import ai.openclaw.common.speech.SpeechRecognizerHelper
import ai.openclaw.common.speech.bestRecognitionText
import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.SpeechRecognizer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** Runs Android speech recognition in a restart loop and dispatches wake-word commands. */
class VoiceWakeManager(
  private val context: Context,
  private val scope: CoroutineScope,
  private val onCommand: suspend (String) -> Unit,
) {
  private val mainHandler = Handler(Looper.getMainLooper())

  private val _isListening = MutableStateFlow(false)
  val isListening: StateFlow<Boolean> = _isListening

  private val _statusText = MutableStateFlow("Off")
  val statusText: StateFlow<String> = _statusText

  var triggerWords: List<String> = emptyList()
    private set

  private var recognizer: SpeechRecognizer? = null
  private var restartJob: Job? = null
  private var lastCycleDispatched: String? = null
  private var stopRequested = false

  /** Replaces the configured wake phrases checked against partial and final transcripts. */
  fun setTriggerWords(words: List<String>) {
    triggerWords = words
  }

  /** Starts wake listening if Android's speech recognizer is available. */
  fun start() {
    mainHandler.post {
      if (_isListening.value) return@post
      stopRequested = false

      if (!SpeechRecognizer.isRecognitionAvailable(context)) {
        _isListening.value = false
        _statusText.value = "Speech recognizer unavailable"
        return@post
      }

      try {
        recognizer?.destroy()
        recognizer = SpeechRecognizer.createSpeechRecognizer(context).also { it.setRecognitionListener(listener) }
        startListeningInternal()
      } catch (err: Throwable) {
        _isListening.value = false
        _statusText.value = "Start failed: ${err.message ?: err::class.simpleName}"
      }
    }
  }

  /** Stops listening, destroys the current recognizer, and publishes a terminal status. */
  fun stop(statusText: String = "Off") {
    stopRequested = true
    restartJob?.cancel()
    restartJob = null
    mainHandler.post {
      _isListening.value = false
      _statusText.value = statusText
      recognizer?.cancel()
      recognizer?.destroy()
      recognizer = null
    }
  }

  private fun startListeningInternal() {
    val r = recognizer ?: return
    val intent = SpeechRecognizerHelper.createRecognizerIntent(context.packageName)

    _statusText.value = "Listening"
    _isListening.value = true
    r.startListening(intent)
  }

  private fun scheduleRestart(delayMs: Long = 350) {
    if (stopRequested) return
    restartJob?.cancel()
    restartJob =
      scope.launch {
        delay(delayMs)
        mainHandler.post {
          if (stopRequested) return@post
          try {
            // SpeechRecognizer sessions end frequently after partial/final results;
            // restart the same recognizer cycle instead of exposing that churn to UI.
            recognizer?.cancel()
            startListeningInternal()
          } catch (_: Throwable) {
            // Will be picked up by onError and retry again.
          }
        }
      }
  }

  private fun handleTranscription(text: String) {
    val command = VoiceWakeCommandExtractor.extractCommand(text, triggerWords) ?: return
    if (command == lastCycleDispatched) return
    lastCycleDispatched = command

    scope.launch { onCommand(command) }
    _statusText.value = "Triggered"
    scheduleRestart(delayMs = 650)
  }

  private val listener =
    object : RecognitionListener {
      override fun onReadyForSpeech(params: Bundle?) {
        lastCycleDispatched = null
        _statusText.value = "Listening"
      }

      override fun onBeginningOfSpeech() {}

      override fun onRmsChanged(rmsdB: Float) {}

      override fun onBufferReceived(buffer: ByteArray?) {}

      override fun onEndOfSpeech() {
        scheduleRestart()
      }

      override fun onError(error: Int) {
        if (stopRequested) return
        _isListening.value = false
        _statusText.value = SpeechRecognizerHelper.errorMessage(error)
        // Permission errors are not transient; retrying would loop forever.
        if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) return
        scheduleRestart(delayMs = 600)
      }

      override fun onResults(results: Bundle?) {
        results.bestRecognitionText().takeIf { it.isNotEmpty() }?.let(::handleTranscription)
        scheduleRestart()
      }

      override fun onPartialResults(partialResults: Bundle?) {
        partialResults.bestRecognitionText().takeIf { it.isNotEmpty() }?.let(::handleTranscription)
      }

      override fun onEvent(
        eventType: Int,
        params: Bundle?,
      ) {}
    }
}
