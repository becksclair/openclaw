package ai.openclaw.app.ui.chat

import org.junit.Assert.assertEquals
import org.junit.Test

class ChatScreenLayoutTest {
  @Test
  fun chatScreenBubblesUsePhoneWidthContract() {
    assertEquals(0.85f, CHAT_SCREEN_BUBBLE_WIDTH_FRACTION, 0.001f)
  }
}
