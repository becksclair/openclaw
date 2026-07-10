// Binding routing tests cover channel binding selection and message routing behavior.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildConfiguredAcpSessionKey } from "../../acp/persistent-bindings.types.js";
import {
  testing,
  registerSessionBindingAdapter,
  type SessionBindingAdapter,
  type SessionBindingRecord,
} from "../../infra/outbound/session-binding-service.js";
import { createEmptyPluginRegistry } from "../../plugins/registry-empty.js";
import { resetPluginRuntimeStateForTest, setActivePluginRegistry } from "../../plugins/runtime.js";
import type { ResolvedAgentRoute } from "../../routing/resolve-route.js";
import {
  ensureConfiguredBindingRouteReady,
  ensureConfiguredBindingSessionKeyReady,
  resolveRuntimeConversationBindingRoute,
} from "./binding-routing.js";
import {
  registerStatefulBindingTargetDriver,
  unregisterStatefulBindingTargetDriver,
} from "./stateful-target-drivers.js";
import type { ChannelConfiguredBindingProvider } from "./types.adapters.js";

function createRoute(): ResolvedAgentRoute {
  return {
    agentId: "main",
    channel: "demo",
    accountId: "default",
    sessionKey: "agent:main:main",
    mainSessionKey: "agent:main:main",
    lastRoutePolicy: "main",
    matchedBy: "default",
  };
}

function createBinding(overrides?: Partial<SessionBindingRecord>): SessionBindingRecord {
  return {
    bindingId: "binding-1",
    targetSessionKey: "agent:review:acp:session-1",
    targetKind: "session",
    conversation: {
      channel: "demo",
      accountId: "default",
      conversationId: "room-1",
    },
    status: "active",
    boundAt: 1,
    ...overrides,
  };
}

function registerAdapter(record: SessionBindingRecord | null): {
  resolveByConversation: ReturnType<typeof vi.fn>;
  touch: ReturnType<typeof vi.fn>;
} {
  const resolveByConversation = vi.fn<SessionBindingAdapter["resolveByConversation"]>(() => record);
  const touch = vi.fn<NonNullable<SessionBindingAdapter["touch"]>>();
  registerSessionBindingAdapter({
    channel: "demo",
    accountId: "default",
    listBySession: () => [],
    resolveByConversation,
    touch,
  });
  return { resolveByConversation, touch };
}

describe("runtime conversation binding route", () => {
  beforeEach(() => {
    testing.resetSessionBindingAdaptersForTests();
  });

  it("rewrites the route to a runtime-bound ACP session and touches the binding", () => {
    const binding = createBinding();
    const { resolveByConversation, touch } = registerAdapter(binding);

    const result = resolveRuntimeConversationBindingRoute({
      route: createRoute(),
      conversation: {
        channel: "demo",
        accountId: "default",
        conversationId: "room-1",
      },
    });

    expect(resolveByConversation).toHaveBeenCalledWith({
      channel: "demo",
      accountId: "default",
      conversationId: "room-1",
    });
    expect(touch).toHaveBeenCalledWith("binding-1", undefined);
    expect(result.boundSessionKey).toBe("agent:review:acp:session-1");
    expect(result.boundAgentId).toBe("review");
    expect(result.route).toEqual({
      agentId: "review",
      accountId: "default",
      channel: "demo",
      sessionKey: "agent:review:acp:session-1",
      mainSessionKey: "agent:main:main",
      lastRoutePolicy: "session",
      matchedBy: "binding.channel",
    });
  });

  it("touches plugin-owned bindings without rewriting the channel route", () => {
    const route = createRoute();
    const binding = createBinding({
      metadata: {
        pluginBindingOwner: "plugin",
        pluginId: "demo-plugin",
        pluginRoot: "/tmp/demo-plugin",
      },
    });
    const { touch } = registerAdapter(binding);

    const result = resolveRuntimeConversationBindingRoute({
      route,
      conversation: {
        channel: "demo",
        accountId: "default",
        conversationId: "room-1",
      },
    });

    expect(touch).toHaveBeenCalledWith("binding-1", undefined);
    expect(result.bindingRecord).toBe(binding);
    expect(result.boundSessionKey).toBeUndefined();
    expect(result.route).toBe(route);
  });

  it("ignores runtime bindings that target isolated cron run sessions", () => {
    const route = createRoute();
    const binding = createBinding({
      targetSessionKey: "agent:youtube:cron:monthly-report:run:closed-run-1",
    });
    const { touch } = registerAdapter(binding);

    const result = resolveRuntimeConversationBindingRoute({
      route,
      conversation: {
        channel: "demo",
        accountId: "default",
        conversationId: "room-1",
      },
    });

    expect(touch).not.toHaveBeenCalled();
    expect(result.bindingRecord).toBeNull();
    expect(result.boundSessionKey).toBeUndefined();
    expect(result.route).toBe(route);
  });
});

describe("ensureConfiguredBindingRouteReady", () => {
  afterEach(() => {
    vi.useRealTimers();
    unregisterStatefulBindingTargetDriver("slow");
    unregisterStatefulBindingTargetDriver("acp");
    resetPluginRuntimeStateForTest();
  });

  it("returns a bounded failure when target readiness never settles", async () => {
    vi.useFakeTimers();
    registerStatefulBindingTargetDriver({
      id: "slow",
      ensureReady: async () => await new Promise<never>(() => {}),
      ensureSession: async () => ({
        ok: false,
        sessionKey: "agent:slow:binding",
        error: "not used",
      }),
    });

    const resultPromise = ensureConfiguredBindingRouteReady({
      cfg: {} as never,
      bindingResolution: { statefulTarget: { driverId: "slow" } } as never,
    });

    await vi.advanceTimersByTimeAsync(30_000);

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: "Configured binding route ready check timed out",
    });
  });

  it("prepares configured ACP bindings resolved from their generated session key", async () => {
    const registry = createEmptyPluginRegistry();
    registry.channels = [
      {
        pluginId: "discord",
        plugin: {
          id: "discord",
          meta: { label: "Discord" },
          bindings: {
            compileConfiguredBinding: ({ conversationId }) => ({ conversationId }),
            matchInboundConversation: ({ compiledBinding, conversationId }) =>
              compiledBinding.conversationId === conversationId
                ? { conversationId, matchPriority: 2 }
                : null,
          } satisfies ChannelConfiguredBindingProvider,
        } as never,
        source: "test",
      },
    ];
    setActivePluginRegistry(registry);
    const sessionKey = buildConfiguredAcpSessionKey({
      channel: "discord",
      accountId: "default",
      conversationId: "channel-1",
      agentId: "codex",
      acpAgentId: "codex",
      mode: "persistent",
      backend: "acpx",
    });
    const ensureReady = vi.fn(async () => ({ ok: true as const }));
    registerStatefulBindingTargetDriver({
      id: "acp",
      ensureReady,
      ensureSession: async () => ({ ok: true, sessionKey }),
    });

    await expect(
      ensureConfiguredBindingSessionKeyReady({
        cfg: {
          agents: { list: [{ id: "main" }, { id: "codex" }] },
          bindings: [
            {
              type: "acp",
              agentId: "codex",
              match: {
                channel: "discord",
                accountId: "*",
                peer: { kind: "channel", id: "channel-1" },
              },
              acp: { mode: "persistent", backend: "acpx" },
            },
          ],
        },
        sessionKey,
      }),
    ).resolves.toEqual({ ok: true });
    expect(ensureReady).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingResolution: expect.objectContaining({
          statefulTarget: expect.objectContaining({ sessionKey }),
        }),
      }),
    );
  });
});
