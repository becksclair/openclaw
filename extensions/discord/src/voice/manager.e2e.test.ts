import fs from "node:fs/promises";
import { ChannelType } from "@buape/carbon";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeProviderAdapter } from "../../../../src/gateway/realtime-audio/providers/types.js";
import { InMemoryRealtimeConversationSession } from "../../../../src/gateway/realtime-audio/session.js";
import type {
  RealtimeProviderEvent,
  RealtimeSessionEvent,
} from "../../../../src/gateway/realtime-audio/types.js";

const {
  createConnectionMock,
  joinVoiceChannelMock,
  entersStateMock,
  createAudioPlayerMock,
  resolveAgentRouteMock,
  agentCommandMock,
  transcribeAudioFileMock,
  createManagedRealtimeConversationRuntimeMock,
  appendTextMessagesToSessionTranscriptMock,
} = vi.hoisted(() => {
  type EventHandler = (...args: unknown[]) => unknown;
  type MockConnection = {
    destroy: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    receiver: {
      speaking: {
        on: ReturnType<typeof vi.fn>;
        off: ReturnType<typeof vi.fn>;
      };
      subscribe: ReturnType<typeof vi.fn>;
    };
    handlers: Map<string, EventHandler>;
  };

  const appendTextMessagesToSessionTranscriptMock = vi.fn(
    async (): Promise<
      { ok: true; sessionFile: string; messageIds: string[] } | { ok: false; reason: string }
    > => ({
      ok: true,
      sessionFile: "/tmp/session.jsonl",
      messageIds: ["msg-1", "msg-2"],
    }),
  );

  const createConnectionMock = (): MockConnection => {
    const handlers = new Map<string, EventHandler>();
    const connection: MockConnection = {
      destroy: vi.fn(),
      subscribe: vi.fn(),
      on: vi.fn((event: string, handler: EventHandler) => {
        handlers.set(event, handler);
      }),
      off: vi.fn(),
      receiver: {
        speaking: {
          on: vi.fn(),
          off: vi.fn(),
        },
        subscribe: vi.fn(() => ({
          on: vi.fn(),
          [Symbol.asyncIterator]: async function* () {},
        })),
      },
      handlers,
    };
    return connection;
  };

  return {
    createConnectionMock,
    joinVoiceChannelMock: vi.fn(() => createConnectionMock()),
    entersStateMock: vi.fn(async (_target?: unknown, _state?: string, _timeoutMs?: number) => {
      return undefined;
    }),
    createAudioPlayerMock: vi.fn(() => ({
      on: vi.fn(),
      off: vi.fn(),
      stop: vi.fn(),
      play: vi.fn(),
      state: { status: "idle" },
    })),
    resolveAgentRouteMock: vi.fn(() => ({ agentId: "agent-1", sessionKey: "discord:g1:c1" })),
    agentCommandMock: vi.fn(async (_opts?: unknown, _runtime?: unknown) => ({ payloads: [] })),
    transcribeAudioFileMock: vi.fn(async () => ({ text: "hello from voice" })),
    createManagedRealtimeConversationRuntimeMock: vi.fn(() => {
      throw new Error("realtime unavailable");
    }),
    appendTextMessagesToSessionTranscriptMock,
  };
});

vi.mock("./sdk-runtime.js", () => ({
  loadDiscordVoiceSdk: () => ({
    AudioPlayerStatus: { Playing: "playing", Idle: "idle" },
    EndBehaviorType: { AfterSilence: "AfterSilence" },
    VoiceConnectionStatus: {
      Ready: "ready",
      Disconnected: "disconnected",
      Destroyed: "destroyed",
      Signalling: "signalling",
      Connecting: "connecting",
    },
    createAudioPlayer: createAudioPlayerMock,
    createAudioResource: vi.fn(),
    entersState: entersStateMock,
    joinVoiceChannel: joinVoiceChannelMock,
  }),
}));

vi.mock("openclaw/plugin-sdk/routing", async () => {
  const actual = await vi.importActual<typeof import("openclaw/plugin-sdk/routing")>(
    "openclaw/plugin-sdk/routing",
  );
  return {
    ...actual,
    resolveAgentRoute: resolveAgentRouteMock,
  };
});

vi.mock("openclaw/plugin-sdk/agent-runtime", async () => {
  const actual = await vi.importActual<typeof import("openclaw/plugin-sdk/agent-runtime")>(
    "openclaw/plugin-sdk/agent-runtime",
  );
  return {
    ...actual,
    agentCommandFromIngress: agentCommandMock,
  };
});

vi.mock("openclaw/plugin-sdk/session-store-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/session-store-runtime")>();
  return {
    ...actual,
    appendTextMessagesToSessionTranscript: appendTextMessagesToSessionTranscriptMock,
  };
});

vi.mock("openclaw/plugin-sdk/media-understanding-runtime", () => ({
  transcribeAudioFile: transcribeAudioFileMock,
}));

vi.mock("openclaw/plugin-sdk/gateway-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/gateway-runtime")>();
  return {
    ...actual,
    createManagedRealtimeConversationRuntime: createManagedRealtimeConversationRuntimeMock,
  };
});

class SessionBackedProviderAdapter implements RealtimeProviderAdapter {
  sentTexts: string[] = [];
  sentAudios: Array<{ pcm: Buffer; sampleRate: number; channels: number }> = [];
  private listeners = new Set<(event: RealtimeProviderEvent) => void>();

  async start(): Promise<void> {
    return undefined;
  }

  async sendText(text: string): Promise<void> {
    this.sentTexts.push(text);
  }

  async sendAudio(pcm: Buffer, options: { sampleRate: number; channels: number }): Promise<void> {
    this.sentAudios.push({ pcm, sampleRate: options.sampleRate, channels: options.channels });
    this.emit({ type: "assistant.turn", turnId: "turn-1", state: "thinking" });
    this.emit({
      type: "transcript.final",
      itemId: "assistant-1",
      role: "assistant",
      text: "Realtime hello",
    });
    this.emit({
      type: "audio.output",
      itemId: "assistant-1",
      chunk: Buffer.from([0, 1, 2, 3]),
      sampleRate: 24000,
      mimeType: "audio/pcm;rate=24000",
    });
    this.emit({ type: "assistant.turn", turnId: "turn-1", state: "completed" });
  }

  async interrupt(): Promise<void> {
    return undefined;
  }

  async close(): Promise<void> {
    return undefined;
  }

  subscribe(listener: (event: RealtimeProviderEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: RealtimeProviderEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

function createSessionBackedRealtimeRuntime() {
  const adapter = new SessionBackedProviderAdapter();
  const session = new InMemoryRealtimeConversationSession({
    transport: "discord",
    provider: "openai",
    providerBinding: { adapter },
  });

  return {
    adapter,
    runtime: {
      start: async () => await session.start(),
      close: async (reason?: string) => await session.close(reason),
      interrupt: async (target?: "assistant" | "user-input") => await session.interrupt(target),
      submitText: async (text: string) => await session.submitText(text),
      submitAudio: async (pcm: Buffer, options: { sampleRate: number; channels: number }) =>
        await session.submitAudio(pcm, options),
      subscribe: (listener: (event: RealtimeSessionEvent) => void) => session.subscribe(listener),
      listTools: () => [],
    },
  };
}

let managerModule: typeof import("./manager.js");

function createClient() {
  return {
    fetchChannel: vi.fn(async (channelId: string) => ({
      id: channelId,
      guildId: "g1",
      guild: { id: "g1", name: "Guild One" },
      type: ChannelType.GuildVoice,
    })),
    fetchGuild: vi.fn(async (guildId: string) => ({
      id: guildId,
      name: "Guild One",
    })),
    getPlugin: vi.fn(() => ({
      getGatewayAdapterCreator: vi.fn(() => vi.fn()),
    })),
    fetchMember: vi.fn(),
    fetchUser: vi.fn(),
  };
}

function createRuntime() {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  };
}

describe("DiscordVoiceManager", () => {
  beforeAll(async () => {
    managerModule = await import("./manager.js");
  });

  beforeEach(() => {
    joinVoiceChannelMock.mockReset();
    joinVoiceChannelMock.mockImplementation(() => createConnectionMock());
    entersStateMock.mockReset();
    entersStateMock.mockResolvedValue(undefined);
    createAudioPlayerMock.mockClear();
    resolveAgentRouteMock.mockClear();
    agentCommandMock.mockReset();
    agentCommandMock.mockResolvedValue({ payloads: [] });
    transcribeAudioFileMock.mockReset();
    transcribeAudioFileMock.mockResolvedValue({ text: "hello from voice" });
    createManagedRealtimeConversationRuntimeMock.mockReset();
    createManagedRealtimeConversationRuntimeMock.mockImplementation(() => {
      throw new Error("realtime unavailable");
    });
    appendTextMessagesToSessionTranscriptMock.mockReset();
    appendTextMessagesToSessionTranscriptMock.mockResolvedValue({
      ok: true,
      sessionFile: "/tmp/session.jsonl",
      messageIds: ["msg-1", "msg-2"],
    });
  });

  const createManager = (
    discordConfig: ConstructorParameters<
      typeof managerModule.DiscordVoiceManager
    >[0]["discordConfig"] = {},
    clientOverride?: ReturnType<typeof createClient>,
    cfgOverride: ConstructorParameters<typeof managerModule.DiscordVoiceManager>[0]["cfg"] = {},
  ) =>
    new managerModule.DiscordVoiceManager({
      client: (clientOverride ?? createClient()) as never,
      cfg: cfgOverride,
      discordConfig,
      accountId: "default",
      runtime: createRuntime(),
    });

  const expectConnectedStatus = (
    manager: InstanceType<typeof managerModule.DiscordVoiceManager>,
    channelId: string,
  ) => {
    expect(manager.status()).toEqual([
      {
        ok: true,
        message: `connected: guild g1 channel ${channelId}`,
        guildId: "g1",
        channelId,
      },
    ]);
  };

  const emitDecryptFailure = (manager: InstanceType<typeof managerModule.DiscordVoiceManager>) => {
    const entry = (manager as unknown as { sessions: Map<string, unknown> }).sessions.get("g1");
    expect(entry).toBeDefined();
    (
      manager as unknown as { handleReceiveError: (e: unknown, err: unknown) => void }
    ).handleReceiveError(
      entry,
      new Error("Failed to decrypt: DecryptionFailed(UnencryptedWhenPassthroughDisabled)"),
    );
  };

  type RuntimeTestEvent = { type: string; [key: string]: unknown };

  type ProcessSegmentInvoker = {
    processSegment: (params: {
      entry: unknown;
      wavPath: string;
      pcm: Buffer;
      userId: string;
      durationSeconds: number;
    }) => Promise<void>;
  };

  const createRealtimeRuntimeMock = (params: {
    close?: ReturnType<typeof vi.fn>;
    onSubmitAudio?: (emit: (event: RuntimeTestEvent) => void) => void | Promise<void>;
  }) => {
    let listener: ((event: RuntimeTestEvent) => void) | undefined;
    return {
      start: vi.fn(async () => undefined),
      close: params.close ?? vi.fn(async () => undefined),
      interrupt: vi.fn(async () => undefined),
      submitText: vi.fn(async () => undefined),
      submitAudio: vi.fn(async () => {
        await params.onSubmitAudio?.((event) => {
          listener?.(event);
        });
      }),
      subscribe: vi.fn((next: (event: RuntimeTestEvent) => void) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      }),
      listTools: vi.fn(() => []),
    };
  };

  const buildRealtimeTranscriptIdempotencyKey = (turnId: string, role: "user" | "assistant") =>
    `discord-voice:discord:g1:1001:${turnId}:${role}`;

  const createRealtimeVoiceEntry = (entryOverride: Record<string, unknown> = {}) => ({
    guildId: "g1",
    channelId: "1001",
    route: { sessionKey: "discord:g1:1001", agentId: "agent-1" },
    player: createAudioPlayerMock(),
    playbackQueue: Promise.resolve(),
    realtimeDisabled: false,
    realtimeConnectedOnce: true,
    realtimeEpoch: 1,
    realtimeReplayHistory: [],
    voiceBackend: "realtime",
    ...entryOverride,
  });

  const invokeGenerateVoiceReply = async (
    manager: InstanceType<typeof managerModule.DiscordVoiceManager>,
    entryOverride: Record<string, unknown> = {},
    params: { senderLabel?: string; senderIsOwner?: boolean } = {},
  ) => {
    const entry = createRealtimeVoiceEntry(entryOverride);
    const result = await (
      manager as unknown as {
        generateVoiceReply: (params: {
          entry: typeof entry;
          wavPath: string;
          pcm: Buffer;
          senderLabel: string;
          senderIsOwner: boolean;
        }) => Promise<{ text: string; audioPath?: string; superseded?: boolean }>;
      }
    ).generateVoiceReply({
      entry,
      wavPath: "/tmp/test.wav",
      pcm: Buffer.alloc(1920),
      senderLabel: params.senderLabel ?? "u-guest",
      senderIsOwner: params.senderIsOwner ?? false,
    });
    return { entry, result };
  };

  const processVoiceSegment = async (
    manager: InstanceType<typeof managerModule.DiscordVoiceManager>,
    userId: string,
    entryOverride?: Record<string, unknown>,
  ) =>
    await (manager as unknown as ProcessSegmentInvoker).processSegment({
      entry: {
        guildId: "g1",
        channelId: "1001",
        route: { sessionKey: "discord:g1:1001", agentId: "agent-1" },
        player: createAudioPlayerMock(),
        playbackQueue: Promise.resolve(),
        realtimeDisabled: false,
        realtimeConnectedOnce: false,
        realtimeEpoch: 0,
        ...entryOverride,
      },
      wavPath: "/tmp/test.wav",
      pcm: Buffer.alloc(1920),
      userId,
      durationSeconds: 1.2,
    });

  it("keeps the new session when an old disconnected handler fires", async () => {
    const oldConnection = createConnectionMock();
    const newConnection = createConnectionMock();
    joinVoiceChannelMock.mockReturnValueOnce(oldConnection).mockReturnValueOnce(newConnection);
    entersStateMock.mockImplementation(async (target: unknown, status?: string) => {
      if (target === oldConnection && (status === "signalling" || status === "connecting")) {
        throw new Error("old disconnected");
      }
      return undefined;
    });

    const manager = createManager();

    await manager.join({ guildId: "g1", channelId: "1001" });
    await manager.join({ guildId: "g1", channelId: "1002" });

    const oldDisconnected = oldConnection.handlers.get("disconnected");
    expect(oldDisconnected).toBeTypeOf("function");
    await oldDisconnected?.();

    expectConnectedStatus(manager, "1002");
  });

  it("keeps the new session when an old destroyed handler fires", async () => {
    const oldConnection = createConnectionMock();
    const newConnection = createConnectionMock();
    joinVoiceChannelMock.mockReturnValueOnce(oldConnection).mockReturnValueOnce(newConnection);

    const manager = createManager();

    await manager.join({ guildId: "g1", channelId: "1001" });
    await manager.join({ guildId: "g1", channelId: "1002" });

    const oldDestroyed = oldConnection.handlers.get("destroyed");
    expect(oldDestroyed).toBeTypeOf("function");
    oldDestroyed?.();

    expectConnectedStatus(manager, "1002");
  });

  it("removes voice listeners on leave", async () => {
    const connection = createConnectionMock();
    joinVoiceChannelMock.mockReturnValueOnce(connection);
    const manager = createManager();

    await manager.join({ guildId: "g1", channelId: "1001" });
    await manager.leave({ guildId: "g1" });

    const player = createAudioPlayerMock.mock.results[0]?.value;
    expect(connection.receiver.speaking.off).toHaveBeenCalledWith("start", expect.any(Function));
    expect(connection.off).toHaveBeenCalledWith("disconnected", expect.any(Function));
    expect(connection.off).toHaveBeenCalledWith("destroyed", expect.any(Function));
    expect(player.off).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("passes DAVE options to joinVoiceChannel", async () => {
    const manager = createManager({
      voice: {
        daveEncryption: false,
        decryptionFailureTolerance: 8,
      },
    });

    await manager.join({ guildId: "g1", channelId: "1001" });

    expect(joinVoiceChannelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        daveEncryption: false,
        decryptionFailureTolerance: 8,
      }),
    );
  });

  it("keeps the shorter timeout for initial voice connection readiness", async () => {
    const connection = createConnectionMock();
    joinVoiceChannelMock.mockReturnValueOnce(connection);
    const manager = createManager();

    await manager.join({ guildId: "g1", channelId: "1001" });

    expect(entersStateMock).toHaveBeenCalledWith(connection, "ready", 15_000);
  });

  it("resolves voice backend overrides from channel config before guild and default config", async () => {
    const manager = createManager({
      voice: {
        backend: "realtime",
      },
      guilds: {
        g1: {
          voiceBackend: "stt-agent-tts",
          channels: {
            "1001": {
              voiceBackend: "realtime",
            },
          },
        },
      },
    });

    await manager.join({ guildId: "g1", channelId: "1001" });

    const entry = (manager as unknown as { sessions: Map<string, unknown> }).sessions.get("g1") as
      | { voiceBackend?: string }
      | undefined;
    expect(entry?.voiceBackend).toBe("realtime");
  });

  it("stores guild metadata on joined voice sessions", async () => {
    const manager = createManager();

    await manager.join({ guildId: "g1", channelId: "1001" });

    const entry = (manager as unknown as { sessions: Map<string, unknown> }).sessions.get("g1") as
      | { guildName?: string }
      | undefined;
    expect(entry?.guildName).toBe("Guild One");
  });

  it("attempts rejoin after repeated decrypt failures", async () => {
    const manager = createManager();

    await manager.join({ guildId: "g1", channelId: "1001" });

    emitDecryptFailure(manager);
    emitDecryptFailure(manager);
    emitDecryptFailure(manager);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(joinVoiceChannelMock).toHaveBeenCalledTimes(2);
  });

  it("prefers realtime replies over the legacy agent path when available", async () => {
    const manager = createManager(
      { groupPolicy: "open", voice: { backend: "realtime" } },
      undefined,
      { commands: { useAccessGroups: false } },
    );
    const generateRealtimeReply = vi.fn(async () => ({
      text: "Realtime hello",
      audioPath: "/tmp/realtime.wav",
    }));
    (
      manager as unknown as { generateRealtimeReply: typeof generateRealtimeReply }
    ).generateRealtimeReply = generateRealtimeReply;

    await processVoiceSegment(manager, "u-guest", { voiceBackend: "realtime" });

    expect(generateRealtimeReply).toHaveBeenCalledWith({
      entry: expect.objectContaining({
        guildId: "g1",
        channelId: "1001",
        voiceBackend: "realtime",
      }),
      pcm: expect.any(Buffer),
      senderLabel: "u-guest",
      senderIsOwner: false,
    });
    expect(agentCommandMock).not.toHaveBeenCalled();
  });

  it("falls back to the legacy agent path when realtime runtime startup fails", async () => {
    const manager = createManager(
      { groupPolicy: "open", voice: { backend: "realtime" } },
      undefined,
      { commands: { useAccessGroups: false } },
    );

    await processVoiceSegment(manager, "u-guest");

    expect(agentCommandMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the legacy agent path when realtime audio submission fails after connect", async () => {
    const manager = createManager(
      { groupPolicy: "open", voice: { backend: "realtime" } },
      undefined,
      { commands: { useAccessGroups: false } },
    );
    createManagedRealtimeConversationRuntimeMock.mockImplementation(
      () =>
        ({
          start: vi.fn(async () => undefined),
          close: vi.fn(async () => undefined),
          interrupt: vi.fn(async () => undefined),
          submitText: vi.fn(async () => undefined),
          submitAudio: vi.fn(async () => {
            throw new Error("submit failed");
          }),
          subscribe: vi.fn(() => () => undefined),
          listTools: vi.fn(() => []),
        }) as never,
    );

    await processVoiceSegment(manager, "u-guest");

    expect(agentCommandMock).toHaveBeenCalled();
  });

  it("keeps partial realtime output when audio submission fails after assistant output", async () => {
    const manager = createManager(
      { groupPolicy: "open", voice: { backend: "realtime" } },
      undefined,
      { commands: { useAccessGroups: false } },
    );
    createManagedRealtimeConversationRuntimeMock.mockImplementation(() => {
      let listener: ((event: { type: string; [key: string]: unknown }) => void) | undefined;
      return {
        start: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
        interrupt: vi.fn(async () => undefined),
        submitText: vi.fn(async () => undefined),
        submitAudio: vi.fn(async () => {
          listener?.({
            type: "transcript.updated",
            sessionId: "session-1",
            item: { role: "assistant", status: "final", text: "Partial realtime answer" },
          });
          throw new Error("submit failed after output");
        }),
        subscribe: vi.fn((next: (event: { type: string; [key: string]: unknown }) => void) => {
          listener = next;
          return () => {
            listener = undefined;
          };
        }),
        listTools: vi.fn(() => []),
      } as never;
    });

    const { result } = await invokeGenerateVoiceReply(manager);

    expect(result).toEqual({ text: "Partial realtime answer" });
    expect(agentCommandMock).not.toHaveBeenCalled();
  });

  it("falls back to the legacy agent path when realtime emits a fallback event after connect", async () => {
    const manager = createManager(
      { groupPolicy: "open", voice: { backend: "realtime" } },
      undefined,
      { commands: { useAccessGroups: false } },
    );
    const closeMock = vi.fn(async () => undefined);
    createManagedRealtimeConversationRuntimeMock.mockImplementation(
      () =>
        createRealtimeRuntimeMock({
          close: closeMock,
          onSubmitAudio: async (emit) => {
            emit({
              type: "fallback.changed",
              sessionId: "session-1",
              mode: "fallback",
              reason: "provider_failed",
            });
          },
        }) as never,
    );

    await processVoiceSegment(manager, "u-guest");

    expect(agentCommandMock).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(closeMock).toHaveBeenCalledWith("fallback");
    });
  });

  it("persists completed realtime turns into the shared session transcript", async () => {
    const manager = createManager(
      { groupPolicy: "open", voice: { backend: "realtime" } },
      undefined,
      { commands: { useAccessGroups: false } },
    );
    createManagedRealtimeConversationRuntimeMock.mockImplementation(
      () =>
        createRealtimeRuntimeMock({
          onSubmitAudio: async (emit) => {
            emit({
              type: "transcript.updated",
              sessionId: "session-1",
              item: { role: "user", status: "final", text: "hello there" },
            });
            emit({
              type: "transcript.updated",
              sessionId: "session-1",
              item: { role: "assistant", status: "final", text: "General Kenobi" },
            });
            emit({
              type: "assistant.turn.updated",
              sessionId: "session-1",
              turn: { state: "completed", turnId: "resp-1" },
            });
          },
        }) as never,
    );

    const { entry, result } = await invokeGenerateVoiceReply(manager);

    expect(result.text).toBe("General Kenobi");
    expect(appendTextMessagesToSessionTranscriptMock).toHaveBeenCalledWith({
      agentId: "agent-1",
      sessionKey: "discord:g1:1001",
      assistantModel: "realtime-voice",
      messages: [
        {
          role: "user",
          text: "u-guest: hello there",
          idempotencyKey: buildRealtimeTranscriptIdempotencyKey("resp-1", "user"),
        },
        {
          role: "assistant",
          text: "General Kenobi",
          idempotencyKey: buildRealtimeTranscriptIdempotencyKey("resp-1", "assistant"),
        },
      ],
    });
    expect(entry.realtimeReplayHistory).toEqual([]);
  });

  it("keeps realtime replay history when transcript persistence fails", async () => {
    const manager = createManager(
      { groupPolicy: "open", voice: { backend: "realtime" } },
      undefined,
      { commands: { useAccessGroups: false } },
    );
    appendTextMessagesToSessionTranscriptMock.mockResolvedValue({
      ok: false,
      reason: "disk sad",
    });
    createManagedRealtimeConversationRuntimeMock.mockImplementation(
      () =>
        createRealtimeRuntimeMock({
          onSubmitAudio: async (emit) => {
            emit({
              type: "transcript.updated",
              sessionId: "session-1",
              item: { role: "user", status: "final", text: "hello there" },
            });
            emit({
              type: "transcript.updated",
              sessionId: "session-1",
              item: { role: "assistant", status: "final", text: "General Kenobi" },
            });
            emit({
              type: "assistant.turn.updated",
              sessionId: "session-1",
              turn: { state: "completed", turnId: "resp-1" },
            });
          },
        }) as never,
    );

    const { entry } = await invokeGenerateVoiceReply(manager);

    expect(entry.realtimeReplayHistory).toEqual([
      {
        role: "user",
        text: "u-guest: hello there",
        idempotencyKey: buildRealtimeTranscriptIdempotencyKey("resp-1", "user"),
      },
      {
        role: "assistant",
        text: "General Kenobi",
        idempotencyKey: buildRealtimeTranscriptIdempotencyKey("resp-1", "assistant"),
      },
    ]);
  });

  it("keeps realtime replay history when transcript persistence throws", async () => {
    const manager = createManager(
      { groupPolicy: "open", voice: { backend: "realtime" } },
      undefined,
      { commands: { useAccessGroups: false } },
    );
    appendTextMessagesToSessionTranscriptMock.mockRejectedValue(new Error("boom"));
    createManagedRealtimeConversationRuntimeMock.mockImplementation(
      () =>
        createRealtimeRuntimeMock({
          onSubmitAudio: async (emit) => {
            emit({
              type: "transcript.updated",
              sessionId: "session-1",
              item: { role: "user", status: "final", text: "hello there" },
            });
            emit({
              type: "transcript.updated",
              sessionId: "session-1",
              item: { role: "assistant", status: "final", text: "General Kenobi" },
            });
            emit({
              type: "assistant.turn.updated",
              sessionId: "session-1",
              turn: { state: "completed", turnId: "resp-1" },
            });
          },
        }) as never,
    );

    const { entry } = await invokeGenerateVoiceReply(manager);

    expect(entry.realtimeReplayHistory).toEqual([
      {
        role: "user",
        text: "u-guest: hello there",
        idempotencyKey: buildRealtimeTranscriptIdempotencyKey("resp-1", "user"),
      },
      {
        role: "assistant",
        text: "General Kenobi",
        idempotencyKey: buildRealtimeTranscriptIdempotencyKey("resp-1", "assistant"),
      },
    ]);
  });

  it("reuses a stable local turn id when the provider never sends turnId", async () => {
    const manager = createManager(
      { groupPolicy: "open", voice: { backend: "realtime" } },
      undefined,
      { commands: { useAccessGroups: false } },
    );
    appendTextMessagesToSessionTranscriptMock.mockRejectedValue(new Error("boom"));
    createManagedRealtimeConversationRuntimeMock.mockImplementation(
      () =>
        createRealtimeRuntimeMock({
          onSubmitAudio: async (emit) => {
            emit({
              type: "transcript.updated",
              sessionId: "session-1",
              item: { role: "user", status: "final", text: "hello there" },
            });
            emit({
              type: "transcript.updated",
              sessionId: "session-1",
              item: { role: "assistant", status: "final", text: "General Kenobi" },
            });
            emit({
              type: "assistant.turn.updated",
              sessionId: "session-1",
              turn: { state: "completed" },
            });
          },
        }) as never,
    );

    const { entry } = await invokeGenerateVoiceReply(manager);

    expect(entry.realtimeReplayHistory).toHaveLength(2);
    const [userItem, assistantItem] = entry.realtimeReplayHistory as Array<{
      role: "user" | "assistant";
      text: string;
      idempotencyKey: string;
    }>;
    expect(userItem).toMatchObject({
      role: "user",
      text: "u-guest: hello there",
    });
    expect(assistantItem).toMatchObject({
      role: "assistant",
      text: "General Kenobi",
    });
    expect(userItem?.idempotencyKey).toMatch(/^discord-voice:discord:g1:1001:local-[^:]+:user$/);
    expect(assistantItem?.idempotencyKey).toMatch(
      /^discord-voice:discord:g1:1001:local-[^:]+:assistant$/,
    );
    expect(userItem?.idempotencyKey?.replace(/:user$/, "")).toBe(
      assistantItem?.idempotencyKey?.replace(/:assistant$/, ""),
    );
  });

  it("returns text-only when writing realtime audio output fails", async () => {
    const manager = createManager(
      { groupPolicy: "open", voice: { backend: "realtime" } },
      undefined,
      { commands: { useAccessGroups: false } },
    );
    const mkdtempSpy = vi.spyOn(fs, "mkdtemp").mockRejectedValue(new Error("disk sad"));
    createManagedRealtimeConversationRuntimeMock.mockImplementation(
      () =>
        createRealtimeRuntimeMock({
          onSubmitAudio: async (emit) => {
            emit({
              type: "transcript.updated",
              sessionId: "session-1",
              item: { role: "assistant", status: "final", text: "General Kenobi" },
            });
            emit({
              type: "audio.output",
              sessionId: "session-1",
              audio: {
                itemId: "assistant-1",
                chunk: Buffer.from([0, 1, 2, 3]),
                sampleRate: 24000,
                mimeType: "audio/pcm;rate=24000",
              },
            });
            emit({
              type: "assistant.turn.updated",
              sessionId: "session-1",
              turn: { state: "completed", turnId: "resp-1" },
            });
          },
        }) as never,
    );

    const { result } = await invokeGenerateVoiceReply(manager);

    expect(result).toEqual({ text: "General Kenobi" });
    mkdtempSpy.mockRestore();
  });

  it("treats interrupted empty realtime turns as superseded instead of empty replies", async () => {
    const manager = createManager(
      { groupPolicy: "open", voice: { backend: "realtime" } },
      undefined,
      { commands: { useAccessGroups: false } },
    );
    const closeMock = vi.fn(async () => undefined);
    createManagedRealtimeConversationRuntimeMock.mockImplementation(
      () =>
        createRealtimeRuntimeMock({
          close: closeMock,
          onSubmitAudio: async (emit) => {
            emit({
              type: "assistant.turn.updated",
              sessionId: "session-1",
              turn: { state: "interrupted", turnId: "resp-1" },
            });
          },
        }) as never,
    );

    const { result } = await invokeGenerateVoiceReply(manager);

    expect(result).toEqual({ text: "", superseded: true });
    expect(closeMock).not.toHaveBeenCalled();
  });

  it("falls back to the legacy agent path when realtime emits a session error after connect", async () => {
    const manager = createManager(
      { groupPolicy: "open", voice: { backend: "realtime" } },
      undefined,
      { commands: { useAccessGroups: false } },
    );
    const closeMock = vi.fn(async () => undefined);
    createManagedRealtimeConversationRuntimeMock.mockImplementation(() => {
      let listener: ((event: { type: string; [key: string]: unknown }) => void) | undefined;
      return {
        start: vi.fn(async () => undefined),
        close: closeMock,
        interrupt: vi.fn(async () => undefined),
        submitText: vi.fn(async () => undefined),
        submitAudio: vi.fn(async () => {
          listener?.({
            type: "session.error",
            sessionId: "session-1",
            code: "provider_failed",
            message: "boom",
          });
        }),
        subscribe: vi.fn((next: (event: { type: string; [key: string]: unknown }) => void) => {
          listener = next;
          return () => {
            listener = undefined;
          };
        }),
        listTools: vi.fn(() => []),
      } as never;
    });

    await processVoiceSegment(manager, "u-guest");

    expect(agentCommandMock).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(closeMock).toHaveBeenCalledWith("session error");
    });
  });

  it("keeps partial realtime output when a session error lands after assistant output", async () => {
    const manager = createManager(
      { groupPolicy: "open", voice: { backend: "realtime" } },
      undefined,
      { commands: { useAccessGroups: false } },
    );
    const closeMock = vi.fn(async () => undefined);
    createManagedRealtimeConversationRuntimeMock.mockImplementation(() => {
      let listener: ((event: { type: string; [key: string]: unknown }) => void) | undefined;
      return {
        start: vi.fn(async () => undefined),
        close: closeMock,
        interrupt: vi.fn(async () => undefined),
        submitText: vi.fn(async () => undefined),
        submitAudio: vi.fn(async () => {
          listener?.({
            type: "transcript.updated",
            sessionId: "session-1",
            item: { role: "assistant", status: "final", text: "Partial realtime answer" },
          });
          listener?.({
            type: "session.error",
            sessionId: "session-1",
            code: "provider_failed",
            message: "boom",
          });
        }),
        subscribe: vi.fn((next: (event: { type: string; [key: string]: unknown }) => void) => {
          listener = next;
          return () => {
            listener = undefined;
          };
        }),
        listTools: vi.fn(() => []),
      } as never;
    });

    const { result } = await invokeGenerateVoiceReply(manager);

    expect(result).toEqual({ text: "Partial realtime answer" });
    expect(agentCommandMock).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(closeMock).toHaveBeenCalledWith("session error");
    });
  });

  it("does not fall back to legacy when reconnect startup fails after a prior realtime connection", async () => {
    const manager = createManager(
      { groupPolicy: "open", voice: { backend: "realtime" } },
      undefined,
      { commands: { useAccessGroups: false } },
    );

    const result = await (
      manager as unknown as {
        generateVoiceReply: (params: {
          entry: unknown;
          wavPath: string;
          pcm: Buffer;
          senderLabel: string;
          senderIsOwner: boolean;
        }) => Promise<{ text: string; audioPath?: string }>;
      }
    ).generateVoiceReply({
      entry: {
        guildId: "g1",
        channelId: "1001",
        route: { sessionKey: "discord:g1:1001", agentId: "agent-1" },
        player: createAudioPlayerMock(),
        playbackQueue: Promise.resolve(),
        realtimeDisabled: false,
        realtimeConnectedOnce: true,
        realtimeEpoch: 1,
      },
      wavPath: "/tmp/test.wav",
      pcm: Buffer.alloc(1920),
      senderLabel: "u-guest",
      senderIsOwner: false,
    });

    expect(result.text).toBe("");
    expect(agentCommandMock).not.toHaveBeenCalled();
  });

  it("smokes the realtime reply loop with a session-backed runtime", async () => {
    const manager = createManager(
      { groupPolicy: "open", voice: { backend: "realtime" } },
      undefined,
      { commands: { useAccessGroups: false } },
    );
    const sessionBacked = createSessionBackedRealtimeRuntime();
    createManagedRealtimeConversationRuntimeMock.mockImplementation(
      () => sessionBacked.runtime as never,
    );

    const result = await (
      manager as unknown as {
        generateVoiceReply: (params: {
          entry: unknown;
          wavPath: string;
          pcm: Buffer;
          senderLabel: string;
          senderIsOwner: boolean;
        }) => Promise<{ text: string; audioPath?: string }>;
      }
    ).generateVoiceReply({
      entry: {
        guildId: "g1",
        channelId: "1001",
        route: { sessionKey: "discord:g1:1001", agentId: "agent-1" },
        player: createAudioPlayerMock(),
        playbackQueue: Promise.resolve(),
        realtimeDisabled: false,
        realtimeConnectedOnce: false,
        realtimeEpoch: 1,
      },
      wavPath: "/tmp/test.wav",
      pcm: Buffer.alloc(1920),
      senderLabel: "u-guest",
      senderIsOwner: false,
    });

    expect(result.text).toBe("Realtime hello");
    expect(result.audioPath).toBeTruthy();
    expect(sessionBacked.adapter.sentTexts).toEqual([]);
    expect(sessionBacked.adapter.sentAudios).toHaveLength(1);
  });

  it("replays completed realtime turns when a later glitch recreates the runtime", async () => {
    const manager = createManager(
      { groupPolicy: "open", voice: { backend: "realtime" } },
      undefined,
      { commands: { useAccessGroups: false } },
    );
    let recreatedOptions: Record<string, unknown> | undefined;
    let firstRuntimeListener:
      | ((event: { type: string; [key: string]: unknown }) => void)
      | undefined;
    let firstRuntimeSubmissions = 0;
    const firstRuntimeClose = vi.fn(async () => undefined);
    const firstRuntime = {
      start: vi.fn(async () => undefined),
      close: firstRuntimeClose,
      interrupt: vi.fn(async () => undefined),
      submitText: vi.fn(async () => undefined),
      submitAudio: vi.fn(async () => {
        firstRuntimeSubmissions += 1;
        if (firstRuntimeSubmissions === 1) {
          firstRuntimeListener?.({
            type: "transcript.updated",
            sessionId: "session-1",
            item: {
              itemId: "user-1",
              role: "user",
              status: "final",
              text: "First question",
              revision: 1,
            },
          });
          firstRuntimeListener?.({
            type: "transcript.updated",
            sessionId: "session-1",
            item: {
              itemId: "assistant-1",
              role: "assistant",
              status: "final",
              text: "First answer",
              revision: 1,
            },
          });
          firstRuntimeListener?.({
            type: "audio.output",
            sessionId: "session-1",
            audio: {
              itemId: "assistant-1",
              chunk: Buffer.from([0, 1, 2, 3]),
              sampleRate: 24000,
              mimeType: "audio/pcm;rate=24000",
            },
          });
          firstRuntimeListener?.({
            type: "assistant.turn.updated",
            sessionId: "session-1",
            turn: { state: "completed", turnId: "resp-1" },
          });
          return;
        }
        firstRuntimeListener?.({
          type: "session.error",
          sessionId: "session-1",
          code: "provider_failed",
          message: "socket boom",
        });
      }),
      subscribe: vi.fn((next: (event: { type: string; [key: string]: unknown }) => void) => {
        firstRuntimeListener = next;
        return () => {
          firstRuntimeListener = undefined;
        };
      }),
      listTools: vi.fn(() => []),
    };
    let secondRuntimeListener:
      | ((event: { type: string; [key: string]: unknown }) => void)
      | undefined;
    const secondRuntime = {
      start: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      interrupt: vi.fn(async () => undefined),
      submitText: vi.fn(async () => undefined),
      submitAudio: vi.fn(async () => {
        secondRuntimeListener?.({
          type: "transcript.updated",
          sessionId: "session-2",
          item: {
            itemId: "assistant-2",
            role: "assistant",
            status: "final",
            text: "Recovered answer",
            revision: 1,
          },
        });
        secondRuntimeListener?.({
          type: "audio.output",
          sessionId: "session-2",
          audio: {
            itemId: "assistant-2",
            chunk: Buffer.from([4, 5, 6, 7]),
            sampleRate: 24000,
            mimeType: "audio/pcm;rate=24000",
          },
        });
        secondRuntimeListener?.({
          type: "assistant.turn.updated",
          sessionId: "session-2",
          turn: { state: "completed", turnId: "resp-2" },
        });
      }),
      subscribe: vi.fn((next: (event: { type: string; [key: string]: unknown }) => void) => {
        secondRuntimeListener = next;
        return () => {
          secondRuntimeListener = undefined;
        };
      }),
      listTools: vi.fn(() => []),
    };
    createManagedRealtimeConversationRuntimeMock
      .mockImplementationOnce(() => firstRuntime as never)
      .mockImplementationOnce(() => {
        recreatedOptions = (
          createManagedRealtimeConversationRuntimeMock.mock.calls as unknown as Array<
            [Record<string, unknown>]
          >
        )[1]?.[0];
        return secondRuntime as never;
      });

    const entry = {
      guildId: "g1",
      channelId: "1001",
      route: { sessionKey: "discord:g1:1001", agentId: "agent-1" },
      player: createAudioPlayerMock(),
      playbackQueue: Promise.resolve(),
      realtimeDisabled: false,
      realtimeConnectedOnce: false,
      realtimeEpoch: 1,
      realtimeReplayHistory: [],
    };

    const generateRealtimeReply = (
      manager as unknown as {
        generateRealtimeReply: (params: {
          entry: typeof entry;
          pcm: Buffer;
          senderLabel: string;
          senderIsOwner: boolean;
        }) => Promise<{ text: string; audioPath?: string; fallbackToLegacy?: boolean }>;
      }
    ).generateRealtimeReply.bind(manager);

    appendTextMessagesToSessionTranscriptMock.mockResolvedValueOnce({
      ok: false,
      reason: "disk sad",
    });

    const firstResult = await generateRealtimeReply({
      entry,
      pcm: Buffer.alloc(1920),
      senderLabel: "u-guest",
      senderIsOwner: false,
    });

    expect(firstResult.text).toBe("First answer");
    expect(entry.realtimeReplayHistory).toEqual([
      {
        role: "user",
        text: "u-guest: First question",
        idempotencyKey: buildRealtimeTranscriptIdempotencyKey("resp-1", "user"),
      },
      {
        role: "assistant",
        text: "First answer",
        idempotencyKey: buildRealtimeTranscriptIdempotencyKey("resp-1", "assistant"),
      },
    ]);

    const secondResult = await generateRealtimeReply({
      entry,
      pcm: Buffer.alloc(1920),
      senderLabel: "u-guest",
      senderIsOwner: false,
    });

    expect(secondResult.fallbackToLegacy).toBe(true);
    expect(firstRuntimeClose).toHaveBeenCalledWith("session error");

    const thirdResult = await generateRealtimeReply({
      entry,
      pcm: Buffer.alloc(1920),
      senderLabel: "u-guest",
      senderIsOwner: false,
    });

    expect(recreatedOptions?.historyOverlay).toEqual([
      { role: "user", text: "u-guest: First question" },
      { role: "assistant", text: "First answer" },
    ]);
    expect(thirdResult.text).toBe("Recovered answer");
  });

  it("waits for post-tool realtime continuation instead of falling back early", async () => {
    const manager = createManager(
      { groupPolicy: "open", voice: { backend: "realtime" } },
      undefined,
      { commands: { useAccessGroups: false } },
    );
    createManagedRealtimeConversationRuntimeMock.mockImplementation(() => {
      let listener: ((event: { type: string; [key: string]: unknown }) => void) | undefined;
      return {
        start: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
        interrupt: vi.fn(async () => undefined),
        submitText: vi.fn(async () => undefined),
        submitAudio: vi.fn(async () => {
          listener?.({
            type: "tool.updated",
            sessionId: "session-1",
            update: {
              toolCallId: "call-1",
              toolName: "read",
              status: "running",
            },
          });
          listener?.({
            type: "assistant.turn.updated",
            sessionId: "session-1",
            turn: { state: "completed", turnId: "resp-1" },
          });
          queueMicrotask(() => {
            listener?.({
              type: "tool.updated",
              sessionId: "session-1",
              update: {
                toolCallId: "call-1",
                toolName: "read",
                status: "completed",
              },
            });
            listener?.({
              type: "transcript.updated",
              sessionId: "session-1",
              item: {
                itemId: "assistant-1",
                role: "assistant",
                status: "final",
                text: "Tool continuation reply",
                revision: 1,
              },
            });
            listener?.({
              type: "audio.output",
              sessionId: "session-1",
              audio: {
                itemId: "assistant-1",
                chunk: Buffer.from([1, 2, 3, 4]),
                sampleRate: 24000,
                mimeType: "audio/pcm;rate=24000",
              },
            });
            listener?.({
              type: "assistant.turn.updated",
              sessionId: "session-1",
              turn: { state: "completed", turnId: "resp-2" },
            });
          });
        }),
        subscribe: vi.fn((next: (event: { type: string; [key: string]: unknown }) => void) => {
          listener = next;
          return () => {
            listener = undefined;
          };
        }),
        listTools: vi.fn(() => []),
      } as never;
    });

    const result = await (
      manager as unknown as {
        generateVoiceReply: (params: {
          entry: unknown;
          wavPath: string;
          pcm: Buffer;
          senderLabel: string;
          senderIsOwner: boolean;
        }) => Promise<{ text: string; audioPath?: string }>;
      }
    ).generateVoiceReply({
      entry: {
        guildId: "g1",
        channelId: "1001",
        route: { sessionKey: "discord:g1:1001", agentId: "agent-1" },
        player: createAudioPlayerMock(),
        playbackQueue: Promise.resolve(),
        realtimeDisabled: false,
        realtimeConnectedOnce: false,
        realtimeEpoch: 1,
      },
      wavPath: "/tmp/test.wav",
      pcm: Buffer.alloc(1920),
      senderLabel: "u-guest",
      senderIsOwner: false,
    });

    expect(result.text).toBe("Tool continuation reply");
    expect(result.audioPath).toBeTruthy();
    expect(agentCommandMock).not.toHaveBeenCalled();
  });

  it("does not interrupt assistant playback for empty Discord captures", async () => {
    const manager = createManager();
    const connection = createConnectionMock();
    const player = createAudioPlayerMock();
    player.state.status = "playing";
    const interruptMock = vi.fn(async () => undefined);

    await (
      manager as unknown as {
        handleSpeakingStart: (entry: unknown, userId: string) => Promise<void>;
      }
    ).handleSpeakingStart(
      {
        guildId: "g1",
        channelId: "1001",
        connection,
        player,
        activeSpeakers: new Set<string>(),
        realtime: { interrupt: interruptMock },
      },
      "u-guest",
    );

    expect(interruptMock).not.toHaveBeenCalled();
    expect(player.stop).not.toHaveBeenCalled();
  });

  it("passes senderIsOwner=true for allowlisted voice speakers", async () => {
    const client = createClient();
    client.fetchMember.mockResolvedValue({
      nickname: "Owner Nick",
      user: {
        id: "u-owner",
        username: "owner",
        globalName: "Owner",
        discriminator: "1234",
      },
    });
    const manager = createManager({ groupPolicy: "open", allowFrom: ["discord:u-owner"] }, client);
    await processVoiceSegment(manager, "u-owner");

    const commandArgs = agentCommandMock.mock.calls.at(-1)?.[0] as
      | { senderIsOwner?: boolean }
      | undefined;
    expect(commandArgs?.senderIsOwner).toBe(true);
  });

  it("passes senderIsOwner=false for non-owner voice speakers", async () => {
    const client = createClient();
    client.fetchMember.mockResolvedValue({
      nickname: "Guest Nick",
      user: {
        id: "u-guest",
        username: "guest",
        globalName: "Guest",
        discriminator: "4321",
      },
    });
    const manager = createManager({ groupPolicy: "open", allowFrom: ["discord:u-owner"] }, client, {
      commands: { useAccessGroups: false },
    });
    await processVoiceSegment(manager, "u-guest");

    const commandArgs = agentCommandMock.mock.calls.at(-1)?.[0] as
      | { senderIsOwner?: boolean }
      | undefined;
    expect(commandArgs?.senderIsOwner).toBe(false);
  });

  it("reuses speaker context cache for repeated segments from the same speaker", async () => {
    const client = createClient();
    client.fetchMember.mockResolvedValue({
      nickname: "Cached Speaker",
      user: {
        id: "u-cache",
        username: "cache",
        globalName: "Cache",
        discriminator: "1111",
      },
    });
    const manager = createManager({ allowFrom: ["discord:u-cache"] }, client);
    const runSegment = async () => await processVoiceSegment(manager, "u-cache");

    await runSegment();
    await runSegment();

    expect(client.fetchMember).toHaveBeenCalledTimes(1);
  });

  it("re-fetches member roles for repeated voice auth checks", async () => {
    const client = createClient();
    client.fetchMember
      .mockResolvedValueOnce({
        nickname: "Role Speaker",
        roles: ["role-voice"],
        user: {
          id: "u-role",
          username: "role",
          globalName: "Role",
          discriminator: "2222",
        },
      })
      .mockResolvedValueOnce({
        nickname: "Role Speaker",
        roles: [],
        user: {
          id: "u-role",
          username: "role",
          globalName: "Role",
          discriminator: "2222",
        },
      })
      .mockResolvedValue({
        nickname: "Role Speaker",
        roles: [],
        user: {
          id: "u-role",
          username: "role",
          globalName: "Role",
          discriminator: "2222",
        },
      });
    const manager = createManager(
      {
        groupPolicy: "allowlist",
        guilds: {
          g1: {
            channels: {
              "1001": {
                roles: ["role:role-voice"],
              },
            },
          },
        },
      },
      client,
    );

    await processVoiceSegment(manager, "u-role");
    await processVoiceSegment(manager, "u-role");

    expect(agentCommandMock).toHaveBeenCalledTimes(1);
    expect(client.fetchMember).toHaveBeenCalledTimes(2);
  });

  it("fetches guild metadata before allowlist checks when the session lacks a guild name", async () => {
    const client = createClient();
    client.fetchGuild.mockResolvedValue({ id: "g1", name: "Guild One" });
    client.fetchMember.mockResolvedValue({
      nickname: "Owner Nick",
      user: {
        id: "u-owner",
        username: "owner",
        globalName: "Owner",
        discriminator: "1234",
      },
    });
    const manager = createManager(
      {
        groupPolicy: "allowlist",
        guilds: {
          "guild-one": {
            channels: {
              "*": {
                users: ["discord:u-owner"],
              },
            },
          },
        },
      },
      client,
    );

    await processVoiceSegment(manager, "u-owner");

    expect(client.fetchGuild).toHaveBeenCalledWith("g1");
    expect(agentCommandMock).toHaveBeenCalledTimes(1);
  });

  it("DiscordVoiceReadyListener: propagates autoJoin errors fire-and-forget without throwing", async () => {
    const manager = createManager();
    vi.spyOn(manager, "autoJoin").mockRejectedValue(new Error("autoJoin rejected"));

    const { DiscordVoiceReadyListener } = managerModule;
    const listener = new DiscordVoiceReadyListener(manager);

    await expect(listener.handle(undefined, undefined as never)).resolves.not.toThrow();
    expect(manager.autoJoin).toHaveBeenCalledTimes(1);
  });
});
