package ai.openclaw.wear.audio

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

internal class AcousticAudioDebugCapture(
  private val context: Context,
  private val scope: CoroutineScope,
) {
  companion object {
    private val SAMPLE_RATES = intArrayOf(48_000, 32_000, 24_000)
  }

  private val recorderRef = AtomicReference<AudioRecord?>(null)
  private val recording = AtomicBoolean(false)
  private var job: Job? = null

  fun start(turnId: String?) {
    if (!isWearAudioCaptureEnabled() || recording.getAndSet(true)) return
    if (
      ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) !=
      PackageManager.PERMISSION_GRANTED
    ) {
      recording.set(false)
      Log.w(WEAR_AUDIO_CAPTURE_TAG, "acoustic capture skipped: microphone permission missing")
      return
    }
    val created =
      createRecorder() ?: run {
        recording.set(false)
        Log.w(WEAR_AUDIO_CAPTURE_TAG, "acoustic capture skipped: no recorder")
        return
      }
    val (recorder, sampleRate, bufferSize) = created
    recorderRef.set(recorder)
    val directory = wearCaptureDirectory(context, turnId)
    directory.mkdirs()
    appendWearCaptureEvent(directory, "acousticStart\t0\t$sampleRate\t$bufferSize")
    try {
      recorder.startRecording()
    } catch (err: Throwable) {
      recorderRef.compareAndSet(recorder, null)
      recording.set(false)
      recorder.release()
      appendWearCaptureEvent(directory, "acousticError\t0\t0\t${sanitizeWearEventField(err.message)}")
      Log.w(WEAR_AUDIO_CAPTURE_TAG, "acoustic capture start failed: ${err.message}")
      return
    }
    job =
      scope.launch(Dispatchers.IO) {
        val file = directory.resolve("acoustic-$sampleRate.pcm")
        val buffer = ByteArray(bufferSize)
        try {
          file.outputStream().use { out ->
            while (isActive && recording.get()) {
              if (recorderRef.get() !== recorder) break
              val read = recorder.read(buffer, 0, buffer.size)
              if (read > 0) out.write(buffer, 0, read)
            }
          }
        } finally {
          if (recorderRef.compareAndSet(recorder, null)) {
            runCatching { recorder.stop() }
            recorder.release()
          }
          appendWearCaptureEvent(directory, "acousticStop\t0\t${file.length()}\t$sampleRate")
        }
      }
  }

  fun stop() {
    recording.set(false)
    job?.cancel()
    job = null
    recorderRef.getAndSet(null)?.let { recorder ->
      runCatching { recorder.stop() }
      recorder.release()
    }
  }

  private fun createRecorder(): RecorderConfig? {
    for (sampleRate in SAMPLE_RATES) {
      val minBufferSize =
        AudioRecord.getMinBufferSize(
          sampleRate,
          AudioFormat.CHANNEL_IN_MONO,
          AudioFormat.ENCODING_PCM_16BIT,
        )
      if (minBufferSize <= 0) continue
      val bufferSize = maxOf(minBufferSize * 2, sampleRate / 5 * 2)
      val recorder =
        AudioRecord(
          MediaRecorder.AudioSource.MIC,
          sampleRate,
          AudioFormat.CHANNEL_IN_MONO,
          AudioFormat.ENCODING_PCM_16BIT,
          bufferSize,
        )
      if (recorder.state == AudioRecord.STATE_INITIALIZED) {
        return RecorderConfig(recorder, sampleRate, bufferSize)
      }
      recorder.release()
    }
    return null
  }

  private data class RecorderConfig(
    val recorder: AudioRecord,
    val sampleRate: Int,
    val bufferSize: Int,
  )
}
