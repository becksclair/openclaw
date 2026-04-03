import {
  abortDesktopChatRun,
  applyDesktopChatEvent,
  createDesktopChatState,
  loadDesktopChatHistory,
  resolveMainSessionKey,
  sendDesktopChatMessage,
  type DesktopChatMessage,
} from "@openclaw/desktop-core/controllers/chat";
import type { GatewayBrowserClient, GatewayEventFrame } from "@openclaw/desktop-core/gateway";
import { useEffect, useMemo, useState } from "react";

type DesktopChatHookState = {
  input: string;
  loading: boolean;
  messages: DesktopChatMessage[];
  runId: string | null;
  sending: boolean;
  sessionKey: string;
  stream: string | null;
  error: string | null;
};

export function useDesktopChat(params: {
  client: GatewayBrowserClient | null;
  connected: boolean;
  lastEvent: GatewayEventFrame | null;
}) {
  const [state, setState] = useState<DesktopChatHookState>({
    input: "",
    loading: false,
    messages: [],
    runId: null,
    sending: false,
    sessionKey: "main",
    stream: null,
    error: null,
  });

  useEffect(() => {
    const client = params.client;
    if (!client || !params.connected) {
      setState((current) => ({
        ...current,
        loading: false,
        messages: [],
        runId: null,
        sessionKey: "main",
        stream: null,
      }));
      return;
    }

    let cancelled = false;
    void (async () => {
      const sessionKey = await resolveMainSessionKey(client);
      if (cancelled) {
        return;
      }
      const nextState = createDesktopChatState(sessionKey);
      await loadDesktopChatHistory(client, nextState);
      if (cancelled) {
        return;
      }
      setState((current) => ({
        ...current,
        error: nextState.lastError,
        loading: nextState.chatLoading,
        messages: nextState.chatMessages,
        runId: nextState.chatRunId,
        sending: nextState.chatSending,
        sessionKey: nextState.sessionKey,
        stream: nextState.chatStream,
      }));
    })();

    return () => {
      cancelled = true;
    };
  }, [params.client, params.connected]);

  useEffect(() => {
    const lastEvent = params.lastEvent;
    if (!lastEvent) {
      return;
    }
    setState((current) => {
      const nextState = createDesktopChatState(current.sessionKey);
      nextState.chatLoading = current.loading;
      nextState.chatMessages = current.messages;
      nextState.chatRunId = current.runId;
      nextState.chatSending = current.sending;
      nextState.chatStream = current.stream;
      nextState.lastError = current.error;
      if (!applyDesktopChatEvent(nextState, lastEvent)) {
        return current;
      }
      return {
        ...current,
        error: nextState.lastError,
        messages: nextState.chatMessages,
        runId: nextState.chatRunId,
        stream: nextState.chatStream,
      };
    });
  }, [params.lastEvent]);

  const actions = useMemo(
    () => ({
      async abort() {
        if (!params.client) {
          return false;
        }
        const nextState = createDesktopChatState(state.sessionKey);
        nextState.chatMessages = state.messages;
        nextState.chatRunId = state.runId;
        nextState.chatStream = state.stream;
        nextState.lastError = state.error;
        const ok = await abortDesktopChatRun(params.client, nextState);
        setState((current) => ({
          ...current,
          error: nextState.lastError,
          runId: ok ? null : current.runId,
          stream: ok ? null : current.stream,
        }));
        return ok;
      },
      async refresh() {
        if (!params.client || !params.connected) {
          return;
        }
        const nextState = createDesktopChatState(state.sessionKey);
        await loadDesktopChatHistory(params.client, nextState);
        setState((current) => ({
          ...current,
          error: nextState.lastError,
          loading: nextState.chatLoading,
          messages: nextState.chatMessages,
          stream: nextState.chatStream,
        }));
      },
      async send() {
        if (!params.client || !params.connected) {
          return;
        }
        const message = state.input.trim();
        if (!message) {
          return;
        }
        const nextState = createDesktopChatState(state.sessionKey);
        nextState.chatMessages = state.messages;
        nextState.chatRunId = state.runId;
        nextState.chatStream = state.stream;
        nextState.lastError = state.error;
        nextState.chatSending = state.sending;
        const runId = await sendDesktopChatMessage(params.client, nextState, message);
        setState((current) => ({
          ...current,
          error: nextState.lastError,
          input: runId ? "" : current.input,
          messages: nextState.chatMessages,
          runId: nextState.chatRunId,
          sending: nextState.chatSending,
          stream: nextState.chatStream,
        }));
      },
      setInput(input: string) {
        setState((current) => ({ ...current, input }));
      },
    }),
    [params.client, params.connected, state.error, state.input, state.messages, state.runId, state.sending, state.sessionKey, state.stream],
  );

  return {
    ...state,
    ...actions,
    hasLiveRun: Boolean(state.runId),
  };
}
