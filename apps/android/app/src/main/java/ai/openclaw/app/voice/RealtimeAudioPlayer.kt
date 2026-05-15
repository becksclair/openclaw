package ai.openclaw.app.voice

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.util.Base64
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlin.math.abs
import kotlin.math.roundToInt

internal interface RealtimeAudioPlayback {
  suspend fun start()

  suspend fun writeBase64(audioBase64: String)

  suspend fun clear()

  suspend fun waitUntilDrained(timeoutMs: Long = 10_000)

  fun configureJitterBuffer(prebufferMs: Int) = Unit

  fun stop()
}

internal class RealtimeAudioPlayer(
  private val sampleRateHz: Int = 24_000,
) : RealtimeAudioPlayback {
  private companion object {
    private const val initialPrebufferMs = 1_600
    private const val minPrebufferMs = 1_600
    private const val maxPrebufferMs = 2_400
    private const val outputBufferMs = 4_000
    private const val boundaryRampMs = 1
    private const val boundaryJumpThreshold = 12_000
  }

  private val lock = Any()
  private val writeMutex = Mutex()
  private val boundarySmoother =
    Pcm16BoundarySmoother(
      rampSamples = sampleRateHz * boundaryRampMs / 1_000,
      jumpThreshold = boundaryJumpThreshold,
    )
  private var track: AudioTrack? = null
  private var framesWritten = 0L
  private var playbackStarted = false
  private var jitterPrebufferMs = initialPrebufferMs

  override suspend fun start() {
    withContext(Dispatchers.IO) {
      synchronized(lock) {
        if (track != null) return@withContext
        framesWritten = 0L
        val minBufferSize =
          AudioTrack.getMinBufferSize(
            sampleRateHz,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
          )
        if (minBufferSize <= 0) {
          throw IllegalStateException("Realtime AudioTrack buffer unavailable")
        }
        val outputBufferSize = maxOf(minBufferSize * 4, bytesForDurationMs(outputBufferMs))
        val active =
          AudioTrack
            .Builder()
            .setAudioAttributes(
              AudioAttributes
                .Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build(),
            ).setAudioFormat(
              AudioFormat
                .Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(sampleRateHz)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build(),
            ).setTransferMode(AudioTrack.MODE_STREAM)
            .setBufferSizeInBytes(outputBufferSize)
            .build()
        if (active.state != AudioTrack.STATE_INITIALIZED) {
          active.release()
          throw IllegalStateException("Realtime AudioTrack unavailable")
        }
        updateStartThresholdLocked(active)
        track = active
        RealtimeAudioTrace.recordEvent(
          "playback-track-created",
          mapOf(
            "sampleRateHz" to sampleRateHz.toString(),
            "channelCount" to "1",
            "outputBufferBytes" to outputBufferSize.toString(),
          ),
        )
      }
    }
  }

  override fun configureJitterBuffer(prebufferMs: Int) {
    synchronized(lock) {
      jitterPrebufferMs = prebufferMs.coerceIn(minPrebufferMs, maxPrebufferMs)
      track?.let { updateStartThresholdLocked(it) }
    }
  }

  override suspend fun writeBase64(audioBase64: String) {
    val bytes = Base64.decode(audioBase64, Base64.DEFAULT)
    if (bytes.isEmpty()) return
    if (isPcm16Silence(bytes) && synchronized(lock) { !playbackStarted }) return
    withContext(Dispatchers.IO) {
      writeMutex.withLock {
        val active = synchronized(lock) { track } ?: throw CancellationException("realtime playback stopped")
        val smoothing = boundarySmoother.smooth(bytes)
        val outputBytes = smoothing.bytes
        if (smoothing.applied) {
          RealtimeAudioTrace.recordEvent(
            "pcm-boundary-ramp",
            mapOf(
              "jump" to smoothing.jump.toString(),
              "rampSamples" to smoothing.rampSamples.toString(),
            ),
          )
        }
        var offset = 0
        RealtimeAudioTrace.recordAudioChunk(outputBytes)
        while (offset < outputBytes.size) {
          val written = active.write(outputBytes, offset, outputBytes.size - offset)
          if (written < 0) throw IllegalStateException("Realtime AudioTrack write failed")
          if (written == 0) throw CancellationException("realtime playback stalled")
          offset += written
          synchronized(lock) {
            if (track === active) {
              framesWritten += written / 2L
              val bufferedFrames = framesWritten - active.playbackHeadPosition.toLong()
              if (!playbackStarted && bufferedFrames >= prebufferFrames()) {
                startPlaybackLocked(active)
              }
            }
          }
        }
      }
    }
  }

  override suspend fun clear() {
    withContext(Dispatchers.IO) {
      writeMutex.withLock {
        synchronized(lock) {
          track?.let {
            it.pause()
            it.flush()
            framesWritten = it.playbackHeadPosition.toLong()
            playbackStarted = false
            boundarySmoother.reset()
            RealtimeAudioTrace.recordEvent("clear")
          }
        }
      }
    }
  }

  override suspend fun waitUntilDrained(timeoutMs: Long) {
    val startedAt = System.currentTimeMillis()
    while (true) {
      val snapshot = synchronized(lock) { track to framesWritten }
      val active = snapshot.first ?: return
      val targetFrames = snapshot.second
      synchronized(lock) {
        if (track === active && !playbackStarted && targetFrames > active.playbackHeadPosition.toLong()) {
          startPlaybackLocked(active)
        }
      }
      if (active.playbackHeadPosition.toLong() >= targetFrames) {
        writeMutex.withLock {
          synchronized(lock) {
            if (track === active && framesWritten == targetFrames) {
              recordPlaybackState("playback-drained", active, targetFrames)
              active.pause()
              active.flush()
              framesWritten = active.playbackHeadPosition.toLong()
              playbackStarted = false
              boundarySmoother.reset()
            }
          }
        }
        return
      }
      if (System.currentTimeMillis() - startedAt >= timeoutMs) {
        return
      }
      delay(20)
    }
  }

  override fun stop() {
    val active =
      synchronized(lock) {
        playbackStarted = false
        boundarySmoother.reset()
        track.also { track = null }
      }
    RealtimeAudioTrace.recordEvent("stop")
    active?.let {
      recordPlaybackState("playback-stop", it, framesWritten)
      runCatching { it.pause() }
      runCatching { it.flush() }
      runCatching { it.stop() }
      it.release()
    }
  }

  private fun prebufferFrames(): Long = (sampleRateHz * jitterPrebufferMs / 1_000).toLong()

  private fun bytesForDurationMs(durationMs: Int): Int = sampleRateHz * 2 * durationMs / 1_000

  private fun updateStartThresholdLocked(active: AudioTrack) {
    runCatching {
      active.setStartThresholdInFrames(minOf(prebufferFrames(), active.bufferSizeInFrames.toLong() / 2L).toInt())
    }
  }

  private fun startPlaybackLocked(active: AudioTrack) {
    active.play()
    playbackStarted = true
    recordPlaybackState("playback-start", active, framesWritten)
  }

  private fun recordPlaybackState(
    type: String,
    active: AudioTrack,
    targetFrames: Long,
  ) {
    RealtimeAudioTrace.recordEvent(
      type,
      mapOf(
        "targetFrames" to targetFrames.toString(),
        "playbackHeadFrames" to active.playbackHeadPosition.toString(),
        "underruns" to active.underrunCount.toString(),
        "sampleRateHz" to active.sampleRate.toString(),
        "channelCount" to active.channelCount.toString(),
        "bufferSizeFrames" to active.bufferSizeInFrames.toString(),
        "performanceMode" to active.performanceMode.toString(),
        "prebufferMs" to jitterPrebufferMs.toString(),
      ),
    )
  }

  private fun isPcm16Silence(bytes: ByteArray): Boolean {
    if (bytes.size < 2) {
      return false
    }
    var index = 0
    while (index + 1 < bytes.size) {
      if (bytes[index] != 0.toByte() || bytes[index + 1] != 0.toByte()) {
        return false
      }
      index += 2
    }
    return true
  }
}

internal data class Pcm16BoundarySmoothingResult(
  val bytes: ByteArray,
  val applied: Boolean,
  val jump: Int,
  val rampSamples: Int,
)

internal class Pcm16BoundarySmoother(
  private val rampSamples: Int,
  private val jumpThreshold: Int,
) {
  private var previousLastSample: Short? = null

  fun smooth(input: ByteArray): Pcm16BoundarySmoothingResult {
    val sampleCount = input.size / 2
    if (sampleCount <= 0) {
      return Pcm16BoundarySmoothingResult(bytes = input, applied = false, jump = 0, rampSamples = 0)
    }
    val previous = previousLastSample
    previousLastSample = input.readPcm16(sampleCount - 1)
    if (previous == null || rampSamples <= 0) {
      return Pcm16BoundarySmoothingResult(bytes = input, applied = false, jump = 0, rampSamples = 0)
    }

    val first = input.readPcm16(0).toInt()
    val jump = first - previous.toInt()
    if (abs(jump) < jumpThreshold) {
      return Pcm16BoundarySmoothingResult(bytes = input, applied = false, jump = jump, rampSamples = 0)
    }

    val output = input.copyOf()
    val overlap = minOf(rampSamples, sampleCount)
    for (index in 0 until overlap) {
      val weight = (overlap - index).toDouble() / overlap.toDouble()
      val current = output.readPcm16(index).toInt()
      output.writePcm16(index, current - (jump * weight).roundToInt())
    }
    return Pcm16BoundarySmoothingResult(bytes = output, applied = true, jump = jump, rampSamples = overlap)
  }

  fun reset() {
    previousLastSample = null
  }

  private fun ByteArray.readPcm16(sampleIndex: Int): Short {
    val byteIndex = sampleIndex * 2
    return ((this[byteIndex].toInt() and 0xff) or (this[byteIndex + 1].toInt() shl 8)).toShort()
  }

  private fun ByteArray.writePcm16(
    sampleIndex: Int,
    value: Int,
  ) {
    val clamped = value.coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
    val byteIndex = sampleIndex * 2
    this[byteIndex] = (clamped and 0xff).toByte()
    this[byteIndex + 1] = ((clamped ushr 8) and 0xff).toByte()
  }
}
