package ai.openclaw.wear.assistant

import ai.openclaw.wear.WatchApp
import android.service.voice.VoiceInteractionService
import android.util.Log

class OpenClawVoiceInteractionService : VoiceInteractionService() {
  override fun onReady() {
    super.onReady()
    Log.d(WatchApp.TAG, "voice interaction service ready")
  }
}
