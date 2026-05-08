package ai.openclaw.app.voice

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

internal interface RealtimeAudioCapture {
  fun start(onAudioBase64: suspend (String) -> Unit)

  fun stop()
}

internal class RealtimeAudioRecorder(
  private val context: Context,
  private val scope: CoroutineScope,
  private val sampleRateHz: Int = 24_000,
) : RealtimeAudioCapture {
  private var recorder: AudioRecord? = null
  private var recordJob: Job? = null

  override fun start(onAudioBase64: suspend (String) -> Unit) {
    if (recordJob != null) return
    if (
      ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) !=
      PackageManager.PERMISSION_GRANTED
    ) {
      throw IllegalStateException("Microphone permission required")
    }
    val minBufferSize =
      AudioRecord.getMinBufferSize(
        sampleRateHz,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
      )
    if (minBufferSize <= 0) {
      throw IllegalStateException("Realtime AudioRecord buffer unavailable")
    }
    val bufferSize = minBufferSize * 2
    val active =
      AudioRecord(
        MediaRecorder.AudioSource.VOICE_COMMUNICATION,
        sampleRateHz,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        bufferSize,
      )
    if (active.state != AudioRecord.STATE_INITIALIZED) {
      active.release()
      throw IllegalStateException("Realtime AudioRecord unavailable")
    }
    recorder = active
    try {
      active.startRecording()
    } catch (err: Throwable) {
      recorder = null
      active.release()
      throw err
    }
    recordJob =
      scope.launch(Dispatchers.IO) {
        val buffer = ByteArray(bufferSize)
        try {
          while (isActive) {
            val read = active.read(buffer, 0, buffer.size)
            if (read > 0) {
              onAudioBase64(Base64.encodeToString(buffer, 0, read, Base64.NO_WRAP))
            } else if (read < 0) {
              throw IllegalStateException("Realtime AudioRecord read failed: $read")
            }
          }
        } finally {
          if (recorder === active) {
            recorder = null
            recordJob = null
            runCatching { active.stop() }
            active.release()
          }
        }
      }
  }

  override fun stop() {
    recordJob?.cancel()
    recordJob = null
    val active = recorder
    recorder = null
    active?.let {
      runCatching { it.stop() }
      it.release()
    }
  }
}
