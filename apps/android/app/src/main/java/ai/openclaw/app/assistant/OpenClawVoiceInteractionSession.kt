package ai.openclaw.app.assistant

import ai.openclaw.app.MainActivity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.service.voice.VoiceInteractionSession
import android.util.Log

class OpenClawVoiceInteractionSession(
  context: Context,
) : VoiceInteractionSession(context) {
  override fun onPrepareShow(
    args: Bundle?,
    showFlags: Int,
  ) {
    setUiEnabled(false)
    super.onPrepareShow(args, showFlags)
  }

  override fun onShow(
    args: Bundle?,
    showFlags: Int,
  ) {
    super.onShow(args, showFlags)
    Log.d(TAG, "voice interaction session requested dictation")
    AssistantTrustedStartBridge.requestStart()
    startAssistantActivity(
      Intent(context, MainActivity::class.java)
        .setAction(Intent.ACTION_ASSIST)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
    )
    hide()
  }

  private companion object {
    private const val TAG = "OpenClawAssistant"
  }
}
