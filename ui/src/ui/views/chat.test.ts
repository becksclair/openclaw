/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppViewState } from "../app-view-state.ts";
import { resolveReadAloudAgentId } from "../chat/read-aloud-agent.ts";
import { stopTts, type SpeechGatewayClient } from "../chat/talk-tts.ts";
import type { SessionsListResult } from "../types.ts";
import { renderChat, type ChatProps } from "./chat.ts";

function createSessions(): SessionsListResult {
  return {
    ts: 0,
    path: "",
    count: 0,
    defaults: { modelProvider: null, model: null, contextTokens: null },
    sessions: [],
  };
}

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
    messages: [],
    sideResult: null,
    toolMessages: [],
    streamSegments: [],
    stream: null,
    streamStartedAt: null,
    assistantAvatarUrl: null,
    client: null,
    draft: "",
    queue: [],
    connected: true,
    canSend: true,
    disabledReason: null,
    error: null,
    sessions: createSessions(),
    focusMode: false,
    assistantName: "OpenClaw",
    assistantAvatar: null,
    localMediaPreviewRoots: [],
    onRefresh: () => undefined,
    onToggleFocusMode: () => undefined,
    onDraftChange: () => undefined,
    onSend: () => undefined,
    onQueueRemove: () => undefined,
    onDismissSideResult: () => undefined,
    onNewSession: () => undefined,
    agentsList: null,
    currentAgentId: "",
    onAgentChange: () => undefined,
    ...overrides,
  };
}

function flushTasks() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("chat read-aloud", () => {
  afterEach(() => {
    stopTts();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses the configured default agent for read-aloud on the main session alias", () => {
    const state = {
      sessionKey: "main",
      hello: {
        snapshot: {
          sessionDefaults: {
            defaultAgentId: "pi",
            mainKey: "main",
            mainSessionKey: "main",
          },
        },
      },
      agentsList: {
        defaultId: "pi",
        mainKey: "main",
        scope: "agents",
        agents: [
          { id: "pi", name: "Pi" },
          { id: "luke", name: "Luke" },
        ],
      },
      agentsSelectedId: "luke",
    } as unknown as AppViewState;

    expect(resolveReadAloudAgentId(state, state.agentsSelectedId)).toBe("pi");
  });

  it("keeps explicit agent sessions pinned to that agent for read-aloud", () => {
    const state = {
      sessionKey: "agent:luke:main",
      hello: {
        snapshot: {
          sessionDefaults: {
            defaultAgentId: "pi",
            mainKey: "main",
            mainSessionKey: "main",
          },
        },
      },
      agentsList: {
        defaultId: "pi",
        mainKey: "main",
        scope: "agents",
        agents: [
          { id: "pi", name: "Pi" },
          { id: "luke", name: "Luke" },
        ],
      },
    } as unknown as AppViewState;

    expect(resolveReadAloudAgentId(state, "pi")).toBe("luke");
  });

  it("routes the read-aloud button through talk.speak with the resolved agent id", async () => {
    const request = vi.fn(async (_method: string, _params?: unknown) => ({
      audioBase64: Buffer.from("voice").toString("base64"),
      mimeType: "audio/mpeg",
    }));
    const client: SpeechGatewayClient = {
      request: async <T>(method: string, params?: unknown) => (await request(method, params)) as T,
    };

    vi.stubGlobal(
      "Audio",
      class MockAudio {
        paused = false;
        ended = false;
        src = "";
        addEventListener() {}
        async play() {
          this.paused = false;
        }
        pause() {
          this.paused = true;
        }
        load() {}
      },
    );
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:voice"),
      revokeObjectURL: vi.fn(),
    });

    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          client,
          currentAgentId: "pi",
          messages: [
            {
              role: "assistant",
              content: "Hello from Pi",
              timestamp: 1,
            },
          ],
        }),
      ),
      container,
    );

    const button = container.querySelector<HTMLButtonElement>(".chat-tts-btn");
    expect(button).not.toBeNull();

    button!.click();
    await flushTasks();
    await flushTasks();

    expect(request).toHaveBeenCalledWith("talk.speak", {
      text: "Hello from Pi",
      agentId: "pi",
    });
  });
});
