import { spawn } from "node:child_process";
import path from "node:path";
import { buildCmdExeCommandLine } from "./windows-cmd-helpers.mjs";

function getPathForPlatform(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function isPnpmExecPath(value, platform) {
  return /^pnpm(?:-cli)?(?:\.(?:c?js|cmd|exe))?$/.test(
    getPathForPlatform(platform).basename(value).toLowerCase(),
  );
}

function getPnpmExecExtension(value, platform) {
  return getPathForPlatform(platform).extname(value).toLowerCase();
}

function isNodeLoadedPnpmExecPath(value, platform) {
  const extension = getPnpmExecExtension(value, platform);
  return extension === ".js" || extension === ".cjs" || extension === ".mjs";
}

export function resolvePnpmRunner(params = {}) {
  const pnpmArgs = params.pnpmArgs ?? [];
  const nodeArgs = params.nodeArgs ?? [];
  const npmExecPath = params.npmExecPath ?? process.env.npm_execpath;
  const nodeExecPath = params.nodeExecPath ?? process.execPath;
  const platform = params.platform ?? process.platform;
  const comSpec = params.comSpec ?? process.env.ComSpec ?? "cmd.exe";

  if (
    typeof npmExecPath === "string" &&
    npmExecPath.length > 0 &&
    isPnpmExecPath(npmExecPath, platform)
  ) {
    if (isNodeLoadedPnpmExecPath(npmExecPath, platform)) {
      return {
        command: nodeExecPath,
        args: [...nodeArgs, npmExecPath, ...pnpmArgs],
        shell: false,
      };
    }

    if (platform === "win32" && getPnpmExecExtension(npmExecPath, platform) === ".cmd") {
      return {
        command: comSpec,
        args: ["/d", "/s", "/c", buildCmdExeCommandLine(npmExecPath, pnpmArgs)],
        shell: false,
        windowsVerbatimArguments: true,
      };
    }

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
