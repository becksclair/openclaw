import type { NodeListNode } from "../../../../src/shared/node-list-types.js";
import { loadOrCreateDeviceIdentity } from "../device-identity.ts";
import type { GatewayBrowserClient, GatewayEventFrame, GatewayHelloOk } from "../gateway.ts";
import { generateUUID } from "../uuid.ts";

const NODE_ID_STORAGE_KEY = "openclaw.desktop.node-id.v1";
const PRESENCE_INTERVAL_MS = 180_000;

type PresenceEntry = {
  deviceFamily?: string;
  deviceId?: string;
  host?: string;
  instanceId?: string;
  ip?: string;
  lastInputSeconds?: number;
  mode?: string;
  modelIdentifier?: string;
  platform?: string;
  reason?: string;
  roles?: string[];
  scopes?: string[];
  text?: string;
  ts?: number;
  version?: string;
};

export type DesktopNodeIdentity = {
  deviceFamily: string;
  displayName: string;
  nodeId: string;
  platform: string;
  uiVersion: string;
};

export type DesktopPairingRequest = {
  requestId: string;
  deviceId: string;
  displayName?: string;
  platform?: string;
  role?: string;
  roles?: string[];
  scopes?: string[];
  remoteIp?: string;
  isRepair?: boolean;
  ts: number;
};

export type DesktopNodeState = {
  identity: DesktopNodeIdentity;
  invokeLoading: boolean;
  invokeResult: { action: string; ok: boolean; payload: unknown } | null;
  knownNodes: NodeListNode[];
  lastError: string | null;
  lastPairRequestId: string | null;
  localPresence: PresenceEntry | null;
  nodesLoading: boolean;
  pairStatus: "idle" | "pending" | "paired" | "error";
  pendingRequests: DesktopPairingRequest[];
  pairingLoading: boolean;
  selectedNodeId: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function detectDeviceFamily(): string {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform.toLowerCase();
  if (platform.includes("mac")) {
    return "Mac";
  }
  if (platform.includes("win")) {
    return "Windows";
  }
  if (platform.includes("linux")) {
    return "Linux";
  }
  return platform || "Desktop";
}

function detectPlatform(): string {
  if (typeof navigator === "undefined") {
    return "desktop";
  }
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes("linux")) {
    return `linux ${navigator.platform}`.trim();
  }
  if (userAgent.includes("mac os x")) {
    return `macos ${navigator.platform}`.trim();
  }
  if (userAgent.includes("windows")) {
    return `windows ${navigator.platform}`.trim();
  }
  return navigator.platform || "desktop";
}

function loadOrCreateNodeId(): string {
  if (typeof window === "undefined") {
    return generateUUID();
  }
  try {
    const existing = window.localStorage.getItem(NODE_ID_STORAGE_KEY)?.trim();
    if (existing) {
      return existing;
    }
    const created = generateUUID();
    window.localStorage.setItem(NODE_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return generateUUID();
  }
}

export function createDesktopNodeIdentity(): DesktopNodeIdentity {
  return {
    deviceFamily: detectDeviceFamily(),
    displayName: `OpenClaw Desktop (${detectDeviceFamily()})`,
    nodeId: loadOrCreateNodeId(),
    platform: detectPlatform(),
    uiVersion: "desktop-dev",
  };
}

export async function resolveDesktopNodeIdentity(): Promise<DesktopNodeIdentity> {
  const identity = createDesktopNodeIdentity();
  try {
    const deviceIdentity = await loadOrCreateDeviceIdentity();
    return { ...identity, nodeId: deviceIdentity.deviceId };
  } catch {
    return identity;
  }
}

export function createDesktopNodeState(identity: DesktopNodeIdentity): DesktopNodeState {
  return {
    identity,
    invokeLoading: false,
    invokeResult: null,
    knownNodes: [],
    lastError: null,
    lastPairRequestId: null,
    localPresence: null,
    nodesLoading: false,
    pairStatus: "idle",
    pendingRequests: [],
    pairingLoading: false,
    selectedNodeId: identity.nodeId,
  };
}

function normalizeNodeList(nodes: unknown): NodeListNode[] {
  return Array.isArray(nodes)
    ? nodes.filter((entry): entry is NodeListNode => isRecord(entry))
    : [];
}

function normalizePresenceEntries(value: unknown): PresenceEntry[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is PresenceEntry => isRecord(entry))
    : [];
}

function normalizePendingRequests(value: unknown): DesktopPairingRequest[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is DesktopPairingRequest => isRecord(entry))
    : [];
}

export function hydrateNodePresenceFromHello(
  state: DesktopNodeState,
  hello: GatewayHelloOk | null,
): void {
  if (!hello || !isRecord(hello.snapshot)) {
    return;
  }
  const snapshot = hello.snapshot as { presence?: unknown };
  const entries = normalizePresenceEntries(snapshot.presence);
  state.localPresence =
    entries.find(
      (entry) =>
        entry.deviceId === state.identity.nodeId || entry.instanceId === state.identity.nodeId,
    ) ?? null;
}

export async function loadDesktopNodes(
  client: GatewayBrowserClient,
  state: DesktopNodeState,
): Promise<void> {
  state.nodesLoading = true;
  state.lastError = null;
  try {
    const result = await client.request<{ nodes?: unknown }>("node.list", {});
    state.knownNodes = normalizeNodeList(result.nodes);
    const localNode =
      state.knownNodes.find((entry) => entry.nodeId === state.identity.nodeId) ?? null;
    if (
      !state.selectedNodeId ||
      !state.knownNodes.some((entry) => entry.nodeId === state.selectedNodeId)
    ) {
      state.selectedNodeId =
        localNode?.nodeId ?? state.knownNodes[0]?.nodeId ?? state.identity.nodeId;
    }
    if (localNode?.paired) {
      state.pairStatus = "paired";
    } else if (state.lastPairRequestId) {
      state.pairStatus = "pending";
    }
  } catch (err) {
    state.lastError = String(err);
    state.knownNodes = [];
    state.pairStatus = "error";
  } finally {
    state.nodesLoading = false;
  }
}

export async function loadDesktopPairingRequests(
  client: GatewayBrowserClient,
  state: DesktopNodeState,
): Promise<void> {
  state.pairingLoading = true;
  state.lastError = null;
  try {
    const result = await client.request<{ pending?: unknown }>("device.pair.list", {});
    state.pendingRequests = normalizePendingRequests(result.pending);
  } catch (err) {
    state.lastError = String(err);
    state.pendingRequests = [];
  } finally {
    state.pairingLoading = false;
  }
}

export async function approveDesktopNodePairing(
  client: GatewayBrowserClient,
  state: DesktopNodeState,
  requestId: string,
): Promise<void> {
  state.pairingLoading = true;
  state.lastError = null;
  try {
    await client.request("device.pair.approve", { requestId });
    state.pendingRequests = state.pendingRequests.filter(
      (request) => request.requestId !== requestId,
    );
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.pairingLoading = false;
  }
}

export async function rejectDesktopNodePairing(
  client: GatewayBrowserClient,
  state: DesktopNodeState,
  requestId: string,
): Promise<void> {
  state.pairingLoading = true;
  state.lastError = null;
  try {
    await client.request("device.pair.reject", { requestId });
    state.pendingRequests = state.pendingRequests.filter(
      (request) => request.requestId !== requestId,
    );
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.pairingLoading = false;
  }
}

export async function invokeDesktopNodeCommand(
  client: GatewayBrowserClient,
  state: DesktopNodeState,
  params: {
    action: "device.info" | "device.status" | "system.notify";
    nodeId?: string;
  },
): Promise<void> {
  const nodeId = params.nodeId ?? state.selectedNodeId;
  if (!nodeId) {
    state.lastError = "No node selected";
    return;
  }
  state.invokeLoading = true;
  state.lastError = null;
  try {
    const result = await client.request<{ payload?: unknown }>("node.invoke", {
      nodeId,
      command: params.action,
      params:
        params.action === "system.notify"
          ? {
              title: "OpenClaw Desktop",
              body: "Desktop node command surface is alive.",
              delivery: "auto",
            }
          : {},
      idempotencyKey: generateUUID(),
    });
    state.invokeResult = {
      action: params.action,
      ok: true,
      payload: result.payload ?? { ok: true },
    };
  } catch (err) {
    state.lastError = String(err);
    state.invokeResult = {
      action: params.action,
      ok: false,
      payload: String(err),
    };
  } finally {
    state.invokeLoading = false;
  }
}

function normalizeInvokeParams(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }
  return value;
}

function parseInvokeParamsJson(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return normalizeInvokeParams(parsed);
  } catch {
    return {};
  }
}

export async function executeDesktopNodeInvoke(
  state: DesktopNodeState,
  payload: { command?: unknown; paramsJSON?: unknown },
): Promise<
  { ok: true; payload?: unknown } | { ok: false; error: { code: string; message: string } }
> {
  const command = typeof payload.command === "string" ? payload.command.trim() : "";
  const params = parseInvokeParamsJson(payload.paramsJSON);

  if (command === "device.info") {
    return {
      ok: true,
      payload: {
        nodeId: state.identity.nodeId,
        displayName: state.identity.displayName,
        platform: state.identity.platform,
        deviceFamily: state.identity.deviceFamily,
        uiVersion: state.identity.uiVersion,
      },
    };
  }

  if (command === "device.status") {
    return {
      ok: true,
      payload: {
        pairStatus: state.pairStatus,
        pendingPairingRequests: state.pendingRequests.length,
        lastPresenceReason: state.localPresence?.reason ?? null,
        selectedNodeId: state.selectedNodeId,
      },
    };
  }

  if (command === "system.notify") {
    const title = typeof params.title === "string" ? params.title : "OpenClaw Desktop";
    const body = typeof params.body === "string" ? params.body : "";
    if (typeof Notification === "undefined") {
      return {
        ok: false,
        error: { code: "UNAVAILABLE", message: "Notifications API unavailable" },
      };
    }
    if (Notification.permission !== "granted") {
      return {
        ok: false,
        error: { code: "NOT_ALLOWED", message: "Notifications permission not granted" },
      };
    }
    new Notification(title, { body });
    return { ok: true, payload: { delivered: true } };
  }

  return {
    ok: false,
    error: { code: "UNAVAILABLE", message: `Unsupported node command: ${command || "unknown"}` },
  };
}

export function applyDesktopNodeEvent(state: DesktopNodeState, event: GatewayEventFrame): boolean {
  if (event.event === "presence" && isRecord(event.payload)) {
    const payload = event.payload as { presence?: unknown };
    const entries = normalizePresenceEntries(payload.presence);
    state.localPresence =
      entries.find(
        (entry) =>
          entry.deviceId === state.identity.nodeId || entry.instanceId === state.identity.nodeId,
      ) ?? null;
    return true;
  }

  if (event.event === "node.invoke.request" && isRecord(event.payload)) {
    return true;
  }

  if (event.event === "device.pair.requested" && isRecord(event.payload)) {
    const request = event.payload as DesktopPairingRequest;
    if (!state.pendingRequests.some((entry) => entry.requestId === request.requestId)) {
      state.pendingRequests = [...state.pendingRequests, request].toSorted(
        (left, right) => right.ts - left.ts,
      );
    }
    if (request.deviceId === state.identity.nodeId) {
      state.lastPairRequestId = request.requestId;
      state.pairStatus = "pending";
    }
    return true;
  }

  if (event.event === "device.pair.resolved" && isRecord(event.payload)) {
    const payload = event.payload as {
      decision?: unknown;
      deviceId?: unknown;
      requestId?: unknown;
    };
    if (payload.deviceId !== state.identity.nodeId) {
      return false;
    }
    if (
      typeof payload.requestId === "string" &&
      state.lastPairRequestId &&
      payload.requestId !== state.lastPairRequestId
    ) {
      return false;
    }
    const resolvedRequestId = typeof payload.requestId === "string" ? payload.requestId : null;
    state.pendingRequests = resolvedRequestId
      ? state.pendingRequests.filter((request) => request.requestId !== resolvedRequestId)
      : state.pendingRequests;
    state.pairStatus = payload.decision === "approved" ? "paired" : "idle";
    state.lastPairRequestId = resolvedRequestId;
    return true;
  }

  return false;
}

export function describeLocalNode(state: DesktopNodeState): NodeListNode | null {
  return state.knownNodes.find((entry) => entry.nodeId === state.identity.nodeId) ?? null;
}

export { PRESENCE_INTERVAL_MS };
