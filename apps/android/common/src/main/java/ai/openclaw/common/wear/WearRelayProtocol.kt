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

  val WATCH_MESSAGE_PATHS =
    arrayOf(
      PATH_START,
      PATH_END,
      PATH_CANCEL,
      PATH_AUDIO_CHUNK,
      PATH_TEXT,
    )

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

  /** Turn-scoped control/text path: "<base>/<turnId>". Every watch message is turn-scoped. */
  fun turnPath(
    basePath: String,
    turnId: String,
  ): String = "$basePath/$turnId"

  /**
   * Watch->phone audio chunk path: "<PATH_AUDIO_CHUNK>/<turnId>/<chunkIndex>". The
   * monotonic chunk index lets the phone detect a dropped chunk instead of silently
   * transcribing a shortened buffer.
   */
  fun audioChunkPath(
    turnId: String,
    chunkIndex: Int,
  ): String = "$PATH_AUDIO_CHUNK/$turnId/$chunkIndex"

  /**
   * Parse an inbound watch message path. Returns null when the path is unknown or is
   * missing its required turn id; audio-chunk paths must also carry a numeric index.
   */
  fun parseWatchMessagePath(path: String): WatchMessagePath? {
    val audioPrefix = "$PATH_AUDIO_CHUNK/"
    if (path.startsWith(audioPrefix)) {
      val rest = path.removePrefix(audioPrefix)
      val slash = rest.indexOf('/')
      if (slash <= 0) return null
      // Reject negative/non-numeric indices at the boundary: a negative key would
      // defeat the contiguity check in the relay and crash buffer assembly.
      val chunkIndex = rest.substring(slash + 1).toIntOrNull()?.takeIf { it >= 0 } ?: return null
      return WatchMessagePath(PATH_AUDIO_CHUNK, rest.substring(0, slash), chunkIndex)
    }
    for (basePath in WATCH_MESSAGE_PATHS) {
      if (basePath == PATH_AUDIO_CHUNK) continue
      val prefix = "$basePath/"
      if (path.startsWith(prefix)) {
        val turnId = path.removePrefix(prefix)
        if (turnId.isEmpty()) return null
        return WatchMessagePath(basePath, turnId, null)
      }
    }
    return null
  }
}

data class WatchMessagePath(
  val path: String,
  val turnId: String,
  val chunkIndex: Int?,
)

@Serializable
data class WearRelayStartPayload(
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
  val turnId: String,
)

@Serializable
data class WearRelayErrorPayload(
  val message: String,
  val turnId: String,
)

@Serializable
data class WearRelayAudioDonePayload(
  val chunkCount: Int,
  val turnId: String,
  val format: String = WearRelayProtocol.RESPONSE_FORMAT_PCM_24K,
)
