import os from "node:os";
import path from "node:path";
import type { CodexAppServerClient } from "./client.js";
import { isJsonObject } from "./protocol.js";

const MANAGED_PLUGIN_NAMES = ["computer-use", "browser"] as const;
const MANAGED_PLUGIN_IDS = new Set(MANAGED_PLUGIN_NAMES.map((name) => `${name}@openai-bundled`));
const CONFLICTING_PLUGIN_NAMES = new Set([...MANAGED_PLUGIN_NAMES, "browser-use"]);
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
  validationByClient: WeakMap<CodexAppServerClient, Map<string, Promise<void>>>;
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
    validationByClient: new WeakMap(),
  };
  return globalState[MANAGED_NATIVE_PLUGIN_INSTALL_STATE];
}

/** Installs the fixed sky-cua marketplace plugins before the client's first thread. */
export async function ensureManagedNativePlugins(params: {
  client: CodexAppServerClient;
  cwd: string;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<void> {
  const { validationByClient } = getManagedNativePluginInstallState();
  const validationsByCwd =
    validationByClient.get(params.client) ?? new Map<string, Promise<void>>();
  validationByClient.set(params.client, validationsByCwd);
  const current = validationsByCwd.get(params.cwd);
  if (current) {
    await current;
    return;
  }

  // Project layers can differ by cwd, so each project gets its own ownership
  // check even though the underlying cache install is shared by the client.
  const reconciliation = reconcileManagedNativePlugins(params);
  validationsByCwd.set(params.cwd, reconciliation);
  try {
    await reconciliation;
  } catch (error) {
    if (validationsByCwd.get(params.cwd) === reconciliation) {
      validationsByCwd.delete(params.cwd);
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
      "browser@openai-bundled": {
        mcp_servers: { node_repl: { enabled: false } },
      },
    },
  };
}

async function ensureManagedNativePluginsInstalled(params: {
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

  // Codex mutates one plugin cache per app-server client. Serialize the two
  // installs across concurrent project starts to avoid overlapping writes.
  const marketplacePath = resolveSkyCuaMarketplaceManifestPath();
  const install = (async () => {
    for (const pluginName of MANAGED_PLUGIN_NAMES) {
      await params.client.request(
        "plugin/install",
        { marketplacePath, pluginName },
        { timeoutMs: params.timeoutMs, signal: params.signal },
      );
    }
  })();
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

async function reconcileManagedNativePlugins(params: {
  client: CodexAppServerClient;
  cwd: string;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<void> {
  await ensureManagedNativePluginsInstalled(params);

  const configRead = await params.client.request(
    "config/read",
    { cwd: params.cwd, includeLayers: false },
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
        CONFLICTING_PLUGIN_NAMES.has(pluginName) &&
        !MANAGED_PLUGIN_IDS.has(pluginId)
      );
    })
    .map(([pluginId]) => pluginId)
    .toSorted();
  if (conflicts.length > 0) {
    throw new Error(
      `Conflicting native Codex plugins are enabled: ${conflicts.join(", ")}. Disable them so computer-use@openai-bundled and browser@openai-bundled remain the sole managed owners.`,
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
