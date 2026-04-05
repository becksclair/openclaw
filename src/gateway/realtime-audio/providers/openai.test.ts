import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { OpenAIRealtimeProviderAdapter } from "./openai.js";

class FakeWebSocket extends EventEmitter {
  static readonly OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  readonly sent: string[] = [];
  closed = false;

  send(payload: string) {
    this.sent.push(payload);
  }

  close() {
    this.closed = true;
    this.emit("close");
  }
}

describe("OpenAIRealtimeProviderAdapter", () => {
  it("sends session.update with tools and maps websocket events into normalized provider events", async () => {
    const socket = new FakeWebSocket();
    const adapter = new OpenAIRealtimeProviderAdapter({
      apiKey: "sk-test",
      model: "gpt-realtime-1.5",
      webSocketFactory: () => {
        queueMicrotask(() => {
          socket.emit("open");
        });
        return socket as never;
      },
    });
    adapter.configureTools([
      {
        name: "read",
        description: "Read a file",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
    ]);
    adapter.configureBootstrap({
      instructions: "You are Sky in realtime mode.",
      history: [
        { role: "user", text: "Previous question" },
        { role: "assistant", text: "Previous answer" },
      ],
    });
    const events: unknown[] = [];
    adapter.subscribe((event) => {
      events.push(event);
    });

    await adapter.start();

    expect(JSON.parse(socket.sent[0] ?? "{}")).toEqual({
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
        turn_detection: {
          type: "semantic_vad",
          eagerness: "low",
          create_response: true,
          interrupt_response: true,
        },
        instructions: "You are Sky in realtime mode.",
        voice: "marin",
        tools: [
          {
            type: "function",
            name: "read",
            description: "Read a file",
            parameters: { type: "object", properties: { path: { type: "string" } } },
          },
        ],
      },
    });

    expect(JSON.parse(socket.sent[1] ?? "{}")).toEqual({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Previous question" }],
      },
    });
    expect(JSON.parse(socket.sent[2] ?? "{}")).toEqual({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Previous answer" }],
      },
    });

    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "conversation.item.input_audio_transcription.delta",
          item_id: "item-1",
          delta: "hel",
        }),
      ),
    );
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "conversation.item.input_audio_transcription.completed",
          item_id: "item-1",
          transcript: "hello",
        }),
      ),
    );
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "response.output_item.done",
          item: {
            type: "function_call",
            call_id: "call-1",
            name: "read",
            arguments: '{"path":"README.md"}',
          },
        }),
      ),
    );
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "response.created",
          response: { id: "resp-1" },
        }),
      ),
    );
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "response.output_text.delta",
          item_id: "assistant-1",
          delta: "hi",
          response: { id: "resp-1" },
        }),
      ),
    );
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "response.output_text.done",
          item_id: "assistant-1",
          text: "hi there",
          response: { id: "resp-1" },
        }),
      ),
    );
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "response.output_audio.delta",
          item_id: "assistant-1",
          delta: Buffer.from("pcm").toString("base64"),
          response: { id: "resp-1" },
        }),
      ),
    );
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "response.audio.delta",
          response: { id: "resp-1" },
        }),
      ),
    );
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "response.audio.done",
          response: { id: "resp-1" },
        }),
      ),
    );

    expect(events).toEqual([
      {
        type: "transcript.partial",
        itemId: "item-1",
        role: "user",
        text: "hel",
      },
      {
        type: "transcript.final",
        itemId: "item-1",
        role: "user",
        text: "hello",
      },
      {
        type: "tool.call",
        toolCallId: "call-1",
        toolName: "read",
        args: { path: "README.md" },
      },
      {
        type: "assistant.turn",
        turnId: "resp-1",
        state: "thinking",
      },
      {
        type: "transcript.partial",
        itemId: "assistant-1",
        role: "assistant",
        text: "hi",
      },
      {
        type: "assistant.turn",
        turnId: "resp-1",
        state: "speaking",
      },
      {
        type: "transcript.final",
        itemId: "assistant-1",
        role: "assistant",
        text: "hi there",
      },
      {
        type: "audio.output",
        itemId: "assistant-1",
        chunk: Buffer.from("pcm"),
        sampleRate: 24000,
        mimeType: "audio/pcm;rate=24000",
      },
      {
        type: "assistant.turn",
        turnId: "resp-1",
        state: "speaking",
      },
      {
        type: "assistant.turn",
        turnId: "resp-1",
        state: "completed",
      },
    ]);
  });

  it("treats response.done as a terminal assistant turn when audio.done is absent", async () => {
    const socket = new FakeWebSocket();
    const adapter = new OpenAIRealtimeProviderAdapter({
      apiKey: "sk-test",
      webSocketFactory: () => {
        queueMicrotask(() => {
          socket.emit("open");
        });
        return socket as never;
      },
    });
    const events: unknown[] = [];
    adapter.subscribe((event) => {
      events.push(event);
    });

    await adapter.start();
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "response.done",
          response: { id: "resp-2", status: "completed" },
        }),
      ),
    );

    expect(events).toEqual([
      {
        type: "assistant.turn",
        turnId: "resp-2",
        state: "completed",
      },
    ]);
  });

  it("uses calmer Discord turn detection defaults and accepts overrides", async () => {
    const socket = new FakeWebSocket();
    const adapter = new OpenAIRealtimeProviderAdapter({
      apiKey: "sk-test",
      transport: "discord",
      turnDetection: {
        vadEagerness: "medium",
      },
      webSocketFactory: () => {
        queueMicrotask(() => {
          socket.emit("open");
        });
        return socket as never;
      },
    });

    await adapter.start();

    expect(JSON.parse(socket.sent[0] ?? "{}")).toEqual({
      type: "session.update",
      session: expect.objectContaining({
        turn_detection: {
          type: "semantic_vad",
          eagerness: "medium",
          create_response: false,
          interrupt_response: false,
        },
      }),
    });
  });

  it("emits provider failure and fallback when the transport errors after startup", async () => {
    const socket = new FakeWebSocket();
    const adapter = new OpenAIRealtimeProviderAdapter({
      apiKey: "sk-test",
      webSocketFactory: () => {
        queueMicrotask(() => {
          socket.emit("open");
        });
        return socket as never;
      },
    });
    const events: unknown[] = [];
    adapter.subscribe((event) => {
      events.push(event);
    });

    await adapter.start();
    socket.emit("error", new Error("socket boom"));
    socket.emit("close");

    expect(events).toContainEqual({
      type: "error",
      code: "OPENAI_REALTIME_TRANSPORT_ERROR",
      message: "socket boom",
      retryable: true,
    });
    expect(events).toContainEqual({
      type: "fallback",
      reason: "provider_failed",
    });
    expect(
      events.filter(
        (event) =>
          (event as { type?: string }).type === "error" ||
          (event as { type?: string }).type === "fallback",
      ),
    ).toHaveLength(2);
  });

  it("ignores benign cancel-not-active provider errors", async () => {
    const socket = new FakeWebSocket();
    const adapter = new OpenAIRealtimeProviderAdapter({
      apiKey: "sk-test",
      webSocketFactory: () => {
        queueMicrotask(() => {
          socket.emit("open");
        });
        return socket as never;
      },
    });
    const events: unknown[] = [];
    adapter.subscribe((event) => {
      events.push(event);
    });

    await adapter.start();
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "error",
          error: {
            code: "response_cancel_not_active",
            message: "Cancellation failed: no active response found",
          },
        }),
      ),
    );

    expect(events).toEqual([]);
  });

  it("ignores late websocket messages after close", async () => {
    const socket = new FakeWebSocket();
    const adapter = new OpenAIRealtimeProviderAdapter({
      apiKey: "sk-test",
      webSocketFactory: () => {
        queueMicrotask(() => {
          socket.emit("open");
        });
        return socket as never;
      },
    });
    const events: unknown[] = [];
    adapter.subscribe((event) => {
      events.push(event);
    });

    await adapter.start();
    await adapter.close();
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "response.output_text.delta",
          item_id: "assistant-1",
          delta: "ghost text",
          response: { id: "resp-ghost" },
        }),
      ),
    );

    expect(events).toEqual([]);
  });

  it("commits buffered Discord audio, submits tool results, sends response.cancel, and closes the socket", async () => {
    const socket = new FakeWebSocket();
    const adapter = new OpenAIRealtimeProviderAdapter({
      apiKey: "sk-test",
      transport: "discord",
      webSocketFactory: () => {
        queueMicrotask(() => {
          socket.emit("open");
        });
        return socket as never;
      },
    });

    await adapter.start();
    await adapter.sendText("hello");
    await adapter.sendAudio(Buffer.from([0, 0, 1, 0]), { sampleRate: 24000, channels: 1 });
    await adapter.submitToolResult("call-1", '{"ok":true}');
    await adapter.interrupt();
    await adapter.close();

    expect(JSON.parse(socket.sent[1] ?? "{}")).toEqual({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello" }],
      },
    });
    expect(JSON.parse(socket.sent[2] ?? "{}")).toEqual({ type: "response.create" });
    expect(JSON.parse(socket.sent[3] ?? "{}")).toEqual({
      type: "input_audio_buffer.append",
      audio: Buffer.from([0, 0, 1, 0]).toString("base64"),
    });
    expect(JSON.parse(socket.sent[4] ?? "{}")).toEqual({ type: "input_audio_buffer.commit" });
    expect(JSON.parse(socket.sent[5] ?? "{}")).toEqual({ type: "response.create" });
    expect(JSON.parse(socket.sent[6] ?? "{}")).toEqual({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: "call-1",
        output: '{"ok":true}',
      },
    });
    expect(JSON.parse(socket.sent[7] ?? "{}")).toEqual({ type: "response.create" });
    expect(JSON.parse(socket.sent[8] ?? "{}")).toEqual({ type: "response.cancel" });
    expect(socket.closed).toBe(true);
  });
});
