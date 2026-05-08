package ai.openclaw.app.voice

import ai.openclaw.app.normalizeMainKey
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

internal data class TalkModeGatewayConfigState(
  val mainSessionKey: String,
  val interruptOnSpeech: Boolean?,
  val silenceTimeoutMs: Long,
  val realtime: RealtimeTalkConfig?,
)

internal data class RealtimeTalkConfig(
  val provider: String,
  val model: String?,
  val voice: String?,
)

internal object TalkModeGatewayConfigParser {
  fun parse(config: JsonObject?): TalkModeGatewayConfigState {
    val talk = config?.get("talk").configAsObjectOrNull()
    val sessionCfg = config?.get("session").configAsObjectOrNull()
    return TalkModeGatewayConfigState(
      mainSessionKey = normalizeMainKey(sessionCfg?.get("mainKey").configAsStringOrNull()),
      interruptOnSpeech = talk?.get("interruptOnSpeech").configAsBooleanOrNull(),
      silenceTimeoutMs = resolvedSilenceTimeoutMs(talk),
      realtime = parseRealtime(config?.get("realtime").configAsObjectOrNull()),
    )
  }

  private fun parseRealtime(realtime: JsonObject?): RealtimeTalkConfig? {
    val realtimeObj = realtime ?: return null
    val available = realtimeObj.get("available").configAsBooleanOrNull() ?: return null
    if (!available) return null
    val provider =
      realtimeObj
        .get("provider")
        .configAsStringOrNull()
        ?.trim()
        .orEmpty()
    if (provider.isEmpty()) return null
    return RealtimeTalkConfig(
      provider = provider,
      model =
        realtimeObj
          .get("model")
          .configAsStringOrNull()
          ?.trim()
          ?.takeIf { it.isNotEmpty() },
      voice =
        realtimeObj
          .get("voice")
          .configAsStringOrNull()
          ?.trim()
          ?.takeIf { it.isNotEmpty() },
    )
  }

  fun resolvedSilenceTimeoutMs(talk: JsonObject?): Long {
    val fallback = TalkDefaults.defaultSilenceTimeoutMs
    val primitive = talk?.get("silenceTimeoutMs") as? JsonPrimitive ?: return fallback
    if (primitive.isString) return fallback
    val timeout = primitive.content.toDoubleOrNull() ?: return fallback
    if (timeout <= 0 || timeout % 1.0 != 0.0 || timeout > Long.MAX_VALUE.toDouble()) {
      return fallback
    }
    return timeout.toLong()
  }
}

private fun JsonElement?.configAsStringOrNull(): String? =
  this
    ?.let { element -> element as? JsonPrimitive }
    ?.contentOrNull

private fun JsonElement?.configAsBooleanOrNull(): Boolean? {
  val primitive = this as? JsonPrimitive ?: return null
  return primitive.booleanOrNull
}

private fun JsonElement?.configAsObjectOrNull(): JsonObject? = this as? JsonObject
