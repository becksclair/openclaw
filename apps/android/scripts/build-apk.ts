#!/usr/bin/env bun

import { $ } from "bun";
import { access, mkdir, readdir } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const androidDir = join(scriptDir, "..");
const outputRootDir = join(androidDir, "build", "apks");

type BuildType = "debug" | "release";
type Flavor = "play" | "third-party";

type Variant = {
  flavor: Flavor;
  gradleName: "Play" | "ThirdParty";
  outputDirName: "play" | "third-party";
  artifactFileName: string;
};

const variants: Variant[] = [
  {
    flavor: "play",
    gradleName: "Play",
    outputDirName: "play",
    artifactFileName: "app-play-release.apk",
  },
  {
    flavor: "third-party",
    gradleName: "ThirdParty",
    outputDirName: "third-party",
    artifactFileName: "app-thirdParty-release.apk",
  },
];

function printUsage(): never {
  console.error(
    [
      "Usage: bun apps/android/scripts/build-apk.ts [--build-type debug|release] [--flavor play|third-party|both]",
      "",
      "Defaults:",
      "  --build-type debug",
      "  --flavor play",
      "",
      "Examples:",
      "  bun apps/android/scripts/build-apk.ts",
      "  bun apps/android/scripts/build-apk.ts --build-type debug --flavor third-party",
      "  bun apps/android/scripts/build-apk.ts --build-type release --flavor third-party",
      "  bun apps/android/scripts/build-apk.ts --build-type release --flavor both",
    ].join("\n"),
  );
  process.exit(1);
}

function parseArgs(argv: string[]): { buildType: BuildType; selectedVariants: Variant[] } {
  let buildType: BuildType = "debug";
  let flavorArg = "play";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printUsage();
    }

    if (arg === "--build-type") {
      buildType = parseBuildType(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith("--build-type=")) {
      buildType = parseBuildType(arg.slice("--build-type=".length));
      continue;
    }

    if (arg === "--flavor") {
      flavorArg = parseFlavorArg(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith("--flavor=")) {
      flavorArg = parseFlavorArg(arg.slice("--flavor=".length));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  const selectedVariants =
    flavorArg === "both" ? variants : [resolveVariant(parseFlavorArg(flavorArg) as Flavor)];

  return { buildType, selectedVariants };
}

function parseBuildType(value: string | undefined): BuildType {
  if (value === "debug" || value === "release") {
    return value;
  }
  throw new Error(`Invalid --build-type value: ${value ?? "<missing>"}`);
}

function parseFlavorArg(value: string | undefined): Flavor | "both" {
  if (!value) {
    throw new Error("Missing --flavor value");
  }

  const normalized = value.toLowerCase();
  if (normalized === "play") {
    return "play";
  }
  if (normalized === "third-party" || normalized === "thirdparty") {
    return "third-party";
  }
  if (normalized === "both") {
    return "both";
  }

  throw new Error(`Invalid --flavor value: ${value}`);
}

function resolveVariant(flavor: Flavor): Variant {
  const variant = variants.find((entry) => entry.flavor === flavor);
  if (!variant) {
    throw new Error(`Unsupported flavor: ${flavor}`);
  }
  return variant;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function detectAndroidSdkRoot(): Promise<string | undefined> {
  const candidates = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    join(process.env.HOME ?? "", "Android", "Sdk"),
    join(process.env.HOME ?? "", "Library", "Android", "sdk"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (await pathExists(join(candidate, "platform-tools", "adb"))) {
      return candidate;
    }
  }

  return candidates[0];
}

async function sha256Hex(path: string): Promise<string> {
  const buffer = await Bun.file(path).arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyReleaseApkSignature(androidSdkRoot: string, path: string): Promise<void> {
  const buildToolsRoot = join(androidSdkRoot, "build-tools");
  const buildToolsDirs = (await readdir(buildToolsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
  const newestBuildTools = buildToolsDirs.at(-1);
  if (!newestBuildTools) {
    throw new Error(`No Android build-tools found under ${androidSdkRoot}`);
  }

  const apksignerPath = join(buildToolsRoot, newestBuildTools, "apksigner");
  await $`${apksignerPath} verify --print-certs ${path}`.quiet();
}

function resolveGradleTask(variant: Variant, buildType: BuildType): string {
  const capitalizedBuildType = buildType[0].toUpperCase() + buildType.slice(1);
  return `:app:assemble${variant.gradleName}${capitalizedBuildType}`;
}

async function resolveSourceApkPath(variant: Variant, buildType: BuildType): Promise<string> {
  const variantDir = join(
    androidDir,
    "app",
    "build",
    "outputs",
    "apk",
    variant.gradleName === "ThirdParty" ? "thirdParty" : "play",
    buildType,
  );

  const entries = (await readdir(variantDir)).filter((entry) => entry.endsWith(".apk")).toSorted();
  if (entries.length !== 1) {
    throw new Error(
      `Expected exactly one APK in ${variantDir}, found ${entries.length}: ${entries.join(", ") || "<none>"}`,
    );
  }

  return join(variantDir, entries[0]);
}

async function main() {
  const { buildType, selectedVariants } = parseArgs(process.argv.slice(2));
  const androidSdkRoot = await detectAndroidSdkRoot();

  if (!androidSdkRoot) {
    throw new Error("Could not determine ANDROID_SDK_ROOT. Set ANDROID_SDK_ROOT or ANDROID_HOME.");
  }

  process.env.ANDROID_SDK_ROOT = androidSdkRoot;
  process.env.ANDROID_HOME = androidSdkRoot;
  process.env.PATH = [
    join(androidSdkRoot, "platform-tools"),
    join(androidSdkRoot, "cmdline-tools", "latest", "bin"),
    process.env.PATH ?? "",
  ].join(":");

  const outputDir = join(outputRootDir, buildType);
  await mkdir(outputDir, { recursive: true });

  const gradleTasks = selectedVariants.map((variant) => resolveGradleTask(variant, buildType));
  console.log(`ANDROID_SDK_ROOT=${androidSdkRoot}`);
  console.log(`Gradle tasks: ${gradleTasks.join(", ")}`);

  await $`./gradlew ${gradleTasks}`.cwd(androidDir);

  for (const variant of selectedVariants) {
    const sourcePath = await resolveSourceApkPath(variant, buildType);
    const sourceFile = Bun.file(sourcePath);
    if (!(await sourceFile.exists())) {
      throw new Error(`Built APK missing at ${sourcePath}`);
    }

    const destinationPath = join(outputDir, `openclaw-${variant.outputDirName}-${buildType}.apk`);
    await Bun.write(destinationPath, sourceFile);

    if (buildType === "release") {
      await verifyReleaseApkSignature(androidSdkRoot, destinationPath);
    }

    const hash = await sha256Hex(destinationPath);
    console.log(`APK (${variant.outputDirName}, ${buildType}): ${destinationPath}`);
    console.log(`SHA-256 (${variant.outputDirName}, ${buildType}): ${hash}`);
  }
}

await main();
