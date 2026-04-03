import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const isLocalCheckEnabled = (env) => {
  const raw = env.OPENCLAW_LOCAL_CHECK?.trim().toLowerCase();
  return raw !== "0" && raw !== "false";
};

const args = process.argv.slice(2);
const env = { ...process.env };
const finalArgs = [...args];
const separatorIndex = finalArgs.indexOf("--");
const require = createRequire(import.meta.url);

const insertBeforeSeparator = (...items) => {
  const index = separatorIndex === -1 ? finalArgs.length : separatorIndex;
  finalArgs.splice(index, 0, ...items);
};

if (isLocalCheckEnabled(env) && !finalArgs.includes("--singleThreaded")) {
  insertBeforeSeparator("--singleThreaded");
  if (!env.GOGC) {
    env.GOGC = "30";
  }
}

const resolveTsgoPath = () => {
  if (process.platform === "win32") {
    return path.resolve("node_modules", ".bin", "tsgo");
  }

  const packageName = `@typescript/native-preview-${process.platform}-${process.arch}`;
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    return path.join(path.dirname(packageJsonPath), "lib", "tsgo");
  } catch {
    return path.resolve("node_modules", ".bin", "tsgo");
  }
};

const ensureExecutable = (filePath) => {
  if (process.platform === "win32" || !fs.existsSync(filePath)) {
    return;
  }
  const stats = fs.statSync(filePath);
  const nextMode = stats.mode | 0o111;
  if ((stats.mode & 0o111) !== 0o111) {
    fs.chmodSync(filePath, nextMode);
  }
};

const tsgoPath = resolveTsgoPath();
ensureExecutable(tsgoPath);

const result = spawnSync(tsgoPath, finalArgs, {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
