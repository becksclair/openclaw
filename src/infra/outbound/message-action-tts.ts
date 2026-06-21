// Message-action TTS helpers lazily apply session/config driven speech output
// to send payloads without loading TTS providers for ordinary sends.
import type { SourceReplyDeliveryMode } from "../../auto-reply/get-reply-options.types.js";
import type { ReplyPayload } from "../../auto-reply/reply-payload.js";
import { resolveStorePath } from "../../config/sessions.js";
import { loadSessionEntry } from "../../config/sessions/session-accessor.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { TtsAutoMode } from "../../config/types.tts.js";
import { hasTtsDirective } from "../../tts/directives.js";
import { resolveEffectiveTtsAutoMode } from "../../tts/tts-config.js";

let ttsRuntimePromise: Promise<typeof import("../../tts/tts.runtime.js")> | null = null;

function loadMessageActionTtsRuntime() {
  // Keep the TTS runtime lazy so ordinary message sends do not pay the provider import cost.
  ttsRuntimePromise ??= import("../../tts/tts.runtime.js");
  return ttsRuntimePromise;
}

/** Reads the session-level TTS auto mode for a message-action send. */
export function resolveMessageActionSessionTtsAuto(params: {
  cfg: OpenClawConfig;
  sessionKey?: string;
  agentId?: string;
}): TtsAutoMode | undefined {
  const sessionKey = params.sessionKey?.trim();
  if (!sessionKey) {
    return undefined;
  }
  try {
    const storePath = resolveStorePath(params.cfg.session?.store, { agentId: params.agentId });
    return loadSessionEntry({
      agentId: params.agentId,
      sessionKey,
      storePath,
    })?.ttsAuto;
  } catch {
    // Missing or unreadable session stores should not block message delivery.
    return undefined;
  }
}

type MessageActionTtsPayloadResult = {
  payload: ReplyPayload;
  deferredSupplement?: MessageActionDeferredTtsSupplement;
};

export type MessageActionDeferredTtsSupplement = {
  synthesize: () => Promise<ReplyPayload | null>;
};

function hasMediaPayload(payload: ReplyPayload): boolean {
  return Boolean(payload.mediaUrl?.trim() || payload.mediaUrls?.some((url) => url.trim()));
}

function buildSupplementalTtsPayload(params: {
  payload: ReplyPayload;
  spokenText: string;
}): ReplyPayload {
  const { text: _text, ...payloadWithoutText } = params.payload;
  return {
    ...payloadWithoutText,
    spokenText: params.spokenText,
    ttsSupplement: {
      spokenText: params.spokenText,
      visibleTextAlreadyDelivered: true,
    },
  };
}

/** Applies automatic TTS to a message-action send payload when config/session policy allows it. */
export async function maybeApplyTtsToMessageActionSendPayload(params: {
  payload: ReplyPayload;
  cfg: OpenClawConfig;
  channel: string;
  accountId?: string | null;
  agentId?: string;
  sessionKey?: string;
  inboundAudio?: boolean;
  dryRun: boolean;
  sourceReplyDeliveryMode?: SourceReplyDeliveryMode;
}): Promise<MessageActionTtsPayloadResult> {
  if (params.dryRun) {
    return { payload: params.payload };
  }
  const ttsAuto = resolveMessageActionSessionTtsAuto({
    cfg: params.cfg,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
  });
  const effectiveAutoMode = resolveEffectiveTtsAutoMode({
    cfg: params.cfg,
    ttsAuto,
    agentId: params.agentId,
    channelId: params.channel,
    accountId: params.accountId ?? undefined,
  });
  const hasExplicitTtsDirective = hasTtsDirective(params.payload.text ?? "");
  const shouldHonorExplicitDirective =
    hasExplicitTtsDirective &&
    (effectiveAutoMode === "always" ||
      effectiveAutoMode === "tagged" ||
      (effectiveAutoMode === "inbound" && params.inboundAudio === true));
  const shouldApplyAmbientSourceReplyTts =
    params.sourceReplyDeliveryMode === "message_tool_only" &&
    (effectiveAutoMode === "always" ||
      (effectiveAutoMode === "inbound" && params.inboundAudio === true));
  if (!shouldHonorExplicitDirective && !shouldApplyAmbientSourceReplyTts) {
    return { payload: params.payload };
  }

  const visibleText = params.payload.text?.trim();
  if (
    !shouldHonorExplicitDirective &&
    shouldApplyAmbientSourceReplyTts &&
    visibleText &&
    !hasMediaPayload(params.payload)
  ) {
    return {
      payload: params.payload,
      deferredSupplement: {
        synthesize: async () => {
          const { maybeApplyTtsToPayload } = await loadMessageActionTtsRuntime();
          const ttsPayload = await maybeApplyTtsToPayload({
            payload: params.payload,
            cfg: params.cfg,
            channel: params.channel,
            kind: "final",
            inboundAudio: params.inboundAudio,
            ttsAuto: effectiveAutoMode,
            agentId: params.agentId,
            accountId: params.accountId ?? undefined,
          });
          if (!hasMediaPayload(ttsPayload)) {
            return null;
          }
          const spokenText = ttsPayload.spokenText?.trim() || visibleText;
          return buildSupplementalTtsPayload({ payload: ttsPayload, spokenText });
        },
      },
    };
  }

  const { maybeApplyTtsToPayload } = await loadMessageActionTtsRuntime();
  const ttsPayload = await maybeApplyTtsToPayload({
    payload: params.payload,
    cfg: params.cfg,
    channel: params.channel,
    kind: "final",
    inboundAudio: params.inboundAudio,
    ttsAuto: shouldHonorExplicitDirective ? "tagged" : effectiveAutoMode,
    agentId: params.agentId,
    accountId: params.accountId ?? undefined,
  });
  return { payload: ttsPayload };
}
