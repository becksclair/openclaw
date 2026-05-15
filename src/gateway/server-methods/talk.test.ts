import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import { normalizeResolvedSecretInputString } from "../../config/types.secrets.js";
import { talkHandlers } from "./talk.js";

const mocks = vi.hoisted(() => ({
  getRuntimeConfig: vi.fn<() => OpenClawConfig>(),
  readConfigFileSnapshot: vi.fn(),
  canonicalizeSpeechProviderId: vi.fn((providerId: string | undefined) => providerId),
  getSpeechProvider: vi.fn(),
  synthesizeSpeech: vi.fn(),
  getRealtimeVoiceProvider: vi.fn(),
  resolveConfiguredRealtimeVoiceProvider: vi.fn(),
  createTalkRealtimeRelaySession: vi.fn(),
  resolveTtsPersonaDeliveryInstructions: vi.fn(),
  resolveRealtimeVoiceInstructionContext: vi.fn(),
  buildRealtimeVoiceInstructions: vi.fn(),
  sendTalkRealtimeRelayUserMessage: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  readConfigFileSnapshot: mocks.readConfigFileSnapshot,
}));

vi.mock("../../tts/provider-registry.js", () => ({
  canonicalizeSpeechProviderId: mocks.canonicalizeSpeechProviderId,
  getSpeechProvider: mocks.getSpeechProvider,
}));

vi.mock("../../tts/tts.js", () => ({
  synthesizeSpeech: mocks.synthesizeSpeech,
}));

vi.mock("../../realtime-voice/provider-registry.js", () => ({
  getRealtimeVoiceProvider: mocks.getRealtimeVoiceProvider,
}));

vi.mock("../../realtime-voice/provider-resolver.js", () => ({
  resolveConfiguredRealtimeVoiceProvider: mocks.resolveConfiguredRealtimeVoiceProvider,
}));

vi.mock("../../tts/realtime-persona-instructions.js", () => ({
  resolveTtsPersonaDeliveryInstructions: mocks.resolveTtsPersonaDeliveryInstructions,
}));

vi.mock("../../realtime-voice/realtime-instructions.js", () => ({
  resolveRealtimeVoiceInstructionContext: mocks.resolveRealtimeVoiceInstructionContext,
  buildRealtimeVoiceInstructions: mocks.buildRealtimeVoiceInstructions,
}));

vi.mock("../talk-realtime-relay.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../talk-realtime-relay.js")>();
  return {
    ...actual,
    createTalkRealtimeRelaySession: mocks.createTalkRealtimeRelaySession,
    sendTalkRealtimeRelayUserMessage: mocks.sendTalkRealtimeRelayUserMessage,
  };
});

function createTalkConfig(apiKey: unknown): OpenClawConfig {
  return {
    talk: {
      provider: "acme",
      providers: {
        acme: {
          apiKey,
          voiceId: "stub-default-voice",
        },
      },
    },
  } as OpenClawConfig;
}

describe("talk.speak handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the active runtime config snapshot instead of the raw config snapshot", async () => {
    const runtimeConfig = createTalkConfig("env-acme-key");
    const diskConfig = createTalkConfig({
      source: "env",
      provider: "default",
      id: "ACME_SPEECH_API_KEY",
    });

    mocks.getRuntimeConfig.mockReturnValue(runtimeConfig);
    mocks.readConfigFileSnapshot.mockResolvedValue({
      path: "/tmp/openclaw.json",
      hash: "test-hash",
      valid: true,
      config: diskConfig,
    });
    mocks.getSpeechProvider.mockReturnValue({
      id: "acme",
      label: "Acme Speech",
      resolveTalkConfig: ({
        talkProviderConfig,
      }: {
        talkProviderConfig: Record<string, unknown>;
      }) => talkProviderConfig,
    });
    mocks.synthesizeSpeech.mockImplementation(
      async ({ cfg }: { cfg: OpenClawConfig; text: string; disableFallback: boolean }) => {
        expect(cfg.messages?.tts?.provider).toBe("acme");
        expect(cfg.messages?.tts?.providers?.acme?.apiKey).toBe("env-acme-key");
        return {
          success: true,
          provider: "acme",
          audioBuffer: Buffer.from([1, 2, 3]),
          outputFormat: "mp3",
          voiceCompatible: false,
          fileExtension: ".mp3",
        };
      },
    );

    const respond = vi.fn();
    await talkHandlers["talk.speak"]({
      req: { type: "req", id: "1", method: "talk.speak" },
      params: { text: "Hello from talk mode." },
      client: null,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: { getRuntimeConfig: () => runtimeConfig } as never,
    });

    expect(mocks.getRuntimeConfig).not.toHaveBeenCalled();
    expect(mocks.readConfigFileSnapshot).not.toHaveBeenCalled();
    expect(mocks.synthesizeSpeech).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Hello from talk mode.",
        disableFallback: true,
      }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        provider: "acme",
        audioBase64: Buffer.from([1, 2, 3]).toString("base64"),
        outputFormat: "mp3",
        mimeType: "audio/mpeg",
        fileExtension: ".mp3",
      }),
      undefined,
    );
  });
});

describe("talk.config handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes runtime-resolved messages.tts provider secrets to strict provider resolvers", async () => {
    const sourceConfig = {
      talk: {
        provider: "acme",
        providers: {
          acme: {
            voiceId: "voice-from-talk-config",
          },
        },
      },
      messages: {
        tts: {
          provider: "acme",
          timeoutMs: 12_345,
          providers: {
            acme: {
              apiKey: { source: "env", provider: "default", id: "ACME_SPEECH_API_KEY" },
            },
          },
        },
      },
    } as OpenClawConfig;
    const runtimeConfig = {
      ...sourceConfig,
      messages: {
        tts: {
          provider: "acme",
          timeoutMs: 54_321,
          providers: {
            acme: {
              apiKey: "env-acme-key",
            },
          },
        },
      },
    } as OpenClawConfig;

    mocks.readConfigFileSnapshot.mockResolvedValue({
      path: "/tmp/openclaw.json",
      hash: "test-hash",
      valid: true,
      config: sourceConfig,
    });
    mocks.getSpeechProvider.mockReturnValue({
      id: "acme",
      label: "Acme Strict Speech",
      resolveTalkConfig: ({
        baseTtsConfig,
        talkProviderConfig,
        timeoutMs,
      }: {
        baseTtsConfig: Record<string, unknown>;
        talkProviderConfig: Record<string, unknown>;
        timeoutMs: number;
      }) => {
        const providers = (baseTtsConfig.providers ?? {}) as Record<string, unknown>;
        const providerConfig = (providers.acme ?? {}) as Record<string, unknown>;
        const apiKey = normalizeResolvedSecretInputString({
          value: providerConfig.apiKey,
          path: "messages.tts.providers.acme.apiKey",
        });
        expect(apiKey).toBe("env-acme-key");
        expect(timeoutMs).toBe(54_321);
        return {
          ...talkProviderConfig,
          ...(apiKey === undefined ? {} : { apiKey }),
        };
      },
    });

    const respond = vi.fn();
    await talkHandlers["talk.config"]({
      req: { type: "req", id: "1", method: "talk.config" },
      params: {},
      client: { connect: { scopes: ["operator.read"] } } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: { getRuntimeConfig: () => runtimeConfig } as never,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      {
        config: {
          talk: expect.objectContaining({
            provider: "acme",
            resolved: {
              provider: "acme",
              config: expect.objectContaining({
                apiKey: "__OPENCLAW_REDACTED__",
              }),
            },
          }),
        },
      },
      undefined,
    );
  });

  it("includes realtime voice metadata when a provider is configured", async () => {
    const runtimeConfig = {
      talk: {
        provider: "google",
        providers: {
          google: {
            apiKey: "gemini-key",
            model: "gemini-live-2.5-flash",
            voice: "Puck",
          },
        },
      },
    } as OpenClawConfig;
    const provider = {
      id: "google",
      label: "Google Live Voice",
      isConfigured: () => true,
      createBridge: vi.fn(),
    };
    mocks.readConfigFileSnapshot.mockResolvedValue({
      path: "/tmp/openclaw.json",
      hash: "test-hash",
      valid: true,
      config: runtimeConfig,
    });
    mocks.getSpeechProvider.mockReturnValue(undefined);
    mocks.resolveConfiguredRealtimeVoiceProvider.mockReturnValue({
      provider,
      providerConfig: {
        apiKey: "gemini-key",
        model: "gemini-live-2.5-flash",
        voice: "Puck",
      },
    });

    const respond = vi.fn();
    await talkHandlers["talk.config"]({
      req: { type: "req", id: "1", method: "talk.config" },
      params: {},
      client: { connect: { scopes: ["operator.read"] } } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: { getRuntimeConfig: () => runtimeConfig } as never,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        config: expect.objectContaining({
          realtime: {
            available: true,
            provider: "google",
            model: "gemini-live-2.5-flash",
            voice: "Puck",
          },
        }),
      }),
      undefined,
    );
  });

  it("omits realtime voice metadata when no provider is configured", async () => {
    const runtimeConfig = {} as OpenClawConfig;
    mocks.readConfigFileSnapshot.mockResolvedValue({
      path: "/tmp/openclaw.json",
      hash: "test-hash",
      valid: true,
      config: runtimeConfig,
    });
    mocks.resolveConfiguredRealtimeVoiceProvider.mockImplementation(() => {
      throw new Error("No realtime voice provider registered");
    });

    const respond = vi.fn();
    await talkHandlers["talk.config"]({
      req: { type: "req", id: "1", method: "talk.config" },
      params: {},
      client: { connect: { scopes: ["operator.read"] } } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: { getRuntimeConfig: () => runtimeConfig } as never,
    });

    const payload = respond.mock.calls[0]?.[1] as { config?: Record<string, unknown> } | undefined;
    expect(payload?.config).not.toHaveProperty("realtime");
  });
});

describe("talk.realtime.session handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveTtsPersonaDeliveryInstructions.mockReturnValue(undefined);
    mocks.resolveRealtimeVoiceInstructionContext.mockImplementation(
      async (params: { agentId: string; personaInstructions?: string }) => ({
        agentName: params.agentId,
        agentContext: {},
        persona: params.personaInstructions,
      }),
    );
    mocks.buildRealtimeVoiceInstructions.mockReturnValue("realtime instructions");
  });

  it("falls back to the gateway relay when Google returns a WebRTC-shaped browser session", async () => {
    const createBrowserSession = vi.fn(async (_req: { instructions?: string }) => ({
      provider: "google",
      clientSecret: "legacy-google-secret",
    }));
    const createBridge = vi.fn();
    const provider = {
      id: "google",
      label: "Google Live Voice",
      isConfigured: () => true,
      createBrowserSession,
      createBridge,
    };
    mocks.getRealtimeVoiceProvider.mockReturnValue(provider);
    mocks.resolveConfiguredRealtimeVoiceProvider.mockReturnValue({
      provider,
      providerConfig: { apiKey: "gemini-key" },
    });
    mocks.createTalkRealtimeRelaySession.mockReturnValue({
      provider: "google",
      transport: "gateway-relay",
      relaySessionId: "relay-1",
      audio: {
        inputEncoding: "pcm16",
        inputSampleRateHz: 24000,
        outputEncoding: "pcm16",
        outputSampleRateHz: 24000,
      },
    });

    const respond = vi.fn();
    await talkHandlers["talk.realtime.session"]({
      req: { type: "req", id: "1", method: "talk.realtime.session" },
      params: { sessionKey: "main", provider: "google" },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {
        getRuntimeConfig: () =>
          ({
            talk: {
              provider: "google",
              providers: { google: { apiKey: "gemini-key" } },
            },
          }) as OpenClawConfig,
      } as never,
    });

    expect(createBrowserSession).toHaveBeenCalledTimes(1);
    expect(mocks.createTalkRealtimeRelaySession).toHaveBeenCalledWith(
      expect.objectContaining({
        connId: "conn-1",
        provider,
        providerConfig: { apiKey: "gemini-key" },
      }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        provider: "google",
        transport: "gateway-relay",
        relaySessionId: "relay-1",
      }),
      undefined,
    );
  });

  it("does not load realtime instructions when provider resolution fails", async () => {
    mocks.resolveConfiguredRealtimeVoiceProvider.mockImplementation(() => {
      throw new Error("No realtime voice provider registered");
    });
    const respond = vi.fn();

    await talkHandlers["talk.realtime.session"]({
      req: { type: "req", id: "1", method: "talk.realtime.session" },
      params: { sessionKey: "agent:luke:main", provider: "missing" },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {
        getRuntimeConfig: () => ({ talk: { provider: "missing" } }) as OpenClawConfig,
      } as never,
    });

    expect(mocks.resolveTtsPersonaDeliveryInstructions).not.toHaveBeenCalled();
    expect(mocks.resolveRealtimeVoiceInstructionContext).not.toHaveBeenCalled();
    expect(mocks.buildRealtimeVoiceInstructions).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "UNAVAILABLE",
        message: "Error: No realtime voice provider registered",
      }),
    );
  });

  it("uses the gateway relay when the client requests relay transport", async () => {
    const createBrowserSession = vi.fn(async () => ({
      provider: "openai",
      transport: "webrtc-sdp" as const,
      clientSecret: "browser-secret",
    }));
    const provider = {
      id: "openai",
      label: "OpenAI Realtime",
      isConfigured: () => true,
      createBrowserSession,
      createBridge: vi.fn(),
    };
    mocks.getRealtimeVoiceProvider.mockReturnValue(provider);
    mocks.resolveConfiguredRealtimeVoiceProvider.mockReturnValue({
      provider,
      providerConfig: { apiKey: "openai-key" },
    });
    mocks.createTalkRealtimeRelaySession.mockReturnValue({
      provider: "openai",
      transport: "gateway-relay",
      relaySessionId: "relay-requested",
      audio: {
        inputEncoding: "pcm16",
        inputSampleRateHz: 24000,
        outputEncoding: "pcm16",
        outputSampleRateHz: 24000,
      },
    });

    const respond = vi.fn();
    await talkHandlers["talk.realtime.session"]({
      req: { type: "req", id: "1", method: "talk.realtime.session" },
      params: { sessionKey: "main", provider: "openai", transport: "gateway-relay" },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {
        getRuntimeConfig: () =>
          ({
            talk: {
              provider: "openai",
              providers: { openai: { apiKey: "openai-key" } },
            },
          }) as OpenClawConfig,
      } as never,
    });

    expect(createBrowserSession).not.toHaveBeenCalled();
    expect(mocks.createTalkRealtimeRelaySession).toHaveBeenCalledWith(
      expect.objectContaining({
        connId: "conn-1",
        provider,
        providerConfig: { apiKey: "openai-key" },
      }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        provider: "openai",
        transport: "gateway-relay",
        relaySessionId: "relay-requested",
      }),
      undefined,
    );
  });

  it("passes selected TTS persona and agent context to browser realtime sessions", async () => {
    const createBrowserSession = vi.fn(async (_req: { instructions?: string }) => ({
      provider: "acme",
      transport: "json-pcm-websocket",
      clientSecret: "client-secret",
      websocketUrl: "wss://example.invalid/realtime",
      protocol: "acme-live",
      audio: {
        inputEncoding: "pcm16",
        inputSampleRateHz: 24000,
        outputEncoding: "pcm16",
        outputSampleRateHz: 24000,
      },
    }));
    const provider = {
      id: "acme",
      label: "Acme Live Voice",
      isConfigured: () => true,
      createBrowserSession,
    };
    mocks.resolveConfiguredRealtimeVoiceProvider.mockReturnValue({
      provider,
      providerConfig: { apiKey: "acme-key" },
    });
    mocks.resolveTtsPersonaDeliveryInstructions.mockReturnValue(
      "Name: Luke\nProfile: grounded and warm.",
    );
    const runtimeConfig = {
      talk: {
        provider: "acme",
        providers: { acme: { apiKey: "acme-key" } },
      },
      messages: {
        tts: {
          persona: "sky",
        },
      },
      agents: {
        list: [{ id: "luke", tts: { persona: "luke" } }],
      },
    } as OpenClawConfig;

    const respond = vi.fn();
    await talkHandlers["talk.realtime.session"]({
      req: { type: "req", id: "1", method: "talk.realtime.session" },
      params: { sessionKey: "agent:luke:telegram:direct:123", provider: "acme" },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: { getRuntimeConfig: () => runtimeConfig } as never,
    });

    expect(mocks.resolveTtsPersonaDeliveryInstructions).toHaveBeenCalledWith(runtimeConfig, {
      agentId: "luke",
    });
    expect(mocks.resolveRealtimeVoiceInstructionContext).toHaveBeenCalledWith({
      cfg: runtimeConfig,
      agentId: "luke",
      personaInstructions: "Name: Luke\nProfile: grounded and warm.",
    });
    expect(mocks.buildRealtimeVoiceInstructions).toHaveBeenCalledWith(
      expect.objectContaining({
        persona: "Name: Luke\nProfile: grounded and warm.",
      }),
    );
    expect(createBrowserSession).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: "realtime instructions",
      }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ provider: "acme" }),
      undefined,
    );
  });

  it("passes the same persona-enriched instructions to realtime relay fallback", async () => {
    const createBrowserSession = vi.fn(async (_req: { instructions?: string }) => ({
      provider: "google",
      clientSecret: "legacy-google-secret",
    }));
    const provider = {
      id: "google",
      label: "Google Live Voice",
      isConfigured: () => true,
      createBrowserSession,
      createBridge: vi.fn(),
    };
    mocks.resolveConfiguredRealtimeVoiceProvider.mockReturnValue({
      provider,
      providerConfig: { apiKey: "gemini-key" },
    });
    mocks.resolveTtsPersonaDeliveryInstructions.mockReturnValue("Name: Luke");
    mocks.buildRealtimeVoiceInstructions.mockReturnValue("relay realtime instructions");
    mocks.createTalkRealtimeRelaySession.mockReturnValue({
      provider: "google",
      transport: "gateway-relay",
      relaySessionId: "relay-1",
      audio: {
        inputEncoding: "pcm16",
        inputSampleRateHz: 24000,
        outputEncoding: "pcm16",
        outputSampleRateHz: 24000,
      },
    });
    const runtimeConfig = {
      talk: {
        provider: "google",
        providers: { google: { apiKey: "gemini-key" } },
      },
    } as OpenClawConfig;

    const respond = vi.fn();
    await talkHandlers["talk.realtime.session"]({
      req: { type: "req", id: "1", method: "talk.realtime.session" },
      params: { sessionKey: "agent:luke:main", provider: "google" },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: { getRuntimeConfig: () => runtimeConfig } as never,
    });

    const browserInstructions = (
      createBrowserSession.mock.calls[0]?.[0] as { instructions?: string } | undefined
    )?.instructions;
    const relayCall = mocks.createTalkRealtimeRelaySession.mock.calls[0] as
      | [{ instructions?: string }]
      | undefined;
    const relayInstructions = relayCall?.[0].instructions;
    expect(browserInstructions).toBe(relayInstructions);
    expect(relayInstructions).toBe("relay realtime instructions");
  });
});

describe("talk.realtime.relayUserMessage handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards text turns to the active realtime relay session", async () => {
    const respond = vi.fn();

    await talkHandlers["talk.realtime.relayUserMessage"]({
      req: { type: "req", id: "1", method: "talk.realtime.relayUserMessage" },
      params: { relaySessionId: "relay-1", text: "Hello Sky." },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {} as never,
    });

    expect(mocks.sendTalkRealtimeRelayUserMessage).toHaveBeenCalledWith({
      relaySessionId: "relay-1",
      connId: "conn-1",
      text: "Hello Sky.",
    });
    expect(respond).toHaveBeenCalledWith(true, { ok: true }, undefined);
  });
});
