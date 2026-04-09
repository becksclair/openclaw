/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stopTts } from "../chat/speech.ts";
import { renderChat, type ChatProps } from "./chat.ts";

function createProps(overrides: Partial<ChatProps> = {}): ChatProps {
  return {
    sessionKey: "main",
    onSessionKeyChange: () => undefined,
    thinkingLevel: null,
    showThinking: false,
    showToolCalls: true,
    loading: false,
    sending: false,
    canAbort: false,
    compactionStatus: null,
    fallbackStatus: null,
    messages: [
      {
        role: "assistant",
        timestamp: Date.now(),
        content: [{ type: "text", text: "assistant response for read aloud" }],
      },
    ],
    toolMessages: [],
    streamSegments: [],
    stream: null,
    streamStartedAt: null,
    assistantAvatarUrl: null,
    draft: "",
    queue: [],
    connected: true,
    canSend: true,
    disabledReason: null,
    error: null,
    sessions: {
      ts: 0,
      path: "",
      count: 1,
      defaults: { modelProvider: null, model: null, contextTokens: null },
      sessions: [{ key: "main", kind: "direct", updatedAt: Date.now() }],
    },
    focusMode: false,
    assistantName: "OpenClaw",
    assistantAvatar: null,
    onRefresh: () => undefined,
    onToggleFocusMode: () => undefined,
    onDraftChange: () => undefined,
    onSend: () => undefined,
    onQueueRemove: () => undefined,
    onNewSession: () => undefined,
    agentsList: null,
    currentAgentId: "main",
    onAgentChange: () => undefined,
    ...overrides,
  };
}

describe("chat view read-aloud affordance", () => {
  const originalAudio = (globalThis as Record<string, unknown>).Audio;

  afterEach(() => {
    stopTts();
    document.body.innerHTML = "";
    if (originalAudio === undefined) {
      delete (globalThis as Record<string, unknown>).Audio;
    } else {
      (globalThis as Record<string, unknown>).Audio = originalAudio;
    }
  });

  it("hides read-aloud controls when no gateway client is available", () => {
    (globalThis as Record<string, unknown>).Audio = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);

    render(renderChat(createProps({ client: null })), container);

    expect(container.querySelector(".chat-tts-btn")).toBeNull();
  });

  it("hides read-aloud controls when disconnected even with a gateway client", () => {
    (globalThis as Record<string, unknown>).Audio = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);

    render(
      renderChat(
        createProps({
          connected: false,
          canSend: false,
          client: {
            request: vi.fn(async () => ({ audioBase64: "", mimeType: "audio/mpeg" })),
          } as unknown as NonNullable<ChatProps["client"]>,
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-tts-btn")).toBeNull();
  });

  it("shows read-aloud controls when gateway client is available", () => {
    (globalThis as Record<string, unknown>).Audio = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);

    render(
      renderChat(
        createProps({
          client: {
            request: vi.fn(async () => ({ audioBase64: "", mimeType: "audio/mpeg" })),
          } as unknown as NonNullable<ChatProps["client"]>,
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-tts-btn")).not.toBeNull();
  });
});
