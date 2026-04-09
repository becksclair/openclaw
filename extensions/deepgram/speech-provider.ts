import { normalizeResolvedSecretInputString } from "openclaw/plugin-sdk/secret-input";
import type {
  SpeechDirectiveTokenParseContext,
  SpeechProviderConfig,
  SpeechProviderOverrides,
  SpeechProviderPlugin,
} from "openclaw/plugin-sdk/speech";
import {
  asFiniteNumber,
  readResponseTextLimited,
  trimToUndefined,
  truncateErrorDetail,
} from "openclaw/plugin-sdk/speech";

// Deepgram TTS API constants
const DEFAULT_DEEPGRAM_BASE_URL = "https://api.deepgram.com/v1";

// Deepgram Aura TTS models (voice models are paired, e.g., aura-2-luna-en)
const DEEPGRAM_TTS_MODELS = [
  "aura-2-luna-en",
  "aura-2-asteria-en",
  "aura-2-athena-en",
  "aura-2-helios-en",
  "aura-2-orion-en",
  "aura-2-thalia-en",
  "aura-2-andromeda-en",
  "aura-luna-en",
  "aura-asteria-en",
  "aura-athena-en",
  "aura-helios-en",
  "aura-orion-en",
] as const;

// Extract unique voice IDs from model names (e.g., "luna", "asteria")
const extractVoiceFromModel = (model: string): string => {
  const match = model.match(/aura-(?:2-)?([a-z]+)-/);
  return match?.[1] ?? model;
};

// Build voice list from models
const DEEPGRAM_TTS_VOICES = DEEPGRAM_TTS_MODELS.map((model) => extractVoiceFromModel(model));

// Valid response formats for Deepgram TTS
const DEEPGRAM_RESPONSE_FORMATS = ["mp3", "opus", "wav", "flac", "pcm"] as const;

type DeepgramTtsProviderConfig = {
  apiKey?: string;
  baseUrl: string;
  model: string;
  voice: string;
  speed?: number;
  responseFormat?: (typeof DEEPGRAM_RESPONSE_FORMATS)[number];
};

type DeepgramTtsProviderOverrides = {
  model?: string;
  voice?: string;
  speed?: number;
};

function normalizeDeepgramBaseUrl(baseUrl?: string): string {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return DEFAULT_DEEPGRAM_BASE_URL;
  }
  return trimmed.replace(/\/+$/, "");
}

function isValidDeepgramModel(model: string): boolean {
  return DEEPGRAM_TTS_MODELS.includes(model as (typeof DEEPGRAM_TTS_MODELS)[number]);
}

function normalizeDeepgramResponseFormat(
  value: unknown,
): (typeof DEEPGRAM_RESPONSE_FORMATS)[number] | undefined {
  const next = trimToUndefined(value)?.toLowerCase();
  if (!next) {
    return undefined;
  }
  if (DEEPGRAM_RESPONSE_FORMATS.includes(next as (typeof DEEPGRAM_RESPONSE_FORMATS)[number])) {
    return next as (typeof DEEPGRAM_RESPONSE_FORMATS)[number];
  }
  return undefined;
}

function resolveResponseFormat(
  target: "audio-file" | "voice-note",
  configuredFormat?: (typeof DEEPGRAM_RESPONSE_FORMATS)[number],
): (typeof DEEPGRAM_RESPONSE_FORMATS)[number] {
  if (configuredFormat) {
    return configuredFormat;
  }
  return target === "voice-note" ? "opus" : "mp3";
}

function responseFormatToFileExtension(
  format: (typeof DEEPGRAM_RESPONSE_FORMATS)[number],
): ".mp3" | ".opus" | ".wav" | ".flac" | ".pcm" {
  switch (format) {
    case "opus":
      return ".opus";
    case "wav":
      return ".wav";
    case "flac":
      return ".flac";
    case "pcm":
      return ".pcm";
    default:
      return ".mp3";
  }
}

function normalizeDeepgramProviderConfig(
  rawConfig: Record<string, unknown>,
): DeepgramTtsProviderConfig {
  const providers = (rawConfig.providers ?? {}) as Record<string, unknown>;
  const raw = (providers.deepgram ?? rawConfig.deepgram ?? {}) as Record<string, unknown>;

  return {
    apiKey: normalizeResolvedSecretInputString({
      value: raw?.apiKey,
      path: "messages.tts.providers.deepgram.apiKey",
    }),
    baseUrl: normalizeDeepgramBaseUrl(trimToUndefined(raw?.baseUrl)),
    model: trimToUndefined(raw?.model) ?? "aura-2-luna-en",
    voice: trimToUndefined(raw?.voice) ?? "luna",
    speed: asFiniteNumber(raw?.speed),
    responseFormat: normalizeDeepgramResponseFormat(raw?.responseFormat),
  };
}

function readDeepgramProviderConfig(config: SpeechProviderConfig): DeepgramTtsProviderConfig {
  const normalized = normalizeDeepgramProviderConfig({});
  return {
    apiKey: trimToUndefined(config.apiKey) ?? normalized.apiKey,
    baseUrl: trimToUndefined(config.baseUrl) ?? normalized.baseUrl,
    model: trimToUndefined(config.model) ?? normalized.model,
    voice: trimToUndefined(config.voice) ?? normalized.voice,
    speed: asFiniteNumber(config.speed) ?? normalized.speed,
    responseFormat:
      normalizeDeepgramResponseFormat(config.responseFormat) ?? normalized.responseFormat,
  };
}

function readDeepgramOverrides(
  overrides: SpeechProviderOverrides | undefined,
): DeepgramTtsProviderOverrides {
  if (!overrides) {
    return {};
  }
  return {
    model: trimToUndefined(overrides.model),
    voice: trimToUndefined(overrides.voice),
    speed: asFiniteNumber(overrides.speed),
  };
}

function resolveModelFromVoice(voice: string): string {
  // Find a model that includes this voice
  const model = DEEPGRAM_TTS_MODELS.find((m) => m.includes(voice.toLowerCase()));
  return model ?? "aura-2-luna-en";
}

async function extractDeepgramErrorDetail(response: Response): Promise<string | undefined> {
  const rawBody = trimToUndefined(await readResponseTextLimited(response));
  if (!rawBody) {
    return undefined;
  }
  try {
    const payload = JSON.parse(rawBody);
    return (
      truncateErrorDetail(payload.message ?? payload.error?.message) ?? truncateErrorDetail(rawBody)
    );
  } catch {
    return truncateErrorDetail(rawBody);
  }
}

async function deepgramTTS(params: {
  text: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  responseFormat: (typeof DEEPGRAM_RESPONSE_FORMATS)[number];
  timeoutMs: number;
}): Promise<Buffer> {
  const { text, apiKey, baseUrl, model, responseFormat, timeoutMs } = params;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL(`${baseUrl}/speak`);
    url.searchParams.set("model", model);
    url.searchParams.set("encoding", responseFormat === "pcm" ? "linear16" : responseFormat);

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "text/plain",
        Accept: "audio/*",
      },
      body: text,
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await extractDeepgramErrorDetail(response);
      const requestId = trimToUndefined(response.headers.get("dg-request-id"));
      throw new Error(
        `Deepgram TTS API error (${response.status})` +
          (detail ? `: ${detail}` : "") +
          (requestId ? ` [request_id=${requestId}]` : ""),
      );
    }

    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

function parseDirectiveToken(ctx: SpeechDirectiveTokenParseContext): {
  handled: boolean;
  overrides?: SpeechProviderOverrides;
  warnings?: string[];
} {
  switch (ctx.key) {
    case "voice":
    case "deepgram_voice":
    case "deepgramvoice":
      if (!ctx.policy.allowVoice) {
        return { handled: true };
      }
      return { handled: true, overrides: { voice: ctx.value } };
    case "model":
    case "deepgram_model":
    case "deepgrammodel":
      if (!ctx.policy.allowModelId) {
        return { handled: true };
      }
      return { handled: true, overrides: { model: ctx.value } };
    default:
      return { handled: false };
  }
}

export function buildDeepgramSpeechProvider(): SpeechProviderPlugin {
  return {
    id: "deepgram",
    label: "Deepgram",
    autoSelectOrder: 20,
    models: DEEPGRAM_TTS_MODELS,
    voices: DEEPGRAM_TTS_VOICES,
    resolveConfig: ({ rawConfig }) => normalizeDeepgramProviderConfig(rawConfig),
    parseDirectiveToken,
    resolveTalkConfig: ({ baseTtsConfig, talkProviderConfig }) => {
      const base = normalizeDeepgramProviderConfig(baseTtsConfig);
      const responseFormat = normalizeDeepgramResponseFormat(talkProviderConfig.responseFormat);
      return {
        ...base,
        ...(talkProviderConfig.apiKey === undefined
          ? {}
          : {
              apiKey: normalizeResolvedSecretInputString({
                value: talkProviderConfig.apiKey,
                path: "talk.providers.deepgram.apiKey",
              }),
            }),
        ...(trimToUndefined(talkProviderConfig.baseUrl) == null
          ? {}
          : { baseUrl: trimToUndefined(talkProviderConfig.baseUrl) }),
        ...(trimToUndefined(talkProviderConfig.modelId) == null
          ? {}
          : { model: trimToUndefined(talkProviderConfig.modelId) }),
        ...(trimToUndefined(talkProviderConfig.voiceId) == null
          ? {}
          : { voice: trimToUndefined(talkProviderConfig.voiceId) }),
        ...(asFiniteNumber(talkProviderConfig.speed) == null
          ? {}
          : { speed: asFiniteNumber(talkProviderConfig.speed) }),
        ...(responseFormat == null ? {} : { responseFormat }),
      };
    },
    resolveTalkOverrides: ({ params }) => ({
      ...(trimToUndefined(params.voiceId) == null
        ? {}
        : { voice: trimToUndefined(params.voiceId) }),
      ...(trimToUndefined(params.modelId) == null
        ? {}
        : { model: trimToUndefined(params.modelId) }),
      ...(asFiniteNumber(params.speed) == null ? {} : { speed: asFiniteNumber(params.speed) }),
    }),
    listVoices: async () =>
      [...new Set(DEEPGRAM_TTS_VOICES)].map((voice) => ({
        id: voice,
        name: voice.charAt(0).toUpperCase() + voice.slice(1),
      })),
    isConfigured: ({ providerConfig }) =>
      Boolean(readDeepgramProviderConfig(providerConfig).apiKey || process.env.DEEPGRAM_API_KEY),
    synthesize: async (req) => {
      const config = readDeepgramProviderConfig(req.providerConfig);
      const overrides = readDeepgramOverrides(req.providerOverrides);
      const apiKey = config.apiKey || process.env.DEEPGRAM_API_KEY;
      if (!apiKey) {
        throw new Error("Deepgram API key missing");
      }

      // Voice override may require model resolution
      const voice = overrides.voice ?? config.voice;
      const model = overrides.model ?? config.model ?? resolveModelFromVoice(voice);

      if (!isValidDeepgramModel(model)) {
        throw new Error(`Invalid Deepgram TTS model: ${model}`);
      }

      const responseFormat = resolveResponseFormat(req.target, config.responseFormat);
      const audioBuffer = await deepgramTTS({
        text: req.text,
        apiKey,
        baseUrl: config.baseUrl,
        model,
        responseFormat,
        timeoutMs: req.timeoutMs,
      });

      return {
        audioBuffer,
        outputFormat: responseFormat,
        fileExtension: responseFormatToFileExtension(responseFormat),
        voiceCompatible: req.target === "voice-note" && responseFormat === "opus",
      };
    },
    synthesizeTelephony: async (req) => {
      const config = readDeepgramProviderConfig(req.providerConfig);
      const apiKey = config.apiKey || process.env.DEEPGRAM_API_KEY;
      if (!apiKey) {
        throw new Error("Deepgram API key missing");
      }

      const outputFormat = "pcm";
      const sampleRate = 8000; // Deepgram telephony typically uses 8kHz
      const audioBuffer = await deepgramTTS({
        text: req.text,
        apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        responseFormat: outputFormat,
        timeoutMs: req.timeoutMs,
      });

      return { audioBuffer, outputFormat, sampleRate };
    },
  };
}
