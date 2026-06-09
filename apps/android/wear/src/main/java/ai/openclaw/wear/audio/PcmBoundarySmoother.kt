package ai.openclaw.wear.audio

import ai.openclaw.audio.PcmAudio
import kotlin.math.abs
import kotlin.math.roundToInt

internal class PcmBoundarySmoother(
  private val fadeSamples: Int,
) {
  companion object {
    private const val DEFAULT_FADE_MS = 2
    private const val BYTES_PER_SAMPLE = 2

    fun forSampleRate(
      sampleRateHz: Int,
      fadeMs: Int = DEFAULT_FADE_MS,
    ): PcmBoundarySmoother = PcmBoundarySmoother(fadeSamples = sampleRateHz * fadeMs / 1_000)
  }

  private var previousLastSample: Int? = null
  var boundaryCount: Int = 0
    private set

  var maxBoundaryCorrection: Int = 0
    private set

  fun smooth(pcmBytes: ByteArray): ByteArray {
    val sampleCount = pcmBytes.size / BYTES_PER_SAMPLE
    if (sampleCount == 0) return pcmBytes.copyOf()
    val previous = previousLastSample
    if (previous == null || fadeSamples <= 0) {
      previousLastSample = PcmAudio.readPcm16Sample(pcmBytes, (sampleCount - 1) * BYTES_PER_SAMPLE)
      return pcmBytes
    }
    val out = pcmBytes.copyOf()
    val first = PcmAudio.readPcm16Sample(out, 0)
    val correction = previous - first
    boundaryCount++
    maxBoundaryCorrection = maxOf(maxBoundaryCorrection, abs(correction))
    val limit = minOf(fadeSamples, sampleCount)
    for (index in 0 until limit) {
      val weight = (limit - index).toDouble() / limit
      val smoothed = PcmAudio.readPcm16Sample(out, index * BYTES_PER_SAMPLE) + correction * weight
      PcmAudio.writePcm16Sample(
        out,
        index * BYTES_PER_SAMPLE,
        smoothed.roundToInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()),
      )
    }
    previousLastSample = PcmAudio.readPcm16Sample(out, (sampleCount - 1) * BYTES_PER_SAMPLE)
    return out
  }

  fun reset() {
    previousLastSample = null
    boundaryCount = 0
    maxBoundaryCorrection = 0
  }
}
