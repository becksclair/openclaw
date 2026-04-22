import fs from "node:fs";
import path from "node:path";
import { listBundledPluginMetadata } from "./bundled-plugin-metadata.js";

const NON_PACKAGED_RUNTIME_SIDECAR_PLUGIN_DIRS = new Set(["qa-channel", "qa-lab", "qa-matrix"]);

function buildBundledDistArtifactPath(dirName: string, artifact: string): string {
  return ["dist", "extensions", dirName, artifact].join("/");
}

export function collectBundledRuntimeSidecarPaths(params?: {
  rootDir?: string;
  trackedDirNames?: ReadonlySet<string> | null;
}): readonly string[] {
  const rootDir = path.resolve(params?.rootDir ?? process.cwd());
  return listBundledPluginMetadata({
    rootDir,
    includeChannelConfigs: false,
  })
    .filter((entry) => params?.trackedDirNames?.has(entry.dirName) ?? true)
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
  trackedDirNames?: ReadonlySet<string> | null;
}): Promise<{ changed: boolean; jsonPath: string }> {
  const jsonPath = path.join(
    params.repoRoot,
    "scripts",
    "lib",
    "bundled-runtime-sidecar-paths.json",
  );
  const expectedJson = `${JSON.stringify(
    collectBundledRuntimeSidecarPaths({
      rootDir: params.repoRoot,
      trackedDirNames: params.trackedDirNames,
    }),
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
