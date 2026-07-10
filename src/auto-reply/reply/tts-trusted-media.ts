import { resolveSendableOutboundReplyParts } from "openclaw/plugin-sdk/reply-payload";
import type { ReplyPayload } from "../reply-payload.js";

const FILE_URL_RE = /^file:\/\//i;
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/;

function isLocalMediaSource(media: string): boolean {
  const trimmed = media.trim();
  return (
    FILE_URL_RE.test(trimmed) ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("~/") ||
    trimmed.startsWith("~\\") ||
    WINDOWS_DRIVE_RE.test(trimmed) ||
    trimmed.startsWith("\\\\")
  );
}

export function markGeneratedTtsLocalMediaTrusted(params: {
  input: ReplyPayload;
  output: ReplyPayload;
}): ReplyPayload {
  if (params.output.trustedLocalMedia) {
    return params.output;
  }
  const inputMedia = resolveSendableOutboundReplyParts(params.input).mediaUrls;
  const outputMedia = resolveSendableOutboundReplyParts(params.output).mediaUrls;
  if (inputMedia.length > 0 || outputMedia.length === 0) {
    return params.output;
  }
  return outputMedia.every(isLocalMediaSource)
    ? { ...params.output, trustedLocalMedia: true }
    : params.output;
}
