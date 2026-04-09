import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildCmdExeCommandLine } from "./windows-cmd-helpers.mjs";

function isPnpmExecPath(value) {
  return /^pnpm(?:-cli)?(?:\.(?:c?js|cmd|exe))?$/.test(path.basename(value).toLowerCase());
}

function isJavaScriptFile(filePath) {
  // Check if file starts with hashbang or is a .js/.cjs file
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".js" || ext === ".cjs") {
    return true;
  }
  if (ext === ".exe" || ext === ".cmd") {
    return false;
  }
  // For extensionless files, check for hashbang
  try {
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(2);
    fs.readSync(fd, buffer, 0, 2, 0);
    fs.closeSync(fd);
    // If starts with #! it's a script, if starts with ELF it's a binary
    return buffer[0] === 0x23 && buffer[1] === 0x21; // #!
  } catch {
    return false;
  }
}

export function resolvePnpmRunner(params = {}) {
  const pnpmArgs = params.pnpmArgs ?? [];
  const nodeArgs = params.nodeArgs ?? [];
  const npmExecPath = params.npmExecPath ?? process.env.npm_execpath;
  const nodeExecPath = params.nodeExecPath ?? process.execPath;
  const platform = params.platform ?? process.platform;
  const comSpec = params.comSpec ?? process.env.ComSpec ?? "cmd.exe";

  if (typeof npmExecPath === "string" && npmExecPath.length > 0 && isPnpmExecPath(npmExecPath)) {
    // Only run through node if it's actually a JS file (has hashbang or .js/.cjs ext)
    // Standalone pnpm binaries (ELF/PE) should be executed directly
    if (isJavaScriptFile(npmExecPath)) {
      return {
        command: nodeExecPath,
        args: [...nodeArgs, npmExecPath, ...pnpmArgs],
        shell: false,
      };
    }
    // Binary executable - run directly
    return {
      command: npmExecPath,
      args: pnpmArgs,
      shell: false,
    };
  }

  if (platform === "win32") {
    return {
      command: comSpec,
      args: ["/d", "/s", "/c", buildCmdExeCommandLine("pnpm.cmd", pnpmArgs)],
      shell: false,
      windowsVerbatimArguments: true,
    };
  }

  return {
    command: "pnpm",
    args: pnpmArgs,
    shell: false,
  };
}

export function createPnpmRunnerSpawnSpec(params = {}) {
  const runner = resolvePnpmRunner(params);
  return {
    command: runner.command,
    args: runner.args,
    options: {
      cwd: params.cwd,
      detached: params.detached,
      stdio: params.stdio ?? "inherit",
      env: params.env ?? runner.env ?? process.env,
      shell: runner.shell,
      windowsVerbatimArguments: runner.windowsVerbatimArguments,
    },
  };
}

export function spawnPnpmRunner(params = {}) {
  const spawnSpec = createPnpmRunnerSpawnSpec(params);
  return spawn(spawnSpec.command, spawnSpec.args, spawnSpec.options);
}
