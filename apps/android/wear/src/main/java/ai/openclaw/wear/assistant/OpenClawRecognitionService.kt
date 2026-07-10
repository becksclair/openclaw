package ai.openclaw.wear.assistant

/**
 * Recognition-service stub that delegates to the device's real recognizer.
 * Wear copy; keep in sync with app/src/main/java/ai/openclaw/app/assistant/OpenClawRecognitionService.kt.
 */

import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognitionService
import android.speech.SpeechRecognizer
import android.util.Log

class OpenClawRecognitionService : RecognitionService() {
  private var recognizer: SpeechRecognizer? = null

  override fun onStartListening(
    recognizerIntent: Intent?,
    listener: Callback,
  ) {
    val delegateComponent = resolveRecognitionServiceComponent(this)
    if (delegateComponent == null || recognizerIntent == null) {
      listener.error(SpeechRecognizer.ERROR_CLIENT)
      return
    }
    runCatching {
      recognizer?.destroy()
      recognizer =
        SpeechRecognizer.createSpeechRecognizer(this, delegateComponent).also { nextRecognizer ->
          nextRecognizer.setRecognitionListener(DelegatingRecognitionListener(listener))
          nextRecognizer.startListening(recognizerIntent)
        }
    }.onFailure { err ->
      Log.w(TAG, "recognition delegate start failed: ${err.message}")
      listener.error(SpeechRecognizer.ERROR_CLIENT)
    }
  }

  override fun onCancel(listener: Callback) {
    runCatching { recognizer?.cancel() }
    runCatching { recognizer?.destroy() }
    recognizer = null
  }

  override fun onStopListening(listener: Callback) {
    runCatching { recognizer?.stopListening() }
  }

  override fun onDestroy() {
    runCatching { recognizer?.destroy() }
    recognizer = null
    super.onDestroy()
  }

  private class DelegatingRecognitionListener(
    private val callback: Callback,
  ) : RecognitionListener {
    override fun onReadyForSpeech(params: Bundle?) {
      runCatching { callback.readyForSpeech(params) }
    }

    override fun onBeginningOfSpeech() {
      runCatching { callback.beginningOfSpeech() }
    }

    override fun onRmsChanged(rmsdB: Float) {
      runCatching { callback.rmsChanged(rmsdB) }
    }

    override fun onBufferReceived(buffer: ByteArray?) {
      runCatching { callback.bufferReceived(buffer) }
    }

    override fun onEndOfSpeech() {
      runCatching { callback.endOfSpeech() }
    }

    override fun onError(error: Int) {
      runCatching { callback.error(error) }
    }

    override fun onResults(results: Bundle?) {
      runCatching { callback.results(results) }
    }

    override fun onPartialResults(partialResults: Bundle?) {
      runCatching { callback.partialResults(partialResults) }
    }

    override fun onEvent(
      eventType: Int,
      params: Bundle?,
    ) {}
  }

  private companion object {
    private const val TAG = "OpenClawAssistant"
  }
}
