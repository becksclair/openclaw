import type { OpenClawConfig } from "../config/config.js";
import {
  withBundledPluginAllowlistCompat,
  withBundledPluginEnablementCompat,
  withBundledPluginVitestCompat,
} from "./bundled-compat.js";
import { resolveRuntimePluginRegistry } from "./loader.js";
import { loadPluginManifestRegistry } from "./manifest-registry.js";
import { normalizeCapabilityProviderId } from "./provider-registry-shared.js";
import type { PluginRegistry } from "./registry.js";

type CapabilityProviderRegistryKey =
  | "memoryEmbeddingProviders"
  | "speechProviders"
  | "realtimeTranscriptionProviders"
  | "realtimeVoiceProviders"
  | "mediaUnderstandingProviders"
  | "imageGenerationProviders"
  | "videoGenerationProviders"
  | "musicGenerationProviders";

type CapabilityContractKey =
  | "memoryEmbeddingProviders"
  | "speechProviders"
  | "realtimeTranscriptionProviders"
  | "realtimeVoiceProviders"
  | "mediaUnderstandingProviders"
  | "imageGenerationProviders"
  | "videoGenerationProviders"
  | "musicGenerationProviders";

type CapabilityProviderForKey<K extends CapabilityProviderRegistryKey> =
  PluginRegistry[K][number] extends { provider: infer T } ? T : never;

const CAPABILITY_CONTRACT_KEY: Record<CapabilityProviderRegistryKey, CapabilityContractKey> = {
  memoryEmbeddingProviders: "memoryEmbeddingProviders",
  speechProviders: "speechProviders",
  realtimeTranscriptionProviders: "realtimeTranscriptionProviders",
  realtimeVoiceProviders: "realtimeVoiceProviders",
  mediaUnderstandingProviders: "mediaUnderstandingProviders",
  imageGenerationProviders: "imageGenerationProviders",
  videoGenerationProviders: "videoGenerationProviders",
  musicGenerationProviders: "musicGenerationProviders",
};

function resolveBundledCapabilityCompatPluginIds(params: {
  key: CapabilityProviderRegistryKey;
  cfg?: OpenClawConfig;
}): string[] {
  const contractKey = CAPABILITY_CONTRACT_KEY[params.key];
  return loadPluginManifestRegistry({
    config: params.cfg,
    env: process.env,
  })
    .plugins.filter(
      (plugin) => plugin.origin === "bundled" && (plugin.contracts?.[contractKey]?.length ?? 0) > 0,
    )
    .map((plugin) => plugin.id)
    .toSorted((left, right) => left.localeCompare(right));
}

function resolveCapabilityProviderConfig(params: {
  key: CapabilityProviderRegistryKey;
  cfg?: OpenClawConfig;
}) {
  const pluginIds = resolveBundledCapabilityCompatPluginIds(params);
  const allowlistCompat = withBundledPluginAllowlistCompat({
    config: params.cfg,
    pluginIds,
  });
  const enablementCompat = withBundledPluginEnablementCompat({
    config: allowlistCompat,
    pluginIds,
  });
  return withBundledPluginVitestCompat({
    config: enablementCompat,
    pluginIds,
    env: process.env,
  });
}

function mergeCapabilityProviders<T>(
  activeProviders: readonly T[],
  loadedProviders: readonly T[],
  getId: (provider: T) => string | undefined,
): T[] {
  if (activeProviders.length === 0) {
    return [...loadedProviders];
  }
  if (loadedProviders.length === 0) {
    return [...activeProviders];
  }
  const merged = [...activeProviders];
  const seen = new Set(
    activeProviders.map(getId).filter((providerId): providerId is string => Boolean(providerId)),
  );
  for (const provider of loadedProviders) {
    const normalized = getId(provider);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    merged.push(provider);
  }
  return merged;
}

export function resolvePluginCapabilityProviders<K extends CapabilityProviderRegistryKey>(params: {
  key: K;
  cfg?: OpenClawConfig;
}): CapabilityProviderForKey<K>[] {
  const activeRegistry = resolveRuntimePluginRegistry();
  const activeProviders = (activeRegistry?.[params.key] ?? []).map(
    (entry) => entry.provider,
  ) as CapabilityProviderForKey<K>[];
  if (params.cfg === undefined && activeProviders.length > 0) {
    return activeProviders;
  }
  const compatConfig = resolveCapabilityProviderConfig({ key: params.key, cfg: params.cfg });
  const loadOptions =
    compatConfig === undefined
      ? undefined
      : {
          config: compatConfig,
          activate: false,
          cache: false,
        };
  const loadedProviders = (resolveRuntimePluginRegistry(loadOptions)?.[params.key] ?? []).map(
    (entry) => entry.provider,
  ) as CapabilityProviderForKey<K>[];
  return mergeCapabilityProviders(activeProviders, loadedProviders, (provider) =>
    normalizeCapabilityProviderId((provider as { id?: string }).id),
  );
}
