import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../../../packages/gateway-protocol/src/index.js";
import type { OpenClawConfig } from "../../config/config.js";
import { normalizeResolvedSecretInputString } from "../../config/types.secrets.js";
import { clearTalkSpeakOpusTranscodeQueueForTest, talkHandlers } from "./talk.js";

const mocks = vi.hoisted(() => ({
  getRuntimeConfig: vi.fn<() => OpenClawConfig>(),
  readConfigFileSnapshot: vi.fn(),
  canonicalizeSpeechProviderId: vi.fn((providerId: string | undefined) => providerId),
  getSpeechProvider: vi.fn(),
  listSpeechProviders: vi.fn(() => []),
  getResolvedSpeechProviderConfig: vi.fn(() => ({})),
  resolveTtsConfig: vi.fn(() => ({ timeoutMs: 30_000 })),
  synthesizeSpeech: vi.fn(),
  canonicalizeRealtimeVoiceProviderId: vi.fn((providerId: string | undefined) => providerId),
  listRealtimeVoiceProviders: vi.fn(() => []),
  listRealtimeTranscriptionProviders: vi.fn(() => []),
  resolveConfiguredRealtimeVoiceProvider: vi.fn(),
  createTalkRealtimeRelaySession: vi.fn(),
  sendTalkRealtimeRelayAudio: vi.fn(),
  cancelTalkRealtimeRelayTurn: vi.fn(),
  stopTalkRealtimeRelaySession: vi.fn(),
  registerTalkRealtimeRelayAgentRun: vi.fn(),
  submitTalkRealtimeRelayToolResult: vi.fn(),
  createTalkTranscriptionRelaySession: vi.fn(),
  sendTalkTranscriptionRelayAudio: vi.fn(),
  cancelTalkTranscriptionRelayTurn: vi.fn(),
  stopTalkTranscriptionRelaySession: vi.fn(),
  chatSend: vi.fn(),
  controlRealtimeVoiceAgentRun: vi.fn(),
  steerTalkRealtimeRelayAgentRun: vi.fn(),
  resolveSessionKeyFromResolveParams: vi.fn(),
  readVoiceAgentBasePrompt: vi.fn<() => Promise<unknown>>(async () => ({ source: "none" })),
  buildTalkRealtimeContextPacket: vi.fn<() => Promise<unknown>>(),
  createRealtimeDirectTools: vi.fn<() => unknown>(() => ({
    tools: [],
    executors: new Map(),
    excludedTools: [],
  })),
  transcodeAudioBufferToOpus: vi.fn(async () => Buffer.from("opus-audio")),
  buildMediaUnderstandingRegistry: vi.fn(
    () =>
      new Map([["openai", { id: "openai", capabilities: ["audio"], transcribeAudio: vi.fn() }]]),
  ),
  getMediaUnderstandingProvider: vi.fn((providerId: string, registry: Map<string, unknown>) =>
    registry.get(providerId),
  ),
}));

vi.mock("../../config/config.js", () => ({
  readConfigFileSnapshot: mocks.readConfigFileSnapshot,
}));

vi.mock("../../media/audio-transcode.js", () => ({
  transcodeAudioBufferToOpus: mocks.transcodeAudioBufferToOpus,
}));

vi.mock("../../media-understanding/provider-registry.js", () => ({
  buildMediaUnderstandingRegistry: mocks.buildMediaUnderstandingRegistry,
  getMediaUnderstandingProvider: mocks.getMediaUnderstandingProvider,
}));

vi.mock("../../tts/provider-registry.js", () => ({
  canonicalizeSpeechProviderId: mocks.canonicalizeSpeechProviderId,
  getSpeechProvider: mocks.getSpeechProvider,
  listSpeechProviders: mocks.listSpeechProviders,
}));

vi.mock("../../tts/tts.js", () => ({
  getResolvedSpeechProviderConfig: mocks.getResolvedSpeechProviderConfig,
  resolveTtsConfig: mocks.resolveTtsConfig,
  synthesizeSpeech: mocks.synthesizeSpeech,
}));

vi.mock("../../talk/provider-registry.js", () => ({
  canonicalizeRealtimeVoiceProviderId: mocks.canonicalizeRealtimeVoiceProviderId,
  listRealtimeVoiceProviders: mocks.listRealtimeVoiceProviders,
}));

vi.mock("../../realtime-transcription/provider-registry.js", () => ({
  listRealtimeTranscriptionProviders: mocks.listRealtimeTranscriptionProviders,
}));

vi.mock("../../talk/provider-resolver.js", () => ({
  resolveConfiguredRealtimeVoiceProvider: mocks.resolveConfiguredRealtimeVoiceProvider,
}));

vi.mock("../../talk/agent-run-control.js", () => ({
  controlRealtimeVoiceAgentRun: mocks.controlRealtimeVoiceAgentRun,
}));

vi.mock("../../agents/voice-agent-base-prompt-file.js", () => ({
  readVoiceAgentBasePrompt: mocks.readVoiceAgentBasePrompt,
}));

vi.mock("../../talk/realtime-context.js", () => ({
  buildTalkRealtimeContextPacket: mocks.buildTalkRealtimeContextPacket,
}));

vi.mock("../../talk/realtime-direct-tools.js", () => ({
  createRealtimeDirectTools: mocks.createRealtimeDirectTools,
}));

vi.mock("./chat.js", () => ({
  chatHandlers: {
    "chat.send": mocks.chatSend,
  },
}));

vi.mock("../sessions-resolve.js", () => ({
  resolveSessionKeyFromResolveParams: mocks.resolveSessionKeyFromResolveParams,
}));

vi.mock("../talk-realtime-relay.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../talk-realtime-relay.js")>();
  return {
    ...actual,
    cancelTalkRealtimeRelayTurn: mocks.cancelTalkRealtimeRelayTurn,
    createTalkRealtimeRelaySession: mocks.createTalkRealtimeRelaySession,
    registerTalkRealtimeRelayAgentRun: mocks.registerTalkRealtimeRelayAgentRun,
    sendTalkRealtimeRelayAudio: mocks.sendTalkRealtimeRelayAudio,
    steerTalkRealtimeRelayAgentRun: mocks.steerTalkRealtimeRelayAgentRun,
    stopTalkRealtimeRelaySession: mocks.stopTalkRealtimeRelaySession,
    submitTalkRealtimeRelayToolResult: mocks.submitTalkRealtimeRelayToolResult,
  };
});

vi.mock("../talk-transcription-relay.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../talk-transcription-relay.js")>();
  return {
    ...actual,
    cancelTalkTranscriptionRelayTurn: mocks.cancelTalkTranscriptionRelayTurn,
    createTalkTranscriptionRelaySession: mocks.createTalkTranscriptionRelaySession,
    sendTalkTranscriptionRelayAudio: mocks.sendTalkTranscriptionRelayAudio,
    stopTalkTranscriptionRelaySession: mocks.stopTalkTranscriptionRelaySession,
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

function expectRecordFields(record: unknown, expected: Record<string, unknown>) {
  if (!record || typeof record !== "object") {
    throw new Error("Expected record");
  }
  const actual = record as Record<string, unknown>;
  for (const [key, value] of Object.entries(expected)) {
    expect(actual[key]).toEqual(value);
  }
  return actual;
}

function mockCallArg(mock: ReturnType<typeof vi.fn>, callIndex = 0, argIndex = 0) {
  const call = mock.mock.calls.at(callIndex);
  if (!call) {
    throw new Error(`Expected mock call ${callIndex}`);
  }
  return call.at(argIndex);
}

function expectRespondOk(mock: ReturnType<typeof vi.fn>, expected?: Record<string, unknown>) {
  expect(mockCallArg(mock)).toBe(true);
  const result = mockCallArg(mock, 0, 1);
  if (expected) {
    expectRecordFields(result, expected);
  }
  expect(mockCallArg(mock, 0, 2)).toBeUndefined();
  return result;
}

function expectRespondError(mock: ReturnType<typeof vi.fn>, expected: Record<string, unknown>) {
  expect(mockCallArg(mock)).toBe(false);
  expect(mockCallArg(mock, 0, 1)).toBeUndefined();
  return expectRecordFields(mockCallArg(mock, 0, 2), expected);
}

describe("talk.catalog handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listSpeechProviders.mockReturnValue([]);
    mocks.listRealtimeTranscriptionProviders.mockReturnValue([]);
    mocks.listRealtimeVoiceProviders.mockReturnValue([]);
    mocks.getResolvedSpeechProviderConfig.mockReturnValue({});
    mocks.resolveTtsConfig.mockReturnValue({ timeoutMs: 30_000 });
    mocks.readVoiceAgentBasePrompt.mockResolvedValue({ source: "none" });
    mocks.buildTalkRealtimeContextPacket.mockReset();
    mocks.createRealtimeDirectTools.mockReturnValue({
      tools: [],
      executors: new Map(),
      excludedTools: [],
    });
  });

  it("returns safe speech, transcription, and realtime catalogs without provider secrets", async () => {
    mocks.listSpeechProviders.mockReturnValue([
      {
        id: "elevenlabs",
        label: "ElevenLabs",
        models: ["eleven_flash_v2_5"],
        voices: ["voice-1"],
        isConfigured: vi.fn(() => true),
      } as never,
    ]);
    mocks.getResolvedSpeechProviderConfig.mockReturnValue({ apiKey: "speech-key" });
    mocks.listRealtimeTranscriptionProviders.mockReturnValue([
      {
        id: "openai",
        label: "OpenAI Realtime Transcription",
        defaultModel: "gpt-4o-transcribe",
        resolveConfig: vi.fn(({ rawConfig }) => rawConfig),
        isConfigured: vi.fn(({ providerConfig }) => providerConfig.apiKey === "stt-key"),
      } as never,
    ]);
    mocks.listRealtimeVoiceProviders.mockReturnValue([
      {
        id: "google",
        label: "Google Live Voice",
        defaultModel: "gemini-live",
        resolveConfig: vi.fn(({ rawConfig }) => rawConfig),
        isConfigured: vi.fn(({ providerConfig }) => providerConfig.apiKey === "live-key"),
        capabilities: {
          transports: ["provider-websocket", "gateway-relay"],
          inputAudioFormats: [{ encoding: "pcm16", sampleRateHz: 24000, channels: 1 }],
          outputAudioFormats: [{ encoding: "pcm16", sampleRateHz: 24000, channels: 1 }],
          supportsBrowserSession: true,
          supportsBargeIn: true,
          supportsToolCalls: true,
          supportsVideoFrames: true,
          supportsSessionResumption: true,
        },
        createBrowserSession: vi.fn(),
        createBridge: vi.fn(),
      } as never,
    ]);

    const respond = vi.fn();
    await talkHandlers["talk.catalog"]({
      req: { type: "req", id: "1", method: "talk.catalog" },
      params: {},
      client: { connect: { scopes: ["operator.read"] } } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {
        getRuntimeConfig: () =>
          ({
            talk: {
              provider: "elevenlabs",
              providers: { elevenlabs: { apiKey: "speech-key" } },
              realtime: {
                provider: "google",
                providers: { google: { apiKey: "live-key" } },
              },
            },
            plugins: {
              entries: {
                "voice-call": {
                  config: {
                    streaming: {
                      provider: "openai",
                      providers: { openai: { apiKey: "stt-key" } },
                    },
                  },
                },
              },
            },
          }) as OpenClawConfig,
      } as never,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      {
        modes: ["realtime", "stt-tts", "transcription"],
        transports: ["webrtc", "provider-websocket", "gateway-relay", "managed-room"],
        brains: ["agent-consult", "direct-tools", "none"],
        speech: {
          activeProvider: "elevenlabs",
          providers: [
            {
              id: "elevenlabs",
              label: "ElevenLabs",
              configured: true,
              modes: ["stt-tts"],
              brains: ["agent-consult"],
              models: ["eleven_flash_v2_5"],
              voices: ["voice-1"],
            },
          ],
        },
        transcription: {
          activeProvider: "openai",
          providers: [
            {
              id: "openai",
              label: "OpenAI Realtime Transcription",
              configured: true,
              modes: ["transcription"],
              transports: ["gateway-relay"],
              brains: ["none"],
              defaultModel: "gpt-4o-transcribe",
            },
          ],
        },
        realtime: {
          activeProvider: "google",
          providers: [
            {
              id: "google",
              label: "Google Live Voice",
              configured: true,
              defaultModel: "gemini-live",
              modes: ["realtime"],
              transports: ["provider-websocket", "gateway-relay"],
              brains: ["agent-consult"],
              inputAudioFormats: [{ encoding: "pcm16", sampleRateHz: 24000, channels: 1 }],
              outputAudioFormats: [{ encoding: "pcm16", sampleRateHz: 24000, channels: 1 }],
              supportsBrowserSession: true,
              supportsBargeIn: true,
              supportsToolCalls: true,
              supportsVideoFrames: true,
              supportsSessionResumption: true,
            },
          ],
        },
      },
      undefined,
    );
    const responsePayload = JSON.stringify(mockCallArg(respond, 0, 1));
    expect(responsePayload).not.toContain("speech-key");
    expect(responsePayload).not.toContain("stt-key");
    expect(responsePayload).not.toContain("live-key");
  });
});

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
    expectRecordFields(mockCallArg(mocks.synthesizeSpeech), {
      text: "Hello from talk mode.",
      disableFallback: true,
    });
    expectRespondOk(respond, {
      provider: "acme",
      audioBase64: Buffer.from([1, 2, 3]).toString("base64"),
      outputFormat: "mp3",
      mimeType: "audio/mpeg",
      fileExtension: ".mp3",
    });
  });

  it("transcodes synthesized speech to opus when requested", async () => {
    const runtimeConfig = createTalkConfig("env-acme-key");
    mocks.getSpeechProvider.mockReturnValue({
      id: "acme",
      label: "Acme Speech",
      resolveTalkConfig: ({
        talkProviderConfig,
      }: {
        talkProviderConfig: Record<string, unknown>;
      }) => talkProviderConfig,
    });
    mocks.synthesizeSpeech.mockResolvedValue({
      success: true,
      provider: "acme",
      audioBuffer: Buffer.from("wav-audio"),
      outputFormat: "wav",
      voiceCompatible: false,
      fileExtension: ".wav",
    });
    mocks.transcodeAudioBufferToOpus.mockResolvedValue(Buffer.from("opus-audio"));

    const respond = vi.fn();
    await talkHandlers["talk.speak"]({
      req: { type: "req", id: "1", method: "talk.speak" },
      params: { text: "Hello from talk mode.", outputFormat: "opus" },
      client: null,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: { getRuntimeConfig: () => runtimeConfig } as never,
    });

    expect(mocks.transcodeAudioBufferToOpus).toHaveBeenCalledWith(
      expect.objectContaining({
        audioBuffer: Buffer.from("wav-audio"),
        inputExtension: ".wav",
        tempPrefix: "talk-speak-opus-",
      }),
    );
    expectRespondOk(respond, {
      provider: "acme",
      audioBase64: Buffer.from("opus-audio").toString("base64"),
      outputFormat: "opus",
      mimeType: "audio/ogg",
      fileExtension: ".opus",
    });
  });

  it("reports opus post-processing failures as invalid audio results", async () => {
    const runtimeConfig = createTalkConfig("env-acme-key");
    mocks.getSpeechProvider.mockReturnValue({
      id: "acme",
      label: "Acme Speech",
      resolveTalkConfig: ({
        talkProviderConfig,
      }: {
        talkProviderConfig: Record<string, unknown>;
      }) => talkProviderConfig,
    });
    mocks.synthesizeSpeech.mockResolvedValue({
      success: true,
      provider: "acme",
      audioBuffer: Buffer.from("wav-audio"),
      outputFormat: "wav",
      voiceCompatible: false,
      fileExtension: ".wav",
    });
    mocks.transcodeAudioBufferToOpus.mockRejectedValue(new Error("ffmpeg unavailable"));

    const respond = vi.fn();
    await talkHandlers["talk.speak"]({
      req: { type: "req", id: "1", method: "talk.speak" },
      params: { text: "Hello from talk mode.", outputFormat: "opus" },
      client: null,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: { getRuntimeConfig: () => runtimeConfig } as never,
    });

    expect(mockCallArg(respond)).toBe(false);
    expectRecordFields(mockCallArg(respond, 0, 2), {
      code: ErrorCodes.UNAVAILABLE,
      message: "talk synthesis post-processing failed: Error: ffmpeg unavailable",
    });
    const error = mockCallArg(respond, 0, 2) as { details?: { reason?: string } };
    expect(error.details?.reason).toBe("invalid_audio_result");
  });

  it("rejects opus transcode requests when the pending queue is full", async () => {
    const runtimeConfig = createTalkConfig("env-acme-key");
    mocks.getSpeechProvider.mockReturnValue({
      id: "acme",
      label: "Acme Speech",
      resolveTalkConfig: ({
        talkProviderConfig,
      }: {
        talkProviderConfig: Record<string, unknown>;
      }) => talkProviderConfig,
    });
    mocks.synthesizeSpeech.mockResolvedValue({
      success: true,
      provider: "acme",
      audioBuffer: Buffer.from("wav-audio"),
      outputFormat: "wav",
      voiceCompatible: false,
      fileExtension: ".wav",
    });
    let releaseTranscode: (value: Buffer<ArrayBuffer>) => void = () => {};
    const transcodeBlocked = new Promise<Buffer<ArrayBuffer>>((resolve) => {
      releaseTranscode = resolve;
    });
    mocks.transcodeAudioBufferToOpus.mockImplementation(async () => await transcodeBlocked);

    const calls = Array.from({ length: 11 }, () => {
      const respond = vi.fn();
      const done = talkHandlers["talk.speak"]({
        req: { type: "req", id: "1", method: "talk.speak" },
        params: { text: "Hello from talk mode.", outputFormat: "opus" },
        client: null,
        isWebchatConnect: () => false,
        respond: respond as never,
        context: { getRuntimeConfig: () => runtimeConfig } as never,
      });
      return { respond, done };
    });

    await vi.waitFor(() => {
      expect(calls.some(({ respond }) => respond.mock.calls[0]?.[0] === false)).toBe(true);
    });
    const rejected = calls.find(({ respond }) => respond.mock.calls[0]?.[0] === false)?.respond;
    expectRecordFields(mockCallArg(rejected ?? vi.fn(), 0, 2), {
      code: ErrorCodes.UNAVAILABLE,
      message: "talk.speak Opus transcode queue is full",
    });
    const error = mockCallArg(rejected ?? vi.fn(), 0, 2) as { details?: { reason?: string } };
    expect(error.details?.reason).toBe("method_unavailable");

    releaseTranscode(Buffer.from("opus-audio"));
    await Promise.all(calls.map(({ done }) => Promise.resolve(done)));
  });

  it("drops a queued opus transcode waiter that exceeds its timeout before it consumes a slot", async () => {
    const runtimeConfig = {
      ...createTalkConfig("env-acme-key"),
      messages: { tts: { timeoutMs: 20 } },
    } as OpenClawConfig;
    mocks.getSpeechProvider.mockReturnValue({
      id: "acme",
      label: "Acme Speech",
      resolveTalkConfig: ({
        talkProviderConfig,
      }: {
        talkProviderConfig: Record<string, unknown>;
      }) => talkProviderConfig,
    });
    mocks.synthesizeSpeech.mockResolvedValue({
      success: true,
      provider: "acme",
      audioBuffer: Buffer.from("wav-audio"),
      outputFormat: "wav",
      voiceCompatible: false,
      fileExtension: ".wav",
    });

    // First two requests occupy the active transcode slots and stay blocked,
    // forcing the third to enqueue and race its timeout deadline.
    let releaseTranscode: (value: Buffer<ArrayBuffer>) => void = () => {};
    const transcodeBlocked = new Promise<Buffer<ArrayBuffer>>((resolve) => {
      releaseTranscode = resolve;
    });
    mocks.transcodeAudioBufferToOpus.mockImplementation(async () => await transcodeBlocked);

    const speak = () => {
      const respond = vi.fn();
      const done = talkHandlers["talk.speak"]({
        req: { type: "req", id: "1", method: "talk.speak" },
        params: { text: "Hello from talk mode.", outputFormat: "opus" },
        client: null,
        isWebchatConnect: () => false,
        respond: respond as never,
        context: { getRuntimeConfig: () => runtimeConfig } as never,
      });
      return { respond, done };
    };

    const blockers = [speak(), speak()];
    const queued = speak();

    // The queued waiter has no free slot; once its 20ms deadline lapses it must
    // be rejected as unavailable rather than waiting forever for a slot.
    await vi.waitFor(() => {
      expect(queued.respond.mock.calls[0]?.[0]).toBe(false);
    });
    expectRecordFields(mockCallArg(queued.respond, 0, 2), {
      code: ErrorCodes.UNAVAILABLE,
      message: "talk.speak Opus transcode queue is full",
    });
    const queuedError = mockCallArg(queued.respond, 0, 2) as { details?: { reason?: string } };
    expect(queuedError.details?.reason).toBe("method_unavailable");

    // The timed-out waiter must be removed from the pending queue, so when the
    // active slots free up no phantom waiter is resumed onto a slot. A fresh
    // request fired afterwards must get a slot and complete successfully.
    mocks.transcodeAudioBufferToOpus.mockResolvedValue(Buffer.from("opus-audio"));
    releaseTranscode(Buffer.from("opus-audio"));
    await Promise.all(blockers.map(({ done }) => Promise.resolve(done)));
    await Promise.resolve(queued.done);

    const fresh = speak();
    await Promise.resolve(fresh.done);
    expect(fresh.respond.mock.calls[0]?.[0]).toBe(true);

    clearTalkSpeakOpusTranscodeQueueForTest();
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

    const response = expectRespondOk(respond) as { config?: { talk?: Record<string, unknown> } };
    const talkConfig = response.config?.talk;
    expectRecordFields(talkConfig, { provider: "acme" });
    const resolved = talkConfig?.resolved as Record<string, unknown> | undefined;
    expectRecordFields(resolved, { provider: "acme" });
    expectRecordFields(resolved?.config, { apiKey: "__OPENCLAW_REDACTED__" });
  });

  it("returns runtime-resolved Talk provider SecretRefs to authorized clients", async () => {
    const sourceConfig = createTalkConfig({
      source: "env",
      provider: "default",
      id: "ACME_SPEECH_API_KEY",
    });
    const runtimeConfig = createTalkConfig("runtime-resolved-talk-key");

    mocks.getSpeechProvider.mockReturnValue(undefined);
    mocks.readConfigFileSnapshot.mockResolvedValue({
      path: "/tmp/openclaw.json",
      hash: "test-hash",
      valid: true,
      config: sourceConfig,
    });

    const respond = vi.fn();
    await talkHandlers["talk.config"]({
      req: { type: "req", id: "1", method: "talk.config" },
      params: { includeSecrets: true },
      client: { connect: { scopes: ["operator.talk.secrets"] } } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: { getRuntimeConfig: () => runtimeConfig } as never,
    });

    const response = expectRespondOk(respond) as { config?: { talk?: Record<string, unknown> } };
    const talkConfig = response.config?.talk;
    expectRecordFields(talkConfig, { provider: "acme" });
    const providers = talkConfig?.providers as Record<string, unknown> | undefined;
    const providerConfig = expectRecordFields(providers?.acme, { voiceId: "stub-default-voice" });
    expectRecordFields(providerConfig.apiKey, {
      source: "env",
      provider: "default",
      id: "ACME_SPEECH_API_KEY",
    });
    const resolved = talkConfig?.resolved as Record<string, unknown> | undefined;
    expectRecordFields(resolved, { provider: "acme" });
    expectRecordFields(resolved?.config, { apiKey: "runtime-resolved-talk-key" });
  });

  it("materializes only the active Talk provider apiKey for authorized clients", async () => {
    const sourceConfig = {
      talk: {
        provider: "acme",
        providers: {
          acme: {
            apiKey: { source: "env", provider: "default", id: "ACME_SPEECH_API_KEY" },
            voiceId: "active-voice",
          },
          other: {
            apiKey: { source: "env", provider: "default", id: "OTHER_SPEECH_API_KEY" },
            voiceId: "inactive-voice",
          },
        },
        realtime: {
          provider: "openai",
          providers: {
            openai: {
              apiKey: { source: "env", provider: "default", id: "OPENAI_REALTIME_API_KEY" },
              voice: "cedar",
            },
          },
        },
      },
    } as OpenClawConfig;
    const runtimeConfig = {
      talk: {
        provider: "acme",
        providers: {
          acme: {
            apiKey: "runtime-active-talk-key",
            voiceId: "active-voice",
          },
          other: {
            apiKey: "runtime-inactive-talk-key",
            voiceId: "inactive-voice",
          },
        },
        realtime: {
          provider: "openai",
          providers: {
            openai: {
              apiKey: "runtime-realtime-key",
              voice: "cedar",
            },
          },
        },
      },
    } as OpenClawConfig;

    mocks.getSpeechProvider.mockReturnValue(undefined);
    mocks.readConfigFileSnapshot.mockResolvedValue({
      path: "/tmp/openclaw.json",
      hash: "test-hash",
      valid: true,
      config: sourceConfig,
    });

    const respond = vi.fn();
    await talkHandlers["talk.config"]({
      req: { type: "req", id: "1", method: "talk.config" },
      params: { includeSecrets: true },
      client: { connect: { scopes: ["operator.talk.secrets"] } } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: { getRuntimeConfig: () => runtimeConfig } as never,
    });

    const response = expectRespondOk(respond) as { config?: { talk?: Record<string, unknown> } };
    const talkConfig = response.config?.talk;
    const providers = talkConfig?.providers as Record<string, unknown> | undefined;
    expectRecordFields((providers?.acme as Record<string, unknown> | undefined)?.apiKey, {
      source: "env",
      provider: "default",
      id: "ACME_SPEECH_API_KEY",
    });
    expectRecordFields((providers?.other as Record<string, unknown> | undefined)?.apiKey, {
      source: "env",
      provider: "default",
      id: "OTHER_SPEECH_API_KEY",
    });
    const realtime = talkConfig?.realtime as Record<string, unknown> | undefined;
    const realtimeProviders = realtime?.providers as Record<string, unknown> | undefined;
    expectRecordFields((realtimeProviders?.openai as Record<string, unknown> | undefined)?.apiKey, {
      source: "env",
      provider: "default",
      id: "OPENAI_REALTIME_API_KEY",
    });
    const resolved = talkConfig?.resolved as Record<string, unknown> | undefined;
    expectRecordFields(resolved, { provider: "acme" });
    expectRecordFields(resolved?.config, { apiKey: "runtime-active-talk-key" });

    const serialized = JSON.stringify(response);
    expect(serialized).toContain("runtime-active-talk-key");
    expect(serialized).not.toContain("runtime-inactive-talk-key");
    expect(serialized).not.toContain("runtime-realtime-key");
  });

  it("does not expose resolver-returned secret-like fields beyond apiKey", async () => {
    const sourceConfig = createTalkConfig({
      source: "env",
      provider: "default",
      id: "ACME_SPEECH_API_KEY",
    });
    const runtimeConfig = createTalkConfig("runtime-resolved-talk-key");

    mocks.getSpeechProvider.mockReturnValue({
      id: "acme",
      label: "Acme Speech",
      resolveTalkConfig: ({
        talkProviderConfig,
      }: {
        talkProviderConfig: Record<string, unknown>;
      }) => ({
        ...talkProviderConfig,
        voiceId: "resolver-voice",
        clientSecret: "resolver-client-secret",
        authToken: "resolver-auth-token",
      }),
    });
    mocks.readConfigFileSnapshot.mockResolvedValue({
      path: "/tmp/openclaw.json",
      hash: "test-hash",
      valid: true,
      config: sourceConfig,
    });

    const respond = vi.fn();
    await talkHandlers["talk.config"]({
      req: { type: "req", id: "1", method: "talk.config" },
      params: { includeSecrets: true },
      client: { connect: { scopes: ["operator.talk.secrets"] } } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: { getRuntimeConfig: () => runtimeConfig } as never,
    });

    const response = expectRespondOk(respond) as { config?: { talk?: Record<string, unknown> } };
    const resolved = response.config?.talk?.resolved as Record<string, unknown> | undefined;
    expectRecordFields(resolved?.config, {
      apiKey: "runtime-resolved-talk-key",
      voiceId: "resolver-voice",
      clientSecret: "__OPENCLAW_REDACTED__",
      authToken: "__OPENCLAW_REDACTED__",
    });
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain("resolver-client-secret");
    expect(serialized).not.toContain("resolver-auth-token");
  });

  it("does not expose source provider raw keys or secret-like sibling fields", async () => {
    const sourceConfig = {
      talk: {
        provider: "acme",
        providers: {
          acme: {
            apiKey: "source-active-talk-key",
            voiceId: "active-voice",
            clientSecret: "source-client-secret",
          },
          other: {
            apiKey: "source-inactive-talk-key",
            voiceId: "inactive-voice",
          },
        },
        realtime: {
          provider: "openai",
          providers: {
            openai: {
              apiKey: "source-realtime-key",
              authToken: "source-realtime-auth-token",
            },
          },
        },
      },
    } as OpenClawConfig;
    const runtimeConfig = {
      talk: {
        provider: "acme",
        providers: {
          acme: {
            apiKey: "runtime-active-talk-key",
            voiceId: "active-voice",
            clientSecret: "runtime-client-secret",
          },
          other: {
            apiKey: "runtime-inactive-talk-key",
            voiceId: "inactive-voice",
          },
        },
        realtime: {
          provider: "openai",
          providers: {
            openai: {
              apiKey: "runtime-realtime-key",
              authToken: "runtime-realtime-auth-token",
            },
          },
        },
      },
    } as OpenClawConfig;

    mocks.getSpeechProvider.mockReturnValue(undefined);
    mocks.readConfigFileSnapshot.mockResolvedValue({
      path: "/tmp/openclaw.json",
      hash: "test-hash",
      valid: true,
      config: sourceConfig,
    });

    const respond = vi.fn();
    await talkHandlers["talk.config"]({
      req: { type: "req", id: "1", method: "talk.config" },
      params: { includeSecrets: true },
      client: { connect: { scopes: ["operator.talk.secrets"] } } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: { getRuntimeConfig: () => runtimeConfig } as never,
    });

    const response = expectRespondOk(respond) as { config?: { talk?: Record<string, unknown> } };
    const resolved = response.config?.talk?.resolved as Record<string, unknown> | undefined;
    expectRecordFields(resolved?.config, {
      apiKey: "runtime-active-talk-key",
      clientSecret: "__OPENCLAW_REDACTED__",
    });
    const serialized = JSON.stringify(response);
    expect(serialized).toContain("runtime-active-talk-key");
    expect(serialized).not.toContain("source-active-talk-key");
    expect(serialized).not.toContain("source-inactive-talk-key");
    expect(serialized).not.toContain("source-realtime-key");
    expect(serialized).not.toContain("source-client-secret");
    expect(serialized).not.toContain("source-realtime-auth-token");
    expect(serialized).not.toContain("runtime-inactive-talk-key");
    expect(serialized).not.toContain("runtime-realtime-key");
    expect(serialized).not.toContain("runtime-client-secret");
    expect(serialized).not.toContain("runtime-realtime-auth-token");
  });

  it("redacts runtime-resolved Talk provider SecretRefs without Talk secret scope", async () => {
    const sourceConfig = createTalkConfig({
      source: "env",
      provider: "default",
      id: "ACME_SPEECH_API_KEY",
    });
    const runtimeConfig = createTalkConfig("runtime-resolved-talk-key");

    mocks.getSpeechProvider.mockReturnValue(undefined);
    mocks.readConfigFileSnapshot.mockResolvedValue({
      path: "/tmp/openclaw.json",
      hash: "test-hash",
      valid: true,
      config: sourceConfig,
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

    const response = expectRespondOk(respond) as { config?: { talk?: Record<string, unknown> } };
    const resolved = response.config?.talk?.resolved as Record<string, unknown> | undefined;
    expectRecordFields(resolved, { provider: "acme" });
    const resolvedConfig = expectRecordFields(resolved?.config, {});
    expectRecordFields(resolvedConfig.apiKey, {
      source: "__OPENCLAW_REDACTED__",
      provider: "__OPENCLAW_REDACTED__",
      id: "__OPENCLAW_REDACTED__",
    });
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain("runtime-resolved-talk-key");
    expect(serialized).not.toContain("ACME_SPEECH_API_KEY");
  });
});

describe("talk.session unified handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildMediaUnderstandingRegistry.mockReturnValue(
      new Map([["openai", { id: "openai", capabilities: ["audio"], transcribeAudio: vi.fn() }]]),
    );
    mocks.resolveSessionKeyFromResolveParams.mockImplementation(async ({ p }) => {
      const key = (p as { key?: unknown }).key;
      return {
        ok: true,
        key: typeof key === "string" ? key : "session:main",
      };
    });
    mocks.steerTalkRealtimeRelayAgentRun.mockResolvedValue({
      ok: true,
      mode: "steer",
      sessionKey: "agent:main:main",
      sessionId: "session-active",
      active: true,
      queued: true,
      message: "Steered the active OpenClaw run.",
      speak: false,
      show: true,
      suppress: true,
    });
    mocks.controlRealtimeVoiceAgentRun.mockResolvedValue({
      ok: true,
      mode: "steer",
      sessionKey: "session:main",
      sessionId: "session-active",
      active: true,
      queued: true,
      message: "Steered the active OpenClaw run.",
      speak: false,
      show: true,
      suppress: true,
    });
  });

  it("creates and drives a realtime gateway-relay session through the unified API", async () => {
    const provider = {
      id: "openai",
      label: "OpenAI Realtime",
      isConfigured: () => true,
      createBridge: vi.fn(),
    };
    mocks.resolveConfiguredRealtimeVoiceProvider.mockReturnValue({
      provider,
      providerConfig: { apiKey: "openai-key" },
    });
    mocks.createTalkRealtimeRelaySession.mockReturnValue({
      provider: "openai",
      transport: "gateway-relay",
      relaySessionId: "relay-unified-1",
      audio: {
        inputEncoding: "pcm16",
        inputSampleRateHz: 24000,
        outputEncoding: "pcm16",
        outputSampleRateHz: 24000,
      },
      model: "gpt-realtime",
      voice: "alloy",
      expiresAt: 1_797_986_400,
    });

    const createRespond = vi.fn();
    await talkHandlers["talk.session.create"]({
      req: { type: "req", id: "1", method: "talk.session.create" },
      params: {
        mode: "realtime",
        transport: "gateway-relay",
        brain: "agent-consult",
        provider: "openai",
        model: "gpt-realtime",
        voice: "alloy",
      },
      client: { connId: "conn-1", connect: { scopes: ["operator.admin"] } } as never,
      isWebchatConnect: () => false,
      respond: createRespond as never,
      context: {
        getRuntimeConfig: () =>
          ({
            talk: {
              realtime: {
                provider: "openai",
                providers: { openai: { apiKey: "openai-key" } },
                instructions: "Speak warmly.",
                consultRouting: "force-agent-consult",
              },
            },
          }) as OpenClawConfig,
      } as never,
    });

    const relayCreateInput = mockCallArg(mocks.createTalkRealtimeRelaySession) as Record<
      string,
      unknown
    >;
    expectRecordFields(relayCreateInput, { connId: "conn-1", provider });
    expectRecordFields(relayCreateInput.providerConfig, {
      apiKey: "openai-key",
      model: "gpt-realtime",
      voice: "alloy",
    });
    expect(relayCreateInput.instructions).toContain(
      "Additional realtime instructions:\nSpeak warmly.",
    );
    expect(relayCreateInput.forceAgentConsultOnFinalTranscript).toBe(true);
    expect(relayCreateInput.instructions).toContain("tool-backed actions");
    expect(relayCreateInput.instructions).toContain("Let me check that for you");
    expectRespondOk(createRespond, {
      sessionId: "relay-unified-1",
      relaySessionId: "relay-unified-1",
      mode: "realtime",
      transport: "gateway-relay",
      brain: "agent-consult",
    });

    const inputRespond = vi.fn();
    await talkHandlers["talk.session.appendAudio"]({
      req: { type: "req", id: "2", method: "talk.session.appendAudio" },
      params: { sessionId: "relay-unified-1", audioBase64: "aGVsbG8=", timestamp: 42 },
      client: { connId: "conn-1", connect: { scopes: ["operator.admin"] } } as never,
      isWebchatConnect: () => false,
      respond: inputRespond as never,
      context: {} as never,
    });
    expect(mocks.sendTalkRealtimeRelayAudio).toHaveBeenCalledWith({
      relaySessionId: "relay-unified-1",
      connId: "conn-1",
      audioBase64: "aGVsbG8=",
      timestamp: 42,
    });

    const cancelRespond = vi.fn();
    await talkHandlers["talk.session.cancelOutput"]({
      req: { type: "req", id: "3", method: "talk.session.cancelOutput" },
      params: { sessionId: "relay-unified-1", reason: "barge-in" },
      client: { connId: "conn-1", connect: { scopes: ["operator.admin"] } } as never,
      isWebchatConnect: () => false,
      respond: cancelRespond as never,
      context: {} as never,
    });
    expect(mocks.cancelTalkRealtimeRelayTurn).toHaveBeenCalledWith({
      relaySessionId: "relay-unified-1",
      connId: "conn-1",
      reason: "barge-in",
    });

    const toolRespond = vi.fn();
    await talkHandlers["talk.session.submitToolResult"]({
      req: { type: "req", id: "4", method: "talk.session.submitToolResult" },
      params: {
        sessionId: "relay-unified-1",
        callId: "call-1",
        result: { status: "working" },
        options: { suppressResponse: true, willContinue: true },
      },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: toolRespond as never,
      context: {} as never,
    });
    expect(mocks.submitTalkRealtimeRelayToolResult).toHaveBeenCalledWith({
      relaySessionId: "relay-unified-1",
      connId: "conn-1",
      callId: "call-1",
      result: { status: "working" },
      options: { suppressResponse: true, willContinue: true },
    });

    const steerRespond = vi.fn();
    await talkHandlers["talk.session.steer"]({
      req: { type: "req", id: "5", method: "talk.session.steer" },
      params: {
        sessionId: "relay-unified-1",
        sessionKey: "agent:main:main",
        text: "use the safer plan",
        mode: "steer",
      },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: steerRespond as never,
      context: {} as never,
    });
    expect(mocks.steerTalkRealtimeRelayAgentRun).toHaveBeenCalledWith({
      relaySessionId: "relay-unified-1",
      connId: "conn-1",
      sessionKey: "agent:main:main",
      text: "use the safer plan",
      mode: "steer",
    });
    expectRespondOk(steerRespond, {
      ok: true,
      mode: "steer",
      sessionKey: "agent:main:main",
    });

    const closeRespond = vi.fn();
    await talkHandlers["talk.session.close"]({
      req: { type: "req", id: "6", method: "talk.session.close" },
      params: { sessionId: "relay-unified-1" },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: closeRespond as never,
      context: {} as never,
    });
    expect(mocks.stopTalkRealtimeRelaySession).toHaveBeenCalledWith({
      relaySessionId: "relay-unified-1",
      connId: "conn-1",
    });
    expect(closeRespond).toHaveBeenCalledWith(true, { ok: true }, undefined);
  });

  it("passes realtime relay spawnedBy visibility scope to session resolution", async () => {
    const provider = {
      id: "openai",
      label: "OpenAI Realtime",
      isConfigured: () => true,
      createBridge: vi.fn(),
    };
    mocks.resolveConfiguredRealtimeVoiceProvider.mockReturnValue({
      provider,
      providerConfig: { apiKey: "openai-key" },
    });
    mocks.resolveSessionKeyFromResolveParams.mockResolvedValue({
      ok: true,
      key: "agent:worker:subagent:child",
    });
    mocks.readVoiceAgentBasePrompt.mockResolvedValue({ source: "none" });
    mocks.buildTalkRealtimeContextPacket.mockResolvedValue(undefined);
    mocks.createRealtimeDirectTools.mockReturnValue({
      tools: [],
      executors: new Map(),
      excludedTools: [],
    });
    mocks.createTalkRealtimeRelaySession.mockReturnValue({
      provider: "openai",
      transport: "gateway-relay",
      relaySessionId: "relay-spawnedby-1",
      audio: {
        inputEncoding: "pcm16",
        inputSampleRateHz: 24000,
        outputEncoding: "pcm16",
        outputSampleRateHz: 24000,
      },
      expiresAt: 1_797_986_400,
    });

    const respond = vi.fn();
    await talkHandlers["talk.session.create"]({
      req: { type: "req", id: "1", method: "talk.session.create" },
      params: {
        sessionKey: "agent:worker:subagent:child",
        spawnedBy: "agent:main:parent",
        mode: "realtime",
        transport: "gateway-relay",
        brain: "agent-consult",
      },
      client: { connId: "conn-1", connect: { scopes: ["operator.write"] } } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {
        getRuntimeConfig: () =>
          ({
            talk: {
              realtime: {
                provider: "openai",
                providers: { openai: { apiKey: "openai-key" } },
                tools: { profile: "voice" },
              },
            },
          }) as OpenClawConfig,
      } as never,
    });

    expectRespondOk(respond, { sessionId: "relay-spawnedby-1" });
    expect(mocks.resolveSessionKeyFromResolveParams).toHaveBeenCalledWith(
      expect.objectContaining({
        p: {
          key: "agent:worker:subagent:child",
          spawnedBy: "agent:main:parent",
          includeGlobal: true,
          includeUnknown: true,
        },
      }),
    );
    expect(mocks.createRealtimeDirectTools).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "agent:worker:subagent:child",
        spawnedBy: "agent:main:parent",
      }),
    );
  });

  it("starts fresh realtime relay sessions for the configured default agent key", async () => {
    const provider = {
      id: "openai",
      label: "OpenAI Realtime",
      isConfigured: () => true,
      createBridge: vi.fn(),
    };
    mocks.resolveConfiguredRealtimeVoiceProvider.mockReturnValue({
      provider,
      providerConfig: { apiKey: "openai-key" },
    });
    mocks.resolveSessionKeyFromResolveParams.mockResolvedValue({
      ok: false,
      error: {
        code: ErrorCodes.INVALID_REQUEST,
        message: "No session found: agent:sky:main",
      },
    });
    mocks.readVoiceAgentBasePrompt.mockResolvedValue({ source: "none" });
    mocks.buildTalkRealtimeContextPacket.mockResolvedValue({
      summarySource: "none",
      contextNote: "No current session context was found for agent:sky:main.",
    });
    mocks.createRealtimeDirectTools.mockReturnValue({
      tools: [],
      executors: new Map(),
      excludedTools: [],
    });
    mocks.createTalkRealtimeRelaySession.mockReturnValue({
      provider: "openai",
      transport: "gateway-relay",
      relaySessionId: "relay-fresh-default-1",
      audio: {
        inputEncoding: "pcm16",
        inputSampleRateHz: 24000,
        outputEncoding: "pcm16",
        outputSampleRateHz: 24000,
      },
      expiresAt: 1_797_986_400,
    });

    const respond = vi.fn();
    await talkHandlers["talk.session.create"]({
      req: { type: "req", id: "1", method: "talk.session.create" },
      params: {
        sessionKey: "agent:sky:main",
        mode: "realtime",
        transport: "gateway-relay",
        brain: "agent-consult",
      },
      client: { connId: "conn-1", connect: { scopes: ["operator.admin"] } } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {
        getRuntimeConfig: () =>
          ({
            agents: { list: [{ id: "sky", default: true }] },
            talk: {
              realtime: {
                provider: "openai",
                providers: { openai: { apiKey: "openai-key" } },
                tools: { profile: "voice" },
              },
            },
          }) as OpenClawConfig,
      } as never,
    });

    expectRespondOk(respond, { sessionId: "relay-fresh-default-1" });
    expect(mocks.buildTalkRealtimeContextPacket).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "sky",
        sessionKey: "agent:sky:main",
      }),
    );
    expect(mocks.createTalkRealtimeRelaySession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: "agent:sky:main" }),
    );
  });

  it("starts fresh realtime relay sessions for the main session alias", async () => {
    const provider = {
      id: "openai",
      label: "OpenAI Realtime",
      isConfigured: () => true,
      createBridge: vi.fn(),
    };
    mocks.resolveConfiguredRealtimeVoiceProvider.mockReturnValue({
      provider,
      providerConfig: { apiKey: "openai-key" },
    });
    mocks.resolveSessionKeyFromResolveParams.mockResolvedValue({
      ok: false,
      error: {
        code: ErrorCodes.INVALID_REQUEST,
        message: "No session found: main",
      },
    });
    mocks.readVoiceAgentBasePrompt.mockResolvedValue({ source: "none" });
    mocks.buildTalkRealtimeContextPacket.mockResolvedValue({
      summarySource: "none",
      contextNote: "No current session context was found for agent:sky:main.",
    });
    mocks.createTalkRealtimeRelaySession.mockReturnValue({
      provider: "openai",
      transport: "gateway-relay",
      relaySessionId: "relay-fresh-main-alias-1",
      audio: {
        inputEncoding: "pcm16",
        inputSampleRateHz: 24000,
        outputEncoding: "pcm16",
        outputSampleRateHz: 24000,
      },
      expiresAt: 1_797_986_400,
    });

    const respond = vi.fn();
    await talkHandlers["talk.session.create"]({
      req: { type: "req", id: "1", method: "talk.session.create" },
      params: {
        sessionKey: "main",
        mode: "realtime",
        transport: "gateway-relay",
        brain: "agent-consult",
      },
      client: { connId: "conn-1", connect: { scopes: ["operator.admin"] } } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {
        getRuntimeConfig: () =>
          ({
            agents: { list: [{ id: "sky", default: true }] },
            talk: {
              realtime: {
                provider: "openai",
                providers: { openai: { apiKey: "openai-key" } },
                tools: { profile: "voice" },
              },
            },
          }) as OpenClawConfig,
      } as never,
    });

    expectRespondOk(respond, { sessionId: "relay-fresh-main-alias-1" });
    expect(mocks.buildTalkRealtimeContextPacket).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "sky",
        sessionKey: "agent:sky:main",
      }),
    );
    expect(mocks.createTalkRealtimeRelaySession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: "agent:sky:main" }),
    );
  });

  it("starts fresh realtime relay sessions for configured non-default agents", async () => {
    const provider = {
      id: "openai",
      label: "OpenAI Realtime",
      isConfigured: () => true,
      createBridge: vi.fn(),
    };
    mocks.resolveConfiguredRealtimeVoiceProvider.mockReturnValue({
      provider,
      providerConfig: { apiKey: "openai-key" },
    });
    mocks.resolveSessionKeyFromResolveParams.mockResolvedValue({
      ok: false,
      error: {
        code: ErrorCodes.INVALID_REQUEST,
        message: "No session found: agent:work:main",
      },
    });
    mocks.readVoiceAgentBasePrompt.mockResolvedValue({ source: "none" });
    mocks.buildTalkRealtimeContextPacket.mockResolvedValue({
      summarySource: "none",
      contextNote: "No current session context was found for agent:work:main.",
    });
    mocks.createTalkRealtimeRelaySession.mockReturnValue({
      provider: "openai",
      transport: "gateway-relay",
      relaySessionId: "relay-fresh-non-default-1",
      audio: {
        inputEncoding: "pcm16",
        inputSampleRateHz: 24000,
        outputEncoding: "pcm16",
        outputSampleRateHz: 24000,
      },
      expiresAt: 1_797_986_400,
    });

    const respond = vi.fn();
    await talkHandlers["talk.session.create"]({
      req: { type: "req", id: "1", method: "talk.session.create" },
      params: {
        sessionKey: "agent:work:main",
        mode: "realtime",
        transport: "gateway-relay",
        brain: "agent-consult",
      },
      client: { connId: "conn-1", connect: { scopes: ["operator.admin"] } } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {
        getRuntimeConfig: () =>
          ({
            agents: {
              list: [{ id: "sky", default: true }, { id: "work" }],
            },
            talk: {
              realtime: {
                provider: "openai",
                providers: { openai: { apiKey: "openai-key" } },
                tools: { profile: "voice" },
              },
            },
          }) as OpenClawConfig,
      } as never,
    });

    expectRespondOk(respond, { sessionId: "relay-fresh-non-default-1" });
    expect(mocks.buildTalkRealtimeContextPacket).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "work",
        sessionKey: "agent:work:main",
      }),
    );
    expect(mocks.createTalkRealtimeRelaySession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: "agent:work:main" }),
    );
  });

  it("rejects fresh realtime relay keys outside the configured default agent", async () => {
    const provider = {
      id: "openai",
      label: "OpenAI Realtime",
      isConfigured: () => true,
      createBridge: vi.fn(),
    };
    mocks.resolveConfiguredRealtimeVoiceProvider.mockReturnValue({
      provider,
      providerConfig: { apiKey: "openai-key" },
    });
    mocks.resolveSessionKeyFromResolveParams.mockResolvedValue({
      ok: false,
      error: {
        code: ErrorCodes.INVALID_REQUEST,
        message: "No session found: agent:main:main",
      },
    });

    const respond = vi.fn();
    await talkHandlers["talk.session.create"]({
      req: { type: "req", id: "1", method: "talk.session.create" },
      params: {
        sessionKey: "agent:main:main",
        mode: "realtime",
        transport: "gateway-relay",
        brain: "agent-consult",
      },
      client: { connId: "conn-1", connect: { scopes: ["operator.admin"] } } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {
        getRuntimeConfig: () =>
          ({
            agents: { list: [{ id: "sky", default: true }] },
            talk: {
              realtime: {
                provider: "openai",
                providers: { openai: { apiKey: "openai-key" } },
                tools: { profile: "voice" },
              },
            },
          }) as OpenClawConfig,
      } as never,
    });

    expectRespondError(respond, {
      code: ErrorCodes.INVALID_REQUEST,
      message: "No session found: agent:main:main",
    });
    expect(mocks.createTalkRealtimeRelaySession).not.toHaveBeenCalled();
  });

  it("uses configured default agent ownership for realtime global session keys", async () => {
    const provider = {
      id: "openai",
      label: "OpenAI Realtime",
      isConfigured: () => true,
      createBridge: vi.fn(),
    };
    mocks.resolveConfiguredRealtimeVoiceProvider.mockReturnValue({
      provider,
      providerConfig: { apiKey: "openai-key" },
    });
    mocks.resolveSessionKeyFromResolveParams.mockResolvedValue({ ok: true, key: "global" });
    mocks.readVoiceAgentBasePrompt.mockResolvedValue({ source: "none" });
    mocks.buildTalkRealtimeContextPacket.mockResolvedValue(undefined);
    mocks.createRealtimeDirectTools.mockReturnValue({
      tools: [],
      executors: new Map(),
      excludedTools: [],
    });
    mocks.createTalkRealtimeRelaySession.mockReturnValue({
      provider: "openai",
      transport: "gateway-relay",
      relaySessionId: "relay-global-1",
      audio: {
        inputEncoding: "pcm16",
        inputSampleRateHz: 24000,
        outputEncoding: "pcm16",
        outputSampleRateHz: 24000,
      },
      expiresAt: 1_797_986_400,
    });

    const respond = vi.fn();
    await talkHandlers["talk.session.create"]({
      req: { type: "req", id: "1", method: "talk.session.create" },
      params: {
        sessionKey: "global",
        mode: "realtime",
        transport: "gateway-relay",
        brain: "agent-consult",
      },
      client: { connId: "conn-1", connect: { scopes: ["operator.admin"] } } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {
        getRuntimeConfig: () =>
          ({
            agents: { list: [{ id: "sky", default: true }] },
            talk: {
              realtime: {
                provider: "openai",
                providers: { openai: { apiKey: "openai-key" } },
                tools: { profile: "voice" },
              },
            },
          }) as OpenClawConfig,
      } as never,
    });

    expectRespondOk(respond, { sessionId: "relay-global-1" });
    expect(mocks.buildTalkRealtimeContextPacket).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "sky",
        sessionKey: "global",
      }),
    );
    expect(mocks.createRealtimeDirectTools).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "sky",
        sessionKey: "global",
      }),
    );
  });

  it("allows write-scoped realtime relay session keys with spawnedBy when direct tools are empty", async () => {
    const provider = {
      id: "openai",
      label: "OpenAI Realtime",
      isConfigured: () => true,
      createBridge: vi.fn(),
    };
    mocks.resolveConfiguredRealtimeVoiceProvider.mockReturnValue({
      provider,
      providerConfig: { apiKey: "openai-key" },
    });
    mocks.resolveSessionKeyFromResolveParams.mockResolvedValue({
      ok: true,
      key: "agent:worker:main",
    });
    mocks.readVoiceAgentBasePrompt.mockResolvedValue({ source: "none" });
    mocks.buildTalkRealtimeContextPacket.mockResolvedValue(undefined);
    mocks.createTalkRealtimeRelaySession.mockReturnValue({
      provider: "openai",
      transport: "gateway-relay",
      relaySessionId: "relay-write-scope-1",
      audio: {
        inputEncoding: "pcm16",
        inputSampleRateHz: 24000,
        outputEncoding: "pcm16",
        outputSampleRateHz: 24000,
      },
      expiresAt: 1_797_986_400,
    });

    const respond = vi.fn();
    await talkHandlers["talk.session.create"]({
      req: { type: "req", id: "1", method: "talk.session.create" },
      params: {
        sessionKey: "agent:worker:main",
        spawnedBy: "agent:main:parent",
        mode: "realtime",
        transport: "gateway-relay",
        brain: "agent-consult",
      },
      client: { connId: "conn-1", connect: { scopes: ["operator.write"] } } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {
        getRuntimeConfig: () =>
          ({
            talk: {
              realtime: {
                provider: "openai",
                providers: { openai: { apiKey: "openai-key" } },
                tools: {},
              },
            },
          }) as OpenClawConfig,
      } as never,
    });

    expectRespondOk(respond, { sessionId: "relay-write-scope-1" });
    expect(mocks.resolveSessionKeyFromResolveParams).toHaveBeenCalledWith(
      expect.objectContaining({
        p: {
          key: "agent:worker:main",
          spawnedBy: "agent:main:parent",
          includeGlobal: true,
          includeUnknown: true,
        },
      }),
    );
    expect(mocks.createRealtimeDirectTools).not.toHaveBeenCalled();
  });

  it("omits startup context for write-scoped realtime session keys without spawnedBy", async () => {
    const provider = {
      id: "openai",
      label: "OpenAI Realtime",
      isConfigured: () => true,
      createBridge: vi.fn(),
    };
    mocks.resolveConfiguredRealtimeVoiceProvider.mockReturnValue({
      provider,
      providerConfig: { apiKey: "openai-key" },
    });
    mocks.resolveSessionKeyFromResolveParams.mockResolvedValue({
      ok: true,
      key: "agent:worker:main",
    });
    mocks.readVoiceAgentBasePrompt.mockResolvedValue({ source: "none" });
    mocks.createTalkRealtimeRelaySession.mockReturnValue({
      provider: "openai",
      transport: "gateway-relay",
      relaySessionId: "relay-unscoped-context-1",
      audio: {
        inputEncoding: "pcm16",
        inputSampleRateHz: 24000,
        outputEncoding: "pcm16",
        outputSampleRateHz: 24000,
      },
      expiresAt: 1_797_986_400,
    });

    const respond = vi.fn();
    await talkHandlers["talk.session.create"]({
      req: { type: "req", id: "1", method: "talk.session.create" },
      params: {
        sessionKey: "agent:worker:main",
        mode: "realtime",
        transport: "gateway-relay",
        brain: "agent-consult",
      },
      client: { connId: "conn-1", connect: { scopes: ["operator.write"] } } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {
        getRuntimeConfig: () =>
          ({
            talk: {
              realtime: {
                provider: "openai",
                providers: { openai: { apiKey: "openai-key" } },
                tools: {},
              },
            },
          }) as OpenClawConfig,
      } as never,
    });

    expectRespondOk(respond, { sessionId: "relay-unscoped-context-1" });
    expect(mocks.resolveSessionKeyFromResolveParams).toHaveBeenCalled();
    expect(mocks.buildTalkRealtimeContextPacket).not.toHaveBeenCalled();
    expect(mocks.createRealtimeDirectTools).not.toHaveBeenCalled();
  });

  it("rejects realtime direct-tool session keys without spawnedBy or admin scope", async () => {
    const respond = vi.fn();
    await talkHandlers["talk.session.create"]({
      req: { type: "req", id: "1", method: "talk.session.create" },
      params: {
        sessionKey: "agent:worker:main",
        mode: "realtime",
        transport: "gateway-relay",
        brain: "agent-consult",
      },
      client: { connId: "conn-1", connect: { scopes: ["operator.write"] } } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {
        getRuntimeConfig: () =>
          ({
            talk: {
              realtime: {
                provider: "openai",
                providers: { openai: { apiKey: "openai-key" } },
                tools: { profile: "voice" },
              },
            },
          }) as OpenClawConfig,
      } as never,
    });

    expectRespondError(respond, {
      code: ErrorCodes.INVALID_REQUEST,
      message:
        "talk.session.create realtime direct tools require spawnedBy or gateway scope: operator.admin",
    });
    expect(mocks.resolveSessionKeyFromResolveParams).not.toHaveBeenCalled();
  });

  it("allows talk-secret operators to create default-main realtime direct-tool sessions", async () => {
    const provider = {
      id: "openai",
      label: "OpenAI Realtime",
      isConfigured: () => true,
      createBridge: vi.fn(),
    };
    const directTool = {
      type: "function",
      name: "read",
      description: "Read a file",
      parameters: { type: "object", properties: {} },
    };
    const directExecutors = new Map([["read", vi.fn()]]);
    mocks.resolveConfiguredRealtimeVoiceProvider.mockReturnValue({
      provider,
      providerConfig: { apiKey: "openai-key" },
    });
    mocks.resolveSessionKeyFromResolveParams.mockResolvedValue({
      ok: false,
      error: {
        code: ErrorCodes.INVALID_REQUEST,
        message: "No session found: main",
      },
    });
    mocks.buildTalkRealtimeContextPacket.mockResolvedValue({
      text: "Recent main-session context",
      summarySource: "none",
    });
    mocks.createRealtimeDirectTools.mockReturnValue({
      tools: [directTool],
      executors: directExecutors,
      excludedTools: [],
    });
    mocks.createTalkRealtimeRelaySession.mockReturnValue({
      provider: "openai",
      transport: "gateway-relay",
      relaySessionId: "relay-android-main-1",
      audio: {
        inputEncoding: "pcm16",
        inputSampleRateHz: 24000,
        outputEncoding: "pcm16",
        outputSampleRateHz: 24000,
      },
      expiresAt: 1_797_986_400,
    });

    const respond = vi.fn();
    await talkHandlers["talk.session.create"]({
      req: { type: "req", id: "1", method: "talk.session.create" },
      params: {
        sessionKey: "main",
        mode: "realtime",
        transport: "gateway-relay",
        brain: "agent-consult",
      },
      client: {
        connId: "conn-android",
        connect: {
          scopes: [
            "operator.approvals",
            "operator.read",
            "operator.talk.secrets",
            "operator.write",
          ],
        },
      } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {
        getRuntimeConfig: () =>
          ({
            talk: {
              realtime: {
                provider: "openai",
                providers: { openai: { apiKey: "openai-key" } },
                tools: { profile: "voice", deny: ["message"] },
              },
            },
          }) as OpenClawConfig,
      } as never,
    });

    expectRespondOk(respond, { sessionId: "relay-android-main-1" });
    expect(mocks.resolveSessionKeyFromResolveParams).toHaveBeenCalledWith(
      expect.objectContaining({
        p: expect.objectContaining({ key: "main" }),
      }),
    );
    expect(mocks.buildTalkRealtimeContextPacket).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "main",
        sessionKey: "agent:main:main",
      }),
    );
    expect(mocks.createRealtimeDirectTools).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "main",
        sessionKey: "agent:main:main",
        senderIsOwner: true,
      }),
    );
  });

  it("rejects realtime direct-tool fresh session fallback without admin scope", async () => {
    const provider = {
      id: "openai",
      label: "OpenAI Realtime",
      isConfigured: () => true,
      createBridge: vi.fn(),
    };
    mocks.resolveConfiguredRealtimeVoiceProvider.mockReturnValue({
      provider,
      providerConfig: { apiKey: "openai-key" },
    });
    mocks.resolveSessionKeyFromResolveParams.mockResolvedValue({
      ok: false,
      error: {
        code: ErrorCodes.INVALID_REQUEST,
        message: "No session found: agent:worker:main",
      },
    });

    const respond = vi.fn();
    await talkHandlers["talk.session.create"]({
      req: { type: "req", id: "1", method: "talk.session.create" },
      params: {
        sessionKey: "agent:worker:main",
        spawnedBy: "agent:main:forged-parent",
        mode: "realtime",
        transport: "gateway-relay",
        brain: "agent-consult",
      },
      client: { connId: "conn-1", connect: { scopes: ["operator.write"] } } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {
        getRuntimeConfig: () =>
          ({
            talk: {
              realtime: {
                provider: "openai",
                providers: { openai: { apiKey: "openai-key" } },
                tools: { profile: "voice" },
              },
            },
          }) as OpenClawConfig,
      } as never,
    });

    expectRespondError(respond, {
      code: ErrorCodes.INVALID_REQUEST,
      message:
        "talk.session.create realtime direct tools require spawnedBy or gateway scope: operator.admin",
    });
    expect(mocks.resolveSessionKeyFromResolveParams).toHaveBeenCalled();
    expect(mocks.createRealtimeDirectTools).not.toHaveBeenCalled();
  });

  it("rejects realtime direct-tool configured-agent fresh fallback with forged spawnedBy", async () => {
    const provider = {
      id: "openai",
      label: "OpenAI Realtime",
      isConfigured: () => true,
      createBridge: vi.fn(),
    };
    mocks.resolveConfiguredRealtimeVoiceProvider.mockReturnValue({
      provider,
      providerConfig: { apiKey: "openai-key" },
    });
    mocks.resolveSessionKeyFromResolveParams.mockResolvedValue({
      ok: false,
      error: {
        code: ErrorCodes.INVALID_REQUEST,
        message: "No session found: agent:worker:main",
      },
    });

    const respond = vi.fn();
    await talkHandlers["talk.session.create"]({
      req: { type: "req", id: "1", method: "talk.session.create" },
      params: {
        sessionKey: "agent:worker:main",
        spawnedBy: "agent:main:forged-parent",
        mode: "realtime",
        transport: "gateway-relay",
        brain: "agent-consult",
      },
      client: { connId: "conn-1", connect: { scopes: ["operator.write"] } } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {
        getRuntimeConfig: () =>
          ({
            agents: { list: [{ id: "main", default: true }, { id: "worker" }] },
            talk: {
              realtime: {
                provider: "openai",
                providers: { openai: { apiKey: "openai-key" } },
                tools: { profile: "voice" },
              },
            },
          }) as OpenClawConfig,
      } as never,
    });

    expectRespondError(respond, {
      code: ErrorCodes.INVALID_REQUEST,
      message:
        "talk.session.create realtime direct tools require spawnedBy or gateway scope: operator.admin",
    });
    expect(mocks.resolveSessionKeyFromResolveParams).toHaveBeenCalled();
    expect(mocks.buildTalkRealtimeContextPacket).not.toHaveBeenCalled();
    expect(mocks.createRealtimeDirectTools).not.toHaveBeenCalled();
  });

  it("rejects unscoped realtime direct-tool sessions without admin scope", async () => {
    const respond = vi.fn();
    await talkHandlers["talk.session.create"]({
      req: { type: "req", id: "1", method: "talk.session.create" },
      params: {
        mode: "realtime",
        transport: "gateway-relay",
        brain: "agent-consult",
      },
      client: { connId: "conn-1", connect: { scopes: ["operator.write"] } } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {
        getRuntimeConfig: () =>
          ({
            talk: {
              realtime: {
                provider: "openai",
                providers: { openai: { apiKey: "openai-key" } },
                tools: { profile: "voice" },
              },
            },
          }) as OpenClawConfig,
      } as never,
    });

    expectRespondError(respond, {
      code: ErrorCodes.INVALID_REQUEST,
      message:
        "talk.session.create realtime direct tools require spawnedBy or gateway scope: operator.admin",
    });
    expect(mocks.createRealtimeDirectTools).not.toHaveBeenCalled();
  });

  it("rejects unscoped realtime direct-tool sessions with unvalidated spawnedBy", async () => {
    const respond = vi.fn();
    await talkHandlers["talk.session.create"]({
      req: { type: "req", id: "1", method: "talk.session.create" },
      params: {
        spawnedBy: "agent:main:parent",
        mode: "realtime",
        transport: "gateway-relay",
        brain: "agent-consult",
      },
      client: { connId: "conn-1", connect: { scopes: ["operator.write"] } } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {
        getRuntimeConfig: () =>
          ({
            talk: {
              realtime: {
                provider: "openai",
                providers: { openai: { apiKey: "openai-key" } },
                tools: { profile: "voice" },
              },
            },
          }) as OpenClawConfig,
      } as never,
    });

    expectRespondError(respond, {
      code: ErrorCodes.INVALID_REQUEST,
      message:
        "talk.session.create realtime direct tools require spawnedBy or gateway scope: operator.admin",
    });
    expect(mocks.resolveSessionKeyFromResolveParams).not.toHaveBeenCalled();
    expect(mocks.createRealtimeDirectTools).not.toHaveBeenCalled();
  });

  it("creates realtime relay sessions with voice context and opt-in direct tools", async () => {
    const provider = {
      id: "openai",
      label: "OpenAI Realtime",
      isConfigured: () => true,
      createBridge: vi.fn(),
    };
    const directTool = {
      type: "function",
      name: "read",
      description: "Read a file",
      parameters: { type: "object", properties: {} },
    };
    const directExecutors = new Map([["read", vi.fn()]]);
    mocks.resolveConfiguredRealtimeVoiceProvider.mockReturnValue({
      provider,
      providerConfig: { apiKey: "openai-key" },
    });
    mocks.resolveSessionKeyFromResolveParams.mockResolvedValue({
      ok: true,
      key: "agent:sky:main",
    });
    mocks.readVoiceAgentBasePrompt.mockResolvedValue({
      source: "agent-file",
      path: "/tmp/voice-agent-base.md",
      text: "Sky voice base\n",
      fingerprint: "sha256:voice",
    });
    mocks.buildTalkRealtimeContextPacket.mockResolvedValue({
      text: "Recent visible history\nLatest message-tool delivery: sent",
      summarySource: "none",
    });
    mocks.createRealtimeDirectTools.mockReturnValue({
      tools: [directTool],
      executors: directExecutors,
      excludedTools: [],
    });
    mocks.createTalkRealtimeRelaySession.mockReturnValue({
      provider: "openai",
      transport: "gateway-relay",
      relaySessionId: "relay-context-1",
      audio: {
        inputEncoding: "pcm16",
        inputSampleRateHz: 24000,
        outputEncoding: "pcm16",
        outputSampleRateHz: 24000,
      },
      expiresAt: 1_797_986_400,
    });

    const respond = vi.fn();
    await talkHandlers["talk.session.create"]({
      req: { type: "req", id: "1", method: "talk.session.create" },
      params: {
        sessionKey: "sky",
        mode: "realtime",
        transport: "gateway-relay",
        brain: "agent-consult",
      },
      client: { connId: "conn-1", connect: { scopes: ["operator.admin"] } } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {
        getRuntimeConfig: () =>
          ({
            agents: { list: [{ id: "sky", default: true }] },
            talk: {
              realtime: {
                provider: "openai",
                providers: { openai: { apiKey: "openai-key" } },
                instructions: "Speak warmly.",
                tools: { profile: "voice", deny: ["message"] },
              },
            },
          }) as OpenClawConfig,
      } as never,
    });

    expect(mocks.resolveSessionKeyFromResolveParams).toHaveBeenCalledWith(
      expect.objectContaining({
        p: expect.objectContaining({ key: "sky" }),
      }),
    );
    expect(mocks.readVoiceAgentBasePrompt).toHaveBeenCalledWith(
      expect.objectContaining({ agentDir: expect.stringContaining("sky") }),
    );
    expect(mocks.buildTalkRealtimeContextPacket).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "sky",
        sessionKey: "agent:sky:main",
        summaryThresholdTokens: 100_000,
      }),
    );
    expect(mocks.createRealtimeDirectTools).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "sky",
        sessionKey: "agent:sky:main",
        modelProvider: "openai",
        senderIsOwner: true,
      }),
    );
    const createInput = mockCallArg(mocks.createTalkRealtimeRelaySession) as Record<
      string,
      unknown
    >;
    expect(createInput.instructions).toContain("Sky voice base\n");
    expect(createInput.instructions).toContain("Realtime context:\nRecent visible history");
    expect(createInput.instructions).toContain("Additional realtime instructions:\nSpeak warmly.");
    expect(createInput.tools).toEqual([
      expect.objectContaining({ name: "openclaw_agent_consult" }),
      expect.objectContaining({ name: "openclaw_agent_control" }),
      directTool,
    ]);
    expect(createInput.directToolExecutors).toBe(directExecutors);
    expectRecordFields(createInput, { sessionKey: "agent:sky:main" });
    expectRespondOk(respond, { sessionId: "relay-context-1" });
  });

  it("starts realtime relay sessions with degraded context when context assembly times out", async () => {
    vi.useFakeTimers();
    try {
      const provider = {
        id: "openai",
        label: "OpenAI Realtime",
        isConfigured: () => true,
        createBridge: vi.fn(),
      };
      mocks.resolveConfiguredRealtimeVoiceProvider.mockReturnValue({
        provider,
        providerConfig: { apiKey: "openai-key" },
      });
      mocks.resolveSessionKeyFromResolveParams.mockResolvedValue({
        ok: true,
        key: "agent:sky:main",
      });
      mocks.readVoiceAgentBasePrompt.mockResolvedValue({
        source: "agent-file",
        path: "/tmp/voice-agent-base.md",
        text: "Sky voice base\n",
        fingerprint: "sha256:voice",
      });
      mocks.buildTalkRealtimeContextPacket.mockImplementation(
        () =>
          new Promise(() => {
            // Intentionally never resolves; this proves session startup uses the timeout path.
          }),
      );
      mocks.createTalkRealtimeRelaySession.mockReturnValue({
        provider: "openai",
        transport: "gateway-relay",
        relaySessionId: "relay-context-timeout-1",
        audio: {
          inputEncoding: "pcm16",
          inputSampleRateHz: 24000,
          outputEncoding: "pcm16",
          outputSampleRateHz: 24000,
        },
        expiresAt: 1_797_986_400,
      });

      const respond = vi.fn();
      const createPromise = talkHandlers["talk.session.create"]({
        req: { type: "req", id: "1", method: "talk.session.create" },
        params: {
          sessionKey: "sky",
          mode: "realtime",
          transport: "gateway-relay",
          brain: "agent-consult",
        },
        client: { connId: "conn-1", connect: { scopes: ["operator.admin"] } } as never,
        isWebchatConnect: () => false,
        respond: respond as never,
        context: {
          getRuntimeConfig: () =>
            ({
              agents: { list: [{ id: "sky", default: true }] },
              talk: {
                realtime: {
                  provider: "openai",
                  providers: { openai: { apiKey: "openai-key" } },
                },
              },
            }) as OpenClawConfig,
        } as never,
      });

      await vi.advanceTimersByTimeAsync(1_500);
      await createPromise;

      const createInput = mockCallArg(mocks.createTalkRealtimeRelaySession) as Record<
        string,
        unknown
      >;
      expect(createInput.instructions).toContain(
        "Realtime session context was skipped because context assembly exceeded the startup budget.",
      );
      expectRespondOk(respond, { sessionId: "relay-context-timeout-1" });
      expect(mocks.buildTalkRealtimeContextPacket).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: "sky",
          sessionKey: "agent:sky:main",
          signal: expect.any(AbortSignal),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates transcription gateway-relay sessions through the unified API", async () => {
    const provider = {
      id: "openai",
      label: "OpenAI Realtime Transcription",
      autoSelectOrder: 1,
      resolveConfig: vi.fn(({ rawConfig }) => rawConfig),
      isConfigured: vi.fn(({ providerConfig }) => providerConfig.apiKey === "stt-key"),
      createSession: vi.fn(),
    };
    mocks.listRealtimeTranscriptionProviders.mockReturnValue([provider] as never);
    mocks.createTalkTranscriptionRelaySession.mockReturnValue({
      provider: "openai",
      mode: "transcription",
      transport: "gateway-relay",
      transcriptionSessionId: "stt-unified-1",
      audio: { inputEncoding: "g711_ulaw", inputSampleRateHz: 8000 },
      expiresAt: 1_797_986_400,
    });

    const createRespond = vi.fn();
    await talkHandlers["talk.session.create"]({
      req: { type: "req", id: "1", method: "talk.session.create" },
      params: { mode: "transcription", provider: "openai" },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: createRespond as never,
      context: {
        getRuntimeConfig: () =>
          ({
            plugins: {
              entries: {
                "voice-call": {
                  config: {
                    streaming: {
                      provider: "openai",
                      providers: { openai: { apiKey: "stt-key" } },
                    },
                  },
                },
              },
            },
          }) as OpenClawConfig,
      } as never,
    });

    expectRespondOk(createRespond, {
      sessionId: "stt-unified-1",
      transcriptionSessionId: "stt-unified-1",
      mode: "transcription",
      transport: "gateway-relay",
      brain: "none",
    });
    expect(mocks.createTalkTranscriptionRelaySession).toHaveBeenCalledWith({
      context: expect.any(Object),
      connId: "conn-1",
      transcriptionMode: "streaming",
      provider: "openai",
      streamingProvider: provider,
      streamingProviderConfig: { apiKey: "stt-key" },
    });
    const inputRespond = vi.fn();
    await talkHandlers["talk.session.appendAudio"]({
      req: { type: "req", id: "2", method: "talk.session.appendAudio" },
      params: { sessionId: "stt-unified-1", audioBase64: "aGVsbG8=" },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: inputRespond as never,
      context: {} as never,
    });
    expect(mocks.sendTalkTranscriptionRelayAudio).toHaveBeenCalledWith({
      transcriptionSessionId: "stt-unified-1",
      connId: "conn-1",
      audioBase64: "aGVsbG8=",
    });

    const closeRespond = vi.fn();
    await talkHandlers["talk.session.close"]({
      req: { type: "req", id: "3", method: "talk.session.close" },
      params: { sessionId: "stt-unified-1" },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: closeRespond as never,
      context: {} as never,
    });
    expect(mocks.stopTalkTranscriptionRelaySession).toHaveBeenCalledWith({
      transcriptionSessionId: "stt-unified-1",
      connId: "conn-1",
    });
  });

  it("rejects unknown media-understanding transcription providers at create time", async () => {
    mocks.buildMediaUnderstandingRegistry.mockReturnValue(new Map());
    const createRespond = vi.fn();

    await talkHandlers["talk.session.create"]({
      req: { type: "req", id: "1", method: "talk.session.create" },
      params: { mode: "transcription", transcriptionMode: "buffered", provider: "typo-provider" },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: createRespond as never,
      context: { getRuntimeConfig: () => ({}) as OpenClawConfig } as never,
    });

    expect(mockCallArg(createRespond)).toBe(false);
    expectRecordFields(mockCallArg(createRespond, 0, 2), {
      code: ErrorCodes.INVALID_REQUEST,
      message:
        'transcription provider "typo-provider" is not registered for media-understanding audio transcription',
    });
    expect(mocks.createTalkTranscriptionRelaySession).not.toHaveBeenCalled();
  });

  it("creates and controls managed-room sessions through the unified API", async () => {
    const broadcastToConnIds = vi.fn();
    const createRespond = vi.fn();
    await talkHandlers["talk.session.create"]({
      req: { type: "req", id: "1", method: "talk.session.create" },
      params: {
        mode: "stt-tts",
        transport: "managed-room",
        sessionKey: "session:main",
        ttlMs: 5000,
      },
      client: { connId: "conn-1", connect: { scopes: ["operator.admin"] } } as never,
      isWebchatConnect: () => false,
      respond: createRespond as never,
      context: {
        getRuntimeConfig: () => ({}) as OpenClawConfig,
      } as never,
    });
    const session = mockCallArg(createRespond, 0, 1) as { sessionId: string; token: string };

    const createResult = expectRespondOk(createRespond, {
      transport: "managed-room",
      brain: "agent-consult",
    }) as Record<string, unknown>;
    expect(createResult.sessionId).toBeTypeOf("string");
    expect(createResult.handoffId).toBeTypeOf("string");
    expect(createResult.roomId).toMatch(/^talk_/);
    expect(createResult.token).toBeTypeOf("string");
    expect(mocks.resolveSessionKeyFromResolveParams).toHaveBeenCalledWith({
      cfg: {},
      p: {
        key: "session:main",
        includeGlobal: true,
        includeUnknown: true,
      },
    });

    const joinRespond = vi.fn();
    await talkHandlers["talk.session.join"]({
      req: { type: "req", id: "2", method: "talk.session.join" },
      params: { sessionId: session.sessionId, token: session.token },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: joinRespond as never,
      context: {
        broadcastToConnIds,
      } as never,
    });
    const joinResult = expectRespondOk(joinRespond, { id: session.sessionId }) as {
      room?: Record<string, unknown>;
    };
    expectRecordFields(joinResult.room, { activeClientId: "conn-1" });
    expect(mockCallArg(broadcastToConnIds)).toBe("talk.event");
    const readyEventPayload = expectRecordFields(mockCallArg(broadcastToConnIds, 0, 1), {
      handoffId: session.sessionId,
    });
    expectRecordFields(readyEventPayload.talkEvent, { type: "session.ready" });
    expect(mockCallArg(broadcastToConnIds, 0, 2)).toEqual(new Set(["conn-1"]));
    expect(mockCallArg(broadcastToConnIds, 0, 3)).toEqual({ dropIfSlow: true });

    const startRespond = vi.fn();
    await talkHandlers["talk.session.startTurn"]({
      req: { type: "req", id: "3", method: "talk.session.startTurn" },
      params: { sessionId: session.sessionId, turnId: "turn-1" },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: startRespond as never,
      context: {
        getRuntimeConfig: () => ({}) as OpenClawConfig,
        broadcastToConnIds,
      } as never,
    });

    const startResult = expectRespondOk(startRespond, { ok: true, turnId: "turn-1" }) as {
      events?: unknown[];
    };
    expect(startResult.events).toHaveLength(1);
    expectRecordFields(startResult.events?.[0], { type: "turn.started", turnId: "turn-1" });
    expect(mockCallArg(broadcastToConnIds, 1)).toBe("talk.event");
    const startEventPayload = expectRecordFields(mockCallArg(broadcastToConnIds, 1, 1), {
      handoffId: session.sessionId,
    });
    expectRecordFields(startEventPayload.talkEvent, {
      type: "turn.started",
      turnId: "turn-1",
    });
    expect(mockCallArg(broadcastToConnIds, 1, 2)).toEqual(new Set(["conn-1"]));
    expect(mockCallArg(broadcastToConnIds, 1, 3)).toEqual({ dropIfSlow: true });

    const mismatchedSteerRespond = vi.fn();
    await talkHandlers["talk.session.steer"]({
      req: { type: "req", id: "4", method: "talk.session.steer" },
      params: {
        sessionId: session.sessionId,
        sessionKey: "session:other",
        text: "use the safer plan",
        mode: "steer",
      },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: mismatchedSteerRespond as never,
      context: {
        broadcastToConnIds,
      } as never,
    });
    expectRespondError(mismatchedSteerRespond, {
      code: ErrorCodes.INVALID_REQUEST,
      message: "talk.session.steer sessionKey does not match the managed-room session",
    });
    expect(mocks.controlRealtimeVoiceAgentRun).not.toHaveBeenCalled();

    const steerRespond = vi.fn();
    await talkHandlers["talk.session.steer"]({
      req: { type: "req", id: "5", method: "talk.session.steer" },
      params: {
        sessionId: session.sessionId,
        text: "use the safer plan",
        mode: "steer",
      },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: steerRespond as never,
      context: {
        broadcastToConnIds,
      } as never,
    });
    expect(mocks.controlRealtimeVoiceAgentRun).toHaveBeenCalledWith({
      sessionKey: "session:main",
      text: "use the safer plan",
      mode: "steer",
      recentEvents: expect.any(Array),
    });
    expectRespondOk(steerRespond, {
      ok: true,
      mode: "steer",
      sessionKey: "session:main",
    });

    const closeRespond = vi.fn();
    await talkHandlers["talk.session.close"]({
      req: { type: "req", id: "6", method: "talk.session.close" },
      params: { sessionId: session.sessionId },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: closeRespond as never,
      context: {
        broadcastToConnIds,
      } as never,
    });
    expect(closeRespond).toHaveBeenCalledWith(true, { ok: true }, undefined);
    expect(mockCallArg(broadcastToConnIds, 2)).toBe("talk.event");
    const closedEventPayload = expectRecordFields(mockCallArg(broadcastToConnIds, 2, 1), {
      handoffId: session.sessionId,
    });
    expectRecordFields(closedEventPayload.talkEvent, { type: "session.closed", final: true });
    expect(mockCallArg(broadcastToConnIds, 2, 2)).toEqual(new Set(["conn-1"]));
    expect(mockCallArg(broadcastToConnIds, 2, 3)).toEqual({ dropIfSlow: true });
  });

  it("passes managed-room spawnedBy visibility scope to session resolution", async () => {
    const createRespond = vi.fn();
    await talkHandlers["talk.session.create"]({
      req: { type: "req", id: "1", method: "talk.session.create" },
      params: {
        mode: "stt-tts",
        transport: "managed-room",
        sessionKey: "agent:worker:subagent:child",
        spawnedBy: "agent:main:parent",
      },
      client: { connId: "conn-1", connect: { scopes: ["operator.write"] } } as never,
      isWebchatConnect: () => false,
      respond: createRespond as never,
      context: {
        getRuntimeConfig: () => ({}) as OpenClawConfig,
      } as never,
    });

    expectRespondOk(createRespond, {
      transport: "managed-room",
      brain: "agent-consult",
    });
    expect(mocks.resolveSessionKeyFromResolveParams).toHaveBeenCalledWith({
      cfg: {},
      p: {
        key: "agent:worker:subagent:child",
        spawnedBy: "agent:main:parent",
        includeGlobal: true,
        includeUnknown: true,
      },
    });
  });

  it("rejects unscoped managed-room session keys without admin scope", async () => {
    const createRespond = vi.fn();
    await talkHandlers["talk.session.create"]({
      req: { type: "req", id: "1", method: "talk.session.create" },
      params: {
        mode: "stt-tts",
        transport: "managed-room",
        sessionKey: "agent:worker:main",
      },
      client: { connId: "conn-1", connect: { scopes: ["operator.write"] } } as never,
      isWebchatConnect: () => false,
      respond: createRespond as never,
      context: {
        getRuntimeConfig: () => ({}) as OpenClawConfig,
      } as never,
    });

    expectRespondError(createRespond, {
      code: ErrorCodes.INVALID_REQUEST,
      message:
        "talk.session.create managed-room sessionKey requires spawnedBy or gateway scope: operator.admin",
    });
    expect(mocks.resolveSessionKeyFromResolveParams).not.toHaveBeenCalled();
  });

  it("requires managed-room ownership before turn control", async () => {
    const broadcastToConnIds = vi.fn();
    const createRespond = vi.fn();
    await talkHandlers["talk.session.create"]({
      req: { type: "req", id: "1", method: "talk.session.create" },
      params: {
        mode: "stt-tts",
        transport: "managed-room",
        sessionKey: "session:main",
      },
      client: { connId: "creator", connect: { scopes: ["operator.admin"] } } as never,
      isWebchatConnect: () => false,
      respond: createRespond as never,
      context: {
        getRuntimeConfig: () => ({}) as OpenClawConfig,
      } as never,
    });
    const session = mockCallArg(createRespond, 0, 1) as { sessionId: string; token: string };

    const unjoinedStartRespond = vi.fn();
    await talkHandlers["talk.session.startTurn"]({
      req: { type: "req", id: "2", method: "talk.session.startTurn" },
      params: { sessionId: session.sessionId, turnId: "turn-1" },
      client: { connId: "creator" } as never,
      isWebchatConnect: () => false,
      respond: unjoinedStartRespond as never,
      context: { broadcastToConnIds } as never,
    });
    expectRespondError(unjoinedStartRespond, {
      code: ErrorCodes.INVALID_REQUEST,
      message: "talk.session.startTurn requires the active managed-room connection",
    });

    await talkHandlers["talk.session.join"]({
      req: { type: "req", id: "3", method: "talk.session.join" },
      params: { sessionId: session.sessionId, token: session.token },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: vi.fn() as never,
      context: { broadcastToConnIds } as never,
    });

    const staleStartRespond = vi.fn();
    await talkHandlers["talk.session.startTurn"]({
      req: { type: "req", id: "4", method: "talk.session.startTurn" },
      params: { sessionId: session.sessionId, turnId: "turn-1" },
      client: { connId: "conn-2" } as never,
      isWebchatConnect: () => false,
      respond: staleStartRespond as never,
      context: { broadcastToConnIds } as never,
    });
    expectRespondError(staleStartRespond, {
      code: ErrorCodes.INVALID_REQUEST,
      message: "talk.session.startTurn requires the active managed-room connection",
    });

    await talkHandlers["talk.session.startTurn"]({
      req: { type: "req", id: "5", method: "talk.session.startTurn" },
      params: { sessionId: session.sessionId, turnId: "turn-1" },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: vi.fn() as never,
      context: { broadcastToConnIds } as never,
    });

    const staleEndRespond = vi.fn();
    await talkHandlers["talk.session.endTurn"]({
      req: { type: "req", id: "6", method: "talk.session.endTurn" },
      params: { sessionId: session.sessionId, turnId: "turn-1" },
      client: { connId: "conn-2" } as never,
      isWebchatConnect: () => false,
      respond: staleEndRespond as never,
      context: { broadcastToConnIds } as never,
    });
    expectRespondError(staleEndRespond, {
      code: ErrorCodes.INVALID_REQUEST,
      message: "talk.session.endTurn requires the active managed-room connection",
    });

    const staleCancelRespond = vi.fn();
    await talkHandlers["talk.session.cancelTurn"]({
      req: { type: "req", id: "7", method: "talk.session.cancelTurn" },
      params: { sessionId: session.sessionId, turnId: "turn-1" },
      client: { connId: "conn-2" } as never,
      isWebchatConnect: () => false,
      respond: staleCancelRespond as never,
      context: { broadcastToConnIds } as never,
    });
    expectRespondError(staleCancelRespond, {
      code: ErrorCodes.INVALID_REQUEST,
      message: "talk.session.cancelTurn requires the active managed-room connection",
    });

    const staleCloseRespond = vi.fn();
    await talkHandlers["talk.session.close"]({
      req: { type: "req", id: "8", method: "talk.session.close" },
      params: { sessionId: session.sessionId },
      client: { connId: "conn-2" } as never,
      isWebchatConnect: () => false,
      respond: staleCloseRespond as never,
      context: { broadcastToConnIds } as never,
    });
    expectRespondError(staleCloseRespond, {
      code: ErrorCodes.INVALID_REQUEST,
      message: "talk.session.close requires the active managed-room connection",
    });

    await talkHandlers["talk.session.close"]({
      req: { type: "req", id: "9", method: "talk.session.close" },
      params: { sessionId: session.sessionId },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: vi.fn() as never,
      context: { broadcastToConnIds } as never,
    });
  });

  it("keeps direct-tools managed-room sessions behind admin scope", async () => {
    const rejectedRespond = vi.fn();
    await talkHandlers["talk.session.create"]({
      req: { type: "req", id: "1", method: "talk.session.create" },
      params: {
        mode: "stt-tts",
        transport: "managed-room",
        brain: "direct-tools",
        sessionKey: "session:main",
      },
      client: { connId: "conn-1", connect: { scopes: ["operator.write"] } } as never,
      isWebchatConnect: () => false,
      respond: rejectedRespond as never,
      context: {
        getRuntimeConfig: () => ({}) as OpenClawConfig,
      } as never,
    });

    expectRespondError(rejectedRespond, {
      code: ErrorCodes.INVALID_REQUEST,
      message: 'talk.session.create brain="direct-tools" requires gateway scope: operator.admin',
    });
    expect(mocks.resolveSessionKeyFromResolveParams).not.toHaveBeenCalled();

    const createRespond = vi.fn();
    await talkHandlers["talk.session.create"]({
      req: { type: "req", id: "2", method: "talk.session.create" },
      params: {
        mode: "stt-tts",
        transport: "managed-room",
        brain: "direct-tools",
        sessionKey: "session:main",
      },
      client: { connId: "conn-1", connect: { scopes: ["operator.admin"] } } as never,
      isWebchatConnect: () => false,
      respond: createRespond as never,
      context: {
        getRuntimeConfig: () => ({}) as OpenClawConfig,
      } as never,
    });

    const session = mockCallArg(createRespond, 0, 1) as { sessionId: string };
    const createResult = expectRespondOk(createRespond, {
      transport: "managed-room",
      brain: "direct-tools",
    }) as Record<string, unknown>;
    expect(createResult.sessionId).toBeTypeOf("string");

    await talkHandlers["talk.session.close"]({
      req: { type: "req", id: "3", method: "talk.session.close" },
      params: { sessionId: session.sessionId },
      client: { connId: "conn-1", connect: { scopes: ["operator.admin"] } } as never,
      isWebchatConnect: () => false,
      respond: vi.fn() as never,
      context: {} as never,
    });
  });

  it("keeps browser-owned transports on the client session endpoint", async () => {
    const respond = vi.fn();
    await talkHandlers["talk.session.create"]({
      req: { type: "req", id: "1", method: "talk.session.create" },
      params: { mode: "realtime", transport: "webrtc" },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: { getRuntimeConfig: () => ({}) as OpenClawConfig } as never,
    });

    const error = expectRespondError(respond, { code: ErrorCodes.INVALID_REQUEST });
    expect(error.message).toContain("use talk.client.create");
  });
});

describe("talk.client.toolCall handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chatSend.mockImplementation(
      async ({
        respond,
      }: {
        respond: (ok: boolean, result?: unknown, error?: unknown) => void;
      }) => {
        respond(true, { runId: "run-voice-1" }, undefined);
      },
    );
  });

  it("starts agent consult through gateway policy instead of exposing chat.send to browser clients", async () => {
    const respond = vi.fn();

    await talkHandlers["talk.client.toolCall"]({
      req: { type: "req", id: "1", method: "talk.client.toolCall" },
      params: {
        sessionKey: "main",
        spawnedBy: "agent:main:parent",
        callId: "call-1",
        name: "openclaw_agent_consult",
        args: { question: "What is in this repo?", responseStyle: "one sentence" },
      },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {
        getRuntimeConfig: () => ({}) as OpenClawConfig,
      } as never,
    });

    const chatInput = mockCallArg(mocks.chatSend) as {
      req?: Record<string, unknown>;
      params?: Record<string, unknown>;
    };
    expectRecordFields(chatInput.req, { method: "chat.send" });
    expectRecordFields(chatInput.params, {
      sessionKey: "main",
      spawnedBy: "agent:main:parent",
    });
    expect(chatInput.params?.message).toContain("What is in this repo?");
    expect(chatInput.params?.idempotencyKey).toMatch(/^talk-call-1-/);
    const response = expectRespondOk(respond, { runId: "run-voice-1" }) as Record<string, unknown>;
    expect(response.idempotencyKey).toMatch(/^talk-call-1-/);
  });

  it("passes configured consult thinking and fast-mode overrides to chat.send", async () => {
    const respond = vi.fn();

    await talkHandlers["talk.client.toolCall"]({
      req: { type: "req", id: "1", method: "talk.client.toolCall" },
      params: {
        sessionKey: "main",
        callId: "call-1",
        name: "openclaw_agent_consult",
        args: { question: "Are the basement lights off?" },
      },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {
        getRuntimeConfig: () =>
          ({
            talk: {
              consultThinkingLevel: "low",
              consultFastMode: true,
            },
          }) as OpenClawConfig,
      } as never,
    });

    const chatInput = mockCallArg(mocks.chatSend) as { params?: Record<string, unknown> };
    expectRecordFields(chatInput.params, {
      thinking: "low",
      fastMode: true,
    });
    expectRespondOk(respond, { runId: "run-voice-1" });
  });

  it("links relay-owned agent consult runs so relay cancellation can abort them", async () => {
    const respond = vi.fn();

    await talkHandlers["talk.client.toolCall"]({
      req: { type: "req", id: "1", method: "talk.client.toolCall" },
      params: {
        sessionKey: "main",
        relaySessionId: "relay-1",
        callId: "call-1",
        name: "openclaw_agent_consult",
        args: { question: "What now?" },
      },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {
        getRuntimeConfig: () => ({}) as OpenClawConfig,
      } as never,
    });

    expect(mocks.registerTalkRealtimeRelayAgentRun).toHaveBeenCalledWith({
      relaySessionId: "relay-1",
      connId: "conn-1",
      sessionKey: "main",
      runId: "run-voice-1",
      callId: "call-1",
    });
    expectRespondOk(respond, { runId: "run-voice-1" });
  });

  it.each([
    ["timeout", "Realtime agent consult ended before the run started."],
    ["error", "Realtime agent consult failed before the run started."],
    ["ok", "Realtime agent consult completed before the tool result subscription started."],
  ] as const)(
    "rejects terminal agent consult chat.send ACKs with status %s",
    async (status, message) => {
      mocks.chatSend.mockImplementationOnce(
        async ({
          respond,
        }: {
          respond: (ok: boolean, result?: unknown, error?: unknown) => void;
        }) => {
          respond(true, { runId: `run-${status}`, status }, undefined);
        },
      );
      const respond = vi.fn();

      await talkHandlers["talk.client.toolCall"]({
        req: { type: "req", id: "1", method: "talk.client.toolCall" },
        params: {
          sessionKey: "main",
          relaySessionId: "relay-1",
          callId: "call-1",
          name: "openclaw_agent_consult",
          args: { question: "What now?" },
        },
        client: { connId: "conn-1" } as never,
        isWebchatConnect: () => false,
        respond: respond as never,
        context: {
          getRuntimeConfig: () => ({}) as OpenClawConfig,
        } as never,
      });

      expect(mocks.registerTalkRealtimeRelayAgentRun).not.toHaveBeenCalled();
      expectRespondError(respond, {
        code: ErrorCodes.UNAVAILABLE,
        message,
      });
    },
  );

  it("rejects client tool calls that are not the agent consult tool", async () => {
    const respond = vi.fn();

    await talkHandlers["talk.client.toolCall"]({
      req: { type: "req", id: "1", method: "talk.client.toolCall" },
      params: {
        sessionKey: "main",
        callId: "call-1",
        name: "unknown_tool",
      },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {
        getRuntimeConfig: () => ({}) as OpenClawConfig,
      } as never,
    });

    expect(mocks.chatSend).not.toHaveBeenCalled();
    expectRespondError(respond, {
      code: ErrorCodes.INVALID_REQUEST,
      message: "unsupported realtime Talk tool: unknown_tool",
    });
  });
});

describe("talk.client.steer handler", () => {
  const createSteerContext = (ownerConnId = "conn-1") =>
    ({
      chatAbortControllers: new Map([
        [
          "run-voice-1",
          {
            controller: new AbortController(),
            sessionId: "session-active",
            sessionKey: "agent:main:main",
            startedAtMs: 1,
            expiresAtMs: Date.now() + 60_000,
            ownerConnId,
            kind: "chat-send",
          },
        ],
      ]),
    }) as never;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.controlRealtimeVoiceAgentRun.mockResolvedValue({
      ok: true,
      mode: "steer",
      sessionKey: "agent:main:main",
      sessionId: "session-active",
      active: true,
      queued: true,
      message: "Steered the active OpenClaw run.",
      speak: false,
      show: true,
      suppress: true,
    });
  });

  it("routes browser-owned voice steering through the shared agent control helper", async () => {
    const respond = vi.fn();

    await talkHandlers["talk.client.steer"]({
      req: { type: "req", id: "1", method: "talk.client.steer" },
      params: {
        sessionKey: "agent:main:main",
        text: "use the safer plan",
        mode: "steer",
      },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: createSteerContext(),
    });

    expect(mocks.controlRealtimeVoiceAgentRun).toHaveBeenCalledWith({
      sessionKey: "agent:main:main",
      text: "use the safer plan",
      mode: "steer",
    });
    expectRespondOk(respond, {
      ok: true,
      mode: "steer",
      sessionKey: "agent:main:main",
    });
  });

  it("rejects steering for a session key owned by another connection", async () => {
    const respond = vi.fn();

    await talkHandlers["talk.client.steer"]({
      req: { type: "req", id: "1", method: "talk.client.steer" },
      params: {
        sessionKey: "agent:main:main",
        text: "use the safer plan",
        mode: "steer",
      },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: createSteerContext("conn-2"),
    });

    expect(mocks.controlRealtimeVoiceAgentRun).not.toHaveBeenCalled();
    expectRespondError(respond, {
      code: ErrorCodes.INVALID_REQUEST,
      message: "talk.client.steer requires an active browser-owned Talk run",
    });
  });

  it("rejects malformed client steering params", async () => {
    const respond = vi.fn();

    await talkHandlers["talk.client.steer"]({
      req: { type: "req", id: "1", method: "talk.client.steer" },
      params: {
        sessionKey: "agent:main:main",
        text: "",
      },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {} as never,
    });

    expect(mocks.controlRealtimeVoiceAgentRun).not.toHaveBeenCalled();
    expectRespondError(respond, { code: ErrorCodes.INVALID_REQUEST });
  });
});

describe("talk.client.create handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses talk.realtime provider, model, voice, and instructions without reading speech provider config", async () => {
    const createBrowserSession = vi.fn(async (_input: unknown) => ({
      provider: "openai",
      transport: "webrtc" as const,
      clientSecret: "secret",
    }));
    const provider = {
      id: "openai",
      label: "OpenAI Realtime",
      isConfigured: () => true,
      createBrowserSession,
      createBridge: vi.fn(),
    };
    mocks.resolveConfiguredRealtimeVoiceProvider.mockReturnValue({
      provider,
      providerConfig: { apiKey: "openai-key", model: "gpt-realtime" },
    });

    const respond = vi.fn();
    await talkHandlers["talk.client.create"]({
      req: { type: "req", id: "1", method: "talk.client.create" },
      params: {
        sessionKey: "main",
        vadThreshold: 0.45,
        silenceDurationMs: 650,
        prefixPaddingMs: 250,
        reasoningEffort: "low",
      },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {
        getRuntimeConfig: () =>
          ({
            talk: {
              provider: "elevenlabs",
              providers: { elevenlabs: { apiKey: "speech-key" } },
              realtime: {
                provider: "openai",
                providers: { openai: { apiKey: "openai-key" } },
                model: "gpt-realtime",
                voice: "alloy",
                instructions: "Speak warmly.",
              },
            },
          }) as OpenClawConfig,
      } as never,
    });

    expectRecordFields(mockCallArg(mocks.resolveConfiguredRealtimeVoiceProvider), {
      configuredProviderId: "openai",
      providerConfigs: { openai: { apiKey: "openai-key" } },
    });
    const createInput = mockCallArg(createBrowserSession) as Record<string, unknown>;
    expectRecordFields(createInput, {
      model: "gpt-realtime",
      voice: "alloy",
      vadThreshold: 0.45,
      silenceDurationMs: 650,
      prefixPaddingMs: 250,
      reasoningEffort: "low",
    });
    expect(createInput.instructions).toContain("Additional realtime instructions:\nSpeak warmly.");
    expect(createInput.instructions).toContain("tool-backed actions");
    expect(createInput.instructions).toContain("Let me check that for you");
    expect(createInput).not.toHaveProperty("provider");
    expect(createInput).not.toHaveProperty("providers");
    expect(createInput).not.toHaveProperty("transport");
    expectRespondOk(respond, { provider: "openai", transport: "webrtc" });
  });

  it("rejects Gateway-owned transports on the client endpoint", async () => {
    const respond = vi.fn();
    await talkHandlers["talk.client.create"]({
      req: { type: "req", id: "1", method: "talk.client.create" },
      params: { sessionKey: "main", mode: "realtime", transport: "gateway-relay" },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: { getRuntimeConfig: () => ({}) as OpenClawConfig } as never,
    });

    expectRespondError(respond, {
      message: "talk.client.create is client-owned; use talk.session.create for gateway-relay",
    });
    expect(mocks.resolveConfiguredRealtimeVoiceProvider).not.toHaveBeenCalled();
  });

  it("rejects realtime brains the client endpoint cannot run", async () => {
    const respond = vi.fn();
    await talkHandlers["talk.client.create"]({
      req: { type: "req", id: "1", method: "talk.client.create" },
      params: { sessionKey: "main" },
      client: { connId: "conn-1" } as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {
        getRuntimeConfig: () =>
          ({
            talk: {
              realtime: {
                brain: "direct-tools",
              },
            },
          }) as OpenClawConfig,
      } as never,
    });

    expect(mocks.resolveConfiguredRealtimeVoiceProvider).not.toHaveBeenCalled();
    expectRespondError(respond, {
      message: 'talk.client.create only supports brain="agent-consult"',
    });
  });
});
