import { Readable } from "node:stream";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-types";
import type {
  RealtimeVoiceBridge,
  RealtimeVoiceProviderPlugin,
} from "openclaw/plugin-sdk/realtime-voice";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  agentCommandMock,
  createAudioResourceMock,
  createDiscordRawPcmStreamMock,
  getRealtimeVoiceProviderMock,
  resolveConfiguredRealtimeVoiceProviderMock,
} = vi.hoisted(() => ({
  agentCommandMock: vi.fn(async () => ({ payloads: [{ text: "consult result" }] })),
  createAudioResourceMock: vi.fn(() => ({})),
  createDiscordRawPcmStreamMock: vi.fn(),
  getRealtimeVoiceProviderMock: vi.fn(),
  resolveConfiguredRealtimeVoiceProviderMock: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/agent-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/agent-runtime")>();
  return {
    ...actual,
    agentCommandFromIngress: agentCommandMock,
  };
});

vi.mock("openclaw/plugin-sdk/realtime-voice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/realtime-voice")>();
  return {
    ...actual,
    getRealtimeVoiceProvider: getRealtimeVoiceProviderMock,
    resolveConfiguredRealtimeVoiceProvider: resolveConfiguredRealtimeVoiceProviderMock,
  };
});

vi.mock("./audio.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./audio.js")>();
  return {
    ...actual,
    createDiscordRawPcmStream: createDiscordRawPcmStreamMock,
  };
});

vi.mock("./sdk-runtime.js", () => ({
  loadDiscordVoiceSdk: () => ({
    AudioPlayerStatus: { Idle: "idle" },
    StreamType: { Raw: "raw" },
    createAudioResource: createAudioResourceMock,
  }),
}));

const { resolveDiscordRealtimeProviderSelection } = await import("./realtime.js");

function createWritableTestStream(writeResults: boolean[] = [true]) {
  const handlers = new Map<string, Array<() => void>>();
  const stream = {
    destroyed: false,
    writableLength: 0,
    destroy: vi.fn(() => {
      stream.destroyed = true;
    }),
    once: vi.fn((event: string, handler: () => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return stream;
    }),
    off: vi.fn((event: string, handler: () => void) => {
      handlers.set(
        event,
        (handlers.get(event) ?? []).filter((candidate) => candidate !== handler),
      );
      return stream;
    }),
    write: vi.fn(() => writeResults.shift() ?? true),
  };
  return {
    stream,
    emitDrain: () => {
      const drainHandlers = handlers.get("drain") ?? [];
      handlers.set("drain", []);
      for (const handler of drainHandlers) {
        handler();
      }
    },
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForCondition(predicate: () => boolean) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 1_000) {
      throw new Error("condition was not met");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function resetRealtimeVoiceMocks() {
  agentCommandMock.mockClear();
  createAudioResourceMock.mockClear();
  createDiscordRawPcmStreamMock.mockReset();
  createDiscordRawPcmStreamMock.mockImplementation(() => createWritableTestStream().stream);
  getRealtimeVoiceProviderMock.mockReset();
  resolveConfiguredRealtimeVoiceProviderMock.mockReset();
  resolveConfiguredRealtimeVoiceProviderMock.mockImplementation(
    (params: { configuredProviderId?: string; providerConfigs?: Record<string, unknown> }) => {
      const id = params.configuredProviderId ?? "";
      const provider = getRealtimeVoiceProviderMock(id);
      if (!provider) {
        throw new Error("No realtime voice provider registered");
      }
      return {
        provider,
        providerConfig: params.providerConfigs?.[id] ?? {},
      };
    },
  );
}

function realtimeProvider(id: string): RealtimeVoiceProviderPlugin {
  return {
    id,
    label: id,
    isConfigured: () => true,
    createBridge: () => realtimeBridge(),
  };
}

function realtimeBridge(): RealtimeVoiceBridge {
  return {
    connect: async () => {},
    sendAudio: () => {},
    setMediaTimestamp: () => {},
    submitToolResult: () => {},
    acknowledgeMark: () => {},
    close: () => {},
    isConnected: () => true,
  };
}

function baseConfig(): OpenClawConfig {
  return {
    talk: {
      provider: "elevenlabs",
      providers: {
        elevenlabs: { apiKey: "tts-key" },
      },
    },
    plugins: {
      entries: {
        "voice-call": {
          config: {
            realtime: {
              provider: "google",
              providers: {
                google: { apiKey: "gemini-key" },
              },
            },
          },
        },
      },
    },
  } as OpenClawConfig;
}

describe("resolveDiscordRealtimeProviderSelection", () => {
  beforeEach(() => {
    resetRealtimeVoiceMocks();
  });

  it("falls back to voice-call realtime when talk provider is not realtime-capable", () => {
    getRealtimeVoiceProviderMock.mockReturnValue(undefined);

    const selection = resolveDiscordRealtimeProviderSelection(baseConfig());

    expect(selection.provider).toBe("google");
    expect(selection.providers).toEqual({
      google: { apiKey: "gemini-key" },
      elevenlabs: { apiKey: "tts-key" },
    });
  });

  it("uses talk provider when it is realtime-capable", () => {
    getRealtimeVoiceProviderMock.mockReturnValue(realtimeProvider("google"));
    const cfg = {
      ...baseConfig(),
      talk: {
        provider: "google",
        providers: {
          google: { apiKey: "talk-realtime-key" },
        },
      },
    } as OpenClawConfig;

    const selection = resolveDiscordRealtimeProviderSelection(cfg);

    expect(selection.provider).toBe("google");
    expect(selection.providers).toEqual({
      google: { apiKey: "talk-realtime-key" },
    });
  });

  it("lets Discord realtime provider override shared Talk and voice-call defaults", () => {
    getRealtimeVoiceProviderMock.mockReturnValue(undefined);

    const selection = resolveDiscordRealtimeProviderSelection(baseConfig(), {
      enabled: true,
      provider: "openai",
    });

    expect(selection.provider).toBe("openai");
  });
});

describe("DiscordRealtimeVoiceBridgeController", () => {
  beforeEach(() => {
    resetRealtimeVoiceMocks();
  });

  it("enables realtime Discord voice by default", async () => {
    const { DiscordRealtimeVoiceBridgeController } = await import("./realtime.js");
    const controller = new DiscordRealtimeVoiceBridgeController({
      cfg: baseConfig(),
      discordConfig: { voice: {} } as never,
      runtime: {} as never,
      ownerAllowFrom: ["*"],
      speakerContext: {} as never,
      fetchGuildName: async () => undefined,
    });

    expect(controller.isEnabled()).toBe(true);
  });

  it("allows explicit fallback to batch voice mode", async () => {
    const { DiscordRealtimeVoiceBridgeController } = await import("./realtime.js");
    const controller = new DiscordRealtimeVoiceBridgeController({
      cfg: baseConfig(),
      discordConfig: { voice: { realtime: { enabled: false } } } as never,
      runtime: {} as never,
      ownerAllowFrom: ["*"],
      speakerContext: {} as never,
      fetchGuildName: async () => undefined,
    });

    expect(controller.isEnabled()).toBe(false);
  });

  it("keeps realtime enabled when Discord overrides provider only", async () => {
    const { DiscordRealtimeVoiceBridgeController } = await import("./realtime.js");
    const controller = new DiscordRealtimeVoiceBridgeController({
      cfg: baseConfig(),
      discordConfig: { voice: { realtime: { provider: "openai" } } } as never,
      runtime: {} as never,
      ownerAllowFrom: [],
      speakerContext: {} as never,
      fetchGuildName: async () => undefined,
    });

    expect(controller.isEnabled()).toBe(true);
  });

  it("restarts the Discord raw stream when provider audio arrives after the player idles", async () => {
    let bridgeRequest: Parameters<RealtimeVoiceProviderPlugin["createBridge"]>[0] | undefined;
    const bridge = realtimeBridge();
    const provider = realtimeProvider("google");
    provider.createBridge = (request) => {
      bridgeRequest = request;
      return bridge;
    };
    getRealtimeVoiceProviderMock.mockImplementation((providerId: string) =>
      providerId === "google" ? provider : undefined,
    );

    const { DiscordRealtimeVoiceBridgeController } = await import("./realtime.js");
    const controller = new DiscordRealtimeVoiceBridgeController({
      cfg: baseConfig(),
      discordConfig: { voice: {} } as never,
      runtime: {} as never,
      ownerAllowFrom: [],
      speakerContext: {} as never,
      fetchGuildName: async () => undefined,
    });
    const player = {
      play: vi.fn(() => {
        player.state.status = "buffering";
      }),
      state: { status: "idle" },
    };

    await (
      controller as unknown as {
        ensureSession: (entry: unknown, userId: string, ingress: unknown) => Promise<unknown>;
      }
    ).ensureSession(
      {
        guildId: "g1",
        channelId: "1001",
        route: { agentId: "agent-1", sessionKey: "discord:g1:1001" },
        player,
      },
      "u1",
      { senderIsOwner: true },
    );

    expect(player.play).toHaveBeenCalledTimes(1);
    player.state.status = "idle";
    expect(bridgeRequest).toBeDefined();
    bridgeRequest?.onAudio(Buffer.from([1, 0]));

    expect(player.play).toHaveBeenCalledTimes(2);
    expect(createAudioResourceMock).toHaveBeenCalledTimes(2);
  });

  it("waits for Discord raw stream drain before writing the next provider audio chunk", async () => {
    let bridgeRequest: Parameters<RealtimeVoiceProviderPlugin["createBridge"]>[0] | undefined;
    const bridge = realtimeBridge();
    const provider = realtimeProvider("google");
    provider.createBridge = (request) => {
      bridgeRequest = request;
      return bridge;
    };
    getRealtimeVoiceProviderMock.mockImplementation((providerId: string) =>
      providerId === "google" ? provider : undefined,
    );
    const writable = createWritableTestStream([false, true]);
    createDiscordRawPcmStreamMock.mockReturnValue(writable.stream);

    const { DiscordRealtimeVoiceBridgeController } = await import("./realtime.js");
    const controller = new DiscordRealtimeVoiceBridgeController({
      cfg: baseConfig(),
      discordConfig: { voice: {} } as never,
      runtime: {} as never,
      ownerAllowFrom: [],
      speakerContext: {} as never,
      fetchGuildName: async () => undefined,
    });
    const player = {
      play: vi.fn(() => {
        player.state.status = "buffering";
      }),
      state: { status: "idle" },
    };

    await (
      controller as unknown as {
        ensureSession: (entry: unknown, userId: string, ingress: unknown) => Promise<unknown>;
      }
    ).ensureSession(
      {
        guildId: "g1",
        channelId: "1001",
        route: { agentId: "agent-1", sessionKey: "discord:g1:1001" },
        player,
      },
      "u1",
      { senderIsOwner: true },
    );

    expect(bridgeRequest).toBeDefined();
    bridgeRequest?.onAudio(Buffer.from([1, 0]));
    bridgeRequest?.onAudio(Buffer.from([2, 0]));
    await flushMicrotasks();

    expect(writable.stream.write).toHaveBeenCalledTimes(1);
    writable.emitDrain();
    await waitForCondition(() => writable.stream.write.mock.calls.length === 2);
    expect(writable.stream.off).toHaveBeenCalledWith("drain", expect.any(Function));
    expect(writable.stream.off).toHaveBeenCalledWith("close", expect.any(Function));
    expect(writable.stream.off).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("drops queued Discord provider audio when the provider clears playback", async () => {
    let bridgeRequest: Parameters<RealtimeVoiceProviderPlugin["createBridge"]>[0] | undefined;
    const bridge = realtimeBridge();
    const provider = realtimeProvider("google");
    provider.createBridge = (request) => {
      bridgeRequest = request;
      return bridge;
    };
    getRealtimeVoiceProviderMock.mockImplementation((providerId: string) =>
      providerId === "google" ? provider : undefined,
    );
    const first = createWritableTestStream([false, true]);
    const second = createWritableTestStream([true]);
    createDiscordRawPcmStreamMock
      .mockReturnValueOnce(first.stream)
      .mockReturnValueOnce(second.stream);

    const { DiscordRealtimeVoiceBridgeController } = await import("./realtime.js");
    const controller = new DiscordRealtimeVoiceBridgeController({
      cfg: baseConfig(),
      discordConfig: { voice: {} } as never,
      runtime: {} as never,
      ownerAllowFrom: [],
      speakerContext: {} as never,
      fetchGuildName: async () => undefined,
    });
    const player = {
      play: vi.fn(() => {
        player.state.status = "buffering";
      }),
      state: { status: "idle" },
    };

    await (
      controller as unknown as {
        ensureSession: (entry: unknown, userId: string, ingress: unknown) => Promise<unknown>;
      }
    ).ensureSession(
      {
        guildId: "g1",
        channelId: "1001",
        route: { agentId: "agent-1", sessionKey: "discord:g1:1001" },
        player,
      },
      "u1",
      { senderIsOwner: true },
    );

    expect(bridgeRequest).toBeDefined();
    bridgeRequest?.onAudio(Buffer.from([1, 0]));
    bridgeRequest?.onAudio(Buffer.from([2, 0]));
    await flushMicrotasks();
    bridgeRequest?.onClearAudio();
    first.emitDrain();
    bridgeRequest?.onAudio(Buffer.from([3, 0]));
    await waitForCondition(() => second.stream.write.mock.calls.length === 1);

    expect(first.stream.write).toHaveBeenCalledTimes(1);
    expect(first.stream.destroy).toHaveBeenCalled();
    expect(second.stream.write).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable when realtime is enabled but no provider can be resolved", async () => {
    getRealtimeVoiceProviderMock.mockReturnValue(undefined);
    const { DiscordRealtimeVoiceBridgeController } = await import("./realtime.js");
    const controller = new DiscordRealtimeVoiceBridgeController({
      cfg: { channels: { discord: {} } } as OpenClawConfig,
      discordConfig: { allowFrom: ["*"], groupPolicy: "open", voice: {} } as never,
      runtime: {} as never,
      ownerAllowFrom: ["discord:u1"],
      speakerContext: {
        resolveContext: vi.fn(async () => ({ senderIsOwner: false })),
        resolveIdentity: vi.fn(async () => ({
          id: "u1",
          name: "User One",
          tag: "user#0001",
          memberRoleIds: [],
        })),
      } as never,
      fetchGuildName: async () => "Guild One",
    });

    await expect(
      controller.handleSpeakingStream({
        entry: {
          guildId: "g1",
          channelId: "1001",
          channelName: "Voice",
          route: { agentId: "agent-1", sessionKey: "discord:g1:1001" },
        } as never,
        userId: "u1",
        stream: Readable.from([]),
      }),
    ).resolves.toBe("unavailable");
  });

  it("carries Discord voice ingress metadata into realtime agent consult calls", async () => {
    const { DiscordRealtimeVoiceBridgeController } = await import("./realtime.js");
    const controller = new DiscordRealtimeVoiceBridgeController({
      cfg: {} as OpenClawConfig,
      discordConfig: {
        voice: { model: "openai/gpt-5.4-mini" },
      } as never,
      runtime: {} as never,
      speakerContext: {} as never,
      fetchGuildName: async () => "Guild One",
    });
    (
      controller as unknown as {
        active: Map<string, unknown>;
      }
    ).active.set("g1:u1", {
      ingress: {
        extraSystemPrompt: "Keep this channel concise.",
        senderIsOwner: true,
      },
    });
    const session = { submitToolResult: vi.fn() };

    await (
      controller as unknown as {
        handleToolCall: (params: {
          entry: unknown;
          event: unknown;
          session: unknown;
          userId: string;
        }) => Promise<void>;
      }
    ).handleToolCall({
      entry: {
        guildId: "g1",
        channelId: "1001",
        channelName: "Voice",
        route: { agentId: "agent-1", sessionKey: "discord:g1:1001" },
        player: { play: vi.fn() },
      },
      event: {
        itemId: "item-1",
        callId: "call-1",
        name: "openclaw_agent_consult",
        args: { question: "what now" },
      },
      session,
      userId: "u1",
    });

    expect(agentCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowModelOverride: false,
        extraSystemPrompt: "Keep this channel concise.",
        messageChannel: "discord",
        messageProvider: "discord-voice",
        senderIsOwner: true,
        toolsAllow: ["read", "web_search", "web_fetch", "x_search", "memory_search", "memory_get"],
      }),
      expect.anything(),
    );
    expect(agentCommandMock.mock.calls[0]?.[0]).not.toHaveProperty("model");
    expect(session.submitToolResult).toHaveBeenCalledWith("call-1", {
      result: "consult result",
    });
  });
});
