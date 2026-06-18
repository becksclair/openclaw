package ai.openclaw.wear.speech

import ai.openclaw.wear.assistant.resolveRecognitionServiceComponent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.ResolveInfo
import android.content.pm.ServiceInfo
import android.provider.Settings
import android.speech.RecognitionService
import android.speech.RecognizerIntent
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class SpeechDictationTest {
  private val context = ApplicationProvider.getApplicationContext<Context>()

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
  fun `resolver ignores OpenClaw recognizer stub`() {
    addRecognitionService(context.packageName, "ai.openclaw.wear.assistant.OpenClawRecognitionService")

    assertNull(resolveRecognitionServiceComponent(context))
  }

  @Test
  fun `resolver ignores unconfigured external recognizer`() {
    addRecognitionService(context.packageName, "ai.openclaw.wear.assistant.OpenClawRecognitionService")
    addRecognitionService("com.google.android.tts", "com.google.android.apps.search.assistant.surfaces.voice.robinwear.recognition.GoogleTTSRecognitionService")

    assertNull(resolveRecognitionServiceComponent(context))
  }

  @Test
  fun `resolver preserves configured external recognizer`() {
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
  fun `resolver skips configured OpenClaw recognizer stub without remembered delegate`() {
    addRecognitionService(context.packageName, "ai.openclaw.wear.assistant.OpenClawRecognitionService")
    addRecognitionService("com.google.android.tts", "com.google.android.tts.GoogleTTSRecognitionService")
    Settings.Secure.putString(
      context.contentResolver,
      "voice_recognition_service",
      ComponentName(context.packageName, "ai.openclaw.wear.assistant.OpenClawRecognitionService")
        .flattenToString(),
    )

    assertNull(resolveRecognitionServiceComponent(context))
  }

  @Test
  fun `resolver uses sole platform recognizer when configured recognizer becomes OpenClaw stub`() {
    addRecognitionService(context.packageName, "ai.openclaw.wear.assistant.OpenClawRecognitionService")
    addRecognitionService("com.google.android.tts", "com.google.android.tts.GoogleTTSRecognitionService", platform = true)
    Settings.Secure.putString(
      context.contentResolver,
      "voice_recognition_service",
      ComponentName(context.packageName, "ai.openclaw.wear.assistant.OpenClawRecognitionService")
        .flattenToString(),
    )

    assertEquals(
      ComponentName("com.google.android.tts", "com.google.android.tts.GoogleTTSRecognitionService"),
      resolveRecognitionServiceComponent(context),
    )
  }

  @Test
  fun `resolver uses remembered external recognizer when configured recognizer becomes OpenClaw stub`() {
    addRecognitionService(context.packageName, "ai.openclaw.wear.assistant.OpenClawRecognitionService")
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
      ComponentName(context.packageName, "ai.openclaw.wear.assistant.OpenClawRecognitionService")
        .flattenToString(),
    )

    assertEquals(
      ComponentName("com.google.android.tts", "com.google.android.tts.GoogleTTSRecognitionService"),
      resolveRecognitionServiceComponent(context),
    )
  }

  @Test
  fun `dictation intent waits through longer pauses before ending speech`() {
    val intent = createWearRecognizerIntent(context.packageName)

    assertEquals(
      3_200,
      intent.getIntExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, -1),
    )
    assertEquals(
      2_400,
      intent.getIntExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, -1),
    )
  }

  @Suppress("DEPRECATION")
  private fun addRecognitionService(
    packageName: String,
    className: String,
    platform: Boolean = false,
  ) {
    val resolveInfo =
      ResolveInfo().apply {
        serviceInfo =
          ServiceInfo().apply {
            this.packageName = packageName
            name = className
            applicationInfo =
              ApplicationInfo().apply {
                this.packageName = packageName
                flags = if (platform) ApplicationInfo.FLAG_SYSTEM else 0
              }
          }
      }
    shadowOf(context.packageManager)
      .addResolveInfoForIntent(Intent(RecognitionService.SERVICE_INTERFACE), resolveInfo)
  }
}
