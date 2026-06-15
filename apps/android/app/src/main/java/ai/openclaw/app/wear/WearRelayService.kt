package ai.openclaw.app.wear

import ai.openclaw.app.NodeApp
import android.util.Log
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService

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
  }

  override fun onMessageReceived(messageEvent: MessageEvent) {
    Log.d(TAG, "onMessageReceived: path=${messageEvent.path}")
    if (!WearAudioRelay.isWatchMessagePath(messageEvent.path)) return
    val nodeApp = application as? NodeApp ?: return
    val existingRuntime = nodeApp.peekRuntime()
    if (existingRuntime != null) {
      Log.d(TAG, "foreground runtime already registered; ignoring service duplicate")
      return
    }
    nodeApp
      .ensureRuntime()
      .wearAudioRelay
      .handleWatchMessage(messageEvent.path, messageEvent.data, messageEvent.sourceNodeId)
  }
}
