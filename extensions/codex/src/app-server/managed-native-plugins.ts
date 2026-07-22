import os from "node:os";
import path from "node:path";
import type { CodexAppServerClient } from "./client.js";
import { isJsonObject } from "./protocol.js";

const MANAGED_PLUGIN_NAMES = ["computer-use", "browser-use"] as const;
const MANAGED_PLUGIN_IDS = new Set(MANAGED_PLUGIN_NAMES.map((name) => `${name}@openai-bundled`));
const MARKETPLACE_MANIFEST_RELATIVE_PATH = path.join(
  "sky-cua",
  "codex",
  "openai-bundled",
  ".agents",
  "plugins",
  "marketplace.json",
);

type ManagedNativePluginInstallState = {
  installByClient: WeakMap<CodexAppServerClient, Promise<void>>;
};

const MANAGED_NATIVE_PLUGIN_INSTALL_STATE = Symbol.for(
  "openclaw.codexManagedNativePluginInstallState",
);

function getManagedNativePluginInstallState(): ManagedNativePluginInstallState {
  const globalState = globalThis as typeof globalThis & {
    [MANAGED_NATIVE_PLUGIN_INSTALL_STATE]?: ManagedNativePluginInstallState;
  };
  globalState[MANAGED_NATIVE_PLUGIN_INSTALL_STATE] ??= {
    installByClient: new WeakMap(),
  };
  return globalState[MANAGED_NATIVE_PLUGIN_INSTALL_STATE];
}

/** Installs the fixed sky-cua marketplace plugins before the client's first thread. */
export async function ensureManagedNativePlugins(params: {
  client: CodexAppServerClient;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<void> {
  const { installByClient } = getManagedNativePluginInstallState();
  const current = installByClient.get(params.client);
  if (current) {
    await current;
    return;
  }

  // One app-server client can race several first-thread starts. Codex mutates
  // one plugin cache/config, so share the install sequence for that client.
  const install = installManagedNativePlugins(params);
  installByClient.set(params.client, install);
  try {
    await install;
  } catch (error) {
    if (installByClient.get(params.client) === install) {
      installByClient.delete(params.client);
    }
    throw error;
  }
}

/** Disables the managed plugin MCPs for Codex threads that prohibit MCP use. */
export function buildManagedNativeMcpDisableConfig(): Record<string, unknown> {
  return {
    plugins: {
      "computer-use@openai-bundled": {
        mcp_servers: { "computer-use": { enabled: false } },
      },
      "browser-use@openai-bundled": {
        mcp_servers: { node_repl: { enabled: false } },
      },
    },
  };
}

async function installManagedNativePlugins(params: {
  client: CodexAppServerClient;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<void> {
  const marketplacePath = resolveSkyCuaMarketplaceManifestPath();
  for (const pluginName of MANAGED_PLUGIN_NAMES) {
    await params.client.request(
      "plugin/install",
      { marketplacePath, pluginName },
      { timeoutMs: params.timeoutMs, signal: params.signal },
    );
  }

  const configRead = await params.client.request(
    "config/read",
    { includeLayers: false },
    { timeoutMs: params.timeoutMs, signal: params.signal },
  );
  const config =
    isJsonObject(configRead) && isJsonObject(configRead.config) ? configRead.config : {};
  const plugins = isJsonObject(config.plugins) ? config.plugins : undefined;
  const canonicalOwnersEnabled = [...MANAGED_PLUGIN_IDS].every((pluginId) => {
    const plugin = plugins?.[pluginId];
    return isJsonObject(plugin) && plugin.enabled === true;
  });
  if (!plugins || !canonicalOwnersEnabled) {
    throw new Error(
      "Codex did not report the fixed Computer/Browser Use plugins as enabled after installation.",
    );
  }
  const conflicts = Object.entries(plugins)
    .filter(([pluginId, plugin]) => {
      const pluginName = pluginId.split("@", 1)[0];
      return (
        isJsonObject(plugin) &&
        plugin.enabled === true &&
        MANAGED_PLUGIN_NAMES.includes(pluginName as (typeof MANAGED_PLUGIN_NAMES)[number]) &&
        !MANAGED_PLUGIN_IDS.has(pluginId)
      );
    })
    .map(([pluginId]) => pluginId)
    .toSorted();
  if (conflicts.length > 0) {
    throw new Error(
      `Conflicting native Codex plugins are enabled: ${conflicts.join(", ")}. Disable them so computer-use@openai-bundled and browser-use@openai-bundled remain the sole managed owners.`,
    );
  }
}

function resolveSkyCuaMarketplaceManifestPath(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
): string {
  const configuredDataHome = env.XDG_DATA_HOME?.trim();
  const dataHome =
    configuredDataHome && path.isAbsolute(configuredDataHome)
      ? configuredDataHome
      : path.join(homeDir, ".local", "share");
  return path.join(dataHome, MARKETPLACE_MANIFEST_RELATIVE_PATH);
}

export const managedNativePluginsTesting = {
  reset: () => {
    const globalState = globalThis as typeof globalThis & {
      [MANAGED_NATIVE_PLUGIN_INSTALL_STATE]?: ManagedNativePluginInstallState;
    };
    delete globalState[MANAGED_NATIVE_PLUGIN_INSTALL_STATE];
  },
  resolveSkyCuaMarketplaceManifestPath,
};
