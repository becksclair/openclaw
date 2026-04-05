import { resolveAgentDir } from "../../agents/agent-scope.js";
import { resolveRealtimeSessionBootstrap } from "../../agents/realtime-session-bootstrap.js";
import type { OpenClawConfig } from "../../config/config.js";
import { createRealtimeProviderAdapter } from "./providers/index.js";
import { DEFAULT_OPENAI_REALTIME_MODEL } from "./providers/openai.js";
import { InMemoryRealtimeConversationSession } from "./session.js";
import { DefaultRealtimeToolRuntime } from "./tool-runtime.js";
import type {
  RealtimeConversationTransport,
  RealtimeSessionBootstrap,
  RealtimeSessionEvent,
  RealtimeToolDefinition,
  RealtimeTransportRuntime,
} from "./types.js";

export type ManagedRealtimeConversationTurnDetectionOptions = {
  vadEagerness?: "auto" | "low" | "medium" | "high";
  interruptResponse?: boolean;
};

export type ManagedRealtimeConversationRuntimeOptions = {
  cfg: OpenClawConfig;
  agentId: string;
  sessionKey: string;
  senderIsOwner?: boolean;
  provider?: "openai" | "google-live";
  model?: string;
  transport?: RealtimeConversationTransport;
  historyOverlay?: RealtimeSessionBootstrap["history"];
  turnDetection?: ManagedRealtimeConversationTurnDetectionOptions;
};

export type ManagedRealtimeConversationRuntime = RealtimeTransportRuntime & {
  listTools(): RealtimeToolDefinition[];
};

function resolveRealtimeModel(provider: "openai" | "google-live", model?: string): string {
  if (model?.trim()) {
    return model.trim();
  }
  if (provider === "openai") {
    return DEFAULT_OPENAI_REALTIME_MODEL;
  }
  return "google-live";
}

export function createManagedRealtimeConversationRuntime(
  options: ManagedRealtimeConversationRuntimeOptions,
): ManagedRealtimeConversationRuntime {
  const providerId = options.provider ?? "openai";
  const transport = options.transport ?? "discord";
  const agentDir = resolveAgentDir(options.cfg, options.agentId);
  const model = resolveRealtimeModel(providerId, options.model);
  const listeners = new Set<(event: RealtimeSessionEvent) => void>();
  const listenerUnsubscribes = new Map<(event: RealtimeSessionEvent) => void, () => void>();
  let session: InMemoryRealtimeConversationSession | undefined;
  let toolRuntime: DefaultRealtimeToolRuntime | undefined;
  let initializePromise: Promise<void> | undefined;

  const attachListener = (listener: (event: RealtimeSessionEvent) => void) => {
    if (!session || listenerUnsubscribes.has(listener)) {
      return;
    }
    listenerUnsubscribes.set(listener, session.subscribe(listener));
  };

  const initialize = async () => {
    if (session) {
      return;
    }
    if (initializePromise) {
      await initializePromise;
      return;
    }
    initializePromise = (async () => {
      toolRuntime = new DefaultRealtimeToolRuntime({
        config: options.cfg,
        sessionKey: options.sessionKey,
        agentDir,
        senderIsOwner: options.senderIsOwner ?? false,
        messageProvider: "voice",
      });
      const bootstrap = await resolveRealtimeSessionBootstrap({
        cfg: options.cfg,
        agentId: options.agentId,
        sessionKey: options.sessionKey,
        senderIsOwner: options.senderIsOwner ?? false,
        provider: providerId,
        model,
        transport,
        tools: toolRuntime.listTools(),
        historyOverlay: options.historyOverlay,
      });
      toolRuntime = new DefaultRealtimeToolRuntime({
        config: options.cfg,
        workspaceDir: bootstrap.workspaceDir,
        sessionKey: options.sessionKey,
        agentDir,
        senderIsOwner: options.senderIsOwner ?? false,
        messageProvider: "voice",
      });
      const provider = createRealtimeProviderAdapter({
        provider: providerId,
        cfg: options.cfg,
        agentDir,
        model,
        transport,
        turnDetection: options.turnDetection,
      });
      provider.configureBootstrap?.(bootstrap.bootstrap);
      session = new InMemoryRealtimeConversationSession({
        transport,
        provider: providerId,
        providerBinding: { adapter: provider },
        toolBinding: { runtime: toolRuntime },
      });
      for (const listener of listeners) {
        attachListener(listener);
      }
    })();
    try {
      await initializePromise;
    } finally {
      initializePromise = undefined;
    }
  };

  return {
    async start(): Promise<void> {
      await initialize();
      await session?.start();
    },
    async close(reason?: string): Promise<void> {
      await session?.close(reason);
    },
    async interrupt(target?: "assistant" | "user-input"): Promise<void> {
      await session?.interrupt(target);
    },
    async submitText(text: string): Promise<void> {
      await session?.submitText(text);
    },
    async submitAudio(
      pcm: Buffer,
      audioOptions: { sampleRate: number; channels: number },
    ): Promise<void> {
      await session?.submitAudio(pcm, audioOptions);
    },
    subscribe(listener: (event: RealtimeSessionEvent) => void): () => void {
      listeners.add(listener);
      attachListener(listener);
      return () => {
        listeners.delete(listener);
        listenerUnsubscribes.get(listener)?.();
        listenerUnsubscribes.delete(listener);
      };
    },
    listTools(): RealtimeToolDefinition[] {
      return toolRuntime?.listTools() ?? [];
    },
  };
}
