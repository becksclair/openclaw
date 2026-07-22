import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexAppServerClient } from "./client.js";
import {
  ensureManagedNativePlugins,
  managedNativePluginsTesting,
} from "./managed-native-plugins.js";

function createClient() {
  const request = vi.fn(async () => ({ authPolicy: "ON_INSTALL", appsNeedingAuth: [] }));
  return { request, client: { request } as unknown as CodexAppServerClient };
}

function installParams(client: CodexAppServerClient) {
  return {
    client,
    timeoutMs: 1_000,
    signal: new AbortController().signal,
  };
}

describe("managed native Codex plugins", () => {
  beforeEach(() => {
    managedNativePluginsTesting.reset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("installs both plugins from the fixed XDG marketplace before succeeding", async () => {
    vi.stubEnv("XDG_DATA_HOME", "/data");
    const { client, request } = createClient();

    await ensureManagedNativePlugins(installParams(client));

    const marketplacePath = path.join(
      "/data",
      "sky-cua/codex/openai-bundled/.agents/plugins/marketplace.json",
    );
    expect(request.mock.calls).toEqual([
      [
        "plugin/install",
        { marketplacePath, pluginName: "computer-use" },
        expect.objectContaining({ timeoutMs: 1_000 }),
      ],
      [
        "plugin/install",
        { marketplacePath, pluginName: "browser-use" },
        expect.objectContaining({ timeoutMs: 1_000 }),
      ],
    ]);
  });

  it("falls back to the fixed home data root when XDG_DATA_HOME is absent or relative", () => {
    const resolvePath = managedNativePluginsTesting.resolveSkyCuaMarketplaceManifestPath;
    const expected =
      "/home/test/.local/share/sky-cua/codex/openai-bundled/.agents/plugins/marketplace.json";

    expect(resolvePath({}, "/home/test")).toBe(expected);
    expect(resolvePath({ XDG_DATA_HOME: "relative" }, "/home/test")).toBe(expected);
  });

  it("single-flights concurrent first-thread installs for one app-server client", async () => {
    vi.stubEnv("XDG_DATA_HOME", "/data");
    const { client, request } = createClient();
    const params = installParams(client);

    await Promise.all([ensureManagedNativePlugins(params), ensureManagedNativePlugins(params)]);

    expect(request).toHaveBeenCalledTimes(2);
  });

  it("installs into every fresh app-server client", async () => {
    vi.stubEnv("XDG_DATA_HOME", "/data");
    const first = createClient();
    const second = createClient();

    await ensureManagedNativePlugins(installParams(first.client));
    await ensureManagedNativePlugins(installParams(second.client));

    expect(first.request).toHaveBeenCalledTimes(2);
    expect(second.request).toHaveBeenCalledTimes(2);
  });

  it("retries after a failed install sequence", async () => {
    vi.stubEnv("XDG_DATA_HOME", "/data");
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("install failed"))
      .mockResolvedValue({ authPolicy: "ON_INSTALL", appsNeedingAuth: [] });
    const client = { request } as unknown as CodexAppServerClient;

    await expect(ensureManagedNativePlugins(installParams(client))).rejects.toThrow(
      "install failed",
    );
    await ensureManagedNativePlugins(installParams(client));

    expect(request).toHaveBeenCalledTimes(3);
  });
});
