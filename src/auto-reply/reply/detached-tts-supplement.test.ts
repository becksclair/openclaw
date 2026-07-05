import { afterEach, describe, expect, it, vi } from "vitest";
import { isReplyPayloadTtsSupplement, type ReplyPayload } from "../reply-payload.js";
import { detachTtsSupplement } from "./detached-tts-supplement.js";
import { __testing, waitForDetachedTtsTasks } from "./detached-tts-tasks.js";

// The supplement helper registers a detached task; drain it so assertions run
// after the task body settles.
async function drain(): Promise<void> {
  await waitForDetachedTtsTasks(1_000);
}

const identityNormalize = async (payload: ReplyPayload): Promise<ReplyPayload> => payload;

describe("detachTtsSupplement", () => {
  afterEach(() => {
    __testing.reset();
    vi.restoreAllMocks();
  });

  it("delivers an audio-only supplement with visibleTextAlreadyDelivered and no leaked text", async () => {
    const deliver = vi.fn(async (_payload: ReplyPayload, _signal: AbortSignal) => undefined);
    const synthesize = vi.fn(
      async (): Promise<ReplyPayload> => ({
        mediaUrl: "/tmp/openclaw/voice.opus",
        audioAsVoice: true,
      }),
    );
    detachTtsSupplement({
      opAbortSignal: new AbortController().signal,
      visibleText: "hello world",
      synthesize,
      normalize: identityNormalize,
      deliver,
    });
    await drain();

    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledTimes(1);
    const payload = deliver.mock.calls[0]?.[0] as ReplyPayload;
    expect(isReplyPayloadTtsSupplement(payload)).toBe(true);
    expect(payload.ttsSupplement?.visibleTextAlreadyDelivered).toBe(true);
    expect(payload.ttsSupplement?.spokenText).toBe("hello world");
    // The audio-only supplement carries no visible text.
    expect(payload.text).toBeUndefined();
    expect(payload.mediaUrl).toBe("/tmp/openclaw/voice.opus");
    expect(payload.audioAsVoice).toBe(true);
  });

  it("does not deliver when synthesis produced no media", async () => {
    const deliver = vi.fn(async () => undefined);
    detachTtsSupplement({
      opAbortSignal: new AbortController().signal,
      visibleText: "hello",
      synthesize: async () => ({ text: "hello" }),
      normalize: identityNormalize,
      deliver,
    });
    await drain();
    expect(deliver).not.toHaveBeenCalled();
  });

  it("fires onFinalReplyPayload with the supplement before deliver", async () => {
    const order: string[] = [];
    const deliver = vi.fn(async () => {
      order.push("deliver");
    });
    const onFinalReplyPayload = vi.fn((payload: ReplyPayload) => {
      order.push("onFinal");
      expect(isReplyPayloadTtsSupplement(payload)).toBe(true);
    });
    detachTtsSupplement({
      opAbortSignal: new AbortController().signal,
      visibleText: "hi",
      synthesize: async () => ({ mediaUrl: "/tmp/openclaw/voice.opus", audioAsVoice: true }),
      normalize: identityNormalize,
      deliver,
      onFinalReplyPayload,
    });
    await drain();
    expect(onFinalReplyPayload).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["onFinal", "deliver"]);
  });

  it("does nothing when the op abort signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const synthesize = vi.fn(async () => ({ mediaUrl: "/tmp/openclaw/voice.opus" }));
    const deliver = vi.fn(async () => undefined);
    detachTtsSupplement({
      opAbortSignal: controller.signal,
      visibleText: "hi",
      synthesize,
      normalize: identityNormalize,
      deliver,
    });
    await drain();
    expect(synthesize).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it("swallows a throwing deliver and logs instead of rejecting", async () => {
    const log = vi.fn();
    const deliver = vi.fn(async () => {
      throw new Error("send failed");
    });
    detachTtsSupplement({
      opAbortSignal: new AbortController().signal,
      visibleText: "hi",
      synthesize: async () => ({ mediaUrl: "/tmp/openclaw/voice.opus", audioAsVoice: true }),
      normalize: identityNormalize,
      deliver,
      log,
    });
    // Must drain without an unhandled rejection.
    const drained = await waitForDetachedTtsTasks(1_000);
    expect(drained).toBe(true);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toContain("detached TTS supplement failed");
  });
});
