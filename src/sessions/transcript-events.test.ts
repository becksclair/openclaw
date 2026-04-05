import { afterEach, describe, expect, it, vi } from "vitest";
import { emitSessionTranscriptUpdate, onSessionTranscriptUpdate } from "./transcript-events.js";
import { resolveTranscriptUpdateMessageSeq } from "./transcript-message-seq.js";

const cleanup: Array<() => void> = [];

afterEach(() => {
  while (cleanup.length > 0) {
    cleanup.pop()?.();
  }
});

describe("transcript events", () => {
  it("emits trimmed session file updates", () => {
    const listener = vi.fn();
    cleanup.push(onSessionTranscriptUpdate(listener));

    emitSessionTranscriptUpdate("  /tmp/session.jsonl  ");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ sessionFile: "/tmp/session.jsonl" });
  });

  it("includes optional session metadata when provided", () => {
    const listener = vi.fn();
    cleanup.push(onSessionTranscriptUpdate(listener));

    emitSessionTranscriptUpdate({
      sessionFile: "  /tmp/session.jsonl  ",
      sessionKey: "  agent:main:main  ",
      message: { role: "assistant", content: "hi" },
      messageId: "  msg-1  ",
      messageSeq: 2,
    });

    expect(listener).toHaveBeenCalledWith({
      sessionFile: "/tmp/session.jsonl",
      sessionKey: "agent:main:main",
      message: { role: "assistant", content: "hi" },
      messageId: "msg-1",
      messageSeq: 2,
    });
  });

  it("continues notifying other listeners when one throws", () => {
    const first = vi.fn(() => {
      throw new Error("boom");
    });
    const second = vi.fn();
    cleanup.push(onSessionTranscriptUpdate(first));
    cleanup.push(onSessionTranscriptUpdate(second));

    expect(() => emitSessionTranscriptUpdate("/tmp/session.jsonl")).not.toThrow();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("resolveTranscriptUpdateMessageSeq", () => {
  it("prefers explicit messageSeq from the update", () => {
    expect(
      resolveTranscriptUpdateMessageSeq({
        update: { sessionFile: "/tmp/session.jsonl", messageSeq: 7 },
        previousSeq: 2,
        readPersistedCount: () => 99,
      }),
    ).toBe(7);
  });

  it("falls back to previousSeq before reading persisted message count", () => {
    const fallback = vi.fn(() => 99);

    expect(
      resolveTranscriptUpdateMessageSeq({
        update: { sessionFile: "/tmp/session.jsonl" },
        previousSeq: 7,
        readPersistedCount: fallback,
      }),
    ).toBe(8);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("reads persisted message count only when no better sequence exists", () => {
    expect(
      resolveTranscriptUpdateMessageSeq({
        update: { sessionFile: "/tmp/session.jsonl" },
        readPersistedCount: () => 4,
      }),
    ).toBe(4);
  });
});
