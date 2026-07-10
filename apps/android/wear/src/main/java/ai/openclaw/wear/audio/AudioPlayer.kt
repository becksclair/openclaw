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
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
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
  }

  private val activeTrack = AtomicReference<AudioTrack?>(null)
  private val playbackGeneration = AtomicInteger(0)

  // Single dedicated thread for blocking AudioTrack HAL teardown so a slow
  // vendor pause()/flush()/stop()/release() never janks the caller (often
  // Main.immediate via viewModelScope).
  private val audioDispatcher = Dispatchers.IO.limitedParallelism(1)
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
          // CAS still gates the single release; serialize the blocking HAL
          // teardown on the audio dispatcher (NonCancellable so a cancelled
          // job still releases instead of leaking the AudioTrack).
          if (activeTrack.compareAndSet(track, null)) {
            withContext(NonCancellable + audioDispatcher) { releaseTrack(track) }
          }
          if (shouldFail) {
            completeIfCurrent(generation, onError)
          } else if (shouldComplete) {
            completeIfCurrent(generation, onComplete)
          }
        }
      }
  }

  fun stop() {
    // Synchronous, cheap ownership/cancellation flips: bumping the generation
    // and cancelling the job keep completeIfCurrent() correct; getAndSet claims
    // the track so a late teardown cannot clobber a newer playback.
    playbackGeneration.incrementAndGet()
    playJob?.cancel()
    playJob = null
    acousticDebugCapture.stop()
    // Blocking HAL teardown runs off the caller thread (often Main.immediate).
    val track = activeTrack.getAndSet(null)
    if (track != null) {
      // NonCancellable so teardown still runs when stop() is reached after the
      // scope is cancelled (e.g. ViewModel.onCleared); otherwise launch on a
      // cancelled scope is cancelled-on-arrival and leaks the AudioTrack.
      scope.launch(NonCancellable + audioDispatcher) { releaseTrack(track) }
    }
  }

  private fun resamplePcm16Mono24kTo48k(pcmBytes: ByteArray): ByteArray =
    PcmAudio.resamplePcm16ToMono(
      pcmBytes,
      sampleRateHz = SAMPLE_RATE,
      channels = 1,
      targetSampleRateHz = PLAYBACK_SAMPLE_RATE,
    )

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

  private fun releaseTrack(track: AudioTrack) {
    runCatching { track.pause() }
    runCatching { track.flush() }
    runCatching { track.stop() }
    runCatching { track.release() }
  }
}
