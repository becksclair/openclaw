// Tokenjuice tests cover manifest plugin behavior.
import fs from "node:fs";
import { describe, expect, it } from "vitest";

type TokenjuicePackageManifest = {
  dependencies?: Record<string, string>;
};

type TokenjuicePluginManifest = {
  contracts?: {
    agentToolResultMiddleware?: string[];
  };
};

describe("tokenjuice package manifest", () => {
  it("keeps runtime dependencies in the package manifest", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(new URL("./package.json", import.meta.url), "utf8"),
    ) as TokenjuicePackageManifest;

    expect(packageJson.dependencies?.tokenjuice).toBe(
      "https://github.com/becksclair/openclaw-tokenjuice.git#4872cd59480159313ef164d6828a46abfd73db7d",
    );
  });

  it("declares runtime-neutral tool result middleware ownership in the manifest contract", () => {
    const manifest = JSON.parse(
      fs.readFileSync(new URL("./openclaw.plugin.json", import.meta.url), "utf8"),
    ) as TokenjuicePluginManifest;

    expect(manifest.contracts?.agentToolResultMiddleware).toEqual(["openclaw", "codex"]);
  });
});
