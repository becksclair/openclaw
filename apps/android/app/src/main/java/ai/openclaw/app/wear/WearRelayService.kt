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
    val hadRuntime = nodeApp.peekRuntime() != null
    val runtime = nodeApp.ensureRuntime()
    if (!runtime.canHandleWearRelayMessages) {
      sendPhoneNotReadyError(messageEvent)
      return
    }
    if (!runtime.wearAudioRelay.connect() && hadRuntime) {
      Log.d(TAG, "foreground runtime already registered; ignoring service duplicate")
      return
    }
    runtime.wearAudioRelay.handleWatchMessage(messageEvent.path, messageEvent.data, messageEvent.sourceNodeId)
  }

  private fun sendPhoneNotReadyError(messageEvent: MessageEvent) {
    // Scope the error to the watch's turn. A path without a parseable turn id is
    // malformed (the watch always sends turn-scoped paths), so there is nothing
    // to fail back to the watch.
    val turnId = WearRelayProtocol.parseWatchMessagePath(messageEvent.path)?.turnId ?: return
    val payload =
      json
        .encodeToString(WearRelayErrorPayload(message = PHONE_NOT_READY_MESSAGE, turnId = turnId))
        .toByteArray()
    Wearable
      .getMessageClient(this)
      .sendMessage(messageEvent.sourceNodeId, WearRelayProtocol.PATH_ERROR, payload)
      .addOnFailureListener { err ->
        Log.w(TAG, "failed to send phone-not-ready wear error: ${err.message}")
      }
  }
}
