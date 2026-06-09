package ai.openclaw.wear.audio

import android.content.Context
import android.util.Log
import java.io.File

internal class PlaybackAudioDebugCapture(
  private val context: Context,
) {
  private val lock = Any()

  fun capturePlaybackChunk(
    turnId: String?,
    chunkIndex: Int,
    data: ByteArray,
  ) {
    if (!isWearAudioCaptureEnabled()) return
    synchronized(lock) {
      val directory = wearCaptureDirectory(context, turnId)
      try {
        directory.mkdirs()
        File(directory, "playback-${chunkIndex.toString().padStart(6, '0')}.pcm").writeBytes(data)
        appendWearCaptureEvent(directory, "playbackChunk\t$chunkIndex\t${data.size}")
      } catch (err: Throwable) {
        Log.w(WEAR_AUDIO_CAPTURE_TAG, "playback capture failed: ${err.message}")
      }
    }
  }

  fun capturePlaybackEvent(
    turnId: String?,
    event: String,
  ) {
    if (!isWearAudioCaptureEnabled()) return
    synchronized(lock) {
      val directory = wearCaptureDirectory(context, turnId)
      try {
        directory.mkdirs()
        appendWearCaptureEvent(directory, event)
      } catch (err: Throwable) {
        Log.w(WEAR_AUDIO_CAPTURE_TAG, "playback event capture failed: ${err.message}")
      }
    }
  }
}
