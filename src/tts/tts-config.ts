import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { resolveAgentConfig } from "../agents/agent-scope.js";
import type { OpenClawConfig } from "../config/types.js";
import type { TtsAutoMode, TtsConfig, TtsMode, TtsProviderConfigMap } from "../config/types.tts.js";
import { isPlainObject } from "../infra/plain-object.js";
import { resolveConfigDir, resolveUserPath } from "../utils.js";
import { normalizeTtsAutoMode } from "./tts-auto-mode.js";
export { normalizeTtsAutoMode } from "./tts-auto-mode.js";

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

export function mergeProviderConfig(
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
  const agentConfig = resolveAgentConfig(cfg, agentId);
  return agentConfig?.tts;
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

export function resolveConfiguredTtsMode(cfg: OpenClawConfig): TtsMode {
  return cfg.messages?.tts?.mode ?? "final";
}

function resolveTtsPrefsPathValue(prefsPath: string | undefined): string {
  if (prefsPath?.trim()) {
    return resolveUserPath(prefsPath.trim());
  }
  const envPath = process.env.OPENCLAW_TTS_PREFS?.trim();
  if (envPath) {
    return resolveUserPath(envPath);
  }
  return path.join(resolveConfigDir(process.env), "settings", "tts.json");
}

function readTtsPrefsAutoMode(prefsPath: string): TtsAutoMode | undefined {
  try {
    if (!existsSync(prefsPath)) {
      return undefined;
    }
    const prefs = JSON.parse(readFileSync(prefsPath, "utf8")) as {
      tts?: { auto?: unknown; enabled?: unknown };
    };
    const auto = normalizeTtsAutoMode(prefs.tts?.auto);
    if (auto) {
      return auto;
    }
    if (typeof prefs.tts?.enabled === "boolean") {
      return prefs.tts.enabled ? "always" : "off";
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function shouldAttemptTtsPayload(params: {
  cfg: OpenClawConfig;
  ttsAuto?: string;
}): boolean {
  const sessionAuto = normalizeTtsAutoMode(params.ttsAuto);
  if (sessionAuto) {
    return sessionAuto !== "off";
  }

  const raw = params.cfg.messages?.tts;
  const prefsAuto = readTtsPrefsAutoMode(resolveTtsPrefsPathValue(raw?.prefsPath));
  if (prefsAuto) {
    return prefsAuto !== "off";
  }

  const configuredAuto = normalizeTtsAutoMode(raw?.auto);
  if (configuredAuto) {
    return configuredAuto !== "off";
  }
  return raw?.enabled === true;
}
