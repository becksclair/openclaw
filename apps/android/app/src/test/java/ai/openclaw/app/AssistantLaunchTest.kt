package ai.openclaw.app

import android.content.Intent
import android.content.pm.PackageManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AssistantLaunchTest {
  @Test
  fun ignoresPublicAssistGestureIntent() {
    assertNull(parseAssistantLaunchIntent(Intent(Intent.ACTION_ASSIST)))
  }

  @Test
  fun parsesAppActionPrompt() {
    val parsed =
      parseAssistantLaunchIntent(
        Intent(actionAskOpenClaw).putExtra(extraAssistantPrompt, "  summarize my unread texts  "),
      )

    requireNotNull(parsed)
    assertEquals("app_action", parsed.source)
    assertEquals("summarize my unread texts", parsed.prompt)
    assertFalse(parsed.autoSend)
  }

  @Test
  fun ignoresUnrelatedIntents() {
    assertNull(parseAssistantLaunchIntent(Intent(Intent.ACTION_VIEW)))
  }

  @Test
  fun setupGatewayActionIsNotPubliclyRoutable() {
    val context = RuntimeEnvironment.getApplication()
    val resolved =
      context.packageManager.resolveActivity(
        Intent("ai.openclaw.app.action.SETUP_GATEWAY")
          .addCategory(Intent.CATEGORY_DEFAULT)
          .setPackage(context.packageName),
        PackageManager.MATCH_DEFAULT_ONLY,
      )

    assertNull(resolved)
  }
}
