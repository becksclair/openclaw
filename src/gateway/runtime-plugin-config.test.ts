import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";

const mocks = vi.hoisted(() => ({
  applyPluginAutoEnable: vi.fn(),
  getCurrentPluginMetadataSnapshot: vi.fn(),
  resolvePluginAutoEnableExternalCatalogFingerprint: vi.fn(),
}));

vi.mock("../config/plugin-auto-enable.js", () => ({
  applyPluginAutoEnable: mocks.applyPluginAutoEnable,
}));

vi.mock("../config/plugin-auto-enable.prefer-over.js", () => ({
  resolvePluginAutoEnableExternalCatalogFingerprint:
    mocks.resolvePluginAutoEnableExternalCatalogFingerprint,
}));

vi.mock("../plugins/current-plugin-metadata-snapshot.js", () => ({
  getCurrentPluginMetadataSnapshot: mocks.getCurrentPluginMetadataSnapshot,
}));

describe("resolveGatewayPluginConfig", () => {
  beforeEach(() => {
    mocks.applyPluginAutoEnable.mockReset();
    mocks.getCurrentPluginMetadataSnapshot.mockReset();
    mocks.resolvePluginAutoEnableExternalCatalogFingerprint.mockReset();
    mocks.resolvePluginAutoEnableExternalCatalogFingerprint.mockReturnValue("catalog:same");
  });

  it("reuses auto-enabled config for the same runtime config and metadata snapshot", async () => {
    const { resolveGatewayPluginConfig } = await import("./runtime-plugin-config.js");
    const config = { channels: { telegram: { botToken: "token" } } } as OpenClawConfig;
    const snapshot = { manifestRegistry: { plugins: [], diagnostics: [] } };
    const resolved = { ...config, plugins: { allow: ["telegram"] } } as OpenClawConfig;
    mocks.getCurrentPluginMetadataSnapshot.mockReturnValue(snapshot);
    mocks.applyPluginAutoEnable.mockReturnValue({ config: resolved, changes: [] });

    expect(resolveGatewayPluginConfig({ config })).toBe(resolved);
    expect(resolveGatewayPluginConfig({ config })).toBe(resolved);

    expect(mocks.applyPluginAutoEnable).toHaveBeenCalledTimes(1);
  });

  it("refreshes the cached config when metadata snapshot changes", async () => {
    const { resolveGatewayPluginConfig } = await import("./runtime-plugin-config.js");
    const config = { channels: { telegram: { botToken: "token" } } } as OpenClawConfig;
    const first = { manifestRegistry: { plugins: [], diagnostics: [] } };
    const second = { manifestRegistry: { plugins: [], diagnostics: [] } };
    mocks.getCurrentPluginMetadataSnapshot.mockReturnValueOnce(first).mockReturnValue(second);
    mocks.applyPluginAutoEnable
      .mockReturnValueOnce({ config: { ...config, first: true }, changes: [] })
      .mockReturnValueOnce({ config: { ...config, second: true }, changes: [] });

    expect(resolveGatewayPluginConfig({ config })).toMatchObject({ first: true });
    expect(resolveGatewayPluginConfig({ config })).toMatchObject({ second: true });

    expect(mocks.applyPluginAutoEnable).toHaveBeenCalledTimes(2);
  });

  it("refreshes the cached config when env object changes", async () => {
    const { resolveGatewayPluginConfig } = await import("./runtime-plugin-config.js");
    const config = { channels: { telegram: { botToken: "token" } } } as OpenClawConfig;
    const snapshot = { manifestRegistry: { plugins: [], diagnostics: [] } };
    mocks.getCurrentPluginMetadataSnapshot.mockReturnValue(snapshot);
    mocks.applyPluginAutoEnable
      .mockReturnValueOnce({ config: { ...config, first: true }, changes: [] })
      .mockReturnValueOnce({ config: { ...config, second: true }, changes: [] });

    expect(resolveGatewayPluginConfig({ config, env: { A: "1" } })).toMatchObject({
      first: true,
    });
    expect(resolveGatewayPluginConfig({ config, env: { A: "2" } })).toMatchObject({
      second: true,
    });

    expect(mocks.applyPluginAutoEnable).toHaveBeenCalledTimes(2);
  });

  it("refreshes the cached config when a reused env object mutates", async () => {
    const { resolveGatewayPluginConfig } = await import("./runtime-plugin-config.js");
    const config = { channels: { telegram: { botToken: "token" } } } as OpenClawConfig;
    const env = { HOME: "/tmp/one" };
    const snapshot = { manifestRegistry: { plugins: [], diagnostics: [] } };
    mocks.getCurrentPluginMetadataSnapshot.mockReturnValue(snapshot);
    mocks.applyPluginAutoEnable
      .mockReturnValueOnce({ config: { ...config, first: true }, changes: [] })
      .mockReturnValueOnce({ config: { ...config, second: true }, changes: [] });

    expect(resolveGatewayPluginConfig({ config, env })).toMatchObject({ first: true });
    env.HOME = "/tmp/two";
    expect(resolveGatewayPluginConfig({ config, env })).toMatchObject({ second: true });

    expect(mocks.applyPluginAutoEnable).toHaveBeenCalledTimes(2);
  });

  it("does not re-stat external catalogs while the cached fingerprint is fresh", async () => {
    const { resolveGatewayPluginConfig } = await import("./runtime-plugin-config.js");
    const config = { gateway: { enabled: true } } as OpenClawConfig;
    const snapshot = { manifestRegistry: { plugins: [], diagnostics: [] } };
    mocks.getCurrentPluginMetadataSnapshot.mockReturnValue(snapshot);
    mocks.applyPluginAutoEnable.mockReturnValue({
      config: { ...config, autoEnabled: true },
      changes: [],
    });

    resolveGatewayPluginConfig({ config, env: {}, nowMs: 0 });
    resolveGatewayPluginConfig({ config, env: {}, nowMs: 999 });

    expect(mocks.applyPluginAutoEnable).toHaveBeenCalledTimes(1);
    expect(mocks.resolvePluginAutoEnableExternalCatalogFingerprint).toHaveBeenCalledTimes(1);
  });

  it("refreshes the cached config when external catalog files change", async () => {
    const { resolveGatewayPluginConfig } = await import("./runtime-plugin-config.js");
    const config = { gateway: { enabled: true } } as OpenClawConfig;
    const snapshot = { manifestRegistry: { plugins: [], diagnostics: [] } };
    mocks.getCurrentPluginMetadataSnapshot.mockReturnValue(snapshot);
    mocks.resolvePluginAutoEnableExternalCatalogFingerprint
      .mockReturnValueOnce("catalog:old")
      .mockReturnValueOnce("catalog:new");
    mocks.applyPluginAutoEnable
      .mockReturnValueOnce({ config: { ...config, first: true }, changes: [] })
      .mockReturnValueOnce({ config: { ...config, second: true }, changes: [] });

    expect(resolveGatewayPluginConfig({ config, env: {}, nowMs: 0 })).toMatchObject({
      first: true,
    });
    expect(resolveGatewayPluginConfig({ config, env: {}, nowMs: 1_000 })).toMatchObject({
      second: true,
    });

    expect(mocks.applyPluginAutoEnable).toHaveBeenCalledTimes(2);
  });

  it("does not cache without a current metadata snapshot", async () => {
    const { resolveGatewayPluginConfig } = await import("./runtime-plugin-config.js");
    const config = {} as OpenClawConfig;
    mocks.getCurrentPluginMetadataSnapshot.mockReturnValue(undefined);
    mocks.applyPluginAutoEnable.mockImplementation(() => ({ config: {}, changes: [] }));

    resolveGatewayPluginConfig({ config });
    resolveGatewayPluginConfig({ config });

    expect(mocks.applyPluginAutoEnable).toHaveBeenCalledTimes(2);
  });
});
