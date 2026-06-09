package ai.openclaw.wear.audio

import ai.openclaw.audio.PcmAudio
import android.content.Context
import android.media.AudioTrack
import android.os.Build
import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.ByteArrayOutputStream
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

class AudioPlayer(
  context: Context,
  private val scope: CoroutineScope,
) {
  companion object {
    private const val TAG = "OpenClawWearAudioPlayer"
    internal const val SAMPLE_RATE = 24_000
    internal const val PLAYBACK_SAMPLE_RATE = 48_000
    private const val BYTES_PER_SAMPLE = 2
    private const val STREAM_BUFFER_MULTIPLIER = 4
    private const val STREAM_PRIME_MULTIPLIER = 2
    private const val STREAM_PRIME_MS = 2_000
    private const val STREAM_BUFFER_MS = STREAM_PRIME_MS * 2

    internal data class StreamBufferSizes(
      val primeBufferSize: Int,
      val streamBufferSize: Int,
    )

    internal fun computeStreamBufferSizes(minBufferSize: Int): StreamBufferSizes? {
      if (minBufferSize <= 0) return null
      val primeBufferSize =
        maxOf(
          minBufferSize * STREAM_PRIME_MULTIPLIER,
          bytesForDurationMs(STREAM_PRIME_MS),
        )
      val streamBufferSize =
        maxOf(
          minBufferSize * STREAM_BUFFER_MULTIPLIER,
          bytesForDurationMs(STREAM_BUFFER_MS),
          primeBufferSize * 2,
        )
      return StreamBufferSizes(
        primeBufferSize = primeBufferSize,
        streamBufferSize = streamBufferSize,
      )
    }

    private fun bytesForDurationMs(durationMs: Int): Int {
      val bytes = PLAYBACK_SAMPLE_RATE * BYTES_PER_SAMPLE * durationMs / 1_000
      return bytes - (bytes % BYTES_PER_SAMPLE)
    }
  }

  private val activeTrack = AtomicReference<AudioTrack?>(null)
  private val activeStream = AtomicReference<Channel<ByteArray>?>(null)
  private val playbackGeneration = AtomicInteger(0)
  private val audioTrackFactory = AudioTrackFactory(PLAYBACK_SAMPLE_RATE)
  private val playbackDebugCapture = PlaybackAudioDebugCapture(context)
  private val acousticDebugCapture = AcousticAudioDebugCapture(context, scope)

  @Volatile private var playJob: Job? = null

  fun play(
    pcmBytes: ByteArray,
    onComplete: () -> Unit,
    onError: () -> Unit = onComplete,
    debugTurnId: String? = null,
  ) {
    playWholeBuffer(pcmBytes, onComplete = onComplete, onError = onError, debugTurnId = debugTurnId)
  }

  fun playPcm48k(
    pcmBytes: ByteArray,
    onComplete: () -> Unit,
    onError: () -> Unit = onComplete,
    debugTurnId: String? = null,
  ) {
    playWholeBuffer(pcmBytes, resampleInput = false, onComplete = onComplete, onError = onError, debugTurnId = debugTurnId)
  }

  private fun playWholeBuffer(
    pcmBytes: ByteArray,
    resampleInput: Boolean = true,
    onComplete: () -> Unit,
    onError: () -> Unit,
    debugTurnId: String?,
  ) {
    stop()
    val playbackBytes = if (resampleInput) resamplePcm16Mono24kTo48k(pcmBytes) else pcmBytes
    val playableBytes = playbackBytes.size - (playbackBytes.size % BYTES_PER_SAMPLE)
    if (playableBytes <= 0) {
      onComplete()
      return
    }
    val generation = playbackGeneration.incrementAndGet()
    playJob =
      scope.launch(Dispatchers.IO) {
        val minBufferSize =
          audioTrackFactory.minBufferSize()
        if (minBufferSize <= 0) {
          completeIfCurrent(generation, onError)
          return@launch
        }
        val track =
          try {
            audioTrackFactory.create(maxOf(minBufferSize, playableBytes))
          } catch (err: Throwable) {
            Log.w(TAG, "AudioTrack unavailable: ${err.message}")
            completeIfCurrent(generation, onError)
            return@launch
          }
        activeTrack.set(track)
        var shouldComplete = false
        var shouldFail = false
        try {
          val bytes = if (playableBytes == playbackBytes.size) playbackBytes else playbackBytes.copyOf(playableBytes)
          playbackDebugCapture.capturePlaybackChunk(debugTurnId, 0, bytes)
          var offset = 0
          while (offset < bytes.size) {
            val startedAtMs = System.currentTimeMillis()
            val written = track.write(bytes, offset, bytes.size - offset, AudioTrack.WRITE_BLOCKING)
            val endedAtMs = System.currentTimeMillis()
            if (written < 0) throw IllegalStateException("AudioTrack write failed: $written")
            if (written == 0) throw IllegalStateException("AudioTrack write made no progress")
            offset += written
            playbackDebugCapture.capturePlaybackEvent(
              debugTurnId,
              "playbackWrite	$written	${bytes.size - offset + written}	${endedAtMs - startedAtMs}	${track.playState}	0	${track.playbackHeadPosition}	${offset / BYTES_PER_SAMPLE}",
            )
          }
          val totalFrames = offset / BYTES_PER_SAMPLE
          setStartThreshold(track, totalFrames)
          acousticDebugCapture.start(debugTurnId)
          track.play()
          val durationMs = totalFrames * 1_000L / PLAYBACK_SAMPLE_RATE
          Log.d(TAG, "playing whole pcm frames=$totalFrames durationMs=$durationMs")
          val playbackWaitStartedAtMs = System.currentTimeMillis()
          val maxPlaybackWaitMs = durationMs + 1_000L
          while (track.playState == AudioTrack.PLAYSTATE_PLAYING) {
            if (track.playbackHeadPosition >= totalFrames) break
            if (System.currentTimeMillis() - playbackWaitStartedAtMs >= maxPlaybackWaitMs) {
              Log.w(TAG, "whole playback completion timed out frames=${track.playbackHeadPosition}/$totalFrames")
              break
            }
            delay(75)
          }
          val underruns = runCatching { track.underrunCount }.getOrDefault(0)
          Log.d(TAG, "whole playback complete frames=${track.playbackHeadPosition}/$totalFrames underruns=$underruns bytes=$playableBytes")
          shouldComplete = true
        } catch (err: CancellationException) {
          throw err
        } catch (err: Throwable) {
          Log.w(TAG, "playback failed: ${err.message}")
          shouldFail = true
        } finally {
          acousticDebugCapture.stop()
          releaseActiveTrack(track)
          if (shouldFail) {
            completeIfCurrent(generation, onError)
          } else if (shouldComplete) {
            completeIfCurrent(generation, onComplete)
          }
        }
      }
  }

  fun startStream(
    onComplete: () -> Unit,
    onError: () -> Unit = onComplete,
    debugTurnId: String? = null,
  ) {
    stop()
    val generation = playbackGeneration.incrementAndGet()
    val stream = Channel<ByteArray>(Channel.BUFFERED)
    activeStream.set(stream)
    playJob =
      scope.launch(Dispatchers.IO) {
        val minBufferSize =
          audioTrackFactory.minBufferSize()
        if (minBufferSize <= 0) {
          failIfCurrent(generation, stream, onError)
          return@launch
        }

        val requestedBufferSizes =
          computeStreamBufferSizes(minBufferSize) ?: run {
            failIfCurrent(generation, stream, onError)
            return@launch
          }
        val track =
          try {
            audioTrackFactory.create(requestedBufferSizes.streamBufferSize)
          } catch (err: Throwable) {
            Log.w(TAG, "AudioTrack unavailable: ${err.message}")
            failIfCurrent(generation, stream, onError)
            return@launch
          }
        val streamBufferSize =
          maxOf(track.bufferSizeInFrames * BYTES_PER_SAMPLE, minBufferSize)
        // Provider chunks often arrive slower than real time on Wear. Prime enough audio
        // to absorb chunk jitter, but never more than half the actual AudioTrack ring.
        val primeBufferSize =
          minOf(
            requestedBufferSizes.primeBufferSize,
            streamBufferSize / 2,
          )

        activeTrack.set(track)
        var shouldComplete = false
        var shouldFail = false
        try {
          // Pre-size to absorb prime + one stream buffer without doubling reallocations.
          val pending = ByteArrayOutputStream(streamBufferSize)
          val boundarySmoother = PcmBoundarySmoother.forSampleRate(SAMPLE_RATE)
          var totalFrames = 0
          var started = false
          var chunkCount = 0
          var receivedBytes = 0
          Log.d(
            TAG,
            "stream playback starting minBuffer=$minBufferSize primeBuffer=$primeBufferSize streamBuffer=$streamBufferSize",
          )
          // On API 31+ we use setStartThresholdInFrames so we can call track.play()
          // BEFORE writing prime bytes. That removes the only window where
          // WRITE_BLOCKING could stall: if a device returns a smaller-than-requested
          // ring, our prime write would otherwise sit in AudioTrack with no way to
          // drain because play() had not yet been called. With the threshold set,
          // play() is a no-op until enough frames have been queued, so the write
          // can drain into the ring naturally.
          val canPrimeBeforePlay = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
          val primeFrames = primeBufferSize / BYTES_PER_SAMPLE
          if (canPrimeBeforePlay && primeFrames > 0) {
            setStartThreshold(track, primeFrames)
            acousticDebugCapture.start(debugTurnId)
            track.play()
            started = true
            Log.d(TAG, "stream playback armed primeFrames=$primeFrames startThresholdActive=true")
          }
          for (chunk in stream) {
            if (chunk.isEmpty()) continue
            val playbackChunkIndex = chunkCount
            chunkCount++
            receivedBytes += chunk.size
            val smoothedChunk = resamplePcm16Mono24kTo48k(boundarySmoother.smooth(chunk))
            playbackDebugCapture.capturePlaybackChunk(debugTurnId, playbackChunkIndex, smoothedChunk)
            pending.write(smoothedChunk)
            if (!started && pending.size() < primeBufferSize) continue
            if (!started) {
              // API 30 fallback path: prime is bounded at ring/2 so the blocking
              // write fits without play() being called yet.
              val primedFrames = writePending(track, pending, streamBufferSize, primeBufferSize, debugTurnId, totalFrames)
              totalFrames += primedFrames
              setStartThreshold(track, primedFrames)
              acousticDebugCapture.start(debugTurnId)
              track.play()
              started = true
              Log.d(TAG, "stream playback primed bufferedMs=${primedFrames * 1_000L / PLAYBACK_SAMPLE_RATE} chunks=$chunkCount")
              totalFrames += writePending(track, pending, streamBufferSize, debugTurnId = debugTurnId, writtenFramesBefore = totalFrames)
            } else {
              totalFrames += writePending(track, pending, streamBufferSize, debugTurnId = debugTurnId, writtenFramesBefore = totalFrames)
            }
          }
          if (pending.size() > 0) {
            totalFrames += writePending(track, pending, streamBufferSize, debugTurnId = debugTurnId, writtenFramesBefore = totalFrames)
            if (!started) {
              setStartThreshold(track, totalFrames)
              acousticDebugCapture.start(debugTurnId)
              track.play()
              started = true
            }
          }
          if (started) {
            val durationMs = totalFrames * 1_000L / PLAYBACK_SAMPLE_RATE
            Log.d(TAG, "playing streamed pcm frames=$totalFrames durationMs=$durationMs")
            val playbackWaitStartedAtMs = System.currentTimeMillis()
            val maxPlaybackWaitMs = durationMs + 1_000L
            while (track.playState == AudioTrack.PLAYSTATE_PLAYING) {
              if (track.playbackHeadPosition >= totalFrames) {
                break
              }
              if (System.currentTimeMillis() - playbackWaitStartedAtMs >= maxPlaybackWaitMs) {
                Log.w(TAG, "playback completion timed out frames=${track.playbackHeadPosition}/$totalFrames")
                break
              }
              delay(75)
            }
            val underruns = runCatching { track.underrunCount }.getOrDefault(0)
            Log.d(
              TAG,
              "playback complete frames=${track.playbackHeadPosition}/$totalFrames underruns=$underruns chunks=$chunkCount bytes=$receivedBytes " +
                "smoothedBoundaries=${boundarySmoother.boundaryCount} maxBoundaryCorrection=${boundarySmoother.maxBoundaryCorrection}",
            )
          }
          shouldComplete = true
        } catch (err: CancellationException) {
          throw err
        } catch (err: Throwable) {
          Log.w(TAG, "playback failed: ${err.message}")
          shouldFail = true
        } finally {
          acousticDebugCapture.stop()
          releaseActiveTrack(track)
          if (shouldFail) {
            failIfCurrent(generation, stream, onError)
          } else if (shouldComplete) {
            completeIfCurrent(generation, onComplete)
          }
        }
      }
  }

  /**
   * Appends a chunk to the active stream. The caller must not reuse [pcmBytes]
   * after this call returns; ownership transfers to the AudioPlayer.
   */
  fun appendStream(pcmBytes: ByteArray): Boolean {
    if (pcmBytes.isEmpty()) return true
    return activeStream.get()?.trySend(pcmBytes)?.isSuccess == true
  }

  fun finishStream() {
    activeStream.getAndSet(null)?.close()
  }

  fun stop() {
    playbackGeneration.incrementAndGet()
    playJob?.cancel()
    playJob = null
    activeStream.getAndSet(null)?.cancel()
    acousticDebugCapture.stop()
    activeTrack.getAndSet(null)?.let(::releaseTrack)
  }

  private suspend fun writePending(
    track: AudioTrack,
    pending: ByteArrayOutputStream,
    streamBufferSize: Int,
    maxBytes: Int = Int.MAX_VALUE,
    debugTurnId: String? = null,
    writtenFramesBefore: Int = 0,
  ): Int {
    val bytes = pending.toByteArray()
    pending.reset()
    val bytesToWrite = minOf(bytes.size, maxBytes)
    if (bytesToWrite < bytes.size) {
      pending.write(bytes, bytesToWrite, bytes.size - bytesToWrite)
    }
    var offset = 0
    var zeroWriteCount = 0
    while (offset < bytesToWrite) {
      val size = minOf(streamBufferSize, bytesToWrite - offset)
      val startedAtMs = System.currentTimeMillis()
      val headBefore = track.playbackHeadPosition
      val written = track.write(bytes, offset, size, AudioTrack.WRITE_BLOCKING)
      val endedAtMs = System.currentTimeMillis()
      if (written < 0) throw IllegalStateException("AudioTrack write failed: $written")
      if (written == 0) {
        playbackDebugCapture.capturePlaybackEvent(
          debugTurnId,
          "playbackWrite\t0\t$size\t${endedAtMs - startedAtMs}\t${track.playState}\t$headBefore\t${track.playbackHeadPosition}\t0",
        )
        zeroWriteCount += 1
        if (zeroWriteCount > 50) throw IllegalStateException("AudioTrack write made no progress")
        delay(10)
        continue
      }
      zeroWriteCount = 0
      offset += written
      val writtenFramesAfter = writtenFramesBefore + offset / BYTES_PER_SAMPLE
      val headAfter = track.playbackHeadPosition
      playbackDebugCapture.capturePlaybackEvent(
        debugTurnId,
        "playbackWrite	$written	$size	${endedAtMs - startedAtMs}	${track.playState}	$headBefore	$headAfter	${writtenFramesAfter - headAfter}",
      )
    }
    return bytesToWrite / BYTES_PER_SAMPLE
  }

  private fun resamplePcm16Mono24kTo48k(pcmBytes: ByteArray): ByteArray =
    PcmAudio.resamplePcm16ToMono(
      pcmBytes,
      sampleRateHz = SAMPLE_RATE,
      channels = 1,
      targetSampleRateHz = PLAYBACK_SAMPLE_RATE,
    )

  private fun releaseActiveTrack(track: AudioTrack) {
    if (activeTrack.compareAndSet(track, null)) {
      releaseTrack(track)
    }
  }

  private fun setStartThreshold(
    track: AudioTrack,
    frames: Int,
  ) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || frames <= 0) return
    runCatching { track.setStartThresholdInFrames(frames) }
  }

  private fun completeIfCurrent(
    generation: Int,
    onComplete: () -> Unit,
  ) {
    if (playbackGeneration.get() == generation) {
      onComplete()
    }
  }

  private fun failIfCurrent(
    generation: Int,
    stream: Channel<ByteArray>,
    onError: () -> Unit,
  ) {
    activeStream.compareAndSet(stream, null)
    stream.cancel()
    if (playbackGeneration.get() == generation) {
      onError()
    }
  }

  private fun releaseTrack(track: AudioTrack) {
    runCatching { track.pause() }
    runCatching { track.flush() }
    runCatching { track.stop() }
    runCatching { track.release() }
  }
}
