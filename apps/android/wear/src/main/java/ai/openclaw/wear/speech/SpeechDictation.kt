package ai.openclaw.wear.speech

import ai.openclaw.common.speech.SpeechRecognizerHelper
import ai.openclaw.common.speech.bestRecognitionText
import ai.openclaw.wear.assistant.resolveRecognitionServiceComponent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

private const val WEAR_COMPLETE_SILENCE_LENGTH_MS = 3_200
private const val WEAR_POSSIBLY_COMPLETE_SILENCE_LENGTH_MS = 2_400

internal sealed interface SpeechDictationEvent {
  data object Listening : SpeechDictationEvent

  data object SpeechStarted : SpeechDictationEvent

  data object SpeechEnded : SpeechDictationEvent

  data class PartialTranscript(
    val text: String,
  ) : SpeechDictationEvent

  data class FinalTranscript(
    val text: String,
  ) : SpeechDictationEvent

  data class Error(
    val message: String,
  ) : SpeechDictationEvent
}

internal interface WatchSpeechDictation {
  fun isAvailable(): Boolean

  fun start(onEvent: (SpeechDictationEvent) -> Unit): Boolean

  fun stopListening()

  fun cancel()

  fun destroy()
}

internal class AndroidSpeechDictation(
  private val context: Context,
) : WatchSpeechDictation {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var recognizer: SpeechRecognizer? = null

  override fun isAvailable(): Boolean = cachedRecognizerComponent() != null

  override fun start(onEvent: (SpeechDictationEvent) -> Unit): Boolean {
    val component = cachedRecognizerComponent() ?: return false
    if (Looper.myLooper() == Looper.getMainLooper()) {
      return startOnMain(component, onEvent)
    }
    mainHandler.post {
      if (!startOnMain(component, onEvent)) {
        onEvent(SpeechDictationEvent.Error("Speech recognition unavailable"))
      }
    }
    return true
  }

  private fun startOnMain(
    component: android.content.ComponentName,
    onEvent: (SpeechDictationEvent) -> Unit,
  ): Boolean =
    runCatching {
      recognizer?.destroy()
      val nextRecognizer = SpeechRecognizer.createSpeechRecognizer(context, component)
      nextRecognizer.setRecognitionListener(DictationRecognitionListener(onEvent))
      recognizer = nextRecognizer
      nextRecognizer.startListening(recognizerIntent())
    }.isSuccess

  override fun stopListening() {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      runCatching { recognizer?.stopListening() }
    } else {
      mainHandler.post {
        runCatching { recognizer?.stopListening() }
      }
    }
  }

  override fun cancel() {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      runCatching { recognizer?.cancel() }
    } else {
      mainHandler.post {
        runCatching { recognizer?.cancel() }
      }
    }
  }

  override fun destroy() {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      recognizer?.destroy()
      recognizer = null
    } else {
      mainHandler.post {
        recognizer?.destroy()
        recognizer = null
      }
    }
  }

  private fun cachedRecognizerComponent(): ComponentName? = resolveRecognitionServiceComponent(context)

  private fun recognizerIntent(): Intent = createWearRecognizerIntent(context.packageName)

  private class DictationRecognitionListener(
    private val onEvent: (SpeechDictationEvent) -> Unit,
  ) : RecognitionListener {
    override fun onReadyForSpeech(params: Bundle?) {
      onEvent(SpeechDictationEvent.Listening)
    }

    override fun onBeginningOfSpeech() {
      onEvent(SpeechDictationEvent.SpeechStarted)
    }

    override fun onRmsChanged(rmsdB: Float) {}

    override fun onBufferReceived(buffer: ByteArray?) {}

    override fun onEndOfSpeech() {
      onEvent(SpeechDictationEvent.SpeechEnded)
    }

    override fun onError(error: Int) {
      onEvent(SpeechDictationEvent.Error(SpeechRecognizerHelper.errorMessage(error)))
    }

    override fun onResults(results: Bundle?) {
      onEvent(SpeechDictationEvent.FinalTranscript(results.bestRecognitionText()))
    }

    override fun onPartialResults(partialResults: Bundle?) {
      val text = partialResults.bestRecognitionText()
      if (text.isNotBlank()) {
        onEvent(SpeechDictationEvent.PartialTranscript(text))
      }
    }

    override fun onEvent(
      eventType: Int,
      params: Bundle?,
    ) {}
  }
}

internal fun createWearRecognizerIntent(callingPackage: String): Intent =
  SpeechRecognizerHelper.createRecognizerIntent(callingPackage).apply {
    putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, WEAR_COMPLETE_SILENCE_LENGTH_MS)
    putExtra(
      RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS,
      WEAR_POSSIBLY_COMPLETE_SILENCE_LENGTH_MS,
    )
  }
