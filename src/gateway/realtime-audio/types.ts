export type RealtimeSessionMode = "realtime" | "fallback";

export type RealtimeSessionState = "idle" | "listening" | "thinking" | "speaking" | "closed";

export type RealtimeTransportState =
  | "idle"
  | "signaling"
  | "connecting"
  | "connected"
  | "failed"
  | "closed";

export type RealtimeAssistantTurnState =
  | "idle"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "completed";

export type RealtimeTranscriptRole = "user" | "assistant";

export type RealtimeTranscriptStatus = "partial" | "final";

export type RealtimeFallbackReasonCode =
  | "provider_unavailable"
  | "provider_failed"
  | "transport_unavailable"
  | "policy_blocked"
  | "operator_forced";

export type RealtimeConversationTransport = "desktop" | "discord" | "test";

export type RealtimeToolCallStatus = "queued" | "running" | "approval" | "completed" | "failed";

export type RealtimeToolCallUpdate = {
  toolCallId: string;
  toolName: string;
  status: RealtimeToolCallStatus;
  text?: string;
  approval?: {
    approvalId: string;
    approvalSlug?: string;
    expiresAtMs?: number;
  };
  error?: {
    code: string;
    message: string;
  };
};

export type RealtimeToolDefinition = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
};

export type RealtimeSessionBootstrap = {
  instructions?: string;
  history?: Array<{
    role: "user" | "assistant";
    text: string;
  }>;
};

export type RealtimeTranscriptItem = {
  itemId: string;
  role: RealtimeTranscriptRole;
  status: RealtimeTranscriptStatus;
  text: string;
  revision: number;
};

export type RealtimeAssistantTurn = {
  turnId?: string;
  state: RealtimeAssistantTurnState;
};

export type RealtimeOutputAudio = {
  itemId: string;
  chunk: Buffer;
  sampleRate: number;
  mimeType: string;
};

export type RealtimeTransportSignal =
  | {
      kind: "offer" | "answer";
      sdp: string;
    }
  | {
      kind: "ice-candidate";
      candidate: string;
      sdpMid?: string;
      sdpMLineIndex?: number;
    }
  | {
      kind: "end-of-candidates";
    };

export type RealtimeSessionCapabilities = {
  textInput: boolean;
  audioInput: boolean;
  toolCalls: boolean;
  toolResultContinuation: boolean;
  transportSignal: boolean;
};

export type RealtimeSessionEvent =
  | {
      type: "session.created";
      sessionId: string;
      mode: RealtimeSessionMode;
      state: RealtimeSessionState;
    }
  | {
      type: "session.state.changed";
      sessionId: string;
      state: RealtimeSessionState;
    }
  | {
      type: "transcript.updated";
      sessionId: string;
      item: RealtimeTranscriptItem;
    }
  | {
      type: "assistant.turn.updated";
      sessionId: string;
      turn: RealtimeAssistantTurn;
    }
  | {
      type: "interrupt.acknowledged";
      sessionId: string;
      target: "assistant" | "user-input";
    }
  | {
      type: "fallback.changed";
      sessionId: string;
      mode: "fallback";
      reason: RealtimeFallbackReasonCode;
    }
  | {
      type: "session.closed";
      sessionId: string;
      reason?: string;
    }
  | {
      type: "tool.updated";
      sessionId: string;
      update: RealtimeToolCallUpdate;
    }
  | {
      type: "audio.output";
      sessionId: string;
      audio: RealtimeOutputAudio;
    }
  | {
      type: "transport.state.changed";
      sessionId: string;
      state: RealtimeTransportState;
    }
  | {
      type: "transport.signal";
      sessionId: string;
      signal: RealtimeTransportSignal;
    }
  | {
      type: "session.error";
      sessionId: string;
      code: string;
      message: string;
      retryable?: boolean;
    };

export type RealtimeSessionSnapshot = {
  sessionId: string;
  transport: RealtimeConversationTransport;
  provider?: string;
  fallbackEnabled: boolean;
  mode: RealtimeSessionMode;
  state: RealtimeSessionState;
  transcript: RealtimeTranscriptItem[];
  assistantTurn: RealtimeAssistantTurn;
  closedReason?: string;
};

export type RealtimeSessionProviderBinding = {
  adapter: RealtimeProviderAdapter;
  unsubscribe?: () => void;
};

export interface RealtimeToolRuntime {
  listTools(): RealtimeToolDefinition[];
  invoke(
    toolCallId: string,
    toolName: string,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<unknown>;
  subscribe(listener: (update: RealtimeToolCallUpdate) => void): () => void;
}

export interface RealtimeTransportBridge {
  start?(): Promise<void>;
  close?(): Promise<void>;
  submitSignal(signal: RealtimeTransportSignal): Promise<void>;
  subscribe(listener: (event: RealtimeTransportBridgeEvent) => void): () => void;
}

export type RealtimeTransportBridgeEvent =
  | {
      type: "transport.state";
      state: RealtimeTransportState;
    }
  | {
      type: "transport.signal";
      signal: RealtimeTransportSignal;
    };

export interface RealtimeTransportRuntime {
  start(): Promise<void>;
  close(reason?: string): Promise<void>;
  interrupt(target?: "assistant" | "user-input"): Promise<void>;
  submitText(text: string): Promise<void>;
  submitAudio(pcm: Buffer, options: { sampleRate: number; channels: number }): Promise<void>;
  subscribe(listener: (event: RealtimeSessionEvent) => void): () => void;
}

export type RealtimeSessionToolBinding = {
  runtime: RealtimeToolRuntime;
  unsubscribe?: () => void;
};

export type RealtimeSessionTransportBinding = {
  bridge: RealtimeTransportBridge;
  unsubscribe?: () => void;
};

import type { RealtimeProviderAdapter } from "./providers/types.js";

export type RealtimeProviderEvent =
  | {
      type: "transcript.partial";
      itemId: string;
      role: RealtimeTranscriptRole;
      text: string;
    }
  | {
      type: "transcript.final";
      itemId: string;
      role: RealtimeTranscriptRole;
      text: string;
    }
  | {
      type: "assistant.turn";
      state: Exclude<RealtimeAssistantTurnState, "idle">;
      turnId?: string;
    }
  | {
      type: "tool.call";
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: "audio.output";
      itemId: string;
      chunk: Buffer;
      sampleRate: number;
      mimeType: string;
    }
  | {
      type: "fallback";
      reason: RealtimeFallbackReasonCode;
    }
  | {
      type: "error";
      code: string;
      message: string;
      retryable?: boolean;
    };

export interface RealtimeConversationSession {
  readonly id: string;
  start(): Promise<void>;
  interrupt(target?: "assistant" | "user-input"): Promise<void>;
  close(reason?: string): Promise<void>;
  submitText(text: string): Promise<void>;
  submitAudio(pcm: Buffer, options: { sampleRate: number; channels: number }): Promise<void>;
  submitTransportSignal(signal: RealtimeTransportSignal): Promise<void>;
  submitPendingToolResult(toolCallId: string, output: string): Promise<void>;
  invokeToolCall(
    toolCallId: string,
    toolName: string,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<unknown>;
  handleProviderEvent(event: RealtimeProviderEvent): void;
  getSnapshot(): RealtimeSessionSnapshot;
  getCapabilities(): RealtimeSessionCapabilities;
  subscribe(listener: (event: RealtimeSessionEvent) => void): () => void;
}
