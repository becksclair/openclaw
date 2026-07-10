// Package state probe tests cover channel plugin package install and runtime status probes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginChannelCatalogEntry } from "../../plugins/channel-catalog-registry.js";
import { clearPluginMetadataLifecycleCaches } from "../../plugins/plugin-metadata-lifecycle.js";
import {
  clearChannelPackageStateProbeCache,
  hasBundledChannelPackageState,
  listBundledChannelIdsForPackageState,
} from "./package-state-probes.js";

const listChannelCatalogEntriesMock = vi.hoisted(() => vi.fn());
const isBundledSourceOverlayPathMock = vi.hoisted(() =>
  vi.fn((_params: { sourcePath: string }) => false),
);
const tempDirs: string[] = [];

vi.mock("../../plugins/channel-catalog-registry.js", () => ({
  listChannelCatalogEntries: listChannelCatalogEntriesMock,
}));
vi.mock("../../plugins/bundled-source-overlays.js", () => ({
  isBundledSourceOverlayPath: isBundledSourceOverlayPathMock,
}));

function makeBundledChannelCatalogEntry(params: {
  pluginId: string;
  channelId: string;
}): PluginChannelCatalogEntry {
  return {
    pluginId: params.pluginId,
    origin: "bundled",
    rootDir: "/tmp/openclaw-channel-plugin",
    channel: {
      id: params.channelId,
      configuredState: {
        env: {
          allOf: ["ALIAS_CHAT_TOKEN"],
        },
      },
    },
  };
}

function removeTempDirs() {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

beforeEach(() => {
  removeTempDirs();
  clearChannelPackageStateProbeCache();
  listChannelCatalogEntriesMock.mockReset();
  isBundledSourceOverlayPathMock.mockReset();
  isBundledSourceOverlayPathMock.mockReturnValue(false);
});

afterEach(() => {
  removeTempDirs();
});

describe("channel package-state probes", () => {
  it("uses channel ids when manifest plugin ids differ", () => {
    listChannelCatalogEntriesMock.mockReturnValue([
      makeBundledChannelCatalogEntry({
        pluginId: "vendor-alias-chat-plugin",
        channelId: "alias-chat",
      }),
    ]);

    expect(listBundledChannelIdsForPackageState("configuredState")).toEqual(["alias-chat"]);
    expect(
      hasBundledChannelPackageState({
        metadataKey: "configuredState",
        channelId: "alias-chat",
        cfg: {},
        env: { ALIAS_CHAT_TOKEN: "token" },
      }),
    ).toBe(true);
    expect(
      hasBundledChannelPackageState({
        metadataKey: "configuredState",
        channelId: "vendor-alias-chat-plugin",
        cfg: {},
        env: { ALIAS_CHAT_TOKEN: "token" },
      }),
    ).toBe(false);
  });

  it("reuses bundled package-state catalogs and checkers on repeated probes", () => {
    listChannelCatalogEntriesMock.mockReturnValue([
      makeBundledChannelCatalogEntry({
        pluginId: "vendor-alias-chat-plugin",
        channelId: "alias-chat",
      }),
    ]);

    expect(listBundledChannelIdsForPackageState("configuredState")).toEqual(["alias-chat"]);
    expect(
      hasBundledChannelPackageState({
        metadataKey: "configuredState",
        channelId: "alias-chat",
        cfg: {},
        env: { ALIAS_CHAT_TOKEN: "token" },
      }),
    ).toBe(true);
    expect(
      hasBundledChannelPackageState({
        metadataKey: "configuredState",
        channelId: "alias-chat",
        cfg: {},
        env: { ALIAS_CHAT_TOKEN: "token" },
      }),
    ).toBe(true);
    expect(listChannelCatalogEntriesMock).toHaveBeenCalledTimes(1);
  });

  it("clears package-state caches at plugin metadata lifecycle boundaries", () => {
    listChannelCatalogEntriesMock.mockReturnValue([
      makeBundledChannelCatalogEntry({
        pluginId: "vendor-alias-chat-plugin",
        channelId: "alias-chat",
      }),
    ]);

    expect(
      hasBundledChannelPackageState({
        metadataKey: "configuredState",
        channelId: "alias-chat",
        cfg: {},
        env: { ALIAS_CHAT_TOKEN: "token" },
      }),
    ).toBe(true);
    clearPluginMetadataLifecycleCaches();
    expect(
      hasBundledChannelPackageState({
        metadataKey: "configuredState",
        channelId: "alias-chat",
        cfg: {},
        env: { ALIAS_CHAT_TOKEN: "token" },
      }),
    ).toBe(true);
    expect(listChannelCatalogEntriesMock).toHaveBeenCalledTimes(2);
  });

  it("scopes bundled package-state catalog caches by bundled root", () => {
    const firstRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-bundled-one-"));
    const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-bundled-two-"));
    tempDirs.push(firstRoot, secondRoot);
    const firstEnv = {
      OPENCLAW_BUNDLED_PLUGINS_DIR: path.join(firstRoot, "extensions"),
      OPENCLAW_TEST_TRUST_BUNDLED_PLUGINS_DIR: "1",
      ALIAS_CHAT_TOKEN: "token",
    };
    const secondEnv = {
      OPENCLAW_BUNDLED_PLUGINS_DIR: path.join(secondRoot, "extensions"),
      OPENCLAW_TEST_TRUST_BUNDLED_PLUGINS_DIR: "1",
      ALIAS_CHAT_TOKEN: "token",
    };
    fs.mkdirSync(firstEnv.OPENCLAW_BUNDLED_PLUGINS_DIR, { recursive: true });
    fs.mkdirSync(secondEnv.OPENCLAW_BUNDLED_PLUGINS_DIR, { recursive: true });
    listChannelCatalogEntriesMock.mockImplementation(({ env }: { env?: NodeJS.ProcessEnv }) =>
      env?.OPENCLAW_BUNDLED_PLUGINS_DIR?.includes("two")
        ? [
            makeBundledChannelCatalogEntry({
              pluginId: "vendor-second-chat-plugin",
              channelId: "second-chat",
            }),
          ]
        : [
            makeBundledChannelCatalogEntry({
              pluginId: "vendor-first-chat-plugin",
              channelId: "first-chat",
            }),
          ],
    );

    expect(
      hasBundledChannelPackageState({
        metadataKey: "configuredState",
        channelId: "first-chat",
        cfg: {},
        env: firstEnv,
      }),
    ).toBe(true);
    expect(
      hasBundledChannelPackageState({
        metadataKey: "configuredState",
        channelId: "second-chat",
        cfg: {},
        env: secondEnv,
      }),
    ).toBe(true);
    expect(listChannelCatalogEntriesMock).toHaveBeenCalledTimes(2);
  });

  it("scopes bundled package-state catalog caches by source-overlay mode", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-bundled-overlay-mode-"));
    tempDirs.push(root);
    const bundledDir = path.join(root, "extensions");
    fs.mkdirSync(bundledDir, { recursive: true });
    const env = {
      OPENCLAW_BUNDLED_PLUGINS_DIR: bundledDir,
      OPENCLAW_TEST_TRUST_BUNDLED_PLUGINS_DIR: "1",
      ALIAS_CHAT_TOKEN: "token",
    };
    listChannelCatalogEntriesMock.mockReturnValue([
      makeBundledChannelCatalogEntry({
        pluginId: "vendor-alias-chat-plugin",
        channelId: "alias-chat",
      }),
    ]);

    expect(
      hasBundledChannelPackageState({
        metadataKey: "configuredState",
        channelId: "alias-chat",
        cfg: {},
        env,
      }),
    ).toBe(true);
    expect(
      hasBundledChannelPackageState({
        metadataKey: "configuredState",
        channelId: "alias-chat",
        cfg: {},
        env: {
          ...env,
          OPENCLAW_DISABLE_BUNDLED_SOURCE_OVERLAYS: "1",
        },
      }),
    ).toBe(true);
    expect(listChannelCatalogEntriesMock).toHaveBeenCalledTimes(2);
  });

  it("prefers built bundled package-state probes when the catalog root is source", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-package-state-probe-"));
    tempDirs.push(root);
    const sourceRoot = path.join(root, "extensions", "matrix");
    const builtRoot = path.join(root, "dist", "extensions", "matrix");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(builtRoot, { recursive: true });
    fs.writeFileSync(
      path.join(sourceRoot, "auth-presence.ts"),
      "throw new Error('source probe should not load');\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(builtRoot, "auth-presence.js"),
      "module.exports.hasAnyMatrixAuth = () => true;\n",
      "utf8",
    );

    listChannelCatalogEntriesMock.mockReturnValue([
      {
        pluginId: "matrix",
        origin: "bundled",
        rootDir: sourceRoot,
        channel: {
          id: "matrix",
          persistedAuthState: {
            specifier: "./auth-presence",
            exportName: "hasAnyMatrixAuth",
          },
        },
      } satisfies PluginChannelCatalogEntry,
    ]);

    expect(
      hasBundledChannelPackageState({
        metadataKey: "persistedAuthState",
        channelId: "matrix",
        cfg: {},
      }),
    ).toBe(true);
  });

  it("falls back to source package-state probes when built artifacts are stale", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-package-state-fallback-"));
    tempDirs.push(root);
    const sourceRoot = path.join(root, "extensions", "whatsapp");
    const builtRoot = path.join(root, "dist", "extensions", "whatsapp");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(builtRoot, { recursive: true });
    fs.writeFileSync(
      path.join(sourceRoot, "auth-presence.js"),
      "module.exports.hasAnyWhatsAppAuth = () => true;\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(builtRoot, "auth-presence.js"),
      "module.exports.stale = () => false;\n",
      "utf8",
    );

    listChannelCatalogEntriesMock.mockReturnValue([
      {
        pluginId: "whatsapp",
        origin: "bundled",
        rootDir: sourceRoot,
        channel: {
          id: "whatsapp",
          persistedAuthState: {
            specifier: "./auth-presence",
            exportName: "hasAnyWhatsAppAuth",
          },
        },
      } satisfies PluginChannelCatalogEntry,
    ]);

    expect(
      hasBundledChannelPackageState({
        metadataKey: "persistedAuthState",
        channelId: "whatsapp",
        cfg: {},
      }),
    ).toBe(true);
  });

  it("preserves source overlay precedence over packaged package-state probes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-package-state-overlay-"));
    tempDirs.push(root);
    const sourceRoot = path.join(root, "extensions", "matrix");
    const builtRoot = path.join(root, "dist", "extensions", "matrix");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(builtRoot, { recursive: true });
    fs.writeFileSync(
      path.join(sourceRoot, "auth-presence.js"),
      "module.exports.hasAnyMatrixAuth = () => true;\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(builtRoot, "auth-presence.js"),
      "module.exports.hasAnyMatrixAuth = () => false;\n",
      "utf8",
    );
    isBundledSourceOverlayPathMock.mockImplementation(
      ({ sourcePath }: { sourcePath: string }) => path.resolve(sourcePath) === sourceRoot,
    );

    listChannelCatalogEntriesMock.mockReturnValue([
      {
        pluginId: "matrix",
        origin: "bundled",
        rootDir: sourceRoot,
        channel: {
          id: "matrix",
          persistedAuthState: {
            specifier: "./auth-presence",
            exportName: "hasAnyMatrixAuth",
          },
        },
      } satisfies PluginChannelCatalogEntry,
    ]);

    expect(
      hasBundledChannelPackageState({
        metadataKey: "persistedAuthState",
        channelId: "matrix",
        cfg: {},
      }),
    ).toBe(true);
  });

  it("preserves parent-mounted source overlay precedence over packaged package-state probes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-package-state-parent-overlay-"));
    tempDirs.push(root);
    const extensionsRoot = path.join(root, "extensions");
    const sourceRoot = path.join(extensionsRoot, "matrix");
    const builtRoot = path.join(root, "dist", "extensions", "matrix");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(builtRoot, { recursive: true });
    fs.writeFileSync(
      path.join(sourceRoot, "auth-presence.js"),
      "module.exports.hasAnyMatrixAuth = () => true;\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(builtRoot, "auth-presence.js"),
      "module.exports.hasAnyMatrixAuth = () => false;\n",
      "utf8",
    );
    isBundledSourceOverlayPathMock.mockImplementation(
      ({ sourcePath }: { sourcePath: string }) => path.resolve(sourcePath) === extensionsRoot,
    );

    listChannelCatalogEntriesMock.mockReturnValue([
      {
        pluginId: "matrix",
        origin: "bundled",
        rootDir: sourceRoot,
        channel: {
          id: "matrix",
          persistedAuthState: {
            specifier: "./auth-presence",
            exportName: "hasAnyMatrixAuth",
          },
        },
      } satisfies PluginChannelCatalogEntry,
    ]);

    expect(
      hasBundledChannelPackageState({
        metadataKey: "persistedAuthState",
        channelId: "matrix",
        cfg: {},
      }),
    ).toBe(true);
  });

  it("tries dist-runtime package-state probes before falling back to source", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-package-state-runtime-"));
    tempDirs.push(root);
    const sourceRoot = path.join(root, "extensions", "matrix");
    const builtRoot = path.join(root, "dist", "extensions", "matrix");
    const runtimeRoot = path.join(root, "dist-runtime", "extensions", "matrix");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(builtRoot, { recursive: true });
    fs.mkdirSync(runtimeRoot, { recursive: true });
    fs.writeFileSync(
      path.join(sourceRoot, "auth-presence.js"),
      "throw new Error('source probe should not load');\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(builtRoot, "auth-presence.js"),
      "module.exports.stale = () => false;\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(runtimeRoot, "auth-presence.js"),
      "module.exports.hasAnyMatrixAuth = () => true;\n",
      "utf8",
    );

    listChannelCatalogEntriesMock.mockReturnValue([
      {
        pluginId: "matrix",
        origin: "bundled",
        rootDir: sourceRoot,
        channel: {
          id: "matrix",
          persistedAuthState: {
            specifier: "./auth-presence",
            exportName: "hasAnyMatrixAuth",
          },
        },
      } satisfies PluginChannelCatalogEntry,
    ]);

    expect(
      hasBundledChannelPackageState({
        metadataKey: "persistedAuthState",
        channelId: "matrix",
        cfg: {},
      }),
    ).toBe(true);
  });

  it("retries package-state checker loads after an early missing module", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-package-state-retry-"));
    tempDirs.push(root);
    const sourceRoot = path.join(root, "extensions", "matrix");
    fs.mkdirSync(sourceRoot, { recursive: true });

    listChannelCatalogEntriesMock.mockReturnValue([
      {
        pluginId: "matrix",
        origin: "bundled",
        rootDir: sourceRoot,
        channel: {
          id: "matrix",
          persistedAuthState: {
            specifier: "./auth-presence",
            exportName: "hasAnyMatrixAuth",
          },
        },
      } satisfies PluginChannelCatalogEntry,
    ]);

    expect(
      hasBundledChannelPackageState({
        metadataKey: "persistedAuthState",
        channelId: "matrix",
        cfg: {},
      }),
    ).toBe(false);

    fs.writeFileSync(
      path.join(sourceRoot, "auth-presence.js"),
      "module.exports.hasAnyMatrixAuth = () => true;\n",
      "utf8",
    );

    expect(
      hasBundledChannelPackageState({
        metadataKey: "persistedAuthState",
        channelId: "matrix",
        cfg: {},
      }),
    ).toBe(true);
  });
});
