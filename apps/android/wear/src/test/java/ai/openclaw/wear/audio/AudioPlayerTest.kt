package ai.openclaw.wear.audio

import org.junit.Assert.assertEquals
import org.junit.Test

class AudioPlayerTest {
  @Test
  fun `SAMPLE_RATE constant is 24000`() {
    // AudioPlayer is tightly coupled to Android framework AudioTrack.
    // This minimal test verifies the class can be loaded and its constants
    // are what the watch UI and gateway TTS pipeline expect.
    assertEquals(24_000, AudioPlayer.SAMPLE_RATE)
  }

  @Test
  fun `PLAYBACK_SAMPLE_RATE constant is 48000`() {
    assertEquals(48_000, AudioPlayer.PLAYBACK_SAMPLE_RATE)
  }
}
