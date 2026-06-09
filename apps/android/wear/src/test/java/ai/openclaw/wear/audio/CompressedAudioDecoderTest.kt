package ai.openclaw.wear.audio

import org.junit.Assert.assertEquals
import org.junit.Test

class CompressedAudioDecoderTest {
  @Test
  fun `pcm16 reader sign extends negative samples`() {
    assertEquals(-32768, CompressedAudioDecoder.readPcm16Sample(byteArrayOf(0x00, 0x80.toByte()), 0))
    assertEquals(-1, CompressedAudioDecoder.readPcm16Sample(byteArrayOf(0xff.toByte(), 0xff.toByte()), 0))
    assertEquals(32767, CompressedAudioDecoder.readPcm16Sample(byteArrayOf(0xff.toByte(), 0x7f), 0))
  }
}
