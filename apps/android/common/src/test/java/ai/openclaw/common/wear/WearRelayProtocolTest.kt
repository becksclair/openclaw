package ai.openclaw.common.wear

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

class WearRelayProtocolTest {
  private val json = Json { ignoreUnknownKeys = true }

  @Test
  fun reasoningLevelNormalizationDefaultsMissingAndInvalidValuesToLow() {
    assertEquals(WearReasoningLevel.LOW, WearReasoningLevel.normalize(null))
    assertEquals(WearReasoningLevel.LOW, WearReasoningLevel.normalize(""))
    assertEquals(WearReasoningLevel.LOW, WearReasoningLevel.normalize("unsupported"))
  }

  @Test
  fun reasoningLevelNormalizationAcceptsCanonicalOptions() {
    for (option in WearReasoningLevel.OPTIONS) {
      assertEquals(option, WearReasoningLevel.normalize(option))
    }
  }

  @Test
  fun startPayloadRoundTripsReasoningLevel() {
    val encoded =
      json.encodeToString(
        WearRelayStartPayload(
          acceptedResponseFormats = listOf(WearRelayProtocol.RESPONSE_FORMAT_MP3),
          reasoningLevel = WearReasoningLevel.HIGH,
        ),
      )

    val decoded = json.decodeFromString<WearRelayStartPayload>(encoded)

    assertEquals(WearReasoningLevel.HIGH, decoded.reasoningLevel)
    assertEquals(WearReasoningLevel.HIGH, WearReasoningLevel.normalize(decoded.reasoningLevel))
  }

  @Test
  fun textPayloadRoundTripsReasoningLevel() {
    val encoded =
      json.encodeToString(
        WearRelayTextPayload(
          text = "hello",
          acceptedResponseFormats = listOf(WearRelayProtocol.RESPONSE_FORMAT_MP3),
          reasoningLevel = WearReasoningLevel.MINIMAL,
        ),
      )

    val decoded = json.decodeFromString<WearRelayTextPayload>(encoded)

    assertEquals(WearReasoningLevel.MINIMAL, decoded.reasoningLevel)
    assertEquals(WearReasoningLevel.MINIMAL, WearReasoningLevel.normalize(decoded.reasoningLevel))
  }
}
