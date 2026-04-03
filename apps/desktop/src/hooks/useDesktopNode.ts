import {
  applyDesktopNodeEvent,
  approveDesktopNodePairing,
  createDesktopNodeState,
  describeLocalNode,
  executeDesktopNodeInvoke,
  hydrateNodePresenceFromHello,
  invokeDesktopNodeCommand,
  loadDesktopNodes,
  loadDesktopPairingRequests,
  rejectDesktopNodePairing,
  type DesktopNodeIdentity,
} from "@openclaw/desktop-core/controllers/nodes";
import {
  GatewayBrowserClient,
  resolveGatewayErrorDetailCode,
  type GatewayEventFrame,
  type GatewayHelloOk,
} from "@openclaw/desktop-core/gateway";
import { useEffect, useMemo, useRef, useState } from "react";

type DesktopNodeHookState = ReturnType<typeof createDesktopNodeState> & {
  nodeGatewayConnected: boolean;
  nodeGatewayLabel: string;
};

function projectState(state: ReturnType<typeof createDesktopNodeState>): DesktopNodeHookState {
  return {
    ...state,
    nodeGatewayConnected: false,
    nodeGatewayLabel: "Disconnected",
  };
}

function cloneState(current: DesktopNodeHookState) {
  const next = createDesktopNodeState(current.identity);
  next.invokeLoading = current.invokeLoading;
  next.invokeResult = current.invokeResult;
  next.knownNodes = current.knownNodes;
  next.lastError = current.lastError;
  next.lastPairRequestId = current.lastPairRequestId;
  next.localPresence = current.localPresence;
  next.nodesLoading = current.nodesLoading;
  next.pairStatus = current.pairStatus;
  next.pendingRequests = current.pendingRequests;
  next.pairingLoading = current.pairingLoading;
  next.selectedNodeId = current.selectedNodeId;
  return next;
}

const NODE_COMMANDS = ["device.info", "device.status", "system.notify"] as const;
const NODE_CAPS = ["desktop-shell"] as const;

export function useDesktopNode(params: {
  client: GatewayBrowserClient | null;
  connected: boolean;
  hello: GatewayHelloOk | null;
  identity: DesktopNodeIdentity | null;
  lastEvent: GatewayEventFrame | null;
  gatewayToken: string;
  gatewayUrl: string;
}) {
  const [state, setState] = useState<DesktopNodeHookState>(() =>
    projectState(createDesktopNodeState({
      deviceFamily: "Desktop",
      displayName: "OpenClaw Desktop",
      nodeId: "desktop-node",
      platform: "desktop",
      uiVersion: "desktop-dev",
    })),
  );
  const nodeClientRef = useRef<GatewayBrowserClient | null>(null);

  useEffect(() => {
    const identity = params.identity;
    if (!identity) {
      return;
    }
    setState((current) => {
      if (
        current.identity.nodeId === identity.nodeId &&
        current.identity.displayName === identity.displayName &&
        current.identity.platform === identity.platform &&
        current.identity.deviceFamily === identity.deviceFamily &&
        current.identity.uiVersion === identity.uiVersion
      ) {
        return current;
      }
      const next = cloneState(current);
      next.identity = identity;
      next.selectedNodeId = current.selectedNodeId === current.identity.nodeId ? identity.nodeId : current.selectedNodeId;
      return {
        ...next,
        nodeGatewayConnected: current.nodeGatewayConnected,
        nodeGatewayLabel: current.nodeGatewayLabel,
      };
    });
  }, [params.identity]);

  useEffect(() => {
    const operatorClient = params.client;
    if (!operatorClient || !params.connected) {
      setState((current) => ({
        ...current,
        knownNodes: [],
        localPresence: null,
        pendingRequests: [],
        nodesLoading: false,
        pairingLoading: false,
      }));
      return;
    }

    let cancelled = false;
    void (async () => {
      const next = cloneState(state);
      hydrateNodePresenceFromHello(next, params.hello);
      await Promise.all([
        loadDesktopNodes(operatorClient, next),
        loadDesktopPairingRequests(operatorClient, next),
      ]);
      if (!cancelled) {
        setState((current) => ({
          ...current,
          knownNodes: next.knownNodes,
          lastError: next.lastError,
          localPresence: next.localPresence,
          nodesLoading: next.nodesLoading,
          pairStatus: next.pairStatus,
          pendingRequests: next.pendingRequests,
          pairingLoading: next.pairingLoading,
          selectedNodeId: next.selectedNodeId,
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.client, params.connected, params.hello, state.identity, state.lastPairRequestId]);

  useEffect(() => {
    const lastEvent = params.lastEvent;
    if (!lastEvent) {
      return;
    }
    setState((current) => {
      const next = cloneState(current);
      if (!applyDesktopNodeEvent(next, lastEvent)) {
        return current;
      }
      return {
        ...current,
        knownNodes: next.knownNodes,
        lastError: next.lastError,
        lastPairRequestId: next.lastPairRequestId,
        localPresence: next.localPresence,
        nodesLoading: next.nodesLoading,
        pairStatus: next.pairStatus,
        pendingRequests: next.pendingRequests,
        pairingLoading: next.pairingLoading,
        selectedNodeId: next.selectedNodeId,
      };
    });
  }, [params.lastEvent]);

  useEffect(() => {
    if (!params.gatewayUrl.trim() || !state.identity.nodeId) {
      return;
    }

    const nodeClient = new GatewayBrowserClient({
      url: params.gatewayUrl.trim(),
      token: params.gatewayToken.trim() || undefined,
      role: "node",
      scopes: [],
      caps: [...NODE_CAPS],
      commands: [...NODE_COMMANDS],
      clientName: "openclaw-control-ui",
      clientDisplayName: state.identity.displayName,
      clientVersion: state.identity.uiVersion,
      platform: state.identity.platform,
      deviceFamily: state.identity.deviceFamily,
      mode: "node",
      instanceId: state.identity.nodeId,
      onHello: () => {
        setState((current) => ({
          ...current,
          nodeGatewayConnected: true,
          nodeGatewayLabel: "Connected",
          lastError: null,
        }));
      },
      onClose: ({ error }) => {
        const detailCode = resolveGatewayErrorDetailCode(error);
        const requestId =
          error?.details && typeof error.details === "object"
            ? ((error.details as { requestId?: unknown }).requestId ?? null)
            : null;
        setState((current) => ({
          ...current,
          nodeGatewayConnected: false,
          nodeGatewayLabel:
            detailCode === "PAIRING_REQUIRED" ? "Awaiting approval" : "Disconnected",
          lastPairRequestId: typeof requestId === "string" ? requestId : current.lastPairRequestId,
          pairStatus: detailCode === "PAIRING_REQUIRED" ? "pending" : current.pairStatus,
          lastError: error?.message ?? current.lastError,
        }));
      },
      onEvent: (event) => {
        if (event.event !== "node.invoke.request" || !event.payload || typeof event.payload !== "object") {
          return;
        }
        const payload = event.payload as {
          id?: unknown;
          nodeId?: unknown;
          command?: unknown;
          paramsJSON?: unknown;
        };
        void (async () => {
          const current = cloneState(state);
          const result = await executeDesktopNodeInvoke(current, {
            command: payload.command,
            paramsJSON: payload.paramsJSON,
          });
          setState((latest) => ({
            ...latest,
            invokeResult: current.invokeResult,
            lastError: current.lastError,
          }));
          if (typeof payload.id !== "string" || typeof payload.nodeId !== "string") {
            return;
          }
          await nodeClient.request("node.invoke.result", {
            id: payload.id,
            nodeId: payload.nodeId,
            ok: result.ok,
            ...(result.ok ? { payload: result.payload } : { error: result.error }),
          });
        })();
      },
    });

    nodeClientRef.current = nodeClient;
    setState((current) => ({ ...current, nodeGatewayLabel: "Connecting" }));
    nodeClient.start();

    return () => {
      nodeClient.stop();
      if (nodeClientRef.current === nodeClient) {
        nodeClientRef.current = null;
      }
    };
  }, [params.gatewayToken, params.gatewayUrl, state.identity]);

  const actions = useMemo(
    () => ({
      async pair() {
        nodeClientRef.current?.stop();
        nodeClientRef.current?.start();
        setState((current) => ({ ...current, nodeGatewayLabel: "Connecting" }));
      },
      async approve(requestId: string) {
        if (!params.client || !params.connected) {
          return;
        }
        const next = cloneState(state);
        await approveDesktopNodePairing(params.client, next, requestId);
        await Promise.all([
          loadDesktopNodes(params.client, next),
          loadDesktopPairingRequests(params.client, next),
        ]);
        setState((current) => ({
          ...current,
          knownNodes: next.knownNodes,
          lastError: next.lastError,
          lastPairRequestId: next.lastPairRequestId,
          nodesLoading: next.nodesLoading,
          pairStatus: next.pairStatus,
          pendingRequests: next.pendingRequests,
          pairingLoading: next.pairingLoading,
          selectedNodeId: next.selectedNodeId,
        }));
        nodeClientRef.current?.stop();
        nodeClientRef.current?.start();
      },
      async reject(requestId: string) {
        if (!params.client || !params.connected) {
          return;
        }
        const next = cloneState(state);
        await rejectDesktopNodePairing(params.client, next, requestId);
        await loadDesktopPairingRequests(params.client, next);
        setState((current) => ({
          ...current,
          lastError: next.lastError,
          pendingRequests: next.pendingRequests,
          pairingLoading: next.pairingLoading,
        }));
      },
      async refresh() {
        if (!params.client || !params.connected) {
          return;
        }
        const next = cloneState(state);
        await Promise.all([
          loadDesktopNodes(params.client, next),
          loadDesktopPairingRequests(params.client, next),
        ]);
        setState((current) => ({
          ...current,
          knownNodes: next.knownNodes,
          lastError: next.lastError,
          localPresence: next.localPresence,
          nodesLoading: next.nodesLoading,
          pairStatus: next.pairStatus,
          pendingRequests: next.pendingRequests,
          pairingLoading: next.pairingLoading,
          selectedNodeId: next.selectedNodeId,
        }));
      },
      async invoke(action: "device.info" | "device.status" | "system.notify") {
        if (!params.client || !params.connected) {
          return;
        }
        const next = cloneState(state);
        await invokeDesktopNodeCommand(params.client, next, { action });
        setState((current) => ({
          ...current,
          invokeLoading: next.invokeLoading,
          invokeResult: next.invokeResult,
          lastError: next.lastError,
        }));
      },
      setSelectedNodeId(selectedNodeId: string) {
        setState((current) => ({ ...current, selectedNodeId }));
      },
    }),
    [params.client, params.connected, state],
  );

  return {
    ...state,
    ...actions,
    localNode: describeLocalNode(cloneState(state)),
  };
}
