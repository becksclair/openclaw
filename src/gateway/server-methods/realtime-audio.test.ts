import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { realtimeConversationSessions } from "../realtime-audio/registry.js";
import type { RealtimeProviderEvent, RealtimeToolCallUpdate } from "../realtime-audio/types.js";
import { realtimeAudioHandlers } from "./realtime-audio.js";

const { createRealtimeProviderAdapterMock, getLastProviderAdapter, FakeRealtimeToolRuntime } =
  vi.hoisted(() => {
    class FakeProviderAdapter {
      start = vi.fn(async () => undefined);
      close = vi.fn(async () => undefined);
      interrupt = vi.fn(async () => undefined);
      sendText = vi.fn(async () => undefined);
      sendAudio = vi.fn(async () => undefined);
      submitToolResult = vi.fn(async () => undefined);
      configureTools = vi.fn();
      private listener?: (event: RealtimeProviderEvent) => void;

      subscribe = vi.fn((listener: (event: RealtimeProviderEvent) => void) => {
        this.listener = listener;
        return () => {
          this.listener = undefined;
        };
      });

      emit(event: RealtimeProviderEvent) {
        this.listener?.(event);
      }
    }

    class FakeRealtimeToolRuntime {
      updates: RealtimeToolCallUpdate[] = [];
      invoked: Array<{ toolCallId: string; toolName: string; params: unknown }> = [];
      private listeners = new Set<(update: RealtimeToolCallUpdate) => void>();

      listTools() {
        return [
          {
            name: "exec",
            description: "Run a command",
            parameters: { type: "object", properties: { command: { type: "string" } } },
          },
          {
            name: "read",
            description: "Read a file",
            parameters: { type: "object", properties: { path: { type: "string" } } },
          },
        ];
      }

      async invoke(toolCallId: string, toolName: string, params: unknown) {
        this.invoked.push({ toolCallId, toolName, params });
        const update: RealtimeToolCallUpdate =
          toolName === "exec"
            ? {
                toolCallId,
                toolName,
                status: "approval",
                text: "Approval required",
                approval: { approvalId: "approval-1" },
              }
            : {
                toolCallId,
                toolName,
                status: "completed",
                text: "ok",
              };
        this.updates.push(update);
        for (const listener of this.listeners) {
          listener(update);
        }
        return toolName === "exec"
          ? {
              content: [{ type: "text", text: "Approval required" }],
              details: { status: "approval-pending", approvalId: "approval-1" },
            }
          : {
              content: [{ type: "text", text: "ok" }],
              details: { status: "completed" },
            };
      }

      subscribe(listener: (update: RealtimeToolCallUpdate) => void) {
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      }
    }

    let lastProviderAdapter: FakeProviderAdapter | undefined;
    const createRealtimeProviderAdapterMock = vi.fn(() => {
      lastProviderAdapter = new FakeProviderAdapter();
      return lastProviderAdapter;
    });

    return {
      createRealtimeProviderAdapterMock,
      getLastProviderAdapter: () => lastProviderAdapter,
      FakeRealtimeToolRuntime,
    };
  });

vi.mock("../realtime-audio/providers/index.js", () => ({
  createRealtimeProviderAdapter: createRealtimeProviderAdapterMock,
}));

vi.mock("../realtime-audio/tool-runtime.js", () => ({
  DefaultRealtimeToolRuntime: FakeRealtimeToolRuntime,
}));

afterEach(() => {
  realtimeConversationSessions.clear();
});

beforeEach(() => {
  createRealtimeProviderAdapterMock.mockClear();
});

describe("realtimeAudioHandlers", () => {
  it("creates sessions and targets normalized events back to the creator connection", async () => {
    const respond = vi.fn();
    const broadcasts: Array<{ event: string; payload: unknown; connIds?: string[] }> = [];

    await realtimeAudioHandlers["realtime.session.create"]({
      req: { id: "req-1", type: "req", method: "realtime.session.create" },
      params: { transport: "test" },
      respond,
      context: {
        broadcast: (event: string, payload: unknown) => {
          broadcasts.push({ event, payload });
        },
        broadcastToConnIds: (event: string, payload: unknown, connIds: ReadonlySet<string>) => {
          broadcasts.push({ event, payload, connIds: [...connIds] });
        },
      } as never,
      client: {
        connId: "conn-1",
        connect: { id: "c1", role: "operator", scopes: ["write"] },
      } as never,
      isWebchatConnect: () => false,
    });

    const payload = respond.mock.calls[0]?.[1] as {
      sessionId: string;
      mode: string;
      state: string;
      capabilities: Record<string, boolean>;
    };
    expect(payload.sessionId).toBeTruthy();
    expect(payload.mode).toBe("realtime");
    expect(payload.state).toBe("idle");
    expect(payload.capabilities).toEqual({
      textInput: false,
      audioInput: false,
      toolCalls: false,
      toolResultContinuation: false,
      transportSignal: false,
    });
    expect(broadcasts).toEqual([
      {
        event: "realtime.session",
        payload: {
          type: "session.created",
          sessionId: payload.sessionId,
          mode: "realtime",
          state: "idle",
        },
        connIds: ["conn-1"],
      },
    ]);

    realtimeConversationSessions.get(payload.sessionId)?.handleProviderEvent({
      type: "audio.output",
      itemId: "assistant-1",
      chunk: Buffer.from("pcm"),
      sampleRate: 24000,
      mimeType: "audio/pcm;rate=24000",
    });

    expect(broadcasts.at(-1)).toEqual({
      event: "realtime.session",
      payload: {
        type: "audio.output",
        sessionId: payload.sessionId,
        audio: {
          itemId: "assistant-1",
          pcm16Base64: Buffer.from("pcm").toString("base64"),
          sampleRate: 24000,
          mimeType: "audio/pcm;rate=24000",
        },
      },
      connIds: ["conn-1"],
    });
  });

  it("binds a real provider for non-test gateway sessions and reports honest capabilities", async () => {
    const respond = vi.fn();

    await realtimeAudioHandlers["realtime.session.create"]({
      req: { id: "req-1", type: "req", method: "realtime.session.create" },
      params: { transport: "desktop", provider: "openai" },
      respond,
      context: { broadcast: () => {}, broadcastToConnIds: () => {} } as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(createRealtimeProviderAdapterMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "openai" }),
    );
    expect(respond.mock.calls[0]?.[1]).toMatchObject({
      capabilities: {
        textInput: true,
        audioInput: true,
        toolCalls: false,
        toolResultContinuation: false,
        transportSignal: false,
      },
    });
  });

  it("rejects unsupported providers", async () => {
    const respond = vi.fn();

    await realtimeAudioHandlers["realtime.session.create"]({
      req: { id: "req-1", type: "req", method: "realtime.session.create" },
      params: { transport: "desktop", provider: "mystery-box" },
      respond,
      context: { broadcast: () => {}, broadcastToConnIds: () => {} } as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(respond.mock.calls[0]?.[2]).toMatchObject({
      code: "INVALID_REQUEST",
      message: "unsupported realtime provider: mystery-box",
    });
  });

  it("rejects access to owner-scoped sessions from foreign or anonymous connections", async () => {
    const createRespond = vi.fn();

    await realtimeAudioHandlers["realtime.session.create"]({
      req: { id: "req-1", type: "req", method: "realtime.session.create" },
      params: { transport: "test" },
      respond: createRespond,
      context: { broadcast: () => {}, broadcastToConnIds: () => {} } as never,
      client: {
        connId: "conn-owner",
        connect: { id: "c1", role: "operator", scopes: ["write"] },
      } as never,
      isWebchatConnect: () => false,
    });

    const sessionId = createRespond.mock.calls[0]?.[1]?.sessionId as string;
    const foreignRespond = vi.fn();
    await realtimeAudioHandlers["realtime.session.interrupt"]({
      req: { id: "req-2", type: "req", method: "realtime.session.interrupt" },
      params: { sessionId, target: "assistant" },
      respond: foreignRespond,
      context: { broadcast: () => {}, broadcastToConnIds: () => {} } as never,
      client: {
        connId: "conn-foreign",
        connect: { id: "c2", role: "operator", scopes: ["write"] },
      } as never,
      isWebchatConnect: () => false,
    });

    const anonymousRespond = vi.fn();
    await realtimeAudioHandlers["realtime.session.interrupt"]({
      req: { id: "req-3", type: "req", method: "realtime.session.interrupt" },
      params: { sessionId, target: "assistant" },
      respond: anonymousRespond,
      context: { broadcast: () => {}, broadcastToConnIds: () => {} } as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(foreignRespond.mock.calls[0]?.[0]).toBe(false);
    expect(foreignRespond.mock.calls[0]?.[2]).toMatchObject({
      code: "INVALID_REQUEST",
      message: "unknown realtime session",
    });
    expect(anonymousRespond.mock.calls[0]?.[0]).toBe(false);
    expect(anonymousRespond.mock.calls[0]?.[2]).toMatchObject({
      code: "INVALID_REQUEST",
      message: "unknown realtime session",
    });
  });

  it("interrupts and closes existing sessions", async () => {
    const createRespond = vi.fn();
    const broadcasts: Array<{ event: string; payload: unknown }> = [];

    await realtimeAudioHandlers["realtime.session.create"]({
      req: { id: "req-1", type: "req", method: "realtime.session.create" },
      params: { transport: "test" },
      respond: createRespond,
      context: {
        broadcast: (event: string, payload: unknown) => {
          broadcasts.push({ event, payload });
        },
        broadcastToConnIds: () => {},
      } as never,
      client: null,
      isWebchatConnect: () => false,
    });

    const sessionId = createRespond.mock.calls[0]?.[1]?.sessionId as string;
    const interruptRespond = vi.fn();
    await realtimeAudioHandlers["realtime.session.interrupt"]({
      req: { id: "req-2", type: "req", method: "realtime.session.interrupt" },
      params: { sessionId, target: "assistant" },
      respond: interruptRespond,
      context: { broadcast: () => {}, broadcastToConnIds: () => {} } as never,
      client: null,
      isWebchatConnect: () => false,
    });

    const closeRespond = vi.fn();
    await realtimeAudioHandlers["realtime.session.close"]({
      req: { id: "req-3", type: "req", method: "realtime.session.close" },
      params: { sessionId, reason: "done" },
      respond: closeRespond,
      context: { broadcast: () => {}, broadcastToConnIds: () => {} } as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(interruptRespond).toHaveBeenCalledWith(true, { ok: true }, undefined);
    expect(closeRespond).toHaveBeenCalledWith(true, { ok: true }, undefined);
    expect(broadcasts.slice(1)).toEqual([
      {
        event: "realtime.session",
        payload: {
          type: "interrupt.acknowledged",
          sessionId,
          target: "assistant",
        },
      },
      {
        event: "realtime.session",
        payload: {
          type: "session.state.changed",
          sessionId,
          state: "idle",
        },
      },
      {
        event: "realtime.session",
        payload: {
          type: "assistant.turn.updated",
          sessionId,
          turn: {
            state: "idle",
          },
        },
      },
      {
        event: "realtime.session",
        payload: {
          type: "session.closed",
          sessionId,
          reason: "done",
        },
      },
    ]);
    expect(realtimeConversationSessions.get(sessionId)).toBeUndefined();
  });

  it("runs realtime tool calls through the session tool runtime", async () => {
    const createRespond = vi.fn();
    const broadcasts: Array<{ event: string; payload: unknown }> = [];

    await realtimeAudioHandlers["realtime.session.create"]({
      req: { id: "req-1", type: "req", method: "realtime.session.create" },
      params: {
        transport: "test",
        workspaceDir: "/home/bex/projects/openclaw",
      },
      respond: createRespond,
      context: {
        broadcast: (event: string, payload: unknown) => {
          broadcasts.push({ event, payload });
        },
        broadcastToConnIds: () => {},
      } as never,
      client: null,
      isWebchatConnect: () => false,
    });

    const sessionId = createRespond.mock.calls[0]?.[1]?.sessionId as string;
    const toolRespond = vi.fn();
    await realtimeAudioHandlers["realtime.session.tool.call"]({
      req: { id: "req-4", type: "req", method: "realtime.session.tool.call" },
      params: {
        sessionId,
        toolCallId: "tool-1",
        toolName: "read",
        args: { path: "package.json" },
      },
      respond: toolRespond,
      context: { broadcast: () => {}, broadcastToConnIds: () => {} } as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(toolRespond).toHaveBeenCalledWith(true, { ok: true }, undefined);
    expect(
      broadcasts.some(
        (entry) =>
          entry.event === "realtime.session" &&
          (entry.payload as { type?: string }).type === "tool.updated",
      ),
    ).toBe(true);
  });

  it("accepts bound realtime input for gateway-created provider sessions", async () => {
    const createRespond = vi.fn();

    await realtimeAudioHandlers["realtime.session.create"]({
      req: { id: "req-1", type: "req", method: "realtime.session.create" },
      params: { transport: "desktop", provider: "openai" },
      respond: createRespond,
      context: { broadcast: () => {}, broadcastToConnIds: () => {} } as never,
      client: null,
      isWebchatConnect: () => false,
    });

    const sessionId = createRespond.mock.calls[0]?.[1]?.sessionId as string;
    const textRespond = vi.fn();
    await realtimeAudioHandlers["realtime.session.input.text"]({
      req: { id: "req-5", type: "req", method: "realtime.session.input.text" },
      params: { sessionId, text: "hello" },
      respond: textRespond,
      context: { broadcast: () => {}, broadcastToConnIds: () => {} } as never,
      client: null,
      isWebchatConnect: () => false,
    });

    const audioRespond = vi.fn();
    await realtimeAudioHandlers["realtime.session.input.audio"]({
      req: { id: "req-6", type: "req", method: "realtime.session.input.audio" },
      params: {
        sessionId,
        audioBase64: Buffer.from([0, 1, 2, 3]).toString("base64"),
        sampleRate: 48000,
        channels: 2,
      },
      respond: audioRespond,
      context: { broadcast: () => {}, broadcastToConnIds: () => {} } as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(textRespond).toHaveBeenCalledWith(true, { ok: true }, undefined);
    expect(audioRespond).toHaveBeenCalledWith(true, { ok: true }, undefined);
  });

  it("supports continuing pending provider tool calls with a final tool result", async () => {
    const createRespond = vi.fn();

    await realtimeAudioHandlers["realtime.session.create"]({
      req: { id: "req-1", type: "req", method: "realtime.session.create" },
      params: {
        transport: "desktop",
        provider: "openai",
        workspaceDir: "/home/bex/projects/openclaw",
      },
      respond: createRespond,
      context: { broadcast: () => {}, broadcastToConnIds: () => {} } as never,
      client: null,
      isWebchatConnect: () => false,
    });

    const sessionId = createRespond.mock.calls[0]?.[1]?.sessionId as string;
    const provider = getLastProviderAdapter();
    expect(provider).toBeDefined();
    provider?.emit({
      type: "tool.call",
      toolCallId: "tool-approval",
      toolName: "exec",
      args: { command: "ls" },
    });
    await Promise.resolve();

    const toolResultRespond = vi.fn();
    await realtimeAudioHandlers["realtime.session.tool.result"]({
      req: { id: "req-8", type: "req", method: "realtime.session.tool.result" },
      params: {
        sessionId,
        toolCallId: "tool-approval",
        output: "approved and done",
      },
      respond: toolResultRespond,
      context: { broadcast: () => {}, broadcastToConnIds: () => {} } as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(toolResultRespond).toHaveBeenCalledWith(true, { ok: true }, undefined);
    expect(provider?.submitToolResult).toHaveBeenCalledWith("tool-approval", "approved and done");
  });

  it("rejects unavailable requested capabilities and closes the rejected session", async () => {
    const respond = vi.fn();

    await realtimeAudioHandlers["realtime.session.create"]({
      req: { id: "req-9", type: "req", method: "realtime.session.create" },
      params: { transport: "desktop", provider: "openai", capabilities: ["transportSignal"] },
      respond,
      context: { broadcast: () => {}, broadcastToConnIds: () => {} } as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(respond.mock.calls[0]?.[2]).toMatchObject({
      code: "UNAVAILABLE",
      message: "realtime session does not support requested capabilities: transportSignal",
    });
  });

  it("rejects unconfigured transport bridges cleanly", async () => {
    const createRespond = vi.fn();

    await realtimeAudioHandlers["realtime.session.create"]({
      req: { id: "req-1", type: "req", method: "realtime.session.create" },
      params: { transport: "desktop", provider: "openai" },
      respond: createRespond,
      context: { broadcast: () => {}, broadcastToConnIds: () => {} } as never,
      client: null,
      isWebchatConnect: () => false,
    });

    const sessionId = createRespond.mock.calls[0]?.[1]?.sessionId as string;
    const transportRespond = vi.fn();
    await realtimeAudioHandlers["realtime.session.transport.signal"]({
      req: { id: "req-7", type: "req", method: "realtime.session.transport.signal" },
      params: {
        sessionId,
        signal: { kind: "offer", sdp: "v=0" },
      },
      respond: transportRespond,
      context: { broadcast: () => {}, broadcastToConnIds: () => {} } as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(transportRespond.mock.calls[0]?.[0]).toBe(false);
    expect(transportRespond.mock.calls[0]?.[2]).toMatchObject({
      code: "UNAVAILABLE",
      message: "Realtime transport bridge is not configured.",
    });
  });
});
