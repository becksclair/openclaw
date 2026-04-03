import type { GatewayBrowserClient } from "@openclaw/desktop-core/gateway";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  probeNativeDesktopReadiness,
  readMicrophonePermissionState,
  readNotificationPermissionState,
  requestMicrophonePermissionAccess,
  requestNotificationPermissionAccess,
  type BrowserPermissionState,
  type NativeDesktopReadiness,
} from "../desktop/readiness.ts";

type ReadinessStatus = "ready" | "needs-action" | "blocked" | "checking";
type ReadinessAction =
  | "enableAutostart"
  | "reconnectNode"
  | "refresh"
  | "requestMicrophone"
  | "requestNotification";

export type VoiceReadinessItem = {
  action?: {
    id: ReadinessAction;
    label: string;
  };
  detail: string;
  id:
    | "autostart"
    | "gateway"
    | "gatewayToken"
    | "microphone"
    | "node"
    | "notifications"
    | "talkConfig";
  label: string;
  status: ReadinessStatus;
};

type TalkConfigSummary = {
  detail: string;
  mainSessionKey: string | null;
  provider: string | null;
  status: ReadinessStatus;
};

type TalkConfigPayload = {
  config?: {
    session?: { mainKey?: string };
    talk?: {
      provider?: string;
      resolved?: {
        provider?: string;
      };
      silenceTimeoutMs?: number;
    };
  };
};

type ReadinessState = {
  lastError: string | null;
  microphone: BrowserPermissionState;
  native: NativeDesktopReadiness | null;
  notifications: BrowserPermissionState;
  refreshing: boolean;
  talkConfig: TalkConfigSummary;
};

const DEFAULT_TALK_CONFIG: TalkConfigSummary = {
  detail: "Connect to the gateway to inspect Talk config.",
  mainSessionKey: null,
  provider: null,
  status: "blocked",
};

const INITIAL_STATE: ReadinessState = {
  lastError: null,
  microphone: "unavailable",
  native: null,
  notifications: "unavailable",
  refreshing: true,
  talkConfig: DEFAULT_TALK_CONFIG,
};

function describePermission(
  kind: "microphone" | "notifications",
  state: BrowserPermissionState,
): Pick<VoiceReadinessItem, "detail" | "status" | "action"> {
  if (state === "granted") {
    return {
      detail: `${kind === "microphone" ? "Microphone" : "Notifications"} access granted.`,
      status: "ready",
    };
  }
  if (state === "prompt") {
    return {
      action: {
        id: kind === "microphone" ? "requestMicrophone" : "requestNotification",
        label: kind === "microphone" ? "Allow microphone" : "Allow notifications",
      },
      detail:
        kind === "microphone"
          ? "Permission not granted yet. Request access before native Talk lands."
          : "Permission not granted yet. Test notifications will stay fake until you allow them.",
      status: "needs-action",
    };
  }
  if (state === "denied") {
    return {
      detail:
        kind === "microphone"
          ? "Access denied. Re-enable microphone access in system settings for voice features."
          : "Notifications are blocked. Re-enable them in system settings if you want desktop alerts.",
      status: "blocked",
    };
  }
  return {
    detail:
      kind === "microphone"
        ? "Microphone probing is unavailable in this runtime."
        : "Notifications API is unavailable in this runtime.",
    status: "blocked",
  };
}

async function loadTalkConfig(
  client: GatewayBrowserClient | null,
  connected: boolean,
): Promise<TalkConfigSummary> {
  if (!client || !connected) {
    return DEFAULT_TALK_CONFIG;
  }

  try {
    const result = await client.request<TalkConfigPayload>("talk.config", {});
    const talk = result.config?.talk;
    const provider = talk?.resolved?.provider ?? talk?.provider ?? null;
    const mainSessionKey = result.config?.session?.mainKey ?? null;
    if (!talk) {
      return {
        detail: "Gateway connection is up, but Talk config is missing.",
        mainSessionKey,
        provider,
        status: "needs-action",
      };
    }
    return {
      detail: `Talk config readable${provider ? ` via ${provider}` : ""}${mainSessionKey ? ` · main session ${mainSessionKey}` : ""}`,
      mainSessionKey,
      provider,
      status: "ready",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      detail: `Talk config probe failed: ${message}`,
      mainSessionKey: null,
      provider: null,
      status: "needs-action",
    };
  }
}

export function useDesktopReadiness(params: {
  client: GatewayBrowserClient | null;
  connected: boolean;
  gatewayToken: string;
  launchAtLogin: boolean;
  nodeGatewayConnected: boolean;
  nodePairStatus: string;
  pendingRequestCount: number;
}) {
  const [state, setState] = useState<ReadinessState>(INITIAL_STATE);

  const refresh = useCallback(async () => {
    setState((current) => ({
      ...current,
      lastError: null,
      refreshing: true,
    }));

    const [native, microphone, notifications, talkConfig] = await Promise.all([
      probeNativeDesktopReadiness(),
      readMicrophonePermissionState(),
      readNotificationPermissionState(),
      loadTalkConfig(params.client, params.connected),
    ]);

    setState({
      lastError: null,
      microphone,
      native,
      notifications,
      refreshing: false,
      talkConfig,
    });
  }, [params.client, params.connected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const requestMicrophonePermission = useCallback(async () => {
    setState((current) => ({ ...current, refreshing: true }));
    const microphone = await requestMicrophonePermissionAccess();
    const [native, notifications, talkConfig] = await Promise.all([
      probeNativeDesktopReadiness(),
      readNotificationPermissionState(),
      loadTalkConfig(params.client, params.connected),
    ]);
    setState({
      lastError: null,
      microphone,
      native,
      notifications,
      refreshing: false,
      talkConfig,
    });
  }, [params.client, params.connected]);

  const requestNotificationPermission = useCallback(async () => {
    setState((current) => ({ ...current, refreshing: true }));
    const notifications = await requestNotificationPermissionAccess();
    const [native, microphone, talkConfig] = await Promise.all([
      probeNativeDesktopReadiness(),
      readMicrophonePermissionState(),
      loadTalkConfig(params.client, params.connected),
    ]);
    setState({
      lastError: null,
      microphone,
      native,
      notifications,
      refreshing: false,
      talkConfig,
    });
  }, [params.client, params.connected]);

  const items = useMemo<VoiceReadinessItem[]>(() => {
    const gatewayToken = params.gatewayToken.trim();
    const gatewayItem: VoiceReadinessItem = params.connected
      ? {
          detail: "Gateway operator session is connected and healthy enough for desktop work.",
          id: "gateway",
          label: "Gateway reachability",
          status: "ready",
        }
      : {
          action: {
            id: "refresh",
            label: "Retry checks",
          },
          detail: gatewayToken
            ? "Gateway operator session is not connected yet. Retry the probe or re-check the gateway URL/token."
            : "Add a gateway token and URL before voice setup can do anything useful.",
          id: "gateway",
          label: "Gateway reachability",
          status: gatewayToken ? "blocked" : "needs-action",
        };

    const tokenItem: VoiceReadinessItem = gatewayToken
      ? {
          detail: "Session-scoped gateway token is present.",
          id: "gatewayToken",
          label: "Gateway token",
          status: "ready",
        }
      : {
          detail: "Gateway token is missing for this desktop session.",
          id: "gatewayToken",
          label: "Gateway token",
          status: "needs-action",
        };

    const nodeItem: VoiceReadinessItem = params.nodeGatewayConnected
      ? {
          detail: "Desktop node session is connected and ready for capability work.",
          id: "node",
          label: "Node pairing",
          status: "ready",
        }
      : params.nodePairStatus === "paired"
        ? {
            action: {
              id: "reconnectNode",
              label: "Reconnect node",
            },
            detail: "Desktop device is paired, but the live node session is disconnected.",
            id: "node",
            label: "Node pairing",
            status: "needs-action",
          }
        : {
            action: {
              id: "reconnectNode",
              label: params.pendingRequestCount > 0 ? "Retry node" : "Start node",
            },
            detail:
              params.pendingRequestCount > 0
                ? `Desktop node still has ${params.pendingRequestCount} pending pair request${params.pendingRequestCount === 1 ? "" : "s"}.`
                : "Desktop node is not paired yet.",
            id: "node",
            label: "Node pairing",
            status: "needs-action",
          };

    const microphone = describePermission("microphone", state.microphone);
    const notifications = describePermission("notifications", state.notifications);

    const autostartItem: VoiceReadinessItem = params.launchAtLogin
      ? {
          detail: "Launch at login is enabled.",
          id: "autostart",
          label: "Autostart",
          status: "ready",
        }
      : {
          action: {
            id: "enableAutostart",
            label: "Enable autostart",
          },
          detail: "Launch at login is disabled, so background voice will not survive a reboot yet.",
          id: "autostart",
          label: "Autostart",
          status: "needs-action",
        };

    const talkConfigItem: VoiceReadinessItem = {
      detail: state.talkConfig.detail,
      id: "talkConfig",
      label: "Talk config",
      status: state.refreshing && !state.talkConfig.provider && !params.connected
        ? "checking"
        : state.talkConfig.status,
    };

    return [
      gatewayItem,
      tokenItem,
      nodeItem,
      {
        ...microphone,
        id: "microphone",
        label: "Microphone access",
      },
      {
        ...notifications,
        id: "notifications",
        label: "Notifications",
      },
      autostartItem,
      talkConfigItem,
    ];
  }, [
    params.connected,
    params.gatewayToken,
    params.launchAtLogin,
    params.nodeGatewayConnected,
    params.nodePairStatus,
    params.pendingRequestCount,
    state.microphone,
    state.notifications,
    state.refreshing,
    state.talkConfig.detail,
    state.talkConfig.provider,
    state.talkConfig.status,
  ]);

  const summary = useMemo(() => {
    const readyCount = items.filter((item) => item.status === "ready").length;
    const blockingCount = items.filter((item) => item.status === "blocked").length;
    const actionCount = items.filter((item) => item.status === "needs-action").length;
    return {
      actionCount,
      blockingCount,
      readyCount,
      totalCount: items.length,
    };
  }, [items]);

  return {
    items,
    native: state.native,
    refresh,
    refreshing: state.refreshing,
    requestMicrophonePermission,
    requestNotificationPermission,
    summary,
    talkConfig: state.talkConfig,
  };
}
