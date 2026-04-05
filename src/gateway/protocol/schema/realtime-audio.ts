import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const RealtimeSessionModeSchema = Type.Union([
  Type.Literal("realtime"),
  Type.Literal("fallback"),
]);

export const RealtimeSessionStateSchema = Type.Union([
  Type.Literal("idle"),
  Type.Literal("listening"),
  Type.Literal("thinking"),
  Type.Literal("speaking"),
  Type.Literal("closed"),
]);

export const RealtimeTransportStateSchema = Type.Union([
  Type.Literal("idle"),
  Type.Literal("signaling"),
  Type.Literal("connecting"),
  Type.Literal("connected"),
  Type.Literal("failed"),
  Type.Literal("closed"),
]);

export const RealtimeAssistantTurnStateSchema = Type.Union([
  Type.Literal("idle"),
  Type.Literal("thinking"),
  Type.Literal("speaking"),
  Type.Literal("interrupted"),
  Type.Literal("completed"),
]);

export const RealtimeTranscriptRoleSchema = Type.Union([
  Type.Literal("user"),
  Type.Literal("assistant"),
]);

export const RealtimeTranscriptStatusSchema = Type.Union([
  Type.Literal("partial"),
  Type.Literal("final"),
]);

export const RealtimeFallbackReasonCodeSchema = Type.Union([
  Type.Literal("provider_unavailable"),
  Type.Literal("provider_failed"),
  Type.Literal("transport_unavailable"),
  Type.Literal("policy_blocked"),
  Type.Literal("operator_forced"),
]);

export const RealtimeToolCallStatusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("approval"),
  Type.Literal("completed"),
  Type.Literal("failed"),
]);

export const RealtimeTransportSignalSchema = Type.Union(
  [
    Type.Object(
      {
        kind: Type.Literal("offer"),
        sdp: NonEmptyString,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        kind: Type.Literal("answer"),
        sdp: NonEmptyString,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        kind: Type.Literal("ice-candidate"),
        candidate: NonEmptyString,
        sdpMid: Type.Optional(Type.String()),
        sdpMLineIndex: Type.Optional(Type.Integer({ minimum: 0 })),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        kind: Type.Literal("end-of-candidates"),
      },
      { additionalProperties: false },
    ),
  ],
  { discriminator: "kind" },
);

export const RealtimeSessionCapabilityNameSchema = Type.Union([
  Type.Literal("textInput"),
  Type.Literal("audioInput"),
  Type.Literal("toolCalls"),
  Type.Literal("toolResultContinuation"),
  Type.Literal("transportSignal"),
]);

export const RealtimeSessionCreateParamsSchema = Type.Object(
  {
    transport: Type.Union([Type.Literal("desktop"), Type.Literal("discord"), Type.Literal("test")]),
    provider: Type.Optional(NonEmptyString),
    fallbackEnabled: Type.Optional(Type.Boolean()),
    capabilities: Type.Optional(Type.Array(RealtimeSessionCapabilityNameSchema)),
    sessionKey: Type.Optional(NonEmptyString),
    workspaceDir: Type.Optional(Type.String()),
    agentDir: Type.Optional(Type.String()),
    senderIsOwner: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const RealtimeSessionCapabilitiesSchema = Type.Object(
  {
    textInput: Type.Boolean(),
    audioInput: Type.Boolean(),
    toolCalls: Type.Boolean(),
    toolResultContinuation: Type.Boolean(),
    transportSignal: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const RealtimeSessionCreateResultSchema = Type.Object(
  {
    sessionId: NonEmptyString,
    mode: RealtimeSessionModeSchema,
    state: RealtimeSessionStateSchema,
    capabilities: RealtimeSessionCapabilitiesSchema,
  },
  { additionalProperties: false },
);

export const RealtimeSessionInterruptParamsSchema = Type.Object(
  {
    sessionId: NonEmptyString,
    target: Type.Optional(Type.Union([Type.Literal("assistant"), Type.Literal("user-input")])),
  },
  { additionalProperties: false },
);

export const RealtimeSessionCloseParamsSchema = Type.Object(
  {
    sessionId: NonEmptyString,
    reason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const RealtimeSessionToolCallParamsSchema = Type.Object(
  {
    sessionId: NonEmptyString,
    toolCallId: NonEmptyString,
    toolName: NonEmptyString,
    args: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);

export const RealtimeSessionToolResultParamsSchema = Type.Object(
  {
    sessionId: NonEmptyString,
    toolCallId: NonEmptyString,
    output: Type.String(),
  },
  { additionalProperties: false },
);

export const RealtimeSessionInputTextParamsSchema = Type.Object(
  {
    sessionId: NonEmptyString,
    text: Type.String(),
  },
  { additionalProperties: false },
);

export const RealtimeSessionInputAudioParamsSchema = Type.Object(
  {
    sessionId: NonEmptyString,
    audioBase64: Type.String(),
    sampleRate: Type.Integer({ minimum: 1 }),
    channels: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const RealtimeSessionTransportSignalParamsSchema = Type.Object(
  {
    sessionId: NonEmptyString,
    signal: RealtimeTransportSignalSchema,
  },
  { additionalProperties: false },
);

export const RealtimeTranscriptItemSchema = Type.Object(
  {
    itemId: NonEmptyString,
    role: RealtimeTranscriptRoleSchema,
    status: RealtimeTranscriptStatusSchema,
    text: Type.String(),
    revision: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const RealtimeAssistantTurnSchema = Type.Object(
  {
    turnId: Type.Optional(NonEmptyString),
    state: RealtimeAssistantTurnStateSchema,
  },
  { additionalProperties: false },
);

export const RealtimeToolCallUpdateSchema = Type.Object(
  {
    toolCallId: NonEmptyString,
    toolName: NonEmptyString,
    status: RealtimeToolCallStatusSchema,
    text: Type.Optional(Type.String()),
    approval: Type.Optional(
      Type.Object(
        {
          approvalId: NonEmptyString,
          approvalSlug: Type.Optional(Type.String()),
          expiresAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
        },
        { additionalProperties: false },
      ),
    ),
    error: Type.Optional(
      Type.Object(
        {
          code: NonEmptyString,
          message: NonEmptyString,
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const RealtimeOutputAudioSchema = Type.Object(
  {
    itemId: NonEmptyString,
    pcm16Base64: Type.String(),
    sampleRate: Type.Integer({ minimum: 1 }),
    mimeType: NonEmptyString,
  },
  { additionalProperties: false },
);

const RealtimeSessionCreatedEventSchema = Type.Object(
  {
    type: Type.Literal("session.created"),
    sessionId: NonEmptyString,
    mode: RealtimeSessionModeSchema,
    state: RealtimeSessionStateSchema,
  },
  { additionalProperties: false },
);

const RealtimeSessionStateChangedEventSchema = Type.Object(
  {
    type: Type.Literal("session.state.changed"),
    sessionId: NonEmptyString,
    state: RealtimeSessionStateSchema,
  },
  { additionalProperties: false },
);

const RealtimeTranscriptUpdatedEventSchema = Type.Object(
  {
    type: Type.Literal("transcript.updated"),
    sessionId: NonEmptyString,
    item: RealtimeTranscriptItemSchema,
  },
  { additionalProperties: false },
);

const RealtimeAssistantTurnUpdatedEventSchema = Type.Object(
  {
    type: Type.Literal("assistant.turn.updated"),
    sessionId: NonEmptyString,
    turn: RealtimeAssistantTurnSchema,
  },
  { additionalProperties: false },
);

const RealtimeInterruptAcknowledgedEventSchema = Type.Object(
  {
    type: Type.Literal("interrupt.acknowledged"),
    sessionId: NonEmptyString,
    target: Type.Union([Type.Literal("assistant"), Type.Literal("user-input")]),
  },
  { additionalProperties: false },
);

const RealtimeFallbackChangedEventSchema = Type.Object(
  {
    type: Type.Literal("fallback.changed"),
    sessionId: NonEmptyString,
    mode: Type.Literal("fallback"),
    reason: RealtimeFallbackReasonCodeSchema,
  },
  { additionalProperties: false },
);

const RealtimeSessionClosedEventSchema = Type.Object(
  {
    type: Type.Literal("session.closed"),
    sessionId: NonEmptyString,
    reason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const RealtimeToolUpdatedEventSchema = Type.Object(
  {
    type: Type.Literal("tool.updated"),
    sessionId: NonEmptyString,
    update: RealtimeToolCallUpdateSchema,
  },
  { additionalProperties: false },
);

const RealtimeAudioOutputEventSchema = Type.Object(
  {
    type: Type.Literal("audio.output"),
    sessionId: NonEmptyString,
    audio: RealtimeOutputAudioSchema,
  },
  { additionalProperties: false },
);

const RealtimeTransportStateChangedEventSchema = Type.Object(
  {
    type: Type.Literal("transport.state.changed"),
    sessionId: NonEmptyString,
    state: RealtimeTransportStateSchema,
  },
  { additionalProperties: false },
);

const RealtimeTransportSignalEventSchema = Type.Object(
  {
    type: Type.Literal("transport.signal"),
    sessionId: NonEmptyString,
    signal: RealtimeTransportSignalSchema,
  },
  { additionalProperties: false },
);

const RealtimeSessionErrorEventSchema = Type.Object(
  {
    type: Type.Literal("session.error"),
    sessionId: NonEmptyString,
    code: NonEmptyString,
    message: NonEmptyString,
    retryable: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const RealtimeSessionEventSchema = Type.Union(
  [
    RealtimeSessionCreatedEventSchema,
    RealtimeSessionStateChangedEventSchema,
    RealtimeTranscriptUpdatedEventSchema,
    RealtimeAssistantTurnUpdatedEventSchema,
    RealtimeInterruptAcknowledgedEventSchema,
    RealtimeFallbackChangedEventSchema,
    RealtimeSessionClosedEventSchema,
    RealtimeToolUpdatedEventSchema,
    RealtimeAudioOutputEventSchema,
    RealtimeTransportStateChangedEventSchema,
    RealtimeTransportSignalEventSchema,
    RealtimeSessionErrorEventSchema,
  ],
  { discriminator: "type" },
);
