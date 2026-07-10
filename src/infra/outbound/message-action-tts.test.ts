import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { maybeApplyTtsToMessageActionSendPayload } from "./message-action-tts.js";

const cfg = {
  messages: { tts: { auto: "always", mode: "final" } },
} as unknown as OpenClawConfig;

describe("maybeApplyTtsToMessageActionSendPayload", () => {
  it("defers an ambient TTS supplement for final message_tool_only sends", async () => {
    const payload = { text: "final answer" };
    const result = await maybeApplyTtsToMessageActionSendPayload({
      payload,
      cfg,
      channel: "telegram",
      dryRun: false,
      sourceReplyDeliveryMode: "message_tool_only",
    });
    expect(result.payload).toBe(payload);
    expect(result.deferredSupplement).toBeDefined();
  });

  it("skips ambient TTS for progress sends so status pings stay silent under mode:final", async () => {
    const payload = { text: "status ping" };
    const result = await maybeApplyTtsToMessageActionSendPayload({
      payload,
      cfg,
      channel: "telegram",
      dryRun: false,
      sourceReplyDeliveryMode: "message_tool_only",
      progress: true,
    });
    expect(result.payload).toBe(payload);
    expect(result.deferredSupplement).toBeUndefined();
  });
});
