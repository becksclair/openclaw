// Shared "detach TTS voice supplement off the dispatch turn" helper.
//
// Visible text is delivered in-turn by the caller; this helper runs the slow
// TTS synthesis and the audio-only voice-note send as a detached background task
// so the reply operation can release its session lane immediately. The audio is
// marked `visibleTextAlreadyDelivered` so the existing supplement/dedup path
// (gateway strips visible text from supplements) never re-posts the text; only
// the voice note renders. Synthesis/delivery primitives are injected because the
// caller's TTS wrapper, media normalizer, and route sender are turn-local
// closures.
import { formatErrorMessage } from "../../infra/errors.js";
import { markReplyPayloadAsTtsSupplement, type ReplyPayload } from "../reply-payload.js";
import { registerDetachedTtsTask } from "./detached-tts-tasks.js";
import { markGeneratedTtsLocalMediaTrusted } from "./tts-trusted-media.js";

export type DetachTtsSupplementParams = {
  /** Operation abort signal; a cancelled turn stops the pending audio send. */
  opAbortSignal: AbortSignal;
  /** The already-delivered visible text, used as the spoken source. */
  visibleText: string;
  /** Synthesize audio for the visible text. Returns a payload with `mediaUrl` when TTS applied. */
  synthesize: () => Promise<ReplyPayload>;
  /** Normalize media paths on the audio-only supplement before delivery. */
  normalize: (payload: ReplyPayload) => Promise<ReplyPayload>;
  /** Deliver the audio-only supplement to the originating surface. */
  deliver: (payload: ReplyPayload, signal: AbortSignal) => Promise<unknown>;
  /** Final-payload hook (archive/audit consumers); fired with the supplement. */
  onFinalReplyPayload?: (payload: ReplyPayload) => Promise<void> | void;
  log?: (message: string) => void;
};

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Register a detached task that synthesizes and delivers a TTS voice supplement
 * for text already shown to the user. Returns immediately; never throws.
 */
export function detachTtsSupplement(params: DetachTtsSupplementParams): void {
  registerDetachedTtsTask(async () => {
    const { opAbortSignal, visibleText } = params;
    try {
      if (opAbortSignal.aborted) {
        return;
      }
      const synthesized = await params.synthesize();
      if (opAbortSignal.aborted) {
        return;
      }
      if (!synthesized.mediaUrl) {
        // No audio produced (auto-off, filtered, too short, or provider failed).
        // Text was already delivered in-turn, so there is nothing more to send.
        return;
      }
      const supplement = markReplyPayloadAsTtsSupplement(
        markGeneratedTtsLocalMediaTrusted({
          input: { text: visibleText },
          output: {
            mediaUrl: synthesized.mediaUrl,
            audioAsVoice: synthesized.audioAsVoice,
            spokenText: visibleText,
          },
        }),
        visibleText,
        { visibleTextAlreadyDelivered: true },
      );
      const normalized = await params.normalize(supplement);
      if (opAbortSignal.aborted) {
        return;
      }
      await params.onFinalReplyPayload?.(normalized);
      if (opAbortSignal.aborted) {
        return;
      }
      await params.deliver(normalized, opAbortSignal);
    } catch (err) {
      if (opAbortSignal.aborted || isAbortError(err)) {
        return;
      }
      params.log?.(`detached TTS supplement failed: ${formatErrorMessage(err)}`);
    }
  });
}
