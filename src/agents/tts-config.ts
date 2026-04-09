import type { OpenClawConfig } from "../config/config.js";
import type { TtsConfig, TtsProviderConfigMap } from "../config/types.tts.js";
import { isPlainObject } from "../infra/plain-object.js";
import { resolveAgentConfig } from "./agent-scope.js";

function mergeProviderConfigValue(base: unknown, override: unknown): unknown {
  if (override === undefined) {
    return base;
  }
  if (!isPlainObject(override)) {
    return override;
  }
  if (Object.keys(override).length === 0) {
    return {};
  }
  if (!isPlainObject(base)) {
    return { ...override };
  }
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = mergeProviderConfigValue(merged[key], value);
  }
  return merged;
}

function cloneProviderConfigValue(value: unknown): unknown {
  if (!isPlainObject(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [key, cloneProviderConfigValue(entryValue)]),
  );
}

function mergeProviderConfig(
  base: Record<string, unknown> | undefined,
  override: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (override && Object.keys(override).length === 0) {
    const clonedBase = cloneProviderConfigValue(base);
    return isPlainObject(clonedBase) ? clonedBase : base;
  }
  const merged = mergeProviderConfigValue(base, override);
  if (!isPlainObject(merged)) {
    return undefined;
  }
  return cloneProviderConfigValue(merged) as Record<string, unknown>;
}

export function mergeTtsConfig(base: TtsConfig, override?: TtsConfig): TtsConfig {
  if (!override || Object.keys(override).length === 0) {
    return base;
  }
  const overrideModelOverrides = override.modelOverrides;
  const mergedBase: TtsConfig = {
    ...base,
    ...("auto" in override ? { auto: override.auto } : {}),
    ...("enabled" in override ? { enabled: override.enabled } : {}),
    ...("mode" in override ? { mode: override.mode } : {}),
    ...("provider" in override ? { provider: override.provider } : {}),
    ...("summaryModel" in override ? { summaryModel: override.summaryModel } : {}),
    ...("prefsPath" in override ? { prefsPath: override.prefsPath } : {}),
    ...("maxTextLength" in override ? { maxTextLength: override.maxTextLength } : {}),
    ...("timeoutMs" in override ? { timeoutMs: override.timeoutMs } : {}),
  };
  const baseProviders: TtsProviderConfigMap = base.providers ?? {};
  const overrideProviders: TtsProviderConfigMap = override.providers ?? {};
  const mergedProviderIds = new Set([
    ...Object.keys(baseProviders),
    ...Object.keys(overrideProviders),
  ]);
  const mergedProviderEntries = [...mergedProviderIds]
    .map(
      (providerId) =>
        [
          providerId,
          mergeProviderConfig(baseProviders[providerId], overrideProviders[providerId]),
        ] as const,
    )
    .filter((entry): entry is readonly [string, Record<string, unknown>] => entry[1] != null);
  const mergedProviders =
    mergedProviderEntries.length > 0 ? Object.fromEntries(mergedProviderEntries) : undefined;
  return {
    ...mergedBase,
    ...(base.modelOverrides || overrideModelOverrides
      ? {
          modelOverrides: {
            ...base.modelOverrides,
            ...overrideModelOverrides,
          },
        }
      : {}),
    ...(mergedProviders ? { providers: mergedProviders } : {}),
  };
}

export function resolveAgentTtsOverride(
  cfg: OpenClawConfig,
  agentId?: string,
): TtsConfig | undefined {
  if (!agentId) {
    return undefined;
  }
  return resolveAgentConfig(cfg, agentId)?.tts;
}

export function resolveAgentTtsConfig(cfg: OpenClawConfig, agentId?: string): TtsConfig {
  return mergeTtsConfig(cfg.messages?.tts ?? {}, resolveAgentTtsOverride(cfg, agentId));
}

export function resolveConfigWithAgentTts(cfg: OpenClawConfig, agentId?: string): OpenClawConfig {
  const override = resolveAgentTtsOverride(cfg, agentId);
  if (!override || Object.keys(override).length === 0) {
    return cfg;
  }
  return {
    ...cfg,
    messages: {
      ...cfg.messages,
      tts: mergeTtsConfig(cfg.messages?.tts ?? {}, override),
    },
  };
}
