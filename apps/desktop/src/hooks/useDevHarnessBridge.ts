import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import { isTauriRuntime } from "../desktop/tauri.ts";

type HarnessRequest = {
  requestId: string;
  method: string;
  params: unknown;
};

type HarnessBridgeParams = {
  settings: {
    backgroundVoiceEnabled: boolean;
    gatewayToken: string;
    gatewayUrl: string;
    lastTab: "chat" | "voice" | "settings";
    launchAtLogin: boolean;
    pushToTalkEnabled: boolean;
    talkEnabled: boolean;
    vadEnabled: boolean;
  };
  gateway: {
    connected: boolean;
    connectionLabel: string;
    lastError: string | null;
    lastEvent: { event: string } | null;
  };
  chat: {
    error: string | null;
    hasLiveRun: boolean;
    input: string;
    loading: boolean;
    messages: Array<{ role: string; text?: string; message?: string }>;
    sending: boolean;
    sessionKey: string;
    setInput: (value: string) => void;
    send: () => Promise<void>;
    refresh: () => Promise<void>;
    abort: () => Promise<boolean>;
  };
  node: {
    invoke: (action: "device.info" | "device.status" | "system.notify") => Promise<void>;
    invokeLoading: boolean;
    nodeGatewayConnected: boolean;
    nodeGatewayLabel: string;
    pair: () => Promise<void>;
    pairStatus: string;
    pendingRequests: Array<{ requestId: string }>;
    refresh: () => Promise<void>;
    approve: (requestId: string) => Promise<void>;
    reject: (requestId: string) => Promise<void>;
  };
  readiness: {
    items: Array<{
      action?: { id: string; label: string };
      detail: string;
      id: string;
      label: string;
      status: string;
    }>;
    native: {
      desktopEnvironment: string | null;
      platform: string;
      portalLikelyAvailable: boolean;
      runtime: string;
      sessionType: string | null;
      windowVisible: boolean;
    } | null;
    refresh: () => Promise<void>;
    refreshing: boolean;
    requestMicrophonePermission: () => Promise<void>;
    requestNotificationPermission: () => Promise<void>;
    summary: {
      actionCount: number;
      blockingCount: number;
      readyCount: number;
      totalCount: number;
    };
  };
  talk: {
    canSpeakLatestReply: boolean;
    canTranscribeFixture: boolean;
    config: {
      mainSessionKey: string | null;
      modelId: string | null;
      outputFormat: string | null;
      provider: string | null;
      voiceId: string | null;
    } | null;
    configLoading: boolean;
    lastError: string | null;
    lastRemoteMode: { enabled: boolean; phase: string | null; ts: number | null } | null;
    lastSpokenText: string | null;
    lastTranscript: string | null;
    playbackState: string;
    refreshConfig: () => Promise<void>;
    speakLastAssistantReply: () => Promise<boolean>;
    speakTestPhrase: () => Promise<boolean>;
    statusMessage: string;
    stop: () => Promise<void>;
    transcribeFile: (file: File) => Promise<boolean>;
    transcribeFixtureAudio: () => Promise<boolean>;
    transcribing: boolean;
    transcriptionModel: string | null;
    transcriptionProvider: string | null;
    transcriptionStatusMessage: string;
  };
  desktopSettings: {
    setGatewayToken: (value: string) => void;
    setGatewayUrl: (value: string) => void;
    setLastTab: (value: "chat" | "voice" | "settings") => void;
    toggleBackgroundVoiceEnabled: () => void;
    togglePushToTalkEnabled: () => void;
    toggleTalkEnabled: () => void;
    toggleVadEnabled: () => void;
  };
  handleLaunchAtLoginChange: (value: boolean) => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

async function respond(requestId: string, ok: boolean, payload?: unknown, error?: string) {
  await invoke("desktop_harness_respond", {
    response: {
      requestId,
      ok,
      payload,
      error,
    },
  });
}

function sanitizeSettings(settings: HarnessBridgeParams["settings"]) {
  return {
    backgroundVoiceEnabled: settings.backgroundVoiceEnabled,
    gatewayUrl: settings.gatewayUrl,
    hasGatewayToken: Boolean(settings.gatewayToken.trim()),
    lastTab: settings.lastTab,
    launchAtLogin: settings.launchAtLogin,
    pushToTalkEnabled: settings.pushToTalkEnabled,
    talkEnabled: settings.talkEnabled,
    vadEnabled: settings.vadEnabled,
  };
}

async function handleRequest(request: HarnessRequest, params: HarnessBridgeParams) {
  if (request.method === "settings.get") {
    return sanitizeSettings(params.settings);
  }

  if (request.method === "settings.set") {
    if (!isRecord(request.params)) {
      return params.settings;
    }
    if (typeof request.params.gatewayUrl === "string") {
      params.desktopSettings.setGatewayUrl(request.params.gatewayUrl);
    }
    if (typeof request.params.gatewayToken === "string") {
      params.desktopSettings.setGatewayToken(request.params.gatewayToken);
    }
    if (
      request.params.lastTab === "chat" ||
      request.params.lastTab === "voice" ||
      request.params.lastTab === "settings"
    ) {
      params.desktopSettings.setLastTab(request.params.lastTab);
    }
    if (
      typeof request.params.launchAtLogin === "boolean" &&
      request.params.launchAtLogin !== params.settings.launchAtLogin
    ) {
      await params.handleLaunchAtLoginChange(request.params.launchAtLogin);
    }
    return {
      ok: true,
      settings: sanitizeSettings({
        ...params.settings,
        gatewayToken:
          typeof request.params.gatewayToken === "string"
            ? request.params.gatewayToken
            : params.settings.gatewayToken,
        gatewayUrl:
          typeof request.params.gatewayUrl === "string"
            ? request.params.gatewayUrl
            : params.settings.gatewayUrl,
        lastTab:
          request.params.lastTab === "chat" ||
          request.params.lastTab === "voice" ||
          request.params.lastTab === "settings"
            ? request.params.lastTab
            : params.settings.lastTab,
        launchAtLogin:
          typeof request.params.launchAtLogin === "boolean"
            ? request.params.launchAtLogin
            : params.settings.launchAtLogin,
      }),
    };
  }

  if (request.method === "ui.snapshot") {
    return {
      appReady: true,
      currentTab: params.settings.lastTab,
      settings: sanitizeSettings(params.settings),
      gateway: {
        connected: params.gateway.connected,
        connectionLabel: params.gateway.connectionLabel,
        lastError: params.gateway.lastError,
        lastEvent: params.gateway.lastEvent?.event ?? null,
      },
      chat: {
        error: params.chat.error,
        hasLiveRun: params.chat.hasLiveRun,
        input: params.chat.input,
        loading: params.chat.loading,
        messageCount: params.chat.messages.length,
        sending: params.chat.sending,
        sessionKey: params.chat.sessionKey,
      },
      node: {
        invokeLoading: params.node.invokeLoading,
        nodeGatewayConnected: params.node.nodeGatewayConnected,
        nodeGatewayLabel: params.node.nodeGatewayLabel,
        pairStatus: params.node.pairStatus,
        pendingRequestCount: params.node.pendingRequests.length,
      },
      readiness: {
        items: params.readiness.items,
        native: params.readiness.native,
        refreshing: params.readiness.refreshing,
        summary: params.readiness.summary,
      },
      talk: {
        canSpeakLatestReply: params.talk.canSpeakLatestReply,
        canTranscribeFixture: params.talk.canTranscribeFixture,
        config: params.talk.config,
        configLoading: params.talk.configLoading,
        lastError: params.talk.lastError,
        lastRemoteMode: params.talk.lastRemoteMode,
        lastSpokenText: params.talk.lastSpokenText,
        lastTranscript: params.talk.lastTranscript,
        playbackState: params.talk.playbackState,
        statusMessage: params.talk.statusMessage,
        transcribing: params.talk.transcribing,
        transcriptionModel: params.talk.transcriptionModel,
        transcriptionProvider: params.talk.transcriptionProvider,
        transcriptionStatusMessage: params.talk.transcriptionStatusMessage,
      },
      availableActions: [
        "tab.chat",
        "tab.voice",
        "tab.settings",
        "chat.send",
        "chat.refresh",
        "chat.abort",
        "settings.toggleBackgroundVoice",
        "settings.togglePushToTalk",
        "settings.toggleTalk",
        "settings.toggleVad",
        "voice.refreshReadiness",
        "voice.requestMicrophonePermission",
        "voice.requestNotificationPermission",
        "voice.refreshTalkConfig",
        "voice.speakTestPhrase",
        "voice.speakLastAssistantReply",
        "voice.stop",
        "voice.transcribeFixture",
        "node.refresh",
        "node.pair",
        "node.approveFirstPending",
        "node.rejectFirstPending",
        "node.invoke.device.info",
        "node.invoke.device.status",
        "node.invoke.system.notify",
      ],
      availableInputs: ["chat.input", "settings.gatewayToken", "settings.gatewayUrl"],
    };
  }

  if (request.method === "ui.click") {
    const target = isRecord(request.params) ? readString(request.params.target) : null;
    switch (target) {
      case "tab.chat":
        params.desktopSettings.setLastTab("chat");
        return { ok: true };
      case "tab.voice":
        params.desktopSettings.setLastTab("voice");
        return { ok: true };
      case "tab.settings":
        params.desktopSettings.setLastTab("settings");
        return { ok: true };
      case "chat.send":
        await params.chat.send();
        return { ok: true };
      case "chat.refresh":
        await params.chat.refresh();
        return { ok: true };
      case "chat.abort":
        await params.chat.abort();
        return { ok: true };
      case "settings.toggleBackgroundVoice":
        params.desktopSettings.toggleBackgroundVoiceEnabled();
        return { ok: true };
      case "settings.togglePushToTalk":
        params.desktopSettings.togglePushToTalkEnabled();
        return { ok: true };
      case "settings.toggleTalk":
        params.desktopSettings.toggleTalkEnabled();
        return { ok: true };
      case "settings.toggleVad":
        params.desktopSettings.toggleVadEnabled();
        return { ok: true };
      case "voice.refreshReadiness":
        await params.readiness.refresh();
        return { ok: true };
      case "voice.requestMicrophonePermission":
        await params.readiness.requestMicrophonePermission();
        return { ok: true };
      case "voice.requestNotificationPermission":
        await params.readiness.requestNotificationPermission();
        return { ok: true };
      case "voice.refreshTalkConfig":
        await params.talk.refreshConfig();
        return { ok: true };
      case "voice.speakTestPhrase":
        void params.talk.speakTestPhrase();
        return { ok: true };
      case "voice.speakLastAssistantReply":
        void params.talk.speakLastAssistantReply();
        return { ok: true };
      case "voice.stop":
        void params.talk.stop();
        return { ok: true };
      case "voice.transcribeFixture":
        void params.talk.transcribeFixtureAudio();
        return { ok: true };
      case "node.refresh":
        await params.node.refresh();
        return { ok: true };
      case "node.pair":
        await params.node.pair();
        return { ok: true };
      case "node.approveFirstPending": {
        const pending = params.node.pendingRequests[0];
        if (!pending) {
          throw new Error("no pending pairing request");
        }
        await params.node.approve(pending.requestId);
        return { ok: true };
      }
      case "node.rejectFirstPending": {
        const pending = params.node.pendingRequests[0];
        if (!pending) {
          throw new Error("no pending pairing request");
        }
        await params.node.reject(pending.requestId);
        return { ok: true };
      }
      case "node.invoke.device.info":
        await params.node.invoke("device.info");
        return { ok: true };
      case "node.invoke.device.status":
        await params.node.invoke("device.status");
        return { ok: true };
      case "node.invoke.system.notify":
        await params.node.invoke("system.notify");
        return { ok: true };
      default:
        throw new Error(`unsupported click target: ${target ?? "unknown"}`);
    }
  }

  if (request.method === "ui.type") {
    if (!isRecord(request.params)) {
      throw new Error("ui.type requires params");
    }
    const target = readString(request.params.target);
    const value = readString(request.params.value);
    if (!target) {
      throw new Error("ui.type target missing");
    }
    if (value === null) {
      throw new Error("ui.type value must be a string");
    }
    if (target === "chat.input") {
      params.chat.setInput(value);
      return { ok: true };
    }
    if (target === "settings.gatewayToken") {
      params.desktopSettings.setGatewayToken(value);
      return { ok: true };
    }
    if (target === "settings.gatewayUrl") {
      params.desktopSettings.setGatewayUrl(value);
      return { ok: true };
    }
    throw new Error(`unsupported type target: ${target}`);
  }

  throw new Error(`unsupported harness method: ${request.method}`);
}

export function useDevHarnessBridge(params: HarnessBridgeParams) {
  const paramsRef = useRef(params);
  paramsRef.current = params;

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    void invoke("desktop_harness_ready");

    const unlistenPromise = listen<HarnessRequest>("desktop-harness:request", async (event) => {
      if (disposed) {
        return;
      }
      const request = event.payload;
      try {
        const payload = await handleRequest(request, paramsRef.current);
        await respond(request.requestId, true, payload);
      } catch (error) {
        await respond(
          request.requestId,
          false,
          undefined,
          error instanceof Error ? error.message : String(error),
        );
      }
    });

    return () => {
      disposed = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);
}
