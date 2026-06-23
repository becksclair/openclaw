package ai.openclaw.common.speech

import android.content.Intent
import android.os.Bundle
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/**
 * Common Android SpeechRecognizer primitives shared across the phone and watch
 * voice paths. Keeps intent construction, result extraction, and error mapping
 * in one place so the three recognizer call sites do not drift.
 */
object SpeechRecognizerHelper {
  /**
   * Coarse failure class for callers that must decide whether a partial
   * transcript is salvageable. NoSpeech means the recognizer heard nothing
   * usable; Transient covers network/client/audio/server faults where a partial
   * may be truncated.
   */
  enum class ErrorKind {
    NoSpeech,
    Transient,
  }

  // Single source of truth for the "heard nothing usable" error ints; both the
  // human message and the ErrorKind classification derive from this set so the
  // two mappings cannot drift.
  private val NO_SPEECH_ERRORS =
    setOf(
      SpeechRecognizer.ERROR_NO_MATCH,
      SpeechRecognizer.ERROR_SPEECH_TIMEOUT,
    )

  fun createRecognizerIntent(callingPackage: String): Intent =
    Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
      putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, callingPackage)
    }

  fun errorKind(error: Int): ErrorKind = if (error in NO_SPEECH_ERRORS) ErrorKind.NoSpeech else ErrorKind.Transient

  fun errorMessage(error: Int): String =
    when {
      error == SpeechRecognizer.ERROR_AUDIO -> "Speech audio failed"
      error == SpeechRecognizer.ERROR_CLIENT -> "Speech recognition failed"
      error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission required"
      error == SpeechRecognizer.ERROR_NETWORK ||
        error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Speech network unavailable"
      error in NO_SPEECH_ERRORS -> "No speech recognized"
      error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Speech recognizer busy"
      error == SpeechRecognizer.ERROR_SERVER -> "Speech service unavailable"
      else -> "Speech recognition failed"
    }
}

fun Bundle?.bestRecognitionText(): String =
  this
    ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
    ?.firstOrNull()
    ?.trim()
    .orEmpty()
