import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../protocol/index.js";

const mocks = vi.hoisted(() => ({
  getRuntimeConfig: vi.fn(() => ({})),
  resolveEffectiveTtsConfig: vi.fn(() => ({})),
  resolveExplicitTtsOverrides: vi.fn(() => ({})),
  textToSpeech: vi.fn(async () => ({
    success: true,
    audioPath: "/tmp/tts.mp3",
    provider: "openai",
    outputFormat: "mp3",
    voiceCompatible: false,
  })),
}));

vi.mock("../../config/config.js", () => ({
  getRuntimeConfig:
    mocks.getRuntimeConfig as typeof import("../../config/config.js").getRuntimeConfig,
}));

vi.mock("../../tts/provider-registry.js", () => ({
  canonicalizeSpeechProviderId: vi.fn(),
  getSpeechProvider: vi.fn(),
  listSpeechProviders: vi.fn(() => []),
}));

vi.mock("../../tts/tts.js", () => ({
  getResolvedSpeechProviderConfig: vi.fn(),
  getTtsPersona: vi.fn(() => undefined),
  getTtsProvider: vi.fn(() => "openai"),
  isTtsEnabled: vi.fn(() => true),
  isTtsProviderConfigured: vi.fn(() => true),
  listTtsPersonas: vi.fn(() => []),
  resolveExplicitTtsOverrides:
    mocks.resolveExplicitTtsOverrides as typeof import("../../tts/tts.js").resolveExplicitTtsOverrides,
  resolveTtsAutoMode: vi.fn(() => false),
  resolveTtsConfig: vi.fn(() => ({})),
  resolveTtsPrefsPath: vi.fn(() => "/tmp/tts.json"),
  resolveTtsProviderOrder: vi.fn(() => ["openai"]),
  setTtsEnabled: vi.fn(),
  setTtsPersona: vi.fn(),
  setTtsProvider: vi.fn(),
  textToSpeech: mocks.textToSpeech as typeof import("../../tts/tts.js").textToSpeech,
}));

vi.mock("../../tts/tts-config.js", () => ({
  resolveEffectiveTtsConfig:
    mocks.resolveEffectiveTtsConfig as typeof import("../../tts/tts-config.js").resolveEffectiveTtsConfig,
}));

describe("ttsHandlers", () => {
  beforeEach(() => {
    mocks.getRuntimeConfig.mockReset();
    mocks.getRuntimeConfig.mockReturnValue({});
    mocks.resolveEffectiveTtsConfig.mockReset();
    mocks.resolveEffectiveTtsConfig.mockReturnValue({});
    mocks.resolveExplicitTtsOverrides.mockReset();
    mocks.resolveExplicitTtsOverrides.mockReturnValue({});
    mocks.textToSpeech.mockReset();
    mocks.textToSpeech.mockResolvedValue({
      success: true,
      audioPath: "/tmp/tts.mp3",
      provider: "openai",
      outputFormat: "mp3",
      voiceCompatible: false,
    });
  });

  it("returns INVALID_REQUEST when TTS override validation fails", async () => {
    mocks.resolveExplicitTtsOverrides.mockImplementation(() => {
      throw new Error('Unknown TTS provider "bad".');
    });

    const { ttsHandlers } = await import("./tts.js");
    const respond = vi.fn();

    await ttsHandlers["tts.convert"]({
      params: {
        text: "hello",
        provider: "bad",
      },
      respond,
      context: { getRuntimeConfig: mocks.getRuntimeConfig },
    } as never);

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: ErrorCodes.INVALID_REQUEST,
        message: 'Error: Unknown TTS provider "bad".',
      }),
    );
    expect(mocks.textToSpeech).not.toHaveBeenCalled();
  });

  it("resolves tts.convert against agent and channel scoped TTS config", async () => {
    const runtimeConfig = {
      messages: {
        tts: {
          provider: "openai",
          voice: "global",
        },
      },
    };
    const effectiveTts = {
      provider: "google",
      voice: "agent-voice",
    };
    mocks.getRuntimeConfig.mockReturnValue(runtimeConfig);
    mocks.resolveEffectiveTtsConfig.mockReturnValue(effectiveTts);

    const { ttsHandlers } = await import("./tts.js");
    const respond = vi.fn();

    await ttsHandlers["tts.convert"]({
      params: {
        text: "hello",
        agentId: "reader",
        channel: "telegram",
        accountId: "personal",
      },
      respond,
      context: { getRuntimeConfig: mocks.getRuntimeConfig },
    } as never);

    const scopedConfig = {
      messages: {
        tts: effectiveTts,
      },
    };
    expect(mocks.resolveEffectiveTtsConfig).toHaveBeenCalledWith(runtimeConfig, {
      agentId: "reader",
      channelId: "telegram",
      accountId: "personal",
    });
    expect(mocks.resolveExplicitTtsOverrides).toHaveBeenCalledWith({
      cfg: scopedConfig,
      provider: undefined,
      modelId: undefined,
      voiceId: undefined,
    });
    expect(mocks.textToSpeech).toHaveBeenCalledWith({
      text: "hello",
      cfg: scopedConfig,
      channel: "telegram",
      overrides: {},
      disableFallback: false,
    });
    expect(respond).toHaveBeenCalledWith(true, {
      audioPath: "/tmp/tts.mp3",
      provider: "openai",
      outputFormat: "mp3",
      voiceCompatible: false,
    });
  });
});
