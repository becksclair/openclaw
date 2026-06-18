package ai.openclaw.app.assistant

/**
 * Assistant role and recognition-service helpers for the phone app.
 * Kept in sync with the wear copy at wear/src/main/java/ai/openclaw/wear/assistant/WatchAssistantEntry.kt.
 */

import android.app.role.RoleManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.provider.Settings
import android.speech.RecognitionService

private const val VOICE_RECOGNITION_SERVICE_SETTING = "voice_recognition_service"
private const val ASSISTANT_PREFS_NAME = "openclaw.assistant"
private const val RECOGNITION_DELEGATE_KEY = "recognition_delegate_component"

internal data class AssistantRoleStatus(
  val available: Boolean,
  val held: Boolean,
)

internal fun isAssistantLaunchIntent(intent: Intent?): Boolean = intent?.action == Intent.ACTION_ASSIST

internal fun assistantRoleStatus(context: Context): AssistantRoleStatus {
  val roleManager =
    runCatching { context.getSystemService(RoleManager::class.java) }
      .getOrNull()
      ?: return AssistantRoleStatus(available = false, held = false)
  return runCatching {
    val available = roleManager.isRoleAvailable(RoleManager.ROLE_ASSISTANT)
    AssistantRoleStatus(
      available = available,
      held = available && roleManager.isRoleHeld(RoleManager.ROLE_ASSISTANT),
    )
  }.getOrDefault(AssistantRoleStatus(available = false, held = false))
}

internal fun createAssistantRoleRequestIntent(context: Context): Intent? {
  val roleManager =
    runCatching { context.getSystemService(RoleManager::class.java) }
      .getOrNull()
      ?: return null
  if (!assistantRoleStatus(context).available) return null
  rememberConfiguredRecognitionService(context)
  return runCatching {
    roleManager.createRequestRoleIntent(RoleManager.ROLE_ASSISTANT)
  }.getOrNull()
}

internal fun resolveRecognitionServiceComponent(context: Context): ComponentName? {
  val packageName = context.packageName
  val services = recognitionServices(context)
  val configured =
    Settings.Secure
      .getString(context.contentResolver, VOICE_RECOGNITION_SERVICE_SETTING)
      ?.let(ComponentName::unflattenFromString)
  if (configured?.packageName == packageName) {
    return rememberedRecognitionService(context)
      ?.takeIf { componentExists(services, it) }
      ?: solePlatformRecognitionService(context, services)
  }
  if (configured != null && componentExists(services, configured)) {
    rememberRecognitionService(context, configured)
    return configured
  }
  return null
}

private fun rememberConfiguredRecognitionService(context: Context) {
  val services = recognitionServices(context)
  val configured =
    Settings.Secure
      .getString(context.contentResolver, VOICE_RECOGNITION_SERVICE_SETTING)
      ?.let(ComponentName::unflattenFromString)
      ?.takeUnless { it.packageName == context.packageName }
      ?.takeIf { componentExists(services, it) }
      ?: return
  rememberRecognitionService(context, configured)
}

private fun solePlatformRecognitionService(
  context: Context,
  services: List<android.content.pm.ResolveInfo>,
): ComponentName? {
  val candidates =
    services.mapNotNull { info ->
      val serviceInfo = info.serviceInfo ?: return@mapNotNull null
      if (serviceInfo.packageName == context.packageName) return@mapNotNull null
      if (!serviceInfo.isPlatformService()) return@mapNotNull null
      ComponentName(serviceInfo.packageName, serviceInfo.name)
    }
  return candidates.singleOrNull()?.also { rememberRecognitionService(context, it) }
}

private fun android.content.pm.ServiceInfo.isPlatformService(): Boolean {
  val flags = applicationInfo?.flags ?: return false
  return flags and (ApplicationInfo.FLAG_SYSTEM or ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0
}

private fun recognitionServices(context: Context) = context.packageManager.queryIntentServices(Intent(RecognitionService.SERVICE_INTERFACE), 0)

private fun componentExists(
  services: List<android.content.pm.ResolveInfo>,
  component: ComponentName,
): Boolean =
  services.any {
    it.serviceInfo.packageName == component.packageName &&
      it.serviceInfo.name == component.className
  }

private fun rememberRecognitionService(
  context: Context,
  component: ComponentName,
) {
  context
    .getSharedPreferences(ASSISTANT_PREFS_NAME, Context.MODE_PRIVATE)
    .edit()
    .putString(RECOGNITION_DELEGATE_KEY, component.flattenToString())
    .apply()
}

private fun rememberedRecognitionService(context: Context): ComponentName? =
  context
    .getSharedPreferences(ASSISTANT_PREFS_NAME, Context.MODE_PRIVATE)
    .getString(RECOGNITION_DELEGATE_KEY, null)
    ?.let(ComponentName::unflattenFromString)
