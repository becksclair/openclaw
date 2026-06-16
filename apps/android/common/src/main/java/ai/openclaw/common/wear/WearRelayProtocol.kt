package ai.openclaw.common.wear

import kotlinx.serialization.Serializable

/** Wearable Data Layer wire contract shared between the phone relay and the watch client. */
object WearRelayProtocol {
  // Turn-scoped paths. A turn id is appended as the final segment.
  const val PATH_START = "/openclaw/watch/start"
  const val PATH_END = "/openclaw/watch/end"
  const val PATH_CANCEL = "/openclaw/watch/cancel"
  const val PATH_TEXT = "/openclaw/watch/text"
  const val PATH_AUDIO_CHUNK = "/openclaw/watch/audio/chunk"

  // Broadcast/status paths.
  const val PATH_STATUS = "/openclaw/watch/status"
  const val PATH_ERROR = "/openclaw/watch/error"
  const val PATH_AUDIO_RESPONSE = "/openclaw/watch/audio"

  // Negotiated response formats.
  const val RESPONSE_FORMAT_PCM_24K = "pcm_24000"
  const val RESPONSE_FORMAT_OGG_OPUS = "ogg_opus"
  const val RESPONSE_FORMAT_MP3 = "mp3"

  val ACCEPTED_RESPONSE_FORMATS =
    listOf(RESPONSE_FORMAT_MP3, RESPONSE_FORMAT_OGG_OPUS, RESPONSE_FORMAT_PCM_24K)

  // MessageClient enforces a ~100 KB per-message ceiling; keep a safe margin.
  const val MAX_MESSAGE_BYTES = 90_000

  fun turnPath(
    basePath: String,
    turnId: String?,
  ): String = turnId?.let { "$basePath/$it" } ?: basePath
}

@Serializable
data class WearRelayStartPayload(
  val responseStreaming: Boolean = false,
  val acceptedResponseFormats: List<String> = emptyList(),
)

@Serializable
data class WearRelayTextPayload(
  val text: String,
  val acceptedResponseFormats: List<String> = emptyList(),
)

@Serializable
data class WearRelayStatusPayload(
  val state: String,
  val message: String,
  val turnId: String? = null,
)

@Serializable
data class WearRelayErrorPayload(
  val message: String,
  val turnId: String? = null,
)

@Serializable
data class WearRelayAudioDonePayload(
  val chunkCount: Int,
  val turnId: String? = null,
  val format: String = WearRelayProtocol.RESPONSE_FORMAT_PCM_24K,
)
