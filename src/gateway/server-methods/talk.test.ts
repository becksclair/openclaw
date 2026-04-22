import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import { talkHandlers } from "./talk.js";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn<() => OpenClawConfig>(),
  readConfigFileSnapshot: vi.fn(),
  canonicalizeSpeechProviderId: vi.fn((providerId: string | undefined) => providerId),
  getSpeechProvider: vi.fn(),
  synthesizeSpeech: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
  readConfigFileSnapshot: mocks.readConfigFileSnapshot,
}));

vi.mock("../../tts/provider-registry.js", () => ({
  canonicalizeSpeechProviderId: mocks.canonicalizeSpeechProviderId,
  getSpeechProvider: mocks.getSpeechProvider,
}));

vi.mock("../../tts/tts.js", () => ({
  synthesizeSpeech: mocks.synthesizeSpeech,
}));

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

    mocks.loadConfig.mockReturnValue(runtimeConfig);
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
      context: {} as never,
    });

    expect(mocks.loadConfig).toHaveBeenCalledTimes(1);
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

  it("applies agent-level TTS overrides for talk.speak", async () => {
    const runtimeConfig: OpenClawConfig = {
      ...createTalkConfig("env-acme-key"),
      messages: {
        tts: {
          timeoutMs: 30_000,
          providers: {
            openai: {
              voice: "alloy",
            },
          },
        },
      },
      agents: {
        list: [
          {
            id: "voice-a",
            tts: {
              timeoutMs: 45_000,
              providers: {
                openai: {
                  voice: "nova",
                },
              },
            },
          },
        ],
      },
    };

    mocks.loadConfig.mockReturnValue(runtimeConfig);
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
        expect(cfg.messages?.tts?.timeoutMs).toBe(45_000);
        expect(cfg.messages?.tts?.providers?.openai?.voice).toBe("nova");
        expect(cfg.messages?.tts?.provider).toBe("acme");
        return {
          success: true,
          provider: "acme",
          audioBuffer: Buffer.from([4, 5, 6]),
          outputFormat: "mp3",
          voiceCompatible: false,
          fileExtension: ".mp3",
        };
      },
    );

    const respond = vi.fn();
    await talkHandlers["talk.speak"]({
      req: { type: "req", id: "2", method: "talk.speak" },
      params: { text: "Hello from agent override.", agentId: "voice-a" },
      client: null,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {} as never,
    });

    expect(mocks.synthesizeSpeech).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ provider: "acme" }),
      undefined,
    );
  });

  it("uses the agent voice from talk.providers when agentId is provided", async () => {
    const runtimeConfig: OpenClawConfig = {
      talk: {
        provider: "openai",
        providers: {
          openai: {
            voiceId: "alloy",
            apiKey: "openai-key",
          },
        },
      },
      messages: {
        tts: {
          provider: "openai",
          providers: {
            openai: {
              voice: "alloy",
              apiKey: "openai-key",
            },
          },
        },
      },
      agents: {
        list: [
          {
            id: "luke",
            tts: {
              providers: {
                openai: {
                  voice: "echo",
                },
              },
            },
          },
        ],
      },
    };

    mocks.loadConfig.mockReturnValue(runtimeConfig);
    let receivedTalkProviderConfig: Record<string, unknown> | undefined;
    mocks.getSpeechProvider.mockReturnValue({
      id: "openai",
      label: "OpenAI",
      resolveTalkConfig: ({
        talkProviderConfig,
      }: {
        talkProviderConfig: Record<string, unknown>;
      }) => {
        receivedTalkProviderConfig = talkProviderConfig;
        return talkProviderConfig;
      },
    });
    mocks.synthesizeSpeech.mockResolvedValue({
      success: true,
      provider: "openai",
      audioBuffer: Buffer.from([1, 2, 3]),
      outputFormat: "mp3",
      voiceCompatible: false,
      fileExtension: ".mp3",
    });

    const respond = vi.fn();
    await talkHandlers["talk.speak"]({
      req: { type: "req", id: "3", method: "talk.speak" },
      params: { text: "Hello from Luke.", agentId: "luke" },
      client: null,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {} as never,
    });

    expect(mocks.synthesizeSpeech).toHaveBeenCalledTimes(1);
    expect(receivedTalkProviderConfig?.voiceId).toBe("echo");
    expect(respond).toHaveBeenCalledWith(true, expect.anything(), undefined);
  });

  it("materializes the selected TTS provider for talk.speak when Talk only has another provider configured", async () => {
    const runtimeConfig: OpenClawConfig = {
      talk: {
        provider: "elevenlabs",
        providers: {
          elevenlabs: {
            voiceId: "legacy-voice",
          },
        },
      },
      messages: {
        tts: {
          provider: "openai",
          timeoutMs: 30_000,
        },
      },
      agents: {
        list: [
          {
            id: "voice-i",
            tts: {
              timeoutMs: 45_000,
            },
          },
        ],
      },
    };

    mocks.loadConfig.mockReturnValue(runtimeConfig);
    mocks.getSpeechProvider.mockImplementation((providerId: string | undefined) => {
      if (providerId === "openai") {
        return {
          id: "openai",
          label: "OpenAI",
          resolveTalkConfig: ({
            baseTtsConfig,
            talkProviderConfig,
          }: {
            baseTtsConfig: Record<string, unknown>;
            talkProviderConfig: Record<string, unknown>;
          }) => ({
            voice: typeof baseTtsConfig.timeoutMs === "number" ? "synth-from-tts" : "missing",
            ...talkProviderConfig,
          }),
        };
      }
      if (providerId === "elevenlabs") {
        return {
          id: "elevenlabs",
          label: "ElevenLabs",
          resolveTalkConfig: ({
            talkProviderConfig,
          }: {
            talkProviderConfig: Record<string, unknown>;
          }) => talkProviderConfig,
        };
      }
      return undefined;
    });
    mocks.synthesizeSpeech.mockImplementation(
      async ({ cfg }: { cfg: OpenClawConfig; text: string; disableFallback: boolean }) => {
        expect(cfg.messages?.tts?.provider).toBe("openai");
        expect(cfg.messages?.tts?.providers?.openai?.voice).toBe("synth-from-tts");
        return {
          success: true,
          provider: "openai",
          audioBuffer: Buffer.from([7, 8, 9]),
          outputFormat: "mp3",
          voiceCompatible: false,
          fileExtension: ".mp3",
        };
      },
    );

    const respond = vi.fn();
    await talkHandlers["talk.speak"]({
      req: { type: "req", id: "4", method: "talk.speak" },
      params: { text: "Hello from synthesized provider.", agentId: "voice-i" },
      client: null,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {} as never,
    });

    expect(mocks.synthesizeSpeech).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(true, expect.anything(), undefined);
  });
});
