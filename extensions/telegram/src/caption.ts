// Telegram plugin module implements caption behavior.
export const TELEGRAM_MAX_CAPTION_LENGTH = 1024;

// Native Codex message-tool TTS delivery seam (commit 02b383e3b7 "preserve send tts and caption
// delivery"): keep an oversized caption attached to the media at the nearest sentence/word
// boundary, sending only the overflow as follow-up text, rather than dropping the caption entirely.
function findCaptionBoundary(text: string): number {
  const limit = Math.min(TELEGRAM_MAX_CAPTION_LENGTH, text.length);
  const search = text.slice(0, limit + 1);
  const preferredDelimiters = ["\n\n", "\n", ". ", "! ", "? ", "; ", ": ", " "];
  for (const delimiter of preferredDelimiters) {
    const index = search.lastIndexOf(delimiter);
    if (index > 0) {
      return index + delimiter.length;
    }
  }
  return limit;
}

export function splitTelegramCaption(text?: string): {
  caption?: string;
  followUpText?: string;
} {
  const trimmed = text?.trim() ?? "";
  if (!trimmed) {
    return { caption: undefined, followUpText: undefined };
  }
  if (trimmed.length > TELEGRAM_MAX_CAPTION_LENGTH) {
    const boundary = findCaptionBoundary(trimmed);
    const caption = trimmed.slice(0, boundary).trimEnd();
    const followUpText = trimmed.slice(boundary).trimStart();
    return {
      caption: caption || undefined,
      followUpText: followUpText || undefined,
    };
  }
  return { caption: trimmed, followUpText: undefined };
}
