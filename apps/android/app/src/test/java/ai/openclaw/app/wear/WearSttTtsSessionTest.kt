package ai.openclaw.app.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WearSttTtsSessionTest {
  @Test
  fun resolveWearFinalAudioWaitMs_usesShortGraceWhenTextCanFallbackToSpeak() {
    assertEquals(0L, resolveWearFinalAudioWaitMs(finalEventReceived = false, assistantText = null))
    assertEquals(
      2_000L,
      resolveWearFinalAudioWaitMs(finalEventReceived = true, assistantText = "assistant reply"),
    )
    assertEquals(15_000L, resolveWearFinalAudioWaitMs(finalEventReceived = true, assistantText = ""))
  }

  @Test
  fun isOggOpusGatewayAudio_rejectsGenericOggContainers() {
    assertFalse(
      isOggOpusGatewayAudio(
        outputFormat = "ogg",
        mimeType = "audio/ogg",
        fileExtension = ".ogg",
      ),
    )
    assertFalse(
      isOggOpusGatewayAudio(
        outputFormat = "notopus",
        mimeType = "audio/ogg",
        fileExtension = ".ogg",
      ),
    )
  }

  @Test
  fun isOggOpusGatewayAudio_acceptsOpusMetadata() {
    assertTrue(
      isOggOpusGatewayAudio(
        outputFormat = "opus",
        mimeType = "audio/ogg",
        fileExtension = ".opus",
      ),
    )
    assertTrue(
      isOggOpusGatewayAudio(
        outputFormat = "opus_24000",
        mimeType = "audio/ogg",
        fileExtension = ".ogg",
      ),
    )
    assertTrue(
      isOggOpusGatewayAudio(
        outputFormat = "ogg_opus",
        mimeType = "audio/ogg",
        fileExtension = ".ogg",
      ),
    )
    assertTrue(
      isOggOpusGatewayAudio(
        outputFormat = null,
        mimeType = "audio/ogg; codecs=opus",
        fileExtension = ".ogg",
      ),
    )
  }
}
