import { execFileSync } from "node:child_process";
import { BUNDLED_PLUGIN_PATH_PREFIX, BUNDLED_PLUGIN_ROOT_DIR } from "./bundled-plugin-paths.mjs";

export function listTrackedBundledPluginDirs(rootDir) {
  try {
    const output = execFileSync(
      "git",
      ["-C", rootDir, "ls-files", "-z", "--", BUNDLED_PLUGIN_ROOT_DIR],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const trackedDirs = new Set();
    for (const entry of output.split("\0")) {
      if (!entry.startsWith(BUNDLED_PLUGIN_PATH_PREFIX)) {
        continue;
      }
      const [dirName] = entry.slice(BUNDLED_PLUGIN_PATH_PREFIX.length).split("/", 1);
      if (dirName) {
        trackedDirs.add(dirName);
      }
    }
    return trackedDirs;
  } catch {
    return null;
  }
}
