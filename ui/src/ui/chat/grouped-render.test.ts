/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageGroup } from "../types/chat-types.ts";

const speakTextMock = vi.hoisted(() => vi.fn(async () => true));
const stopTtsMock = vi.hoisted(() => vi.fn());
const isTtsSpeakingMock = vi.hoisted(() => vi.fn(() => false));
const isTtsSupportedMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("./speech.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./speech.ts")>();
  return {
    ...actual,
    isTtsSpeaking: isTtsSpeakingMock,
    isTtsSupported: isTtsSupportedMock,
    speakText: speakTextMock,
    stopTts: stopTtsMock,
  };
});

import { renderMessageGroup } from "./grouped-render.ts";

function createAssistantGroup(): MessageGroup {
  return {
    kind: "group",
    key: "g1",
    role: "assistant",
    senderLabel: null,
    timestamp: Date.now(),
    isStreaming: false,
    messages: [
      {
        key: "m1",
        message: {
          role: "assistant",
          timestamp: Date.now(),
          content: [{ type: "text", text: "Hello there" }],
        },
      },
    ],
  };
}

describe("grouped-render read aloud seam", () => {
  beforeEach(() => {
    speakTextMock.mockClear().mockResolvedValue(true);
    stopTtsMock.mockClear();
    isTtsSpeakingMock.mockReset().mockReturnValue(false);
    isTtsSupportedMock.mockReset().mockReturnValue(true);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the read-aloud button only when a gateway client is available", () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      renderMessageGroup(createAssistantGroup(), {
        showReasoning: false,
        assistantName: "OpenClaw",
      }),
      container,
    );

    expect(container.querySelector(".chat-tts-btn")).toBeNull();

    render(
      renderMessageGroup(createAssistantGroup(), {
        showReasoning: false,
        assistantName: "OpenClaw",
        client: { request: vi.fn() },
      }),
      container,
    );

    expect(container.querySelector(".chat-tts-btn")).not.toBeNull();
  });

  it("does not show the read-aloud button when browser playback is unsupported", () => {
    isTtsSupportedMock.mockReturnValue(false);
    const container = document.createElement("div");
    document.body.append(container);

    render(
      renderMessageGroup(createAssistantGroup(), {
        showReasoning: false,
        assistantName: "OpenClaw",
        client: { request: vi.fn() },
      }),
      container,
    );

    expect(container.querySelector(".chat-tts-btn")).toBeNull();
  });

  it("routes read-aloud clicks through the speech surface with the gateway client", async () => {
    const client = { request: vi.fn() };
    const onTtsError = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);

    render(
      renderMessageGroup(createAssistantGroup(), {
        showReasoning: false,
        assistantName: "OpenClaw",
        client,
        onTtsError,
      }),
      container,
    );

    const button = container.querySelector<HTMLButtonElement>(".chat-tts-btn");
    expect(button).not.toBeNull();
    button?.click();
    await Promise.resolve();

    expect(speakTextMock).toHaveBeenCalledWith(
      "Hello there",
      client,
      expect.objectContaining({
        onEnd: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
    expect(onTtsError).toHaveBeenCalledWith(null);
  });
});
