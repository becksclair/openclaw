package ai.openclaw.wear.audio

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioManager
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.coroutineContext

internal interface WearAudioCapture {
  fun start(
    turnId: String? = null,
    onChunk: (ByteArray) -> Unit,
    endpointingConfig: AudioEndpointingConfig? = null,
    onEndpoint: ((AudioEndpointEvent.Endpoint) -> Unit)? = null,
  ): Boolean

  fun stop(
    discardPending: Boolean = false,
    onStopped: (() -> Unit)? = null,
  )
}

class AudioCapture(
  private val context: Context,
  private val scope: CoroutineScope,
  private val sampleRateHz: Int = 24_000,
  private val clock: () -> Long = { System.currentTimeMillis() },
  private val recordFactory: WearAudioRecordFactory = DefaultWearAudioRecordFactory,
) : WearAudioCapture {
  companion object {
    private const val TAG = "OpenClawWearAudioCapture"
    private const val CHUNK_INTERVAL_MS = 200L
    private const val BYTES_PER_SAMPLE = 2
    private const val MILLIS_PER_SECOND = 1_000
  }

  private val recorderRef = AtomicReference<WearAudioRecord?>(null)
  private var recordJob: Job? = null
  private val isRecording = AtomicBoolean(false)
  private val flushPendingOnStopRef = AtomicReference<AtomicBoolean?>(null)
  private var recordingCallback: AudioManagerCallback? = null
  private var captureWriteChannel: Channel<CaptureChunk>? = null
  private var captureWriterJob: Job? = null

  override fun start(
    turnId: String?,
    onChunk: (ByteArray) -> Unit,
    endpointingConfig: AudioEndpointingConfig?,
    onEndpoint: ((AudioEndpointEvent.Endpoint) -> Unit)?,
  ): Boolean {
    // A previous stop() may still be winding down in its finally block; wait
    // for that job to finish releasing the AudioRecord before starting a new one.
    if (recordJob?.isCompleted == false) return false
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

    val minBufferSize = recordFactory.minBufferSize(sampleRateHz)
    if (minBufferSize <= 0) {
      flushPendingOnStopRef.compareAndSet(flushPendingOnStop, null)
      isRecording.set(false)
      Log.w(TAG, "AudioRecord buffer unavailable")
      return false
    }
    val bufferSize = minBufferSize * 2
    val active = recordFactory.create(sampleRateHz, bufferSize)
    if (active == null) {
      flushPendingOnStopRef.compareAndSet(flushPendingOnStop, null)
      isRecording.set(false)
      Log.w(TAG, "AudioRecord unavailable")
      return false
    }
    recorderRef.set(active)
    val detector = endpointingConfig?.let { AudioEndpointDetector(sampleRateHz, it) }
    val endpointRef = AtomicReference<AudioEndpointEvent.Endpoint?>(null)
    val callback =
      AudioManagerCallback { configurations ->
        val activeConfig = configurations.firstOrNull { it.clientAudioSessionId == active.audioSessionId }
        if (activeConfig != null && activeConfig.isClientSilenced) {
          Log.w(TAG, "AudioRecord capture silenced by system")
        }
      }
    active.registerAudioRecordingCallback(context.mainExecutor, callback)
    recordingCallback = callback
    try {
      active.startRecording()
    } catch (err: Throwable) {
      flushPendingOnStopRef.compareAndSet(flushPendingOnStop, null)
      recorderRef.set(null)
      isRecording.set(false)
      active.unregisterAudioRecordingCallback(callback)
      recordingCallback = null
      active.release()
      Log.w(TAG, "startRecording failed: ${err.message}")
      return false
    }

    val captureDirectory = if (isWearAudioCaptureEnabled()) wearCaptureDirectory(context, turnId) else null
    val captureChannel = if (captureDirectory != null) Channel<CaptureChunk>(Channel.BUFFERED) else null
    captureWriteChannel = captureChannel
    captureWriterJob =
      captureChannel?.let { channel ->
        scope.launch(Dispatchers.IO) {
          for (chunk in channel) {
            writeCaptureChunk(chunk)
          }
        }
      }

    val nextRecordJob =
      scope.launch(Dispatchers.IO, start = CoroutineStart.LAZY) {
        val currentRecordJob = coroutineContext[Job]
        val readBuffer = ByteArray(bufferSize)
        // Size the accumulator to fit at least one read() result so a single
        // large AudioRecord read never overflows the fixed chunk buffer.
        val maxChunkBytes =
          maxOf(
            sampleRateHz * BYTES_PER_SAMPLE * CHUNK_INTERVAL_MS.toInt() / MILLIS_PER_SECOND,
            bufferSize,
          )
        val accumulator = ByteArray(maxChunkBytes)
        var accumulatorOffset = 0
        var recordingChunkIndex = 0
        var chunkStartMs = clock()
        val writerJob = captureWriterJob
        try {
          while (isActive && isRecording.get()) {
            val read = active.read(readBuffer, 0, readBuffer.size)
            if (read > 0) {
              if (accumulatorOffset + read <= accumulator.size) {
                readBuffer.copyInto(accumulator, accumulatorOffset, 0, read)
                accumulatorOffset += read
              } else {
                // Accumulator full before interval; flush early so we do not drop audio.
                flushAccumulator(
                  accumulator,
                  accumulatorOffset,
                  recordingChunkIndex,
                  captureDirectory,
                  captureChannel,
                  detector,
                  endpointRef,
                  onChunk,
                )
                recordingChunkIndex++
                accumulatorOffset = 0
                chunkStartMs = clock()
                readBuffer.copyInto(accumulator, 0, 0, read)
                accumulatorOffset = read
              }
            }
            val elapsed = clock() - chunkStartMs
            if (elapsed >= CHUNK_INTERVAL_MS && accumulatorOffset > 0) {
              flushAccumulator(
                accumulator,
                accumulatorOffset,
                recordingChunkIndex,
                captureDirectory,
                captureChannel,
                detector,
                endpointRef,
                onChunk,
              )
              recordingChunkIndex++
              accumulatorOffset = 0
              chunkStartMs = clock()
            }
          }
        } finally {
          if (recorderRef.compareAndSet(active, null)) {
            isRecording.set(false)
            runCatching { active.stop() }
            active.unregisterAudioRecordingCallback(callback)
            recordingCallback = null
            active.release()
          }
          flushPendingOnStopRef.compareAndSet(flushPendingOnStop, null)
          val shouldFlushPending = flushPendingOnStop.getAndSet(true)
          if (shouldFlushPending) {
            detector?.finish()?.let { endpointRef.compareAndSet(null, it) }
            if (accumulatorOffset > 0) {
              flushAccumulator(
                accumulator,
                accumulatorOffset,
                recordingChunkIndex,
                captureDirectory,
                captureChannel,
                detector,
                endpointRef,
                onChunk,
              )
            }
          }
          if (shouldFlushPending) {
            endpointRef.get()?.let { onEndpoint?.invoke(it) }
          }
          captureChannel?.close()
          runCatching { writerJob?.join() }
          captureWriteChannel = null
          captureWriterJob = null
          if (recordJob === currentRecordJob) {
            recordJob = null
          }
        }
      }
    recordJob = nextRecordJob
    nextRecordJob.start()
    return true
  }

  private fun flushAccumulator(
    accumulator: ByteArray,
    size: Int,
    chunkIndex: Int,
    captureDirectory: File?,
    captureChannel: Channel<CaptureChunk>?,
    detector: AudioEndpointDetector?,
    endpointRef: AtomicReference<AudioEndpointEvent.Endpoint?>,
    onChunk: (ByteArray) -> Unit,
  ) {
    if (size <= 0) return
    val chunk = accumulator.copyOf(size)
    captureChannel?.trySend(CaptureChunk(captureDirectory!!, chunkIndex, chunk))
    onChunk(chunk)
    val event = detector?.process(chunk)
    when (event) {
      is AudioEndpointEvent.SpeechStarted ->
        Log.d(
          TAG,
          "speech started totalMs=${event.totalAudioMs} levelDbfs=${"%.1f".format(event.levelDbfs)}",
        )
      is AudioEndpointEvent.Endpoint -> {
        endpointRef.compareAndSet(null, event)
        Log.d(
          TAG,
          "endpoint reason=${event.reason} totalMs=${event.totalAudioMs} speechMs=${event.speechMs} trailingSilenceMs=${event.trailingSilenceMs}",
        )
        isRecording.set(false)
      }
      AudioEndpointEvent.None,
      null,
      -> {}
    }
  }

  private fun writeCaptureChunk(chunk: CaptureChunk) {
    try {
      chunk.directory.mkdirs()
      File(chunk.directory, "recording-${chunk.index.toString().padStart(6, '0')}.pcm").writeBytes(chunk.data)
      appendWearCaptureEvent(chunk.directory, "recordingChunk\t${chunk.index}\t${chunk.data.size}")
    } catch (err: Throwable) {
      Log.w(WEAR_AUDIO_CAPTURE_TAG, "recording capture failed: ${err.message}")
    }
  }

  override fun stop(
    discardPending: Boolean,
    onStopped: (() -> Unit)?,
  ) {
    flushPendingOnStopRef.getAndSet(null)?.set(!discardPending)
    isRecording.set(false)
    // Stop and release the recorder synchronously so the blocking
    // AudioRecord.read() returns and the record job can finish its finally
    // block. The finally block will skip its own release because recorderRef
    // has already been cleared.
    val active = recorderRef.getAndSet(null)
    active?.let {
      runCatching { it.stop() }
      recordingCallback?.let(it::unregisterAudioRecordingCallback)
      recordingCallback = null
      it.release()
    }
    val job = recordJob
    // Don't null recordJob here; the record coroutine's finally block clears it
    // after cleanup completes. That lets start() avoid racing a stop that is
    // still winding down.
    if (onStopped != null) {
      if (job == null) {
        onStopped()
      } else {
        job.invokeOnCompletion { onStopped() }
      }
    }
    job?.cancel()
  }
}

private data class CaptureChunk(
  val directory: File,
  val index: Int,
  val data: ByteArray,
)

private class AudioManagerCallback(
  private val onConfigurationsChanged: (List<android.media.AudioRecordingConfiguration>) -> Unit,
) : AudioManager.AudioRecordingCallback() {
  override fun onRecordingConfigChanged(configs: List<android.media.AudioRecordingConfiguration>) {
    onConfigurationsChanged(configs)
  }
}
