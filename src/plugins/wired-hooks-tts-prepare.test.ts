/** Tests tts_prepare enrichment through wired plugin hook flows. */
import { describe, expect, it, vi } from "vitest";
import type { PluginHookTtsPrepareContext, PluginHookTtsPrepareEvent } from "./hook-types.js";
import { createHookRunnerWithRegistry } from "./hooks.test-helpers.js";

const ttsPrepareEvent: PluginHookTtsPrepareEvent = {
  text: "hello",
  maxTextLength: 5_000,
  providerId: "elevenlabs",
  providerModelId: "eleven_v3",
  personaId: "luke",
  attempt: 0,
};

const ttsPrepareCtx: PluginHookTtsPrepareContext = {
  channelId: "telegram",
  accountId: "default",
  sessionKey: "agent:test:session",
  runId: "run-123",
};

function firstErrorLog(logger: { error: ReturnType<typeof vi.fn> }) {
  return logger.error.mock.calls[0];
}

describe("tts_prepare hook runner", () => {
  it("passes the latest text between handlers", async () => {
    const first = vi.fn().mockResolvedValue({ text: "hello [warm]" });
    const second = vi.fn().mockImplementation(async (event: PluginHookTtsPrepareEvent) => ({
      text: `${event.text} [amused]`,
    }));
    const { runner } = createHookRunnerWithRegistry([
      { hookName: "tts_prepare", handler: first },
      { hookName: "tts_prepare", handler: second },
    ]);

    const result = await runner.runTtsPrepare(ttsPrepareEvent, ttsPrepareCtx);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(
      { ...ttsPrepareEvent, text: "hello [warm]" },
      ttsPrepareCtx,
    );
    expect(result).toEqual({ text: "hello [warm] [amused]" });
  });

  it("spread-merges providerOverrides across handlers", async () => {
    const first = vi
      .fn()
      .mockResolvedValue({ providerOverrides: { applyTextNormalization: "off" } });
    const second = vi
      .fn()
      .mockResolvedValue({ text: "hello!", providerOverrides: { model: "eleven_v3" } });
    const { runner } = createHookRunnerWithRegistry([
      { hookName: "tts_prepare", handler: first },
      { hookName: "tts_prepare", handler: second },
    ]);

    const result = await runner.runTtsPrepare(ttsPrepareEvent, ttsPrepareCtx);

    expect(result).toEqual({
      text: "hello!",
      providerOverrides: { applyTextNormalization: "off", model: "eleven_v3" },
    });
  });

  it("continues after handler errors", async () => {
    const logger = {
      warn: vi.fn(),
      error: vi.fn(),
    };
    const failing = vi.fn().mockRejectedValue(new Error("boom"));
    const succeeding = vi.fn().mockResolvedValue({ text: "ok" });
    const { runner } = createHookRunnerWithRegistry(
      [
        { hookName: "tts_prepare", handler: failing },
        { hookName: "tts_prepare", handler: succeeding },
      ],
      { logger },
    );

    const result = await runner.runTtsPrepare(ttsPrepareEvent, ttsPrepareCtx);

    expect(result).toEqual({ text: "ok" });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(firstErrorLog(logger)).toEqual([
      "[hooks] tts_prepare handler from test-plugin failed: boom",
    ]);
  });

  it("returns undefined when no handler mutates the request", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const { runner } = createHookRunnerWithRegistry([{ hookName: "tts_prepare", handler }]);

    const result = await runner.runTtsPrepare(ttsPrepareEvent, ttsPrepareCtx);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();
  });
});
