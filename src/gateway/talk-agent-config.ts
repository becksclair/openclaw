import {
  resolveAgentTtsOverride,
  resolveConfigWithAgentTts,
  mergeProviderConfig,
} from "../agents/tts-config.js";
import type { OpenClawConfig } from "../config/config.js";
import type { TalkProviderConfig } from "../config/types.gateway.js";
import type { TtsConfig } from "../config/types.tts.js";
import { isPlainObject } from "../infra/plain-object.js";
import { getSpeechProvider } from "../tts/provider-registry.js";

const DEFAULT_TALK_TIMEOUT_MS = 30_000;

function mapTtsProviderToTalkProvider(
  ttsProviderConfig: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!ttsProviderConfig || Object.keys(ttsProviderConfig).length === 0) {
    return undefined;
  }
  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ttsProviderConfig)) {
    if (key === "voice" && typeof value === "string") {
      mapped.voiceId = value;
    } else if (key === "model" && typeof value === "string") {
      mapped.modelId = value;
    } else {
      mapped[key] = value;
    }
  }
  return mapped;
}

function mergeMappedTtsProviderIntoTalkProviders(params: {
  talkProviders: Record<string, TalkProviderConfig>;
  providerId: string;
  ttsProviderConfig: Record<string, unknown> | undefined;
}): boolean {
  const mappedConfig = mapTtsProviderToTalkProvider(params.ttsProviderConfig);
  if (!mappedConfig) {
    return false;
  }
  const baseTalkProvider = isPlainObject(params.talkProviders[params.providerId])
    ? (params.talkProviders[params.providerId] as Record<string, unknown>)
    : {};
  const hasVoiceOverride =
    isPlainObject(params.ttsProviderConfig) &&
    "voice" in params.ttsProviderConfig &&
    typeof params.ttsProviderConfig.voice === "string";
  const hasModelOverride =
    isPlainObject(params.ttsProviderConfig) &&
    "model" in params.ttsProviderConfig &&
    typeof params.ttsProviderConfig.model === "string";
  const baseWithoutConflictingAliases =
    hasVoiceOverride || hasModelOverride
      ? Object.fromEntries(
          Object.entries(baseTalkProvider).filter(([key]) => {
            if (hasVoiceOverride && key === "voice") {
              return false;
            }
            if (hasModelOverride && key === "model") {
              return false;
            }
            return true;
          }),
        )
      : baseTalkProvider;

  params.talkProviders[params.providerId] = mergeProviderConfig(
    baseWithoutConflictingAliases,
    mappedConfig,
  ) as TalkProviderConfig;
  return true;
}

function hasExplicitTalkProviderConfig(
  providers: Record<string, TalkProviderConfig>,
  providerId: string | undefined,
): providerId is string {
  if (!providerId) {
    return false;
  }
  return isPlainObject(providers[providerId]);
}

function materializeTalkProviderFromMergedTts(params: {
  cfg: OpenClawConfig;
  talkProviders: Record<string, TalkProviderConfig>;
  providerId: string | undefined;
  mergedTts: TtsConfig;
}): boolean {
  if (!params.providerId) {
    return false;
  }
  const speechProvider = getSpeechProvider(params.providerId, params.cfg);
  if (!speechProvider) {
    return false;
  }
  const resolvedProviderConfig =
    speechProvider.resolveTalkConfig?.({
      cfg: params.cfg,
      baseTtsConfig: params.mergedTts as Record<string, unknown>,
      talkProviderConfig: params.talkProviders[params.providerId] ?? {},
      timeoutMs: params.mergedTts.timeoutMs ?? DEFAULT_TALK_TIMEOUT_MS,
    }) ?? params.talkProviders[params.providerId];
  if (isPlainObject(resolvedProviderConfig) && Object.keys(resolvedProviderConfig).length > 0) {
    params.talkProviders[params.providerId] = resolvedProviderConfig as TalkProviderConfig;
  }
  return true;
}

export function resolveConfigWithAgentTalk(cfg: OpenClawConfig, agentId?: string): OpenClawConfig {
  const override = resolveAgentTtsOverride(cfg, agentId);
  const ttsScopedConfig = resolveConfigWithAgentTts(cfg, agentId);
  if (!override || Object.keys(override).length === 0) {
    return ttsScopedConfig;
  }

  const mergedTts = ttsScopedConfig.messages?.tts ?? {};
  const mergedTalkProvider =
    typeof mergedTts.provider === "string" && mergedTts.provider.trim().length > 0
      ? mergedTts.provider.trim()
      : undefined;
  const talkProviders: Record<string, TalkProviderConfig> = { ...cfg.talk?.providers };

  for (const [providerId, providerConfig] of Object.entries(override.providers ?? {})) {
    mergeMappedTtsProviderIntoTalkProviders({
      talkProviders,
      providerId,
      ttsProviderConfig: providerConfig,
    });
  }

  let canUseMergedTalkProvider = hasExplicitTalkProviderConfig(talkProviders, mergedTalkProvider);
  if (!canUseMergedTalkProvider) {
    canUseMergedTalkProvider = mergeMappedTtsProviderIntoTalkProviders({
      talkProviders,
      providerId: mergedTalkProvider ?? "",
      ttsProviderConfig: mergedTalkProvider ? mergedTts.providers?.[mergedTalkProvider] : undefined,
    });
    if (!canUseMergedTalkProvider) {
      canUseMergedTalkProvider = materializeTalkProviderFromMergedTts({
        cfg,
        talkProviders,
        providerId: mergedTalkProvider,
        mergedTts,
      });
    }
  }

  const resolvedTalkProvider = canUseMergedTalkProvider ? mergedTalkProvider : cfg.talk?.provider;
  const omitUnselectedTalkProviders =
    canUseMergedTalkProvider &&
    mergedTalkProvider != null &&
    !hasExplicitTalkProviderConfig(talkProviders, mergedTalkProvider);
  const { providers: _ignoredTalkProviders, ...baseTalk } = cfg.talk ?? {};
  const nextTalk = {
    ...baseTalk,
    ...(resolvedTalkProvider ? { provider: resolvedTalkProvider } : {}),
    ...(!omitUnselectedTalkProviders && Object.keys(talkProviders).length > 0
      ? { providers: talkProviders }
      : {}),
  };

  return Object.keys(nextTalk).length > 0
    ? {
        ...ttsScopedConfig,
        talk: nextTalk,
      }
    : ttsScopedConfig;
}
