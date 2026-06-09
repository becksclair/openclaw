import { performance } from "node:perf_hooks";
import { applyPluginAutoEnable } from "../config/plugin-auto-enable.js";
import { resolvePluginAutoEnableExternalCatalogFingerprint } from "../config/plugin-auto-enable.prefer-over.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { getCurrentPluginMetadataSnapshot } from "../plugins/current-plugin-metadata-snapshot.js";
import type { PluginMetadataSnapshot } from "../plugins/plugin-metadata-snapshot.types.js";

type CachedGatewayPluginConfig = {
  config: OpenClawConfig;
  envEntriesFingerprint: string;
  envFingerprint: string;
  externalCatalogCheckedAtMs: number;
  externalCatalogFingerprint: string;
  snapshot: PluginMetadataSnapshot;
};

const gatewayPluginConfigCache = new WeakMap<OpenClawConfig, CachedGatewayPluginConfig>();
const EXTERNAL_CATALOG_FINGERPRINT_REFRESH_MS = 1_000;

function fingerprintGatewayRuntimeConfigEnvEntries(env: NodeJS.ProcessEnv): string {
  return JSON.stringify(
    Object.entries(env)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .toSorted(([left], [right]) => left.localeCompare(right)),
  );
}

function resolveGatewayRuntimeConfigEnvFingerprint(params: {
  cache?: CachedGatewayPluginConfig;
  env: NodeJS.ProcessEnv;
  nowMs: number;
}): Pick<
  CachedGatewayPluginConfig,
  | "envEntriesFingerprint"
  | "envFingerprint"
  | "externalCatalogCheckedAtMs"
  | "externalCatalogFingerprint"
> {
  const envEntriesFingerprint = fingerprintGatewayRuntimeConfigEnvEntries(params.env);
  const cache = params.cache;
  const canReuseExternalCatalogFingerprint =
    cache?.envEntriesFingerprint === envEntriesFingerprint &&
    params.nowMs - cache.externalCatalogCheckedAtMs < EXTERNAL_CATALOG_FINGERPRINT_REFRESH_MS;
  const externalCatalogFingerprint = canReuseExternalCatalogFingerprint
    ? cache.externalCatalogFingerprint
    : resolvePluginAutoEnableExternalCatalogFingerprint(params.env);
  const externalCatalogCheckedAtMs = canReuseExternalCatalogFingerprint
    ? cache.externalCatalogCheckedAtMs
    : params.nowMs;
  return {
    envEntriesFingerprint,
    envFingerprint: JSON.stringify({
      env: envEntriesFingerprint,
      externalCatalogs: externalCatalogFingerprint,
    }),
    externalCatalogCheckedAtMs,
    externalCatalogFingerprint,
  };
}

export function resolveGatewayPluginConfig(params: {
  config: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
  nowMs?: number;
}): OpenClawConfig {
  const env = params.env ?? process.env;
  const currentSnapshot = getCurrentPluginMetadataSnapshot({
    config: params.config,
    env,
    allowWorkspaceScopedSnapshot: true,
  });
  if (!currentSnapshot) {
    return applyPluginAutoEnable({
      config: params.config,
      env,
    }).config;
  }

  const cached = gatewayPluginConfigCache.get(params.config);
  const envFingerprint = resolveGatewayRuntimeConfigEnvFingerprint({
    cache: cached,
    env,
    nowMs: params.nowMs ?? performance.now(),
  });
  if (
    cached?.snapshot === currentSnapshot &&
    cached.envFingerprint === envFingerprint.envFingerprint
  ) {
    return cached.config;
  }

  const config = applyPluginAutoEnable({
    config: params.config,
    env,
    manifestRegistry: currentSnapshot.manifestRegistry,
    discovery: currentSnapshot.discovery,
  }).config;
  gatewayPluginConfigCache.set(params.config, {
    config,
    ...envFingerprint,
    snapshot: currentSnapshot,
  });
  return config;
}
