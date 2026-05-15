import { randomUUID } from "node:crypto";
import type { RealtimeVoiceProviderPlugin } from "../plugins/types.js";
import {
  REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ,
  type RealtimeVoiceBrowserAudioContract,
  type RealtimeVoiceProviderConfig,
  type RealtimeVoiceTool,
} from "../realtime-voice/provider-types.js";
import {
  createRealtimeVoiceBridgeSession,
  type RealtimeVoiceBridgeSession,
} from "../realtime-voice/session-runtime.js";
import type { GatewayRequestContext } from "./server-methods/shared-types.js";

const RELAY_SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_AUDIO_BASE64_BYTES = 512 * 1024;
const MAX_USER_MESSAGE_CHARS = 8 * 1024;
const MAX_RELAY_SESSIONS_PER_CONN = 2;
const MAX_RELAY_SESSIONS_GLOBAL = 64;
const RELAY_EVENT = "talk.realtime.relay";

type TalkRealtimeRelayEvent =
  | { relaySessionId: string; type: "ready" }
  | { relaySessionId: string; type: "audio"; audioBase64: string }
  | { relaySessionId: string; type: "clear" }
  | { relaySessionId: string; type: "mark"; markName: string }
  | {
      relaySessionId: string;
      type: "transcript";
      role: "user" | "assistant";
      text: string;
      final: boolean;
    }
  | {
      relaySessionId: string;
      type: "toolCall";
      itemId: string;
      callId: string;
      name: string;
      args: unknown;
    }
  | { relaySessionId: string; type: "error"; message: string }
  | { relaySessionId: string; type: "close"; reason: "completed" | "error" };

type RelaySession = {
  id: string;
  connId: string;
  context: GatewayRequestContext;
  bridge: RealtimeVoiceBridgeSession;
  expiresAtMs: number;
  cleanupTimer: ReturnType<typeof setTimeout>;
};

type CreateTalkRealtimeRelaySessionParams = {
  context: GatewayRequestContext;
  connId: string;
  provider: RealtimeVoiceProviderPlugin;
  providerConfig: RealtimeVoiceProviderConfig;
  instructions: string;
  tools: RealtimeVoiceTool[];
  model?: string;
  voice?: string;
};

type TalkRealtimeRelaySessionResult = {
  provider: string;
  transport: "gateway-relay";
  relaySessionId: string;
  audio: RealtimeVoiceBrowserAudioContract;
  model?: string;
  voice?: string;
  expiresAt: number;
};

const relaySessions = new Map<string, RelaySession>();

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function broadcastToOwner(
  context: GatewayRequestContext,
  connId: string,
  event: TalkRealtimeRelayEvent,
): void {
  context.broadcastToConnIds(RELAY_EVENT, event, new Set([connId]));
}

function closeBridgeQuietly(session: RelaySession): void {
  try {
    session.bridge.close();
  } catch {
    // Provider cleanup must not break gateway disconnect/session cleanup.
  }
}

function closeRelaySession(session: RelaySession, reason: "completed" | "error"): void {
  relaySessions.delete(session.id);
  clearTimeout(session.cleanupTimer);
  closeBridgeQuietly(session);
  broadcastToOwner(session.context, session.connId, {
    relaySessionId: session.id,
    type: "close",
    reason,
  });
}

function pruneExpiredRelaySessions(nowMs = Date.now()): void {
  for (const session of relaySessions.values()) {
    if (nowMs > session.expiresAtMs) {
      closeRelaySession(session, "completed");
    }
  }
}

function countRelaySessionsForConn(connId: string): number {
  let count = 0;
  for (const session of relaySessions.values()) {
    if (session.connId === connId) {
      count += 1;
    }
  }
  return count;
}

function enforceRelaySessionLimits(connId: string): void {
  pruneExpiredRelaySessions();
  if (relaySessions.size >= MAX_RELAY_SESSIONS_GLOBAL) {
    throw new Error("Too many active realtime relay sessions");
  }
  if (countRelaySessionsForConn(connId) >= MAX_RELAY_SESSIONS_PER_CONN) {
    throw new Error("Too many active realtime relay sessions for this connection");
  }
}

export function createTalkRealtimeRelaySession(
  params: CreateTalkRealtimeRelaySessionParams,
): TalkRealtimeRelaySessionResult {
  enforceRelaySessionLimits(params.connId);
  const relaySessionId = randomUUID();
  const expiresAtMs = Date.now() + RELAY_SESSION_TTL_MS;
  let relay: RelaySession | undefined;
  const emitIfActive = (event: TalkRealtimeRelayEvent) => {
    if (!relay || relaySessions.get(relaySessionId) !== relay) {
      return;
    }
    broadcastToOwner(params.context, params.connId, event);
  };
  const bridge = createRealtimeVoiceBridgeSession({
    provider: params.provider,
    providerConfig: params.providerConfig,
    audioFormat: REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ,
    instructions: params.instructions,
    tools: params.tools,
    markStrategy: "transport",
    audioSink: {
      isOpen: () => Boolean(relay && relaySessions.has(relay.id)),
      sendAudio: (audio) =>
        emitIfActive({
          relaySessionId,
          type: "audio",
          audioBase64: audio.toString("base64"),
        }),
      clearAudio: () => emitIfActive({ relaySessionId, type: "clear" }),
      sendMark: (markName) => emitIfActive({ relaySessionId, type: "mark", markName }),
    },
    onTranscript: (role, text, final) => {
      emitIfActive({ relaySessionId, type: "transcript", role, text, final });
    },
    onToolCall: (toolCall) => {
      emitIfActive({
        relaySessionId,
        type: "toolCall",
        itemId: toolCall.itemId,
        callId: toolCall.callId,
        name: toolCall.name,
        args: toolCall.args,
      });
    },
    onReady: () => emitIfActive({ relaySessionId, type: "ready" }),
    onError: (error) => emitIfActive({ relaySessionId, type: "error", message: error.message }),
    onClose: (reason) => {
      const active = relaySessions.get(relaySessionId);
      if (!active) {
        return;
      }
      relaySessions.delete(relaySessionId);
      clearTimeout(active.cleanupTimer);
      broadcastToOwner(params.context, params.connId, { relaySessionId, type: "close", reason });
    },
  });
  relay = {
    id: relaySessionId,
    connId: params.connId,
    context: params.context,
    bridge,
    expiresAtMs,
    cleanupTimer: setTimeout(() => {
      const active = relaySessions.get(relaySessionId);
      if (active) {
        closeRelaySession(active, "completed");
      }
    }, RELAY_SESSION_TTL_MS),
  };
  relay.cleanupTimer.unref?.();
  relaySessions.set(relaySessionId, relay);
  bridge.connect().catch((error: unknown) => {
    emitIfActive({ relaySessionId, type: "error", message: formatError(error) });
    const active = relaySessions.get(relaySessionId);
    if (active) {
      closeRelaySession(active, "error");
    }
  });

  return {
    provider: params.provider.id,
    transport: "gateway-relay",
    relaySessionId,
    audio: {
      inputEncoding: "pcm16",
      inputSampleRateHz: REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ.sampleRateHz,
      outputEncoding: "pcm16",
      outputSampleRateHz: REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ.sampleRateHz,
    },
    ...(params.model ? { model: params.model } : {}),
    ...(params.voice ? { voice: params.voice } : {}),
    expiresAt: Math.floor(expiresAtMs / 1000),
  };
}

function getRelaySession(relaySessionId: string, connId: string): RelaySession {
  const session = relaySessions.get(relaySessionId);
  if (!session) {
    throw new Error("Unknown realtime relay session");
  }
  if (Date.now() > session.expiresAtMs) {
    closeRelaySession(session, "completed");
    throw new Error("Unknown realtime relay session");
  }
  if (session.connId !== connId) {
    throw new Error("Unknown realtime relay session");
  }
  return session;
}

export function sendTalkRealtimeRelayAudio(params: {
  relaySessionId: string;
  connId: string;
  audioBase64: string;
  timestamp?: number;
}): void {
  if (params.audioBase64.length > MAX_AUDIO_BASE64_BYTES) {
    throw new Error("Realtime relay audio frame is too large");
  }
  const session = getRelaySession(params.relaySessionId, params.connId);
  const audio = Buffer.from(params.audioBase64, "base64");
  if (audio.length === 0) {
    throw new Error("Realtime relay audio frame is empty");
  }
  session.bridge.sendAudio(audio);
  if (typeof params.timestamp === "number" && Number.isFinite(params.timestamp)) {
    session.bridge.setMediaTimestamp(params.timestamp);
  }
}

export function sendTalkRealtimeRelayUserMessage(params: {
  relaySessionId: string;
  connId: string;
  text: string;
}): void {
  const text = params.text.trim();
  if (!text) {
    throw new Error("Realtime relay user message is empty");
  }
  if (text.length > MAX_USER_MESSAGE_CHARS) {
    throw new Error("Realtime relay user message is too large");
  }
  getRelaySession(params.relaySessionId, params.connId).bridge.sendUserMessage(text);
}

export function acknowledgeTalkRealtimeRelayMark(params: {
  relaySessionId: string;
  connId: string;
}): void {
  getRelaySession(params.relaySessionId, params.connId).bridge.acknowledgeMark();
}

export function submitTalkRealtimeRelayToolResult(params: {
  relaySessionId: string;
  connId: string;
  callId: string;
  result: unknown;
}): void {
  getRelaySession(params.relaySessionId, params.connId).bridge.submitToolResult(
    params.callId,
    params.result,
  );
}

export function stopTalkRealtimeRelaySession(params: {
  relaySessionId: string;
  connId: string;
}): void {
  const session = getRelaySession(params.relaySessionId, params.connId);
  closeRelaySession(session, "completed");
}

export function closeTalkRealtimeRelaySessionsForConn(connId: string): void {
  for (const session of relaySessions.values()) {
    if (session.connId === connId) {
      closeRelaySession(session, "completed");
    }
  }
}

export function clearTalkRealtimeRelaySessionsForTest(): void {
  for (const session of relaySessions.values()) {
    clearTimeout(session.cleanupTimer);
    closeBridgeQuietly(session);
  }
  relaySessions.clear();
}
