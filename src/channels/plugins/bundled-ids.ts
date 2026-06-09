import { listChannelCatalogEntries } from "../../plugins/channel-catalog-registry.js";
import type { PluginDiscoveryResult } from "../../plugins/discovery.js";
import { registerPluginMetadataProcessMemoLifecycleClear } from "../../plugins/plugin-metadata-lifecycle.js";
import { resolveBundledChannelRootScope } from "./bundled-root.js";

const bundledChannelPluginIdsByRoot = new Map<string, readonly string[]>();
const bundledChannelIdsByRoot = new Map<string, readonly string[]>();

function resolveBundledChannelCacheKey(rootCacheKey: string, env: NodeJS.ProcessEnv): string {
  return JSON.stringify({
    root: rootCacheKey,
    sourceOverlaysDisabled: env.OPENCLAW_DISABLE_BUNDLED_SOURCE_OVERLAYS ?? "",
  });
}

export function clearBundledChannelIdCaches(): void {
  bundledChannelPluginIdsByRoot.clear();
  bundledChannelIdsByRoot.clear();
}

registerPluginMetadataProcessMemoLifecycleClear(clearBundledChannelIdCaches);

export function listBundledChannelPluginIdsForRoot(
  rootCacheKey: string,
  env: NodeJS.ProcessEnv = process.env,
  discovery?: PluginDiscoveryResult,
): string[] {
  const cacheKey = resolveBundledChannelCacheKey(rootCacheKey, env);
  if (!discovery) {
    const cached = bundledChannelPluginIdsByRoot.get(cacheKey);
    if (cached) {
      return [...cached];
    }
  }
  const ids = listChannelCatalogEntries({
    origin: "bundled",
    env,
    discovery,
  })
    .map((entry) => entry.pluginId)
    .toSorted((left, right) => left.localeCompare(right));
  if (!discovery) {
    bundledChannelPluginIdsByRoot.set(cacheKey, ids);
  }
  return ids;
}

export function listBundledChannelIdsForRoot(
  rootCacheKey: string,
  env: NodeJS.ProcessEnv = process.env,
  discovery?: PluginDiscoveryResult,
): string[] {
  const cacheKey = resolveBundledChannelCacheKey(rootCacheKey, env);
  if (!discovery) {
    const cached = bundledChannelIdsByRoot.get(cacheKey);
    if (cached) {
      return [...cached];
    }
  }
  const ids = listChannelCatalogEntries({
    origin: "bundled",
    env,
    discovery,
  })
    .map((entry) => entry.channel.id)
    .filter((channelId): channelId is string => Boolean(channelId))
    .toSorted((left, right) => left.localeCompare(right));
  if (!discovery) {
    bundledChannelIdsByRoot.set(cacheKey, ids);
  }
  return ids;
}

export function listBundledChannelPluginIds(
  env: NodeJS.ProcessEnv = process.env,
  discovery?: PluginDiscoveryResult,
): string[] {
  return listBundledChannelPluginIdsForRoot(
    resolveBundledChannelRootScope(env).cacheKey,
    env,
    discovery,
  );
}

export function listBundledChannelIds(
  env: NodeJS.ProcessEnv = process.env,
  discovery?: PluginDiscoveryResult,
): string[] {
  return listBundledChannelIdsForRoot(resolveBundledChannelRootScope(env).cacheKey, env, discovery);
}
