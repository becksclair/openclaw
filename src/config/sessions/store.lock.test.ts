import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSessionStoreCacheForTest,
  resetSessionStoreLockRuntimeForTests,
  setSessionWriteLockAcquirerForTests,
  withSessionStoreLockForTest,
} from "./store.js";

const acquireSessionWriteLockMock = vi.hoisted(() =>
  vi.fn(async () => ({ release: vi.fn(async () => {}) })),
);

describe("withSessionStoreLock", () => {
  beforeEach(() => {
    acquireSessionWriteLockMock.mockClear();
    setSessionWriteLockAcquirerForTests(acquireSessionWriteLockMock);
  });

  afterEach(() => {
    clearSessionStoreCacheForTest();
    resetSessionStoreLockRuntimeForTests();
    vi.restoreAllMocks();
  });

  it("derives session lock hold time from the store lock timeout", async () => {
    await withSessionStoreLockForTest("/tmp/openclaw-store.json", async () => {}, {
      timeoutMs: 10_000,
    });

    expect(acquireSessionWriteLockMock).toHaveBeenCalledTimes(1);
    const calls = acquireSessionWriteLockMock.mock.calls as unknown as Array<
      [
        {
          sessionFile: string;
          staleMs: number;
          timeoutMs?: number;
          maxHoldMs?: number;
        },
      ]
    >;
    const call = calls[0]?.[0];
    expect(call).toMatchObject({
      sessionFile: "/tmp/openclaw-store.json",
      staleMs: 30_000,
    });
    expect(typeof call?.timeoutMs).toBe("number");
    expect(call?.timeoutMs).toBeGreaterThan(9_900);
    expect(call?.timeoutMs).toBeLessThanOrEqual(10_000);
    expect(typeof call?.maxHoldMs).toBe("number");
    expect(call?.maxHoldMs).toBeGreaterThanOrEqual(14_900);
    expect(call?.maxHoldMs).toBeLessThanOrEqual(15_000);
  });

  it("leaves the session lock hold time unset when store locking has no timeout", async () => {
    await withSessionStoreLockForTest("/tmp/openclaw-store.json", async () => {}, {
      timeoutMs: 0,
    });

    expect(acquireSessionWriteLockMock).toHaveBeenCalledWith({
      sessionFile: "/tmp/openclaw-store.json",
      timeoutMs: Number.POSITIVE_INFINITY,
      staleMs: 30_000,
      maxHoldMs: undefined,
    });
  });

  it("counts queue wait against the store lock timeout", async () => {
    const first = withSessionStoreLockForTest("/tmp/openclaw-store.json", async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });

    const second = withSessionStoreLockForTest("/tmp/openclaw-store.json", async () => "second", {
      timeoutMs: 20,
    });

    await expect(second).rejects.toThrow("timeout waiting for session store lock");
    await first;
    expect(acquireSessionWriteLockMock).toHaveBeenCalledTimes(1);
  });
});
