import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import { withTempHomeConfig } from "./test-helpers.js";
import { validateConfigObject } from "./validation.js";

function makeMissingPath(label: string): string {
  return path.join(tmpdir(), `${label}-${randomUUID()}`);
}

describe("ACP working directory validation", () => {
  it("rejects missing agents.list runtime.acp.cwd values", () => {
    const result = validateConfigObject({
      agents: {
        list: [
          {
            id: "codex",
            runtime: {
              type: "acp",
              acp: {
                cwd: makeMissingPath("openclaw-acp-agent-cwd-missing"),
              },
            },
          },
        ],
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "agents.list.0.runtime.acp.cwd",
            message: expect.stringContaining("must exist on the current host"),
          }),
        ]),
      );
    }
  });

  it("rejects missing bindings acp.cwd values", () => {
    const result = validateConfigObject({
      bindings: [
        {
          type: "acp",
          agentId: "codex",
          match: {
            channel: "discord",
            peer: {
              kind: "channel",
              id: "1234567890",
            },
          },
          acp: {
            cwd: makeMissingPath("openclaw-acp-binding-cwd-missing"),
          },
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "bindings.0.acp.cwd",
            message: expect.stringContaining("must exist on the current host"),
          }),
        ]),
      );
    }
  });

  it("throws during loadConfig when configured ACP cwd is missing", async () => {
    await withTempHomeConfig(
      {
        agents: {
          list: [
            {
              id: "codex",
              runtime: {
                type: "acp",
                acp: {
                  cwd: makeMissingPath("openclaw-acp-load-cwd-missing"),
                },
              },
            },
          ],
        },
        bindings: [
          {
            type: "acp",
            agentId: "codex",
            match: {
              channel: "discord",
              peer: {
                kind: "channel",
                id: "1234567890",
              },
            },
          },
        ],
      },
      async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
          expect(() => loadConfig()).toThrow(
            /ACP working directory must exist on the current host/i,
          );
        } finally {
          spy.mockRestore();
        }
      },
    );
  });

  it("accepts existing local ACP working directories", () => {
    const existing = fs.mkdtempSync(path.join(tmpdir(), "openclaw-acp-existing-cwd-"));
    try {
      const result = validateConfigObject({
        agents: {
          list: [
            {
              id: "codex",
              runtime: {
                type: "acp",
                acp: {
                  cwd: existing,
                },
              },
            },
          ],
        },
        bindings: [
          {
            type: "acp",
            agentId: "codex",
            match: {
              channel: "discord",
              peer: {
                kind: "channel",
                id: "1234567890",
              },
            },
            acp: {
              cwd: existing,
            },
          },
        ],
      });

      expect(result.ok).toBe(true);
    } finally {
      fs.rmSync(existing, { recursive: true, force: true });
    }
  });
});
