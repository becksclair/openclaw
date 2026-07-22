import os from "node:os";
import path from "node:path";
import type { CodexAppServerClient } from "./client.js";

const MANAGED_PLUGIN_NAMES = ["computer-use", "browser-use"] as const;
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
