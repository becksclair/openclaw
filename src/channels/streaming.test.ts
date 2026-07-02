import { describe, expect, it } from "vitest";
import { buildChannelProgressDraftLine } from "./streaming.js";

describe("buildChannelProgressDraftLine", () => {
  it("omits generic completed status from successful command output with title", () => {
    const line = buildChannelProgressDraftLine(
      {
        event: "command-output",
        toolCallId: "exec-1",
        phase: "end",
        title: "pwd",
        name: "exec",
        exitCode: 0,
      },
      { commandText: "raw" },
    );

    expect(line).toMatchObject({
      kind: "command-output",
      id: "exec-1",
      text: "🛠️ pwd",
      detail: "pwd",
      status: "completed",
    });
  });

  it("uses the tool label when successful command output has no title", () => {
    const line = buildChannelProgressDraftLine({
      event: "command-output",
      phase: "end",
      name: "exec",
      exitCode: 0,
    });

    expect(line).toMatchObject({
      kind: "command-output",
      text: "🛠️ Exec",
      status: "completed",
    });
    expect(line?.detail).toBeUndefined();
  });

  it("keeps command status and title in raw command progress lines", () => {
    const line = buildChannelProgressDraftLine(
      {
        event: "command-output",
        toolCallId: "exec-1",
        phase: "end",
        title: "command false",
        name: "exec",
        exitCode: 2,
      },
      { commandText: "raw" },
    );

    expect(line).toMatchObject({
      kind: "command-output",
      id: "exec-1",
      text: "🛠️ exit 2; command false",
      detail: "command false",
      status: "exit 2",
    });
  });

  it("suppresses pre-filled command meta on item events in status-only mode", () => {
    const line = buildChannelProgressDraftLine(
      {
        event: "item",
        itemId: "item-1",
        toolCallId: "exec-1",
        phase: "start",
        itemKind: "tool",
        name: "bash",
        status: "running",
        meta: "set -euo pipefail cd ~/.openclaw/workspace claude … EOF (agent)",
      },
      { commandText: "status" },
    );

    expect(line).toMatchObject({
      kind: "item",
      id: "item-1",
      text: "🛠️ Bash",
      status: "running",
    });
    expect(line?.detail).toBeUndefined();
  });

  it("suppresses command output summary on item events in status-only mode", () => {
    const line = buildChannelProgressDraftLine(
      {
        event: "item",
        itemId: "item-1",
        toolCallId: "exec-1",
        phase: "end",
        itemKind: "command",
        name: "exec",
        status: "completed",
        summary: "total 12\ndrwxr-xr-x …",
      },
      { commandText: "status" },
    );

    expect(line).toMatchObject({
      kind: "item",
      text: "🛠️ Exec",
      status: "completed",
    });
    expect(line?.detail).toBeUndefined();
  });

  it("keeps pre-filled command meta on item events in raw mode", () => {
    const line = buildChannelProgressDraftLine(
      {
        event: "item",
        itemId: "item-1",
        toolCallId: "exec-1",
        phase: "start",
        itemKind: "tool",
        name: "bash",
        status: "running",
        meta: "run tests (repo)",
      },
      { commandText: "raw" },
    );

    expect(line).toMatchObject({
      kind: "item",
      text: "🛠️ run tests (repo)",
      detail: "run tests (repo)",
      status: "running",
    });
  });

  it("keeps only command status in status-only progress lines", () => {
    const line = buildChannelProgressDraftLine(
      {
        event: "command-output",
        phase: "end",
        title: "command false",
        name: "exec",
        exitCode: 2,
      },
      { commandText: "status" },
    );

    expect(line).toMatchObject({
      kind: "command-output",
      text: "🛠️ exit 2",
      detail: "exit 2",
      status: "exit 2",
    });
    expect(line?.text).not.toContain("command false");
  });
});
