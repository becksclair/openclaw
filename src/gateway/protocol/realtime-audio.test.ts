import { describe, expect, it } from "vitest";
import {
  validateRealtimeSessionCloseParams,
  validateRealtimeSessionCreateParams,
  validateRealtimeSessionCreateResult,
  validateRealtimeSessionEvent,
  validateRealtimeSessionInputAudioParams,
  validateRealtimeSessionInputTextParams,
  validateRealtimeSessionInterruptParams,
  validateRealtimeSessionToolCallParams,
  validateRealtimeSessionToolResultParams,
  validateRealtimeSessionTransportSignalParams,
} from "./index.js";

describe("realtime audio protocol validators", () => {
  it("accepts minimal session create params", () => {
    expect(
      validateRealtimeSessionCreateParams({
        transport: "desktop",
      }),
    ).toBe(true);
    expect(
      validateRealtimeSessionCreateParams({
        transport: "desktop",
        capabilities: ["textInput", "audioInput"],
      }),
    ).toBe(true);
  });

  it("rejects unknown transports and capability names", () => {
    expect(
      validateRealtimeSessionCreateParams({
        transport: "telepathy",
      }),
    ).toBe(false);
    expect(
      validateRealtimeSessionCreateParams({
        transport: "desktop",
        capabilities: ["mind-meld"],
      }),
    ).toBe(false);
  });

  it("accepts create result payloads", () => {
    expect(
      validateRealtimeSessionCreateResult({
        sessionId: "session-1",
        mode: "realtime",
        state: "idle",
        capabilities: {
          textInput: true,
          audioInput: true,
          toolCalls: true,
          toolResultContinuation: true,
          transportSignal: false,
        },
      }),
    ).toBe(true);
  });

  it("accepts normalized realtime session events", () => {
    expect(
      validateRealtimeSessionEvent({
        type: "transcript.updated",
        sessionId: "session-1",
        item: {
          itemId: "item-1",
          role: "user",
          status: "partial",
          text: "hello",
          revision: 0,
        },
      }),
    ).toBe(true);
    expect(
      validateRealtimeSessionEvent({
        type: "fallback.changed",
        sessionId: "session-1",
        mode: "fallback",
        reason: "provider_unavailable",
      }),
    ).toBe(true);
    expect(
      validateRealtimeSessionEvent({
        type: "tool.updated",
        sessionId: "session-1",
        update: {
          toolCallId: "tool-1",
          toolName: "exec",
          status: "approval",
          approval: {
            approvalId: "approval-1",
          },
        },
      }),
    ).toBe(true);
    expect(
      validateRealtimeSessionEvent({
        type: "audio.output",
        sessionId: "session-1",
        audio: {
          itemId: "assistant-1",
          pcm16Base64: Buffer.from("pcm").toString("base64"),
          sampleRate: 24000,
          mimeType: "audio/pcm;rate=24000",
        },
      }),
    ).toBe(true);
    expect(
      validateRealtimeSessionEvent({
        type: "transport.signal",
        sessionId: "session-1",
        signal: {
          kind: "offer",
          sdp: "v=0",
        },
      }),
    ).toBe(true);
  });

  it("accepts interrupt close input and tool continuation params", () => {
    expect(
      validateRealtimeSessionInterruptParams({
        sessionId: "session-1",
        target: "assistant",
      }),
    ).toBe(true);
    expect(
      validateRealtimeSessionCloseParams({
        sessionId: "session-1",
        reason: "done",
      }),
    ).toBe(true);
    expect(
      validateRealtimeSessionToolCallParams({
        sessionId: "session-1",
        toolCallId: "tool-1",
        toolName: "read",
        args: { path: "package.json" },
      }),
    ).toBe(true);
    expect(
      validateRealtimeSessionToolResultParams({
        sessionId: "session-1",
        toolCallId: "tool-1",
        output: "done",
      }),
    ).toBe(true);
    expect(
      validateRealtimeSessionInputTextParams({
        sessionId: "session-1",
        text: "hello",
      }),
    ).toBe(true);
    expect(
      validateRealtimeSessionInputAudioParams({
        sessionId: "session-1",
        audioBase64: Buffer.from([0, 1, 2, 3]).toString("base64"),
        sampleRate: 48000,
        channels: 2,
      }),
    ).toBe(true);
    expect(
      validateRealtimeSessionTransportSignalParams({
        sessionId: "session-1",
        signal: {
          kind: "ice-candidate",
          candidate: "candidate:1 1 UDP 1 127.0.0.1 9999 typ host",
          sdpMid: "0",
          sdpMLineIndex: 0,
        },
      }),
    ).toBe(true);
  });
});
