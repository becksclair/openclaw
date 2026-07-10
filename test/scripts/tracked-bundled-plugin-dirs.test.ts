import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listTrackedBundledPluginDirs } from "../../scripts/lib/tracked-bundled-plugin-dirs.mjs";
import { createScriptTestHarness } from "./test-helpers.js";

const { createTempDir } = createScriptTestHarness();

function runGit(rootDir: string, args: string[]): void {
  execFileSync("git", ["-C", rootDir, ...args], { stdio: "ignore" });
}

describe("listTrackedBundledPluginDirs", () => {
  it("lists only git-tracked bundled plugin dirs", () => {
    const rootDir = createTempDir("openclaw-tracked-bundled-plugin-dirs-");
    runGit(rootDir, ["init"]);

    fs.mkdirSync(path.join(rootDir, "extensions", "tracked"), { recursive: true });
    fs.mkdirSync(path.join(rootDir, "extensions", "private-local"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "extensions", "tracked", "package.json"), "{}\n");
    fs.writeFileSync(path.join(rootDir, "extensions", "private-local", "package.json"), "{}\n");
    runGit(rootDir, ["add", "extensions/tracked/package.json"]);

    expect(listTrackedBundledPluginDirs(rootDir)).toEqual(new Set(["tracked"]));
  });

  it("fails open outside a git worktree", () => {
    const rootDir = createTempDir("openclaw-tracked-bundled-plugin-dirs-");

    expect(listTrackedBundledPluginDirs(rootDir)).toBeNull();
  });
});
