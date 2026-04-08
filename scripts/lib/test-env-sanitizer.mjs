import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CORE_ENV_VARS = new Set([
  "HOME",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "PATH",
  "PWD",
  "SHELL",
  "TERM",
  "TMP",
  "TMPDIR",
  "TEMP",
  "USER",
  "USERPROFILE",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "XDG_CACHE_HOME",
]);

function parseEnvVariableNamesFromShellText(sourceText) {
  const names = new Set();

  for (const rawLine of sourceText.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/u);
    if (!match) {
      continue;
    }

    names.add(match[1]);
  }

  return names;
}

function normalizeEnvFileList(rawValue) {
  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.replace(/^~(?=\/|$)/u, os.homedir()));
}

function isLiveTestEnv(env) {
  return env.LIVE === "1" || env.OPENCLAW_LIVE_TEST === "1" || env.OPENCLAW_LIVE_GATEWAY === "1";
}

export function resolveTestEnvSanitizerFiles(env) {
  const configured = normalizeEnvFileList(env.OPENCLAW_TEST_UNSET_ENV_FILES);
  if (configured.length > 0) {
    return configured;
  }

  return [path.join(os.homedir(), "personal", "dotfiles", "secrets.sh")];
}

export function readShellEnvVariableNamesFromFiles(filePaths) {
  const names = new Set();

  for (const filePath of filePaths) {
    try {
      const sourceText = fs.readFileSync(filePath, "utf8");
      for (const name of parseEnvVariableNamesFromShellText(sourceText)) {
        names.add(name);
      }
    } catch {}
  }

  return names;
}

export function sanitizeTestEnv(baseEnv) {
  if (baseEnv.OPENCLAW_TEST_DISABLE_ENV_SANITIZER === "1") {
    return { ...baseEnv };
  }

  const nextEnv = { ...baseEnv };
  const filePaths = resolveTestEnvSanitizerFiles(baseEnv);
  const names = readShellEnvVariableNamesFromFiles(filePaths);

  for (const name of names) {
    if (CORE_ENV_VARS.has(name)) {
      continue;
    }
    delete nextEnv[name];
  }

  return nextEnv;
}

export function createTestRunnerEnv(baseEnv) {
  const sanitized = sanitizeTestEnv(baseEnv);
  const shouldIsolateHome =
    sanitized.OPENCLAW_TEST_DISABLE_RUNNER_HOME_ISOLATION !== "1" && !isLiveTestEnv(sanitized);

  if (!shouldIsolateHome) {
    return {
      env: sanitized,
      cleanup: () => {},
    };
  }

  const existingHome = sanitized.OPENCLAW_TEST_HOME?.trim();
  const home = existingHome || fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-test-runner-home-"));

  fs.mkdirSync(path.join(home, ".openclaw"), { recursive: true });

  const env = {
    ...sanitized,
    HOME: home,
    USERPROFILE: home,
    OPENCLAW_TEST_HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    XDG_STATE_HOME: path.join(home, ".local", "state"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
  };

  delete env.OPENCLAW_CONFIG_PATH;
  delete env.OPENCLAW_STATE_DIR;
  delete env.OPENCLAW_AGENT_DIR;
  delete env.PI_CODING_AGENT_DIR;

  return {
    env,
    cleanup: () => {
      if (existingHome) {
        return;
      }
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}
