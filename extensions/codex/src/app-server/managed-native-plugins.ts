import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CodexAppServerClient } from "./client.js";

const MARKETPLACE_NAME = "openai-bundled";
const RESOLVER_COMMAND = "sky-cua-release";
const RESOLVER_MAX_OUTPUT_BYTES = 1024 * 1024;
const SHA256_RE = /^[0-9a-f]{64}$/;

const expectedPlugins = [
  {
    id: "computer-use@openai-bundled",
    name: "computer-use",
    version: "0.1.0-sky-cua",
    mcpServers: ["computer-use"],
  },
  {
    id: "browser-use@openai-bundled",
    name: "browser-use",
    version: "1.0.0-sky-cua-openclaw",
    mcpServers: ["node_repl"],
  },
] as const;

const pluginSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    path: z.string(),
    tree_sha256: z.string().regex(SHA256_RE),
    mcp_servers: z.array(z.string()),
  })
  .strict();

const activeRuntimeSchema = z
  .object({
    status: z.literal("ok"),
    runtime: z
      .object({
        schema_version: z.literal(1),
        release_id: z.string().min(1),
        manifest_sha256: z.string().regex(SHA256_RE),
        release_root: z.string(),
        manifest_path: z.string(),
        node_path: z.string(),
        node_repl_path: z.string(),
        node_module_dirs: z.array(z.string()),
        browser_client_path: z.string(),
        trusted_browser_client_sha256s: z.array(z.string().regex(SHA256_RE)).min(1),
        codex_marketplace: z
          .object({
            name: z.literal(MARKETPLACE_NAME),
            path: z.string(),
            manifest_path: z.string(),
            manifest_sha256: z.string().regex(SHA256_RE),
            plugins: z.array(pluginSchema).length(expectedPlugins.length),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

type ManagedPlugin = z.infer<typeof pluginSchema>;
type ActiveRuntime = z.infer<typeof activeRuntimeSchema>["runtime"];

type PluginReadResponse = {
  plugin?: {
    marketplaceName?: unknown;
    marketplacePath?: unknown;
    summary?: {
      id?: unknown;
      version?: unknown;
      localVersion?: unknown;
      name?: unknown;
      installed?: unknown;
      enabled?: unknown;
    };
    mcpServers?: unknown;
  };
};

type PluginInstalledResponse = {
  marketplaces?: Array<{
    name?: unknown;
    path?: unknown;
    plugins?: Array<{
      id?: unknown;
      name?: unknown;
      enabled?: unknown;
    }>;
  }>;
  marketplaceLoadErrors?: unknown;
};

type McpServerStatusListResponse = {
  data?: Array<{ name?: unknown; serverInfo?: unknown }>;
  nextCursor?: unknown;
};

type ConfigReadResponse = {
  config?: unknown;
};

type ReconcileDependencies = {
  resolveActive?: (signal: AbortSignal) => Promise<unknown>;
  hashTree?: (root: string) => Promise<string>;
};

type ReconcileState = {
  key: string;
  promise: Promise<void>;
};

let reconcileByClient = new WeakMap<CodexAppServerClient, Map<string, ReconcileState>>();
const reconcileTailByCodexHome = new Map<string, Promise<void>>();

export async function ensureManagedNativePlugins(params: {
  client: CodexAppServerClient;
  agentDir?: string;
  timeoutMs: number;
  signal: AbortSignal;
  cwd: string;
  bundleMcpThreadConfig?: unknown;
  dependencies?: ReconcileDependencies;
}): Promise<void> {
  assertNoStandaloneMcpCollisions(params.bundleMcpThreadConfig);
  const codexHome = resolveManagedCodexHome(params.client, params.agentDir);
  const runtime = validateActiveRuntime(
    await (params.dependencies?.resolveActive ?? resolveActiveSkyCuaRelease)(params.signal),
  );
  await assertNoClientMcpCollisions(params);
  const key = `${runtime.release_id}:${runtime.codex_marketplace.manifest_sha256}`;
  const clientStates = reconcileByClient.get(params.client) ?? new Map<string, ReconcileState>();
  reconcileByClient.set(params.client, clientStates);
  const current = clientStates.get(codexHome);
  if (current?.key === key) {
    await current.promise;
    await assertNoEnabledPluginMcpCollisions(params);
    await requireManagedMcpServers(params);
    return;
  }

  // Serialize release rollovers per Codex home so two active generations never
  // replace the same cache roots concurrently.
  const waitForCurrent =
    reconcileTailByCodexHome.get(codexHome)?.catch(() => undefined) ?? Promise.resolve();
  const promise = waitForCurrent.then(async () => {
    await reconcileManagedPlugins({
      client: params.client,
      codexHome,
      runtime,
      timeoutMs: params.timeoutMs,
      signal: params.signal,
      hashTree: params.dependencies?.hashTree ?? canonicalTreeSha256,
    });
    await assertNoEnabledPluginMcpCollisions(params);
    await requireManagedMcpServers(params);
  });
  clientStates.set(codexHome, { key, promise });
  reconcileTailByCodexHome.set(codexHome, promise);
  try {
    await promise;
  } catch (error) {
    if (clientStates.get(codexHome)?.promise === promise) {
      clientStates.delete(codexHome);
    }
    throw error;
  }
}

/** Disables the managed plugin MCPs for Codex threads that prohibit MCP use. */
export function buildManagedNativeMcpDisableConfig(): Record<string, unknown> {
  return {
    plugins: Object.fromEntries(
      expectedPlugins.map((plugin) => [
        plugin.id,
        {
          mcp_servers: Object.fromEntries(
            plugin.mcpServers.map((serverName) => [serverName, { enabled: false }]),
          ),
        },
      ]),
    ),
  };
}

function resolveManagedCodexHome(
  client: CodexAppServerClient,
  agentDir: string | undefined,
): string {
  const expected = agentDir ? path.join(path.resolve(agentDir), "codex-home") : undefined;
  const reported = client.getRuntimeIdentity?.()?.codexHome;
  const resolvedReported = reported ? path.resolve(reported) : undefined;
  // Runtime identity is authoritative for supported user/custom home scopes;
  // the agent-local path is only the default when the client cannot report it.
  const codexHome = resolvedReported ?? expected;
  if (!codexHome) {
    throw new Error("managed native plugins require an isolated Codex home");
  }
  return codexHome;
}

function validateActiveRuntime(value: unknown): ActiveRuntime {
  const parsed = activeRuntimeSchema.parse(value).runtime;
  const marketplace = parsed.codex_marketplace;
  const marketplaceRoot = requireAbsolutePath(marketplace.path, "marketplace path");
  const manifestPath = requireAbsolutePath(marketplace.manifest_path, "marketplace manifest path");
  const expectedManifestPath = path.join(marketplaceRoot, ".agents", "plugins", "marketplace.json");
  if (manifestPath !== expectedManifestPath) {
    throw new Error(`sky-cua Codex marketplace manifest path mismatch: ${manifestPath}`);
  }
  for (const [index, expected] of expectedPlugins.entries()) {
    const plugin = marketplace.plugins[index];
    if (!plugin || !matchesExpectedPlugin(plugin, expected)) {
      throw new Error(`sky-cua Codex plugin contract mismatch: ${expected.id}`);
    }
    const expectedPath = path.join(marketplaceRoot, "plugins", expected.name);
    if (requireAbsolutePath(plugin.path, `${expected.id} path`) !== expectedPath) {
      throw new Error(`sky-cua Codex plugin path mismatch: ${expected.id}`);
    }
  }
  return parsed;
}

function matchesExpectedPlugin(
  plugin: ManagedPlugin,
  expected: (typeof expectedPlugins)[number],
): boolean {
  return (
    plugin.id === expected.id &&
    plugin.name === expected.name &&
    plugin.version === expected.version &&
    equalStringArrays(plugin.mcp_servers, expected.mcpServers)
  );
}

async function reconcileManagedPlugins(params: {
  client: CodexAppServerClient;
  codexHome: string;
  runtime: ActiveRuntime;
  timeoutMs: number;
  signal: AbortSignal;
  hashTree: (root: string) => Promise<string>;
}): Promise<void> {
  const marketplace = params.runtime.codex_marketplace;
  for (const expected of expectedPlugins) {
    const contract = marketplace.plugins.find((plugin) => plugin.id === expected.id);
    if (!contract) {
      throw new Error(`sky-cua Codex plugin contract is incomplete: ${expected.id}`);
    }
    await params.client.request(
      "plugin/install",
      { marketplacePath: marketplace.manifest_path, pluginName: expected.name },
      { timeoutMs: params.timeoutMs, signal: params.signal },
    );
    const response = await params.client.request<PluginReadResponse>(
      "plugin/read",
      { marketplacePath: marketplace.manifest_path, pluginName: expected.name },
      { timeoutMs: params.timeoutMs, signal: params.signal },
    );
    assertInstalledPlugin(response, marketplace.manifest_path, expected);
    const installedRoot = path.join(
      params.codexHome,
      "plugins",
      "cache",
      MARKETPLACE_NAME,
      expected.name,
      expected.version,
    );
    const installedSha256 = await params.hashTree(installedRoot);
    if (installedSha256 !== contract.tree_sha256) {
      throw new Error(
        `managed Codex plugin tree mismatch: ${expected.id} expected ${contract.tree_sha256} got ${installedSha256}`,
      );
    }
  }
}

async function assertNoClientMcpCollisions(params: {
  client: CodexAppServerClient;
  cwd: string;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<void> {
  const configResponse = await params.client.request<ConfigReadResponse>(
    "config/read",
    { includeLayers: false, cwd: params.cwd },
    { timeoutMs: params.timeoutMs, signal: params.signal },
  );
  assertNoEffectiveMcpCollisions(configResponse.config);
}

async function assertNoEnabledPluginMcpCollisions(params: {
  client: CodexAppServerClient;
  cwd: string;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<void> {
  const response = await params.client.request<PluginInstalledResponse>(
    "plugin/installed",
    { cwds: [params.cwd] },
    { timeoutMs: params.timeoutMs, signal: params.signal },
  );
  if (
    !Array.isArray(response.marketplaces) ||
    !Array.isArray(response.marketplaceLoadErrors) ||
    response.marketplaceLoadErrors.length > 0
  ) {
    throw new Error("managed Codex installed plugin inventory is incomplete");
  }

  for (const marketplace of response.marketplaces) {
    if (
      typeof marketplace.name !== "string" ||
      (marketplace.path !== null && typeof marketplace.path !== "string") ||
      !Array.isArray(marketplace.plugins)
    ) {
      throw new Error("managed Codex installed plugin inventory is invalid");
    }
    for (const summary of marketplace.plugins) {
      if (summary.enabled !== true) {
        continue;
      }
      if (typeof summary.id !== "string" || typeof summary.name !== "string") {
        throw new Error("managed Codex installed plugin summary is invalid");
      }
      // Inventory may retain its configured marketplace path after direct read/hash
      // verifies the active source, so logical marketplace/id/name identify self here.
      const isManagedPlugin =
        marketplace.name === MARKETPLACE_NAME &&
        expectedPlugins.some((plugin) => plugin.id === summary.id && plugin.name === summary.name);
      if (isManagedPlugin) {
        continue;
      }
      const readParams =
        typeof marketplace.path === "string"
          ? { marketplacePath: marketplace.path, pluginName: summary.name }
          : { remoteMarketplaceName: marketplace.name, pluginName: summary.name };
      const pluginResponse = await params.client.request<PluginReadResponse>(
        "plugin/read",
        readParams,
        { timeoutMs: params.timeoutMs, signal: params.signal },
      );
      const mcpServers = pluginResponse.plugin?.mcpServers;
      if (!Array.isArray(mcpServers) || !mcpServers.every((name) => typeof name === "string")) {
        throw new Error(`managed Codex plugin MCP inventory is invalid: ${summary.id}`);
      }
      const collisions = expectedPlugins
        .flatMap((plugin) => plugin.mcpServers)
        .filter((serverName) => mcpServers.includes(serverName));
      if (collisions.length > 0) {
        throw new Error(
          `managed Codex plugin MCP collision: ${summary.id} also owns ${collisions.toSorted().join(", ")}`,
        );
      }
    }
  }
}

function assertNoEffectiveMcpCollisions(config: unknown): void {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("managed Codex config/read response is invalid");
  }
  assertNoStandaloneMcpCollisions(config);
}

async function requireManagedMcpServers(params: {
  client: CodexAppServerClient;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<void> {
  const ready = new Set<string>();
  let cursor: string | null = null;
  do {
    const response: McpServerStatusListResponse =
      await params.client.request<McpServerStatusListResponse>(
        "mcpServerStatus/list",
        { cursor, limit: 100, detail: "toolsAndAuthOnly" },
        { timeoutMs: params.timeoutMs, signal: params.signal },
      );
    if (!Array.isArray(response.data)) {
      throw new Error("managed Codex MCP status response is invalid");
    }
    for (const status of response.data) {
      if (typeof status.name === "string" && status.serverInfo != null) {
        ready.add(status.name);
      }
    }
    if (response.nextCursor !== null && typeof response.nextCursor !== "string") {
      throw new Error("managed Codex MCP status cursor is invalid");
    }
    cursor = response.nextCursor;
  } while (cursor !== null);
  const missing = expectedPlugins
    .flatMap((plugin) => plugin.mcpServers)
    .filter((serverName) => !ready.has(serverName));
  if (missing.length > 0) {
    throw new Error(`managed Codex MCP server startup failed: ${missing.join(", ")}`);
  }
}

function assertInstalledPlugin(
  response: PluginReadResponse,
  manifestPath: string,
  expected: (typeof expectedPlugins)[number],
): void {
  const plugin = response.plugin;
  const summary = plugin?.summary;
  if (
    plugin?.marketplaceName !== MARKETPLACE_NAME ||
    plugin.marketplacePath !== manifestPath ||
    summary?.id !== expected.id ||
    summary.name !== expected.name ||
    summary.version !== null ||
    summary.localVersion !== expected.version ||
    summary.installed !== true ||
    summary.enabled !== true ||
    !Array.isArray(plugin.mcpServers) ||
    !equalStringArrays(plugin.mcpServers, expected.mcpServers)
  ) {
    throw new Error(`managed Codex plugin verification failed: ${expected.id}`);
  }
}

function assertNoStandaloneMcpCollisions(config: unknown): void {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return;
  }
  const mcpServers = (config as Record<string, unknown>).mcp_servers;
  if (!mcpServers || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
    return;
  }
  const collisions = expectedPlugins
    .flatMap((plugin) => plugin.mcpServers)
    .filter((serverName) => Object.hasOwn(mcpServers, serverName));
  if (collisions.length > 0) {
    throw new Error(
      `managed Codex plugin MCP collision: remove standalone ${collisions.toSorted().join(", ")} configuration`,
    );
  }
}

async function resolveActiveSkyCuaRelease(signal: AbortSignal): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const child = spawn(RESOLVER_COMMAND, ["resolve-active"], {
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    const collect = (chunks: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > RESOLVER_MAX_OUTPUT_BYTES) {
        child.kill();
        reject(new Error("sky-cua-release resolve-active output exceeded 1 MiB"));
        return;
      }
      chunks.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `sky-cua-release resolve-active failed (${code ?? "signal"}): ${Buffer.concat(stderr).toString("utf8").trim()}`,
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(stdout).toString("utf8")));
      } catch (error) {
        reject(new Error("sky-cua-release resolve-active returned invalid JSON", { cause: error }));
      }
    });
  });
}

type TreeEntry =
  | { mode: number; path: string; type: "directory" }
  | { mode: number; path: string; sha256: string; size: number; type: "file" };

async function canonicalTreeSha256(root: string): Promise<string> {
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`managed Codex plugin cache root is not a real directory: ${root}`);
  }
  const entries: TreeEntry[] = [];
  await collectTreeEntries(root, root, entries);
  entries.sort((left, right) => compareUnicodeCodePoints(left.path, right.path));
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

async function collectTreeEntries(root: string, directory: string, entries: TreeEntry[]) {
  for (const name of await fs.readdir(directory)) {
    const absolute = path.join(directory, name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) {
      throw new Error(`managed Codex plugin cache contains a symlink: ${relative}`);
    }
    const mode = stat.mode & 0o7777;
    if (stat.isDirectory()) {
      entries.push({ mode, path: relative, type: "directory" });
      await collectTreeEntries(root, absolute, entries);
      continue;
    }
    if (stat.isFile()) {
      const content = await fs.readFile(absolute);
      entries.push({
        mode,
        path: relative,
        sha256: createHash("sha256").update(content).digest("hex"),
        size: stat.size,
        type: "file",
      });
      continue;
    }
    throw new Error(`managed Codex plugin cache contains a special file: ${relative}`);
  }
}

function requireAbsolutePath(value: string, field: string): string {
  if (!path.isAbsolute(value) || path.normalize(value) !== value) {
    throw new Error(`sky-cua ${field} must be a normalized absolute path`);
  }
  return value;
}

function equalStringArrays(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0)!);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0)!);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index]! - rightPoints[index]!;
    }
  }
  return leftPoints.length - rightPoints.length;
}

export const managedNativePluginsTesting = {
  canonicalTreeSha256,
  reset: () => {
    reconcileByClient = new WeakMap();
    reconcileTailByCodexHome.clear();
  },
};
