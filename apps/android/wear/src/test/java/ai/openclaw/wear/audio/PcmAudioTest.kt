package ai.openclaw.wear.audio

import ai.openclaw.audio.PcmAudio
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class PcmAudioTest {
  @Test
  fun `pcm16 reader sign extends negative samples`() {
    assertEquals(-32768, CompressedAudioDecoder.readPcm16Sample(byteArrayOf(0x00, 0x80.toByte()), 0))
    assertEquals(-1, CompressedAudioDecoder.readPcm16Sample(byteArrayOf(0xff.toByte(), 0xff.toByte()), 0))
    assertEquals(32767, CompressedAudioDecoder.readPcm16Sample(byteArrayOf(0xff.toByte(), 0x7f), 0))
  }

  @Test
  fun `pcm16 volume gain scales and clips samples`() {
    val pcm = ByteArray(8)
    PcmAudio.writePcm16Sample(pcm, 0, 10)
    PcmAudio.writePcm16Sample(pcm, 2, -10)
    PcmAudio.writePcm16Sample(pcm, 4, 30_000)
    PcmAudio.writePcm16Sample(pcm, 6, -30_000)

    val boosted = PcmAudio.applyPcm16VolumeGain(pcm, 1.5)

    assertEquals(15, PcmAudio.readPcm16Sample(boosted, 0))
    assertEquals(-15, PcmAudio.readPcm16Sample(boosted, 2))
    assertEquals(32767, PcmAudio.readPcm16Sample(boosted, 4))
    assertEquals(-32768, PcmAudio.readPcm16Sample(boosted, 6))
  }

  @Test
  fun `pcm16 volume gain leaves unity input unchanged`() {
    val pcm = byteArrayOf(1, 2, 3)

    assertArrayEquals(pcm, PcmAudio.applyPcm16VolumeGain(pcm, 1.0))
  }
}
