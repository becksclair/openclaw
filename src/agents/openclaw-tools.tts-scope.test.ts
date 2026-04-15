import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";

const toolMocks = vi.hoisted(() => ({
  createTtsTool: vi.fn((opts?: unknown) => ({
    name: "tts",
    description: "tts stub",
    parameters: { type: "object", properties: {} },
    execute: vi.fn(),
    opts,
  })),
}));

function stubTool(name: string) {
  return {
    name,
    description: `${name} stub`,
    parameters: { type: "object", properties: {} },
    execute: vi.fn(),
  };
}

vi.mock("../secrets/runtime.js", () => ({
  getActiveRuntimeWebToolsMetadata: () => undefined,
}));

vi.mock("./openclaw-plugin-tools.js", () => ({
  resolveOpenClawPluginToolsForOptions: () => [],
}));

vi.mock("./openclaw-tools.nodes-workspace-guard.js", () => ({
  applyNodesToolWorkspaceGuard: (tool: unknown) => tool,
}));

vi.mock("./openclaw-tools.registration.js", () => ({
  collectPresentOpenClawTools: (tools: unknown[]) => tools.filter(Boolean),
  isUpdatePlanToolEnabledForOpenClawTools: () => false,
}));

vi.mock("./workspace-dir.js", () => ({
  resolveWorkspaceRoot: (value?: string) => value,
}));

vi.mock("./tools/agents-list-tool.js", () => ({
  createAgentsListTool: () => stubTool("agents_list"),
}));
vi.mock("./tools/canvas-tool.js", () => ({
  createCanvasTool: () => stubTool("canvas"),
}));
vi.mock("./tools/cron-tool.js", () => ({
  createCronTool: () => stubTool("cron"),
}));
vi.mock("./tools/gateway-tool.js", () => ({
  createGatewayTool: () => stubTool("gateway"),
}));
vi.mock("./tools/image-generate-tool.js", () => ({
  createImageGenerateTool: () => stubTool("image_generate"),
}));
vi.mock("./tools/image-tool.js", () => ({
  createImageTool: () => null,
}));
vi.mock("./tools/message-tool.js", () => ({
  createMessageTool: () => stubTool("message"),
}));
vi.mock("./tools/music-generate-tool.js", () => ({
  createMusicGenerateTool: () => stubTool("music_generate"),
}));
vi.mock("./tools/nodes-tool.js", () => ({
  createNodesTool: () => stubTool("nodes"),
}));
vi.mock("./tools/pdf-tool.js", () => ({
  createPdfTool: () => null,
}));
vi.mock("./tools/session-status-tool.js", () => ({
  createSessionStatusTool: () => stubTool("session_status"),
}));
vi.mock("./tools/sessions-history-tool.js", () => ({
  createSessionsHistoryTool: () => stubTool("sessions_history"),
}));
vi.mock("./tools/sessions-list-tool.js", () => ({
  createSessionsListTool: () => stubTool("sessions_list"),
}));
vi.mock("./tools/sessions-send-tool.js", () => ({
  createSessionsSendTool: () => stubTool("sessions_send"),
}));
vi.mock("./tools/sessions-spawn-tool.js", () => ({
  createSessionsSpawnTool: () => stubTool("sessions_spawn"),
}));
vi.mock("./tools/sessions-yield-tool.js", () => ({
  createSessionsYieldTool: () => stubTool("sessions_yield"),
}));
vi.mock("./tools/subagents-tool.js", () => ({
  createSubagentsTool: () => stubTool("subagents"),
}));
vi.mock("./tools/tts-tool.js", () => ({
  createTtsTool: (opts?: unknown) => toolMocks.createTtsTool(opts),
}));
vi.mock("./tools/update-plan-tool.js", () => ({
  createUpdatePlanTool: () => stubTool("update_plan"),
}));
vi.mock("./tools/video-generate-tool.js", () => ({
  createVideoGenerateTool: () => stubTool("video_generate"),
}));
vi.mock("./tools/web-tools.js", () => ({
  createWebFetchTool: () => null,
  createWebSearchTool: () => null,
}));

const { createOpenClawTools } = await import("./openclaw-tools.js");

describe("openclaw-tools TTS scoping", () => {
  beforeEach(() => {
    toolMocks.createTtsTool.mockClear();
  });

  it("passes agent-scoped TTS config into the shipped tts tool", () => {
    const cfg = {
      messages: {
        tts: {
          provider: "openai",
          providers: {
            openai: {
              voice: "her",
              apiKey: "shared-key",
            },
          },
        },
      },
      agents: {
        list: [
          {
            id: "luke",
            tts: {
              providers: {
                openai: {
                  voice: "henry2",
                },
              },
            },
          },
        ],
      },
    } as OpenClawConfig;

    const tools = createOpenClawTools({
      config: cfg,
      agentSessionKey: "agent:luke:session-1",
      disablePluginTools: true,
    });

    expect(tools.some((tool) => tool.name === "tts")).toBe(true);
    expect(toolMocks.createTtsTool).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          messages: expect.objectContaining({
            tts: expect.objectContaining({
              providers: expect.objectContaining({
                openai: expect.objectContaining({ voice: "henry2", apiKey: "shared-key" }),
              }),
            }),
          }),
        }),
      }),
    );
  });
});
