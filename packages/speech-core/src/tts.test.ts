import { rmSync } from "node:fs";
import path from "node:path";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import type { ReplyPayload } from "openclaw/plugin-sdk/reply-payload";
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "openclaw/plugin-sdk/runtime-config-snapshot";
import type {
  SpeechProviderPlugin,
  SpeechProviderPrepareSynthesisContext,
  SpeechSynthesisStreamRequest,
  SpeechSynthesisRequest,
  SpeechTelephonySynthesisRequest,
} from "openclaw/plugin-sdk/speech-core";
import { afterEach, describe, expect, it, vi } from "vitest";

type MockSpeechSynthesisResult = Awaited<ReturnType<SpeechProviderPlugin["synthesize"]>>;
type MockSpeechStreamResult = Awaited<
  ReturnType<NonNullable<SpeechProviderPlugin["streamSynthesize"]>>
>;

function createMockSpeechStreamResult(): MockSpeechStreamResult {
  return {
    audioStream: new ReadableStream<Uint8Array>(),
    fileExtension: ".ogg",
    outputFormat: "ogg",
    voiceCompatible: false,
  };
}

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
const prepareSynthesisMock = vi.hoisted(() =>
  vi.fn(async (_ctx: SpeechProviderPrepareSynthesisContext) => undefined),
);

const listSpeechProvidersMock = vi.hoisted(() => vi.fn());
const getSpeechProviderMock = vi.hoisted(() => vi.fn());
const transcodeAudioBufferMock = vi.hoisted(() =>
  // Default off: most tests rely on the synthesized buffer reaching the
  // channel unchanged. Tests that exercise the pre-transcode branch override
  // per-call via `transcodeAudioBufferMock.mockResolvedValueOnce(...)`.
  // Typed as the helper's full return shape so per-call overrides aren't
  // narrowed to the default's literal.
  vi.fn<
    () => Promise<
      | { ok: true; buffer: Buffer }
      | {
          ok: false;
          reason:
            | "platform-unsupported"
            | "invalid-extension"
            | "noop-same-container"
            | "no-recipe"
            | "transcoder-failed";
          detail?: string;
        }
    >
  >(async () => ({ ok: false, reason: "platform-unsupported" })),
);

vi.mock("openclaw/plugin-sdk/media-runtime", () => ({
  transcodeAudioBuffer: transcodeAudioBufferMock,
}));

vi.mock("openclaw/plugin-sdk/channel-targets", () => ({
  normalizeChannelId: (channel: string | undefined) => channel?.trim().toLowerCase() ?? null,
  resolveChannelTtsVoiceDelivery: (channel: string | undefined) => {
    const normalized = channel?.trim().toLowerCase();
    if (normalized === "voice-memo-chat") {
      return {
        synthesisTarget: "audio-file",
        audioFileFormats: ["mp3", "caf", "audio/mpeg", "audio/x-caf"],
        preferAudioFileFormat: "caf",
      };
    }
    if (
      normalized === "discord" ||
      normalized === "feishu" ||
      normalized === "telegram" ||
      normalized === "whatsapp"
    ) {
      return { synthesisTarget: "voice-note", transcodesAudio: true };
    }
    if (normalized === "matrix") {
      return { synthesisTarget: "voice-note" };
    }
    return undefined;
  },
}));

vi.mock("../api.js", async () => {
  const actual = await vi.importActual<typeof import("../api.js")>("../api.js");
  const mockProvider: SpeechProviderPlugin = {
    id: "mock",
    label: "Mock",
    autoSelectOrder: 1,
    isConfigured: () => true,
    prepareSynthesis: prepareSynthesisMock,
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

const {
  testApi,
  buildTtsSystemPromptHint,
  getTtsPersona,
  getTtsProvider,
  maybeApplyTtsToPayload,
  resolveTtsConfig,
  setSummarizationEnabled,
  setTtsMaxLength,
  synthesizeSpeech,
  textToSpeechTelephony,
} = await import("./tts.js");

const nativeVoiceNoteChannels = ["discord", "feishu", "matrix", "telegram", "whatsapp"] as const;

function createMockSpeechProvider(
  id = "mock",
  options: Partial<SpeechProviderPlugin> = {},
): SpeechProviderPlugin {
  return {
    id,
    label: id,
    autoSelectOrder: id === "mock" ? 1 : 2,
    isConfigured: () => true,
    prepareSynthesis: prepareSynthesisMock,
    synthesize: synthesizeMock,
    ...options,
  };
}

function installSpeechProviders(providers: SpeechProviderPlugin[]): void {
  listSpeechProvidersMock.mockImplementation(() => providers);
  getSpeechProviderMock.mockImplementation(
    (providerId: string) => providers.find((provider) => provider.id === providerId) ?? null,
  );
}

function createTtsConfig(prefsName: string, mode?: "final" | "all"): OpenClawConfig {
  return {
    messages: {
      tts: {
        enabled: true,
        provider: "mock",
        prefsPath: `/tmp/${prefsName}.json`,
        ...(mode ? { mode } : {}),
      },
    },
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`expected ${label} to be a record`);
  }
  return value as Record<string, unknown>;
}

function requireFirstCallParam(calls: ReadonlyArray<readonly unknown[]>, label: string) {
  const call = calls[0];
  if (!call) {
    throw new Error(`expected ${label} call`);
  }
  return call[0];
}

function requireFirstSynthesisRequest(label: string): Record<string, unknown> {
  return requireRecord(requireFirstCallParam(synthesizeMock.mock.calls, label), label);
}

function requireAttempt(attempts: unknown[] | undefined, index: number) {
  if (!attempts) {
    throw new Error("expected synthesis attempts");
  }
  return requireRecord(attempts[index], `synthesis attempt ${index}`);
}

async function expectTtsPayloadResult(params: {
  channel: string;
  prefsName: string;
  text: string;
  target: "voice-note" | "audio-file";
  audioAsVoice: true | undefined;
  providerResult?: MockSpeechSynthesisResult;
  mediaExtension?: string;
  kind?: "tool" | "block" | "final";
}) {
  if (params.providerResult) {
    synthesizeMock.mockResolvedValueOnce(params.providerResult);
  }
  const cfg = createTtsConfig(params.prefsName);
  let mediaDir: string | undefined;
  try {
    const result = await maybeApplyTtsToPayload({
      payload: { text: params.text },
      cfg,
      channel: params.channel,
      kind: params.kind ?? "final",
    });

    expect(synthesizeMock).toHaveBeenCalled();
    const request = requireRecord(
      synthesizeMock.mock.calls.at(-1)?.[0],
      "latest synthesis request",
    );
    expect(request.target).toBe(params.target);
    expect(result.audioAsVoice).toBe(params.audioAsVoice);
    expect(result.mediaUrl).toMatch(new RegExp(`voice-\\d+\\.${params.mediaExtension ?? "ogg"}$`));
    expect(result.spokenText).toBe(params.text);
    expect(result.ttsSupplement).toEqual({ spokenText: params.text });
    expect((result as { trustedLocalMedia?: boolean }).trustedLocalMedia).toBe(true);

    mediaDir = result.mediaUrl ? path.dirname(result.mediaUrl) : undefined;
  } finally {
    if (mediaDir) {
      rmSync(mediaDir, { recursive: true, force: true });
    }
  }
}

describe("speech-core native voice-note routing", () => {
  afterEach(() => {
    clearRuntimeConfigSnapshot();
    synthesizeMock.mockClear();
    prepareSynthesisMock.mockClear();
    transcodeAudioBufferMock.mockClear();
    installSpeechProviders([createMockSpeechProvider()]);
  });

  it("resolves voice delivery support from channel capabilities", () => {
    for (const channel of nativeVoiceNoteChannels) {
      expect(testApi.supportsNativeVoiceNoteTts(channel)).toBe(true);
      expect(testApi.supportsNativeVoiceNoteTts(channel.toUpperCase())).toBe(true);
    }
    expect(testApi.supportsNativeVoiceNoteTts("slack")).toBe(false);
    expect(testApi.supportsNativeVoiceNoteTts(undefined)).toBe(false);
  });

  it("tells generic TTS guidance to defer to MEMORY voice-delivery instructions", () => {
    const hint = buildTtsSystemPromptHint(createTtsConfig("openclaw-speech-core-tts-hint-test"));

    expect(hint).toContain("Voice (TTS) is enabled.");
    expect(hint).toContain(
      "If workspace context (especially MEMORY.md) tells you not to use [[tts:...]] or to use a local/non-tagged voice workflow, follow that workspace instruction instead.",
    );
    expect(hint).toContain(
      "Use [[tts:...]] and optional [[tts:text]]...[[/tts:text]] to control voice/expressiveness.",
    );
  });

  it("marks Discord auto TTS replies as native voice messages", async () => {
    await expectTtsPayloadResult({
      channel: "discord",
      prefsName: "openclaw-speech-core-tts-test",
      text: "This Discord reply should be delivered as a native voice note.",
      target: "voice-note",
      audioAsVoice: true,
    });
  });

  it("keeps compatible audio-file synthesis deliverable as a voice memo", async () => {
    await expectTtsPayloadResult({
      channel: "voice-memo-chat",
      prefsName: "openclaw-speech-core-tts-voice-memo-mp3-test",
      text: "This reply should be delivered as a native voice memo.",
      target: "audio-file",
      audioAsVoice: true,
      mediaExtension: "mp3",
      providerResult: {
        audioBuffer: Buffer.from("mp3"),
        outputFormat: "mp3",
        fileExtension: ".mp3",
        voiceCompatible: false,
      },
    });
  });

  it("does not mark unsupported audio-file output as a voice memo", async () => {
    await expectTtsPayloadResult({
      channel: "voice-memo-chat",
      prefsName: "openclaw-speech-core-tts-voice-memo-ogg-test",
      text: "This reply should stay a regular audio attachment.",
      target: "audio-file",
      audioAsVoice: undefined,
    });
  });

  it("pre-transcodes synthesized mp3 to opus-in-CAF when the host can satisfy preferAudioFileFormat", async () => {
    transcodeAudioBufferMock.mockResolvedValueOnce({
      ok: true,
      buffer: Buffer.from("transcoded-caf"),
    });
    await expectTtsPayloadResult({
      channel: "voice-memo-chat",
      prefsName: "openclaw-speech-core-tts-voice-memo-caf-transcode-test",
      text: "This reply should be pre-transcoded to a native voice-memo CAF.",
      target: "audio-file",
      audioAsVoice: true,
      mediaExtension: "caf",
      providerResult: {
        audioBuffer: Buffer.from("mp3"),
        outputFormat: "mp3",
        fileExtension: ".mp3",
        voiceCompatible: false,
      },
    });
    expect(transcodeAudioBufferMock).toHaveBeenCalledOnce();
    const transcodeRequest = requireRecord(
      requireFirstCallParam(transcodeAudioBufferMock.mock.calls as unknown[][], "transcode"),
      "transcode request",
    );
    expect(transcodeRequest.sourceExtension).toBe("mp3");
    expect(transcodeRequest.targetExtension).toBe("caf");
  });

  it("falls back to the original mp3 buffer when the host transcoder fails", async () => {
    transcodeAudioBufferMock.mockResolvedValueOnce({
      ok: false,
      reason: "transcoder-failed",
      detail: "exit-1",
    });
    // Even though the transcode failed, the original mp3 still satisfies the
    // channel audioFileFormats list, so the channel still flips audioAsVoice.
    // The user gets a voice memo bubble, possibly with bad duration, instead
    // of a regression. The failure is logged via the call site in tts.ts.
    await expectTtsPayloadResult({
      channel: "voice-memo-chat",
      prefsName: "openclaw-speech-core-tts-voice-memo-caf-fallback-test",
      text: "This reply should fall back to the original mp3.",
      target: "audio-file",
      audioAsVoice: true,
      mediaExtension: "mp3",
      providerResult: {
        audioBuffer: Buffer.from("mp3"),
        outputFormat: "mp3",
        fileExtension: ".mp3",
        voiceCompatible: false,
      },
    });
  });

  it("uses the active runtime snapshot when source config still contains TTS SecretRefs", async () => {
    const sourceConfig = {
      messages: {
        tts: {
          enabled: true,
          provider: "mock",
          providers: {
            mock: {
              apiKey: { source: "exec", provider: "mockexec", id: "minimax/tts/apiKey" },
            },
          },
        },
      },
    } as unknown as OpenClawConfig;
    const runtimeConfig = {
      messages: {
        tts: {
          enabled: true,
          provider: "mock",
          providers: {
            mock: {
              apiKey: "resolved-minimax-key",
            },
          },
        },
      },
    } as unknown as OpenClawConfig;
    installSpeechProviders([
      createMockSpeechProvider("mock", {
        isConfigured: ({ providerConfig }) => providerConfig.apiKey === "resolved-minimax-key",
        resolveConfig: ({ rawConfig }) => {
          const providers = rawConfig.providers as Record<string, { apiKey?: unknown }> | undefined;
          return {
            apiKey: providers?.mock?.apiKey,
          };
        },
      }),
    ]);
    setRuntimeConfigSnapshot(runtimeConfig, sourceConfig);

    const result = await synthesizeSpeech({
      text: "Runtime snapshot TTS SecretRef",
      cfg: sourceConfig,
      disableFallback: true,
    });

    expect(result.success).toBe(true);
    expect(synthesizeMock).toHaveBeenCalled();
    const request = requireFirstSynthesisRequest("runtime snapshot synthesis request");
    expect(request.cfg).toBe(runtimeConfig);
    const providerConfig = requireRecord(request.providerConfig, "provider config");
    expect(providerConfig.apiKey).toBe("resolved-minimax-key");
  });

  it("uses provider default TTS timeout when the call and config omit timeoutMs", async () => {
    installSpeechProviders([createMockSpeechProvider("mock", { defaultTimeoutMs: 600_000 })]);

    const result = await synthesizeSpeech({
      text: "Use provider timeout.",
      cfg: {
        messages: {
          tts: {
            enabled: true,
            provider: "mock",
          },
        },
      } as OpenClawConfig,
      disableFallback: true,
    });

    expect(result.success).toBe(true);
    const request = requireFirstSynthesisRequest("provider default timeout synthesis request");
    expect(request.timeoutMs).toBe(600_000);
  });

  it("keeps explicit TTS config timeout ahead of provider default timeout", async () => {
    installSpeechProviders([createMockSpeechProvider("mock", { defaultTimeoutMs: 600_000 })]);

    await synthesizeSpeech({
      text: "Use configured timeout.",
      cfg: {
        messages: {
          tts: {
            enabled: true,
            provider: "mock",
            timeoutMs: 45_000,
          },
        },
      } as OpenClawConfig,
      disableFallback: true,
    });

    const request = requireFirstSynthesisRequest("configured timeout synthesis request");
    expect(request.timeoutMs).toBe(45_000);
  });

  it.each(["discord", "feishu", "telegram", "whatsapp"] as const)(
    "marks %s voice-note TTS for channel-side transcoding when provider returns mp3",
    async (channel) => {
      expect(testApi.supportsTranscodedVoiceNoteTts(channel)).toBe(true);
      await expectTtsPayloadResult({
        channel,
        prefsName: `openclaw-speech-core-tts-${channel}-mp3-test`,
        text: `This ${channel} reply should be transcoded by the channel.`,
        target: "voice-note",
        audioAsVoice: true,
        mediaExtension: "mp3",
        providerResult: {
          audioBuffer: Buffer.from("mp3"),
          outputFormat: "mp3",
          fileExtension: ".mp3",
          voiceCompatible: false,
        },
      });
    },
  );

  it.each(["discord", "telegram"] as const)(
    "marks %s wav TTS as voice media for channel-side transcoding",
    async (channel) => {
      expect(testApi.supportsTranscodedVoiceNoteTts(channel)).toBe(true);
      await expectTtsPayloadResult({
        channel,
        prefsName: `openclaw-speech-core-tts-${channel}-wav-transcode-test`,
        text: `This ${channel} reply should be handed to the channel voice transcoder.`,
        target: "voice-note",
        audioAsVoice: true,
        mediaExtension: "wav",
        providerResult: {
          audioBuffer: Buffer.from("wav"),
          outputFormat: "wav",
          fileExtension: ".wav",
          voiceCompatible: false,
        },
      });
    },
  );

  it("keeps non-native voice-note channels as regular audio files", async () => {
    await expectTtsPayloadResult({
      channel: "slack",
      prefsName: "openclaw-speech-core-tts-slack-test",
      text: "Slack replies should be delivered as regular audio attachments.",
      target: "audio-file",
      audioAsVoice: undefined,
    });
  });

  it("synthesizes explicitly tagged short hidden TTS text", async () => {
    const cfg = createTtsConfig("openclaw-speech-core-short-hidden-tts-test");
    let mediaDir: string | undefined;
    try {
      const result = await maybeApplyTtsToPayload({
        payload: {
          text: "[[tts:text]]hello[[/tts:text]]",
          audioAsVoice: true,
        },
        cfg,
        channel: "telegram",
        kind: "final",
      });

      expect(synthesizeMock).toHaveBeenCalled();
      const request = requireFirstSynthesisRequest("hidden TTS request");
      expect(request.text).toBe("hello");
      expect(result.mediaUrl).toMatch(/voice-\d+\.ogg$/);
      expect(result.audioAsVoice).toBe(true);
      expect(result.text).toBeUndefined();
      expect(result.ttsSupplement).toBeUndefined();
      mediaDir = result.mediaUrl ? path.dirname(result.mediaUrl) : undefined;
    } finally {
      if (mediaDir) {
        rmSync(mediaDir, { recursive: true, force: true });
      }
    }
  });

  it("truncates long TTS text on a UTF-16 boundary", async () => {
    const prefsName = "openclaw-speech-core-utf16-truncate-test";
    const prefsPath = `/tmp/${prefsName}.json`;
    const cfg = createTtsConfig(prefsName);
    setTtsMaxLength(prefsPath, 11);
    setSummarizationEnabled(prefsPath, false);
    let mediaDir: string | undefined;
    try {
      const result = await maybeApplyTtsToPayload({
        payload: { text: `${"a".repeat(7)}😀tail long enough for TTS` },
        cfg,
        channel: "telegram",
        kind: "final",
      });

      expect(synthesizeMock).toHaveBeenCalled();
      const request = requireFirstSynthesisRequest("utf16 truncated TTS request");
      const spokenText = String(request.text);
      expect(spokenText).toBe(`${"a".repeat(7)}...`);
      expect(result.spokenText).toBe(spokenText);
      mediaDir = result.mediaUrl ? path.dirname(result.mediaUrl) : undefined;
    } finally {
      rmSync(prefsPath, { force: true });
      if (mediaDir) {
        rmSync(mediaDir, { recursive: true, force: true });
      }
    }
  });

  it("skips block delivery kind in final mode (accumulated final tail synthesizes instead)", async () => {
    synthesizeMock.mockClear();
    const cfg = createTtsConfig("openclaw-speech-core-block-kind-tts-test");
    const result = await maybeApplyTtsToPayload({
      payload: { text: "WebChat block stream chunks defer TTS to the final tail." },
      cfg,
      channel: "webchat",
      kind: "block",
    });

    expect(synthesizeMock).not.toHaveBeenCalled();
    expect((result as { trustedLocalMedia?: boolean }).trustedLocalMedia).toBeUndefined();
    expect(result.text).toBe("WebChat block stream chunks defer TTS to the final tail.");
  });

  it("skips tool delivery kind in final mode", async () => {
    synthesizeMock.mockClear();
    const cfg = createTtsConfig("openclaw-speech-core-tool-kind-tts-test");
    const result = await maybeApplyTtsToPayload({
      payload: { text: "Intermediate tool output should not be spoken." },
      cfg,
      channel: "webchat",
      kind: "tool",
    });

    expect(synthesizeMock).not.toHaveBeenCalled();
    expect((result as { trustedLocalMedia?: boolean }).trustedLocalMedia).toBeUndefined();
    expect(result.text).toBe("Intermediate tool output should not be spoken.");
  });

  it("skips tool delivery kind even in all mode", async () => {
    synthesizeMock.mockClear();
    const cfg = createTtsConfig("openclaw-speech-core-tool-kind-all-mode-tts-test", "all");
    const result = await maybeApplyTtsToPayload({
      payload: { text: "Intermediate tool output should not be spoken in all mode." },
      cfg,
      channel: "webchat",
      kind: "tool",
    });

    expect(synthesizeMock).not.toHaveBeenCalled();
    expect(result.text).toBe("Intermediate tool output should not be spoken in all mode.");
  });

  it("still synthesizes block delivery kind in all mode (only tool output is withheld)", async () => {
    synthesizeMock.mockClear();
    const cfg = createTtsConfig("openclaw-speech-core-block-kind-all-mode-tts-test", "all");
    await maybeApplyTtsToPayload({
      payload: { text: "Streaming assistant block content is voiced in all mode." },
      cfg,
      channel: "webchat",
      kind: "block",
    });

    expect(synthesizeMock).toHaveBeenCalledTimes(1);
  });

  it("keeps skipping untagged short TTS text", async () => {
    const cfg = createTtsConfig("openclaw-speech-core-short-plain-tts-test");
    const result = await maybeApplyTtsToPayload({
      payload: {
        text: "hello",
        audioAsVoice: true,
      },
      cfg,
      channel: "telegram",
      kind: "final",
    });

    expect(synthesizeMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      text: "hello",
      audioAsVoice: true,
    });
  });

  it("keeps skipping explicit tagged TTS text that strips to empty markdown", async () => {
    const cfg = createTtsConfig("openclaw-speech-core-empty-hidden-tts-test");
    const result = await maybeApplyTtsToPayload({
      payload: {
        text: "[[tts:text]]***[[/tts:text]]",
        audioAsVoice: true,
      },
      cfg,
      channel: "telegram",
      kind: "final",
    });

    expect(synthesizeMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      audioAsVoice: true,
    });
  });

  it("selects persona preferred provider before config fallback", () => {
    const cfg: OpenClawConfig = {
      messages: {
        tts: {
          enabled: true,
          provider: "other",
          persona: "alfred",
          personas: {
            alfred: {
              label: "Alfred",
              provider: "mock",
              providers: {
                mock: {
                  voice: "Algieba",
                },
              },
            },
          },
        },
      },
    };
    const config = resolveTtsConfig(cfg);
    const prefsPath = "/tmp/openclaw-speech-core-persona-provider.json";

    expect(getTtsPersona(config, prefsPath)?.id).toBe("alfred");
    expect(getTtsProvider(config, prefsPath)).toBe("mock");
  });

  it("merges active persona provider binding into synthesis config", async () => {
    const cfg: OpenClawConfig = {
      messages: {
        tts: {
          enabled: true,
          provider: "mock",
          prefsPath: "/tmp/openclaw-speech-core-persona-merge.json",
          providers: {
            mock: {
              model: "base-model",
              voice: "base-voice",
            },
          },
          persona: "alfred",
          personas: {
            alfred: {
              provider: "mock",
              providers: {
                mock: {
                  voice: "persona-voice",
                  style: "dry",
                },
              },
            },
          },
        },
      },
    };

    const payload: ReplyPayload = {
      text: "This reply should use persona-specific provider configuration.",
    };

    let mediaDir: string | undefined;
    try {
      const result = await maybeApplyTtsToPayload({
        payload,
        cfg,
        channel: "slack",
        kind: "final",
      });

      expect(synthesizeMock).toHaveBeenCalled();
      const request = requireFirstSynthesisRequest("persona synthesis request");
      const providerConfig = requireRecord(request.providerConfig, "persona provider config");
      expect(providerConfig.model).toBe("base-model");
      expect(providerConfig.voice).toBe("persona-voice");
      expect(providerConfig.style).toBe("dry");
      expect(result.mediaUrl).toMatch(/voice-\d+\.ogg$/);

      mediaDir = result.mediaUrl ? path.dirname(result.mediaUrl) : undefined;
    } finally {
      if (mediaDir) {
        rmSync(mediaDir, { recursive: true, force: true });
      }
    }
  });

  it("does not mark skipped unregistered providers as missing persona bindings", async () => {
    const result = await synthesizeSpeech({
      text: "Use fallback provider.",
      cfg: {
        messages: {
          tts: {
            enabled: true,
            provider: "missing",
            persona: "alfred",
            personas: {
              alfred: {
                providers: {
                  missing: {
                    voice: "configured-but-unregistered",
                  },
                },
              },
            },
          },
        },
      },
    });

    expect(result.success).toBe(true);
    const attempt = requireAttempt(result.attempts, 0);
    expect(attempt.provider).toBe("missing");
    expect(attempt.outcome).toBe("skipped");
    expect(attempt.reasonCode).toBe("no_provider_registered");
    expect(attempt.persona).toBe("alfred");
    expect(attempt).not.toHaveProperty("personaBinding");
  });

  it("does not mark skipped telephony providers as missing persona bindings", async () => {
    const result = await textToSpeechTelephony({
      text: "Use telephony provider.",
      cfg: {
        messages: {
          tts: {
            enabled: true,
            provider: "mock",
            persona: "alfred",
            personas: {
              alfred: {
                providers: {
                  mock: {
                    voice: "persona-voice",
                  },
                },
              },
            },
          },
        },
      },
    });

    expect(result.success).toBe(false);
    const attempt = requireAttempt(result.attempts, 0);
    expect(attempt.provider).toBe("mock");
    expect(attempt.outcome).toBe("skipped");
    expect(attempt.reasonCode).toBe("unsupported_for_telephony");
    expect(attempt.persona).toBe("alfred");
    expect(attempt).not.toHaveProperty("personaBinding");
  });

  it("passes directive overrides to telephony synthesis providers", async () => {
    const synthesizeTelephony = vi.fn(async (_request: SpeechTelephonySynthesisRequest) => ({
      audioBuffer: Buffer.from("voice"),
      outputFormat: "pcm",
      sampleRate: 24000,
    }));
    installSpeechProviders([
      createMockSpeechProvider("mock", {
        synthesizeTelephony,
      }),
    ]);

    const result = await textToSpeechTelephony({
      text: "Use a directed telephony voice.",
      cfg: {
        messages: {
          tts: {
            enabled: true,
            provider: "mock",
            providers: {
              mock: {
                modelId: "telephony-model",
                voiceId: "default-voice",
              },
            },
          },
        },
      },
      overrides: {
        providerOverrides: {
          mock: {
            voice: "directed-voice",
          },
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.providerModel).toBe("telephony-model");
    expect(result.providerVoice).toBe("directed-voice");
    expect(synthesizeTelephony).toHaveBeenCalledOnce();
    const telephonyRequest = requireRecord(
      requireFirstCallParam(synthesizeTelephony.mock.calls, "telephony synthesis"),
      "telephony synthesis request",
    );
    expect(telephonyRequest.providerOverrides).toEqual({ voice: "directed-voice" });
  });

  it("rejects telephony text above the resolved provider/model limit", async () => {
    const synthesizeTelephony = vi.fn(async (_request: SpeechTelephonySynthesisRequest) => ({
      audioBuffer: Buffer.from("voice"),
      outputFormat: "pcm",
      sampleRate: 24_000,
    }));
    installSpeechProviders([
      createMockSpeechProvider("mock", {
        resolveSynthesisTextLimit: () => 120,
        synthesizeTelephony,
      }),
    ]);

    const result = await textToSpeechTelephony({
      text: "T".repeat(121),
      cfg: {
        messages: {
          tts: {
            enabled: true,
            provider: "mock",
            maxTextLength: 1_000,
          },
        },
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Text too long (121 chars, max 120)");
    expect(synthesizeTelephony).not.toHaveBeenCalled();
  });

  it("uses provider defaults when fallback policy allows missing persona bindings", async () => {
    await synthesizeSpeech({
      text: "Use neutral provider defaults.",
      cfg: {
        messages: {
          tts: {
            enabled: true,
            provider: "mock",
            persona: "alfred",
            personas: {
              alfred: {
                fallbackPolicy: "provider-defaults",
                prompt: {
                  profile: "A precise butler.",
                },
              },
            },
          },
        },
      },
    });

    expect(prepareSynthesisMock).toHaveBeenCalledOnce();
    const prepareContext = requireRecord(
      requireFirstCallParam(prepareSynthesisMock.mock.calls, "prepare synthesis"),
      "prepare synthesis context",
    );
    expect(prepareContext.persona).toBeUndefined();
    expect(prepareContext.personaProviderConfig).toBeUndefined();
  });

  it("preserves persona prompts by default when provider bindings are missing", async () => {
    await synthesizeSpeech({
      text: "Use persona prompt.",
      cfg: {
        messages: {
          tts: {
            enabled: true,
            provider: "mock",
            persona: "alfred",
            personas: {
              alfred: {
                prompt: {
                  profile: "A precise butler.",
                },
              },
            },
          },
        },
      },
    });

    expect(prepareSynthesisMock).toHaveBeenCalledOnce();
    const prepareContext = requireRecord(
      requireFirstCallParam(prepareSynthesisMock.mock.calls, "prepare synthesis"),
      "prepare synthesis context",
    );
    const persona = requireRecord(prepareContext.persona, "prepare synthesis persona");
    expect(persona.id).toBe("alfred");
    expect(prepareContext.personaProviderConfig).toBeUndefined();
  });

  it("skips unbound providers under fail policy while allowing bound fallbacks", async () => {
    installSpeechProviders([
      createMockSpeechProvider("mock", { autoSelectOrder: 1 }),
      createMockSpeechProvider("fallback", { autoSelectOrder: 2 }),
    ]);

    const result = await synthesizeSpeech({
      text: "Use the first persona-bound provider.",
      cfg: {
        messages: {
          tts: {
            enabled: true,
            provider: "mock",
            persona: "alfred",
            personas: {
              alfred: {
                fallbackPolicy: "fail",
                providers: {
                  fallback: {
                    voice: "fallback-voice",
                  },
                },
              },
            },
          },
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.provider).toBe("fallback");
    expect(result.fallbackFrom).toBe("mock");
    const skippedAttempt = requireAttempt(result.attempts, 0);
    expect(skippedAttempt.provider).toBe("mock");
    expect(skippedAttempt.outcome).toBe("skipped");
    expect(skippedAttempt.reasonCode).toBe("not_configured");
    expect(skippedAttempt.persona).toBe("alfred");
    expect(skippedAttempt.personaBinding).toBe("missing");
    expect(skippedAttempt.error).toBe("mock: persona alfred has no provider binding");
    const successAttempt = requireAttempt(result.attempts, 1);
    expect(successAttempt.provider).toBe("fallback");
    expect(successAttempt.outcome).toBe("success");
    expect(successAttempt.persona).toBe("alfred");
    expect(successAttempt.personaBinding).toBe("applied");
  });

  it("carries prepareHook text and provider overrides to a provider with no prepareSynthesis", async () => {
    // Guards the passthrough-return branch of prepareSpeechSynthesis: for a
    // provider that registers no prepareSynthesis (ElevenLabs' shape), the
    // tts_prepare hook result is the ONLY carrier of the enriched text and
    // per-request provider overrides into synthesize(). A stub provider with
    // prepareSynthesis explicitly unset exercises exactly that path.
    installSpeechProviders([createMockSpeechProvider("mock", { prepareSynthesis: undefined })]);
    const prepareHook = vi.fn(async () => ({
      text: "<enriched>",
      providerOverrides: { applyTextNormalization: "off" },
    }));

    const result = await synthesizeSpeech({
      text: "Original text before enrichment.",
      cfg: createTtsConfig("openclaw-speech-core-prepare-hook-passthrough-test"),
      disableFallback: true,
      prepareHook,
    });

    expect(result.success).toBe(true);
    expect(prepareHook).toHaveBeenCalledOnce();
    // The provider has no prepareSynthesis, so the shared prepareSynthesis mock
    // must not fire — proving synthesize() received the hook result directly.
    expect(prepareSynthesisMock).not.toHaveBeenCalled();
    const request = requireFirstSynthesisRequest("prepare-hook passthrough synthesis request");
    expect(request.text).toBe("<enriched>");
    expect(request.providerOverrides).toEqual({ applyTextNormalization: "off" });
  });

  it("fails open to the original text when the prepareHook throws", async () => {
    // speech-core must swallow a thrown Layer-A hook and synthesize the original.
    installSpeechProviders([createMockSpeechProvider("mock", { prepareSynthesis: undefined })]);
    const prepareHook = vi.fn(async () => {
      throw new Error("hook boom");
    });

    const result = await synthesizeSpeech({
      text: "Original text before enrichment.",
      cfg: createTtsConfig("openclaw-speech-core-prepare-hook-throw-test"),
      disableFallback: true,
      prepareHook,
    });

    expect(result.success).toBe(true);
    expect(prepareHook).toHaveBeenCalledOnce();
    expect(requireFirstSynthesisRequest("prepare-hook throw synthesis request").text).toBe(
      "Original text before enrichment.",
    );
  });

  it("lets provider prepareSynthesis overrides win over hook overrides on conflict", async () => {
    // Merge precedence: hook overrides apply first, then the provider's own
    // prepareSynthesis overrides spread last and win on any shared key.
    const prepareSynthesis = vi.fn(async () => ({
      providerOverrides: { shared: "from-provider" },
    }));
    installSpeechProviders([createMockSpeechProvider("mock", { prepareSynthesis })]);
    const prepareHook = vi.fn(async () => ({
      text: "<hook-text>",
      providerOverrides: { shared: "from-hook", onlyHook: "kept" },
    }));

    const result = await synthesizeSpeech({
      text: "Original.",
      cfg: createTtsConfig("openclaw-speech-core-prepare-hook-merge-test"),
      disableFallback: true,
      prepareHook,
    });

    expect(result.success).toBe(true);
    const request = requireFirstSynthesisRequest("prepare-hook merge synthesis request");
    // Provider returned no text → hook text carried; provider override wins the
    // conflict; the hook's non-conflicting override survives.
    expect(request.text).toBe("<hook-text>");
    expect(request.providerOverrides).toEqual({ shared: "from-provider", onlyHook: "kept" });
  });

  it("threads providerId and the attempt index into the hook input", async () => {
    installSpeechProviders([createMockSpeechProvider("mock", { prepareSynthesis: undefined })]);
    const seen: Array<{ providerId: string; attempt: number }> = [];
    const prepareHook = vi.fn(async (input: { providerId: string; attempt: number }) => {
      seen.push({ providerId: input.providerId, attempt: input.attempt });
      return undefined;
    });

    const result = await synthesizeSpeech({
      text: "Original.",
      cfg: createTtsConfig("openclaw-speech-core-prepare-hook-input-test"),
      disableFallback: true,
      prepareHook,
    });

    expect(result.success).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.providerId).toBe("mock");
    expect(seen[0]?.attempt).toBe(0);
  });

  describe("provider/model text-limit pipeline", () => {
    function limitedConfig(name: string, maxTextLength = 1_000): OpenClawConfig {
      return {
        messages: {
          tts: {
            ...createTtsConfig(name).messages?.tts,
            maxTextLength,
          },
        },
      };
    }

    function summaryResult(summary: string, inputLength: number) {
      return {
        summary,
        latencyMs: 0,
        inputLength,
        outputLength: summary.length,
      };
    }

    it("summarizes over the model limit, enriches the fitted text, and sends that exact text", async () => {
      installSpeechProviders([
        createMockSpeechProvider("mock", {
          prepareSynthesis: undefined,
          resolveSynthesisTextLimit: () => 120,
        }),
      ]);
      const input = "Original material. ".repeat(20);
      const summary = "A concise summary that remains safely below the selected model limit.";
      const summarize = vi.fn(async () => summaryResult(summary, input.length));
      const prepareHook = vi.fn(async (event: { text: string; maxTextLength: number }) => ({
        text: `[warm] ${event.text}`,
        providerOverrides: { applyTextNormalization: "off" },
      }));

      const result = await testApi.synthesizeSpeechWithDeps(
        {
          text: input,
          cfg: limitedConfig("openclaw-speech-core-provider-limit-e2e"),
          disableFallback: true,
          prepareHook,
        },
        { summarizeText: summarize },
      );

      expect(result.success).toBe(true);
      expect(result.summarized).toBe(true);
      expect(result.preparedInputText).toBe(summary);
      expect(summarize).toHaveBeenCalledWith(
        expect.objectContaining({ text: input, targetLength: 120 }),
      );
      expect(prepareHook).toHaveBeenCalledWith(
        expect.objectContaining({ text: summary, maxTextLength: 120, attempt: 0 }),
      );
      const request = requireFirstSynthesisRequest("provider-limit enriched request");
      expect(request.text).toBe(`[warm] ${summary}`);
      expect(request.providerOverrides).toEqual({ applyTextNormalization: "off" });
      expect(String(request.text).length).toBeLessThanOrEqual(120);
    });

    it("carries accepted enrichment through provider prepareSynthesis into synthesis", async () => {
      const providerPrepare = vi.fn(async (ctx: SpeechProviderPrepareSynthesisContext) => ({
        text: `provider-wrapper(${ctx.text})`,
      }));
      installSpeechProviders([
        createMockSpeechProvider("mock", {
          prepareSynthesis: providerPrepare,
          resolveSynthesisTextLimit: () => 140,
        }),
      ]);
      const input = "B".repeat(240);
      const summary = "A fitted summary for the provider-owned preparation branch.";
      const summarize = vi.fn(async () => summaryResult(summary, input.length));
      const prepareHook = vi.fn(async ({ text }: { text: string }) => ({ text: `[calm] ${text}` }));

      const result = await testApi.synthesizeSpeechWithDeps(
        {
          text: input,
          cfg: limitedConfig("openclaw-speech-core-provider-prepare-e2e"),
          disableFallback: true,
          prepareHook,
        },
        { summarizeText: summarize },
      );

      expect(result.success).toBe(true);
      expect(providerPrepare).toHaveBeenCalledWith(
        expect.objectContaining({ text: `[calm] ${summary}` }),
      );
      expect(requireFirstSynthesisRequest("provider prepare synthesis request").text).toBe(
        `provider-wrapper([calm] ${summary})`,
      );
    });

    it("rejects an over-limit hook transformation and its coupled overrides", async () => {
      installSpeechProviders([
        createMockSpeechProvider("mock", {
          prepareSynthesis: undefined,
          resolveSynthesisTextLimit: () => 120,
        }),
      ]);
      const input = "C".repeat(240);
      const summary = "S".repeat(115);
      const summarize = vi.fn(async () => summaryResult(summary, input.length));
      const prepareHook = vi.fn(async () => ({
        text: `[far too expressive] ${summary}`,
        providerOverrides: { unsafeForPlainText: true },
      }));

      const result = await testApi.synthesizeSpeechWithDeps(
        {
          text: input,
          cfg: limitedConfig("openclaw-speech-core-over-limit-hook"),
          disableFallback: true,
          prepareHook,
        },
        { summarizeText: summarize },
      );

      expect(result.success).toBe(true);
      const request = requireFirstSynthesisRequest("over-limit hook fallback request");
      expect(request.text).toBe(summary);
      expect(request.providerOverrides).toBeUndefined();
    });

    it.each([
      {
        name: "summary failure",
        summarize: async () => {
          throw new Error("summary backend unavailable");
        },
        expectedSummaryFlag: false,
      },
      {
        name: "empty summary",
        summarize: async (input: { text: string }) => summaryResult("", input.text.length),
        expectedSummaryFlag: false,
      },
      {
        name: "over-limit summary",
        summarize: async (input: { text: string }) =>
          summaryResult(`${"D".repeat(119)}😀`, input.text.length),
        expectedSummaryFlag: true,
      },
    ])("uses a UTF-16-safe bounded fallback for $name", async (testCase) => {
      installSpeechProviders([
        createMockSpeechProvider("mock", {
          prepareSynthesis: undefined,
          resolveSynthesisTextLimit: () => 120,
        }),
      ]);
      const input = `${"😀".repeat(80)} trailing material`;
      const summarize = vi.fn(testCase.summarize);

      const result = await testApi.synthesizeSpeechWithDeps(
        {
          text: input,
          cfg: limitedConfig(`openclaw-speech-core-${testCase.name.replaceAll(" ", "-")}`),
          disableFallback: true,
        },
        { summarizeText: summarize as never },
      );

      expect(result.success).toBe(true);
      expect(result.summarized).toBe(testCase.expectedSummaryFlag);
      const sent = String(requireFirstSynthesisRequest(`${testCase.name} request`).text);
      expect(sent.length).toBeLessThanOrEqual(120);
      expect(sent).not.toContain("\uFFFD");
      expect(sent).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
      expect(sent).not.toMatch(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
    });

    it("uses bounded truncation without calling the summary model when summarization is disabled", async () => {
      installSpeechProviders([
        createMockSpeechProvider("mock", {
          prepareSynthesis: undefined,
          resolveSynthesisTextLimit: () => 120,
        }),
      ]);
      const prefsPath = "/tmp/openclaw-speech-core-summary-disabled.json";
      const summarize = vi.fn();
      setSummarizationEnabled(prefsPath, false);
      try {
        const result = await testApi.synthesizeSpeechWithDeps(
          {
            text: "G".repeat(240),
            cfg: limitedConfig("openclaw-speech-core-summary-disabled"),
            prefsPath,
            disableFallback: true,
          },
          { summarizeText: summarize as never },
        );

        expect(result.success).toBe(true);
        expect(result.summarized).toBe(false);
        expect(summarize).not.toHaveBeenCalled();
        expect(String(requireFirstSynthesisRequest("summary-disabled request").text).length).toBe(
          120,
        );
      } finally {
        rmSync(prefsPath, { force: true });
      }
    });

    it("does not call summarization when input already fits", async () => {
      installSpeechProviders([
        createMockSpeechProvider("mock", {
          prepareSynthesis: undefined,
          resolveSynthesisTextLimit: () => 120,
        }),
      ]);
      const summarize = vi.fn();

      const result = await testApi.synthesizeSpeechWithDeps(
        {
          text: "Already short enough.",
          cfg: limitedConfig("openclaw-speech-core-under-limit"),
          disableFallback: true,
        },
        { summarizeText: summarize as never },
      );

      expect(result.success).toBe(true);
      expect(summarize).not.toHaveBeenCalled();
      expect(requireFirstSynthesisRequest("under-limit request").text).toBe(
        "Already short enough.",
      );
    });

    it("fits independently for fallback providers with different model limits", async () => {
      const primarySynthesize = vi.fn(async (_request: SpeechSynthesisRequest) => {
        throw new Error("primary failed");
      });
      const fallbackSynthesize = vi.fn(
        async (request: SpeechSynthesisRequest): Promise<MockSpeechSynthesisResult> => ({
          audioBuffer: Buffer.from("voice"),
          fileExtension: ".ogg",
          outputFormat: "ogg",
          voiceCompatible: request.target === "voice-note",
        }),
      );
      installSpeechProviders([
        createMockSpeechProvider("mock", {
          prepareSynthesis: undefined,
          resolveSynthesisTextLimit: () => 120,
          synthesize: primarySynthesize,
        }),
        createMockSpeechProvider("fallback", {
          prepareSynthesis: undefined,
          resolveSynthesisTextLimit: () => 180,
          synthesize: fallbackSynthesize,
        }),
      ]);
      const input = "E".repeat(300);
      const summarize = vi.fn(async ({ targetLength }: { targetLength: number }) => {
        const summary = `${targetLength}: ${"x".repeat(targetLength - 10)}`;
        return summaryResult(summary, input.length);
      });
      const seenHooks: Array<{ attempt: number; maxTextLength: number; text: string }> = [];
      const prepareHook = vi.fn(
        async (event: { attempt: number; maxTextLength: number; text: string }) => {
          seenHooks.push(event);
          return { text: event.text };
        },
      );

      const result = await testApi.synthesizeSpeechWithDeps(
        {
          text: input,
          cfg: limitedConfig("openclaw-speech-core-fallback-limits"),
          prepareHook,
        },
        { summarizeText: summarize as never },
      );

      expect(result.success).toBe(true);
      expect(result.provider).toBe("fallback");
      expect(summarize.mock.calls.map((call) => call[0].targetLength)).toEqual([120, 180]);
      expect(seenHooks.map(({ attempt, maxTextLength }) => ({ attempt, maxTextLength }))).toEqual([
        { attempt: 0, maxTextLength: 120 },
        { attempt: 1, maxTextLength: 180 },
      ]);
      expect(primarySynthesize.mock.calls[0]?.[0].text).toBe(seenHooks[0]?.text);
      expect(fallbackSynthesize.mock.calls[0]?.[0].text).toBe(seenHooks[1]?.text);
    });

    it("retries provider preparation with fitted text when hook wrapping exceeds the limit", async () => {
      const providerPrepare = vi.fn(async (ctx: SpeechProviderPrepareSynthesisContext) => ({
        text: ctx.providerOverrides?.personaPrompt
          ? `${String(ctx.providerOverrides.personaPrompt)}\n${ctx.text}`
          : ctx.text,
      }));
      installSpeechProviders([
        createMockSpeechProvider("mock", {
          resolveSynthesisTextLimit: () => 120,
          prepareSynthesis: providerPrepare,
        }),
      ]);
      const prepareHook = vi.fn(async () => ({
        providerOverrides: { personaPrompt: "director note ".repeat(10) },
      }));

      const result = await synthesizeSpeech({
        text: "The fitted spoken text remains unchanged.",
        cfg: limitedConfig("openclaw-speech-core-provider-hook-overflow"),
        disableFallback: true,
        prepareHook,
      });

      expect(result.success).toBe(true);
      expect(prepareHook).toHaveBeenCalledOnce();
      expect(providerPrepare).toHaveBeenCalledTimes(2);
      const request = requireFirstSynthesisRequest("provider hook-overflow retry request");
      expect(request.text).toBe("The fitted spoken text remains unchanged.");
      expect(request.providerOverrides).toBeUndefined();
    });

    it("streams the exact summarized and enriched text within the selected model limit", async () => {
      const streamSynthesize = vi.fn(async (_request: SpeechSynthesisStreamRequest) =>
        createMockSpeechStreamResult(),
      );
      installSpeechProviders([
        createMockSpeechProvider("mock", {
          prepareSynthesis: undefined,
          resolveSynthesisTextLimit: () => 120,
          streamSynthesize,
        }),
      ]);
      const input = "Streaming source material. ".repeat(20);
      const summary = "A bounded streaming summary.";
      const summarize = vi.fn(async () => summaryResult(summary, input.length));
      const prepareHook = vi.fn(async ({ text }: { text: string }) => ({
        text: `[warm] ${text}`,
      }));

      const result = await testApi.streamSpeechWithDeps(
        {
          text: input,
          cfg: limitedConfig("openclaw-speech-core-stream-summary"),
          disableFallback: true,
          prepareHook,
        },
        { summarizeText: summarize },
      );

      expect(result.success, result.error).toBe(true);
      expect(result.summarized).toBe(true);
      expect(result.preparedInputText).toBe(summary);
      expect(prepareHook).toHaveBeenCalledWith(
        expect.objectContaining({ text: summary, maxTextLength: 120 }),
      );
      expect(streamSynthesize).toHaveBeenCalledWith(
        expect.objectContaining({ text: `[warm] ${summary}` }),
      );
      expect(String(streamSynthesize.mock.calls[0]?.[0].text).length).toBeLessThanOrEqual(120);
    });

    it("fits streaming fallbacks independently for different provider model limits", async () => {
      const primaryStream = vi.fn(async (_request: SpeechSynthesisStreamRequest) => {
        throw new Error("primary stream failed");
      });
      const fallbackStream = vi.fn(async (_request: SpeechSynthesisStreamRequest) =>
        createMockSpeechStreamResult(),
      );
      installSpeechProviders([
        createMockSpeechProvider("mock", {
          models: ["stream-primary"],
          prepareSynthesis: undefined,
          resolveSynthesisTextLimit: () => 120,
          streamSynthesize: primaryStream,
        }),
        createMockSpeechProvider("fallback", {
          models: ["stream-fallback"],
          prepareSynthesis: undefined,
          resolveSynthesisTextLimit: () => 180,
          streamSynthesize: fallbackStream,
        }),
      ]);
      const input = "E".repeat(300);
      const summarize = vi.fn(async ({ targetLength }: { targetLength: number }) =>
        summaryResult(`${targetLength}: ${"x".repeat(targetLength - 10)}`, input.length),
      );
      const hookEvents: Array<{ attempt: number; providerModel?: string }> = [];
      const prepareHook = vi.fn(
        async (event: { attempt: number; providerModel?: string; text: string }) => {
          hookEvents.push(event);
          return { text: event.text };
        },
      );
      const cfg: OpenClawConfig = {
        ...limitedConfig("openclaw-speech-core-stream-fallback-limits"),
        agents: {
          defaults: {
            voiceModel: {
              primary: "mock/stream-primary",
              fallbacks: ["fallback/stream-fallback"],
            },
          },
        },
      };

      const result = await testApi.streamSpeechWithDeps(
        {
          text: input,
          cfg,
          prepareHook,
        },
        { summarizeText: summarize as never },
      );

      expect(result.success).toBe(true);
      expect(result.provider).toBe("fallback");
      expect(summarize.mock.calls.map((call) => call[0].targetLength)).toEqual([120, 180]);
      expect(hookEvents.map(({ attempt, providerModel }) => ({ attempt, providerModel }))).toEqual([
        { attempt: 0, providerModel: "stream-primary" },
        { attempt: 1, providerModel: "stream-fallback" },
      ]);
      expect(String(primaryStream.mock.calls[0]?.[0].text).length).toBeLessThanOrEqual(120);
      expect(String(fallbackStream.mock.calls[0]?.[0].text).length).toBeLessThanOrEqual(180);
      expect(result.preparedInputText).toBe(fallbackStream.mock.calls[0]?.[0].text);
    });

    it("keeps streaming truncation UTF-16 safe when summarization fails", async () => {
      const streamSynthesize = vi.fn(async (_request: SpeechSynthesisStreamRequest) =>
        createMockSpeechStreamResult(),
      );
      installSpeechProviders([
        createMockSpeechProvider("mock", {
          prepareSynthesis: undefined,
          resolveSynthesisTextLimit: () => 120,
          streamSynthesize,
        }),
      ]);
      const summarize = vi.fn(async () => {
        throw new Error("summary backend unavailable");
      });

      const result = await testApi.streamSpeechWithDeps(
        {
          text: `${"😀".repeat(80)} trailing material`,
          cfg: limitedConfig("openclaw-speech-core-stream-utf16"),
          disableFallback: true,
        },
        { summarizeText: summarize as never },
      );

      expect(result.success).toBe(true);
      const sent = String(streamSynthesize.mock.calls[0]?.[0].text);
      expect(sent.length).toBeLessThanOrEqual(120);
      expect(sent).not.toContain("\uFFFD");
      expect(sent).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
      expect(sent).not.toMatch(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
    });

    it("retries streaming provider preparation without hook output on overflow", async () => {
      const providerPrepare = vi.fn(async (ctx: SpeechProviderPrepareSynthesisContext) => ({
        text: ctx.providerOverrides?.personaPrompt
          ? `${String(ctx.providerOverrides.personaPrompt)}\n${ctx.text}`
          : ctx.text,
      }));
      const streamSynthesize = vi.fn(async (_request: SpeechSynthesisStreamRequest) =>
        createMockSpeechStreamResult(),
      );
      installSpeechProviders([
        createMockSpeechProvider("mock", {
          resolveSynthesisTextLimit: () => 120,
          prepareSynthesis: providerPrepare,
          streamSynthesize,
        }),
      ]);

      const result = await testApi.streamSpeechWithDeps(
        {
          text: "The fitted streaming text remains unchanged.",
          cfg: limitedConfig("openclaw-speech-core-stream-provider-hook-overflow"),
          disableFallback: true,
          prepareHook: async () => ({
            providerOverrides: { personaPrompt: "director note ".repeat(10) },
          }),
        },
        { summarizeText: vi.fn() as never },
      );

      expect(result.success).toBe(true);
      expect(providerPrepare).toHaveBeenCalledTimes(2);
      expect(streamSynthesize).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "The fitted streaming text remains unchanged.",
          providerOverrides: undefined,
        }),
      );
    });

    it("rejects provider-prepared text above the configured host limit", async () => {
      const providerSynthesize = vi.fn(
        async (request: SpeechSynthesisRequest): Promise<MockSpeechSynthesisResult> => ({
          audioBuffer: Buffer.from("voice"),
          fileExtension: ".ogg",
          outputFormat: "ogg",
          voiceCompatible: request.target === "voice-note",
        }),
      );
      installSpeechProviders([
        createMockSpeechProvider("mock", {
          prepareSynthesis: async ({ text }) => ({ text: `${text}${"F".repeat(100)}` }),
          synthesize: providerSynthesize,
        }),
      ]);

      const result = await synthesizeSpeech({
        text: "Short input.",
        cfg: limitedConfig("openclaw-speech-core-host-preparation-overflow", 100),
        disableFallback: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("prepared text exceeds mock limit (112 > 100)");
      expect(providerSynthesize).not.toHaveBeenCalled();
    });

    it("never sends provider-prepared text above the provider's declared limit", async () => {
      const providerSynthesize = vi.fn(
        async (request: SpeechSynthesisRequest): Promise<MockSpeechSynthesisResult> => ({
          audioBuffer: Buffer.from("voice"),
          fileExtension: ".ogg",
          outputFormat: "ogg",
          voiceCompatible: request.target === "voice-note",
        }),
      );
      installSpeechProviders([
        createMockSpeechProvider("mock", {
          resolveSynthesisTextLimit: () => 120,
          prepareSynthesis: async () => ({ text: "F".repeat(121) }),
          synthesize: providerSynthesize,
        }),
      ]);

      const result = await synthesizeSpeech({
        text: "Short input.",
        cfg: limitedConfig("openclaw-speech-core-provider-overflow"),
        disableFallback: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("prepared text exceeds mock limit (121 > 120)");
      expect(providerSynthesize).not.toHaveBeenCalled();
    });
  });
});

describe("speech-core per-agent TTS config", () => {
  it("deep-merges the active agent TTS override over messages.tts", () => {
    const cfg = {
      messages: {
        tts: {
          enabled: true,
          provider: "openai",
          providers: {
            openai: {
              apiKey: "${OPENAI_API_KEY}",
              voice: "coral",
              speed: 1,
            },
          },
        },
      },
      agents: {
        list: [
          {
            id: "reader",
            tts: {
              provider: "openai",
              providers: {
                openai: {
                  voice: "nova",
                },
              },
            },
          },
        ],
      },
    } satisfies OpenClawConfig;

    const resolved = resolveTtsConfig(cfg, "reader");

    const rawConfig = requireRecord(resolved.rawConfig, "resolved raw TTS config");
    expect(rawConfig.enabled).toBe(true);
    expect(rawConfig.provider).toBe("openai");
    const providers = requireRecord(rawConfig.providers, "resolved raw TTS providers");
    const openai = requireRecord(providers.openai, "resolved OpenAI TTS provider config");
    expect(openai.apiKey).toBe("${OPENAI_API_KEY}");
    expect(openai.voice).toBe("nova");
    expect(openai.speed).toBe(1);
  });

  it("composes per-agent TTS overrides with active persona bindings", async () => {
    const cfg = {
      messages: {
        tts: {
          enabled: true,
          provider: "mock",
          providers: {
            mock: {
              model: "base-model",
              voice: "base-voice",
            },
          },
          persona: "alfred",
          personas: {
            alfred: {
              provider: "mock",
              providers: {
                mock: {
                  voice: "alfred-voice",
                },
              },
            },
            jarvis: {
              provider: "mock",
              providers: {
                mock: {
                  style: "jarvis-style",
                },
              },
            },
          },
        },
      },
      agents: {
        list: [
          {
            id: "reader",
            tts: {
              persona: "jarvis",
              providers: {
                mock: {
                  voice: "agent-voice",
                },
              },
            },
          },
        ],
      },
    } satisfies OpenClawConfig;

    let mediaDir: string | undefined;
    try {
      const result = await maybeApplyTtsToPayload({
        payload: { text: "This agent reply should use the composed persona config." },
        cfg,
        channel: "slack",
        kind: "final",
        agentId: "reader",
      });

      expect(synthesizeMock).toHaveBeenCalled();
      const request = requireFirstSynthesisRequest("agent persona synthesis request");
      const providerConfig = requireRecord(request.providerConfig, "agent persona provider config");
      expect(providerConfig.model).toBe("base-model");
      expect(providerConfig.voice).toBe("agent-voice");
      expect(providerConfig.style).toBe("jarvis-style");
      expect(result.mediaUrl).toMatch(/voice-\d+\.ogg$/);
      mediaDir = result.mediaUrl ? path.dirname(result.mediaUrl) : undefined;
    } finally {
      if (mediaDir) {
        rmSync(mediaDir, { recursive: true, force: true });
      }
    }
  });

  it("ignores prototype-pollution keys in agent TTS overrides", () => {
    const cfg = {
      messages: {
        tts: {
          provider: "openai",
          providers: {
            openai: {
              voice: "coral",
            },
          },
        },
      },
      agents: {
        list: [
          {
            id: "reader",
            tts: JSON.parse(
              '{"providers":{"openai":{"voice":"nova","__proto__":{"polluted":true}}}}',
            ),
          },
        ],
      },
    } as OpenClawConfig;

    const resolved = resolveTtsConfig(cfg, "reader");

    expect(resolved.rawConfig?.providers?.openai).toEqual({ voice: "nova" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
