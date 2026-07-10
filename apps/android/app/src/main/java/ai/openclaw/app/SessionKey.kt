package ai.openclaw.app

/** Normalizes blank gateway session keys to the legacy main session alias. */
internal fun normalizeMainKey(raw: String?): String {
  val trimmed = raw?.trim()
  return if (!trimmed.isNullOrEmpty()) trimmed else "main"
}

/** Extracts the agent id from canonical agent-scoped main session keys. */
internal fun resolveAgentIdFromMainSessionKey(raw: String?): String? {
  val trimmed = raw?.trim().orEmpty()
  if (!trimmed.startsWith("agent:")) return null
  return trimmed
    .removePrefix("agent:")
    .substringBefore(':')
    .trim()
    .ifEmpty { null }
}

/** Builds the gateway-owned main session key for a resolved agent. */
internal fun buildGatewayMainSessionKey(
  agentId: String?,
  gatewayMainSessionKey: String?,
): String {
  val trimmed = gatewayMainSessionKey?.trim().orEmpty()
  if (trimmed == "global" || trimmed.startsWith("agent:")) return trimmed
  val resolvedMainKey = trimmed.ifEmpty { "main" }
  val resolvedAgentId = agentId?.trim().orEmpty()
  if (resolvedAgentId.isEmpty()) return resolvedMainKey
  return "agent:$resolvedAgentId:$resolvedMainKey"
}

internal fun resolveGatewayMainSessionKey(
  agentId: String?,
  mainKey: String?,
  scope: String?,
): String {
  val normalizedScope = scope?.trim()?.lowercase()
  return buildGatewayMainSessionKey(
    agentId = agentId,
    gatewayMainSessionKey = if (normalizedScope == "global") "global" else mainKey,
  )
}

internal fun resolveConversationTargetSessionKey(
  mode: SessionTargetMode,
  mainSessionKey: String,
  currentSessionKey: String,
): String {
  val main = mainSessionKey.trim().ifEmpty { "main" }
  val current =
    currentSessionKey
      .trim()
      .let { if (it == "main" && main != "main") main else it }
  return when (mode) {
    SessionTargetMode.FollowSelected -> current.ifEmpty { main }
    SessionTargetMode.Device,
    SessionTargetMode.Main,
    -> main
  }
}

internal fun resolveWearConversationTargetSessionKey(
  explicitWearTargetSessionKey: String?,
  mode: SessionTargetMode,
  mainSessionKey: String,
  currentSessionKey: String,
): String =
  normalizeWearTargetSessionKeyOverride(explicitWearTargetSessionKey)
    ?: resolveConversationTargetSessionKey(
      mode = mode,
      mainSessionKey = mainSessionKey,
      currentSessionKey = currentSessionKey,
    )

internal fun normalizeWearTargetSessionKeyOverride(value: String?): String? =
  value
    ?.trim()
    ?.takeIf { it.isNotEmpty() && it != "main" }

/** Builds the node session key shape consumed by gateway chat and presence APIs. */
internal fun buildNodeMainSessionKey(
  deviceId: String,
  agentId: String?,
): String {
  val resolvedAgentId = agentId?.trim().orEmpty().ifEmpty { "main" }
  return "agent:$resolvedAgentId:node-${deviceId.take(12)}"
}
