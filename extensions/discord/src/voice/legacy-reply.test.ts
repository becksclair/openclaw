import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  agentCommandFromIngressMock,
  resolveTtsConfigMock,
  parseTtsDirectivesMock,
  discordRuntimeMock,
  discordTextToSpeechMock,
  transcribeDiscordVoiceAudioMock,
} = vi.hoisted(() => {
  const discordRuntimeMock = {
    tts: {
      textToSpeech: vi.fn(async () => ({ success: true, audioPath: "/tmp/reply.wav" })),
    },
  };
  return {
    agentCommandFromIngressMock: vi.fn<() => Promise<{ payloads: Array<{ text?: string }> }>>(
      async () => ({ payloads: [] }),
    ),
    resolveTtsConfigMock: vi.fn((cfg) => ({
      modelOverrides: cfg.messages?.tts?.modelOverrides ?? {},
      providerConfigs: cfg.messages?.tts?.providers ?? {},
    })),
    parseTtsDirectivesMock: vi.fn((_text, _modelOverrides, _context) => ({
      cleanedText: "Spoken reply",
      overrides: {},
    })),
    discordRuntimeMock,
    discordTextToSpeechMock: discordRuntimeMock.tts.textToSpeech,
    transcribeDiscordVoiceAudioMock: vi.fn(async () => "hello from voice"),
  };
});

vi.mock("openclaw/plugin-sdk/agent-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/agent-runtime")>();
  return {
    ...actual,
    agentCommandFromIngress: agentCommandFromIngressMock,
    resolveTtsConfig: resolveTtsConfigMock,
  };
});

vi.mock("openclaw/plugin-sdk/speech", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/speech")>();
  return {
    ...actual,
    parseTtsDirectives: parseTtsDirectivesMock,
  };
});

vi.mock("../runtime.js", () => ({
  getDiscordRuntime: () => discordRuntimeMock,
}));

vi.mock("./audio-processing.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./audio-processing.js")>();
  return {
    ...actual,
    transcribeDiscordVoiceAudio: transcribeDiscordVoiceAudioMock,
  };
});

import { generateDiscordLegacyReply, synthesizeDiscordVoiceReplyAudio } from "./legacy-reply.js";

describe("legacy-reply seam", () => {
  beforeEach(() => {
    agentCommandFromIngressMock.mockClear();
    resolveTtsConfigMock.mockClear();
    parseTtsDirectivesMock.mockClear();
    discordTextToSpeechMock.mockClear();
    transcribeDiscordVoiceAudioMock.mockClear();
    parseTtsDirectivesMock.mockReturnValue({
      cleanedText: "Spoken reply",
      overrides: {},
    });
    discordTextToSpeechMock.mockResolvedValue({ success: true, audioPath: "/tmp/reply.wav" });
    transcribeDiscordVoiceAudioMock.mockResolvedValue("hello from voice");
    agentCommandFromIngressMock.mockResolvedValue({ payloads: [] });
  });

  it("returns an empty reply when transcription yields no user text", async () => {
    transcribeDiscordVoiceAudioMock.mockResolvedValueOnce("");
    const logVerbose = vi.fn();

    const reply = await generateDiscordLegacyReply({
      cfg: {},
      runtime: {} as never,
      entry: {
        route: { agentId: "agent-1", sessionKey: "discord:g1:c1" },
        guildId: "g1",
        channelId: "c1",
      },
      wavPath: "/tmp/input.wav",
      senderLabel: "Owner Nick",
      senderIsOwner: true,
      logVerbose,
    });

    expect(reply).toEqual({ text: "" });
    expect(agentCommandFromIngressMock).not.toHaveBeenCalled();
    expect(logVerbose).toHaveBeenCalledWith("transcription empty: guild g1 channel c1");
  });

  it("passes the formatted prompt and owner bit into agent ingress", async () => {
    agentCommandFromIngressMock.mockResolvedValueOnce({
      payloads: [{ text: "First line" }, { text: "  " }, { text: "Second line" }],
    });

    const reply = await generateDiscordLegacyReply({
      cfg: {},
      runtime: { env: "test" } as never,
      entry: {
        route: { agentId: "agent-1", sessionKey: "discord:g1:c1" },
        guildId: "g1",
        channelId: "c1",
      },
      wavPath: "/tmp/input.wav",
      senderLabel: "Owner Nick",
      senderIsOwner: true,
      logVerbose: vi.fn(),
    });

    expect(agentCommandFromIngressMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Voice transcript from speaker "Owner Nick":\nhello from voice',
        sessionKey: "discord:g1:c1",
        agentId: "agent-1",
        messageChannel: "discord",
        senderIsOwner: true,
        allowModelOverride: false,
        deliver: false,
      }),
      expect.anything(),
    );
    expect(reply).toEqual({ text: "First line\nSecond line" });
  });

  it("merges voice-specific TTS overrides before synthesis and sanitizes speech text", async () => {
    parseTtsDirectivesMock.mockReturnValueOnce({
      cleanedText: "[[reply_to_current]] Owner Nick: 😀 Spoken reply 🎉",
      overrides: {},
    });
    const cfg = {
      messages: {
        tts: {
          modelOverrides: {
            enabled: true,
            allowText: true,
          },
          providers: {
            elevenlabs: {
              model: "base-model",
            },
          },
        },
      },
    };

    const audioPath = await synthesizeDiscordVoiceReplyAudio({
      cfg,
      ttsOverride: {
        modelOverrides: {
          allowProvider: true,
        },
        providers: {
          elevenlabs: {
            voice: "fork-voice",
          },
        },
      },
      entry: { guildId: "g1", channelId: "c1" },
      replyText: "[[reply_to_current]] Owner Nick: 😀 Spoken reply 🎉",
      speakerLabel: "Owner Nick",
      logVerbose: vi.fn(),
      logger: { warn: vi.fn() },
    });

    expect(resolveTtsConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.objectContaining({
          tts: expect.objectContaining({
            modelOverrides: expect.objectContaining({
              enabled: true,
              allowText: true,
              allowProvider: true,
            }),
            providers: expect.objectContaining({
              elevenlabs: expect.objectContaining({
                model: "base-model",
                voice: "fork-voice",
              }),
            }),
          }),
        }),
      }),
    );
    expect(discordTextToSpeechMock).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Spoken reply",
        channel: "discord",
      }),
    );
    expect(audioPath).toBe("/tmp/reply.wav");
  });

  it("skips synthesis when directives strip the reply down to nothing", async () => {
    parseTtsDirectivesMock.mockReturnValueOnce({ cleanedText: "   ", overrides: {} });
    const logVerbose = vi.fn();

    const audioPath = await synthesizeDiscordVoiceReplyAudio({
      cfg: {},
      entry: { guildId: "g1", channelId: "c1" },
      replyText: "Speak this",
      logVerbose,
      logger: { warn: vi.fn() },
    });

    expect(audioPath).toBeUndefined();
    expect(discordTextToSpeechMock).not.toHaveBeenCalled();
    expect(logVerbose).toHaveBeenCalledWith("tts skipped (empty): guild g1 channel c1");
  });
});
