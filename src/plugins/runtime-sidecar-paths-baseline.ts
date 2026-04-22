import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { listBundledPluginMetadata } from "./bundled-plugin-metadata.js";

const NON_PACKAGED_RUNTIME_SIDECAR_PLUGIN_DIRS = new Set(["qa-channel", "qa-lab", "qa-matrix"]);

const trackedBundledPluginDirCache = new Map<string, ReadonlySet<string> | null>();

function buildBundledDistArtifactPath(dirName: string, artifact: string): string {
  return ["dist", "extensions", dirName, artifact].join("/");
}

function listTrackedBundledPluginDirs(rootDir: string): ReadonlySet<string> | null {
  const normalizedRoot = path.resolve(rootDir);
  if (trackedBundledPluginDirCache.has(normalizedRoot)) {
    return trackedBundledPluginDirCache.get(normalizedRoot) ?? null;
  }
  try {
    const output = execFileSync(
      "git",
      ["-C", normalizedRoot, "ls-files", "-z", "--", "extensions"],
      {
        encoding: "utf8",
      },
    );
    const trackedDirs = new Set<string>();
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
    trackedBundledPluginDirCache.set(normalizedRoot, trackedDirs);
    return trackedDirs;
  } catch {
    trackedBundledPluginDirCache.set(normalizedRoot, null);
    return null;
  }
}

export function collectBundledRuntimeSidecarPaths(params?: {
  rootDir?: string;
}): readonly string[] {
  const rootDir = path.resolve(params?.rootDir ?? process.cwd());
  const trackedDirs = listTrackedBundledPluginDirs(rootDir);
  return listBundledPluginMetadata({
    rootDir,
    includeChannelConfigs: false,
  })
    .filter((entry) => trackedDirs?.has(entry.dirName) ?? true)
    .filter((entry) => !NON_PACKAGED_RUNTIME_SIDECAR_PLUGIN_DIRS.has(entry.dirName))
    .flatMap((entry) =>
      (entry.runtimeSidecarArtifacts ?? []).map((artifact) =>
        buildBundledDistArtifactPath(entry.dirName, artifact),
      ),
    )
    .toSorted((left, right) => left.localeCompare(right));
}

export async function writeBundledRuntimeSidecarPathBaseline(params: {
  repoRoot: string;
  check: boolean;
}): Promise<{ changed: boolean; jsonPath: string }> {
  const jsonPath = path.join(
    params.repoRoot,
    "scripts",
    "lib",
    "bundled-runtime-sidecar-paths.json",
  );
  const expectedJson = `${JSON.stringify(
    collectBundledRuntimeSidecarPaths({ rootDir: params.repoRoot }),
    null,
    2,
  )}\n`;
  const currentJson = fs.existsSync(jsonPath) ? fs.readFileSync(jsonPath, "utf8") : "";
  const changed = currentJson !== expectedJson;

  if (!params.check && changed) {
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, expectedJson, "utf8");
  }

  return { changed, jsonPath };
}
