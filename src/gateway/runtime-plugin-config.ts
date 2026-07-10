import { applyPluginAutoEnable } from "../config/plugin-auto-enable.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { getCurrentPluginMetadataSnapshot } from "../plugins/current-plugin-metadata-snapshot.js";
import { registerPluginMetadataProcessMemoLifecycleClear } from "../plugins/plugin-metadata-lifecycle.js";
import type { PluginMetadataSnapshot } from "../plugins/plugin-metadata-snapshot.types.js";

type CachedGatewayPluginConfig = {
  config: OpenClawConfig;
  env: NodeJS.ProcessEnv;
  snapshot: PluginMetadataSnapshot;
};

let gatewayPluginConfigCache = new WeakMap<OpenClawConfig, CachedGatewayPluginConfig>();

registerPluginMetadataProcessMemoLifecycleClear(() => {
  gatewayPluginConfigCache = new WeakMap();
});

export function resolveGatewayPluginConfig(params: {
  config: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
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
  if (cached?.snapshot === currentSnapshot && cached.env === env) {
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
    env,
    snapshot: currentSnapshot,
  });
  return config;
}
