package ai.openclaw.wear.audio

import ai.openclaw.audio.PcmAudio
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioEndpointDetectorTest {
  private val config =
    AudioEndpointingConfig(
      speechStartMs = 100,
      minSpeechMs = 300,
      endSilenceMs = 500,
      maxRecordingMs = 2_000,
      noiseWarmupMs = 200,
    )

  @Test
  fun silenceOnlyEndpointsOnlyAtMaxDuration() {
    val detector = AudioEndpointDetector(SAMPLE_RATE_HZ, config)

    val event = feedUntilEndpoint(detector, silence(2_000))

    assertEquals(AudioEndpointReason.MaxDuration, event?.reason)
    assertEquals(0, event?.speechMs)
  }

  @Test
  fun speechThenSilenceEndpointsOnce() {
    val detector = AudioEndpointDetector(SAMPLE_RATE_HZ, config)

    assertNull(feedUntilEndpoint(detector, silence(200)))
    assertNull(feedUntilEndpoint(detector, tone(600)))
    val endpoint = feedUntilEndpoint(detector, silence(600))

    assertEquals(AudioEndpointReason.TrailingSilence, endpoint?.reason)
    assertTrue((endpoint?.speechMs ?: 0) >= 300)
    assertTrue((endpoint?.trailingSilenceMs ?: 0) >= 500)
    assertEquals(endpoint, feedUntilEndpoint(detector, tone(200)))
  }

  @Test
  fun shortNoiseIsIgnored() {
    val detector = AudioEndpointDetector(SAMPLE_RATE_HZ, config)

    assertNull(feedUntilEndpoint(detector, silence(200)))
    assertNull(feedUntilEndpoint(detector, tone(120)))
    assertNull(feedUntilEndpoint(detector, silence(600)))
  }

  @Test
  fun midPhrasePauseDoesNotEndpoint() {
    val detector = AudioEndpointDetector(SAMPLE_RATE_HZ, config)

    assertNull(feedUntilEndpoint(detector, silence(200)))
    assertNull(feedUntilEndpoint(detector, tone(400)))
    assertNull(feedUntilEndpoint(detector, silence(300)))
    assertNull(feedUntilEndpoint(detector, tone(400)))
    val endpoint = feedUntilEndpoint(detector, silence(600))

    assertEquals(AudioEndpointReason.TrailingSilence, endpoint?.reason)
    assertTrue((endpoint?.speechMs ?: 0) >= 700)
  }

  @Test
  fun maxDurationEndpointsDuringOngoingSpeech() {
    val detector = AudioEndpointDetector(SAMPLE_RATE_HZ, config)

    val endpoint = feedUntilEndpoint(detector, tone(2_200))

    assertEquals(AudioEndpointReason.MaxDuration, endpoint?.reason)
    assertTrue((endpoint?.speechMs ?: 0) > 0)
  }

  @Test
  fun quietSpeechAfterWarmupEndpointsPromptly() {
    val detector = AudioEndpointDetector(SAMPLE_RATE_HZ)

    assertNull(feedUntilEndpoint(detector, silence(500)))
    assertNull(feedUntilEndpoint(detector, tone(durationMs = 1_000, amplitude = 150)))
    val endpoint = feedUntilEndpoint(detector, silence(1_600))

    assertEquals(AudioEndpointReason.TrailingSilence, endpoint?.reason)
    assertTrue((endpoint?.totalAudioMs ?: Int.MAX_VALUE) <= 3_100)
    assertTrue((endpoint?.speechMs ?: 0) >= 300)
  }

  @Test
  fun defaultConfigKeepsRecordingThroughShortPostSpeechPause() {
    val detector = AudioEndpointDetector(SAMPLE_RATE_HZ)

    assertNull(feedUntilEndpoint(detector, silence(500)))
    assertNull(feedUntilEndpoint(detector, tone(durationMs = 900, amplitude = 150)))
    assertNull(feedUntilEndpoint(detector, silence(1_000)))
    val endpoint = feedUntilEndpoint(detector, silence(600))

    assertEquals(AudioEndpointReason.TrailingSilence, endpoint?.reason)
    assertTrue((endpoint?.trailingSilenceMs ?: 0) >= 1_500)
  }

  @Test
  fun calibratedQuietWatchVoiceStartsBeforeNoSpeechTimeout() {
    val detector = AudioEndpointDetector(SAMPLE_RATE_HZ)

    assertNull(feedUntilEndpoint(detector, silence(600)))
    assertNull(feedUntilEndpoint(detector, tone(durationMs = 1_800, amplitude = 70)))
    val endpoint = feedUntilEndpoint(detector, silence(1_600))

    assertEquals(AudioEndpointReason.TrailingSilence, endpoint?.reason)
    assertTrue((endpoint?.speechMs ?: 0) >= 300)
  }

  @Test
  fun quietSpeechDoesNotBecomeNoiseFloorBeforeMaxDuration() {
    val detector = AudioEndpointDetector(SAMPLE_RATE_HZ)

    assertNull(feedUntilEndpoint(detector, silence(500)))
    assertNull(feedUntilEndpoint(detector, tone(durationMs = 4_000, amplitude = 150)))
    val endpoint = feedUntilEndpoint(detector, silence(1_600))

    assertEquals(AudioEndpointReason.TrailingSilence, endpoint?.reason)
    assertTrue((endpoint?.totalAudioMs ?: Int.MAX_VALUE) <= 6_000)
    assertTrue((endpoint?.speechMs ?: 0) >= 3_500)
  }

  @Test
  fun lowLevelMicNoiseDoesNotHoldRecordingOpenAsSpeech() {
    val detector =
      AudioEndpointDetector(
        SAMPLE_RATE_HZ,
        config.copy(
          noSpeechTimeoutMs = 3_000,
          maxRecordingMs = 30_000,
        ),
      )

    assertNull(feedUntilEndpoint(detector, tone(durationMs = 2_800, amplitude = 40)))
    val endpoint = feedUntilEndpoint(detector, tone(durationMs = 400, amplitude = 40))

    assertEquals(AudioEndpointReason.NoSpeech, endpoint?.reason)
    assertEquals(0, endpoint?.speechMs)
  }

  @Test
  fun shortBackgroundSpikeCancelsBeforeMaxDuration() {
    val detector =
      AudioEndpointDetector(
        SAMPLE_RATE_HZ,
        AudioEndpointingConfig(
          noSpeechTimeoutMs = 4_000,
          maxRecordingMs = 30_000,
        ),
      )

    assertNull(feedUntilEndpoint(detector, silence(2_600)))
    assertNull(feedUntilEndpoint(detector, tone(durationMs = 80, amplitude = 120)))
    val endpoint = feedUntilEndpoint(detector, silence(1_400))

    assertEquals(AudioEndpointReason.NoSpeech, endpoint?.reason)
    assertTrue((endpoint?.totalAudioMs ?: Int.MAX_VALUE) < 30_000)
    assertEquals(0, endpoint?.speechMs)
  }

  @Test
  fun burstyWatchSpeechStartsBeforeNoSpeechTimeout() {
    val detector = AudioEndpointDetector(SAMPLE_RATE_HZ)

    assertNull(feedUntilEndpoint(detector, silence(500)))
    assertNull(feedUntilEndpoint(detector, tone(durationMs = 100, amplitude = 105)))
    assertNull(feedUntilEndpoint(detector, silence(400)))
    assertNull(feedUntilEndpoint(detector, tone(durationMs = 100, amplitude = 150)))
    assertNull(feedUntilEndpoint(detector, silence(400)))
    assertNull(feedUntilEndpoint(detector, tone(durationMs = 120, amplitude = 120)))
    val endpoint = feedUntilEndpoint(detector, silence(1_600))

    assertEquals(AudioEndpointReason.TrailingSilence, endpoint?.reason)
    assertTrue((endpoint?.totalAudioMs ?: Int.MAX_VALUE) < 5_000)
    assertTrue((endpoint?.speechMs ?: 0) >= 300)
  }

  @Test
  fun intermittentLowLevelBackgroundAfterSpeechDoesNotHoldRecordingOpen() {
    val detector =
      AudioEndpointDetector(
        SAMPLE_RATE_HZ,
        AudioEndpointingConfig(maxRecordingMs = 30_000),
      )

    assertNull(feedUntilEndpoint(detector, silence(600)))
    assertNull(feedUntilEndpoint(detector, tone(durationMs = 900, amplitude = 120)))
    val endpoint = feedUntilEndpoint(detector, intermittentBackground(durationMs = 4_000))

    assertEquals(AudioEndpointReason.TrailingSilence, endpoint?.reason)
    assertTrue((endpoint?.totalAudioMs ?: Int.MAX_VALUE) < 30_000)
  }

  @Test
  fun processEmptyReturnsNone() {
    val detector = AudioEndpointDetector(SAMPLE_RATE_HZ, config)

    assertEquals(AudioEndpointEvent.None, detector.process(byteArrayOf()))
  }

  @Test
  fun noSpeechTimeoutBeforeSpeechStart() {
    val detector =
      AudioEndpointDetector(
        SAMPLE_RATE_HZ,
        config.copy(noSpeechTimeoutMs = 500, maxRecordingMs = 2_000),
      )

    val endpoint = feedUntilEndpoint(detector, silence(600))

    assertEquals(AudioEndpointReason.NoSpeech, endpoint?.reason)
    assertEquals(0, endpoint?.speechMs)
  }

  @Test
  fun finishFlushesPartialFrameToMaxDurationEndpoint() {
    val detector = AudioEndpointDetector(SAMPLE_RATE_HZ, config.copy(maxRecordingMs = 400))

    detector.process(tone(380))
    detector.process(byteArrayOf(0))
    val endpoint = detector.finish()

    assertEquals(AudioEndpointReason.MaxDuration, endpoint?.reason)
  }

  @Test
  fun endpointIsIdempotentAcrossProcessCalls() {
    val detector = AudioEndpointDetector(SAMPLE_RATE_HZ, config)

    val endpoint = feedUntilEndpoint(detector, tone(2_200))
    requireNotNull(endpoint)

    assertEquals(endpoint, detector.process(tone(200)))
    assertEquals(endpoint, detector.process(silence(200)))
  }

  @Test
  fun finishReturnsCachedEndpoint() {
    val detector = AudioEndpointDetector(SAMPLE_RATE_HZ, config)

    val endpoint = feedUntilEndpoint(detector, tone(2_200))
    requireNotNull(endpoint)

    assertEquals(endpoint, detector.finish())
  }

  @Test
  fun absoluteSpeechLevelIsNotVetoedByRelativeThreshold() {
    val detector =
      AudioEndpointDetector(
        SAMPLE_RATE_HZ,
        config.copy(
          thresholdAboveNoiseDb = 80.0,
          absoluteSpeechFloorDbfs = -45.0,
        ),
      )

    assertNull(feedUntilEndpoint(detector, silence(200)))
    assertNull(feedUntilEndpoint(detector, tone(durationMs = 600, amplitude = 1_000)))
    val endpoint = feedUntilEndpoint(detector, silence(600))

    assertEquals(AudioEndpointReason.TrailingSilence, endpoint?.reason)
    assertTrue((endpoint?.speechMs ?: 0) >= 300)
  }

  private fun feedUntilEndpoint(
    detector: AudioEndpointDetector,
    pcm: ByteArray,
  ): AudioEndpointEvent.Endpoint? {
    val chunkBytes = SAMPLE_RATE_HZ * 2 / 10
    var offset = 0
    while (offset < pcm.size) {
      val end = minOf(offset + chunkBytes, pcm.size)
      val event = detector.process(pcm.copyOfRange(offset, end))
      if (event is AudioEndpointEvent.Endpoint) return event
      offset = end
    }
    return null
  }

  private fun silence(durationMs: Int): ByteArray = ByteArray(bytesFor(durationMs))

  private fun tone(
    durationMs: Int,
    amplitude: Int = 10_000,
  ): ByteArray {
    val samples = SAMPLE_RATE_HZ * durationMs / 1_000
    val bytes = ByteArray(samples * 2)
    for (sample in 0 until samples) {
      val phase = sample % 80
      val value = if (phase < 40) amplitude else -amplitude
      PcmAudio.writePcm16Sample(bytes, sample * 2, value)
    }
    return bytes
  }

  private fun intermittentBackground(durationMs: Int): ByteArray {
    val frames = durationMs / 100
    val bytes = ByteArray(bytesFor(frames * 100))
    var offset = 0
    repeat(frames) {
      val burst = tone(durationMs = 20, amplitude = 55)
      burst.copyInto(bytes, offset)
      offset += bytesFor(100)
    }
    return bytes
  }

  private fun bytesFor(durationMs: Int): Int = SAMPLE_RATE_HZ * durationMs / 1_000 * 2

  private companion object {
    private const val SAMPLE_RATE_HZ = 24_000
  }
}
