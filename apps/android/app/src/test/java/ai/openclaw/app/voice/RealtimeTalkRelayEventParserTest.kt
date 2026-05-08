package ai.openclaw.app.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RealtimeTalkRelayEventParserTest {
  @Test
  fun parsesCloseReason() {
    val parsed =
      RealtimeTalkRelayEventParser.parse(
        """
        {
          "relaySessionId": "relay-1",
          "type": "close",
          "reason": "error"
        }
        """.trimIndent(),
      )

    assertEquals("relay-1", parsed?.first)
    val event = parsed?.second
    assertTrue(event is RealtimeTalkRelayEvent.Close)
    assertEquals("error", (event as RealtimeTalkRelayEvent.Close).reason)
  }
}
