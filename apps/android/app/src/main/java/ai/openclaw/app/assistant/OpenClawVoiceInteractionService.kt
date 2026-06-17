package ai.openclaw.app.assistant

import android.service.voice.VoiceInteractionService
import android.util.Log

class OpenClawVoiceInteractionService : VoiceInteractionService() {
  override fun onReady() {
    super.onReady()
    Log.d(TAG, "voice interaction service ready")
  }

  private companion object {
    private const val TAG = "OpenClawAssistant"
  }
}
