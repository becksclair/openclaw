import { loadAgents, type AgentsState } from "@openclaw/desktop-core/controllers/agents";
import {
  resolveDesktopNodeIdentity,
  type DesktopNodeIdentity,
} from "@openclaw/desktop-core/controllers/nodes";
import {
  GatewayBrowserClient,
  type GatewayEventFrame,
  type GatewayHelloOk,
} from "@openclaw/desktop-core/gateway";
import { useEffect, useMemo, useState } from "react";

type GatewayStatus = {
  agents: string[];
  client: GatewayBrowserClient | null;
  connected: boolean;
  connectionLabel: string;
  hello: GatewayHelloOk | null;
  lastEvent: GatewayEventFrame | null;
  lastError: string | null;
  mainSessionKey: string;
  sessionCount: number | null;
};

export type GatewayStatusView = GatewayStatus & {
  identity: DesktopNodeIdentity | null;
  isHealthy: boolean;
};

export function useGatewayStatus(gatewayUrl: string, gatewayToken: string): GatewayStatusView {
  const [identity, setIdentity] = useState<DesktopNodeIdentity | null>(null);
  const [status, setStatus] = useState<GatewayStatus>({
    agents: [],
    client: null,
    connected: false,
    connectionLabel: "Connecting",
    hello: null,
    lastEvent: null,
    lastError: null,
    mainSessionKey: "main",
    sessionCount: null,
  });

  useEffect(() => {
    let cancelled = false;
    void resolveDesktopNodeIdentity().then((nextIdentity) => {
      if (!cancelled) {
        setIdentity(nextIdentity);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!gatewayUrl.trim()) {
      setStatus((current) => ({
        ...current,
        client: null,
        connected: false,
        connectionLabel: "Gateway URL required",
        lastError: "Set a gateway URL to connect.",
      }));
      return;
    }

    if (!identity) {
      setStatus((current) => ({
        ...current,
        client: null,
        connected: false,
        connectionLabel: "Preparing device identity",
        lastError: null,
        lastEvent: null,
      }));
      return;
    }

    const client = new GatewayBrowserClient({
      url: gatewayUrl.trim(),
      token: gatewayToken.trim() || undefined,
      clientDisplayName: identity.displayName,
      deviceFamily: identity.deviceFamily,
      instanceId: identity.nodeId,
      platform: identity.platform,
      onClose: ({ reason, error }) => {
        setStatus((current) => ({
          ...current,
          connected: false,
          connectionLabel: "Reconnecting",
          lastError: error?.message ?? reason ?? "Disconnected",
        }));
      },
      onEvent: (event) => {
        setStatus((current) => ({ ...current, lastEvent: event }));
      },
      onHello: async (hello) => {
        const defaults = hello.snapshot as { sessionDefaults?: { mainSessionKey?: string } } | undefined;
        const nextState: AgentsState = {
          client,
          connected: true,
          agentsError: null,
          agentsList: null,
          agentsLoading: false,
          agentsSelectedId: null,
          toolsCatalogError: null,
          toolsCatalogLoading: false,
          toolsCatalogResult: null,
          toolsEffectiveError: null,
          toolsEffectiveLoading: false,
          toolsEffectiveResult: null,
        };
        await loadAgents(nextState);

        let sessionCount: number | null = null;
        try {
          const sessions = await client.request<{ count?: number }>("sessions.list", {
            includeGlobal: true,
            activeMinutes: 0,
            limit: 20,
          });
          sessionCount = typeof sessions.count === "number" ? sessions.count : null;
        } catch {
          sessionCount = null;
        }

        setStatus({
          agents: nextState.agentsList?.agents.map((entry) => entry.id) ?? [],
          client,
          connected: true,
          connectionLabel: "Connected",
          hello,
          lastError: nextState.agentsError,
          lastEvent: null,
          mainSessionKey: defaults?.sessionDefaults?.mainSessionKey ?? "main",
          sessionCount,
        });
      },
    });

    setStatus((current) => ({
      ...current,
      client,
      connected: false,
      connectionLabel: "Connecting",
      lastError: null,
      lastEvent: null,
    }));
    client.start();

    return () => {
      client.stop();
      setStatus((current) => ({ ...current, client: null }));
    };
  }, [gatewayToken, gatewayUrl, identity]);

  return useMemo(
    () => ({
      ...status,
      identity,
      isHealthy: status.connected && !status.lastError,
    }),
    [identity, status],
  );
}
