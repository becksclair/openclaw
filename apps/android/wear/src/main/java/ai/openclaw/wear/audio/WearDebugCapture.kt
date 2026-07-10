package ai.openclaw.wear.audio

import android.content.Context
import android.util.Log
import java.io.File

/**
 * Shared support for the watch's debug audio capture sinks.
 *
 * Three sinks (`WireAudioDebugCapture`, `PlaybackAudioDebugCapture`,
 * `AcousticAudioDebugCapture`) all write per-turn artefacts under the
 * same `audio-captures/turn-<id>/` tree and append timestamped TSV rows to
 * a single `events.tsv` per turn. The helpers in this file are the canonical
 * implementations; each sink owns only its sink-specific write logic.
 *
 * Visibility is `internal` so it stays a wear-module-local concern; the
 * format on disk (TAG, directory layout, event row schema) is unchanged
 * by this consolidation.
 */
internal const val WEAR_AUDIO_CAPTURE_TAG: String = "OpenClawWearAudioCapture"

/**
 * Returns true when the user has enabled audio capture by setting
 * `log.tag.OpenClawWearAudioCapture VERBOSE` via `adb shell setprop`.
 * Sinks must check this before writing anything to disk.
 */
internal fun isWearAudioCaptureEnabled(): Boolean = Log.isLoggable(WEAR_AUDIO_CAPTURE_TAG, Log.VERBOSE)

/**
 * Returns the per-turn capture directory under the audio-captures tree.
 * Falls back to the cache dir when external files are unavailable, mirroring
 * the previous in-class behavior. Does not create the directory; callers do
 * that themselves so sinks can decide whether to swallow the IO error.
 */
internal fun wearCaptureDirectory(
  context: Context,
  turnId: String?,
): File {
  val root = context.getExternalFilesDir("audio-captures") ?: context.cacheDir.resolve("audio-captures")
  return root.resolve(sanitizeWearTurnId(turnId))
}

/**
 * Appends a single TSV row to `events.tsv` in the given turn directory.
 * Schema: `<unix-millis>\t<event>\n` where `<event>` is already-formatted
 * by the caller (typically `name\tindex\tsize` or `name\tindex\tsize\textra`).
 *
 * The caller is responsible for ensuring the directory exists.
 */
internal fun appendWearCaptureEvent(
  directory: File,
  event: String,
) {
  File(directory, "events.tsv").appendText("${System.currentTimeMillis()}\t$event\n")
}

/**
 * Sanitizes an arbitrary turn id into a safe directory name. Empty/null ids
 * collapse to `"unknown"` so capture artifacts always land somewhere readable.
 * Output is `"turn-<safe>"`.
 */
internal fun sanitizeWearTurnId(turnId: String?): String = "turn-${turnId.orEmpty().ifBlank { "unknown" }.replace(Regex("[^A-Za-z0-9._-]"), "_")}"

/**
 * Sanitizes a free-form value (typically an exception message) for inclusion
 * in a TSV event field. Strips the two characters that would otherwise break
 * the TSV row format.
 */
internal fun sanitizeWearEventField(value: String?): String = value.orEmpty().replace('\t', ' ').replace('\n', ' ')
