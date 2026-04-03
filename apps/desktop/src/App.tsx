import { Bot, MessageSquare, Mic, MonitorSmartphone, RefreshCw, Send, Settings2, Square, Waves } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card.tsx";
import { Switch } from "./components/ui/switch.tsx";
import { readAutostartEnabled, writeAutostartEnabled } from "./desktop/autostart.ts";
import { type DesktopTab } from "./desktop/settings.ts";
import { ensureDesktopTray, syncDesktopTray } from "./desktop/tray.ts";
import { hideMainWindow, installCloseToTrayBehavior, quitDesktopApp, showMainWindow } from "./desktop/window.ts";
import { useDesktopSettings } from "./hooks/useDesktopSettings.ts";
import { useDesktopChat } from "./hooks/useDesktopChat.ts";
import { useDesktopNode } from "./hooks/useDesktopNode.ts";
import { useDesktopReadiness, type VoiceReadinessItem } from "./hooks/useDesktopReadiness.ts";
import { useDesktopTalk } from "./hooks/useDesktopTalk.ts";
import { useGatewayStatus } from "./hooks/useGatewayStatus.ts";
import { useDevHarnessBridge } from "./hooks/useDevHarnessBridge.ts";

const TABS: Array<{ id: DesktopTab; icon: typeof MessageSquare; label: string }> = [
  { id: "chat", icon: MessageSquare, label: "Chat" },
  { id: "voice", icon: Mic, label: "Voice" },
  { id: "settings", icon: Settings2, label: "Settings" },
];

export function App() {
  const desktopSettings = useDesktopSettings();
  const { settings } = desktopSettings;
  const gateway = useGatewayStatus(settings.gatewayUrl, settings.gatewayToken);
  const chat = useDesktopChat({
    client: gateway.client,
    connected: gateway.connected,
    lastEvent: gateway.lastEvent,
  });
  const node = useDesktopNode({
    client: gateway.client,
    connected: gateway.connected,
    hello: gateway.hello,
    identity: gateway.identity,
    lastEvent: gateway.lastEvent,
    gatewayToken: settings.gatewayToken,
    gatewayUrl: settings.gatewayUrl,
  });
  const readiness = useDesktopReadiness({
    client: gateway.client,
    connected: gateway.connected,
    gatewayToken: settings.gatewayToken,
    launchAtLogin: settings.launchAtLogin,
    nodeGatewayConnected: node.nodeGatewayConnected,
    nodePairStatus: node.pairStatus,
    pendingRequestCount: node.pendingRequests.length,
  });
  const talk = useDesktopTalk({
    client: gateway.client,
    connected: gateway.connected,
    lastEvent: gateway.lastEvent,
    messages: chat.messages,
    talkEnabled: settings.talkEnabled,
  });
  const [launchAtLoginBusy, setLaunchAtLoginBusy] = useState(false);

  useEffect(() => {
    void installCloseToTrayBehavior();
  }, []);

  useEffect(() => {
    void ensureDesktopTray({
      backgroundVoiceEnabled: settings.backgroundVoiceEnabled,
      onHide: hideMainWindow,
      onQuit: quitDesktopApp,
      onShow: showMainWindow,
      onToggleBackgroundVoice: desktopSettings.toggleBackgroundVoiceEnabled,
    });
    void syncDesktopTray(settings.backgroundVoiceEnabled);
  }, [desktopSettings, settings.backgroundVoiceEnabled]);

  useEffect(() => {
    let cancelled = false;
    void readAutostartEnabled().then((enabled) => {
      if (!cancelled) {
        desktopSettings.setLaunchAtLogin(enabled);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [desktopSettings]);

  const environmentCards = useMemo(
    () => [
      {
        icon: Bot,
        label: "Gateway",
        value: gateway.connectionLabel,
        tone: gateway.connected ? "text-emerald-300" : "text-amber-300",
      },
      {
        icon: MessageSquare,
        label: "Main session",
        value: chat.sessionKey,
        tone: gateway.connected ? "text-slate-100" : "text-slate-400",
      },
      {
        icon: Waves,
        label: "Background voice",
        value: settings.backgroundVoiceEnabled ? "Armed" : "Idle",
        tone: settings.backgroundVoiceEnabled ? "text-emerald-300" : "text-slate-300",
      },
      {
        icon: MonitorSmartphone,
        label: "Desktop node",
        value: node.nodeGatewayConnected ? "Connected" : node.nodeGatewayLabel,
        tone:
          node.nodeGatewayConnected
            ? "text-emerald-300"
            : node.pairStatus === "pending"
              ? "text-amber-300"
              : "text-slate-300",
      },
    ],
    [chat.sessionKey, gateway.connected, gateway.connectionLabel, node.nodeGatewayConnected, node.nodeGatewayLabel, node.pairStatus, settings.backgroundVoiceEnabled],
  );

  async function handleLaunchAtLoginChange(nextValue: boolean) {
    setLaunchAtLoginBusy(true);
    try {
      const resolved = await writeAutostartEnabled(nextValue);
      desktopSettings.setLaunchAtLogin(resolved);
    } catch {
      desktopSettings.setLaunchAtLogin(nextValue);
    } finally {
      setLaunchAtLoginBusy(false);
    }
  }

  useDevHarnessBridge({
    settings,
    gateway,
    chat,
    node,
    readiness,
    talk,
    desktopSettings,
    handleLaunchAtLoginChange,
  });

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.18),_transparent_36%),linear-gradient(180deg,_#020617,_#020617_32%,_#0f172a)] text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-6 py-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Badge className="mb-3">Desktop shell milestone</Badge>
            <h1 className="text-3xl font-semibold tracking-tight">OpenClaw Desktop</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              Tray-primary KDE Wayland desktop shell with a live gateway connection spine, background
              voice toggles, and the first real main-session chat loop wired into the native shell.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => void hideMainWindow()}>
              Hide to tray
            </Button>
            <Button onClick={() => void showMainWindow()}>Focus window</Button>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          {environmentCards.map((item) => {
            const Icon = item.icon;
            return (
              <Card key={item.label}>
                <CardContent className="flex items-center gap-4 p-5">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-emerald-300">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm text-slate-400">{item.label}</div>
                    <div className={`text-base font-medium ${item.tone}`}>{item.value}</div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>

        <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Desktop modes</CardTitle>
              <CardDescription>Chat now, voice shell next, node runtime after that.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const active = settings.lastTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-3 text-left text-sm transition ${
                      active
                        ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-100"
                        : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                    }`}
                    type="button"
                    onClick={() => desktopSettings.setLastTab(tab.id)}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <div className="space-y-6">
            {settings.lastTab === "chat" ? (
              <ChatPanel
                chat={chat}
                gateway={gateway}
                gatewayToken={settings.gatewayToken}
                gatewayUrl={settings.gatewayUrl}
                onGatewayTokenChange={desktopSettings.setGatewayToken}
                onGatewayUrlChange={desktopSettings.setGatewayUrl}
              />
            ) : null}
            {settings.lastTab === "voice" ? (
              <VoicePanel
                backgroundVoiceEnabled={settings.backgroundVoiceEnabled}
                launchAtLoginBusy={launchAtLoginBusy}
                onLaunchAtLoginChange={handleLaunchAtLoginChange}
                onNodeReconnect={async () => await node.pair()}
                pushToTalkEnabled={settings.pushToTalkEnabled}
                readiness={readiness}
                talk={talk}
                talkEnabled={settings.talkEnabled}
                toggleBackgroundVoiceEnabled={desktopSettings.toggleBackgroundVoiceEnabled}
                togglePushToTalkEnabled={desktopSettings.togglePushToTalkEnabled}
                toggleTalkEnabled={desktopSettings.toggleTalkEnabled}
                toggleVadEnabled={desktopSettings.toggleVadEnabled}
                vadEnabled={settings.vadEnabled}
              />
            ) : null}
            {settings.lastTab === "settings" ? (
              <SettingsPanel
                gateway={gateway}
                gatewayToken={settings.gatewayToken}
                gatewayUrl={settings.gatewayUrl}
                launchAtLogin={settings.launchAtLogin}
                launchAtLoginBusy={launchAtLoginBusy}
                node={node}
                onGatewayTokenChange={desktopSettings.setGatewayToken}
                onGatewayUrlChange={desktopSettings.setGatewayUrl}
                onLaunchAtLoginChange={handleLaunchAtLoginChange}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

type GatewayView = ReturnType<typeof useGatewayStatus>;
type ChatView = ReturnType<typeof useDesktopChat>;

function ChatPanel(props: {
  chat: ChatView;
  gateway: GatewayView;
  gatewayToken: string;
  gatewayUrl: string;
  onGatewayTokenChange: (value: string) => void;
  onGatewayUrlChange: (value: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Main-session-first Chat</CardTitle>
        <CardDescription>
          This shell now resolves the canonical main session, loads history, listens for gateway `chat`
          events, and sends new turns through `chat.send`.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm text-slate-300">
            <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">Gateway URL</span>
            <input
              className="w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none ring-0 placeholder:text-slate-500"
              value={props.gatewayUrl}
              onChange={(event) => props.onGatewayUrlChange(event.target.value)}
              placeholder="ws://127.0.0.1:18789"
            />
          </label>
          <label className="space-y-2 text-sm text-slate-300">
            <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">Gateway token</span>
            <input
              autoComplete="off"
              className="w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none ring-0 placeholder:text-slate-500"
              onChange={(event) => props.onGatewayTokenChange(event.target.value)}
              placeholder="Paste gateway.auth.token"
              type="password"
              value={props.gatewayToken}
            />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <StatusRow label="Connection" value={props.gateway.connectionLabel} />
          <StatusRow label="Main session" value={props.chat.sessionKey} />
          <StatusRow label="Agent count" value={String(props.gateway.agents.length)} />
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-950/70">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <div className="text-sm font-medium text-slate-100">Session transcript</div>
              <div className="text-xs text-slate-400">Voice and tray actions will keep targeting this main session.</div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => void props.chat.refresh()}>
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
              {props.chat.hasLiveRun ? (
                <Button size="sm" variant="outline" onClick={() => void props.chat.abort()}>
                  <Square className="h-4 w-4" />
                  Abort
                </Button>
              ) : null}
            </div>
          </div>
          <div className="max-h-[460px] space-y-3 overflow-y-auto p-4">
            {props.chat.loading ? <div className="text-sm text-slate-400">Loading history…</div> : null}
            {!props.chat.loading && props.chat.messages.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                No messages yet. Say something devastatingly clever.
              </div>
            ) : null}
            {props.chat.messages.map((message, index) => (
              <MessageBubble key={`${message.role}-${message.timestamp ?? index}-${index}`} message={message.content} role={message.role} />
            ))}
            {props.chat.stream ? <MessageBubble message={props.chat.stream} role="assistant" streaming /> : null}
          </div>
        </div>

        <div className="space-y-3">
          <textarea
            className="min-h-[120px] w-full rounded-xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500"
            disabled={!props.gateway.connected}
            onChange={(event) => props.chat.setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void props.chat.send();
              }
            }}
            placeholder={props.gateway.connected ? "Message main session…" : "Connect to a gateway first…"}
            value={props.chat.input}
          />
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500">⌘/Ctrl+Enter sends to the canonical main session.</div>
            <Button disabled={!props.gateway.connected || !props.chat.input.trim()} onClick={() => void props.chat.send()}>
              <Send className="h-4 w-4" />
              Send
            </Button>
          </div>
        </div>

        {props.chat.error ? (
          <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
            {props.chat.error}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function VoicePanel(props: {
  backgroundVoiceEnabled: boolean;
  launchAtLoginBusy: boolean;
  onLaunchAtLoginChange: (value: boolean) => Promise<void>;
  onNodeReconnect: () => Promise<void>;
  pushToTalkEnabled: boolean;
  readiness: ReturnType<typeof useDesktopReadiness>;
  talk: ReturnType<typeof useDesktopTalk>;
  talkEnabled: boolean;
  toggleBackgroundVoiceEnabled: () => void;
  togglePushToTalkEnabled: () => void;
  toggleTalkEnabled: () => void;
  toggleVadEnabled: () => void;
  vadEnabled: boolean;
}) {
  const audioInputRef = useRef<HTMLInputElement | null>(null);

  async function handleReadinessAction(item: VoiceReadinessItem) {
    switch (item.action?.id) {
      case "refresh":
        await props.readiness.refresh();
        await props.talk.refreshConfig();
        return;
      case "requestMicrophone":
        await props.readiness.requestMicrophonePermission();
        return;
      case "requestNotification":
        await props.readiness.requestNotificationPermission();
        return;
      case "reconnectNode":
        await props.onNodeReconnect();
        await props.readiness.refresh();
        return;
      case "enableAutostart":
        await props.onLaunchAtLoginChange(true);
        await props.readiness.refresh();
        return;
      default:
        return;
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle>Voice readiness</CardTitle>
            <CardDescription>
              The shell can now bootstrap Talk for real: load gateway Talk config, synthesize speech,
              and play it locally while the native capture/runtime pieces are still incubating.
            </CardDescription>
          </div>
          <Badge>
            {props.readiness.summary.readyCount}/{props.readiness.summary.totalCount} ready
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <StatusRow label="Ready checks" value={String(props.readiness.summary.readyCount)} />
          <StatusRow label="Needs action" value={String(props.readiness.summary.actionCount)} />
          <StatusRow label="Blocked" value={String(props.readiness.summary.blockingCount)} />
          <StatusRow label="Talk phase" value={props.talk.playbackState} />
          <StatusRow label="Talk provider" value={props.talk.config?.provider ?? "unconfigured"} />
          <StatusRow
            label="Remote mode"
            value={props.talk.lastRemoteMode?.phase ?? (props.talk.lastRemoteMode?.enabled ? "enabled" : "idle")}
          />
          <StatusRow label="Transcription" value={props.talk.transcribing ? "running" : "idle"} />
          <StatusRow
            label="STT provider"
            value={props.talk.transcriptionProvider ?? "unknown until first transcript"}
          />
          <StatusRow label="STT model" value={props.talk.transcriptionModel ?? "default"} />
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="font-medium text-slate-100">Talk bootstrap</div>
              <p className="text-sm text-slate-400">{props.talk.statusMessage}</p>
              <div className="text-xs text-slate-500">
                {props.talk.lastSpokenText
                  ? `Last spoken: ${props.talk.lastSpokenText}`
                  : "No speech has been played yet."}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={props.talk.configLoading}
                onClick={() => {
                  void props.talk.refreshConfig();
                }}
              >
                <RefreshCw className="h-4 w-4" />
                Refresh Talk config
              </Button>
              <Button
                size="sm"
                disabled={props.talk.configLoading}
                onClick={() => {
                  void props.talk.speakTestPhrase();
                }}
              >
                Speak test phrase
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!props.talk.canSpeakLatestReply || props.talk.configLoading}
                onClick={() => {
                  void props.talk.speakLastAssistantReply();
                }}
              >
                Speak last reply
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={props.talk.playbackState !== "speaking" && props.talk.playbackState !== "synthesizing"}
                onClick={() => {
                  void props.talk.stop();
                }}
              >
                <Square className="h-4 w-4" />
                Stop
              </Button>
            </div>
          </div>
          {props.talk.lastError ? (
            <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
              {props.talk.lastError}
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <input
            ref={audioInputRef}
            accept="audio/*,.wav,.mp3,.ogg,.opus,.webm,.m4a"
            className="hidden"
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = "";
              if (!file) {
                return;
              }
              void props.talk.transcribeFile(file);
            }}
          />
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="font-medium text-slate-100">Speech-to-text bootstrap</div>
              <p className="text-sm text-slate-400">{props.talk.transcriptionStatusMessage}</p>
              <div className="text-xs text-slate-500">
                {props.talk.lastTranscript ? "Latest transcript captured below." : "No transcript yet."}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={props.talk.transcribing}
                onClick={() => {
                  audioInputRef.current?.click();
                }}
              >
                Transcribe audio file
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!props.talk.canTranscribeFixture || props.talk.transcribing}
                onClick={() => {
                  void props.talk.transcribeFixtureAudio();
                }}
              >
                Transcribe fixture
              </Button>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/70 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Transcript</div>
            <div className="mt-3 whitespace-pre-wrap text-sm text-slate-100">
              {props.talk.lastTranscript ?? "No transcript yet."}
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {props.readiness.items.map((item) => (
            <ReadinessCard
              key={item.id}
              item={item}
              loading={props.readiness.refreshing || props.launchAtLoginBusy || props.talk.configLoading}
              onAction={handleReadinessAction}
            />
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <StatusRow
            label="Runtime"
            value={props.readiness.native?.runtime === "tauri" ? "Tauri desktop" : "Browser shell"}
          />
          <StatusRow label="Session" value={props.readiness.native?.sessionType ?? "unknown"} />
          <StatusRow
            label="Desktop environment"
            value={props.readiness.native?.desktopEnvironment ?? "unknown"}
          />
          <StatusRow
            label="Portal hint"
            value={props.readiness.native?.portalLikelyAvailable ? "Likely available" : "Unknown"}
          />
          <StatusRow label="Talk voice" value={props.talk.config?.voiceId ?? "default"} />
          <StatusRow label="Talk output" value={props.talk.config?.outputFormat ?? "provider default"} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <ToggleCard
            checked={props.talkEnabled}
            description="Auto-speaks new assistant replies through the desktop Talk bootstrap."
            label="Talk mode"
            onCheckedChange={props.toggleTalkEnabled}
          />
          <ToggleCard
            checked={props.pushToTalkEnabled}
            description="Global PTT target for KDE Plasma Wayland."
            label="Push-to-talk"
            onCheckedChange={props.togglePushToTalkEnabled}
          />
          <ToggleCard
            checked={props.vadEnabled}
            description="Model-based speech detection and manual wake shell."
            label="Voice activity detection"
            onCheckedChange={props.toggleVadEnabled}
          />
          <ToggleCard
            checked={props.backgroundVoiceEnabled}
            description="Keeps tray voice services armed after the window closes."
            label="Background voice"
            onCheckedChange={props.toggleBackgroundVoiceEnabled}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function SettingsPanel(props: {
  gateway: GatewayView;
  gatewayToken: string;
  gatewayUrl: string;
  launchAtLogin: boolean;
  launchAtLoginBusy: boolean;
  node: ReturnType<typeof useDesktopNode>;
  onGatewayTokenChange: (value: string) => void;
  onGatewayUrlChange: (value: string) => void;
  onLaunchAtLoginChange: (value: boolean) => Promise<void>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Minimal desktop settings</CardTitle>
        <CardDescription>
          The gateway stays the source of truth for Talk and STT config. This page owns desktop-local
          shell settings and readiness only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <StatusRow label="Gateway" value={props.gateway.connected ? "Reachable" : "Unavailable"} />
          <StatusRow label="Desktop autostart" value={props.launchAtLogin ? "Enabled" : "Disabled"} />
          <StatusRow label="Last gateway event" value={props.gateway.lastEvent?.event ?? "—"} />
          <StatusRow label="Desktop node" value={props.node.nodeGatewayLabel} />
          <StatusRow label="Pending pairing approvals" value={String(props.node.pendingRequests.length)} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm text-slate-300">
            <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">Gateway URL</span>
            <input
              className="w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none ring-0 placeholder:text-slate-500"
              value={props.gatewayUrl}
              onChange={(event) => props.onGatewayUrlChange(event.target.value)}
              placeholder="ws://127.0.0.1:18789"
            />
          </label>
          <label className="space-y-2 text-sm text-slate-300">
            <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">Gateway token</span>
            <input
              autoComplete="off"
              className="w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none ring-0 placeholder:text-slate-500"
              onChange={(event) => props.onGatewayTokenChange(event.target.value)}
              placeholder="Paste gateway.auth.token"
              type="password"
              value={props.gatewayToken}
            />
            <div className="text-xs text-slate-500">Stored for this browser session only so the desktop shell can authenticate and approve node pairing.</div>
          </label>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-medium text-slate-100">Launch at login</div>
              <p className="text-sm text-slate-400">Restore the tray shell and background voice state when the desktop session starts.</p>
            </div>
            <Switch
              checked={props.launchAtLogin}
              disabled={props.launchAtLoginBusy}
              onCheckedChange={(checked) => {
                void props.onLaunchAtLoginChange(checked);
              }}
            />
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="font-medium text-slate-100">Baseline node presence</div>
              <div className="text-sm text-slate-400">Pair this desktop shell as a node and publish lightweight presence beacons to the gateway.</div>
              <div className="text-xs text-slate-500">Node ID: {props.node.identity.nodeId}</div>
              <div className="text-xs text-slate-500">Display name: {props.node.identity.displayName}</div>
              <div className="text-xs text-slate-500">Presence: {props.node.localPresence?.reason ?? "not seen yet"}</div>
              <div className="text-xs text-slate-500">Known nodes: {props.node.knownNodes.length}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => void props.node.refresh()}>
                <RefreshCw className="h-4 w-4" />
                Refresh nodes
              </Button>
              <Button size="sm" onClick={() => void props.node.pair()}>
                <MonitorSmartphone className="h-4 w-4" />
                {props.node.nodeGatewayConnected
                  ? "Reconnect node session"
                  : props.node.pairStatus === "pending"
                    ? "Retry node session"
                    : "Start node session"}
              </Button>
            </div>
          </div>
          {props.node.localNode ? (
            <div className="mt-4 rounded-lg border border-white/10 bg-slate-950/50 p-3 text-xs text-slate-400">
              {props.node.localNode.displayName ?? props.node.localNode.nodeId} · {props.node.localNode.platform ?? "platform unknown"} · {props.node.localNode.connected ? "connected" : props.node.localNode.paired ? "paired" : "unpaired"}
            </div>
          ) : null}
          {props.node.lastError ? (
            <div className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">{props.node.lastError}</div>
          ) : null}
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-medium text-slate-100">Pairing approvals</div>
              <p className="text-sm text-slate-400">Approve or reject pending desktop and node pairing requests from the gateway control surface.</p>
            </div>
            <Badge>{props.node.pendingRequests.length} pending</Badge>
          </div>
          <div className="mt-4 space-y-3">
            {props.node.pendingRequests.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/10 bg-slate-950/40 p-4 text-sm text-slate-400">
                No pending pairing requests. For once, the machines are behaving.
              </div>
            ) : null}
            {props.node.pendingRequests.map((request) => (
              <div key={request.requestId} className="rounded-lg border border-white/10 bg-slate-950/50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="font-medium text-slate-100">{request.displayName ?? request.deviceId}</div>
                    <div className="text-xs text-slate-500">Device ID: {request.deviceId}</div>
                    <div className="text-xs text-slate-500">Role: {request.role ?? request.roles?.join(", ") ?? "unknown"}</div>
                    <div className="text-xs text-slate-500">Scopes: {request.scopes?.join(", ") ?? "—"}</div>
                    <div className="text-xs text-slate-500">Platform: {request.platform ?? "unknown"}</div>
                    <div className="text-xs text-slate-500">Remote IP: {request.remoteIp ?? "unknown"}</div>
                    <div className="text-xs text-slate-500">Repair: {request.isRepair ? "yes" : "no"}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={props.node.pairingLoading} onClick={() => void props.node.reject(request.requestId)}>
                      Reject
                    </Button>
                    <Button size="sm" disabled={props.node.pairingLoading} onClick={() => void props.node.approve(request.requestId)}>
                      Approve
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="font-medium text-slate-100">Node command surface</div>
              <p className="text-sm text-slate-400">Small, safe controls for interrogating a paired node and proving the invoke path works.</p>
            </div>
            <Badge>{props.node.selectedNodeId ?? "no node"}</Badge>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,220px)_1fr]">
            <label className="space-y-2 text-sm text-slate-300">
              <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">Target node</span>
              <select
                className="w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none"
                value={props.node.selectedNodeId ?? ""}
                onChange={(event) => props.node.setSelectedNodeId(event.target.value)}
              >
                {props.node.knownNodes.map((node) => (
                  <option key={node.nodeId} value={node.nodeId}>
                    {node.displayName ?? node.nodeId}
                  </option>
                ))}
              </select>
            </label>
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={props.node.invokeLoading || props.node.knownNodes.length === 0} onClick={() => void props.node.invoke("device.info")}>
                  Device info
                </Button>
                <Button size="sm" variant="outline" disabled={props.node.invokeLoading || props.node.knownNodes.length === 0} onClick={() => void props.node.invoke("device.status")}>
                  Device status
                </Button>
                <Button size="sm" disabled={props.node.invokeLoading || props.node.knownNodes.length === 0} onClick={() => void props.node.invoke("system.notify")}>
                  Send test notification
                </Button>
              </div>
              <div className="rounded-lg border border-white/10 bg-slate-950/50 p-3 text-xs text-slate-400">
                {props.node.invokeResult ? (
                  <>
                    <div className="mb-2 font-medium text-slate-200">Last action: {props.node.invokeResult.action}</div>
                    <pre className="whitespace-pre-wrap break-words">{JSON.stringify(props.node.invokeResult.payload, null, 2)}</pre>
                  </>
                ) : (
                  "No node command run yet. Press a button and let the machinery clank."
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
          Next desktop slices: native Talk runtime, global push-to-talk, richer node actions, and Linux media capture.
        </div>
      </CardContent>
    </Card>
  );
}

function ReadinessCard(props: {
  item: VoiceReadinessItem;
  loading: boolean;
  onAction: (item: VoiceReadinessItem) => Promise<void>;
}) {
  const toneClass =
    props.item.status === "ready"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
      : props.item.status === "needs-action"
        ? "border-amber-400/30 bg-amber-400/10 text-amber-100"
        : props.item.status === "checking"
          ? "border-sky-400/30 bg-sky-400/10 text-sky-100"
          : "border-rose-400/30 bg-rose-400/10 text-rose-100";

  return (
    <div className={`rounded-xl border p-4 ${toneClass}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] opacity-70">{props.item.status.replace("-", " ")}</div>
          <div className="mt-2 font-medium">{props.item.label}</div>
          <p className="mt-2 text-sm opacity-90">{props.item.detail}</p>
        </div>
        {props.item.action ? (
          <Button
            size="sm"
            variant={props.item.status === "ready" ? "ghost" : "outline"}
            disabled={props.loading}
            onClick={() => {
              void props.onAction(props.item);
            }}
          >
            {props.item.action.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ToggleCard(props: {
  checked: boolean;
  description: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-medium text-slate-100">{props.label}</div>
          <p className="mt-1 text-sm text-slate-400">{props.description}</p>
        </div>
        <Switch checked={props.checked} onCheckedChange={props.onCheckedChange} />
      </div>
    </div>
  );
}

function StatusRow(props: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{props.label}</div>
      <div className="mt-2 text-sm font-medium text-slate-100">{props.value}</div>
    </div>
  );
}

function MessageBubble(props: { message: string; role: string; streaming?: boolean }) {
  const isUser = props.role.toLowerCase() === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 ${
          isUser
            ? "bg-emerald-500 text-slate-950"
            : props.streaming
              ? "border border-emerald-400/30 bg-emerald-400/10 text-emerald-50"
              : "border border-white/10 bg-black/20 text-slate-100"
        }`}
      >
        <div className="mb-1 text-[11px] uppercase tracking-[0.2em] opacity-70">
          {props.streaming ? "assistant streaming" : props.role}
        </div>
        <div className="whitespace-pre-wrap">{props.message}</div>
      </div>
    </div>
  );
}
