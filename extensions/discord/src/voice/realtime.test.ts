import { Readable } from "node:stream";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-types";
import type {
  RealtimeVoiceBridge,
  RealtimeVoiceProviderPlugin,
} from "openclaw/plugin-sdk/realtime-voice";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { agentCommandMock, getRealtimeVoiceProviderMock } = vi.hoisted(() => ({
  agentCommandMock: vi.fn(async () => ({ payloads: [{ text: "consult result" }] })),
  getRealtimeVoiceProviderMock: vi.fn(),
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
  };
});

const { resolveDiscordRealtimeProviderSelection } = await import("./realtime.js");

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
    agentCommandMock.mockClear();
    getRealtimeVoiceProviderMock.mockReset();
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
    agentCommandMock.mockClear();
    getRealtimeVoiceProviderMock.mockReset();
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
