// Discord tests cover auto presence plugin behavior.
import type { AuthProfileStore } from "openclaw/plugin-sdk/provider-auth";
import { describe, expect, it, vi } from "vitest";

vi.mock("openclaw/plugin-sdk/runtime-config-snapshot", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getRuntimeConfig: vi.fn() };
});
vi.mock("openclaw/plugin-sdk/routing", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveAgentRoute: vi.fn() };
});
vi.mock("openclaw/plugin-sdk/agent-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ensureAuthProfileStore: vi.fn(), resolveAgentDir: vi.fn() };
});

import { ensureAuthProfileStore, resolveAgentDir } from "openclaw/plugin-sdk/agent-runtime";
import { resolveAgentRoute } from "openclaw/plugin-sdk/routing";
import { getRuntimeConfig } from "openclaw/plugin-sdk/runtime-config-snapshot";
import {
  createDiscordAutoPresenceController,
  loadDiscordAccountAuthProfileStore,
  resolveDiscordAutoPresenceDecision,
} from "./auto-presence.js";

function createStore(params?: {
  cooldownUntil?: number;
  failureCounts?: Record<string, number>;
}): AuthProfileStore {
  return {
    version: 1,
    profiles: {
      "openai:default": {
        type: "api_key",
        provider: "openai",
        key: "sk-test",
      },
    },
    usageStats: {
      "openai:default": {
        ...(typeof params?.cooldownUntil === "number"
          ? { cooldownUntil: params.cooldownUntil }
          : {}),
        ...(params?.failureCounts ? { failureCounts: params.failureCounts } : {}),
      },
    },
  };
}

function expectExhaustedDecision(params: { failureCounts: Record<string, number> }) {
  const now = Date.now();
  const decision = resolveDiscordAutoPresenceDecision({
    discordConfig: {
      autoPresence: {
        enabled: true,
        exhaustedText: "token exhausted",
      },
    },
    authStore: createStore({ cooldownUntil: now + 60_000, failureCounts: params.failureCounts }),
    gatewayConnected: true,
    now,
  });

  if (!decision) {
    throw new Error("expected an exhausted auto-presence decision");
  }
  expect(decision.state).toBe("exhausted");
  expect(decision.presence.status).toBe("dnd");
  expect(decision.presence.activities[0]?.state).toBe("token exhausted");
}

describe("discord auto presence", () => {
  it("maps exhausted runtime signal to dnd", () => {
    expectExhaustedDecision({ failureCounts: { rate_limit: 2 } });
  });

  it("treats overloaded cooldown as exhausted", () => {
    expectExhaustedDecision({ failureCounts: { overloaded: 2 } });
  });

  it("recovers from exhausted to online once a profile becomes usable", () => {
    let now = Date.now();
    let store = createStore({ cooldownUntil: now + 60_000, failureCounts: { rate_limit: 1 } });
    const updatePresence = vi.fn();
    const controller = createDiscordAutoPresenceController({
      accountId: "default",
      discordConfig: {
        autoPresence: {
          enabled: true,
          intervalMs: 5_000,
          minUpdateIntervalMs: 1_000,
          exhaustedText: "token exhausted",
        },
      },
      gateway: {
        isConnected: true,
        updatePresence,
      },
      loadAuthStore: () => store,
      now: () => now,
    });

    controller.runNow();

    now += 2_000;
    store = createStore();
    controller.runNow();

    expect(updatePresence).toHaveBeenCalledTimes(2);
    expect(updatePresence.mock.calls).toEqual([
      [
        {
          since: null,
          activities: [{ name: "Custom Status", type: 4, state: "token exhausted" }],
          status: "dnd",
          afk: false,
        },
      ],
      [
        {
          since: null,
          activities: [],
          status: "online",
          afk: false,
        },
      ],
    ]);
  });

  it("re-applies presence on refresh even when signature is unchanged", () => {
    let now = Date.now();
    const store = createStore();
    const updatePresence = vi.fn();

    const controller = createDiscordAutoPresenceController({
      accountId: "default",
      discordConfig: {
        autoPresence: {
          enabled: true,
          intervalMs: 60_000,
          minUpdateIntervalMs: 60_000,
        },
      },
      gateway: {
        isConnected: true,
        updatePresence,
      },
      loadAuthStore: () => store,
      now: () => now,
    });

    controller.runNow();
    now += 1_000;
    controller.runNow();
    controller.refresh();

    expect(updatePresence).toHaveBeenCalledTimes(2);
    expect(updatePresence.mock.calls).toEqual([
      [
        {
          since: null,
          activities: [],
          status: "online",
          afk: false,
        },
      ],
      [
        {
          since: null,
          activities: [],
          status: "online",
          afk: false,
        },
      ],
    ]);
  });

  it("reports degraded when the auth store has no profiles", () => {
    const now = Date.now();
    const decision = resolveDiscordAutoPresenceDecision({
      discordConfig: {
        autoPresence: {
          enabled: true,
        },
      },
      authStore: { version: 1, profiles: {} },
      gatewayConnected: true,
      now,
    });

    if (!decision) {
      throw new Error("expected a degraded auto-presence decision");
    }
    expect(decision.state).toBe("degraded");
    expect(decision.presence.status).toBe("idle");
    expect(decision.presence.activities[0]?.state).toBe("runtime degraded");
  });

  it("loads the auth store for the agent bound to the account", () => {
    const cfg = { agents: { list: [{ id: "luke" }] } };
    const store = createStore();
    vi.mocked(getRuntimeConfig).mockReturnValue(cfg as never);
    vi.mocked(resolveAgentRoute).mockReturnValue({ agentId: "luke" } as never);
    vi.mocked(resolveAgentDir).mockReturnValue("/state/agents/luke/agent");
    vi.mocked(ensureAuthProfileStore).mockReturnValue(store as never);

    const result = loadDiscordAccountAuthProfileStore("luke");

    expect(resolveAgentRoute).toHaveBeenCalledWith({
      cfg,
      channel: "discord",
      accountId: "luke",
    });
    expect(resolveAgentDir).toHaveBeenCalledWith(cfg, "luke");
    expect(ensureAuthProfileStore).toHaveBeenCalledWith("/state/agents/luke/agent");
    expect(result).toBe(store);
  });

  it("does nothing when auto presence is disabled", () => {
    const updatePresence = vi.fn();
    const controller = createDiscordAutoPresenceController({
      accountId: "default",
      discordConfig: {
        autoPresence: {
          enabled: false,
        },
      },
      gateway: {
        isConnected: true,
        updatePresence,
      },
      loadAuthStore: () => createStore(),
    });

    controller.runNow();
    controller.start();
    controller.refresh();
    controller.stop();

    expect(controller.enabled).toBe(false);
    expect(updatePresence).not.toHaveBeenCalled();
  });
});
