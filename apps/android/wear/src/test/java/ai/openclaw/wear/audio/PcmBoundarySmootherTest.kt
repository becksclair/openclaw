package ai.openclaw.wear.audio

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class PcmBoundarySmootherTest {
  @Test
  fun leavesFirstChunkUnchanged() {
    val smoother = PcmBoundarySmoother(fadeSamples = 4)
    val chunk = pcm(-100, 0, 100)

    assertArrayEquals(chunk, smoother.smooth(chunk))
  }

  @Test
  fun removesBoundaryJumpAtNextChunkStart() {
    val smoother = PcmBoundarySmoother(fadeSamples = 4)
    smoother.smooth(pcm(0, 1000))

    val smoothed = samples(smoother.smooth(pcm(-3000, -3000, -3000, -3000, -3000)))

    assertEquals(1000, smoothed[0])
    assertEquals(0, smoothed[1])
    assertEquals(-1000, smoothed[2])
    assertEquals(-2000, smoothed[3])
    assertEquals(-3000, smoothed[4])
  }

  @Test
  fun signExtendsNegativeSamplesAcrossBoundary() {
    val smoother = PcmBoundarySmoother(fadeSamples = 2)
    smoother.smooth(pcm(Short.MAX_VALUE.toInt()))

    val smoothed = samples(smoother.smooth(pcm(Short.MIN_VALUE.toInt(), Short.MIN_VALUE.toInt())))

    assertEquals(Short.MAX_VALUE.toInt(), smoothed[0])
    assertEquals(0, smoothed[1])
  }

  @Test
  fun resetStartsANewSmoothStream() {
    val smoother = PcmBoundarySmoother(fadeSamples = 4)
    smoother.smooth(pcm(0, 1000))
    smoother.reset()

    assertArrayEquals(pcm(-3000), smoother.smooth(pcm(-3000)))
  }

  private fun pcm(vararg samples: Int): ByteArray {
    val bytes = ByteArray(samples.size * 2)
    for ((index, sample) in samples.withIndex()) {
      val byteIndex = index * 2
      bytes[byteIndex] = sample.toByte()
      bytes[byteIndex + 1] = (sample shr 8).toByte()
    }
    return bytes
  }

  private fun samples(bytes: ByteArray): IntArray {
    val samples = IntArray(bytes.size / 2)
    for (index in samples.indices) {
      val byteIndex = index * 2
      samples[index] = ((bytes[byteIndex].toInt() and 0xff) or (bytes[byteIndex + 1].toInt() shl 8)).toShort().toInt()
    }
    return samples
  }
}
