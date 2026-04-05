import { describe, expect, it } from "vitest";
import type { RealtimeProviderAdapter } from "./providers/types.js";
import { InMemoryRealtimeConversationSession } from "./session.js";
import type {
  RealtimeProviderEvent,
  RealtimeSessionEvent,
  RealtimeToolDefinition,
  RealtimeToolRuntime,
  RealtimeTransportBridge,
  RealtimeTransportSignal,
} from "./types.js";

class FakeProviderAdapter implements RealtimeProviderAdapter {
  started = 0;
  interrupted: Array<"assistant" | "user-input" | undefined> = [];
  configuredTools: unknown[] = [];
  sentTexts: string[] = [];
  sentAudio: Array<{ pcm: Buffer; sampleRate: number; channels: number }> = [];
  submittedToolResults: Array<{ toolCallId: string; output: string }> = [];
  closed = 0;
  private listeners = new Set<
    (
      event: Parameters<RealtimeProviderAdapter["subscribe"]>[0] extends (event: infer T) => void
        ? T
        : never,
    ) => void
  >();

  configureTools(tools: unknown[]): void {
    this.configuredTools = tools;
  }

  async start(): Promise<void> {
    this.started += 1;
    this.emit({ type: "assistant.turn", state: "thinking", turnId: "turn-1" });
  }

  async sendText(text: string): Promise<void> {
    this.sentTexts.push(text);
  }

  async sendAudio(pcm: Buffer, options: { sampleRate: number; channels: number }): Promise<void> {
    this.sentAudio.push({ pcm, sampleRate: options.sampleRate, channels: options.channels });
  }

  async interrupt(target?: "assistant" | "user-input"): Promise<void> {
    this.interrupted.push(target);
  }

  async submitToolResult(toolCallId: string, output: string): Promise<void> {
    this.submittedToolResults.push({ toolCallId, output });
  }

  async close(): Promise<void> {
    this.closed += 1;
  }

  subscribe(
    listener: Parameters<RealtimeProviderAdapter["subscribe"]>[0] extends (event: infer T) => void
      ? (event: T) => void
      : never,
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: RealtimeProviderEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

class FakeTransportBridge implements RealtimeTransportBridge {
  started = 0;
  closed = 0;
  submittedSignals: RealtimeTransportSignal[] = [];
  private listeners = new Set<
    (
      event: Parameters<RealtimeTransportBridge["subscribe"]>[0] extends (event: infer T) => void
        ? T
        : never,
    ) => void
  >();

  async start(): Promise<void> {
    this.started += 1;
    this.emit({ type: "transport.state", state: "signaling" });
  }

  async close(): Promise<void> {
    this.closed += 1;
  }

  async submitSignal(signal: RealtimeTransportSignal): Promise<void> {
    this.submittedSignals.push(signal);
  }

  subscribe(
    listener: Parameters<RealtimeTransportBridge["subscribe"]>[0] extends (event: infer T) => void
      ? (event: T) => void
      : never,
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(
    event: Parameters<RealtimeTransportBridge["subscribe"]>[0] extends (event: infer T) => void
      ? T
      : never,
  ): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

class FakeRealtimeToolRuntime implements RealtimeToolRuntime {
  invoked: Array<{ toolCallId: string; toolName: string; params: unknown }> = [];
  private listeners = new Set<
    (
      update: Parameters<RealtimeToolRuntime["subscribe"]>[0] extends (update: infer T) => void
        ? T
        : never,
    ) => void
  >();

  listTools(): RealtimeToolDefinition[] {
    return [
      {
        name: "read",
        description: "Read a file",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
    ];
  }

  async invoke(toolCallId: string, toolName: string, params: unknown): Promise<unknown> {
    this.invoked.push({ toolCallId, toolName, params });
    const update = {
      toolCallId,
      toolName,
      status: "completed" as const,
      text: "ok",
    };
    for (const listener of this.listeners) {
      listener(update);
    }
    return { ok: true };
  }

  subscribe(
    listener: Parameters<RealtimeToolRuntime["subscribe"]>[0] extends (update: infer T) => void
      ? (update: T) => void
      : never,
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

class FakeApprovalRealtimeToolRuntime implements RealtimeToolRuntime {
  invoked: Array<{ toolCallId: string; toolName: string; params: unknown }> = [];
  private listeners = new Set<
    (
      update: Parameters<RealtimeToolRuntime["subscribe"]>[0] extends (update: infer T) => void
        ? T
        : never,
    ) => void
  >();

  listTools(): RealtimeToolDefinition[] {
    return [
      {
        name: "exec",
        description: "Run a command",
        parameters: { type: "object", properties: { command: { type: "string" } } },
      },
    ];
  }

  async invoke(toolCallId: string, toolName: string, params: unknown): Promise<unknown> {
    this.invoked.push({ toolCallId, toolName, params });
    const update = {
      toolCallId,
      toolName,
      status: "approval" as const,
      text: "Approval required",
      approval: {
        approvalId: "approval-1",
      },
    };
    for (const listener of this.listeners) {
      listener(update);
    }
    return {
      content: [{ type: "text", text: "Approval required" }],
      details: {
        status: "approval-pending",
        approvalId: "approval-1",
      },
    };
  }

  subscribe(
    listener: Parameters<RealtimeToolRuntime["subscribe"]>[0] extends (update: infer T) => void
      ? (update: T) => void
      : never,
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

class FakeThrowingRealtimeToolRuntime implements RealtimeToolRuntime {
  listTools(): RealtimeToolDefinition[] {
    return [
      {
        name: "write",
        description: "Write a file",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
    ];
  }

  async invoke(): Promise<unknown> {
    throw new Error("Permission denied");
  }

  subscribe(): () => void {
    return () => undefined;
  }
}

describe("InMemoryRealtimeConversationSession", () => {
  it("emits deterministic transcript, assistant, interrupt, fallback, and close events", async () => {
    const session = new InMemoryRealtimeConversationSession({
      sessionId: "session-test",
      transport: "test",
    });
    const events: RealtimeSessionEvent[] = [];
    session.subscribe((event) => {
      events.push(event);
    });

    await session.start();
    session.handleProviderEvent({
      type: "transcript.partial",
      itemId: "u-1",
      role: "user",
      text: "hel",
    });
    session.handleProviderEvent({
      type: "transcript.partial",
      itemId: "u-1",
      role: "user",
      text: "lo",
    });
    session.handleProviderEvent({
      type: "transcript.final",
      itemId: "u-1",
      role: "user",
      text: "hello",
    });
    session.handleProviderEvent({
      type: "assistant.turn",
      turnId: "a-1",
      state: "thinking",
    });
    session.handleProviderEvent({
      type: "assistant.turn",
      turnId: "a-1",
      state: "speaking",
    });
    await session.interrupt();
    session.handleProviderEvent({
      type: "fallback",
      reason: "provider_unavailable",
    });
    await session.close("done");

    expect(events.map((event) => event.type)).toEqual([
      "session.created",
      "session.state.changed",
      "transcript.updated",
      "transcript.updated",
      "transcript.updated",
      "session.state.changed",
      "assistant.turn.updated",
      "session.state.changed",
      "assistant.turn.updated",
      "interrupt.acknowledged",
      "session.state.changed",
      "assistant.turn.updated",
      "fallback.changed",
      "session.state.changed",
      "session.closed",
    ]);

    expect(session.getSnapshot()).toMatchObject({
      sessionId: "session-test",
      mode: "fallback",
      state: "closed",
      transcript: [
        {
          itemId: "u-1",
          role: "user",
          status: "final",
          text: "hello",
          revision: 2,
        },
      ],
      assistantTurn: {
        turnId: "a-1",
        state: "interrupted",
      },
      closedReason: "done",
    });
  });

  it("honors fallbackEnabled=false by surfacing an error instead of switching modes", async () => {
    const session = new InMemoryRealtimeConversationSession({
      sessionId: "session-no-fallback",
      transport: "test",
      fallbackEnabled: false,
    });
    const events: RealtimeSessionEvent[] = [];
    session.subscribe((event) => {
      events.push(event);
    });

    await session.start();
    session.handleProviderEvent({
      type: "fallback",
      reason: "provider_failed",
    });

    expect(session.getSnapshot()).toMatchObject({
      sessionId: "session-no-fallback",
      mode: "realtime",
      state: "idle",
    });
    expect(events).toContainEqual({
      type: "session.error",
      sessionId: "session-no-fallback",
      code: "fallback_disabled",
      message: "Realtime fallback requested but fallback is disabled (provider_failed).",
      retryable: false,
    });
  });

  it("binds provider lifecycle to start interrupt and close", async () => {
    const adapter = new FakeProviderAdapter();
    const session = new InMemoryRealtimeConversationSession({
      sessionId: "session-provider",
      transport: "test",
      provider: "openai",
      providerBinding: { adapter },
    });
    const events: RealtimeSessionEvent[] = [];
    session.subscribe((event) => {
      events.push(event);
    });

    await session.start();
    await session.interrupt("assistant");
    await session.close("done");

    expect(adapter.started).toBe(1);
    expect(adapter.interrupted).toEqual(["assistant"]);
    expect(adapter.closed).toBe(1);
    expect(events.some((event) => event.type === "assistant.turn.updated")).toBe(true);
  });

  it("routes text and audio input through the bound provider", async () => {
    const adapter = new FakeProviderAdapter();
    const session = new InMemoryRealtimeConversationSession({
      sessionId: "session-inputs",
      transport: "test",
      provider: "openai",
      providerBinding: { adapter },
    });

    await session.start();
    await session.submitText(" hello ");
    await session.submitAudio(Buffer.from([0, 1, 2, 3]), { sampleRate: 48000, channels: 2 });

    expect(adapter.sentTexts).toEqual(["hello"]);
    expect(adapter.sentAudio).toEqual([
      {
        pcm: Buffer.from([0, 1, 2, 3]),
        sampleRate: 48000,
        channels: 2,
      },
    ]);
  });

  it("does not regress session state when assistant transcript deltas arrive", async () => {
    const session = new InMemoryRealtimeConversationSession({
      sessionId: "session-assistant-transcript",
      transport: "test",
    });
    const events: RealtimeSessionEvent[] = [];
    session.subscribe((event) => {
      events.push(event);
    });

    await session.start();
    session.handleProviderEvent({
      type: "assistant.turn",
      turnId: "turn-1",
      state: "thinking",
    });
    session.handleProviderEvent({
      type: "transcript.partial",
      itemId: "assistant-1",
      role: "assistant",
      text: "hi",
    });
    session.handleProviderEvent({
      type: "transcript.final",
      itemId: "assistant-1",
      role: "assistant",
      text: "hi there",
    });

    expect(session.getSnapshot()).toMatchObject({
      state: "thinking",
      transcript: [
        {
          itemId: "assistant-1",
          role: "assistant",
          status: "final",
          text: "hi there",
        },
      ],
    });
    expect(events.filter((event) => event.type === "session.state.changed")).toEqual([
      {
        type: "session.state.changed",
        sessionId: "session-assistant-transcript",
        state: "thinking",
      },
    ]);
  });

  it("binds transport bridge lifecycle and forwards transport events", async () => {
    const bridge = new FakeTransportBridge();
    const session = new InMemoryRealtimeConversationSession({
      sessionId: "session-transport",
      transport: "desktop",
      transportBinding: { bridge },
    });
    const events: RealtimeSessionEvent[] = [];
    session.subscribe((event) => {
      events.push(event);
    });

    await session.start();
    await session.submitTransportSignal({ kind: "offer", sdp: "v=0" });
    bridge.emit({
      type: "transport.signal",
      signal: { kind: "answer", sdp: "v=0" },
    });
    await session.close("done");

    expect(bridge.started).toBe(1);
    expect(bridge.submittedSignals).toEqual([{ kind: "offer", sdp: "v=0" }]);
    expect(bridge.closed).toBe(1);
    expect(events).toContainEqual({
      type: "transport.state.changed",
      sessionId: "session-transport",
      state: "signaling",
    });
    expect(events).toContainEqual({
      type: "transport.signal",
      sessionId: "session-transport",
      signal: { kind: "answer", sdp: "v=0" },
    });
  });

  it("emits tool.updated events when invoking bound realtime tools", async () => {
    const runtime = new FakeRealtimeToolRuntime();
    const session = new InMemoryRealtimeConversationSession({
      sessionId: "session-tools",
      transport: "test",
      toolBinding: { runtime },
    });
    const events: RealtimeSessionEvent[] = [];
    session.subscribe((event) => {
      events.push(event);
    });

    await session.start();
    await session.invokeToolCall("tool-1", "read", { path: "README.md" });

    expect(runtime.invoked).toEqual([
      { toolCallId: "tool-1", toolName: "read", params: { path: "README.md" } },
    ]);
    expect(events).toContainEqual({
      type: "tool.updated",
      sessionId: "session-tools",
      update: {
        toolCallId: "tool-1",
        toolName: "read",
        status: "completed",
        text: "ok",
      },
    });
  });

  it("executes provider-requested tool calls and submits results back to the provider", async () => {
    const adapter = new FakeProviderAdapter();
    const runtime = new FakeRealtimeToolRuntime();
    const session = new InMemoryRealtimeConversationSession({
      sessionId: "session-provider-tools",
      transport: "test",
      provider: "openai",
      providerBinding: { adapter },
      toolBinding: { runtime },
    });

    await session.start();
    adapter.emit({
      type: "tool.call",
      toolCallId: "call-1",
      toolName: "read",
      args: { path: "README.md" },
    });
    await Promise.resolve();

    expect(adapter.configuredTools).toEqual(runtime.listTools());
    expect(runtime.invoked).toContainEqual({
      toolCallId: "call-1",
      toolName: "read",
      params: { path: "README.md" },
    });
    expect(adapter.submittedToolResults).toEqual([
      { toolCallId: "call-1", output: '{\n  "ok": true\n}' },
    ]);
  });

  it("emits a failed tool update when provider-requested tool execution throws", async () => {
    const adapter = new FakeProviderAdapter();
    const runtime = new FakeThrowingRealtimeToolRuntime();
    const session = new InMemoryRealtimeConversationSession({
      sessionId: "session-provider-tool-failure",
      transport: "test",
      provider: "openai",
      providerBinding: { adapter },
      toolBinding: { runtime },
    });
    const events: RealtimeSessionEvent[] = [];
    session.subscribe((event) => {
      events.push(event);
    });

    await session.start();
    adapter.emit({
      type: "tool.call",
      toolCallId: "call-fail",
      toolName: "write",
      args: { path: "README.md" },
    });
    await Promise.resolve();

    expect(events).toContainEqual({
      type: "tool.updated",
      sessionId: "session-provider-tool-failure",
      update: {
        toolCallId: "call-fail",
        toolName: "write",
        status: "failed",
        error: {
          code: "tool_invoke_failed",
          message: "Permission denied",
        },
      },
    });
    expect(adapter.submittedToolResults).toEqual([
      {
        toolCallId: "call-fail",
        output: JSON.stringify({ ok: false, error: "Permission denied" }),
      },
    ]);
  });

  it("retains pending provider tool calls and lets the operator continue them", async () => {
    const adapter = new FakeProviderAdapter();
    const runtime = new FakeApprovalRealtimeToolRuntime();
    const session = new InMemoryRealtimeConversationSession({
      sessionId: "session-provider-pending-tools",
      transport: "test",
      provider: "openai",
      providerBinding: { adapter },
      toolBinding: { runtime },
    });
    const events: RealtimeSessionEvent[] = [];
    session.subscribe((event) => {
      events.push(event);
    });

    await session.start();
    adapter.emit({
      type: "tool.call",
      toolCallId: "call-approval",
      toolName: "exec",
      args: { command: "ls" },
    });
    await Promise.resolve();
    await session.submitPendingToolResult("call-approval", "approved and done");

    expect(runtime.invoked).toContainEqual({
      toolCallId: "call-approval",
      toolName: "exec",
      params: { command: "ls" },
    });
    expect(adapter.submittedToolResults).toEqual([
      { toolCallId: "call-approval", output: "approved and done" },
    ]);
    expect(events).toContainEqual({
      type: "tool.updated",
      sessionId: "session-provider-pending-tools",
      update: {
        toolCallId: "call-approval",
        toolName: "exec",
        status: "completed",
        text: "approved and done",
      },
    });
  });

  it("reports honest session capabilities", async () => {
    const adapter = new FakeProviderAdapter();
    const runtime = new FakeRealtimeToolRuntime();
    const bridge = new FakeTransportBridge();
    const session = new InMemoryRealtimeConversationSession({
      sessionId: "session-capabilities",
      transport: "desktop",
      provider: "openai",
      providerBinding: { adapter },
      toolBinding: { runtime },
      transportBinding: { bridge },
    });

    expect(session.getCapabilities()).toEqual({
      textInput: true,
      audioInput: true,
      toolCalls: true,
      toolResultContinuation: true,
      transportSignal: true,
    });
    const providerOnlySession = new InMemoryRealtimeConversationSession({
      sessionId: "session-provider-only-capabilities",
      transport: "desktop",
      provider: "openai",
      providerBinding: { adapter },
    });
    expect(providerOnlySession.getCapabilities()).toEqual({
      textInput: true,
      audioInput: true,
      toolCalls: false,
      toolResultContinuation: false,
      transportSignal: false,
    });
  });
});
