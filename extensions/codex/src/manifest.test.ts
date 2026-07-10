// Codex tests cover manifest plugin behavior.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MANAGED_CODEX_APP_SERVER_PACKAGE_VERSION } from "./app-server/version.js";

const require = createRequire(import.meta.url);

const CODEX_PLATFORM_TARGETS = {
  "darwin-arm64": ["darwin-arm64", "aarch64-apple-darwin"],
  "darwin-x64": ["darwin-x64", "x86_64-apple-darwin"],
  "linux-arm64": ["linux-arm64", "aarch64-unknown-linux-musl"],
  "linux-x64": ["linux-x64", "x86_64-unknown-linux-musl"],
  "win32-arm64": ["win32-arm64", "aarch64-pc-windows-msvc"],
  "win32-x64": ["win32-x64", "x86_64-pc-windows-msvc"],
} as const;

type CodexPackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  openclaw?: {
    install?: {
      requiredPlatformPackages?: string[];
    };
    release?: {
      requireLatestDependencies?: string[];
    };
  };
};

describe("codex package manifest", () => {
  it("keeps runtime dependencies in the package manifest", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as CodexPackageManifest;

    expect(packageJson.devDependencies).toHaveProperty("@openclaw/plugin-sdk");
    expect(packageJson.dependencies?.["@openai/codex"]).toBe(
      MANAGED_CODEX_APP_SERVER_PACKAGE_VERSION,
    );
    expect(packageJson.openclaw?.release?.requireLatestDependencies).toEqual(["@openai/codex"]);
    expect(packageJson.openclaw?.install?.requiredPlatformPackages).toEqual([
      "@openai/codex-linux-x64",
      "@openai/codex-linux-arm64",
      "@openai/codex-darwin-x64",
      "@openai/codex-darwin-arm64",
      "@openai/codex-win32-x64",
      "@openai/codex-win32-arm64",
    ]);
  });

  it("ships the code-mode host beside the current-platform Codex binary", () => {
    const target =
      CODEX_PLATFORM_TARGETS[
        `${process.platform}-${process.arch}` as keyof typeof CODEX_PLATFORM_TARGETS
      ];
    expect(target).toBeDefined();
    const [packageSuffix, targetTriple] = target!;
    const packageJson = require.resolve(`@openai/codex-${packageSuffix}/package.json`);
    const binaryDir = path.join(path.dirname(packageJson), "vendor", targetTriple, "bin");
    const executableSuffix = process.platform === "win32" ? ".exe" : "";
    const codexBinary = path.join(binaryDir, `codex${executableSuffix}`);
    const codeModeHost = path.join(binaryDir, `codex-code-mode-host${executableSuffix}`);

    expect(fs.statSync(codexBinary).isFile()).toBe(true);
    expect(fs.statSync(codeModeHost).isFile()).toBe(true);
    if (process.platform !== "win32") {
      expect(() => fs.accessSync(codexBinary, fs.constants.X_OK)).not.toThrow();
      expect(() => fs.accessSync(codeModeHost, fs.constants.X_OK)).not.toThrow();
    }
  });
});
