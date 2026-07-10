import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelTalkTranscriptionRelayTurn,
  clearTalkTranscriptionRelaySessionsForTest,
  createTalkTranscriptionRelaySession,
  sendTalkTranscriptionRelayAudio,
  stopTalkTranscriptionRelaySession,
} from "./talk-transcription-relay.js";

const mocks = vi.hoisted(() => ({
  transcribeAudioBuffer: vi.fn(async () => ({
    text: "hello world",
    provider: "openai-codex",
    model: "gpt-5.5",
  })),
}));

vi.mock("../media-understanding/runtime.js", () => ({
  transcribeAudioBuffer: mocks.transcribeAudioBuffer,
}));

type BroadcastEvent = { event: string; payload: unknown; connIds: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  expect(isRecord(value), `${label} must be an object`).toBe(true);
  return value as Record<string, unknown>;
}

function expectRecordFields(
  value: unknown,
  label: string,
  expected: Record<string, unknown>,
): Record<string, unknown> {
  const record = requireRecord(value, label);
  for (const [key, expectedValue] of Object.entries(expected)) {
    expect(record[key], `${label}.${key}`).toEqual(expectedValue);
  }
  return record;
}

function findPayloadByType(events: BroadcastEvent[], type: string): Record<string, unknown> {
  const event = events.find((candidate) => {
    const payload = candidate.payload;
    return isRecord(payload) && payload.type === type;
  });
  if (!event) {
    throw new Error(`expected relay event type ${type}`);
  }
  expect(event.event).toBe("talk.event");
  return requireRecord(event.payload, `${type} payload`);
}

function findPayloadByTypeAndText(
  events: BroadcastEvent[],
  type: string,
  text: string,
): Record<string, unknown> {
  const event = events.find((candidate) => {
    const payload = candidate.payload;
    return isRecord(payload) && payload.type === type && payload.text === text;
  });
  if (!event) {
    throw new Error(`expected relay event type ${type} with text ${JSON.stringify(text)}`);
  }
  expect(event.event).toBe("talk.event");
  return requireRecord(event.payload, `${type} payload`);
}

function findPayloadByTalkEventType(
  events: BroadcastEvent[],
  type: string,
): Record<string, unknown> {
  const event = events.find((candidate) => {
    const payload = candidate.payload;
    return isRecord(payload) && isRecord(payload.talkEvent) && payload.talkEvent.type === type;
  });
  if (!event) {
    throw new Error(`expected talk event type ${type}`);
  }
  return requireRecord(event.payload, `${type} payload`);
}

function expectTalkEventFields(
  payload: Record<string, unknown>,
  expected: Record<string, unknown>,
): Record<string, unknown> {
  return expectRecordFields(payload.talkEvent, "talk event", expected);
}

function createContext(
  events: BroadcastEvent[],
  runtimeConfig: Record<string, unknown> = { tools: { media: { audio: { enabled: true } } } },
) {
  return {
    getRuntimeConfig: () => runtimeConfig,
    broadcastToConnIds: (event: string, payload: unknown, connIds: ReadonlySet<string>) => {
      events.push({ event, payload, connIds: [...connIds] });
    },
  } as never;
}

function createStreamingProvider() {
  const controller: {
    onPartial?: (text: string) => void;
    onTranscript?: (text: string) => void;
  } = {};
  const sttSession = {
    connect: vi.fn(async () => {}),
    sendAudio: vi.fn(),
    close: vi.fn(),
  };
  return {
    controller,
    sttSession,
    provider: {
      id: "openai",
      label: "OpenAI Realtime Transcription",
      isConfigured: vi.fn(() => true),
      createSession: vi.fn(
        (params: { onPartial?: (text: string) => void; onTranscript?: (text: string) => void }) => {
          controller.onPartial = params.onPartial;
          controller.onTranscript = params.onTranscript;
          return sttSession;
        },
      ),
    },
  };
}

describe("talk transcription gateway relay", () => {
  afterEach(() => {
    clearTalkTranscriptionRelaySessionsForTest();
    mocks.transcribeAudioBuffer.mockClear();
    mocks.transcribeAudioBuffer.mockResolvedValue({
      text: "hello world",
      provider: "openai-codex",
      model: "gpt-5.5",
    });
  });

  it("streams partial and final transcription before session close", async () => {
    const events: BroadcastEvent[] = [];
    const context = createContext(events);
    const streaming = createStreamingProvider();

    const session = createTalkTranscriptionRelaySession({
      context,
      connId: "conn-1",
      streamingProvider: streaming.provider as never,
      streamingProviderConfig: { apiKey: "stt-key" },
    });
    await vi.waitFor(() => expect(streaming.sttSession.connect).toHaveBeenCalledOnce());

    sendTalkTranscriptionRelayAudio({
      transcriptionSessionId: session.transcriptionSessionId,
      connId: "conn-1",
      audioBase64: Buffer.from([0xff, 0xff]).toString("base64"),
    });
    streaming.controller.onPartial?.("hello");
    streaming.controller.onTranscript?.("hello world");

    const partialPayload = findPayloadByType(events, "partial");
    expectRecordFields(partialPayload, "partial payload", {
      transcriptionSessionId: session.transcriptionSessionId,
      type: "partial",
      text: "hello",
    });
    const transcriptPayload = findPayloadByTypeAndText(events, "transcript", "hello world");
    expectRecordFields(transcriptPayload, "transcript payload", {
      transcriptionSessionId: session.transcriptionSessionId,
      type: "transcript",
      text: "hello world",
      final: true,
    });
    expect(streaming.sttSession.close).not.toHaveBeenCalled();

    stopTalkTranscriptionRelaySession({
      transcriptionSessionId: session.transcriptionSessionId,
      connId: "conn-1",
    });
    expect(streaming.sttSession.close).toHaveBeenCalledOnce();
  });

  it("buffers browser audio and finalizes through media-understanding transcription", async () => {
    const events: BroadcastEvent[] = [];
    const context = createContext(events);

    const session = createTalkTranscriptionRelaySession({
      context,
      connId: "conn-1",
      transcriptionMode: "buffered",
      provider: "openai-codex",
      model: "gpt-5.5",
    });
    await Promise.resolve();

    expectRecordFields(session, "session", {
      provider: "openai-codex",
      mode: "transcription",
      transport: "gateway-relay",
    });
    expectRecordFields(session.audio, "session audio", {
      inputEncoding: "g711_ulaw",
      inputSampleRateHz: 8000,
    });

    sendTalkTranscriptionRelayAudio({
      transcriptionSessionId: session.transcriptionSessionId,
      connId: "conn-1",
      audioBase64: Buffer.from([0xff, 0xff, 0xff, 0xff]).toString("base64"),
    });
    stopTalkTranscriptionRelaySession({
      transcriptionSessionId: session.transcriptionSessionId,
      connId: "conn-1",
    });

    await vi.waitFor(() => expect(mocks.transcribeAudioBuffer).toHaveBeenCalledOnce());
    const transcribeCalls = mocks.transcribeAudioBuffer.mock.calls as unknown as Array<
      [Record<string, unknown>]
    >;
    const transcribeParams = transcribeCalls[0]?.[0];
    expectRecordFields(transcribeParams, "transcribe params", {
      mime: "audio/wav",
      cfg: {
        tools: {
          media: {
            audio: {
              enabled: true,
              models: [{ provider: "openai-codex", model: "gpt-5.5" }],
            },
          },
        },
      },
      activeModel: { provider: "openai-codex", model: "gpt-5.5" },
      fileName: "input.wav",
    });
    expect(transcribeParams?.filePath).toBeUndefined();
    expect(transcribeParams?.buffer).toBeInstanceOf(Buffer);
    const wavAudio = transcribeParams?.buffer as Buffer;
    expect(wavAudio.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wavAudio.subarray(8, 12).toString("ascii")).toBe("WAVE");

    const readyPayload = findPayloadByType(events, "ready");
    expect(events.find((event) => event.payload === readyPayload)?.connIds).toEqual(["conn-1"]);
    expectRecordFields(readyPayload, "ready payload", {
      transcriptionSessionId: session.transcriptionSessionId,
      type: "ready",
    });
    expectTalkEventFields(readyPayload, {
      sessionId: session.transcriptionSessionId,
      type: "session.ready",
      mode: "transcription",
      transport: "gateway-relay",
      brain: "none",
      provider: "openai-codex",
    });

    const speechStartPayload = findPayloadByType(events, "speechStart");
    expectRecordFields(speechStartPayload, "speechStart payload", {
      transcriptionSessionId: session.transcriptionSessionId,
      type: "speechStart",
    });
    expectTalkEventFields(speechStartPayload, { type: "turn.started", turnId: "turn-1" });

    const audioPayload = findPayloadByType(events, "inputAudio");
    expectRecordFields(audioPayload, "input audio payload", {
      transcriptionSessionId: session.transcriptionSessionId,
      type: "inputAudio",
      byteLength: 4,
    });
    expectTalkEventFields(audioPayload, { type: "input.audio.delta" });

    const committedPayload = findPayloadByTalkEventType(events, "input.audio.committed");
    expectRecordFields(committedPayload, "committed payload", {
      transcriptionSessionId: session.transcriptionSessionId,
    });

    await vi.waitFor(() => {
      expect(
        events.some((event) => {
          const payload = event.payload;
          return (
            isRecord(payload) && payload.type === "transcript" && payload.text === "hello world"
          );
        }),
      ).toBe(true);
    });
    const transcriptPayload = findPayloadByTypeAndText(events, "transcript", "hello world");
    expectRecordFields(transcriptPayload, "transcript payload", {
      transcriptionSessionId: session.transcriptionSessionId,
      type: "transcript",
      text: "hello world",
      final: true,
    });
    expectTalkEventFields(transcriptPayload, {
      type: "transcript.done",
      turnId: "turn-1",
      final: true,
      payload: { text: "hello world", provider: "openai-codex", model: "gpt-5.5" },
    });

    const closePayload = findPayloadByType(events, "close");
    expectRecordFields(closePayload, "close payload", {
      transcriptionSessionId: session.transcriptionSessionId,
      type: "close",
      reason: "completed",
    });
    expectTalkEventFields(closePayload, {
      type: "session.closed",
      final: true,
    });
  });

  it("uses the configured buffered transcription provider for model-only requests", async () => {
    const events: BroadcastEvent[] = [];
    const context = createContext(events, {
      tools: {
        media: {
          audio: {
            enabled: true,
            models: [{ provider: "openai-codex", model: "gpt-4o-transcribe" }],
          },
        },
      },
    });

    const session = createTalkTranscriptionRelaySession({
      context,
      connId: "conn-1",
      transcriptionMode: "buffered",
      model: "gpt-5.5",
    });
    await Promise.resolve();

    sendTalkTranscriptionRelayAudio({
      transcriptionSessionId: session.transcriptionSessionId,
      connId: "conn-1",
      audioBase64: Buffer.from([0xff, 0xff, 0xff, 0xff]).toString("base64"),
    });
    stopTalkTranscriptionRelaySession({
      transcriptionSessionId: session.transcriptionSessionId,
      connId: "conn-1",
    });

    await vi.waitFor(() => expect(mocks.transcribeAudioBuffer).toHaveBeenCalledOnce());
    const transcribeCalls = mocks.transcribeAudioBuffer.mock.calls as unknown as Array<
      [Record<string, unknown>]
    >;
    expectRecordFields(transcribeCalls[0]?.[0], "transcribe params", {
      cfg: {
        tools: {
          media: {
            audio: {
              enabled: true,
              models: [{ provider: "openai-codex", model: "gpt-5.5" }],
            },
          },
        },
      },
      activeModel: { provider: "openai-codex", model: "gpt-5.5" },
    });
  });

  it("reports media-understanding transcription failures as Talk errors", async () => {
    mocks.transcribeAudioBuffer.mockRejectedValueOnce(new Error("codex voice unavailable"));
    const events: BroadcastEvent[] = [];
    const context = createContext(events);

    const session = createTalkTranscriptionRelaySession({
      context,
      connId: "conn-1",
      transcriptionMode: "buffered",
      provider: "openai-codex",
    });
    await Promise.resolve();
    sendTalkTranscriptionRelayAudio({
      transcriptionSessionId: session.transcriptionSessionId,
      connId: "conn-1",
      audioBase64: Buffer.from([0xff, 0xff]).toString("base64"),
    });
    stopTalkTranscriptionRelaySession({
      transcriptionSessionId: session.transcriptionSessionId,
      connId: "conn-1",
    });

    await vi.waitFor(() => {
      expect(findPayloadByType(events, "error").message).toBe("codex voice unavailable");
    });
    const closePayload = findPayloadByType(events, "close");
    expectRecordFields(closePayload, "close payload", {
      transcriptionSessionId: session.transcriptionSessionId,
      type: "close",
      reason: "error",
    });
  });

  it("rejects explicit transcription provider fallback results", async () => {
    mocks.transcribeAudioBuffer.mockResolvedValueOnce({
      text: "hello world",
      provider: "other-provider",
      model: "gpt-4o-transcribe",
    });
    const events: BroadcastEvent[] = [];
    const context = createContext(events);

    const session = createTalkTranscriptionRelaySession({
      context,
      connId: "conn-1",
      transcriptionMode: "buffered",
      provider: "openai-codex",
      model: "gpt-5.5",
    });
    await Promise.resolve();
    sendTalkTranscriptionRelayAudio({
      transcriptionSessionId: session.transcriptionSessionId,
      connId: "conn-1",
      audioBase64: Buffer.from([0xff, 0xff]).toString("base64"),
    });
    stopTalkTranscriptionRelaySession({
      transcriptionSessionId: session.transcriptionSessionId,
      connId: "conn-1",
    });

    await vi.waitFor(() => {
      expect(findPayloadByType(events, "error").message).toBe(
        'Requested transcription provider "openai-codex" but media-understanding used "other-provider"',
      );
    });
  });

  it("rejects missing provider metadata when a transcription provider was requested", async () => {
    mocks.transcribeAudioBuffer.mockResolvedValueOnce({
      text: "hello world",
      provider: undefined as never,
      model: "gpt-5.5",
    });
    const events: BroadcastEvent[] = [];
    const context = createContext(events);

    const session = createTalkTranscriptionRelaySession({
      context,
      connId: "conn-1",
      transcriptionMode: "buffered",
      provider: "openai-codex",
    });
    await Promise.resolve();
    sendTalkTranscriptionRelayAudio({
      transcriptionSessionId: session.transcriptionSessionId,
      connId: "conn-1",
      audioBase64: Buffer.from([0xff, 0xff]).toString("base64"),
    });
    stopTalkTranscriptionRelaySession({
      transcriptionSessionId: session.transcriptionSessionId,
      connId: "conn-1",
    });

    await vi.waitFor(() => {
      expect(findPayloadByType(events, "error").message).toBe(
        'Requested transcription provider "openai-codex" but media-understanding used "unknown"',
      );
    });
  });

  it("does not close another connection's transcription session on connId mismatch", async () => {
    const events: BroadcastEvent[] = [];
    const context = createContext(events);

    const session = createTalkTranscriptionRelaySession({
      context,
      connId: "conn-1",
      transcriptionMode: "buffered",
      provider: "openai-codex",
    });
    await Promise.resolve();

    // Cross-connId access surfaces the same "not found" error as a missing
    // session id so an unauthorized connId cannot probe for valid session ids.
    expect(() =>
      sendTalkTranscriptionRelayAudio({
        transcriptionSessionId: session.transcriptionSessionId,
        connId: "conn-2",
        audioBase64: Buffer.from([0xff]).toString("base64"),
      }),
    ).toThrow("transcription session not found");
    expect(events.some((event) => isRecord(event.payload) && event.payload.type === "close")).toBe(
      false,
    );

    sendTalkTranscriptionRelayAudio({
      transcriptionSessionId: session.transcriptionSessionId,
      connId: "conn-1",
      audioBase64: Buffer.from([0xff, 0xff]).toString("base64"),
    });
    stopTalkTranscriptionRelaySession({
      transcriptionSessionId: session.transcriptionSessionId,
      connId: "conn-1",
    });
    await vi.waitFor(() => expect(mocks.transcribeAudioBuffer).toHaveBeenCalledOnce());
  });

  it("closes idle transcription sessions without fabricating an audio turn", async () => {
    const events: BroadcastEvent[] = [];
    const context = createContext(events);

    const session = createTalkTranscriptionRelaySession({
      context,
      connId: "conn-1",
      transcriptionMode: "buffered",
      provider: "openai-codex",
    });
    await Promise.resolve();

    stopTalkTranscriptionRelaySession({
      transcriptionSessionId: session.transcriptionSessionId,
      connId: "conn-1",
    });

    expect(mocks.transcribeAudioBuffer).not.toHaveBeenCalled();
    expect(
      events.some((event) => isRecord(event.payload) && event.payload.type === "speechStart"),
    ).toBe(false);
    expect(
      events.some((event) => {
        const payload = event.payload;
        return (
          isRecord(payload) &&
          isRecord(payload.talkEvent) &&
          payload.talkEvent.type === "input.audio.committed"
        );
      }),
    ).toBe(false);
    const closePayload = findPayloadByType(events, "close");
    expectRecordFields(closePayload, "close payload", {
      transcriptionSessionId: session.transcriptionSessionId,
      type: "close",
      reason: "completed",
    });
  });

  it("cancels an active transcription turn without invoking transcription", async () => {
    const events: BroadcastEvent[] = [];
    const context = createContext(events);

    const session = createTalkTranscriptionRelaySession({
      context,
      connId: "conn-1",
      transcriptionMode: "buffered",
      provider: "openai-codex",
    });
    await Promise.resolve();

    cancelTalkTranscriptionRelayTurn({
      transcriptionSessionId: session.transcriptionSessionId,
      connId: "conn-1",
      reason: "barge-in",
    });

    expect(mocks.transcribeAudioBuffer).not.toHaveBeenCalled();
    const cancelledPayload = findPayloadByTalkEventType(events, "turn.cancelled");
    expectRecordFields(cancelledPayload, "cancelled payload", {
      transcriptionSessionId: session.transcriptionSessionId,
    });
    expectTalkEventFields(cancelledPayload, {
      type: "turn.cancelled",
      turnId: "turn-1",
      payload: { reason: "barge-in" },
      final: true,
    });

    const closePayload = findPayloadByType(events, "close");
    expectRecordFields(closePayload, "close payload", {
      transcriptionSessionId: session.transcriptionSessionId,
      type: "close",
      reason: "completed",
    });

    expect(() =>
      sendTalkTranscriptionRelayAudio({
        transcriptionSessionId: session.transcriptionSessionId,
        connId: "conn-1",
        audioBase64: Buffer.from([0xff]).toString("base64"),
      }),
    ).toThrow("transcription session not found");
  });

  it("rejects explicit transcription model fallback results", async () => {
    mocks.transcribeAudioBuffer.mockResolvedValueOnce({
      text: "hello world",
      provider: "openai-codex",
      model: "other-model",
    });
    const events: BroadcastEvent[] = [];
    const context = createContext(events);

    const session = createTalkTranscriptionRelaySession({
      context,
      connId: "conn-1",
      transcriptionMode: "buffered",
      provider: "openai-codex",
      model: "gpt-5.5",
    });
    await Promise.resolve();
    sendTalkTranscriptionRelayAudio({
      transcriptionSessionId: session.transcriptionSessionId,
      connId: "conn-1",
      audioBase64: Buffer.from([0xff, 0xff]).toString("base64"),
    });
    stopTalkTranscriptionRelaySession({
      transcriptionSessionId: session.transcriptionSessionId,
      connId: "conn-1",
    });

    await vi.waitFor(() => {
      expect(findPayloadByType(events, "error").message).toBe(
        'Requested transcription model "gpt-5.5" but media-understanding used "other-model"',
      );
    });
  });

  it("rejects audio frames and sessions over relay size limits", async () => {
    const events: BroadcastEvent[] = [];
    const context = createContext(events);
    const session = createTalkTranscriptionRelaySession({
      context,
      connId: "conn-1",
      transcriptionMode: "buffered",
      provider: "openai-codex",
    });
    await Promise.resolve();

    expect(() =>
      sendTalkTranscriptionRelayAudio({
        transcriptionSessionId: session.transcriptionSessionId,
        connId: "conn-1",
        audioBase64: "a".repeat(512 * 1024 + 1),
      }),
    ).toThrow("Transcription Talk audio frame is too large");

    const chunk = Buffer.alloc(300 * 1024).toString("base64");
    for (let index = 0; index < 13; index += 1) {
      sendTalkTranscriptionRelayAudio({
        transcriptionSessionId: session.transcriptionSessionId,
        connId: "conn-1",
        audioBase64: chunk,
      });
    }
    expect(() =>
      sendTalkTranscriptionRelayAudio({
        transcriptionSessionId: session.transcriptionSessionId,
        connId: "conn-1",
        audioBase64: chunk,
      }),
    ).toThrow("Transcription Talk audio exceeds session limit");
  });

  it("surfaces a typed error when audio understanding is disabled by gateway config", async () => {
    mocks.transcribeAudioBuffer.mockResolvedValueOnce({
      text: undefined,
      provider: undefined,
      model: undefined,
      output: undefined,
      decision: { capability: "audio", outcome: "disabled", attachments: [] },
    } as never);
    const events: BroadcastEvent[] = [];
    const context = createContext(events);

    const session = createTalkTranscriptionRelaySession({
      context,
      connId: "conn-1",
      transcriptionMode: "buffered",
      provider: "openai-codex",
    });
    await Promise.resolve();
    sendTalkTranscriptionRelayAudio({
      transcriptionSessionId: session.transcriptionSessionId,
      connId: "conn-1",
      audioBase64: Buffer.from([0xff, 0xff]).toString("base64"),
    });
    stopTalkTranscriptionRelaySession({
      transcriptionSessionId: session.transcriptionSessionId,
      connId: "conn-1",
    });

    await vi.waitFor(() => {
      expect(findPayloadByType(events, "error").message).toBe(
        "Audio transcription is disabled by gateway config (tools.media.audio.enabled = false)",
      );
    });
  });

  it("cancel during finalize stops the session without emitting transcript or error", async () => {
    let resolveTranscribe: (value: unknown) => void = () => {};
    mocks.transcribeAudioBuffer.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveTranscribe = resolve;
      }) as never,
    );
    const events: BroadcastEvent[] = [];
    const context = createContext(events);

    const session = createTalkTranscriptionRelaySession({
      context,
      connId: "conn-1",
      transcriptionMode: "buffered",
      provider: "openai-codex",
    });
    await Promise.resolve();
    sendTalkTranscriptionRelayAudio({
      transcriptionSessionId: session.transcriptionSessionId,
      connId: "conn-1",
      audioBase64: Buffer.from([0xff, 0xff]).toString("base64"),
    });
    stopTalkTranscriptionRelaySession({
      transcriptionSessionId: session.transcriptionSessionId,
      connId: "conn-1",
    });

    cancelTalkTranscriptionRelayTurn({
      transcriptionSessionId: session.transcriptionSessionId,
      connId: "conn-1",
      reason: "user-cancelled",
    });

    // Now resolve the in-flight transcribe to ensure the cancel-aware finalize
    // path does not emit a duplicate transcript or error event.
    resolveTranscribe({
      text: "hello world",
      provider: "openai-codex",
      model: undefined,
      output: undefined,
      decision: { capability: "audio", outcome: "succeeded", attachments: [] },
    });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    const closePayload = findPayloadByType(events, "close");
    expect(closePayload.reason).toBe("completed");
    expect(events.some((event) => isRecord(event.payload) && event.payload.type === "error")).toBe(
      false,
    );
    const transcriptFinals = events.filter(
      (event) =>
        isRecord(event.payload) &&
        event.payload.type === "transcript" &&
        event.payload.text === "hello world",
    );
    expect(transcriptFinals).toHaveLength(0);
  });

  it("rejects audio appended while transcription finalization is running", async () => {
    mocks.transcribeAudioBuffer.mockReturnValueOnce(new Promise(() => {}) as never);
    const events: BroadcastEvent[] = [];
    const context = createContext(events);
    const session = createTalkTranscriptionRelaySession({
      context,
      connId: "conn-1",
      transcriptionMode: "buffered",
      provider: "openai-codex",
    });
    await Promise.resolve();

    sendTalkTranscriptionRelayAudio({
      transcriptionSessionId: session.transcriptionSessionId,
      connId: "conn-1",
      audioBase64: Buffer.from([0xff, 0xff]).toString("base64"),
    });
    stopTalkTranscriptionRelaySession({
      transcriptionSessionId: session.transcriptionSessionId,
      connId: "conn-1",
    });

    expect(() =>
      sendTalkTranscriptionRelayAudio({
        transcriptionSessionId: session.transcriptionSessionId,
        connId: "conn-1",
        audioBase64: Buffer.from([0xff]).toString("base64"),
      }),
    ).toThrow("Transcription Talk session is finalizing");
  });
});
