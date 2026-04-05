import type {
  RealtimeAssistantTurn,
  RealtimeConversationTransport,
  RealtimeProviderEvent,
  RealtimeSessionEvent,
  RealtimeSessionSnapshot,
  RealtimeTranscriptItem,
} from "./types.js";

export type CreateRealtimeSessionStateInput = {
  sessionId: string;
  transport: RealtimeConversationTransport;
  provider?: string;
  fallbackEnabled: boolean;
};

export function createRealtimeSessionState(
  input: CreateRealtimeSessionStateInput,
): RealtimeSessionSnapshot {
  return {
    sessionId: input.sessionId,
    transport: input.transport,
    provider: input.provider,
    fallbackEnabled: input.fallbackEnabled,
    mode: "realtime",
    state: "idle",
    transcript: [],
    assistantTurn: { state: "idle" },
  };
}

function nextTranscriptItem(
  current: RealtimeTranscriptItem | undefined,
  event: Extract<RealtimeProviderEvent, { type: "transcript.partial" | "transcript.final" }>,
): RealtimeTranscriptItem {
  const nextText =
    event.type === "transcript.partial" && current?.status === "partial"
      ? `${current.text}${event.text}`
      : event.text;
  return {
    itemId: event.itemId,
    role: event.role,
    status: event.type === "transcript.final" ? "final" : "partial",
    text: nextText,
    revision: (current?.revision ?? -1) + 1,
  };
}

function updateTranscript(
  transcript: RealtimeTranscriptItem[],
  item: RealtimeTranscriptItem,
): RealtimeTranscriptItem[] {
  const index = transcript.findIndex((entry) => entry.itemId === item.itemId);
  if (index === -1) {
    return [...transcript, item];
  }
  return transcript.map((entry, entryIndex) => (entryIndex === index ? item : entry));
}

function toAssistantTurn(
  current: RealtimeAssistantTurn,
  event: Extract<RealtimeProviderEvent, { type: "assistant.turn" }>,
): RealtimeAssistantTurn {
  return {
    turnId: event.turnId ?? current.turnId,
    state: event.state,
  };
}

export function applyRealtimeProviderEvent(
  state: RealtimeSessionSnapshot,
  event: RealtimeProviderEvent,
): { state: RealtimeSessionSnapshot; events: RealtimeSessionEvent[] } {
  if (state.state === "closed") {
    return { state, events: [] };
  }

  if (event.type === "transcript.partial" || event.type === "transcript.final") {
    const current = state.transcript.find((entry) => entry.itemId === event.itemId);
    const item = nextTranscriptItem(current, event);
    const nextState = event.role === "user" ? "listening" : state.state;
    return {
      state: {
        ...state,
        state: nextState,
        transcript: updateTranscript(state.transcript, item),
      },
      events: [
        ...(nextState === state.state
          ? []
          : [
              {
                type: "session.state.changed" as const,
                sessionId: state.sessionId,
                state: nextState,
              },
            ]),
        {
          type: "transcript.updated",
          sessionId: state.sessionId,
          item,
        },
      ],
    };
  }

  if (event.type === "assistant.turn") {
    const turn = toAssistantTurn(state.assistantTurn, event);
    const nextState =
      turn.state === "thinking"
        ? "thinking"
        : turn.state === "speaking"
          ? "speaking"
          : turn.state === "completed" || turn.state === "interrupted"
            ? "idle"
            : state.state;
    return {
      state: {
        ...state,
        state: nextState,
        assistantTurn: turn,
      },
      events: [
        {
          type: "session.state.changed",
          sessionId: state.sessionId,
          state: nextState,
        },
        {
          type: "assistant.turn.updated",
          sessionId: state.sessionId,
          turn,
        },
      ],
    };
  }

  if (event.type === "fallback") {
    if (!state.fallbackEnabled) {
      return {
        state,
        events: [
          {
            type: "session.error",
            sessionId: state.sessionId,
            code: "fallback_disabled",
            message: `Realtime fallback requested but fallback is disabled (${event.reason}).`,
            retryable: false,
          },
        ],
      };
    }
    return {
      state: {
        ...state,
        mode: "fallback",
        state: "idle",
      },
      events: [
        {
          type: "fallback.changed",
          sessionId: state.sessionId,
          mode: "fallback",
          reason: event.reason,
        },
        {
          type: "session.state.changed",
          sessionId: state.sessionId,
          state: "idle",
        },
      ],
    };
  }

  if (event.type === "tool.call") {
    return { state, events: [] };
  }

  if (event.type === "audio.output") {
    return {
      state: {
        ...state,
        state: "speaking",
      },
      events: [
        {
          type: "session.state.changed",
          sessionId: state.sessionId,
          state: "speaking",
        },
        {
          type: "audio.output",
          sessionId: state.sessionId,
          audio: {
            itemId: event.itemId,
            chunk: event.chunk,
            sampleRate: event.sampleRate,
            mimeType: event.mimeType,
          },
        },
      ],
    };
  }

  return {
    state,
    events: [
      {
        type: "session.error",
        sessionId: state.sessionId,
        code: event.code,
        message: event.message,
        retryable: event.retryable,
      },
    ],
  };
}
