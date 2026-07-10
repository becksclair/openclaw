/**
 * Merges media payloads discovered from attempt tool results.
 */
import type { SourceReplyDeliveryMode } from "../../../auto-reply/get-reply-options.types.js";
import {
  copyReplyPayloadMetadata,
  getReplyPayloadMetadata,
  markReplyPayloadForSourceSuppressionDelivery,
} from "../../../auto-reply/reply-payload.js";
import type { EmbeddedAgentRunResult } from "../types.js";

/** Channel payload shape produced by embedded runs after auto-reply normalization. */
type EmbeddedRunPayload = NonNullable<EmbeddedAgentRunResult["payloads"]>[number];

/**
 * Merges media emitted by tools into the channel payloads produced by the
 * assistant turn. The first non-reasoning reply owns the media so text and
 * attachments stay together; metadata is preserved for delivery bookkeeping.
 */
export function mergeAttemptToolMediaPayloads(params: {
  payloads?: EmbeddedRunPayload[];
  toolMediaUrls?: string[];
  toolAudioAsVoice?: boolean;
  toolTrustedLocalMedia?: boolean;
  toolSpokenText?: string;
  sourceReplyDeliveryMode?: SourceReplyDeliveryMode;
}): EmbeddedRunPayload[] | undefined {
  // Trim and dedupe tool media before merging with assistant-owned payload media.
  const mediaUrls = Array.from(
    new Set(params.toolMediaUrls?.map((url) => url.trim()).filter(Boolean) ?? []),
  );
  if (mediaUrls.length === 0 && !params.toolAudioAsVoice && !params.toolTrustedLocalMedia) {
    return params.payloads;
  }

  const payloads = params.payloads?.length ? [...params.payloads] : [];
  const shouldDeliverTrustedVoiceMedia =
    params.sourceReplyDeliveryMode === "message_tool_only" &&
    params.toolTrustedLocalMedia === true &&
    params.toolAudioAsVoice === true &&
    mediaUrls.length > 0;
  if (shouldDeliverTrustedVoiceMedia) {
    const existingMediaUrls = new Set(payloads.flatMap((payload) => payload.mediaUrls ?? []));
    const deliverableMediaUrls = mediaUrls.filter((url) => !existingMediaUrls.has(url));
    if (deliverableMediaUrls.length === 0) {
      return payloads;
    }
    return [
      ...payloads,
      markReplyPayloadForSourceSuppressionDelivery({
        mediaUrls: deliverableMediaUrls,
        mediaUrl: deliverableMediaUrls[0],
        audioAsVoice: true,
        trustedLocalMedia: true,
        ...(params.toolSpokenText ? { spokenText: params.toolSpokenText } : {}),
      }),
    ];
  }

  const payloadIndex = payloads.findIndex((payload) => !payload.isReasoning);
  if (payloadIndex >= 0) {
    const payload = payloads[payloadIndex];
    if (
      params.sourceReplyDeliveryMode === "message_tool_only" &&
      getReplyPayloadMetadata(payload)?.sourceReplyTranscriptMirror
    ) {
      // Message-tool-only source replies are transcript mirrors of a send that
      // already happened elsewhere; attaching generated media here would create
      // a duplicate channel delivery.
      return payloads;
    }
    const mergedMediaUrls = Array.from(new Set([...(payload.mediaUrls ?? []), ...mediaUrls]));
    payloads[payloadIndex] = copyReplyPayloadMetadata(payload, {
      ...payload,
      mediaUrls: mergedMediaUrls.length ? mergedMediaUrls : undefined,
      mediaUrl: payload.mediaUrl ?? mergedMediaUrls[0],
      audioAsVoice: payload.audioAsVoice || params.toolAudioAsVoice || undefined,
      trustedLocalMedia: payload.trustedLocalMedia || params.toolTrustedLocalMedia || undefined,
      ...((payload.spokenText ?? params.toolSpokenText)
        ? { spokenText: payload.spokenText ?? params.toolSpokenText }
        : {}),
    });
    return payloads;
  }

  // Reasoning-only turns still need a concrete media payload so channel delivery sees the attachment.
  return [
    ...payloads,
    {
      mediaUrls: mediaUrls.length ? mediaUrls : undefined,
      mediaUrl: mediaUrls[0],
      audioAsVoice: params.toolAudioAsVoice || undefined,
      trustedLocalMedia: params.toolTrustedLocalMedia || undefined,
      ...(params.toolSpokenText ? { spokenText: params.toolSpokenText } : {}),
    },
  ];
}
