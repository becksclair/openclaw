import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createTestRunnerEnv,
  readShellEnvVariableNamesFromFiles,
  resolveTestEnvSanitizerFiles,
  sanitizeTestEnv,
} from "../../scripts/lib/test-env-sanitizer.mjs";
import { createScriptTestHarness } from "./test-helpers.js";

const { createTempDir } = createScriptTestHarness();

describe("test-env-sanitizer", () => {
  it("uses configured env file list with tilde expansion", () => {
    const resolved = resolveTestEnvSanitizerFiles({
      ...process.env,
      OPENCLAW_TEST_UNSET_ENV_FILES: "~/personal/dotfiles/secrets.sh",
    });

    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toContain(path.join("personal", "dotfiles", "secrets.sh"));
    expect(resolved[0].startsWith("~")).toBe(false);
  });

  it("parses variable assignments from shell files", () => {
    const tempDir = createTempDir("openclaw-test-env-sanitizer-");
    const secretsPath = path.join(tempDir, "secrets.sh");
    fs.writeFileSync(
      secretsPath,
      [
        "# comment",
        "export OPENAI_API_KEY=sk-test",
        "ANTHROPIC_API_KEY=ant-test",
        "NO_ASSIGNMENT",
      ].join("\n"),
      "utf8",
    );

    const names = readShellEnvVariableNamesFromFiles([secretsPath]);

    expect([...names].toSorted((a, b) => a.localeCompare(b))).toEqual([
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
    ]);
  });

  it("removes secret vars while preserving core shell env", () => {
    const tempDir = createTempDir("openclaw-test-env-sanitizer-");
    const secretsPath = path.join(tempDir, "secrets.sh");
    fs.writeFileSync(
      secretsPath,
      ["OPENAI_API_KEY=sk-test", "PATH=/should-not-remove"].join("\n"),
      "utf8",
    );

    const sanitized = sanitizeTestEnv({
      ...process.env,
      OPENAI_API_KEY: "sk-test",
      PATH: process.env.PATH ?? "",
      OPENCLAW_TEST_UNSET_ENV_FILES: secretsPath,
    });

    expect(sanitized.OPENAI_API_KEY).toBeUndefined();
    expect(sanitized.PATH).toBe(process.env.PATH ?? "");
  });

  it("can disable sanitization explicitly", () => {
    const sanitized = sanitizeTestEnv({
      ...process.env,
      OPENAI_API_KEY: "sk-test",
      OPENCLAW_TEST_DISABLE_ENV_SANITIZER: "1",
      OPENCLAW_TEST_UNSET_ENV_FILES: "/does/not/exist",
    });

    expect(sanitized.OPENAI_API_KEY).toBe("sk-test");
  });

  it("creates a temp runner home for hermetic test runs", () => {
    const { env, cleanup } = createTestRunnerEnv({
      ...process.env,
      OPENCLAW_TEST_UNSET_ENV_FILES: "/does/not/exist",
    });

    try {
      expect(env.HOME).toBeTruthy();
      expect(env.USERPROFILE).toBe(env.HOME);
      expect(env.OPENCLAW_TEST_HOME).toBe(env.HOME);
      expect(env.OPENCLAW_CONFIG_PATH).toBeUndefined();
      expect(env.OPENCLAW_STATE_DIR).toBeUndefined();
      expect(env.OPENCLAW_AGENT_DIR).toBeUndefined();
      expect(env.PI_CODING_AGENT_DIR).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("skips runner home isolation when explicitly disabled", () => {
    const previousTestHome = process.env.OPENCLAW_TEST_HOME;
    const { env, cleanup } = createTestRunnerEnv({
      ...process.env,
      HOME: "/tmp/original-home",
      OPENCLAW_TEST_UNSET_ENV_FILES: "/does/not/exist",
      OPENCLAW_TEST_DISABLE_RUNNER_HOME_ISOLATION: "1",
    });

    try {
      expect(env.HOME).toBe("/tmp/original-home");
      expect(env.OPENCLAW_TEST_HOME).toBe(previousTestHome);
    } finally {
      cleanup();
    }
  });
});
