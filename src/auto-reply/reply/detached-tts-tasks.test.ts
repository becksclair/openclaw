import { afterEach, describe, expect, it } from "vitest";
import {
  __testing,
  getDetachedTtsTaskCount,
  registerDetachedTtsTask,
  waitForDetachedTtsTasks,
} from "./detached-tts-tasks.js";

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("detached-tts-tasks", () => {
  afterEach(() => {
    __testing.reset();
  });

  it("increments the count while a task is in flight and decrements on completion", async () => {
    const deferred = createDeferred();
    registerDetachedTtsTask(() => deferred.promise);
    expect(getDetachedTtsTaskCount()).toBe(1);
    deferred.resolve();
    // Yield so the finally-block tracking removal runs.
    await Promise.resolve();
    await Promise.resolve();
    expect(getDetachedTtsTaskCount()).toBe(0);
  });

  it("waits for a pending task's completion before draining", async () => {
    const deferred = createDeferred();
    let taskSettled = false;
    registerDetachedTtsTask(async () => {
      await deferred.promise;
      taskSettled = true;
    });
    const drainPromise = waitForDetachedTtsTasks(1_000);
    expect(getDetachedTtsTaskCount()).toBe(1);
    deferred.resolve();
    const drained = await drainPromise;
    expect(drained).toBe(true);
    expect(taskSettled).toBe(true);
    expect(getDetachedTtsTaskCount()).toBe(0);
  });

  it("returns false without hanging when timeoutMs is 0 and a task is pending", async () => {
    const deferred = createDeferred();
    registerDetachedTtsTask(() => deferred.promise);
    const drained = await waitForDetachedTtsTasks(0);
    expect(drained).toBe(false);
    // The task is still tracked; releasing it keeps the registry consistent.
    deferred.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(getDetachedTtsTaskCount()).toBe(0);
  });

  it("returns true immediately when nothing is in flight", async () => {
    expect(await waitForDetachedTtsTasks(0)).toBe(true);
  });

  it("never rejects when a task throws and still decrements the count", async () => {
    registerDetachedTtsTask(async () => {
      throw new Error("boom");
    });
    // A throwing task must settle the drain rather than reject it.
    const drained = await waitForDetachedTtsTasks(1_000);
    expect(drained).toBe(true);
    expect(getDetachedTtsTaskCount()).toBe(0);
  });

  it("clears all tracked tasks via __testing.reset", () => {
    const deferred = createDeferred();
    registerDetachedTtsTask(() => deferred.promise);
    expect(getDetachedTtsTaskCount()).toBe(1);
    __testing.reset();
    expect(getDetachedTtsTaskCount()).toBe(0);
    deferred.resolve();
  });
});
