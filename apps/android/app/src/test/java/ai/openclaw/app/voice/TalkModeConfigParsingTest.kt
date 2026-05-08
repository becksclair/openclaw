package ai.openclaw.app.voice

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Test

class TalkModeConfigParsingTest {
  private val json = Json { ignoreUnknownKeys = true }

  @Test
  fun readsMainSessionKeyAndInterruptFlag() {
    val config =
      json
        .parseToJsonElement(
          """
          {
            "talk": {
              "interruptOnSpeech": true,
              "silenceTimeoutMs": 1800
            },
            "session": {
              "mainKey": "voice-main"
            }
          }
          """.trimIndent(),
        ).jsonObject

    val parsed = TalkModeGatewayConfigParser.parse(config)

    assertEquals("voice-main", parsed.mainSessionKey)
    assertEquals(true, parsed.interruptOnSpeech)
    assertEquals(1800L, parsed.silenceTimeoutMs)
  }

  @Test
  fun readsRealtimeRelayConfigWhenAvailable() {
    val config =
      json
        .parseToJsonElement(
          """
          {
            "realtime": {
              "available": true,
              "provider": "google",
              "model": "gemini-live-2.5-flash",
              "voice": "Puck"
            }
          }
          """.trimIndent(),
        ).jsonObject

    val realtime = TalkModeGatewayConfigParser.parse(config).realtime

    assertEquals("google", realtime?.provider)
    assertEquals("gemini-live-2.5-flash", realtime?.model)
    assertEquals("Puck", realtime?.voice)
  }

  @Test
  fun ignoresUnavailableRealtimeRelayConfig() {
    val config =
      json
        .parseToJsonElement(
          """
          {
            "realtime": {
              "available": false,
              "provider": "google"
            }
          }
          """.trimIndent(),
        ).jsonObject

    assertEquals(null, TalkModeGatewayConfigParser.parse(config).realtime)
  }

  @Test
  fun defaultsSilenceTimeoutMsWhenMissing() {
    assertEquals(
      TalkDefaults.defaultSilenceTimeoutMs,
      TalkModeGatewayConfigParser.resolvedSilenceTimeoutMs(null),
    )
  }

  @Test
  fun defaultsSilenceTimeoutMsWhenInvalid() {
    val talk = buildJsonObject { put("silenceTimeoutMs", 0) }

    assertEquals(
      TalkDefaults.defaultSilenceTimeoutMs,
      TalkModeGatewayConfigParser.resolvedSilenceTimeoutMs(talk),
    )
  }

  @Test
  fun defaultsSilenceTimeoutMsWhenString() {
    val talk = buildJsonObject { put("silenceTimeoutMs", "1500") }

    assertEquals(
      TalkDefaults.defaultSilenceTimeoutMs,
      TalkModeGatewayConfigParser.resolvedSilenceTimeoutMs(talk),
    )
  }
}
