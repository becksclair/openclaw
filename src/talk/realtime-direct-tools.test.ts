// Realtime direct tool tests cover adapter policy, schema, and result safety.
import { describe, expect, it } from "vitest";
import type { AnyAgentTool } from "../agents/agent-tools.types.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  REALTIME_DIRECT_TOOL_RESULT_MAX_CHARS,
  buildRealtimeDirectToolsFromAgentTools,
  createRealtimeDirectTools,
} from "./realtime-direct-tools.js";

function cfgWithRealtimeTools(tools?: Record<string, unknown>): OpenClawConfig {
  return {
    talk: {
      realtime: tools ? { tools } : {},
    },
  } as OpenClawConfig;
}

function fakeTool(params: {
  name: string;
  parameters?: unknown;
  execute?: (toolCallId: string, params: unknown, signal?: AbortSignal) => Promise<unknown>;
  description?: string;
}): AnyAgentTool {
  return {
    name: params.name,
    description: params.description ?? `${params.name} tool`,
    parameters: params.parameters ?? { type: "object", properties: {} },
    execute:
      params.execute ??
      (async () => ({
        text: `${params.name} result`,
      })),
  } as AnyAgentTool;
}

describe("realtime direct tools", () => {
  it("returns no tools or executors when talk.realtime.tools is unset", () => {
    let createToolsCalled = false;

    const result = createRealtimeDirectTools(
      { cfg: cfgWithRealtimeTools() },
      {
        createTools: () => {
          createToolsCalled = true;
          return [fakeTool({ name: "read" })];
        },
      },
    );

    expect(result.tools).toEqual([]);
    expect(result.executors.size).toBe(0);
    expect(result.excludedTools).toEqual([]);
    expect(createToolsCalled).toBe(false);
  });

  it("returns no tools or executors when talk.realtime.tools is empty", () => {
    let createToolsCalled = false;

    const result = createRealtimeDirectTools(
      { cfg: cfgWithRealtimeTools({}) },
      {
        createTools: () => {
          createToolsCalled = true;
          return [fakeTool({ name: "read" })];
        },
      },
    );

    expect(result.tools).toEqual([]);
    expect(result.executors.size).toBe(0);
    expect(result.excludedTools).toEqual([]);
    expect(createToolsCalled).toBe(false);
  });

  it("passes runtime policy and resolved run context to createOpenClawCodingTools", () => {
    const runtimeToolPolicy = { profile: "voice", deny: ["exec"] };
    const calls: unknown[] = [];

    createRealtimeDirectTools(
      {
        cfg: cfgWithRealtimeTools(runtimeToolPolicy),
        agentId: "voice-agent",
        sessionKey: "agent:voice-agent:talk",
        spawnedBy: "agent:main:discord:guild:channel:parent",
        sessionId: "session-1",
        runId: "run-1",
        agentDir: "/agent",
        workspaceDir: "/workspace",
        cwd: "/workspace/subdir",
        messageProvider: "talk",
        agentAccountId: "account-1",
        messageTo: "room-1",
        messageThreadId: "thread-1",
        modelProvider: "openai",
        modelId: "gpt-realtime",
        modelApi: "responses",
        modelContextWindowTokens: 128_000,
        senderIsOwner: true,
      },
      {
        createTools: (options) => {
          calls.push(options);
          return [fakeTool({ name: "read" })];
        },
      },
    );

    expect(calls).toEqual([
      expect.objectContaining({
        agentId: "voice-agent",
        sessionKey: "agent:voice-agent:talk",
        spawnedBy: "agent:main:discord:guild:channel:parent",
        sessionId: "session-1",
        runId: "run-1",
        agentDir: "/agent",
        workspaceDir: "/workspace",
        cwd: "/workspace/subdir",
        messageProvider: "talk",
        agentAccountId: "account-1",
        messageTo: "room-1",
        messageThreadId: "thread-1",
        modelProvider: "openai",
        modelId: "gpt-realtime",
        modelApi: "responses",
        modelContextWindowTokens: 128_000,
        senderIsOwner: true,
        includeToolSearchControls: false,
        disableMessageTool: true,
        runtimeToolPolicy,
        finalToolPredicate: expect.any(Function),
      }),
    ]);
    const finalToolPredicate = (
      calls[0] as { finalToolPredicate?: (tool: AnyAgentTool) => boolean }
    ).finalToolPredicate;
    expect(finalToolPredicate?.(fakeTool({ name: "read" }))).toBe(true);
    expect(finalToolPredicate?.(fakeTool({ name: "sessions_send" }))).toBe(false);
    expect(
      finalToolPredicate?.(fakeTool({ name: "bad_schema", parameters: { type: "string" } })),
    ).toBe(false);
  });

  it("applies gateway denies to provider-executable direct tools", () => {
    const result = createRealtimeDirectTools(
      {
        cfg: cfgWithRealtimeTools({ profile: "full" }),
        senderIsOwner: false,
      },
      {
        createTools: () => [
          fakeTool({ name: "read" }),
          fakeTool({ name: "write" }),
          fakeTool({ name: "edit" }),
          fakeTool({ name: "exec" }),
          fakeTool({ name: "sessions_spawn" }),
          fakeTool({ name: "cron" }),
          fakeTool({ name: "gateway" }),
          fakeTool({ name: "nodes" }),
        ],
      },
    );

    expect(result.tools.map((tool) => tool.name)).toEqual(["read"]);
    expect(result.executors.has("read")).toBe(true);
    expect(result.executors.has("write")).toBe(false);
    expect(result.executors.has("edit")).toBe(false);
    expect(result.executors.has("gateway")).toBe(false);
  });

  it("allows file mutation tools only when realtime policy names them explicitly", () => {
    const result = createRealtimeDirectTools(
      {
        cfg: cfgWithRealtimeTools({ profile: "voice", alsoAllow: ["write"] }),
        senderIsOwner: false,
      },
      {
        createTools: () => [
          fakeTool({ name: "read" }),
          fakeTool({ name: "write" }),
          fakeTool({ name: "edit" }),
        ],
      },
    );

    expect(result.tools.map((tool) => tool.name)).toEqual(["read", "write"]);
    expect(result.executors.has("write")).toBe(true);
    expect(result.executors.has("edit")).toBe(false);
  });

  it("honors gateway tool allow and deny policy for owner direct tools", () => {
    const result = createRealtimeDirectTools(
      {
        cfg: {
          ...cfgWithRealtimeTools({ profile: "full" }),
          gateway: {
            tools: {
              allow: ["gateway"],
              deny: ["cron"],
            },
          },
        } as OpenClawConfig,
        senderIsOwner: true,
      },
      {
        createTools: () => [
          fakeTool({ name: "read" }),
          fakeTool({ name: "gateway" }),
          fakeTool({ name: "cron" }),
        ],
      },
    );

    expect(result.tools.map((tool) => tool.name)).toEqual(["read", "gateway"]);
    expect(result.executors.has("gateway")).toBe(true);
    expect(result.executors.has("cron")).toBe(false);
  });

  it("converts object-rooted tools and skips non-object schemas", () => {
    const result = buildRealtimeDirectToolsFromAgentTools([
      fakeTool({
        name: "read",
        description: "Read a file",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      }),
      fakeTool({ name: "string_root", parameters: { type: "string" } }),
      fakeTool({ name: "any_root", parameters: true }),
    ]);

    expect(result.tools).toEqual([
      {
        type: "function",
        name: "read",
        description: "Read a file",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    ]);
    expect([...result.executors.keys()]).toEqual(["read"]);
    expect(result.excludedTools).toEqual([
      { name: "string_root", reason: "unsupported-schema" },
      { name: "any_root", reason: "unsupported-schema" },
    ]);
  });

  it("reserves consult/control names and strips message-sending tools", () => {
    const result = buildRealtimeDirectToolsFromAgentTools([
      fakeTool({ name: "openclaw_agent_consult" }),
      fakeTool({ name: "openclaw_agent_control" }),
      fakeTool({ name: "message" }),
      fakeTool({ name: "send_message" }),
      fakeTool({ name: "message_send" }),
      fakeTool({ name: "sessions_send" }),
      fakeTool({ name: "plugin_send_message" }),
      fakeTool({
        name: "zalouser",
        parameters: {
          type: "object",
          properties: {
            action: {
              anyOf: [
                { const: "send", type: "string" },
                { const: "image", type: "string" },
                { const: "link", type: "string" },
                { const: "friends", type: "string" },
              ],
            },
          },
        },
      }),
      fakeTool({ name: "read" }),
    ]);

    expect(result.tools.map((tool) => tool.name)).toEqual(["read"]);
    expect([...result.executors.keys()]).toEqual(["read"]);
    expect(result.excludedTools).toEqual([
      { name: "openclaw_agent_consult", reason: "reserved-name" },
      { name: "openclaw_agent_control", reason: "reserved-name" },
      { name: "message", reason: "message-tool" },
      { name: "send_message", reason: "message-tool" },
      { name: "message_send", reason: "message-tool" },
      { name: "sessions_send", reason: "message-tool" },
      { name: "plugin_send_message", reason: "message-tool" },
      { name: "zalouser", reason: "message-tool" },
    ]);
  });

  it("dedupes by provider-facing tool name", () => {
    const result = buildRealtimeDirectToolsFromAgentTools([
      fakeTool({ name: "read", description: "first" }),
      fakeTool({ name: "read", description: "second" }),
    ]);

    expect(result.tools.map((tool) => tool.description)).toEqual(["first"]);
    expect(result.executors.size).toBe(1);
  });

  it("returns compact JSON-safe success payloads without media dumps", async () => {
    const largeText = "x".repeat(REALTIME_DIRECT_TOOL_RESULT_MAX_CHARS + 50);
    const result = buildRealtimeDirectToolsFromAgentTools([
      fakeTool({
        name: "inspect",
        execute: async () => ({
          text: largeText,
          image: Buffer.from("secret image bytes"),
          nested: { audio: new Uint8Array([1, 2, 3]), ok: true },
        }),
      }),
    ]);

    const payload = await result.executors.get("inspect")?.({
      callId: "call-1",
      name: "inspect",
      args: {},
      signal: new AbortController().signal,
    });

    expect(payload).toMatchObject({
      ok: true,
      status: "ok",
      tool: "inspect",
    });
    expect(payload?.text?.length).toBeLessThanOrEqual(
      REALTIME_DIRECT_TOOL_RESULT_MAX_CHARS + "...[truncated]".length,
    );
    expect(JSON.stringify(payload)).toContain("[media omitted]");
    expect(JSON.stringify(payload)).not.toContain("secret image bytes");
  });

  it("redacts credential-shaped result fields and keeps benign token counts", async () => {
    const result = buildRealtimeDirectToolsFromAgentTools([
      fakeTool({
        name: "inspect",
        execute: async () => ({
          ok: true,
          apiKey: "sk-live-do-not-leak",
          accessToken: "at-do-not-leak",
          nested: { clientSecret: "cs-do-not-leak", region: "us" },
          tokenCount: 42,
          totalTokens: 1024,
        }),
      }),
    ]);

    const payload = await result.executors.get("inspect")?.({
      callId: "call-1",
      name: "inspect",
      args: {},
      signal: new AbortController().signal,
    });

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("do-not-leak");
    expect(serialized).toContain("[redacted]");
    // Count-style fields that merely contain "token" must survive.
    expect(payload?.result).toMatchObject({ tokenCount: 42, totalTokens: 1024 });
  });

  it("returns compact error payloads", async () => {
    const result = buildRealtimeDirectToolsFromAgentTools([
      fakeTool({
        name: "fail",
        execute: async () => {
          throw new Error("nope");
        },
      }),
    ]);

    await expect(
      result.executors.get("fail")?.({
        callId: "call-1",
        name: "fail",
        args: {},
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      ok: false,
      status: "error",
      tool: "fail",
      error: "nope",
    });
  });

  it("passes per-call abort signals to tool execution", async () => {
    const abortController = new AbortController();
    const signals: Array<AbortSignal | undefined> = [];
    const result = buildRealtimeDirectToolsFromAgentTools([
      fakeTool({
        name: "read",
        execute: async (_callId, _params, signal) => {
          signals.push(signal);
          return { text: "ok" };
        },
      }),
    ]);

    await result.executors.get("read")?.({
      callId: "call-1",
      name: "read",
      args: {},
      signal: abortController.signal,
    });

    expect(signals).toEqual([abortController.signal]);
  });
});
