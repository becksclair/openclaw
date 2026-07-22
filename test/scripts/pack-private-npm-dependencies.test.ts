import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectPrivateDependencyPlan,
  PRIVATE_DEPENDENCY_SOURCES,
  readPrivateDependencyPlan,
  resolvePrivateDependencyVersion,
  rewriteRootPrivateDependencyVersions,
} from "../../scripts/pack-private-npm-dependencies.mjs";

describe("pack-private-npm-dependencies", () => {
  it("covers every OpenClaw-owned root runtime dependency", () => {
    const rootManifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies: Record<string, string>;
    };
    const expectedNames = Object.keys(rootManifest.dependencies)
      .filter((name) => name.startsWith("@openclaw/"))
      .sort();

    expect(readPrivateDependencyPlan().map(({ name }) => name)).toEqual(expectedNames);
    expect(Object.keys(PRIVATE_DEPENDENCY_SOURCES).sort()).toEqual(expectedNames);
  });

  it("rejects an unaccounted private dependency", () => {
    expect(() =>
      collectPrivateDependencyPlan({
        rootManifest: { dependencies: { "@openclaw/new-runtime": "1.0.0" } },
        sources: {},
        readSourceManifest: () => ({ name: "@openclaw/new-runtime", version: "1.0.0" }),
      }),
    ).toThrow("missing=@openclaw/new-runtime");
  });

  it("rejects a source version that differs from the root dependency", () => {
    expect(() =>
      collectPrivateDependencyPlan({
        rootManifest: { dependencies: { "@openclaw/runtime": "1.0.0" } },
        sources: { "@openclaw/runtime": "node_modules/@openclaw/runtime" },
        readSourceManifest: () => ({ name: "@openclaw/runtime", version: "1.0.1" }),
      }),
    ).toThrow("source version 1.0.1 does not match root dependency 1.0.0");
  });

  it("assigns workspace packages an immutable per-run version", () => {
    expect(resolvePrivateDependencyVersion("2026.7.1", true, "2954")).toBe("2026.7.1-private.2954");
    expect(resolvePrivateDependencyVersion("2026.7.1-beta.3", true, "2954")).toBe(
      "2026.7.1-beta.3.private.2954",
    );
    expect(resolvePrivateDependencyVersion("0.4.1", false, "2954")).toBe("0.4.1");
  });

  it("rewrites matching root package and shrinkwrap dependency specs together", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "openclaw-private-dependency-rewrite-"));
    try {
      writeFileSync(
        join(rootDir, "package.json"),
        JSON.stringify({ dependencies: { "@openclaw/ai": "workspace:*" } }),
      );
      writeFileSync(
        join(rootDir, "npm-shrinkwrap.json"),
        JSON.stringify({
          packages: { "": { dependencies: { "@openclaw/ai": "2026.7.1" } } },
        }),
      );

      rewriteRootPrivateDependencyVersions({
        rootDir,
        dependencies: [{ name: "@openclaw/ai", version: "2026.7.1-private.2954" }],
      });

      const packageManifest = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
      const shrinkwrap = JSON.parse(readFileSync(join(rootDir, "npm-shrinkwrap.json"), "utf8"));
      expect(packageManifest.dependencies["@openclaw/ai"]).toBe("2026.7.1-private.2954");
      expect(shrinkwrap.packages[""].dependencies["@openclaw/ai"]).toBe("2026.7.1-private.2954");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
