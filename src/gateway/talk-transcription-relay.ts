import { randomUUID } from "node:crypto";
import type { OpenClawConfig } from "../config/types.js";
import { buildMediaAudioRuntimeConfig } from "../media-understanding/audio-runtime-config.js";
import {
  buildMediaUnderstandingRegistry,
  getMediaUnderstandingProvider,
} from "../media-understanding/provider-registry.js";
import { transcribeAudioBuffer } from "../media-understanding/runtime.js";
import { withTimeout } from "../node-host/with-timeout.js";
import type { RealtimeTranscriptionProviderPlugin } from "../plugins/types.js";
import type { RealtimeTranscriptionProviderConfig } from "../realtime-transcription/provider-types.js";
import { parseFiniteNumber as readFiniteNumber } from "../shared/number-coercion.js";
import { recordTalkObservabilityEvent } from "../talk/observability.js";
import {
  type TalkEvent,
  type TalkEventInput,
  type TalkSessionController,
  createTalkSessionController,
} from "../talk/talk-session-controller.js";
import type { GatewayRequestContext } from "./server-methods/shared-types.js";
import { buildTranscriptionWavAudio } from "./talk-transcription-audio.js";

const TRANSCRIPTION_SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_AUDIO_BASE64_BYTES = 512 * 1024;
const MAX_TRANSCRIPTION_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_TRANSCRIPTION_SESSIONS_PER_CONN = 2;
const MAX_TRANSCRIPTION_SESSIONS_GLOBAL = 64;
const TRANSCRIPTION_FINALIZE_TIMEOUT_MS = 60_000;
const TRANSCRIPTION_EVENT = "talk.event";
const RELAY_INPUT_ENCODING = "g711_ulaw";
const RELAY_INPUT_SAMPLE_RATE_HZ = 8000;
const RELAY_PROVIDER_LABEL = "media-understanding";

type TalkTranscriptionRelayEventPayload =
  | { transcriptionSessionId: string; type: "ready" }
  | { transcriptionSessionId: string; type: "inputAudio"; byteLength: number }
  | { transcriptionSessionId: string; type: "partial"; text: string }
  | { transcriptionSessionId: string; type: "transcript"; text: string; final: true }
  | { transcriptionSessionId: string; type: "speechStart" }
  | { transcriptionSessionId: string; type: "turnEnd" }
  | { transcriptionSessionId: string; type: "error"; message: string }
  | { transcriptionSessionId: string; type: "close"; reason: "completed" | "error" };

type TalkTranscriptionRelayEvent = TalkTranscriptionRelayEventPayload & {
  talkEvent?: TalkEvent;
};

type TranscriptionRelaySession = {
  id: string;
  connId: string;
  context: GatewayRequestContext;
  talk: TalkSessionController;
  expiresAtMs: number;
  cleanupTimer: ReturnType<typeof setTimeout>;
} & (
  | {
      kind: "streaming";
      provider: RealtimeTranscriptionProviderPlugin;
      sttSession: ReturnType<RealtimeTranscriptionProviderPlugin["createSession"]>;
      closed: boolean;
    }
  | {
      kind: "buffered";
      provider?: string;
      model?: string;
      audioChunks: Buffer[];
      audioByteLength: number;
      status: "buffering" | "finalizing" | "cancelled" | "closed";
    }
);

type TranscriptionResult = Awaited<ReturnType<typeof transcribeAudioBuffer>>;

export class TalkTranscriptionRelayProviderError extends Error {
  constructor(provider: string) {
    super(
      `transcription provider "${provider}" is not registered for media-understanding audio transcription`,
    );
    this.name = "TalkTranscriptionRelayProviderError";
  }
}

type CreateTalkTranscriptionRelaySessionParams = {
  context: GatewayRequestContext;
  connId: string;
  transcriptionMode?: "streaming" | "buffered";
  provider?: string;
  model?: string;
  streamingProvider?: RealtimeTranscriptionProviderPlugin;
  streamingProviderConfig?: RealtimeTranscriptionProviderConfig;
};

type TalkTranscriptionRelaySessionResult = {
  provider?: string;
  mode: "transcription";
  transport: "gateway-relay";
  transcriptionSessionId: string;
  audio: {
    inputEncoding: "g711_ulaw";
    inputSampleRateHz: 8000;
  };
  expiresAt: number;
};

const transcriptionSessions = new Map<string, TranscriptionRelaySession>();

function normalizeRelayInputEncoding(
  value: unknown,
): "g711_ulaw" | "g711_alaw" | "pcm16" | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (
    normalized === "mulaw" ||
    normalized === "ulaw" ||
    normalized === "g711_ulaw" ||
    normalized === "g711-mulaw" ||
    normalized === "pcm_mulaw" ||
    normalized === "audio/pcmu" ||
    normalized === "ulaw_8000"
  ) {
    return "g711_ulaw";
  }
  if (
    normalized === "alaw" ||
    normalized === "g711_alaw" ||
    normalized === "g711-alaw" ||
    normalized === "pcm_alaw"
  ) {
    return "g711_alaw";
  }
  if (
    normalized === "pcm" ||
    normalized === "pcm16" ||
    normalized === "linear16" ||
    normalized === "pcm_s16le"
  ) {
    return "pcm16";
  }
  return undefined;
}

function inferSampleRateFromAudioFormat(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const match = value.match(/_(\d+)$/);
  return match ? readFiniteNumber(match[1]) : undefined;
}

function assertRelayInputAudioConfig(providerConfig: RealtimeTranscriptionProviderConfig): void {
  const encodingValue =
    providerConfig.encoding ?? providerConfig.audioFormat ?? providerConfig.audio_format;
  const encoding = normalizeRelayInputEncoding(encodingValue);
  if (encoding && encoding !== RELAY_INPUT_ENCODING) {
    throw new Error(
      `Gateway transcription relay requires ${RELAY_INPUT_ENCODING}/${RELAY_INPUT_SAMPLE_RATE_HZ} audio`,
    );
  }

  const sampleRate =
    readFiniteNumber(providerConfig.sampleRate ?? providerConfig.sample_rate) ??
    inferSampleRateFromAudioFormat(encodingValue);
  if (sampleRate && sampleRate !== RELAY_INPUT_SAMPLE_RATE_HZ) {
    throw new Error(
      `Gateway transcription relay requires ${RELAY_INPUT_ENCODING}/${RELAY_INPUT_SAMPLE_RATE_HZ} audio`,
    );
  }
}

function broadcastToOwner(
  context: GatewayRequestContext,
  connId: string,
  event: TalkTranscriptionRelayEvent,
): void {
  context.broadcastToConnIds(TRANSCRIPTION_EVENT, event, new Set([connId]), { dropIfSlow: true });
}

function emitSessionEvent(
  session: TranscriptionRelaySession,
  event: TalkTranscriptionRelayEventPayload,
  talkEvent?: TalkEventInput,
): void {
  broadcastToOwner(session.context, session.connId, {
    ...event,
    ...(talkEvent ? { talkEvent: session.talk.emit(talkEvent) } : {}),
  });
}

function ensureTranscriptionTurn(session: TranscriptionRelaySession): string {
  const turn = session.talk.ensureTurn();
  if (turn.event) {
    broadcastToOwner(session.context, session.connId, {
      transcriptionSessionId: session.id,
      type: "speechStart",
      talkEvent: turn.event,
    });
  }
  return turn.turnId;
}

function closeTranscriptionSession(
  session: TranscriptionRelaySession,
  reason: "completed" | "error",
): void {
  if (session.kind === "streaming") {
    if (session.closed) {
      return;
    }
    session.closed = true;
    session.sttSession.close();
  } else {
    if (session.status === "closed") {
      return;
    }
    session.audioChunks = [];
    session.audioByteLength = 0;
    session.status = "closed";
  }
  transcriptionSessions.delete(session.id);
  clearTimeout(session.cleanupTimer);
  broadcastToOwner(session.context, session.connId, {
    transcriptionSessionId: session.id,
    type: "close",
    reason,
    talkEvent: session.talk.emit({
      type: "session.closed",
      payload: { reason },
      final: true,
    }),
  });
}

function pruneExpiredTranscriptionSessions(nowMs = Date.now()): void {
  for (const session of transcriptionSessions.values()) {
    if (nowMs > session.expiresAtMs) {
      closeTranscriptionSession(session, "completed");
    }
  }
}

function countTranscriptionSessionsForConn(connId: string): number {
  let count = 0;
  for (const session of transcriptionSessions.values()) {
    if (session.connId === connId) {
      count += 1;
    }
  }
  return count;
}

function enforceTranscriptionSessionLimits(connId: string): void {
  pruneExpiredTranscriptionSessions();
  if (transcriptionSessions.size >= MAX_TRANSCRIPTION_SESSIONS_GLOBAL) {
    throw new Error("Too many active transcription Talk sessions");
  }
  if (countTranscriptionSessionsForConn(connId) >= MAX_TRANSCRIPTION_SESSIONS_PER_CONN) {
    throw new Error("Too many active transcription Talk sessions for this connection");
  }
}

export function assertTalkTranscriptionRelayProvider(params: {
  cfg: OpenClawConfig;
  provider?: string;
}): void {
  const provider = params.provider?.trim();
  if (!provider) {
    return;
  }
  const registry = buildMediaUnderstandingRegistry(undefined, params.cfg);
  const mediaProvider = getMediaUnderstandingProvider(provider, registry);
  if (!mediaProvider?.transcribeAudio) {
    throw new TalkTranscriptionRelayProviderError(provider);
  }
}

export function createTalkTranscriptionRelaySession(
  params: CreateTalkTranscriptionRelaySessionParams,
): TalkTranscriptionRelaySessionResult {
  enforceTranscriptionSessionLimits(params.connId);
  const transcriptionSessionId = randomUUID();
  const expiresAtMs = Date.now() + TRANSCRIPTION_SESSION_TTL_MS;
  const transcriptionMode = params.transcriptionMode ?? "streaming";
  if (transcriptionMode === "streaming") {
    return createStreamingTalkTranscriptionRelaySession({
      ...params,
      transcriptionSessionId,
      expiresAtMs,
    });
  }
  return createBufferedTalkTranscriptionRelaySession({
    ...params,
    transcriptionSessionId,
    expiresAtMs,
  });
}

function createBufferedTalkTranscriptionRelaySession(
  params: CreateTalkTranscriptionRelaySessionParams & {
    transcriptionSessionId: string;
    expiresAtMs: number;
  },
): TalkTranscriptionRelaySessionResult {
  const provider = params.provider?.trim() || undefined;
  const model = params.model?.trim() || undefined;
  const talk = createTalkSessionController(
    {
      sessionId: params.transcriptionSessionId,
      mode: "transcription",
      transport: "gateway-relay",
      brain: "none",
      provider: provider ?? RELAY_PROVIDER_LABEL,
    },
    { onEvent: recordTalkObservabilityEvent },
  );
  const relay: TranscriptionRelaySession = {
    kind: "buffered",
    id: params.transcriptionSessionId,
    connId: params.connId,
    context: params.context,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    talk,
    audioChunks: [],
    audioByteLength: 0,
    expiresAtMs: params.expiresAtMs,
    cleanupTimer: setTimeout(() => {
      const active = transcriptionSessions.get(params.transcriptionSessionId);
      if (active) {
        closeTranscriptionSession(active, "completed");
      }
    }, TRANSCRIPTION_SESSION_TTL_MS),
    status: "buffering",
  };
  relay.cleanupTimer.unref?.();
  transcriptionSessions.set(params.transcriptionSessionId, relay);
  queueMicrotask(() => {
    if (relay.status !== "closed") {
      emitSessionEvent(
        relay,
        { transcriptionSessionId: params.transcriptionSessionId, type: "ready" },
        {
          type: "session.ready",
          payload: null,
        },
      );
    }
  });

  return {
    ...(provider ? { provider } : {}),
    mode: "transcription",
    transport: "gateway-relay",
    transcriptionSessionId: params.transcriptionSessionId,
    audio: {
      inputEncoding: RELAY_INPUT_ENCODING,
      inputSampleRateHz: RELAY_INPUT_SAMPLE_RATE_HZ,
    },
    expiresAt: Math.floor(params.expiresAtMs / 1000),
  };
}

function createStreamingTalkTranscriptionRelaySession(
  params: CreateTalkTranscriptionRelaySessionParams & {
    transcriptionSessionId: string;
    expiresAtMs: number;
  },
): TalkTranscriptionRelaySessionResult {
  if (!params.streamingProvider || !params.streamingProviderConfig) {
    throw new Error("No realtime transcription provider registered");
  }
  assertRelayInputAudioConfig(params.streamingProviderConfig);
  const talk = createTalkSessionController(
    {
      sessionId: params.transcriptionSessionId,
      mode: "transcription",
      transport: "gateway-relay",
      brain: "none",
      provider: params.streamingProvider.id,
    },
    { onEvent: recordTalkObservabilityEvent },
  );
  const relayRef: { current?: TranscriptionRelaySession } = {};
  const emit = (event: TalkTranscriptionRelayEventPayload, talkEvent?: TalkEventInput): void => {
    broadcastToOwner(params.context, params.connId, {
      ...event,
      ...(talkEvent ? { talkEvent: talk.emit(talkEvent) } : {}),
    });
  };
  const ensureTurnId = (): string => {
    return relayRef.current ? ensureTranscriptionTurn(relayRef.current) : "turn-1";
  };
  const sttSession = params.streamingProvider.createSession({
    cfg: params.context.getRuntimeConfig(),
    providerConfig: params.streamingProviderConfig,
    onSpeechStart: () => {
      ensureTurnId();
    },
    onPartial: (text) => {
      const turnId = ensureTurnId();
      emit(
        { transcriptionSessionId: params.transcriptionSessionId, type: "partial", text },
        {
          type: "transcript.delta",
          turnId,
          payload: { text },
        },
      );
    },
    onTranscript: (text) => {
      const turnId = ensureTurnId();
      emit(
        {
          transcriptionSessionId: params.transcriptionSessionId,
          type: "transcript",
          text,
          final: true,
        },
        {
          type: "transcript.done",
          turnId,
          payload: { text },
          final: true,
        },
      );
      if (relayRef.current) {
        const ended = relayRef.current.talk.endTurn({ turnId, payload: {} });
        if (ended.ok) {
          broadcastToOwner(relayRef.current.context, relayRef.current.connId, {
            transcriptionSessionId: params.transcriptionSessionId,
            type: "turnEnd",
            talkEvent: ended.event,
          });
        }
      }
    },
    onError: (error) => {
      emit(
        {
          transcriptionSessionId: params.transcriptionSessionId,
          type: "error",
          message: error.message,
        },
        {
          type: "session.error",
          payload: { message: error.message },
          final: true,
        },
      );
      if (relayRef.current) {
        closeTranscriptionSession(relayRef.current, "error");
      }
    },
  });
  const relay: TranscriptionRelaySession = {
    kind: "streaming",
    id: params.transcriptionSessionId,
    connId: params.connId,
    context: params.context,
    provider: params.streamingProvider,
    sttSession,
    talk,
    expiresAtMs: params.expiresAtMs,
    cleanupTimer: setTimeout(() => {
      const active = transcriptionSessions.get(params.transcriptionSessionId);
      if (active) {
        closeTranscriptionSession(active, "completed");
      }
    }, TRANSCRIPTION_SESSION_TTL_MS),
    closed: false,
  };
  relayRef.current = relay;
  relay.cleanupTimer.unref?.();
  transcriptionSessions.set(params.transcriptionSessionId, relay);
  sttSession
    .connect()
    .then(() => {
      emit(
        { transcriptionSessionId: params.transcriptionSessionId, type: "ready" },
        { type: "session.ready", payload: null },
      );
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      emit(
        { transcriptionSessionId: params.transcriptionSessionId, type: "error", message },
        {
          type: "session.error",
          payload: { message },
          final: true,
        },
      );
      const active = transcriptionSessions.get(params.transcriptionSessionId);
      if (active) {
        closeTranscriptionSession(active, "error");
      }
    });

  return {
    provider: params.streamingProvider.id,
    mode: "transcription",
    transport: "gateway-relay",
    transcriptionSessionId: params.transcriptionSessionId,
    audio: {
      inputEncoding: RELAY_INPUT_ENCODING,
      inputSampleRateHz: RELAY_INPUT_SAMPLE_RATE_HZ,
    },
    expiresAt: Math.floor(params.expiresAtMs / 1000),
  };
}

function getTranscriptionSession(
  transcriptionSessionId: string,
  connId: string,
): TranscriptionRelaySession {
  const session = transcriptionSessions.get(transcriptionSessionId);
  // Collapse "not found" and "owned by a different connId" into the same error so
  // an unauthorized connId cannot probe for valid session ids by reading the message.
  if (!session || session.connId !== connId) {
    throw new Error("transcription session not found");
  }
  if (Date.now() > session.expiresAtMs) {
    closeTranscriptionSession(session, "completed");
    throw new Error("transcription session expired");
  }
  return session;
}

export function sendTalkTranscriptionRelayAudio(params: {
  transcriptionSessionId: string;
  connId: string;
  audioBase64: string;
}): void {
  if (params.audioBase64.length > MAX_AUDIO_BASE64_BYTES) {
    throw new Error("Transcription Talk audio frame is too large");
  }
  const session = getTranscriptionSession(params.transcriptionSessionId, params.connId);
  if (session.kind === "streaming") {
    const audio = Buffer.from(params.audioBase64, "base64");
    const turnId = ensureTranscriptionTurn(session);
    session.sttSession.sendAudio(audio);
    broadcastToOwner(session.context, session.connId, {
      transcriptionSessionId: session.id,
      type: "inputAudio",
      byteLength: audio.byteLength,
      talkEvent: session.talk.emit({
        type: "input.audio.delta",
        turnId,
        payload: { byteLength: audio.byteLength },
      }),
    });
    return;
  }
  if (session.status === "finalizing") {
    throw new Error("Transcription Talk session is finalizing");
  }
  const audio = Buffer.from(params.audioBase64, "base64");
  if (session.audioByteLength + audio.byteLength > MAX_TRANSCRIPTION_AUDIO_BYTES) {
    throw new Error("Transcription Talk audio exceeds session limit");
  }
  const turnId = ensureTranscriptionTurn(session);
  session.audioChunks.push(audio);
  session.audioByteLength += audio.byteLength;
  broadcastToOwner(session.context, session.connId, {
    transcriptionSessionId: session.id,
    type: "inputAudio",
    byteLength: audio.byteLength,
    talkEvent: session.talk.emit({
      type: "input.audio.delta",
      turnId,
      payload: { byteLength: audio.byteLength },
    }),
  });
}

async function finalizeTranscriptionSession(
  session: TranscriptionRelaySession,
  turnId: string,
): Promise<void> {
  if (session.kind !== "buffered") {
    return;
  }
  try {
    if (isFinalizeAborted(session)) {
      return;
    }
    const mulawAudio = takeBufferedTranscriptionAudio(session);
    const result = await withTimeout(
      async () => await transcribeBufferedAudio(session, mulawAudio),
      TRANSCRIPTION_FINALIZE_TIMEOUT_MS,
      "Audio transcription",
    );
    if (isFinalizeAborted(session)) {
      return;
    }
    const text = validateTranscriptionResult(session, result);
    emitTranscriptionResult(session, turnId, result, text);
    closeTranscriptionSession(session, "completed");
  } catch (error) {
    if (session.status === "closed") {
      return;
    }
    if (error instanceof TranscriptionCancelledError || session.status === "cancelled") {
      // Cancel was requested mid-finalize; the cancel path emits its own events
      // and closes the session.
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    emitSessionEvent(
      session,
      { transcriptionSessionId: session.id, type: "error", message },
      {
        type: "session.error",
        payload: { message },
        final: true,
      },
    );
    closeTranscriptionSession(session, "error");
  }
}

function isFinalizeAborted(session: TranscriptionRelaySession): boolean {
  return (
    session.kind !== "buffered" || session.status === "closed" || session.status === "cancelled"
  );
}

function takeBufferedTranscriptionAudio(session: TranscriptionRelaySession): Buffer {
  if (session.kind !== "buffered") {
    throw new Error("Transcription Talk session is not buffered");
  }
  if (session.audioByteLength === 0) {
    throw new Error("No transcription audio received");
  }
  const mulawAudio = Buffer.concat(session.audioChunks, session.audioByteLength);
  session.audioChunks = [];
  session.audioByteLength = 0;
  return mulawAudio;
}

async function transcribeBufferedAudio(
  session: TranscriptionRelaySession,
  mulawAudio: Buffer,
): Promise<TranscriptionResult> {
  if (session.kind !== "buffered") {
    throw new Error("Transcription Talk session is not buffered");
  }
  const wavAudio = buildTranscriptionWavAudio({
    mulawAudio,
    sampleRateHz: RELAY_INPUT_SAMPLE_RATE_HZ,
  });
  if (isFinalizeAborted(session)) {
    throw new TranscriptionCancelledError();
  }
  const cfg = buildMediaAudioRuntimeConfig(session.context.getRuntimeConfig(), {
    provider: session.provider,
    model: session.model,
  });
  return await transcribeAudioBuffer({
    buffer: wavAudio,
    fileName: "input.wav",
    mime: "audio/wav",
    cfg,
    timeoutMs: TRANSCRIPTION_FINALIZE_TIMEOUT_MS,
    ...(session.provider
      ? {
          activeModel: {
            provider: session.provider,
            ...(session.model ? { model: session.model } : {}),
          },
        }
      : {}),
  });
}

function validateTranscriptionResult(
  session: TranscriptionRelaySession,
  result: TranscriptionResult,
): string {
  if (session.kind !== "buffered") {
    throw new Error("Transcription Talk session is not buffered");
  }
  if (result.decision?.outcome === "disabled") {
    throw new Error(
      "Audio transcription is disabled by gateway config (tools.media.audio.enabled = false)",
    );
  }
  if (session.provider && result.provider !== session.provider) {
    throw new Error(
      `Requested transcription provider "${session.provider}" but media-understanding used "${result.provider ?? "unknown"}"`,
    );
  }
  if (session.model && result.model !== session.model) {
    throw new Error(
      `Requested transcription model "${session.model}" but media-understanding used "${result.model ?? "unknown"}"`,
    );
  }
  const text = result.text?.trim() ?? "";
  if (!text) {
    throw new Error("Audio transcription returned no transcript");
  }
  return text;
}

function emitTranscriptionResult(
  session: TranscriptionRelaySession,
  turnId: string,
  result: TranscriptionResult,
  text: string,
): void {
  emitSessionEvent(
    session,
    { transcriptionSessionId: session.id, type: "transcript", text, final: true },
    {
      type: "transcript.done",
      turnId,
      payload: {
        text,
        provider: result.provider,
        model: result.model,
      },
      final: true,
    },
  );
  const ended = session.talk.endTurn({ turnId, payload: {} });
  if (ended.ok) {
    broadcastToOwner(session.context, session.connId, {
      transcriptionSessionId: session.id,
      type: "turnEnd",
      talkEvent: ended.event,
    });
  }
}

class TranscriptionCancelledError extends Error {
  constructor() {
    super("transcription cancelled");
    this.name = "TranscriptionCancelledError";
  }
}

export function stopTalkTranscriptionRelaySession(params: {
  transcriptionSessionId: string;
  connId: string;
}): void {
  const session = getTranscriptionSession(params.transcriptionSessionId, params.connId);
  if (session.kind === "streaming") {
    if (session.talk.activeTurnId) {
      broadcastToOwner(session.context, session.connId, {
        transcriptionSessionId: session.id,
        type: "transcript",
        text: "",
        final: true,
        talkEvent: session.talk.emit({
          type: "input.audio.committed",
          turnId: session.talk.activeTurnId,
          payload: {},
          final: true,
        }),
      });
    }
    closeTranscriptionSession(session, "completed");
    return;
  }
  if (session.status === "finalizing") {
    return;
  }
  session.status = "finalizing";
  if (session.audioByteLength === 0) {
    closeTranscriptionSession(session, "completed");
    return;
  }
  clearTimeout(session.cleanupTimer);
  const turnId = session.talk.activeTurnId ?? ensureTranscriptionTurn(session);
  broadcastToOwner(session.context, session.connId, {
    transcriptionSessionId: session.id,
    type: "transcript",
    text: "",
    final: true,
    talkEvent: session.talk.emit({
      type: "input.audio.committed",
      turnId,
      payload: {},
      final: true,
    }),
  });
  void finalizeTranscriptionSession(session, turnId);
}

/**
 * Cancel an in-flight transcription turn.
 *
 * The relay-level wire event for a cancel is intentionally identical to a
 * normal-completion empty transcript:
 * `{type: "transcript", text: "", final: true}`.
 *
 * Consumers that need to tell a user-cancel apart from an ordinary
 * empty-transcript outcome must inspect the embedded `talkEvent.type`
 * (`input.audio.cancelled` here, vs. `transcript.done` /
 * `input.audio.committed` for normal completion). This keeps the wire-level
 * event surface small; if a future caller actually needs an explicit cancel
 * marker, add a new relay event type rather than retro-fitting a flag onto
 * `transcript`.
 */
export function cancelTalkTranscriptionRelayTurn(params: {
  transcriptionSessionId: string;
  connId: string;
  reason?: string;
}): void {
  const session = getTranscriptionSession(params.transcriptionSessionId, params.connId);
  if (
    session.kind === "buffered" &&
    (session.status === "closed" || session.status === "cancelled")
  ) {
    return;
  }
  // Flag the cancellation so an in-flight finalize early-returns without emitting
  // a duplicate transcript/error event.
  if (session.kind === "buffered") {
    session.status = "cancelled";
  }
  const turnId = session.talk.activeTurnId ?? ensureTranscriptionTurn(session);
  const cancelled = session.talk.cancelTurn({
    turnId,
    payload: { reason: params.reason ?? "client-cancelled" },
  });
  broadcastToOwner(session.context, session.connId, {
    transcriptionSessionId: session.id,
    type: "transcript",
    text: "",
    final: true,
    talkEvent: cancelled.ok ? cancelled.event : undefined,
  });
  closeTranscriptionSession(session, "completed");
}

export function clearTalkTranscriptionRelaySessionsForTest(): void {
  for (const session of transcriptionSessions.values()) {
    if (session.kind === "streaming") {
      session.closed = true;
      session.sttSession.close();
    } else {
      session.status = "closed";
      session.audioChunks = [];
      session.audioByteLength = 0;
    }
    clearTimeout(session.cleanupTimer);
  }
  transcriptionSessions.clear();
}
