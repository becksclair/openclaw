import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import type { ReplyPayload } from "openclaw/plugin-sdk/reply-payload";
import type { SpeechProviderPlugin, SpeechSynthesisRequest } from "openclaw/plugin-sdk/speech-core";
import { afterEach, describe, expect, it, vi } from "vitest";

type MockSpeechSynthesisResult = Awaited<ReturnType<SpeechProviderPlugin["synthesize"]>>;

const synthesizeMock = vi.hoisted(() =>
  vi.fn(
    async (request: SpeechSynthesisRequest): Promise<MockSpeechSynthesisResult> => ({
      audioBuffer: Buffer.from("voice"),
      fileExtension: ".ogg",
      outputFormat: "ogg",
      voiceCompatible: request.target === "voice-note",
    }),
  ),
);

const runFfmpegMock = vi.hoisted(() => vi.fn());

const listSpeechProvidersMock = vi.hoisted(() => vi.fn());
const getSpeechProviderMock = vi.hoisted(() => vi.fn());

vi.mock("openclaw/plugin-sdk/media-runtime", async () => {
  const actual = await vi.importActual<typeof import("openclaw/plugin-sdk/media-runtime")>(
    "openclaw/plugin-sdk/media-runtime",
  );
  runFfmpegMock.mockImplementation(async (args: string[]) => {
    const outputPath = args.at(-1);
    if (typeof outputPath === "string") {
      writeFileSync(outputPath, Buffer.from("opus"));
    }
    return "";
  });
  return {
    ...actual,
    runFfmpeg: runFfmpegMock,
  };
});

vi.mock("openclaw/plugin-sdk/channel-targets", () => ({
  normalizeChannelId: (channel: string | undefined) => channel?.trim().toLowerCase() ?? null,
}));

vi.mock("../api.js", async () => {
  const actual = await vi.importActual<typeof import("../api.js")>("../api.js");
  const mockProvider: SpeechProviderPlugin = {
    id: "mock",
    label: "Mock",
    autoSelectOrder: 1,
    isConfigured: () => true,
    synthesize: synthesizeMock,
  };
  listSpeechProvidersMock.mockImplementation(() => [mockProvider]);
  getSpeechProviderMock.mockImplementation((providerId: string) =>
    providerId === "mock" ? mockProvider : null,
  );
  return {
    ...actual,
    canonicalizeSpeechProviderId: (providerId: string | undefined) =>
      providerId?.trim().toLowerCase() || undefined,
    normalizeSpeechProviderId: (providerId: string | undefined) =>
      providerId?.trim().toLowerCase() || undefined,
    getSpeechProvider: getSpeechProviderMock,
    listSpeechProviders: listSpeechProvidersMock,
    scheduleCleanup: vi.fn(),
  };
});

const { _test, maybeApplyTtsToPayload, textToSpeech } = await import("./tts.js");

const nativeVoiceNoteChannels = ["discord", "feishu", "matrix", "telegram", "whatsapp"] as const;

function createTtsConfig(prefsName: string): OpenClawConfig {
  return {
    messages: {
      tts: {
        enabled: true,
        provider: "mock",
        prefsPath: `/tmp/${prefsName}.json`,
      },
    },
  };
}

describe("speech-core native voice-note routing", () => {
  afterEach(() => {
    synthesizeMock.mockClear();
    runFfmpegMock.mockClear();
  });

  it("keeps native voice-note channel support centralized", () => {
    for (const channel of nativeVoiceNoteChannels) {
      expect(_test.supportsNativeVoiceNoteTts(channel)).toBe(true);
      expect(_test.supportsNativeVoiceNoteTts(channel.toUpperCase())).toBe(true);
    }
    expect(_test.supportsNativeVoiceNoteTts("slack")).toBe(false);
    expect(_test.supportsNativeVoiceNoteTts(undefined)).toBe(false);
  });

  it("marks Discord auto TTS replies as native voice messages", async () => {
    const cfg = createTtsConfig("openclaw-speech-core-tts-test");
    const payload: ReplyPayload = {
      text: "This Discord reply should be delivered as a native voice note.",
    };

    let mediaDir: string | undefined;
    try {
      const result = await maybeApplyTtsToPayload({
        payload,
        cfg,
        channel: "discord",
        kind: "final",
      });

      expect(synthesizeMock).toHaveBeenCalledWith(
        expect.objectContaining({ target: "voice-note" }),
      );
      expect(result.audioAsVoice).toBe(true);
      expect(result.mediaUrl).toMatch(/voice-\d+\.ogg$/);

      mediaDir = result.mediaUrl ? path.dirname(result.mediaUrl) : undefined;
    } finally {
      if (mediaDir) {
        rmSync(mediaDir, { recursive: true, force: true });
      }
    }
  });

  it("upgrades Telegram voice compatibility from the synthesized artifact when provider metadata is pessimistic", async () => {
    synthesizeMock.mockResolvedValueOnce({
      audioBuffer: Buffer.from("voice"),
      fileExtension: ".opus",
      outputFormat: "opus",
      voiceCompatible: false,
    });

    const result = await textToSpeech({
      text: "A long enough message for direct speech output.",
      cfg: createTtsConfig("openclaw-speech-core-telegram-compat-test"),
      channel: "telegram",
      disableFallback: true,
    });

    expect(result.success).toBe(true);
    expect(result.voiceCompatible).toBe(true);
  });

  it("transcodes non-compatible fallback audio to Opus for voice-note channels", async () => {
    synthesizeMock.mockResolvedValueOnce({
      audioBuffer: Buffer.from("voice"),
      fileExtension: ".wav",
      outputFormat: "wav",
      voiceCompatible: false,
    });

    const result = await textToSpeech({
      text: "A long enough message for fallback speech output.",
      cfg: createTtsConfig("openclaw-speech-core-discord-transcode-test"),
      channel: "discord",
      disableFallback: true,
    });

    expect(result.success).toBe(true);
    expect(runFfmpegMock).toHaveBeenCalledTimes(1);
    expect(result.outputFormat).toBe("opus");
    expect(result.voiceCompatible).toBe(true);
    expect(result.audioPath).toMatch(/voice-\d+\.opus$/);

    if (result.audioPath) {
      rmSync(path.dirname(result.audioPath), { recursive: true, force: true });
    }
  });

  it("transcodes Telegram voice outputs to Opus when the provider returns mp3", async () => {
    synthesizeMock.mockResolvedValueOnce({
      audioBuffer: Buffer.from("voice"),
      fileExtension: ".mp3",
      outputFormat: "mp3",
      voiceCompatible: true,
    });

    const result = await textToSpeech({
      text: "Telegram should still get Opus even when the provider hands back mp3.",
      cfg: createTtsConfig("openclaw-speech-core-telegram-transcode-test"),
      channel: "telegram",
      disableFallback: true,
    });

    expect(result.success).toBe(true);
    expect(runFfmpegMock).toHaveBeenCalledTimes(1);
    expect(result.outputFormat).toBe("opus");
    expect(result.voiceCompatible).toBe(true);
    expect(result.audioPath).toMatch(/voice-\d+\.opus$/);

    if (result.audioPath) {
      rmSync(path.dirname(result.audioPath), { recursive: true, force: true });
    }
  });

  it("falls back to regular audio when Opus transcode fails", async () => {
    runFfmpegMock.mockRejectedValueOnce(new Error("ffmpeg missing"));
    synthesizeMock.mockResolvedValueOnce({
      audioBuffer: Buffer.from("voice"),
      fileExtension: ".mp3",
      outputFormat: "mp3",
      voiceCompatible: true,
    });

    const result = await textToSpeech({
      text: "Telegram should not keep voice-note compatibility if Opus transcoding fails.",
      cfg: createTtsConfig("openclaw-speech-core-telegram-transcode-fail-test"),
      channel: "telegram",
      disableFallback: true,
    });

    expect(result.success).toBe(true);
    expect(runFfmpegMock).toHaveBeenCalledTimes(1);
    expect(result.outputFormat).toBe("mp3");
    expect(result.voiceCompatible).toBe(false);
    expect(result.audioPath).toMatch(/voice-\d+\.mp3$/);

    if (result.audioPath) {
      rmSync(path.dirname(result.audioPath), { recursive: true, force: true });
    }
  });

  it("marks Telegram auto TTS payloads as voice when the artifact is compatible even if provider metadata is false", async () => {
    synthesizeMock.mockResolvedValueOnce({
      audioBuffer: Buffer.from("voice"),
      fileExtension: ".opus",
      outputFormat: "opus",
      voiceCompatible: false,
    });

    let mediaDir: string | undefined;
    try {
      const result = await maybeApplyTtsToPayload({
        payload: {
          text: "Telegram should still treat compatible Opus output as a voice note.",
        },
        cfg: createTtsConfig("openclaw-speech-core-telegram-voice-test"),
        channel: "telegram",
        kind: "final",
      });

      expect(result.audioAsVoice).toBe(true);
      expect(result.mediaUrl).toMatch(/voice-\d+\.opus$/);

      mediaDir = result.mediaUrl ? path.dirname(result.mediaUrl) : undefined;
    } finally {
      if (mediaDir) {
        rmSync(mediaDir, { recursive: true, force: true });
      }
    }
  });

  it("keeps non-native voice-note channels as regular audio files", async () => {
    const cfg = createTtsConfig("openclaw-speech-core-tts-slack-test");
    const payload: ReplyPayload = {
      text: "Slack replies should be delivered as regular audio attachments.",
    };

    let mediaDir: string | undefined;
    try {
      const result = await maybeApplyTtsToPayload({
        payload,
        cfg,
        channel: "slack",
        kind: "final",
      });

      expect(synthesizeMock).toHaveBeenCalledWith(
        expect.objectContaining({ target: "audio-file" }),
      );
      expect(result.audioAsVoice).toBeUndefined();
      expect(result.mediaUrl).toMatch(/voice-\d+\.ogg$/);

      mediaDir = result.mediaUrl ? path.dirname(result.mediaUrl) : undefined;
    } finally {
      if (mediaDir) {
        rmSync(mediaDir, { recursive: true, force: true });
      }
    }
  });
});
