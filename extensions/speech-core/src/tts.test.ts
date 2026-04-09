import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const synthesizeProviderMock = vi.hoisted(() =>
  vi.fn(async (params: { target: string }) => ({
    audioBuffer: Buffer.from("fake-audio"),
    outputFormat: "ogg",
    voiceCompatible: true,
    fileExtension: ".ogg",
    target: params.target,
  })),
);

vi.mock("../api.js", () => ({
  canonicalizeSpeechProviderId: (provider: string | undefined) => provider?.trim(),
  getSpeechProvider: () => ({
    id: "mock",
    isConfigured: () => true,
    synthesize: synthesizeProviderMock,
  }),
  listSpeechProviders: () => [],
  normalizeSpeechProviderId: (provider: string | undefined) => provider?.trim(),
  normalizeTtsAutoMode: (mode: string | undefined) => mode,
  parseTtsDirectives: (text: string) => ({
    cleanedText: text,
    ttsText: undefined,
    warnings: [],
    hasDirective: false,
    overrides: undefined,
  }),
  scheduleCleanup: () => {},
  summarizeText: async () => ({ summary: "summary" }),
}));

let synthesizeSpeech: (typeof import("./tts.js"))["synthesizeSpeech"];
let maybeApplyTtsToPayload: (typeof import("./tts.js"))["maybeApplyTtsToPayload"];

beforeAll(async () => {
  ({ synthesizeSpeech, maybeApplyTtsToPayload } = await import("./tts.js"));
});

beforeEach(() => {
  synthesizeProviderMock.mockClear();
});

function createConfig(): OpenClawConfig {
  return {
    messages: {
      tts: {
        enabled: true,
        auto: "always",
        provider: "mock",
        maxTextLength: 4096,
      },
    },
  } as OpenClawConfig;
}

describe("speech-core tts opus channel routing", () => {
  it("uses voice-note target for discord channels", async () => {
    const result = await synthesizeSpeech({
      text: "A long enough message for text to speech",
      cfg: createConfig(),
      channel: "discord",
      disableFallback: true,
    });

    expect(result.success).toBe(true);
    expect(synthesizeProviderMock).toHaveBeenCalledTimes(1);
    expect(synthesizeProviderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "voice-note",
      }),
    );
  });

  it("marks discord auto-tts payloads as native voice when provider output is compatible", async () => {
    const updated = await maybeApplyTtsToPayload({
      payload: {
        text: "A long enough assistant response for speech output",
      },
      cfg: createConfig(),
      channel: "discord",
      kind: "final",
    });

    expect(updated.mediaUrl).toContain("voice-");
    expect(updated.audioAsVoice).toBe(true);
  });

  it("keeps non-opus channels on attachment fallback", async () => {
    const updated = await maybeApplyTtsToPayload({
      payload: {
        text: "A long enough assistant response for speech output",
      },
      cfg: createConfig(),
      channel: "slack",
      kind: "final",
    });

    expect(updated.mediaUrl).toContain("voice-");
    expect(updated.audioAsVoice).not.toBe(true);
  });
});
