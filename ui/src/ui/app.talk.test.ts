/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { realtimeTalkCtor, startMock, stopMock } = vi.hoisted(() => ({
  realtimeTalkCtor: vi.fn(),
  startMock: vi.fn(),
  stopMock: vi.fn(),
}));

describe("OpenClawApp Talk controls", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("./chat/realtime-talk.ts", () => ({
      RealtimeTalkSession: realtimeTalkCtor,
    }));
    realtimeTalkCtor.mockReset();
    startMock.mockReset();
    stopMock.mockReset();
    realtimeTalkCtor.mockImplementation(
      function MockRealtimeTalkSession(this: { start: typeof startMock; stop: typeof stopMock }) {
        this.start = startMock;
        this.stop = stopMock;
      },
    );
    startMock.mockResolvedValue(undefined);
  });

  it("retries Talk immediately when the previous session is already in error state", async () => {
    const { OpenClawApp } = await import("./app.ts");
    const app = Object.create(OpenClawApp.prototype) as {
      client: unknown;
      connected: boolean;
      lastError: string | null;
      realtimeTalkActive: boolean;
      realtimeTalkDetail: string | null;
      realtimeTalkStatus: string;
      realtimeTalkSession: { stop(): void } | null;
      realtimeTalkTranscript: string | null;
      sessionKey: string;
      assistantAgentId?: string | null;
    };
    const staleStop = vi.fn();
    Object.defineProperties(app, {
      client: { value: { request: vi.fn() }, writable: true },
      connected: { value: true, writable: true },
      lastError: { value: null, writable: true },
      realtimeTalkActive: { value: true, writable: true },
      realtimeTalkDetail: { value: null, writable: true },
      realtimeTalkSession: { value: { stop: staleStop }, writable: true },
      realtimeTalkStatus: { value: "error", writable: true },
      realtimeTalkTranscript: { value: null, writable: true },
      sessionKey: { value: "main", writable: true },
      assistantAgentId: { value: null, writable: true },
    });

    await OpenClawApp.prototype.toggleRealtimeTalk.call(app as never);

    expect(staleStop).toHaveBeenCalledOnce();
    expect(realtimeTalkCtor).toHaveBeenCalledOnce();
    expect(startMock).toHaveBeenCalledOnce();
    expect(stopMock).not.toHaveBeenCalled();
    expect(app.realtimeTalkStatus).toBe("connecting");
    expect(app.realtimeTalkSession).not.toBeNull();
  });

  it("starts realtime Talk with an agent-scoped session key for the active assistant", async () => {
    const { OpenClawApp } = await import("./app.ts");
    const app = Object.create(OpenClawApp.prototype) as {
      client: unknown;
      connected: boolean;
      lastError: string | null;
      realtimeTalkActive: boolean;
      realtimeTalkDetail: string | null;
      realtimeTalkStatus: string;
      realtimeTalkSession: { stop(): void } | null;
      realtimeTalkTranscript: string | null;
      sessionKey: string;
      assistantAgentId: string | null;
    };
    Object.defineProperties(app, {
      client: { value: { request: vi.fn() }, writable: true },
      connected: { value: true, writable: true },
      lastError: { value: null, writable: true },
      realtimeTalkActive: { value: false, writable: true },
      realtimeTalkDetail: { value: null, writable: true },
      realtimeTalkSession: { value: null, writable: true },
      realtimeTalkStatus: { value: "idle", writable: true },
      realtimeTalkTranscript: { value: null, writable: true },
      sessionKey: { value: "main", writable: true },
      assistantAgentId: { value: "luke", writable: true },
    });

    await OpenClawApp.prototype.toggleRealtimeTalk.call(app as never);

    expect(realtimeTalkCtor).toHaveBeenCalledWith(
      app.client,
      "agent:luke:main",
      expect.objectContaining({
        onStatus: expect.any(Function),
        onTranscript: expect.any(Function),
      }),
    );
    expect(startMock).toHaveBeenCalledOnce();
  });

  it("preserves a fully scoped agent session key when starting realtime Talk", async () => {
    const { OpenClawApp } = await import("./app.ts");
    const app = Object.create(OpenClawApp.prototype) as {
      client: unknown;
      connected: boolean;
      lastError: string | null;
      realtimeTalkActive: boolean;
      realtimeTalkDetail: string | null;
      realtimeTalkStatus: string;
      realtimeTalkSession: { stop(): void } | null;
      realtimeTalkTranscript: string | null;
      sessionKey: string;
      assistantAgentId: string | null;
    };
    Object.defineProperties(app, {
      client: { value: { request: vi.fn() }, writable: true },
      connected: { value: true, writable: true },
      lastError: { value: null, writable: true },
      realtimeTalkActive: { value: false, writable: true },
      realtimeTalkDetail: { value: null, writable: true },
      realtimeTalkSession: { value: null, writable: true },
      realtimeTalkStatus: { value: "idle", writable: true },
      realtimeTalkTranscript: { value: null, writable: true },
      sessionKey: { value: "agent:sky:discord:direct:708530820616552498", writable: true },
      assistantAgentId: { value: "sky", writable: true },
    });

    await OpenClawApp.prototype.toggleRealtimeTalk.call(app as never);

    expect(realtimeTalkCtor).toHaveBeenCalledWith(
      app.client,
      "agent:sky:discord:direct:708530820616552498",
      expect.objectContaining({
        onStatus: expect.any(Function),
        onTranscript: expect.any(Function),
      }),
    );
    expect(startMock).toHaveBeenCalledOnce();
  });
});
