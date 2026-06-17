package ai.openclaw.wear.assistant

import android.app.Application
import android.content.Intent
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class WatchAssistantEntryTest {
  @Test
  fun `assist action is assistant launch intent`() {
    assertTrue(isAssistantLaunchIntent(Intent(Intent.ACTION_ASSIST)))
  }

  @Test
  fun `launcher intent is not assistant launch intent`() {
    assertFalse(isAssistantLaunchIntent(Intent(Intent.ACTION_MAIN)))
  }

  @Test
  fun `spoofed auto start extra is not assistant launch intent`() {
    assertFalse(isAssistantLaunchIntent(Intent().putExtra("openclaw.assistant.autoStart", true)))
  }

  @Test
  fun `null intent is not assistant launch intent`() {
    assertFalse(isAssistantLaunchIntent(null))
  }

  @Test
  fun `role helpers tolerate unavailable platform role`() {
    val context = Application()

    val status = assistantRoleStatus(context)

    assertFalse(status.held && !status.available)
    if (status.available) {
      assertNotNull(createAssistantRoleRequestIntent(context))
    }
  }
}
