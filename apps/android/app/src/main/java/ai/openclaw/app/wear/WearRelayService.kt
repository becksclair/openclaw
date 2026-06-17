package ai.openclaw.app.wear

import ai.openclaw.app.NodeApp
import ai.openclaw.common.wear.WearRelayErrorPayload
import ai.openclaw.common.wear.WearRelayProtocol
import android.util.Log
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Receives messages from the Wear OS watch via the Wearable Data Layer and
 * forwards them to the single [WearAudioRelay] owned by [ai.openclaw.app.NodeRuntime],
 * which also receives gateway transcription/chat events for the active turn.
 *
 * Runs as a service so it can handle watch requests even when the app is
 * not in the foreground.
 */
class WearRelayService : WearableListenerService() {
  companion object {
    private const val TAG = "WearRelayService"
    private const val PHONE_NOT_READY_MESSAGE = "Phone app is not connected to OpenClaw. Open the phone app, connect the gateway, then try again."
  }

  private val json = Json { ignoreUnknownKeys = true }

  override fun onMessageReceived(messageEvent: MessageEvent) {
    Log.d(TAG, "onMessageReceived: path=${messageEvent.path}")
    if (!WearAudioRelay.isWatchMessagePath(messageEvent.path)) return
    val nodeApp = application as? NodeApp ?: return
    val existingRuntime = nodeApp.peekRuntime()
    if (existingRuntime != null) {
      if (existingRuntime.wearAudioRelay.isListeningForWatchMessages) {
        Log.d(TAG, "foreground runtime already registered; ignoring service duplicate")
        return
      }
      if (!existingRuntime.canHandleWearRelayMessages) {
        sendPhoneNotReadyError(messageEvent)
        return
      }
      existingRuntime.wearAudioRelay.connect()
      existingRuntime.wearAudioRelay.handleWatchMessage(messageEvent.path, messageEvent.data, messageEvent.sourceNodeId)
      return
    }
    sendPhoneNotReadyError(messageEvent)
  }

  private fun sendPhoneNotReadyError(messageEvent: MessageEvent) {
    val sourceNodeId = messageEvent.sourceNodeId
    val turnId = WearRelayProtocol.parseWatchMessagePath(messageEvent.path)?.turnId
    val payload =
      json
        .encodeToString(WearRelayErrorPayload(message = PHONE_NOT_READY_MESSAGE, turnId = turnId))
        .toByteArray()
    Wearable
      .getMessageClient(this)
      .sendMessage(sourceNodeId, WearRelayProtocol.PATH_ERROR, payload)
      .addOnFailureListener { err ->
        Log.w(TAG, "failed to send phone-not-ready wear error: ${err.message}")
      }
  }
}
