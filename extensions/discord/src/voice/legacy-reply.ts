import {
  agentCommandFromIngress,
  resolveTtsConfig,
  type ResolvedTtsConfig,
} from "openclaw/plugin-sdk/agent-runtime";
import type { OpenClawConfig, TtsConfig } from "openclaw/plugin-sdk/config-runtime";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import { parseTtsDirectives } from "openclaw/plugin-sdk/speech";
import { textToSpeech } from "openclaw/plugin-sdk/tts-runtime";
import { transcribeDiscordVoiceAudio } from "./audio-processing.js";

export function formatVoicePromptText(text: string, senderLabel: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  return senderLabel ? `${senderLabel}: ${trimmed}` : trimmed;
}

function mergeTtsConfig(base: TtsConfig, override?: TtsConfig): TtsConfig {
  if (!override) {
    return base;
  }
  const baseProviders = base.providers ?? {};
  const overrideProviders = override.providers ?? {};
  const mergedProviders = Object.fromEntries(
    [...new Set([...Object.keys(baseProviders), ...Object.keys(overrideProviders)])].map(
      (providerId) => {
        const baseProvider = baseProviders[providerId] ?? {};
        const overrideProvider = overrideProviders[providerId] ?? {};
        return [
          providerId,
          {
            ...baseProvider,
            ...overrideProvider,
          },
        ];
      },
    ),
  );
  return {
    ...base,
    ...override,
    modelOverrides: {
      ...base.modelOverrides,
      ...override.modelOverrides,
    },
    ...(Object.keys(mergedProviders).length === 0 ? {} : { providers: mergedProviders }),
  };
}

function resolveVoiceTtsConfig(params: { cfg: OpenClawConfig; override?: TtsConfig }): {
  cfg: OpenClawConfig;
  resolved: ResolvedTtsConfig;
} {
  if (!params.override) {
    return { cfg: params.cfg, resolved: resolveTtsConfig(params.cfg) };
  }
  const base = params.cfg.messages?.tts ?? {};
  const merged = mergeTtsConfig(base, params.override);
  const messages = params.cfg.messages ?? {};
  const cfg = {
    ...params.cfg,
    messages: {
      ...messages,
      tts: merged,
    },
  };
  return { cfg, resolved: resolveTtsConfig(cfg) };
}

export async function synthesizeDiscordVoiceReplyAudio(params: {
  cfg: OpenClawConfig;
  ttsOverride?: TtsConfig;
  entry: { guildId: string; channelId: string };
  replyText: string;
  logVerbose: (message: string) => void;
  logger: { warn(message: string): void };
}): Promise<string | undefined> {
  if (!params.replyText) {
    return undefined;
  }

  const { cfg: ttsCfg, resolved: ttsConfig } = resolveVoiceTtsConfig({
    cfg: params.cfg,
    override: params.ttsOverride,
  });
  const directive = parseTtsDirectives(params.replyText, ttsConfig.modelOverrides, {
    cfg: ttsCfg,
    providerConfigs: ttsConfig.providerConfigs,
  });
  const speakText = directive.overrides.ttsText ?? directive.cleanedText.trim();
  if (!speakText) {
    params.logVerbose(
      `tts skipped (empty): guild ${params.entry.guildId} channel ${params.entry.channelId}`,
    );
    return undefined;
  }

  const ttsResult = await textToSpeech({
    text: speakText,
    cfg: ttsCfg,
    channel: "discord",
    overrides: directive.overrides,
  });
  if (!ttsResult.success || !ttsResult.audioPath) {
    params.logger.warn(`discord voice: TTS failed: ${ttsResult.error ?? "unknown error"}`);
    return undefined;
  }
  params.logVerbose(
    `tts ok (${speakText.length} chars): guild ${params.entry.guildId} channel ${params.entry.channelId}`,
  );
  return ttsResult.audioPath;
}

export async function generateDiscordLegacyReply(params: {
  cfg: OpenClawConfig;
  runtime: RuntimeEnv;
  entry: { route: { agentId: string; sessionKey: string }; guildId: string; channelId: string };
  wavPath: string;
  senderLabel: string;
  senderIsOwner: boolean;
  logVerbose: (message: string) => void;
}): Promise<{ text: string; audioPath?: string; superseded?: boolean }> {
  const transcript = await transcribeDiscordVoiceAudio({
    cfg: params.cfg,
    agentId: params.entry.route.agentId,
    filePath: params.wavPath,
  });
  if (!transcript) {
    params.logVerbose(
      `transcription empty: guild ${params.entry.guildId} channel ${params.entry.channelId}`,
    );
    return { text: "" };
  }
  params.logVerbose(
    `transcription ok (${transcript.length} chars): guild ${params.entry.guildId} channel ${params.entry.channelId}`,
  );

  const prompt = formatVoicePromptText(transcript, params.senderLabel);
  const result = await agentCommandFromIngress(
    {
      message: prompt,
      sessionKey: params.entry.route.sessionKey,
      agentId: params.entry.route.agentId,
      messageChannel: "discord",
      senderIsOwner: params.senderIsOwner,
      allowModelOverride: false,
      deliver: false,
    },
    params.runtime,
  );

  return {
    text: (result.payloads ?? [])
      .map((payload) => payload.text)
      .filter((text) => typeof text === "string" && text.trim())
      .join("\n")
      .trim(),
  };
}
