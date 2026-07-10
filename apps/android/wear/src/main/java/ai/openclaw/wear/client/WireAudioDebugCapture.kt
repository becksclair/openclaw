package ai.openclaw.wear.client

import ai.openclaw.wear.audio.WEAR_AUDIO_CAPTURE_TAG
import ai.openclaw.wear.audio.appendWearCaptureEvent
import ai.openclaw.wear.audio.isWearAudioCaptureEnabled
import ai.openclaw.wear.audio.wearCaptureDirectory
import android.content.Context
import android.util.Log
import java.io.File

internal class WireAudioDebugCapture(
  private val context: Context,
) {
  private val lock = Any()

  fun captureWholeResponse(
    turnId: String?,
    data: ByteArray,
  ) {
    if (!isWearAudioCaptureEnabled()) return
    capture(turnId) { directory ->
      File(directory, "whole-response.pcm").writeBytes(data)
      appendWearCaptureEvent(directory, "wholeResponse\t0\t${data.size}")
    }
  }

  private fun capture(
    turnId: String?,
    write: (File) -> Unit,
  ) {
    synchronized(lock) {
      val directory = wearCaptureDirectory(context, turnId)
      try {
        directory.mkdirs()
        write(directory)
      } catch (err: Throwable) {
        Log.w(WEAR_AUDIO_CAPTURE_TAG, "audio capture failed: ${err.message}")
      }
    }
  }
}
