import { afterEach, describe, expect, it, vi } from "vitest";
import type { RealtimeVoiceProviderPlugin } from "../plugins/types.js";
import type {
  RealtimeVoiceBridge,
  RealtimeVoiceBridgeCreateRequest,
} from "../realtime-voice/provider-types.js";
import { GATEWAY_EVENTS } from "./server-methods-list.js";
import {
  acknowledgeTalkRealtimeRelayMark,
  closeTalkRealtimeRelaySessionsForConn,
  clearTalkRealtimeRelaySessionsForTest,
  createTalkRealtimeRelaySession,
  sendTalkRealtimeRelayAudio,
  sendTalkRealtimeRelayUserMessage,
  stopTalkRealtimeRelaySession,
  submitTalkRealtimeRelayToolResult,
} from "./talk-realtime-relay.js";

function createRelayTestBridge(overrides: Partial<RealtimeVoiceBridge> = {}): RealtimeVoiceBridge {
  return {
    connect: vi.fn(async () => undefined),
    sendAudio: vi.fn(),
    setMediaTimestamp: vi.fn(),
    submitToolResult: vi.fn(),
    acknowledgeMark: vi.fn(),
    close: vi.fn(),
    isConnected: vi.fn(() => true),
    ...overrides,
  };
}

function createRelayTestProvider(
  createBridge: RealtimeVoiceProviderPlugin["createBridge"],
): RealtimeVoiceProviderPlugin {
  return {
    id: "relay-test",
    label: "Relay Test",
    isConfigured: () => true,
    createBridge,
  };
}

describe("talk realtime gateway relay", () => {
  afterEach(() => {
    clearTalkRealtimeRelaySessionsForTest();
  });

  it("bridges browser audio, transcripts, marks, and tool results through a backend provider", async () => {
    let bridgeRequest: RealtimeVoiceBridgeCreateRequest | undefined;
    const bridge = createRelayTestBridge({
      supportsToolResultContinuation: true,
      connect: vi.fn(async () => {
        bridgeRequest?.onReady?.();
        bridgeRequest?.onAudio(Buffer.from("audio-out"));
        bridgeRequest?.onMark?.("mark-1");
        bridgeRequest?.onTranscript?.("user", "hello", true);
        bridgeRequest?.onToolCall?.({
          itemId: "item-1",
          callId: "call-1",
          name: "openclaw_agent_consult",
          args: { question: "what now" },
        });
      }),
      sendUserMessage: vi.fn(),
      triggerGreeting: vi.fn(),
    });
    const provider = createRelayTestProvider((req) => {
      bridgeRequest = req;
      return bridge;
    });
    const events: Array<{ event: string; payload: unknown; connIds: string[] }> = [];
    const context = {
      broadcastToConnIds: (event: string, payload: unknown, connIds: ReadonlySet<string>) => {
        events.push({ event, payload, connIds: [...connIds] });
      },
    } as never;

    const session = createTalkRealtimeRelaySession({
      context,
      connId: "conn-1",
      provider,
      providerConfig: { model: "provider-model" },
      instructions: "be brief",
      tools: [],
      model: "browser-model",
      voice: "voice-a",
    });
    await Promise.resolve();

    expect(session).toMatchObject({
      provider: "relay-test",
      transport: "gateway-relay",
      model: "browser-model",
      voice: "voice-a",
      audio: {
        inputEncoding: "pcm16",
        inputSampleRateHz: 24000,
        outputEncoding: "pcm16",
        outputSampleRateHz: 24000,
      },
    });
    expect(bridgeRequest).toMatchObject({
      providerConfig: { model: "provider-model" },
      audioFormat: { encoding: "pcm16", sampleRateHz: 24000, channels: 1 },
      instructions: "be brief",
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "talk.realtime.relay",
          connIds: ["conn-1"],
          payload: { relaySessionId: session.relaySessionId, type: "ready" },
        }),
        expect.objectContaining({
          payload: {
            relaySessionId: session.relaySessionId,
            type: "audio",
            audioBase64: Buffer.from("audio-out").toString("base64"),
          },
        }),
        expect.objectContaining({
          payload: { relaySessionId: session.relaySessionId, type: "mark", markName: "mark-1" },
        }),
        expect.objectContaining({
          payload: {
            relaySessionId: session.relaySessionId,
            type: "transcript",
            role: "user",
            text: "hello",
            final: true,
          },
        }),
        expect.objectContaining({
          payload: {
            relaySessionId: session.relaySessionId,
            type: "toolCall",
            itemId: "item-1",
            callId: "call-1",
            name: "openclaw_agent_consult",
            args: { question: "what now" },
          },
        }),
      ]),
    );

    sendTalkRealtimeRelayAudio({
      relaySessionId: session.relaySessionId,
      connId: "conn-1",
      audioBase64: Buffer.from("audio-in").toString("base64"),
      timestamp: 123,
    });
    sendTalkRealtimeRelayUserMessage({
      relaySessionId: session.relaySessionId,
      connId: "conn-1",
      text: " Send a short reply. ",
    });
    acknowledgeTalkRealtimeRelayMark({ relaySessionId: session.relaySessionId, connId: "conn-1" });
    submitTalkRealtimeRelayToolResult({
      relaySessionId: session.relaySessionId,
      connId: "conn-1",
      callId: "call-1",
      result: { ok: true },
    });
    stopTalkRealtimeRelaySession({ relaySessionId: session.relaySessionId, connId: "conn-1" });

    expect(bridge.sendAudio).toHaveBeenCalledWith(Buffer.from("audio-in"));
    expect(bridge.setMediaTimestamp).toHaveBeenCalledWith(123);
    expect(bridge.sendUserMessage).toHaveBeenCalledWith("Send a short reply.");
    expect(bridge.acknowledgeMark).toHaveBeenCalled();
    expect(bridge.submitToolResult).toHaveBeenCalledWith("call-1", { ok: true }, undefined);
    expect(bridge.close).toHaveBeenCalled();
  });

  it("broadcasts relay audio without lossy slow-consumer dropping", async () => {
    let bridgeRequest: RealtimeVoiceBridgeCreateRequest | undefined;
    const provider = createRelayTestProvider((req) => {
      bridgeRequest = req;
      return createRelayTestBridge();
    });
    const broadcasts: Array<{
      payload: unknown;
      opts?: { dropIfSlow?: boolean };
    }> = [];
    const context = {
      broadcastToConnIds: (
        _event: string,
        payload: unknown,
        _connIds: ReadonlySet<string>,
        opts?: { dropIfSlow?: boolean },
      ) => {
        broadcasts.push({ payload, opts });
      },
    } as never;

    const session = createTalkRealtimeRelaySession({
      context,
      connId: "conn-1",
      provider,
      providerConfig: {},
      instructions: "brief",
      tools: [],
    });

    bridgeRequest?.onAudio(Buffer.from("audio-out"));

    expect(broadcasts).toContainEqual({
      payload: {
        relaySessionId: session.relaySessionId,
        type: "audio",
        audioBase64: Buffer.from("audio-out").toString("base64"),
      },
      opts: undefined,
    });
  });

  it("rejects relay control from a different connection without closing the owner session", () => {
    const bridge = createRelayTestBridge();
    const provider = createRelayTestProvider(() => bridge);
    const session = createTalkRealtimeRelaySession({
      context: { broadcastToConnIds: vi.fn() } as never,
      connId: "conn-1",
      provider,
      providerConfig: {},
      instructions: "brief",
      tools: [],
    });

    expect(() =>
      sendTalkRealtimeRelayAudio({
        relaySessionId: session.relaySessionId,
        connId: "conn-2",
        audioBase64: Buffer.from("audio").toString("base64"),
      }),
    ).toThrow("Unknown realtime relay session");
    expect(bridge.close).not.toHaveBeenCalled();

    expect(() =>
      sendTalkRealtimeRelayAudio({
        relaySessionId: session.relaySessionId,
        connId: "conn-1",
        audioBase64: Buffer.from("owner-audio").toString("base64"),
      }),
    ).not.toThrow();
    expect(bridge.sendAudio).toHaveBeenCalledWith(Buffer.from("owner-audio"));
  });

  it("rejects relay audio frames that decode to empty audio", () => {
    const bridge = createRelayTestBridge();
    const provider = createRelayTestProvider(() => bridge);
    const session = createTalkRealtimeRelaySession({
      context: { broadcastToConnIds: vi.fn() } as never,
      connId: "conn-1",
      provider,
      providerConfig: {},
      instructions: "brief",
      tools: [],
    });

    expect(() =>
      sendTalkRealtimeRelayAudio({
        relaySessionId: session.relaySessionId,
        connId: "conn-1",
        audioBase64: "!!!!",
      }),
    ).toThrow("Realtime relay audio frame is empty");
    expect(bridge.sendAudio).not.toHaveBeenCalled();
  });

  it("rejects empty text relay turns", () => {
    const bridge = createRelayTestBridge({ sendUserMessage: vi.fn() });
    const provider = createRelayTestProvider(() => bridge);
    const session = createTalkRealtimeRelaySession({
      context: { broadcastToConnIds: vi.fn() } as never,
      connId: "conn-1",
      provider,
      providerConfig: {},
      instructions: "brief",
      tools: [],
    });

    expect(() =>
      sendTalkRealtimeRelayUserMessage({
        relaySessionId: session.relaySessionId,
        connId: "conn-1",
        text: "   ",
      }),
    ).toThrow("Realtime relay user message is empty");
    expect(bridge.sendUserMessage).not.toHaveBeenCalled();
  });

  it("caps active relay sessions per browser connection", () => {
    const provider = createRelayTestProvider(() => createRelayTestBridge());
    const createSession = (connId: string) =>
      createTalkRealtimeRelaySession({
        context: { broadcastToConnIds: vi.fn() } as never,
        connId,
        provider,
        providerConfig: {},
        instructions: "brief",
        tools: [],
      });

    createSession("conn-1");
    createSession("conn-1");

    expect(() => createSession("conn-1")).toThrow(
      "Too many active realtime relay sessions for this connection",
    );
    expect(() => createSession("conn-2")).not.toThrow();
  });

  it("closes relay sessions when their browser connection disconnects", () => {
    const closeForConn1 = vi.fn();
    const closeForConn2 = vi.fn();
    let created = 0;
    const provider = createRelayTestProvider(() => {
      created += 1;
      return createRelayTestBridge({
        close: created <= 2 ? closeForConn1 : closeForConn2,
      });
    });
    const createSession = (connId: string) =>
      createTalkRealtimeRelaySession({
        context: { broadcastToConnIds: vi.fn() } as never,
        connId,
        provider,
        providerConfig: {},
        instructions: "brief",
        tools: [],
      });

    createSession("conn-1");
    createSession("conn-1");
    const otherConn = createSession("conn-2");

    closeTalkRealtimeRelaySessionsForConn("conn-1");

    expect(closeForConn1).toHaveBeenCalledTimes(2);
    expect(closeForConn2).not.toHaveBeenCalled();
    expect(() =>
      sendTalkRealtimeRelayAudio({
        relaySessionId: otherConn.relaySessionId,
        connId: "conn-2",
        audioBase64: Buffer.from("audio").toString("base64"),
      }),
    ).not.toThrow();
  });

  it("does not emit stale provider events after a relay session closes", () => {
    let bridgeRequest: RealtimeVoiceBridgeCreateRequest | undefined;
    const provider = createRelayTestProvider((req) => {
      bridgeRequest = req;
      return createRelayTestBridge({
        connect: vi.fn(() => new Promise<void>(() => {})),
      });
    });
    const events: Array<{ event: string; payload: unknown; connIds: string[] }> = [];
    const context = {
      broadcastToConnIds: (event: string, payload: unknown, connIds: ReadonlySet<string>) => {
        events.push({ event, payload, connIds: [...connIds] });
      },
    } as never;

    const session = createTalkRealtimeRelaySession({
      context,
      connId: "conn-1",
      provider,
      providerConfig: {},
      instructions: "brief",
      tools: [],
    });

    closeTalkRealtimeRelaySessionsForConn("conn-1");
    bridgeRequest?.onReady?.();
    bridgeRequest?.onAudio(Buffer.from("late-audio"));
    bridgeRequest?.onTranscript?.("assistant", "late", true);
    bridgeRequest?.onToolCall?.({
      itemId: "late-item",
      callId: "late-call",
      name: "openclaw_agent_consult",
      args: { question: "late" },
    });

    expect(events).toEqual([
      {
        event: "talk.realtime.relay",
        connIds: ["conn-1"],
        payload: { relaySessionId: session.relaySessionId, type: "close", reason: "completed" },
      },
    ]);
  });

  it("does not let provider close failures break relay cleanup", () => {
    const provider = createRelayTestProvider(() =>
      createRelayTestBridge({
        close: vi.fn(() => {
          throw new Error("close failed");
        }),
      }),
    );
    const events: Array<{ event: string; payload: unknown; connIds: string[] }> = [];
    const context = {
      broadcastToConnIds: (event: string, payload: unknown, connIds: ReadonlySet<string>) => {
        events.push({ event, payload, connIds: [...connIds] });
      },
    } as never;

    const session = createTalkRealtimeRelaySession({
      context,
      connId: "conn-1",
      provider,
      providerConfig: {},
      instructions: "brief",
      tools: [],
    });

    expect(() =>
      stopTalkRealtimeRelaySession({ relaySessionId: session.relaySessionId, connId: "conn-1" }),
    ).not.toThrow();
    expect(events).toContainEqual({
      event: "talk.realtime.relay",
      connIds: ["conn-1"],
      payload: { relaySessionId: session.relaySessionId, type: "close", reason: "completed" },
    });
    expect(() =>
      sendTalkRealtimeRelayAudio({
        relaySessionId: session.relaySessionId,
        connId: "conn-1",
        audioBase64: Buffer.from("audio").toString("base64"),
      }),
    ).toThrow("Unknown realtime relay session");
  });

  it("advertises the relay event in gateway feature discovery", () => {
    expect(GATEWAY_EVENTS).toContain("talk.realtime.relay");
  });
});
