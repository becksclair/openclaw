/** Tests ACP manager session initialization limits and persisted runtime options. */
import { describe, expect, it, vi } from "vitest";
import {
  AcpSessionManager,
  baseCfg,
  createRuntime,
  expectRecordFields,
  expectRejectedRecord,
  extractRuntimeOptionsFromUpserts,
  hoisted,
  installAcpSessionManagerTestLifecycle,
  mockCallArg,
  readySessionMeta,
  type OpenClawConfig,
} from "./manager.test-helpers.js";

describe("AcpSessionManager initializeSession", () => {
  installAcpSessionManagerTestLifecycle();

  it("enforces acp.maxConcurrentSessions during initializeSession", async () => {
    const runtimeState = createRuntime();
    hoisted.requireAcpRuntimeBackendMock.mockReturnValue({
      id: "acpx",
      runtime: runtimeState.runtime,
    });
    hoisted.upsertAcpSessionMetaMock.mockResolvedValue({
      sessionKey: "agent:codex:acp:session-a",
      storeSessionKey: "agent:codex:acp:session-a",
      acp: readySessionMeta(),
    });
    const limitedCfg = {
      acp: {
        ...baseCfg.acp,
        maxConcurrentSessions: 1,
      },
    } as OpenClawConfig;

    const manager = new AcpSessionManager();
    await manager.initializeSession({
      cfg: limitedCfg,
      sessionKey: "agent:codex:acp:session-a",
      agent: "codex",
      mode: "persistent",
    });

    await expectRejectedRecord(
      manager.initializeSession({
        cfg: limitedCfg,
        sessionKey: "agent:codex:acp:session-b",
        agent: "codex",
        mode: "persistent",
      }),
      {
        code: "ACP_SESSION_INIT_FAILED",
        message: "ACP max concurrent sessions reached (1/1).",
      },
    );
    expect(runtimeState.ensureSession).toHaveBeenCalledTimes(1);
  });

  it("persists runtime options provided during initializeSession", async () => {
    const runtimeState = createRuntime();
    hoisted.requireAcpRuntimeBackendMock.mockReturnValue({
      id: "acpx",
      runtime: runtimeState.runtime,
    });
    hoisted.upsertAcpSessionMetaMock.mockResolvedValue({
      sessionKey: "agent:codex:acp:session-a",
      storeSessionKey: "agent:codex:acp:session-a",
      acp: readySessionMeta({
        runtimeOptions: {
          model: "openai/gpt-5.4",
          thinking: "high",
        },
      }),
    });

    const manager = new AcpSessionManager();
    await manager.initializeSession({
      cfg: baseCfg,
      sessionKey: "agent:codex:acp:session-a",
      agent: "codex",
      mode: "persistent",
      runtimeOptions: {
        model: "openai/gpt-5.4",
        thinking: "high",
      },
    });

    expect(extractRuntimeOptionsFromUpserts()).toEqual([
      {
        model: "openai/gpt-5.4",
        thinking: "high",
      },
    ]);
    expectRecordFields(mockCallArg(runtimeState.ensureSession), {
      sessionKey: "agent:codex:acp:session-a",
      model: "openai/gpt-5.4",
      thinking: "high",
    });
  });

  it("preserves runtimeOptions cwd when initializeSession cwd is omitted", async () => {
    const runtimeState = createRuntime();
    hoisted.requireAcpRuntimeBackendMock.mockReturnValue({
      id: "acpx",
      runtime: runtimeState.runtime,
    });
    hoisted.upsertAcpSessionMetaMock.mockResolvedValue({
      sessionKey: "agent:codex:acp:session-cwd-runtime-options",
      storeSessionKey: "agent:codex:acp:session-cwd-runtime-options",
      acp: readySessionMeta({
        runtimeOptions: {
          cwd: "/workspace/from-runtime-options",
        },
        cwd: "/workspace/from-runtime-options",
      }),
    });

    const manager = new AcpSessionManager();
    await manager.initializeSession({
      cfg: baseCfg,
      sessionKey: "agent:codex:acp:session-cwd-runtime-options",
      agent: "codex",
      mode: "persistent",
      runtimeOptions: {
        cwd: "/workspace/from-runtime-options",
      },
    });

    expectRecordFields(mockCallArg(runtimeState.ensureSession), {
      sessionKey: "agent:codex:acp:session-cwd-runtime-options",
      cwd: "/workspace/from-runtime-options",
    });
    expect(extractRuntimeOptionsFromUpserts()).toEqual([
      {
        cwd: "/workspace/from-runtime-options",
      },
    ]);
  });

  it("rolls back ensured runtime sessions when metadata persistence fails", async () => {
    const runtimeState = createRuntime();
    hoisted.requireAcpRuntimeBackendMock.mockReturnValue({
      id: "acpx",
      runtime: runtimeState.runtime,
    });
    hoisted.upsertAcpSessionMetaMock.mockRejectedValueOnce(new Error("disk full"));

    const manager = new AcpSessionManager();
    await expect(
      manager.initializeSession({
        cfg: baseCfg,
        sessionKey: "agent:codex:acp:session-1",
        agent: "codex",
        mode: "persistent",
      }),
    ).rejects.toThrow("disk full");
    const closeInput = mockCallArg(runtimeState.close);
    expectRecordFields(closeInput, {
      reason: "init-meta-failed",
    });
    expectRecordFields(closeInput.handle, {
      sessionKey: "agent:codex:acp:session-1",
    });
  });

  it("closes late runtime initialization without persisting metadata after abort", async () => {
    const runtimeState = createRuntime();
    let resolveEnsure:
      | ((value: Awaited<ReturnType<typeof runtimeState.ensureSession>>) => void)
      | undefined;
    runtimeState.ensureSession.mockImplementationOnce(
      async () =>
        await new Promise((resolve) => {
          resolveEnsure = resolve;
        }),
    );
    hoisted.requireAcpRuntimeBackendMock.mockReturnValue({
      id: "acpx",
      runtime: runtimeState.runtime,
    });
    const controller = new AbortController();
    const manager = new AcpSessionManager();
    const initialization = manager.initializeSession({
      cfg: baseCfg,
      sessionKey: "agent:codex:acp:abort-init",
      agent: "codex",
      mode: "persistent",
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(runtimeState.ensureSession).toHaveBeenCalledOnce());

    controller.abort();
    await expect(initialization).rejects.toThrow("ACP session initialization aborted");

    resolveEnsure?.({
      sessionKey: "agent:codex:acp:abort-init",
      backend: "acpx",
      runtimeSessionName: "late-runtime",
    });
    await vi.waitFor(() => expect(runtimeState.close).toHaveBeenCalledOnce());
    expectRecordFields(mockCallArg(runtimeState.close), {
      reason: "session-init-aborted",
    });
    expect(hoisted.upsertAcpSessionMetaMock).not.toHaveBeenCalled();
  });

  it("clears metadata persisted concurrently with an initialization abort", async () => {
    const runtimeState = createRuntime();
    hoisted.requireAcpRuntimeBackendMock.mockReturnValue({
      id: "acpx",
      runtime: runtimeState.runtime,
    });
    let resolvePersist: ((value: ReturnType<typeof readySessionMeta>) => void) | undefined;
    hoisted.upsertAcpSessionMetaMock
      .mockImplementationOnce(
        async () =>
          await new Promise((resolve) => {
            resolvePersist = (acp) =>
              resolve({
                sessionKey: "agent:codex:acp:abort-persist",
                storeSessionKey: "agent:codex:acp:abort-persist",
                acp,
              });
          }),
      )
      .mockResolvedValueOnce(null);
    const controller = new AbortController();
    const manager = new AcpSessionManager();
    const initialization = manager.initializeSession({
      cfg: baseCfg,
      sessionKey: "agent:codex:acp:abort-persist",
      agent: "codex",
      mode: "persistent",
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(hoisted.upsertAcpSessionMetaMock).toHaveBeenCalledOnce());

    controller.abort();
    await expect(initialization).rejects.toThrow("ACP session initialization aborted");
    resolvePersist?.(readySessionMeta());

    await vi.waitFor(() => expect(hoisted.upsertAcpSessionMetaMock).toHaveBeenCalledTimes(2));
    expect(runtimeState.close).toHaveBeenCalledOnce();
    const cleanupCall = mockCallArg(hoisted.upsertAcpSessionMetaMock, 1) as {
      mutate: () => unknown;
    };
    expect(cleanupCall.mutate()).toBeNull();
  });
});
