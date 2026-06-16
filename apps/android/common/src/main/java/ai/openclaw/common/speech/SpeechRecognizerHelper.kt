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
  fun createRecognizerIntent(callingPackage: String): Intent =
    Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
      putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, callingPackage)
    }

  fun errorMessage(error: Int): String =
    when (error) {
      SpeechRecognizer.ERROR_AUDIO -> "Speech audio failed"
      SpeechRecognizer.ERROR_CLIENT -> "Speech recognition failed"
      SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission required"
      SpeechRecognizer.ERROR_NETWORK,
      SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
      -> "Speech network unavailable"
      SpeechRecognizer.ERROR_NO_MATCH,
      SpeechRecognizer.ERROR_SPEECH_TIMEOUT,
      -> "No speech recognized"
      SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Speech recognizer busy"
      SpeechRecognizer.ERROR_SERVER -> "Speech service unavailable"
      else -> "Speech recognition failed"
    }
}

fun Bundle?.bestRecognitionText(): String =
  this
    ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
    ?.firstOrNull()
    ?.trim()
    .orEmpty()
