package ai.openclaw.wear.audio

import ai.openclaw.audio.PcmAudio
import kotlin.math.log10
import kotlin.math.sqrt

data class AudioEndpointingConfig(
  val frameMs: Int = 20,
  val speechStartMs: Int = 100,
  val minSpeechMs: Int = 300,
  val endSilenceMs: Int = 1_500,
  val noSpeechTimeoutMs: Int = 5_000,
  val maxRecordingMs: Int = 30_000,
  val noiseWarmupMs: Int = 300,
  val thresholdAboveNoiseDb: Double = 8.0,
  val absoluteSpeechFloorDbfs: Double = -45.0,
  val relativeSpeechFloorDbfs: Double = -54.0,
)

sealed class AudioEndpointEvent {
  data object None : AudioEndpointEvent()

  data class SpeechStarted(
    val totalAudioMs: Int,
    val levelDbfs: Double,
  ) : AudioEndpointEvent()

  data class Endpoint(
    val reason: AudioEndpointReason,
    val totalAudioMs: Int,
    val speechMs: Int,
    val trailingSilenceMs: Int,
  ) : AudioEndpointEvent()
}

enum class AudioEndpointReason {
  TrailingSilence,
  NoSpeech,
  MaxDuration,
}

class AudioEndpointDetector(
  private val sampleRateHz: Int,
  private val config: AudioEndpointingConfig = AudioEndpointingConfig(),
) {
  companion object {
    private const val BYTES_PER_SAMPLE = 2
    private const val MIN_DBFS = -90.0
  }

  private val samplesPerFrame = ((sampleRateHz * config.frameMs) / 1_000).coerceAtLeast(1)
  private val frameBytes = samplesPerFrame * BYTES_PER_SAMPLE
  private val pendingFrame = ByteArray(frameBytes)
  private var pendingFrameSize = 0

  // Scratch buffer reused in finish() to process a trailing partial frame without allocation.
  private val finishScratch = ByteArray(frameBytes)

  private var totalAudioMs = 0
  private var noiseFloorDbfs = -60.0
  private var voicedMs = 0
  private var speechMs = 0
  private var trailingSilenceMs = 0
  private var speechStarted = false
  private var endpoint: AudioEndpointEvent.Endpoint? = null

  fun process(pcm: ByteArray): AudioEndpointEvent {
    endpoint?.let { return it }
    if (pcm.isEmpty()) return AudioEndpointEvent.None

    var strongestEvent: AudioEndpointEvent = AudioEndpointEvent.None
    for (offset in pcm.indices) {
      pendingFrame[pendingFrameSize] = pcm[offset]
      pendingFrameSize++
      if (pendingFrameSize == frameBytes) {
        val event = processFrame(pendingFrame)
        pendingFrameSize = 0
        if (event is AudioEndpointEvent.Endpoint) return event
        if (event is AudioEndpointEvent.SpeechStarted) {
          strongestEvent = event
        }
      }
    }
    return strongestEvent
  }

  fun finish(): AudioEndpointEvent.Endpoint? {
    endpoint?.let { return it }
    if (pendingFrameSize > 0) {
      finishScratch.fill(0)
      pendingFrame.copyInto(finishScratch, endIndex = pendingFrameSize)
      pendingFrameSize = 0
      processFrame(finishScratch)
    }
    return endpoint
  }

  private fun processFrame(frame: ByteArray): AudioEndpointEvent {
    totalAudioMs += config.frameMs
    val levelDbfs = frameDbfs(frame)
    val warmingUp = !speechStarted && totalAudioMs <= config.noiseWarmupMs
    val isAbsoluteSpeechFrame = levelDbfs >= config.absoluteSpeechFloorDbfs
    val isRelativeSpeechFrame =
      levelDbfs >= config.relativeSpeechFloorDbfs &&
        levelDbfs >= noiseFloorDbfs + config.thresholdAboveNoiseDb
    val isSpeechFrame = isAbsoluteSpeechFrame || (!warmingUp && isRelativeSpeechFrame)
    val warmupSpeechCandidate = isAbsoluteSpeechFrame || isRelativeSpeechFrame

    if (!speechStarted && !isSpeechFrame && (!warmingUp || !warmupSpeechCandidate)) {
      adaptNoiseFloor(levelDbfs, allowRise = warmingUp)
    }

    if (isSpeechFrame) {
      voicedMs += config.frameMs
      trailingSilenceMs = 0
    } else {
      voicedMs = 0
      if (speechStarted) trailingSilenceMs += config.frameMs
    }

    if (!speechStarted && voicedMs >= config.speechStartMs) {
      speechStarted = true
      speechMs = voicedMs
      return AudioEndpointEvent.SpeechStarted(totalAudioMs = totalAudioMs, levelDbfs = levelDbfs)
    }

    if (speechStarted && isSpeechFrame) {
      speechMs += config.frameMs
    }

    if (speechStarted && trailingSilenceMs >= config.endSilenceMs) {
      if (speechMs >= config.minSpeechMs) {
        return endpoint(AudioEndpointReason.TrailingSilence)
      }
      resetShortNoise()
    }

    if (!speechStarted && totalAudioMs >= config.noSpeechTimeoutMs) {
      return endpoint(AudioEndpointReason.NoSpeech)
    }

    if (totalAudioMs >= config.maxRecordingMs) {
      return endpoint(AudioEndpointReason.MaxDuration)
    }

    return AudioEndpointEvent.None
  }

  private fun endpoint(reason: AudioEndpointReason): AudioEndpointEvent.Endpoint {
    val event =
      AudioEndpointEvent.Endpoint(
        reason = reason,
        totalAudioMs = totalAudioMs,
        speechMs = speechMs,
        trailingSilenceMs = trailingSilenceMs,
      )
    endpoint = event
    return event
  }

  private fun resetShortNoise() {
    speechStarted = false
    speechMs = 0
    trailingSilenceMs = 0
    voicedMs = 0
  }

  private fun adaptNoiseFloor(
    levelDbfs: Double,
    allowRise: Boolean,
  ) {
    noiseFloorDbfs =
      when {
        levelDbfs < noiseFloorDbfs -> noiseFloorDbfs * 0.85 + levelDbfs * 0.15
        allowRise -> noiseFloorDbfs * 0.98 + levelDbfs * 0.02
        else -> noiseFloorDbfs
      }
  }

  private fun frameDbfs(frame: ByteArray): Double {
    var sumSquares = 0.0
    var samples = 0
    var offset = 0
    while (offset + 1 < frame.size) {
      val sample = PcmAudio.readPcm16Sample(frame, offset).toDouble()
      sumSquares += sample * sample
      samples++
      offset += BYTES_PER_SAMPLE
    }
    if (samples == 0 || sumSquares == 0.0) return MIN_DBFS
    val rms = sqrt(sumSquares / samples.toDouble())
    return (20.0 * log10(rms / Short.MAX_VALUE.toDouble())).coerceAtLeast(MIN_DBFS)
  }
}
