import { describe, expect, it } from "vitest";
import type { AnyAgentTool } from "../../agents/pi-tools.types.js";
import { DefaultRealtimeToolRuntime } from "./tool-runtime.js";

function createTool(params: {
  name: string;
  execute: NonNullable<AnyAgentTool["execute"]>;
}): AnyAgentTool {
  return {
    name: params.name,
    label: params.name,
    description: params.name,
    parameters: { type: "object", properties: {} },
    execute: params.execute,
  } as AnyAgentTool;
}

describe("DefaultRealtimeToolRuntime", () => {
  it("emits queued running and completed states for successful tools", async () => {
    const runtime = new DefaultRealtimeToolRuntime({
      tools: [
        createTool({
          name: "read",
          execute: async (_callId, _params, _signal, onUpdate) => {
            onUpdate?.({
              content: [{ type: "text", text: "halfway" }],
            } as never);
            return {
              content: [{ type: "text", text: "file contents" }],
              details: { status: "completed" },
            };
          },
        }),
      ],
    });
    const updates: unknown[] = [];
    runtime.subscribe((update) => {
      updates.push(update);
    });

    const result = await runtime.invoke("call-1", "read", { path: "README.md" });

    expect(result).toMatchObject({
      content: [{ type: "text", text: "file contents" }],
    });
    expect(updates).toEqual([
      { toolCallId: "call-1", toolName: "read", status: "queued" },
      { toolCallId: "call-1", toolName: "read", status: "running" },
      {
        toolCallId: "call-1",
        toolName: "read",
        status: "running",
        text: '{\n  "content": [\n    {\n      "type": "text",\n      "text": "halfway"\n    }\n  ]\n}',
      },
      {
        toolCallId: "call-1",
        toolName: "read",
        status: "completed",
        text: "file contents",
      },
    ]);
  });

  it("surfaces approval state for exec approval-pending results", async () => {
    const runtime = new DefaultRealtimeToolRuntime({
      tools: [
        createTool({
          name: "exec",
          execute: async () => ({
            content: [{ type: "text", text: "Approval required" }],
            details: {
              status: "approval-pending",
              approvalId: "approval-1",
              approvalSlug: "approve-this",
              expiresAtMs: 123,
            },
          }),
        }),
      ],
    });
    const updates: unknown[] = [];
    runtime.subscribe((update) => {
      updates.push(update);
    });

    await runtime.invoke("call-2", "exec", { command: "ls" });

    expect(updates).toEqual([
      { toolCallId: "call-2", toolName: "exec", status: "queued" },
      { toolCallId: "call-2", toolName: "exec", status: "running" },
      {
        toolCallId: "call-2",
        toolName: "exec",
        status: "approval",
        text: "Approval required",
        approval: {
          approvalId: "approval-1",
          approvalSlug: "approve-this",
          expiresAtMs: 123,
        },
      },
    ]);
  });

  it("maps approval-unavailable results to failed status", async () => {
    const runtime = new DefaultRealtimeToolRuntime({
      tools: [
        createTool({
          name: "exec",
          execute: async () => ({
            content: [{ type: "text", text: "No approval client connected" }],
            details: {
              status: "approval-unavailable",
              error: "No approval client connected",
            },
          }),
        }),
      ],
    });
    const updates: unknown[] = [];
    runtime.subscribe((update) => {
      updates.push(update);
    });

    const result = await runtime.invoke("call-2b", "exec", { command: "ls" });

    expect(result).toMatchObject({
      details: {
        status: "approval-unavailable",
      },
    });
    expect(updates.at(-1)).toEqual({
      toolCallId: "call-2b",
      toolName: "exec",
      status: "failed",
      text: "No approval client connected",
      error: {
        code: "approval-unavailable",
        message: "No approval client connected",
      },
    });
  });

  it("maps explicit tool failures to failed status", async () => {
    const runtime = new DefaultRealtimeToolRuntime({
      tools: [
        createTool({
          name: "write",
          execute: async () => ({
            content: [{ type: "text", text: "Permission denied" }],
            details: {
              status: "failed",
              error: "Permission denied",
            },
          }),
        }),
      ],
    });
    const updates: unknown[] = [];
    runtime.subscribe((update) => {
      updates.push(update);
    });

    const result = await runtime.invoke("call-2c", "write", { path: "a", content: "b" });

    expect(result).toMatchObject({
      details: {
        status: "failed",
      },
    });
    expect(updates.at(-1)).toEqual({
      toolCallId: "call-2c",
      toolName: "write",
      status: "failed",
      text: "Permission denied",
      error: {
        code: "failed",
        message: "Permission denied",
      },
    });
  });

  it("fails cleanly for unavailable tools", async () => {
    const runtime = new DefaultRealtimeToolRuntime({ tools: [] });
    const updates: unknown[] = [];
    runtime.subscribe((update) => {
      updates.push(update);
    });

    await expect(runtime.invoke("call-3", "write", { path: "a" })).rejects.toThrow(
      "Realtime tool not available: write",
    );
    expect(updates).toEqual([
      {
        toolCallId: "call-3",
        toolName: "write",
        status: "failed",
        error: {
          code: "tool_not_available",
          message: "Realtime tool not available: write",
        },
      },
    ]);
  });
});
