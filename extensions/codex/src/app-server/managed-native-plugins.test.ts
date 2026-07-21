import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexAppServerClient } from "./client.js";
import {
  ensureManagedNativePlugins,
  managedNativePluginsTesting,
} from "./managed-native-plugins.js";

const sha = (character: string) => character.repeat(64);
const tempRoots = new Set<string>();

function activeRelease(overrides?: {
  releaseId?: string;
  manifestSha?: string;
  computerSha?: string;
  browserSha?: string;
}) {
  const root = "/releases/active";
  return {
    status: "ok",
    runtime: {
      schema_version: 1,
      release_id: overrides?.releaseId ?? "release-1",
      manifest_sha256: sha("a"),
      release_root: root,
      manifest_path: `${root}/RELEASE.json`,
      node_path: `${root}/bin/node`,
      node_repl_path: `${root}/bin/node_repl`,
      node_module_dirs: [`${root}/lib/node_modules`],
      browser_client_path: `${root}/browser.js`,
      trusted_browser_client_sha256s: [sha("b")],
      codex_marketplace: {
        name: "openai-bundled",
        path: `${root}/components/codex-compat/openai-bundled`,
        manifest_path: `${root}/components/codex-compat/openai-bundled/.agents/plugins/marketplace.json`,
        manifest_sha256: overrides?.manifestSha ?? sha("c"),
        plugins: [
          {
            id: "computer-use@openai-bundled",
            name: "computer-use",
            version: "0.1.0-sky-cua",
            path: `${root}/components/codex-compat/openai-bundled/plugins/computer-use`,
            tree_sha256: overrides?.computerSha ?? sha("d"),
            mcp_servers: ["computer-use"],
          },
          {
            id: "browser-use@openai-bundled",
            name: "browser-use",
            version: "1.0.0-sky-cua-openclaw",
            path: `${root}/components/codex-compat/openai-bundled/plugins/browser-use`,
            tree_sha256: overrides?.browserSha ?? sha("e"),
            mcp_servers: ["node_repl"],
          },
        ],
      },
    },
  };
}

function createClient(overrides?: {
  effectiveMcpServers?: Record<string, unknown>;
  readMutation?: (pluginName: string, response: Record<string, unknown>) => void;
  codexHome?: string;
  managedInventoryPath?: string;
  collisionPlugin?: {
    id: string;
    name: string;
    marketplaceName: string;
    marketplacePath: string | null;
    mcpServers: string[];
    version?: string;
    localVersion?: string;
    source?: unknown;
  };
}) {
  const request = vi.fn(async (method: string, params?: unknown) => {
    if (method === "config/read") {
      return { config: { mcp_servers: overrides?.effectiveMcpServers ?? {} } };
    }
    if (method === "plugin/install") {
      return { authPolicy: "ON_INSTALL", appsNeedingAuth: [] };
    }
    if (method === "plugin/read") {
      const pluginName = (params as { pluginName: string }).pluginName;
      if (pluginName === overrides?.collisionPlugin?.name) {
        return {
          plugin: {
            marketplaceName: overrides.collisionPlugin.marketplaceName,
            marketplacePath: overrides.collisionPlugin.marketplacePath,
            summary: {
              id: overrides.collisionPlugin.id,
              name: overrides.collisionPlugin.name,
              version: overrides.collisionPlugin.version,
              localVersion: overrides.collisionPlugin.localVersion,
              source: overrides.collisionPlugin.source,
              installed: true,
              enabled: true,
            },
            mcpServers: overrides.collisionPlugin.mcpServers,
          },
        };
      }
      const computerUse = pluginName === "computer-use";
      const response: Record<string, unknown> = {
        marketplaceName: "openai-bundled",
        marketplacePath:
          "/releases/active/components/codex-compat/openai-bundled/.agents/plugins/marketplace.json",
        summary: {
          id: `${pluginName}@openai-bundled`,
          version: null,
          localVersion: computerUse ? "0.1.0-sky-cua" : "1.0.0-sky-cua-openclaw",
          name: pluginName,
          installed: true,
          enabled: true,
        },
        mcpServers: [computerUse ? "computer-use" : "node_repl"],
      };
      overrides?.readMutation?.(pluginName, response);
      return { plugin: response };
    }
    if (method === "plugin/installed") {
      const managedPath =
        overrides?.managedInventoryPath ??
        "/releases/active/components/codex-compat/openai-bundled/.agents/plugins/marketplace.json";
      const marketplaces: Array<{
        name: string;
        path: string | null;
        plugins: Array<{
          id: string;
          name: string;
          version?: string;
          localVersion?: string;
          source?: unknown;
          installed?: boolean;
          enabled: boolean;
        }>;
      }> = [
        {
          name: "openai-bundled",
          path: managedPath,
          plugins: [
            { id: "computer-use@openai-bundled", name: "computer-use", enabled: true },
            { id: "browser-use@openai-bundled", name: "browser-use", enabled: true },
          ],
        },
      ];
      if (overrides?.collisionPlugin) {
        marketplaces.push({
          name: overrides.collisionPlugin.marketplaceName,
          path: overrides.collisionPlugin.marketplacePath,
          plugins: [
            {
              id: overrides.collisionPlugin.id,
              name: overrides.collisionPlugin.name,
              version: overrides.collisionPlugin.version,
              localVersion: overrides.collisionPlugin.localVersion,
              source: overrides.collisionPlugin.source,
              installed: true,
              enabled: true,
            },
          ],
        });
      }
      return { marketplaces, marketplaceLoadErrors: [] };
    }
    if (method === "mcpServerStatus/list") {
      return {
        data: [
          { name: "computer-use", serverInfo: { name: "computer-use" } },
          { name: "node_repl", serverInfo: { name: "node_repl" } },
        ],
        nextCursor: null,
      };
    }
    throw new Error(`unexpected method: ${method}`);
  });
  return {
    request,
    client: {
      request,
      getRuntimeIdentity: () => ({ codexHome: overrides?.codexHome }),
    } as unknown as CodexAppServerClient,
  };
}

async function agentDir(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-managed-native-plugins-"));
  tempRoots.add(root);
  return root;
}

async function writeRemotePlugin(params: {
  codexHome: string;
  marketplaceName: string;
  pluginName: string;
  version: string;
  mcpServers?: Record<string, unknown>;
}): Promise<void> {
  const root = path.join(
    params.codexHome,
    "plugins/cache",
    params.marketplaceName,
    params.pluginName,
    params.version,
  );
  await fs.mkdir(path.join(root, ".codex-plugin"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".codex-plugin/plugin.json"),
    JSON.stringify({
      name: params.pluginName,
      version: params.version,
      ...(params.mcpServers ? { mcpServers: "./.mcp.json" } : {}),
    }),
  );
  if (params.mcpServers) {
    await fs.writeFile(
      path.join(root, ".mcp.json"),
      JSON.stringify({ mcpServers: params.mcpServers }),
    );
  }
}

describe("managed native Codex plugins", () => {
  beforeEach(() => managedNativePluginsTesting.reset());

  afterEach(async () => {
    await Promise.all([...tempRoots].map((root) => fs.rm(root, { recursive: true, force: true })));
    tempRoots.clear();
  });

  it("installs, reads, hashes, and starts both required MCP servers before succeeding", async () => {
    const { client, request } = createClient();
    const hashes = [sha("d"), sha("e")];
    await ensureManagedNativePlugins({
      client,
      agentDir: await agentDir(),
      timeoutMs: 1_000,
      signal: new AbortController().signal,
      cwd: "/workspace",
      dependencies: {
        resolveActive: async () => activeRelease(),
        hashTree: async () => hashes.shift()!,
      },
    });

    expect(request.mock.calls.map(([method]) => method)).toEqual([
      "config/read",
      "plugin/install",
      "plugin/read",
      "plugin/install",
      "plugin/read",
      "plugin/installed",
      "mcpServerStatus/list",
    ]);
    expect(request.mock.calls[0]?.[1]).toEqual({ includeLayers: false, cwd: "/workspace" });
    expect(request.mock.calls[1]?.[1]).toEqual({
      marketplacePath:
        "/releases/active/components/codex-compat/openai-bundled/.agents/plugins/marketplace.json",
      pluginName: "computer-use",
    });
  });

  it.each([
    [
      "identity",
      {
        readMutation: (_name: string, response: Record<string, unknown>) => {
          (response.summary as Record<string, unknown>).id = "wrong@openai-bundled";
        },
      },
    ],
    [
      "MCP ownership",
      {
        readMutation: (_name: string, response: Record<string, unknown>) => {
          response.mcpServers = ["wrong"];
        },
      },
    ],
  ])("fails closed on %s mismatch", async (_label, clientOverrides) => {
    const { client } = createClient(clientOverrides);
    await expect(
      ensureManagedNativePlugins({
        client,
        agentDir: await agentDir(),
        timeoutMs: 1_000,
        signal: new AbortController().signal,
        cwd: "/workspace",
        dependencies: {
          resolveActive: async () => activeRelease(),
          hashTree: async () => sha("d"),
        },
      }),
    ).rejects.toThrow("managed Codex plugin verification failed");
  });

  it("fails closed on installed cache hash mismatch", async () => {
    const { client } = createClient();
    await expect(
      ensureManagedNativePlugins({
        client,
        agentDir: await agentDir(),
        timeoutMs: 1_000,
        signal: new AbortController().signal,
        cwd: "/workspace",
        dependencies: {
          resolveActive: async () => activeRelease(),
          hashTree: async () => sha("f"),
        },
      }),
    ).rejects.toThrow("managed Codex plugin tree mismatch");
  });

  it("single-flights concurrent reconciliation for one home and release", async () => {
    const { client, request } = createClient();
    const home = await agentDir();
    const params = {
      client,
      agentDir: home,
      timeoutMs: 1_000,
      signal: new AbortController().signal,
      cwd: "/workspace",
      dependencies: {
        resolveActive: async () => activeRelease(),
        hashTree: async (root: string) => (root.includes("computer-use") ? sha("d") : sha("e")),
      },
    };
    await Promise.all([ensureManagedNativePlugins(params), ensureManagedNativePlugins(params)]);
    expect(request.mock.calls.filter(([method]) => method === "plugin/install")).toHaveLength(2);
  });

  it("reconciles again after an active release manifest rollover", async () => {
    const { client, request } = createClient();
    const home = await agentDir();
    let release = activeRelease();
    const run = async () =>
      await ensureManagedNativePlugins({
        client,
        agentDir: home,
        timeoutMs: 1_000,
        signal: new AbortController().signal,
        cwd: "/workspace",
        dependencies: {
          resolveActive: async () => release,
          hashTree: async (root: string) => (root.includes("computer-use") ? sha("d") : sha("e")),
        },
      });
    await run();
    release = activeRelease({ releaseId: "release-2", manifestSha: sha("f") });
    await run();
    expect(request.mock.calls.filter(([method]) => method === "plugin/install")).toHaveLength(4);
  });

  it("reconciles readiness for a replacement client using its reported Codex home", async () => {
    const reportedHome = path.join(await agentDir(), "custom-codex-home");
    const first = createClient({ codexHome: reportedHome });
    const second = createClient({ codexHome: reportedHome });
    const installedRoots: string[] = [];
    const run = async (client: CodexAppServerClient) =>
      await ensureManagedNativePlugins({
        client,
        agentDir: await agentDir(),
        timeoutMs: 1_000,
        signal: new AbortController().signal,
        cwd: "/workspace",
        dependencies: {
          resolveActive: async () => activeRelease(),
          hashTree: async (root) => {
            installedRoots.push(root);
            return root.includes("computer-use") ? sha("d") : sha("e");
          },
        },
      });

    await run(first.client);
    await run(second.client);

    expect(first.request.mock.calls.filter(([method]) => method === "plugin/install")).toHaveLength(
      2,
    );
    expect(
      second.request.mock.calls.filter(([method]) => method === "plugin/install"),
    ).toHaveLength(2);
    expect(installedRoots.every((root) => root.startsWith(reportedHome))).toBe(true);
  });

  it("rejects effective standalone MCP collisions before install", async () => {
    const { client, request } = createClient({ effectiveMcpServers: { node_repl: {} } });
    await expect(
      ensureManagedNativePlugins({
        client,
        agentDir: await agentDir(),
        timeoutMs: 1_000,
        signal: new AbortController().signal,
        cwd: "/workspace",
        dependencies: {
          resolveActive: async () => activeRelease(),
          hashTree: async () => sha("d"),
        },
      }),
    ).rejects.toThrow("managed Codex plugin MCP collision");
    expect(request.mock.calls.some(([method]) => method === "plugin/install")).toBe(false);
  });

  it("rejects another enabled plugin that owns a managed MCP server", async () => {
    const { client } = createClient({
      collisionPlugin: {
        id: "rogue@personal",
        name: "rogue",
        marketplaceName: "personal",
        marketplacePath: "/marketplaces/personal/marketplace.json",
        mcpServers: ["node_repl"],
      },
    });
    await expect(
      ensureManagedNativePlugins({
        client,
        agentDir: await agentDir(),
        timeoutMs: 1_000,
        signal: new AbortController().signal,
        cwd: "/workspace",
        dependencies: {
          resolveActive: async () => activeRelease(),
          hashTree: async (root) => (root.includes("computer-use") ? sha("d") : sha("e")),
        },
      }),
    ).rejects.toThrow("rogue@personal also owns node_repl");
  });

  it("does not treat managed plugins from a persisted marketplace path as collisions", async () => {
    const { client, request } = createClient({
      managedInventoryPath: "/persisted/openai-bundled/.agents/plugins/marketplace.json",
    });
    await ensureManagedNativePlugins({
      client,
      agentDir: await agentDir(),
      timeoutMs: 1_000,
      signal: new AbortController().signal,
      cwd: "/workspace",
      dependencies: {
        resolveActive: async () => activeRelease(),
        hashTree: async (root) => (root.includes("computer-use") ? sha("d") : sha("e")),
      },
    });

    expect(request.mock.calls.filter(([method]) => method === "plugin/read")).toHaveLength(2);
  });

  it("uses an installed remote plugin artifact when the remote catalog detail is stale", async () => {
    const root = await agentDir();
    const codexHome = path.join(root, "codex-home");
    await writeRemotePlugin({
      codexHome,
      marketplaceName: "openai-curated-remote",
      pluginName: "creative-production",
      version: "0.1.25",
      mcpServers: { creative_production_mcp: { command: "node" } },
    });
    const { client, request } = createClient({
      codexHome,
      collisionPlugin: {
        id: "creative-production@openai-curated-remote",
        name: "creative-production",
        marketplaceName: "openai-curated-remote",
        marketplacePath: null,
        version: "0.1.26",
        source: { type: "remote" },
        mcpServers: [],
      },
    });

    await ensureManagedNativePlugins({
      client,
      agentDir: root,
      timeoutMs: 1_000,
      signal: new AbortController().signal,
      cwd: "/workspace",
      dependencies: {
        resolveActive: async () => activeRelease(),
        hashTree: async (pluginRoot) => (pluginRoot.includes("computer-use") ? sha("d") : sha("e")),
      },
    });

    expect(request.mock.calls.filter(([method]) => method === "plugin/read")).toHaveLength(2);
  });

  it("rejects a managed MCP owner found in an installed remote plugin artifact", async () => {
    const root = await agentDir();
    const codexHome = path.join(root, "codex-home");
    await writeRemotePlugin({
      codexHome,
      marketplaceName: "openai-curated-remote",
      pluginName: "rogue",
      version: "1.0.0",
      mcpServers: { node_repl: { command: "node" } },
    });
    const { client } = createClient({
      codexHome,
      collisionPlugin: {
        id: "rogue@openai-curated-remote",
        name: "rogue",
        marketplaceName: "openai-curated-remote",
        marketplacePath: null,
        version: "1.0.0",
        source: { type: "remote" },
        mcpServers: [],
      },
    });

    await expect(
      ensureManagedNativePlugins({
        client,
        agentDir: root,
        timeoutMs: 1_000,
        signal: new AbortController().signal,
        cwd: "/workspace",
        dependencies: {
          resolveActive: async () => activeRelease(),
          hashTree: async (pluginRoot) =>
            pluginRoot.includes("computer-use") ? sha("d") : sha("e"),
        },
      }),
    ).rejects.toThrow("rogue@openai-curated-remote also owns node_repl");
  });

  it("matches the producer tree algorithm and detects mode changes", async () => {
    const root = await agentDir();
    await fs.mkdir(path.join(root, "sub"), { mode: 0o755 });
    await fs.writeFile(path.join(root, "sub", "payload"), "hello", { mode: 0o644 });
    const before = await managedNativePluginsTesting.canonicalTreeSha256(root);
    await fs.chmod(path.join(root, "sub", "payload"), 0o600);
    const after = await managedNativePluginsTesting.canonicalTreeSha256(root);
    expect(before).toMatch(/^[0-9a-f]{64}$/);
    expect(after).not.toBe(before);
  });
});
