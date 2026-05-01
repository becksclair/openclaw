import { execFileSync } from "node:child_process";

export function listTrackedBundledPluginDirs(rootDir) {
  try {
    const output = execFileSync("git", ["-C", rootDir, "ls-files", "-z", "--", "extensions"], {
      encoding: "utf8",
    });
    const trackedDirs = new Set();
    for (const entry of output.split("\0")) {
      const normalized = entry.trim();
      if (!normalized.startsWith("extensions/")) {
        continue;
      }
      const [, dirName] = normalized.split("/", 3);
      if (dirName) {
        trackedDirs.add(dirName);
      }
    }
    return trackedDirs;
  } catch {
    return null;
  }
}
