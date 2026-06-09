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

class AudioCapture(
  private val context: Context,
  private val scope: CoroutineScope,
  private val sampleRateHz: Int = 24_000,
) {
  companion object {
    private const val TAG = "OpenClawWearAudioCapture"
    private const val CHUNK_INTERVAL_MS = 200L
  }

  private val recorderRef = AtomicReference<AudioRecord?>(null)
  private var recordJob: Job? = null
  private val isRecording = AtomicBoolean(false)
  private val flushPendingOnStopRef = AtomicReference<AtomicBoolean?>(null)

  fun start(onChunk: (ByteArray) -> Unit): Boolean {
    if (isRecording.getAndSet(true)) return false
    val flushPendingOnStop = AtomicBoolean(true)
    flushPendingOnStopRef.set(flushPendingOnStop)
    if (
      ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) !=
      PackageManager.PERMISSION_GRANTED
    ) {
      flushPendingOnStopRef.compareAndSet(flushPendingOnStop, null)
      isRecording.set(false)
      Log.w(TAG, "microphone permission required")
      return false
    }

    val minBufferSize =
      AudioRecord.getMinBufferSize(
        sampleRateHz,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
      )
    if (minBufferSize <= 0) {
      flushPendingOnStopRef.compareAndSet(flushPendingOnStop, null)
      isRecording.set(false)
      Log.w(TAG, "AudioRecord buffer unavailable")
      return false
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
      flushPendingOnStopRef.compareAndSet(flushPendingOnStop, null)
      isRecording.set(false)
      active.release()
      Log.w(TAG, "AudioRecord unavailable")
      return false
    }
    recorderRef.set(active)
    try {
      active.startRecording()
    } catch (err: Throwable) {
      flushPendingOnStopRef.compareAndSet(flushPendingOnStop, null)
      recorderRef.set(null)
      isRecording.set(false)
      active.release()
      Log.w(TAG, "startRecording failed: ${err.message}")
      return false
    }

    recordJob =
      scope.launch(Dispatchers.IO) {
        val buffer = ByteArray(bufferSize)
        val chunkAccumulator = mutableListOf<ByteArray>()
        var chunkStartMs = System.currentTimeMillis()
        try {
          while (isActive && isRecording.get()) {
            val read = active.read(buffer, 0, buffer.size)
            if (read > 0) {
              chunkAccumulator.add(buffer.copyOf(read))
            }
            val elapsed = System.currentTimeMillis() - chunkStartMs
            if (elapsed >= CHUNK_INTERVAL_MS && chunkAccumulator.isNotEmpty()) {
              flushAccumulator(chunkAccumulator, onChunk)
              chunkStartMs = System.currentTimeMillis()
            }
          }
        } finally {
          if (recorderRef.compareAndSet(active, null)) {
            isRecording.set(false)
            runCatching { active.stop() }
            active.release()
          }
          flushPendingOnStopRef.compareAndSet(flushPendingOnStop, null)
          if (flushPendingOnStop.getAndSet(true)) {
            flushAccumulator(chunkAccumulator, onChunk)
          } else {
            chunkAccumulator.clear()
          }
        }
      }
    return true
  }

  private fun flushAccumulator(
    chunks: MutableList<ByteArray>,
    onChunk: (ByteArray) -> Unit,
  ) {
    if (chunks.isEmpty()) return
    val combinedSize = chunks.sumOf { it.size }
    if (combinedSize == 0) {
      chunks.clear()
      return
    }
    val combined = ByteArray(combinedSize)
    var offset = 0
    for (chunk in chunks) {
      chunk.copyInto(combined, offset)
      offset += chunk.size
    }
    chunks.clear()
    onChunk(combined)
  }

  fun stop(
    discardPending: Boolean = false,
    onStopped: (() -> Unit)? = null,
  ) {
    flushPendingOnStopRef.getAndSet(null)?.set(!discardPending)
    isRecording.set(false)
    val job = recordJob
    recordJob = null
    if (onStopped != null) {
      if (job == null) {
        onStopped()
      } else {
        job.invokeOnCompletion { onStopped() }
      }
    }
    job?.cancel()
    val active = recorderRef.getAndSet(null)
    active?.let {
      runCatching { it.stop() }
      it.release()
    }
  }
}
