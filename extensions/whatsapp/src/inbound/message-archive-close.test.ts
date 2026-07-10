import { afterEach, describe, expect, it, vi } from "vitest";

type MockWorkerInstance = {
  emit(event: string, ...args: unknown[]): boolean;
  posted: unknown[];
  terminate: ReturnType<typeof vi.fn>;
};

const workerState = vi.hoisted(() => ({
  instances: [] as MockWorkerInstance[],
}));

vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await vi.importActual<typeof import("node:events")>("node:events");
  class Worker extends EventEmitter {
    posted: unknown[] = [];
    terminate = vi.fn(async () => 0);

    constructor() {
      super();
      workerState.instances.push(this);
    }

    postMessage(message: unknown): void {
      this.posted.push(message);
    }
  }
  return { Worker };
});

import { createWhatsAppMessageArchive } from "./message-archive.js";

const silentLogger = {
  warn: () => {},
  error: () => {},
};

afterEach(() => {
  vi.useRealTimers();
  workerState.instances.length = 0;
});

describe("whatsapp message archive close lifecycle", () => {
  it("waits for the worker FIFO instead of terminating accepted work", async () => {
    vi.useFakeTimers();
    const archive = createWhatsAppMessageArchive({
      dbPath: "/tmp/openclaw-whatsapp-archive-close-test.db",
      accountId: "default",
      logger: silentLogger,
    });
    const worker = workerState.instances[0];
    archive?.store([
      {
        key: { id: "WAIT1", remoteJid: "1@s.whatsapp.net", fromMe: false },
        messageTimestamp: 1_770_000_000,
        message: { conversation: "wait" },
      },
    ]);

    let closeSettled = false;
    const closePromise = archive?.close().then(() => {
      closeSettled = true;
    });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(worker.posted).toEqual([
      expect.objectContaining({ type: "batch", batchId: 1 }),
      { type: "close" },
    ]);
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(closeSettled).toBe(false);

    worker.emit("message", { type: "batch-ack", batchId: 1, messageCount: 1 });
    expect(closeSettled).toBe(false);
    worker.emit("message", { type: "closed" });
    await closePromise;

    expect(closeSettled).toBe(true);
  });
});
