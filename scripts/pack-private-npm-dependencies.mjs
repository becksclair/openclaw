#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;

export const PRIVATE_DEPENDENCY_SOURCES = Object.freeze({
  "@openclaw/ai": "packages/ai",
  "@openclaw/fs-safe": "node_modules/@openclaw/fs-safe",
  "@openclaw/proxyline": "node_modules/@openclaw/proxyline",
});

function fail(message) {
  throw new Error(message);
}

export function collectPrivateDependencyPlan({ rootManifest, readSourceManifest, sources }) {
  const dependencies = rootManifest?.dependencies;
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
    fail("root package.json is missing dependencies");
  }

  const names = Object.keys(dependencies)
    .filter((name) => name.startsWith("@openclaw/"))
    .toSorted();
  const configuredNames = Object.keys(sources).toSorted();
  const missingSources = names.filter((name) => typeof sources[name] !== "string");
  const staleSources = configuredNames.filter((name) => !names.includes(name));
  if (missingSources.length > 0 || staleSources.length > 0) {
    fail(
      `private dependency source map mismatch: missing=${missingSources.join(",") || "none"} stale=${staleSources.join(",") || "none"}`,
    );
  }

  return names.map((name) => {
    const source = sources[name];
    const manifest = readSourceManifest(source);
    if (manifest?.name !== name) {
      fail(
        `private dependency source ${source} names ${String(manifest?.name)} instead of ${name}`,
      );
    }
    if (typeof manifest.version !== "string" || !EXACT_VERSION_PATTERN.test(manifest.version)) {
      fail(`private dependency ${name} has invalid source version ${String(manifest.version)}`);
    }
    const dependencySpec = dependencies[name];
    const workspace = typeof dependencySpec === "string" && dependencySpec.startsWith("workspace:");
    if (typeof dependencySpec !== "string" || (!workspace && dependencySpec !== manifest.version)) {
      fail(
        `private dependency ${name} source version ${manifest.version} does not match root dependency ${String(dependencySpec)}`,
      );
    }
    return { name, sourceVersion: manifest.version, source, workspace };
  });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function readPrivateDependencyPlan(rootDir = ROOT_DIR) {
  return collectPrivateDependencyPlan({
    rootManifest: readJson(path.join(rootDir, "package.json")),
    sources: PRIVATE_DEPENDENCY_SOURCES,
    readSourceManifest: (source) => readJson(path.join(rootDir, source, "package.json")),
  });
}

function readPackedManifest(tarball) {
  const result = spawnSync("tar", ["-xOf", tarball, "package/package.json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fail(
      `failed to read packed dependency manifest from ${tarball}: ${result.stderr || result.status}`,
    );
  }
  return JSON.parse(result.stdout);
}

export function resolvePrivateDependencyVersion(sourceVersion, workspace, runId) {
  if (!workspace) {
    return sourceVersion;
  }
  if (!/^\d+$/u.test(runId)) {
    fail(`private dependency run id must contain only digits: ${runId}`);
  }
  return sourceVersion.includes("-")
    ? `${sourceVersion}.private.${runId}`
    : `${sourceVersion}-private.${runId}`;
}

function preparePackageSource({ rootDir, source, version, sourceVersion }) {
  const sourceDir = path.join(rootDir, source);
  if (version === sourceVersion) {
    return { sourceDir, cleanup: () => {} };
  }
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-private-dependency-"));
  const stagingDir = path.join(stagingRoot, "package");
  fs.cpSync(sourceDir, stagingDir, { recursive: true });
  const packagePath = path.join(stagingDir, "package.json");
  const packageManifest = readJson(packagePath);
  packageManifest.version = version;
  fs.writeFileSync(packagePath, `${JSON.stringify(packageManifest, null, 2)}\n`);
  const shrinkwrapPath = path.join(stagingDir, "npm-shrinkwrap.json");
  if (fs.existsSync(shrinkwrapPath)) {
    const shrinkwrap = readJson(shrinkwrapPath);
    shrinkwrap.version = version;
    if (shrinkwrap.packages?.[""]) {
      shrinkwrap.packages[""].version = version;
    }
    fs.writeFileSync(shrinkwrapPath, `${JSON.stringify(shrinkwrap, null, 2)}\n`);
  }
  return {
    sourceDir: stagingDir,
    cleanup: () => fs.rmSync(stagingRoot, { recursive: true, force: true }),
  };
}

export function packPrivateDependencies({ rootDir = ROOT_DIR, outputDir, runId }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const plan = readPrivateDependencyPlan(rootDir);
  return plan.map(({ name, sourceVersion, source, workspace }) => {
    const version = resolvePrivateDependencyVersion(sourceVersion, workspace, runId);
    const prepared = preparePackageSource({ rootDir, source, version, sourceVersion });
    const before = new Set(fs.readdirSync(outputDir));
    const result = spawnSync(
      "npm",
      ["pack", "--ignore-scripts", "--silent", "--pack-destination", outputDir, prepared.sourceDir],
      {
        cwd: rootDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    prepared.cleanup();
    if (result.status !== 0) {
      fail(`npm pack failed for ${name}: ${result.stderr || result.status}`);
    }
    const created = fs
      .readdirSync(outputDir)
      .filter((entry) => entry.endsWith(".tgz") && !before.has(entry));
    if (created.length !== 1) {
      fail(`expected one tarball for ${name}, found ${created.length}`);
    }
    const tarball = path.join(outputDir, created[0]);
    const packedManifest = readPackedManifest(tarball);
    if (packedManifest.name !== name || packedManifest.version !== version) {
      fail(
        `packed dependency identity mismatch for ${name}: ${String(packedManifest.name)}@${String(packedManifest.version)}`,
      );
    }
    const integrity = `sha512-${createHash("sha512").update(fs.readFileSync(tarball)).digest("base64")}`;
    return { name, sourceVersion, version, integrity, tarball };
  });
}

export function rewriteRootPrivateDependencyVersions({ rootDir = ROOT_DIR, dependencies }) {
  const packagePath = path.join(rootDir, "package.json");
  const shrinkwrapPath = path.join(rootDir, "npm-shrinkwrap.json");
  const packageManifest = readJson(packagePath);
  const shrinkwrap = readJson(shrinkwrapPath);
  for (const { name, version } of dependencies) {
    if (typeof packageManifest.dependencies?.[name] !== "string") {
      fail(`root package.json no longer declares private dependency ${name}`);
    }
    packageManifest.dependencies[name] = version;
    if (typeof shrinkwrap.packages?.[""]?.dependencies?.[name] === "string") {
      shrinkwrap.packages[""].dependencies[name] = version;
    }
  }
  fs.writeFileSync(packagePath, `${JSON.stringify(packageManifest, null, 2)}\n`);
  fs.writeFileSync(shrinkwrapPath, `${JSON.stringify(shrinkwrap, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, argument, extra] = process.argv.slice(2);
    if (command === "pack" && argument && extra && process.argv.length === 5) {
      process.stdout.write(
        `${JSON.stringify(packPrivateDependencies({ outputDir: argument, runId: extra }))}\n`,
      );
    } else if (command === "rewrite-root" && argument && process.argv.length === 4) {
      rewriteRootPrivateDependencyVersions({ dependencies: readJson(argument) });
    } else {
      console.error(
        "Usage: node scripts/pack-private-npm-dependencies.mjs pack <output-dir> <run-id> | rewrite-root <manifest-json>",
      );
      process.exit(2);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
