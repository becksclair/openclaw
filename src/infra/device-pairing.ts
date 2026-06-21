import { randomUUID } from "node:crypto";
import { normalizeUniqueSingleOrTrimmedStringList } from "@openclaw/normalization-core/string-normalization";
import { normalizeDeviceAuthScopes } from "../shared/device-auth.js";
import {
  resolveBootstrapProfileScopesForRole,
  resolveBootstrapProfileScopesForRoles,
  type DeviceBootstrapProfile,
} from "../shared/device-bootstrap-profile.js";
import {
  resolveMissingRequestedScope,
  resolveScopeOutsideRequestedRoles,
  roleScopesAllow,
} from "../shared/operator-scope-compat.js";
import { revokeDeviceBootstrapTokensForDevice } from "./device-bootstrap.js";
import type {
  DeviceAuthToken,
  DeviceAuthTokenSummary,
  PairedDevice,
  PairedDeviceMetadataPatch,
} from "./device-pairing-types.js";
import {
  normalizeDeviceId,
  normalizeRole,
  resolveApprovedDeviceScopeBaseline,
  scopesWithinApprovedDeviceBaseline,
  verifyDeviceTokenAgainstState,
} from "./device-token-verification.js";
import {
  createAsyncLock,
  pruneExpiredPending,
  readJsonIfExists,
  reconcilePendingPairingRequests,
  coercePairingStateRecord,
  resolvePairingPaths,
  writeJson,
} from "./pairing-files.js";
import { generatePairingToken } from "./pairing-token.js";

export type {
  DeviceAuthToken,
  DeviceAuthTokenSummary,
  PairedDevice,
  PairedDeviceMetadataPatch,
} from "./device-pairing-types.js";

export type DevicePairingPendingRequest = {
  requestId: string;
  deviceId: string;
  publicKey: string;
  displayName?: string;
  platform?: string;
  deviceFamily?: string;
  clientId?: string;
  clientMode?: string;
  role?: string;
  roles?: string[];
  scopes?: string[];
  remoteIp?: string;
  silent?: boolean;
  isRepair?: boolean;
  ts: number;
};

type DevicePairingApprovalOptions = {
  callerScopes?: readonly string[];
  accessMetadata?: Pick<
    PairedDeviceMetadataPatch,
    "displayName" | "remoteIp" | "lastSeenAtMs" | "lastSeenReason"
  >;
};

export type RotateDeviceTokenDenyReason =
  | "unknown-device-or-role"
  | "missing-approved-scope-baseline"
  | "scope-outside-approved-baseline"
  | "caller-missing-scope";

export type RotateDeviceTokenResult =
  | { ok: true; entry: DeviceAuthToken }
  | { ok: false; reason: RotateDeviceTokenDenyReason; scope?: string };

export type RevokeDeviceTokenDenyReason = "unknown-device-or-role" | "caller-missing-scope";

export type RevokeDeviceTokenResult =
  | { ok: true; entry: DeviceAuthToken }
  | { ok: false; reason: RevokeDeviceTokenDenyReason; scope?: string };

export type DevicePairingList = {
  pending: DevicePairingPendingRequest[];
  paired: PairedDevice[];
};

export type DevicePairingForbiddenReason =
  | "caller-scopes-required"
  | "caller-missing-scope"
  | "scope-outside-requested-roles"
  | "bootstrap-role-not-allowed"
  | "bootstrap-scope-not-allowed";

export type DevicePairingForbiddenResult = {
  status: "forbidden";
  reason: DevicePairingForbiddenReason;
  scope?: string;
  role?: string;
};

export type ApproveDevicePairingResult =
  | { status: "approved"; requestId: string; device: PairedDevice }
  | DevicePairingForbiddenResult
  | null;

type DevicePairingStateFile = {
  pendingById: Record<string, DevicePairingPendingRequest>;
  pairedByDeviceId: Record<string, PairedDevice>;
};

const PENDING_TTL_MS = 5 * 60 * 1000;
const OPERATOR_ROLE = "operator";
const OPERATOR_SCOPE_PREFIX = "operator.";

const withLock = createAsyncLock();

const PAIRED_DEVICE_METADATA_PATCH_FIELDS = [
  "displayName",
  "platform",
  "clientId",
  "clientMode",
  "remoteIp",
  "lastSeenAtMs",
  "lastSeenReason",
] as const satisfies readonly (keyof PairedDeviceMetadataPatch)[];

export function formatDevicePairingForbiddenMessage(result: DevicePairingForbiddenResult): string {
  switch (result.reason) {
    case "caller-scopes-required":
      return `missing scope: ${result.scope ?? "callerScopes-required"}`;
    case "caller-missing-scope":
      return `missing scope: ${result.scope ?? "unknown"}`;
    case "scope-outside-requested-roles":
      return `invalid scope for requested roles: ${result.scope ?? "unknown"}`;
    case "bootstrap-role-not-allowed":
      return `bootstrap profile does not allow role: ${result.role ?? "unknown"}`;
    case "bootstrap-scope-not-allowed":
      return `bootstrap profile does not allow scope: ${result.scope ?? "unknown"}`;
  }
  // Exhaustive over DevicePairingForbiddenReason; unreachable in practice.
  return "";
}

async function loadState(baseDir?: string): Promise<DevicePairingStateFile> {
  const { pendingPath, pairedPath } = resolvePairingPaths(baseDir, "devices");
  const [pending, paired] = await Promise.all([
    readJsonIfExists<unknown>(pendingPath),
    readJsonIfExists<unknown>(pairedPath),
  ]);
  const state: DevicePairingStateFile = {
    pendingById: coercePairingStateRecord<DevicePairingPendingRequest>(pending),
    pairedByDeviceId: coercePairingStateRecord<PairedDevice>(paired),
  };
  pruneExpiredPending(state.pendingById, Date.now(), PENDING_TTL_MS);
  return state;
}

type DevicePairingPersistTarget = "pending" | "paired" | "both";

async function persistState(
  state: DevicePairingStateFile,
  baseDir: string | undefined,
  target: DevicePairingPersistTarget,
) {
  const { pendingPath, pairedPath } = resolvePairingPaths(baseDir, "devices");
  if (target === "pending") {
    await writeJson(pendingPath, state.pendingById);
    return;
  }
  if (target === "paired") {
    await writeJson(pairedPath, state.pairedByDeviceId);
    return;
  }
  await Promise.all([
    writeJson(pendingPath, state.pendingById),
    writeJson(pairedPath, state.pairedByDeviceId),
  ]);
}

function mergeRoles(...items: Array<string | string[] | undefined>): string[] | undefined {
  const roles = new Set<string>();
  for (const item of items) {
    for (const role of normalizeUniqueSingleOrTrimmedStringList(item)) {
      roles.add(role);
    }
  }
  if (roles.size === 0) {
    return undefined;
  }
  return [...roles];
}

function listActiveTokenRoles(
  tokens: Record<string, DeviceAuthToken> | undefined,
): string[] | undefined {
  if (!tokens) {
    return undefined;
  }
  return mergeRoles(
    Object.values(tokens)
      .filter((entry) => !entry.revokedAtMs)
      .map((entry) => entry.role),
  );
}

export function listApprovedPairedDeviceRoles(
  device: Pick<PairedDevice, "role" | "roles">,
): string[] {
  // Approved roles come from the pairing record itself. This is the durable
  // contract the owner approved, independent of any currently active tokens.
  return mergeRoles(device.roles, device.role) ?? [];
}

export function listEffectivePairedDeviceRoles(
  device: Pick<PairedDevice, "role" | "roles" | "tokens">,
): string[] {
  const activeTokenRoles = listActiveTokenRoles(device.tokens);
  if (activeTokenRoles && activeTokenRoles.length > 0) {
    // Effective roles are the active token roles, bounded by the approved
    // pairing contract. A stray token entry must not grant new access.
    const approvedRoles = new Set(listApprovedPairedDeviceRoles(device));
    return activeTokenRoles.filter((role) => approvedRoles.has(role));
  }
  // Token entries are authoritative. Tokenless legacy records fail closed so
  // sticky historical role fields cannot retain access after token migration.
  return [];
}

export function hasEffectivePairedDeviceRole(
  device: Pick<PairedDevice, "role" | "roles" | "tokens">,
  role: string,
): boolean {
  const normalized = normalizeRole(role);
  if (!normalized) {
    return false;
  }
  return listEffectivePairedDeviceRoles(device).includes(normalized);
}

function mergeScopes(...items: Array<string[] | undefined>): string[] | undefined {
  const scopes = new Set<string>();
  let sawExplicitScopeList = false;
  for (const item of items) {
    if (!Array.isArray(item)) {
      continue;
    }
    sawExplicitScopeList = true;
    for (const scope of normalizeUniqueSingleOrTrimmedStringList(item)) {
      scopes.add(scope);
    }
  }
  if (scopes.size === 0) {
    return sawExplicitScopeList ? [] : undefined;
  }
  return [...scopes];
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  for (const value of left) {
    if (!rightSet.has(value)) {
      return false;
    }
  }
  return true;
}

function resolveRequestedRoles(input: { role?: string; roles?: string[] }): string[] {
  return mergeRoles(input.roles, input.role) ?? [];
}

function resolveRequestedScopes(input: { scopes?: string[] }): string[] {
  return normalizeDeviceAuthScopes(input.scopes);
}

function samePendingApprovalSnapshot(
  existing: DevicePairingPendingRequest,
  incoming: Omit<DevicePairingPendingRequest, "requestId" | "ts" | "isRepair">,
): boolean {
  if (existing.publicKey !== incoming.publicKey) {
    return false;
  }
  if (normalizeRole(existing.role) !== normalizeRole(incoming.role)) {
    return false;
  }
  if (
    !sameStringSet(resolveRequestedRoles(existing), resolveRequestedRoles(incoming)) ||
    !sameStringSet(resolveRequestedScopes(existing), resolveRequestedScopes(incoming))
  ) {
    return false;
  }
  return true;
}

function refreshPendingDevicePairingRequest(
  existing: DevicePairingPendingRequest,
  incoming: Omit<DevicePairingPendingRequest, "requestId" | "ts" | "isRepair">,
  isRepair: boolean,
): DevicePairingPendingRequest {
  return {
    ...existing,
    publicKey: incoming.publicKey,
    displayName: incoming.displayName ?? existing.displayName,
    platform: incoming.platform ?? existing.platform,
    deviceFamily: incoming.deviceFamily ?? existing.deviceFamily,
    clientId: incoming.clientId ?? existing.clientId,
    clientMode: incoming.clientMode ?? existing.clientMode,
    remoteIp: incoming.remoteIp ?? existing.remoteIp,
    // If either request is interactive, keep the pending request visible for approval.
    silent: Boolean(existing.silent && incoming.silent),
    isRepair: existing.isRepair || isRepair,
    // Preserve the original creation timestamp so that reconnects cannot bump this
    // request's queue position. Using Date.now() here would let an attacker silently
    // refresh recency and win the implicit --latest approval race.
    ts: existing.ts,
  };
}

function resolveSupersededPendingSilent(params: {
  existing: readonly DevicePairingPendingRequest[];
  incomingSilent: boolean | undefined;
}): boolean {
  return Boolean(
    params.incomingSilent && params.existing.every((pending) => pending.silent === true),
  );
}

function buildPendingDevicePairingRequest(params: {
  requestId?: string;
  deviceId: string;
  isRepair: boolean;
  req: Omit<DevicePairingPendingRequest, "requestId" | "ts" | "isRepair">;
}): DevicePairingPendingRequest {
  const role = normalizeRole(params.req.role) ?? undefined;
  return {
    requestId: params.requestId ?? randomUUID(),
    deviceId: params.deviceId,
    publicKey: params.req.publicKey,
    displayName: params.req.displayName,
    platform: params.req.platform,
    deviceFamily: params.req.deviceFamily,
    clientId: params.req.clientId,
    clientMode: params.req.clientMode,
    role,
    roles: mergeRoles(params.req.roles, role),
    scopes: mergeScopes(params.req.scopes),
    remoteIp: params.req.remoteIp,
    silent: params.req.silent,
    isRepair: params.isRepair,
    ts: Date.now(),
  };
}

function newToken() {
  return generatePairingToken();
}

function getPairedDeviceFromState(
  state: DevicePairingStateFile,
  deviceId: string,
): PairedDevice | null {
  return state.pairedByDeviceId[normalizeDeviceId(deviceId)] ?? null;
}

function cloneDeviceTokens(device: PairedDevice): Record<string, DeviceAuthToken> {
  return device.tokens ? { ...device.tokens } : {};
}

function deviceTokenIssuerMatches(
  entry: DeviceAuthToken,
  issuer: DeviceAuthToken["issuer"] | undefined,
): boolean {
  if (!issuer) {
    return !entry.issuer;
  }
  return entry.issuer?.kind === issuer.kind && entry.issuer.generation === issuer.generation;
}

function buildDeviceAuthToken(params: {
  role: string;
  scopes: string[];
  issuer?: DeviceAuthToken["issuer"];
  existing?: DeviceAuthToken;
  preserveExistingIssuer?: boolean;
  now: number;
  rotatedAtMs?: number;
}): DeviceAuthToken {
  return {
    token: newToken(),
    role: params.role,
    scopes: params.scopes,
    issuer: params.issuer ?? (params.preserveExistingIssuer ? params.existing?.issuer : undefined),
    createdAtMs: params.existing?.createdAtMs ?? params.now,
    rotatedAtMs: params.rotatedAtMs,
    revokedAtMs: undefined,
    lastUsedAtMs: params.existing?.lastUsedAtMs,
  };
}

function resolveRoleScopedDeviceTokenScopes(role: string, scopes: string[] | undefined): string[] {
  const normalized = normalizeDeviceAuthScopes(scopes);
  if (role === "operator") {
    return normalized.filter((scope) => scope.startsWith(OPERATOR_SCOPE_PREFIX));
  }
  return normalized.filter((scope) => !scope.startsWith(OPERATOR_SCOPE_PREFIX));
}

function preserveRoleScopedApprovalScopes(role: string, scopes: string[] | undefined): string[] {
  return normalizeUniqueSingleOrTrimmedStringList(scopes).filter((scope) =>
    role === OPERATOR_ROLE
      ? scope.startsWith(OPERATOR_SCOPE_PREFIX)
      : !scope.startsWith(OPERATOR_SCOPE_PREFIX),
  );
}

function resolveApprovedTokenScopes(params: {
  role: string;
  pending: DevicePairingPendingRequest;
  existingToken?: DeviceAuthToken;
  approvedScopes?: string[];
  existing?: PairedDevice;
}): string[] {
  const pendingScopes = resolveRoleScopedDeviceTokenScopes(params.role, params.pending.scopes);
  if (pendingScopes.length > 0) {
    const approvedBaseline = resolveRoleScopedDeviceTokenScopes(
      params.role,
      params.existing?.approvedScopes ?? params.existing?.scopes,
    );
    const requestedScopeDelta =
      params.existingToken && approvedBaseline.length > 0
        ? pendingScopes.filter((scope) => !approvedBaseline.includes(scope))
        : pendingScopes;
    if (requestedScopeDelta.length === 0 && params.existingToken) {
      return resolveRoleScopedDeviceTokenScopes(params.role, params.existingToken.scopes);
    }
    return resolveRoleScopedDeviceTokenScopes(
      params.role,
      mergeScopes(params.existingToken?.scopes, requestedScopeDelta),
    );
  }
  return resolveRoleScopedDeviceTokenScopes(
    params.role,
    params.existingToken?.scopes ??
      params.approvedScopes ??
      params.existing?.approvedScopes ??
      params.existing?.scopes,
  );
}

export async function listDevicePairing(baseDir?: string): Promise<DevicePairingList> {
  const state = await loadState(baseDir);
  const pending = Object.values(state.pendingById).toSorted((a, b) => b.ts - a.ts);
  const paired = Object.values(state.pairedByDeviceId).toSorted(
    (a, b) => b.approvedAtMs - a.approvedAtMs,
  );
  return { pending, paired };
}

export async function getPairedDevice(
  deviceId: string,
  baseDir?: string,
): Promise<PairedDevice | null> {
  const state = await loadState(baseDir);
  return state.pairedByDeviceId[normalizeDeviceId(deviceId)] ?? null;
}

export async function getPendingDevicePairing(
  requestId: string,
  baseDir?: string,
): Promise<DevicePairingPendingRequest | null> {
  const state = await loadState(baseDir);
  return state.pendingById[requestId] ?? null;
}

export async function requestDevicePairing(
  req: Omit<DevicePairingPendingRequest, "requestId" | "ts" | "isRepair">,
  baseDir?: string,
): Promise<{
  status: "pending";
  request: DevicePairingPendingRequest;
  created: boolean;
}> {
  return await withLock(async () => {
    const state = await loadState(baseDir);
    const deviceId = normalizeDeviceId(req.deviceId);
    if (!deviceId) {
      throw new Error("deviceId required");
    }
    const isRepair = Boolean(state.pairedByDeviceId[deviceId]);
    const pendingForDevice = Object.values(state.pendingById)
      .filter((pending) => pending.deviceId === deviceId)
      .toSorted((left, right) => right.ts - left.ts);
    return await reconcilePendingPairingRequests({
      pendingById: state.pendingById,
      existing: pendingForDevice,
      incoming: req,
      canRefreshSingle: (existing, incoming) => samePendingApprovalSnapshot(existing, incoming),
      refreshSingle: (existing, incoming) =>
        refreshPendingDevicePairingRequest(existing, incoming, isRepair),
      buildReplacement: ({ existing, incoming }) => {
        const latestPending = existing[0];
        const mergedRoles = mergeRoles(
          ...existing.flatMap((pending) => [pending.roles, pending.role]),
          incoming.roles,
          incoming.role,
        );
        const mergedScopes = mergeScopes(
          ...existing.map((pending) => pending.scopes),
          incoming.scopes,
        );
        return buildPendingDevicePairingRequest({
          deviceId,
          isRepair,
          req: {
            ...incoming,
            role: normalizeRole(incoming.role) ?? latestPending?.role,
            roles: mergedRoles,
            scopes: mergedScopes,
            // Preserve interactive visibility when superseding pending requests:
            // if any previous pending request was interactive, keep this one interactive.
            silent: resolveSupersededPendingSilent({
              existing,
              incomingSilent: incoming.silent,
            }),
          },
        });
      },
      persist: async () => await persistState(state, baseDir, "pending"),
    });
  });
}

export async function approveDevicePairing(
  requestId: string,
  baseDir?: string,
): Promise<ApproveDevicePairingResult>;
export async function approveDevicePairing(
  requestId: string,
  options: DevicePairingApprovalOptions,
  baseDir?: string,
): Promise<ApproveDevicePairingResult>;
export async function approveDevicePairing(
  requestId: string,
  optionsOrBaseDir?: DevicePairingApprovalOptions | string,
  maybeBaseDir?: string,
): Promise<ApproveDevicePairingResult> {
  const options =
    typeof optionsOrBaseDir === "string" || optionsOrBaseDir === undefined
      ? undefined
      : optionsOrBaseDir;
  const baseDir = typeof optionsOrBaseDir === "string" ? optionsOrBaseDir : maybeBaseDir;
  return await withLock(async () => {
    const state = await loadState(baseDir);
    const pending = state.pendingById[requestId];
    if (!pending) {
      return null;
    }
    const requestedRoles = mergeRoles(pending.roles, pending.role) ?? [];
    const requestedScopes = normalizeDeviceAuthScopes(pending.scopes);
    const roleMismatchScope = resolveScopeOutsideRequestedRoles({
      requestedRoles,
      requestedScopes,
    });
    if (roleMismatchScope) {
      return {
        status: "forbidden",
        reason: "scope-outside-requested-roles",
        scope: roleMismatchScope,
      };
    }
    const now = Date.now();
    const existing = state.pairedByDeviceId[pending.deviceId];
    const roles = mergeRoles(existing?.roles, existing?.role, pending.roles, pending.role);
    const approvedScopes = mergeScopes(
      existing?.approvedScopes ?? existing?.scopes,
      pending.scopes,
    );
    const tokens = existing?.tokens ? { ...existing.tokens } : {};
    const nextTokenScopesByRole = new Map<string, string[]>();
    for (const roleForToken of requestedRoles) {
      const existingToken = tokens[roleForToken];
      const nextScopes = resolveApprovedTokenScopes({
        role: roleForToken,
        pending,
        existingToken,
        approvedScopes,
        existing,
      });
      nextTokenScopesByRole.set(roleForToken, nextScopes);
      if (roleForToken === OPERATOR_ROLE && nextScopes.length > 0) {
        const callerRequiredScopes =
          mergeScopes(
            resolveRoleScopedDeviceTokenScopes(roleForToken, pending.scopes),
            nextScopes,
          ) ?? nextScopes;
        if (!options?.callerScopes) {
          return {
            status: "forbidden",
            reason: "caller-scopes-required",
            scope: callerRequiredScopes[0],
          };
        }
        const missingScope = resolveMissingRequestedScope({
          role: OPERATOR_ROLE,
          requestedScopes: callerRequiredScopes,
          allowedScopes: options.callerScopes,
        });
        if (missingScope) {
          return { status: "forbidden", reason: "caller-missing-scope", scope: missingScope };
        }
      }
    }
    for (const [roleForToken, nextScopes] of nextTokenScopesByRole) {
      const existingToken = tokens[roleForToken];
      const tokenNow = Date.now();
      tokens[roleForToken] = {
        token: newToken(),
        role: roleForToken,
        scopes: nextScopes,
        createdAtMs: existingToken?.createdAtMs ?? tokenNow,
        rotatedAtMs: existingToken ? tokenNow : undefined,
        revokedAtMs: undefined,
        lastUsedAtMs: existingToken?.lastUsedAtMs,
      };
    }
    const device: PairedDevice = {
      deviceId: pending.deviceId,
      publicKey: pending.publicKey,
      platform: pending.platform,
      deviceFamily: pending.deviceFamily,
      clientId: pending.clientId,
      clientMode: pending.clientMode,
      role: pending.role,
      roles,
      scopes: approvedScopes,
      approvedScopes,
      displayName: options?.accessMetadata?.displayName ?? pending.displayName,
      remoteIp: options?.accessMetadata?.remoteIp ?? pending.remoteIp,
      tokens,
      createdAtMs: existing?.createdAtMs ?? now,
      approvedAtMs: now,
      lastSeenAtMs: options?.accessMetadata?.lastSeenAtMs ?? existing?.lastSeenAtMs,
      lastSeenReason: options?.accessMetadata?.lastSeenReason ?? existing?.lastSeenReason,
    };
    delete state.pendingById[requestId];
    state.pairedByDeviceId[device.deviceId] = device;
    await persistState(state, baseDir, "both");
    return { status: "approved", requestId, device };
  });
}

export async function approveBootstrapDevicePairing(
  requestId: string,
  bootstrapProfile: DeviceBootstrapProfile,
  baseDir?: string,
): Promise<ApproveDevicePairingResult>;
export async function approveBootstrapDevicePairing(
  requestId: string,
  bootstrapProfile: DeviceBootstrapProfile,
  options: Pick<DevicePairingApprovalOptions, "accessMetadata">,
  baseDir?: string,
): Promise<ApproveDevicePairingResult>;
export async function approveBootstrapDevicePairing(
  requestId: string,
  bootstrapProfile: DeviceBootstrapProfile,
  optionsOrBaseDir?: Pick<DevicePairingApprovalOptions, "accessMetadata"> | string,
  maybeBaseDir?: string,
): Promise<ApproveDevicePairingResult> {
  const options =
    typeof optionsOrBaseDir === "string" || optionsOrBaseDir === undefined
      ? undefined
      : optionsOrBaseDir;
  const baseDir = typeof optionsOrBaseDir === "string" ? optionsOrBaseDir : maybeBaseDir;
  const approvedRoles = mergeRoles(bootstrapProfile.roles) ?? [];
  const approvedScopes = resolveBootstrapProfileScopesForRoles(
    approvedRoles,
    bootstrapProfile.scopes,
  );
  return await withLock(async () => {
    const state = await loadState(baseDir);
    const pending = state.pendingById[requestId];
    if (!pending) {
      return null;
    }
    const requestedRoles = resolveRequestedRoles(pending);
    const missingRole = requestedRoles.find((role) => !approvedRoles.includes(role));
    if (missingRole) {
      return { status: "forbidden", reason: "bootstrap-role-not-allowed", role: missingRole };
    }
    const requestedOperatorScopes = normalizeDeviceAuthScopes(pending.scopes).filter((scope) =>
      scope.startsWith(OPERATOR_SCOPE_PREFIX),
    );
    const missingScope = resolveMissingRequestedScope({
      role: OPERATOR_ROLE,
      requestedScopes: requestedOperatorScopes,
      allowedScopes: approvedScopes,
    });
    if (missingScope) {
      return { status: "forbidden", reason: "bootstrap-scope-not-allowed", scope: missingScope };
    }

    const now = Date.now();
    const existing = state.pairedByDeviceId[pending.deviceId];
    const grantedRoles = requestedRoles;
    const grantedScopes = resolveBootstrapProfileScopesForRoles(grantedRoles, pending.scopes ?? []);
    const grantedRoleSet = new Set(grantedRoles);
    const preservedExistingScopes = (mergeRoles(existing?.roles, existing?.role) ?? []).flatMap(
      (existingRole) =>
        grantedRoleSet.has(existingRole)
          ? []
          : preserveRoleScopedApprovalScopes(
              existingRole,
              existing?.approvedScopes ?? existing?.scopes,
            ),
    );
    const roles = mergeRoles(existing?.roles, existing?.role, pending.roles, pending.role);
    const nextApprovedScopes = mergeScopes(preservedExistingScopes, grantedScopes);
    const tokens = existing?.tokens ? { ...existing.tokens } : {};
    for (const roleForToken of grantedRoles) {
      const existingToken = tokens[roleForToken];
      const tokenScopes =
        roleForToken === OPERATOR_ROLE
          ? resolveBootstrapProfileScopesForRole(roleForToken, grantedScopes)
          : [];
      tokens[roleForToken] = buildDeviceAuthToken({
        role: roleForToken,
        scopes: tokenScopes,
        existing: existingToken,
        now,
        ...(existingToken ? { rotatedAtMs: now } : {}),
      });
    }

    const device: PairedDevice = {
      deviceId: pending.deviceId,
      publicKey: pending.publicKey,
      displayName: options?.accessMetadata?.displayName ?? pending.displayName,
      platform: pending.platform,
      deviceFamily: pending.deviceFamily,
      clientId: pending.clientId,
      clientMode: pending.clientMode,
      role: pending.role,
      roles,
      scopes: nextApprovedScopes,
      approvedScopes: nextApprovedScopes,
      remoteIp: options?.accessMetadata?.remoteIp ?? pending.remoteIp,
      tokens,
      createdAtMs: existing?.createdAtMs ?? now,
      approvedAtMs: now,
      lastSeenAtMs: options?.accessMetadata?.lastSeenAtMs ?? existing?.lastSeenAtMs,
      lastSeenReason: options?.accessMetadata?.lastSeenReason ?? existing?.lastSeenReason,
    };
    delete state.pendingById[requestId];
    state.pairedByDeviceId[device.deviceId] = device;
    await persistState(state, baseDir, "both");
    return { status: "approved", requestId, device };
  });
}

export async function rejectDevicePairing(
  requestId: string,
  baseDir?: string,
): Promise<{ requestId: string; deviceId: string } | null> {
  return await withLock(async () => {
    const state = await loadState(baseDir);
    const pending = state.pendingById[requestId];
    if (!pending) {
      return null;
    }
    delete state.pendingById[requestId];
    await persistState(state, baseDir, "pending");
    await revokeDeviceBootstrapTokensForDevice({
      deviceId: pending.deviceId,
      publicKey: pending.publicKey,
      baseDir,
    });
    return { requestId, deviceId: pending.deviceId };
  });
}

export async function removePairedDevice(
  deviceId: string,
  baseDir?: string,
): Promise<{ deviceId: string } | null> {
  return await withLock(async () => {
    const state = await loadState(baseDir);
    const normalized = normalizeDeviceId(deviceId);
    if (!normalized || !state.pairedByDeviceId[normalized]) {
      return null;
    }
    delete state.pairedByDeviceId[normalized];
    for (const [requestId, pending] of Object.entries(state.pendingById)) {
      if (pending.deviceId === normalized) {
        delete state.pendingById[requestId];
      }
    }
    await persistState(state, baseDir, "both");
    return { deviceId: normalized };
  });
}

/** Remove one approved paired-device role while preserving unrelated role tokens. */
export async function removePairedDeviceRole(params: {
  deviceId: string;
  role: string;
  baseDir?: string;
}): Promise<{ deviceId: string; role: string; removedDevice: boolean } | null> {
  return await withLock(async () => {
    const state = await loadState(params.baseDir);
    const normalizedDeviceId = normalizeDeviceId(params.deviceId);
    const role = normalizeRole(params.role);
    const device = state.pairedByDeviceId[normalizedDeviceId];
    if (!device || !role || !listApprovedPairedDeviceRoles(device).includes(role)) {
      return null;
    }

    const tokens = cloneDeviceTokens(device);
    delete tokens[role];
    const remainingRoles = listApprovedPairedDeviceRoles(device).filter((entry) => entry !== role);
    if (remainingRoles.length === 0) {
      for (const [requestId, pending] of Object.entries(state.pendingById)) {
        if (pending.deviceId === normalizedDeviceId) {
          delete state.pendingById[requestId];
        }
      }
      delete state.pairedByDeviceId[normalizedDeviceId];
      await persistState(state, params.baseDir, "both");
      return { deviceId: normalizedDeviceId, role, removedDevice: true };
    }

    for (const [requestId, pending] of Object.entries(state.pendingById)) {
      if (pending.deviceId !== normalizedDeviceId) {
        continue;
      }
      const pendingRoles = resolveRequestedRoles(pending);
      if (!pendingRoles.includes(role)) {
        continue;
      }
      const nextPendingRoles = pendingRoles.filter((entry) => entry !== role);
      if (nextPendingRoles.length === 0) {
        delete state.pendingById[requestId];
        continue;
      }
      const pendingScopes = Array.isArray(pending.scopes)
        ? mergeScopes(
            ...nextPendingRoles.map((entry) =>
              preserveRoleScopedApprovalScopes(entry, pending.scopes),
            ),
          )
        : undefined;
      state.pendingById[requestId] = {
        ...pending,
        role: nextPendingRoles[0],
        roles: nextPendingRoles,
        scopes: pendingScopes,
      };
    }

    const scopeBaseline = device.approvedScopes ?? device.scopes;
    const preservedScopes = Array.isArray(scopeBaseline)
      ? mergeScopes(
          ...remainingRoles.map((entry) => preserveRoleScopedApprovalScopes(entry, scopeBaseline)),
        )
      : undefined;
    const next: PairedDevice = {
      ...device,
      role: remainingRoles[0],
      roles: remainingRoles,
      ...(preservedScopes !== undefined
        ? { scopes: preservedScopes, approvedScopes: preservedScopes }
        : {}),
      tokens: Object.keys(tokens).length > 0 ? tokens : undefined,
    };
    state.pairedByDeviceId[normalizedDeviceId] = next;
    await persistState(state, params.baseDir, "both");
    return { deviceId: normalizedDeviceId, role, removedDevice: false };
  });
}

/** Update non-auth metadata for a paired device presence/status refresh. */
export async function updatePairedDeviceMetadata(
  deviceId: string,
  patch: Partial<PairedDeviceMetadataPatch>,
  baseDir?: string,
): Promise<boolean> {
  return await withLock(async () => {
    const state = await loadState(baseDir);
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const existing = state.pairedByDeviceId[normalizedDeviceId];
    if (!existing) {
      return false;
    }
    const nextPatch: Partial<PairedDeviceMetadataPatch> = {};
    let changed = false;
    for (const key of PAIRED_DEVICE_METADATA_PATCH_FIELDS) {
      if (key in patch && existing[key] !== patch[key]) {
        Object.assign(nextPatch, { [key]: patch[key] });
        changed = true;
      }
    }
    if (!changed) {
      return true;
    }
    state.pairedByDeviceId[normalizedDeviceId] = { ...existing, ...nextPatch };
    await persistState(state, baseDir, "paired");
    return true;
  });
}

export function summarizeDeviceTokens(
  tokens: Record<string, DeviceAuthToken> | undefined,
): DeviceAuthTokenSummary[] | undefined {
  if (!tokens) {
    return undefined;
  }
  const summaries = Object.values(tokens)
    .map((token) => ({
      role: token.role,
      scopes: token.scopes,
      createdAtMs: token.createdAtMs,
      rotatedAtMs: token.rotatedAtMs,
      revokedAtMs: token.revokedAtMs,
      lastUsedAtMs: token.lastUsedAtMs,
    }))
    .toSorted((a, b) => a.role.localeCompare(b.role));
  return summaries.length > 0 ? summaries : undefined;
}

export async function verifyDeviceToken(params: {
  deviceId: string;
  token: string;
  role: string;
  scopes: string[];
  requiredSharedGatewaySessionGeneration?: string;
  baseDir?: string;
}): Promise<{ ok: boolean; reason?: string; issuer?: DeviceAuthToken["issuer"] }> {
  const state = await loadState(params.baseDir);
  const checked = verifyDeviceTokenAgainstState(state, params, Date.now());
  if (!checked.ok) {
    return { ok: false, reason: checked.reason };
  }
  return await withLock(async () => {
    const lockedState = await loadState(params.baseDir);
    const lockedChecked = verifyDeviceTokenAgainstState(lockedState, params, Date.now());
    if (!lockedChecked.ok) {
      return { ok: false, reason: lockedChecked.reason };
    }
    if (!lockedChecked.shouldPersist) {
      return lockedChecked.issuer ? { ok: true, issuer: lockedChecked.issuer } : { ok: true };
    }
    const { device, role, entry, now } = lockedChecked;
    device.tokens = {
      ...device.tokens,
      [role]: { ...entry, lastUsedAtMs: now },
    };
    device.lastSeenAtMs = now;
    device.lastSeenReason = "device-token-auth";
    lockedState.pairedByDeviceId[device.deviceId] = device;
    await persistState(lockedState, params.baseDir, "paired");
    return entry.issuer ? { ok: true, issuer: entry.issuer } : { ok: true };
  });
}

export async function ensureDeviceToken(params: {
  deviceId: string;
  role: string;
  scopes: string[];
  issuer?: DeviceAuthToken["issuer"];
  baseDir?: string;
}): Promise<DeviceAuthToken | null> {
  return await withLock(async () => {
    const state = await loadState(params.baseDir);
    const requestedScopes = normalizeDeviceAuthScopes(params.scopes);
    const context = resolveDeviceTokenUpdateContext({
      state,
      deviceId: params.deviceId,
      role: params.role,
    });
    if (!context) {
      return null;
    }
    const { device, role, tokens, existing } = context;
    const approvedScopes = resolveApprovedDeviceScopeBaseline(device);
    if (
      !scopesWithinApprovedDeviceBaseline({
        role,
        scopes: requestedScopes,
        approvedScopes,
      })
    ) {
      return null;
    }
    if (existing && !existing.revokedAtMs) {
      const existingWithinApproved = scopesWithinApprovedDeviceBaseline({
        role,
        scopes: existing.scopes,
        approvedScopes,
      });
      const issuerAllowsReuse = deviceTokenIssuerMatches(existing, params.issuer);
      if (
        existingWithinApproved &&
        issuerAllowsReuse &&
        roleScopesAllow({ role, requestedScopes, allowedScopes: existing.scopes })
      ) {
        return existing;
      }
    }
    const now = Date.now();
    const next = buildDeviceAuthToken({
      role,
      scopes: requestedScopes,
      issuer: params.issuer,
      existing,
      now,
      rotatedAtMs: existing ? now : undefined,
    });
    tokens[role] = next;
    device.tokens = tokens;
    state.pairedByDeviceId[device.deviceId] = device;
    await persistState(state, params.baseDir, "paired");
    return next;
  });
}

function resolveDeviceTokenUpdateContext(params: {
  state: DevicePairingStateFile;
  deviceId: string;
  role: string;
}): {
  device: PairedDevice;
  role: string;
  tokens: Record<string, DeviceAuthToken>;
  existing: DeviceAuthToken | undefined;
} | null {
  const device = getPairedDeviceFromState(params.state, params.deviceId);
  if (!device) {
    return null;
  }
  const role = normalizeRole(params.role);
  if (!role) {
    return null;
  }
  // Token issuance and rotation must stay inside the role set that pairing
  // approval recorded for this device.
  if (!listApprovedPairedDeviceRoles(device).includes(role)) {
    return null;
  }
  const tokens = cloneDeviceTokens(device);
  const existing = tokens[role];
  return { device, role, tokens, existing };
}

export async function rotateDeviceToken(params: {
  deviceId: string;
  role: string;
  scopes?: string[];
  callerScopes?: readonly string[];
  baseDir?: string;
}): Promise<RotateDeviceTokenResult> {
  return await withLock(async () => {
    const state = await loadState(params.baseDir);
    const context = resolveDeviceTokenUpdateContext({
      state,
      deviceId: params.deviceId,
      role: params.role,
    });
    if (!context) {
      return { ok: false, reason: "unknown-device-or-role" };
    }
    const { device, role, tokens, existing } = context;
    const requestedScopes = normalizeDeviceAuthScopes(
      params.scopes ?? existing?.scopes ?? device.scopes,
    );
    const approvedScopes = resolveApprovedDeviceScopeBaseline(device);
    if (!approvedScopes) {
      return { ok: false, reason: "missing-approved-scope-baseline" };
    }
    if (
      !scopesWithinApprovedDeviceBaseline({
        role,
        scopes: requestedScopes,
        approvedScopes,
      })
    ) {
      return { ok: false, reason: "scope-outside-approved-baseline" };
    }
    if (params.callerScopes) {
      const missingScope = resolveMissingRequestedScope({
        role,
        requestedScopes,
        allowedScopes: params.callerScopes,
      });
      if (missingScope) {
        return { ok: false, reason: "caller-missing-scope", scope: missingScope };
      }
    }
    const now = Date.now();
    const next = buildDeviceAuthToken({
      role,
      scopes: requestedScopes,
      existing,
      preserveExistingIssuer: true,
      now,
      rotatedAtMs: now,
    });
    tokens[role] = next;
    device.tokens = tokens;
    state.pairedByDeviceId[device.deviceId] = device;
    await persistState(state, params.baseDir, "paired");
    return { ok: true, entry: next };
  });
}

export async function revokeDeviceToken(params: {
  deviceId: string;
  role: string;
  callerScopes?: readonly string[];
  baseDir?: string;
}): Promise<RevokeDeviceTokenResult> {
  return await withLock(async () => {
    const state = await loadState(params.baseDir);
    const context = resolveDeviceTokenUpdateContext({
      state,
      deviceId: params.deviceId,
      role: params.role,
    });
    if (!context || !context.existing) {
      return { ok: false, reason: "unknown-device-or-role" };
    }
    const { device, role, tokens, existing } = context;
    const targetScopes = normalizeDeviceAuthScopes(
      Array.isArray(existing.scopes) ? existing.scopes : device.scopes,
    );
    if (params.callerScopes) {
      const missingScope = resolveMissingRequestedScope({
        role,
        requestedScopes: targetScopes,
        allowedScopes: params.callerScopes,
      });
      if (missingScope) {
        return { ok: false, reason: "caller-missing-scope", scope: missingScope };
      }
    }
    const entry = { ...existing, revokedAtMs: Date.now() };
    tokens[role] = entry;
    device.tokens = tokens;
    state.pairedByDeviceId[device.deviceId] = device;
    await persistState(state, params.baseDir, "paired");
    return { ok: true, entry };
  });
}
