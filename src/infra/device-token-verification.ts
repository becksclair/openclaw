import { normalizeDeviceAuthScopes } from "../shared/device-auth.js";
import { roleScopesAllow } from "../shared/operator-scope-compat.js";
import type { DeviceAuthToken, PairedDevice } from "./device-pairing-types.js";
import { verifyPairingToken } from "./pairing-token.js";

const DEVICE_TOKEN_LAST_USED_WRITE_INTERVAL_MS = 60_000;
const SHARED_GATEWAY_AUTH_ISSUER_KIND = "shared-gateway-auth";
const BROWSER_DEVICE_CLIENT_IDS = new Set(["openclaw-control-ui", "webchat-ui"]);
const BROWSER_DEVICE_CLIENT_MODE = "webchat";

export type DeviceTokenVerificationState = {
  pairedByDeviceId: Record<string, PairedDevice>;
};

export type VerifiedDeviceTokenState =
  | { ok: false; reason: string }
  | { ok: true; shouldPersist: false; issuer?: DeviceAuthToken["issuer"] }
  | {
      ok: true;
      shouldPersist: true;
      device: PairedDevice;
      role: string;
      entry: DeviceAuthToken;
      now: number;
    };

export function normalizeDeviceId(deviceId: string): string {
  return deviceId.trim();
}

export function normalizeRole(role: string | undefined): string | null {
  const trimmed = role?.trim();
  return trimmed ? trimmed : null;
}

export function resolveApprovedDeviceScopeBaseline(device: PairedDevice): string[] | null {
  const baseline = device.approvedScopes ?? device.scopes;
  if (!Array.isArray(baseline)) {
    return null;
  }
  return normalizeDeviceAuthScopes(baseline);
}

export function scopesWithinApprovedDeviceBaseline(params: {
  role: string;
  scopes: readonly string[];
  approvedScopes: readonly string[] | null;
}): boolean {
  if (!params.approvedScopes) {
    return false;
  }
  return roleScopesAllow({
    role: params.role,
    requestedScopes: params.scopes,
    allowedScopes: params.approvedScopes,
  });
}

function isBrowserRelatedPairedDevice(device: Pick<PairedDevice, "clientId" | "clientMode">) {
  const clientMode = device.clientMode?.trim().toLowerCase();
  if (clientMode === BROWSER_DEVICE_CLIENT_MODE) {
    return true;
  }
  const clientId = device.clientId?.trim().toLowerCase();
  return clientId ? BROWSER_DEVICE_CLIENT_IDS.has(clientId) : false;
}

export function verifyDeviceTokenAgainstState(
  state: DeviceTokenVerificationState,
  params: {
    deviceId: string;
    token: string;
    role: string;
    scopes: string[];
    requiredSharedGatewaySessionGeneration?: string;
  },
  now: number,
): VerifiedDeviceTokenState {
  const device = state.pairedByDeviceId[normalizeDeviceId(params.deviceId)];
  if (!device) {
    return { ok: false, reason: "device-not-paired" };
  }
  const role = normalizeRole(params.role);
  if (!role) {
    return { ok: false, reason: "role-missing" };
  }
  const entry = device.tokens?.[role];
  if (!entry) {
    return { ok: false, reason: "token-missing" };
  }
  if (entry.revokedAtMs) {
    return { ok: false, reason: "token-revoked" };
  }
  if (!verifyPairingToken(params.token, entry.token)) {
    return { ok: false, reason: "token-mismatch" };
  }
  if (
    entry.issuer?.kind === SHARED_GATEWAY_AUTH_ISSUER_KIND &&
    entry.issuer.generation !== params.requiredSharedGatewaySessionGeneration
  ) {
    return { ok: false, reason: "issuer-generation-stale" };
  }
  if (
    !entry.issuer &&
    params.requiredSharedGatewaySessionGeneration !== undefined &&
    isBrowserRelatedPairedDevice(device)
  ) {
    return { ok: false, reason: "legacy-browser-token" };
  }
  const approvedScopes = resolveApprovedDeviceScopeBaseline(device);
  if (
    !scopesWithinApprovedDeviceBaseline({
      role,
      scopes: entry.scopes,
      approvedScopes,
    })
  ) {
    return { ok: false, reason: "scope-mismatch" };
  }
  const requestedScopes = normalizeDeviceAuthScopes(params.scopes);
  if (!roleScopesAllow({ role, requestedScopes, allowedScopes: entry.scopes })) {
    return { ok: false, reason: "scope-mismatch" };
  }
  const lastUsedAtMs = typeof entry.lastUsedAtMs === "number" ? entry.lastUsedAtMs : 0;
  if (now < lastUsedAtMs + DEVICE_TOKEN_LAST_USED_WRITE_INTERVAL_MS) {
    return entry.issuer
      ? { ok: true, shouldPersist: false, issuer: entry.issuer }
      : { ok: true, shouldPersist: false };
  }
  return { ok: true, shouldPersist: true, device, role, entry, now };
}
