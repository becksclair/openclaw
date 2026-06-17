package ai.openclaw.app.assistant

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ResolveInfo
import android.content.pm.ServiceInfo
import android.provider.Settings
import android.speech.RecognitionService
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PhoneAssistantEntryTest {
  private val context = RuntimeEnvironment.getApplication() as Context

  @Before
  fun clearRecognizerSetting() {
    Settings.Secure.putString(context.contentResolver, "voice_recognition_service", null)
    context
      .getSharedPreferences("openclaw.assistant", Context.MODE_PRIVATE)
      .edit()
      .clear()
      .commit()
  }

  @Test
  fun recognizesOnlyPublicAssistActionAsForegroundIntent() {
    assertTrue(isAssistantLaunchIntent(Intent(Intent.ACTION_ASSIST)))
    assertFalse(isAssistantLaunchIntent(Intent("ai.openclaw.app.action.ASK_OPENCLAW")))
    assertFalse(isAssistantLaunchIntent(Intent(Intent.ACTION_VIEW)))
  }

  @Test
  fun trustedBridgeConsumesOneShotStart() {
    AssistantTrustedStartBridge.requestStart()

    assertTrue(AssistantTrustedStartBridge.consumePendingStart())
    assertFalse(AssistantTrustedStartBridge.consumePendingStart())
  }

  @Test
  fun roleHelpersTolerateUnavailablePlatformRole() {
    val status = assistantRoleStatus(context)

    assertFalse(status.held && !status.available)
  }

  @Test
  fun roleRequestIntentNullWhenRoleUnavailable() {
    assertNull(createAssistantRoleRequestIntent(context))
  }

  @Test
  fun resolverIgnoresOpenClawRecognizerStub() {
    addRecognitionService(context.packageName, "ai.openclaw.app.assistant.OpenClawRecognitionService")

    assertNull(resolveRecognitionServiceComponent(context))
  }

  @Test
  fun resolverIgnoresUnconfiguredExternalRecognizer() {
    addRecognitionService(context.packageName, "ai.openclaw.app.assistant.OpenClawRecognitionService")
    addRecognitionService("com.google.android.tts", "com.google.android.apps.search.assistant.surfaces.voice.robinwear.recognition.GoogleTTSRecognitionService")

    assertNull(resolveRecognitionServiceComponent(context))
  }

  @Test
  fun resolverPreservesConfiguredExternalRecognizer() {
    addRecognitionService("com.other.recognizer", "com.other.recognizer.Service")
    addRecognitionService("com.google.android.tts", "com.google.android.tts.GoogleTTSRecognitionService")
    Settings.Secure.putString(
      context.contentResolver,
      "voice_recognition_service",
      ComponentName("com.google.android.tts", "com.google.android.tts.GoogleTTSRecognitionService")
        .flattenToString(),
    )

    assertEquals(
      ComponentName("com.google.android.tts", "com.google.android.tts.GoogleTTSRecognitionService"),
      resolveRecognitionServiceComponent(context),
    )
  }

  @Test
  fun resolverSkipsConfiguredOpenClawRecognizerStub() {
    addRecognitionService(context.packageName, "ai.openclaw.app.assistant.OpenClawRecognitionService")
    addRecognitionService("com.google.android.tts", "com.google.android.tts.GoogleTTSRecognitionService")
    Settings.Secure.putString(
      context.contentResolver,
      "voice_recognition_service",
      ComponentName(context.packageName, "ai.openclaw.app.assistant.OpenClawRecognitionService")
        .flattenToString(),
    )

    assertEquals(
      ComponentName("com.google.android.tts", "com.google.android.tts.GoogleTTSRecognitionService"),
      resolveRecognitionServiceComponent(context),
    )
  }

  @Test
  fun resolverUsesRememberedExternalRecognizerWhenConfiguredRecognizerBecomesOpenClawStub() {
    addRecognitionService(context.packageName, "ai.openclaw.app.assistant.OpenClawRecognitionService")
    addRecognitionService("com.google.android.tts", "com.google.android.tts.GoogleTTSRecognitionService")
    Settings.Secure.putString(
      context.contentResolver,
      "voice_recognition_service",
      ComponentName("com.google.android.tts", "com.google.android.tts.GoogleTTSRecognitionService")
        .flattenToString(),
    )
    assertEquals(
      ComponentName("com.google.android.tts", "com.google.android.tts.GoogleTTSRecognitionService"),
      resolveRecognitionServiceComponent(context),
    )

    Settings.Secure.putString(
      context.contentResolver,
      "voice_recognition_service",
      ComponentName(context.packageName, "ai.openclaw.app.assistant.OpenClawRecognitionService")
        .flattenToString(),
    )

    assertEquals(
      ComponentName("com.google.android.tts", "com.google.android.tts.GoogleTTSRecognitionService"),
      resolveRecognitionServiceComponent(context),
    )
  }

  @Suppress("DEPRECATION")
  private fun addRecognitionService(
    packageName: String,
    className: String,
  ) {
    val resolveInfo =
      ResolveInfo().apply {
        serviceInfo =
          ServiceInfo().apply {
            this.packageName = packageName
            name = className
          }
      }
    shadowOf(context.packageManager)
      .addResolveInfoForIntent(Intent(RecognitionService.SERVICE_INTERFACE), resolveInfo)
  }
}
