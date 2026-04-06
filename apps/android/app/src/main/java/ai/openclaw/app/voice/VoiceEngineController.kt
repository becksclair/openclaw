package ai.openclaw.app.voice

import kotlinx.coroutines.flow.StateFlow

internal interface VoiceEngineController {
  val micEnabled: StateFlow<Boolean>
  val micCooldown: StateFlow<Boolean>
  val isListening: StateFlow<Boolean>
  val statusText: StateFlow<String>
  val liveTranscript: StateFlow<String?>
  val queuedMessages: StateFlow<List<String>>
  val conversation: StateFlow<List<VoiceConversationEntry>>
  val inputLevel: StateFlow<Float>
  val isSending: StateFlow<Boolean>

  fun setMicEnabled(enabled: Boolean)

  suspend fun pauseForTts()

  suspend fun resumeAfterTts()

  fun onGatewayConnectionChanged(connected: Boolean)

  fun handleGatewayEvent(event: String, payloadJson: String?)

  fun setPlaybackEnabled(enabled: Boolean)

  fun stopPlayback()
}
