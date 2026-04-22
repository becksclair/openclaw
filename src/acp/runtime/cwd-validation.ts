import fs from "node:fs";
import path from "node:path";
import { isNotFoundPathError } from "../../infra/path-guards.js";

const WINDOWS_ABS_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_PATH_PATTERN = /^\\\\[^\\]+\\[^\\]+/;

export type AcpRuntimeCwdValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_absolute" | "missing" | "not_directory" | "inaccessible";
      message: string;
    };

export function isAbsoluteAcpRuntimeCwd(value: string): boolean {
  return (
    path.isAbsolute(value) ||
    WINDOWS_ABS_PATH_PATTERN.test(value) ||
    WINDOWS_UNC_PATH_PATTERN.test(value)
  );
}

export function validateAcpRuntimeCwd(cwd: string): AcpRuntimeCwdValidationResult {
  const normalized = cwd.trim();
  if (!normalized) {
    return {
      ok: false,
      reason: "not_absolute",
      message: "ACP working directory must not be empty.",
    };
  }
  if (!isAbsoluteAcpRuntimeCwd(normalized)) {
    return {
      ok: false,
      reason: "not_absolute",
      message: "ACP working directory must be an absolute local path.",
    };
  }
  try {
    const stats = fs.statSync(normalized);
    if (!stats.isDirectory()) {
      return {
        ok: false,
        reason: "not_directory",
        message: `ACP working directory must point to a local directory: ${normalized}`,
      };
    }
    return { ok: true };
  } catch (error) {
    if (isNotFoundPathError(error)) {
      return {
        ok: false,
        reason: "missing",
        message: `ACP working directory must exist on the current host: ${normalized}`,
      };
    }
    const suffix = error instanceof Error && error.message ? ` (${error.message})` : "";
    return {
      ok: false,
      reason: "inaccessible",
      message: `ACP working directory is not accessible on the current host: ${normalized}${suffix}`,
    };
  }
}
