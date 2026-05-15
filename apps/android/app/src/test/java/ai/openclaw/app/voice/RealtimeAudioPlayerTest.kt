package ai.openclaw.app.voice

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RealtimeAudioPlayerTest {
  @Test
  fun boundarySmootherLeavesSmallBoundaryJumpUntouched() {
    val smoother = Pcm16BoundarySmoother(rampSamples = 4, jumpThreshold = 12_000)
    smoother.smooth(pcm16(-8_000, -4_000, 4_000, 10_000))
    val input = pcm16(10_200, 10_300, 10_400)

    val result = smoother.smooth(input)

    assertFalse(result.applied)
    assertArrayEquals(input, result.bytes)
  }

  @Test
  fun boundarySmootherRampsOnlyLargeBoundaryJump() {
    val smoother = Pcm16BoundarySmoother(rampSamples = 4, jumpThreshold = 12_000)
    smoother.smooth(pcm16(10_000, 10_000, 10_000, 10_000))

    val result = smoother.smooth(pcm16(-10_000, -10_000, -10_000, -10_000, -10_000))

    assertTrue(result.applied)
    assertEquals(-20_000, result.jump)
    assertEquals(4, result.rampSamples)
    assertEquals(10_000, result.bytes.readPcm16Test(0))
    assertTrue(result.bytes.readPcm16Test(1) > -10_000)
    assertEquals(-10_000, result.bytes.readPcm16Test(4))
  }

  @Test
  fun boundarySmootherResetPreventsCrossTurnRamp() {
    val smoother = Pcm16BoundarySmoother(rampSamples = 4, jumpThreshold = 12_000)
    smoother.smooth(pcm16(10_000, 10_000, 10_000, 10_000))
    smoother.reset()

    val nextTurn = smoother.smooth(pcm16(-10_000, -10_000, -10_000, -10_000)).bytes

    assertEquals(-10_000, nextTurn.readPcm16Test(0))
    assertEquals(-10_000, nextTurn.readPcm16Test(3))
  }

  private fun pcm16(vararg samples: Short): ByteArray {
    val bytes = ByteArray(samples.size * 2)
    samples.forEachIndexed { index, sample ->
      val value = sample.toInt()
      bytes[index * 2] = (value and 0xff).toByte()
      bytes[index * 2 + 1] = ((value ushr 8) and 0xff).toByte()
    }
    return bytes
  }

  private fun pcm16(vararg samples: Int): ByteArray = pcm16(*samples.map { it.toShort() }.toShortArray())

  private fun ByteArray.readPcm16Test(sampleIndex: Int): Int {
    val byteIndex = sampleIndex * 2
    return ((this[byteIndex].toInt() and 0xff) or (this[byteIndex + 1].toInt() shl 8)).toShort().toInt()
  }
}
