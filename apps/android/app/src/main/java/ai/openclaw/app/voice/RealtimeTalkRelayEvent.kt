package ai.openclaw.app.voice

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

internal sealed class RealtimeTalkRelayEvent {
  data object Ready : RealtimeTalkRelayEvent()

  data class Audio(
    val audioBase64: String,
  ) : RealtimeTalkRelayEvent()

  data object Clear : RealtimeTalkRelayEvent()

  data object Mark : RealtimeTalkRelayEvent()

  data class Transcript(
    val role: String?,
    val text: String,
    val final: Boolean,
  ) : RealtimeTalkRelayEvent()

  data class ToolCall(
    val callId: String,
    val name: String,
    val argumentsJson: String?,
  ) : RealtimeTalkRelayEvent()

  data class Error(
    val message: String,
  ) : RealtimeTalkRelayEvent()

  data class Close(
    val reason: String?,
  ) : RealtimeTalkRelayEvent()
}

internal object RealtimeTalkRelayEventParser {
  private val json = Json { ignoreUnknownKeys = true }

  fun parse(payloadJson: String?): Pair<String, RealtimeTalkRelayEvent>? {
    if (payloadJson.isNullOrBlank()) return null
    val obj = runCatching { json.parseToJsonElement(payloadJson).rtAsObjectOrNull() }.getOrNull() ?: return null
    val relaySessionId = obj["relaySessionId"].rtAsStringOrNull()?.trim().orEmpty()
    if (relaySessionId.isEmpty()) return null
    val type = obj["type"].rtAsStringOrNull()?.trim().orEmpty()
    val event =
      when (type) {
        "ready" -> RealtimeTalkRelayEvent.Ready
        "audio" -> {
          val audio = obj["audio"].rtAsStringOrNull() ?: obj["audioBase64"].rtAsStringOrNull() ?: return null
          RealtimeTalkRelayEvent.Audio(audioBase64 = audio)
        }
        "clear" -> RealtimeTalkRelayEvent.Clear
        "mark" -> RealtimeTalkRelayEvent.Mark
        "transcript" -> {
          val text = obj["text"].rtAsStringOrNull()?.trim().orEmpty()
          if (text.isEmpty()) return null
          RealtimeTalkRelayEvent.Transcript(
            role = obj["role"].rtAsStringOrNull(),
            text = text,
            final = obj["final"].rtAsBooleanOrNull() ?: false,
          )
        }
        "toolCall" -> {
          val callId = obj["callId"].rtAsStringOrNull()?.trim().orEmpty()
          val name = obj["name"].rtAsStringOrNull()?.trim().orEmpty()
          if (callId.isEmpty() || name.isEmpty()) return null
          RealtimeTalkRelayEvent.ToolCall(
            callId = callId,
            name = name,
            argumentsJson = (obj["args"] ?: obj["arguments"])?.toString(),
          )
        }
        "error" ->
          RealtimeTalkRelayEvent.Error(
            message = obj["message"].rtAsStringOrNull() ?: "Realtime voice error",
          )
        "close" -> RealtimeTalkRelayEvent.Close(reason = obj["reason"].rtAsStringOrNull())
        else -> return null
      }
    return relaySessionId to event
  }
}

private fun JsonElement?.rtAsStringOrNull(): String? =
  this
    ?.let { it as? JsonPrimitive }
    ?.contentOrNull

private fun JsonElement?.rtAsBooleanOrNull(): Boolean? {
  val primitive = this as? JsonPrimitive ?: return null
  return primitive.booleanOrNull
}

private fun JsonElement?.rtAsObjectOrNull(): JsonObject? = this as? JsonObject
