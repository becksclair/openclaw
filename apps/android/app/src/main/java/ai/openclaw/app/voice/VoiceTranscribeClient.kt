package ai.openclaw.app.voice

import android.util.Base64
import ai.openclaw.app.gateway.GatewaySession
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

internal data class VoiceTranscriptionResult(
  val transcript: String,
  val durationMs: Int,
)

internal class VoiceTranscribeClient(
  private val session: GatewaySession,
  private val json: Json = Json { ignoreUnknownKeys = true },
) {
  suspend fun transcribePcm16(
    audio: ByteArray,
    sampleRate: Int,
    channels: Int,
  ): VoiceTranscriptionResult {
    val response =
      session.request(
        method = "voice.transcribe",
        paramsJson =
          json.encodeToString(
            VoiceTranscribeRequest(
              audioBase64 = Base64.encodeToString(audio, Base64.NO_WRAP),
              sampleRate = sampleRate,
              channels = channels,
              format = "pcm16",
            ),
          ),
        timeoutMs = 45_000,
      )
    val decoded = json.decodeFromString<VoiceTranscribeResponse>(response)
    return VoiceTranscriptionResult(
      transcript = decoded.transcript.trim(),
      durationMs = decoded.durationMs,
    )
  }
}

@Serializable
private data class VoiceTranscribeRequest(
  val audioBase64: String,
  val sampleRate: Int,
  val channels: Int,
  val format: String,
)

@Serializable
private data class VoiceTranscribeResponse(
  val transcript: String,
  val durationMs: Int,
)
