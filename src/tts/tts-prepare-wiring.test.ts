import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Guard against SILENT loss of tts_prepare enrichment on rebase. `prepareHook` is
// optional on maybeApplyTtsToPayload/textToSpeech/synthesizeSpeech, so a rebase
// that drops a `buildTtsPrepareHook(...)` wiring from a dispatch path compiles
// clean, passes every behavioral test, and just stops enriching that path with no
// error. This test locks the wired call sites by count.
//
// Update these numbers ONLY when intentionally adding or removing a wired site.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const EXPECTED_WIRINGS: Record<string, number> = {
  "src/agents/tools/tts-tool.ts": 1,
  "src/gateway/server-methods/tts.ts": 1,
  "src/auto-reply/reply/dispatch-from-config.ts": 4,
  "src/auto-reply/reply/dispatch-acp.ts": 1,
  "src/auto-reply/reply/dispatch-acp-delivery.ts": 1,
  "src/cron/isolated-agent/delivery-dispatch.ts": 1,
  "src/infra/outbound/message-action-tts.ts": 2,
  "src/agents/command/delivery.ts": 1,
  "src/auto-reply/reply/commands-tts.ts": 1,
};

// Talk and telephony must NEVER thread the hook (documented exclusion): the
// tts_prepare hook is for agent/tool voice notes only.
const FORBIDDEN_WIRINGS = ["src/gateway/server-methods/talk.ts"];

function countOccurrences(rel: string, needle: string): number {
  const src = readFileSync(resolve(repoRoot, rel), "utf8");
  return src.split(needle).length - 1;
}

describe("tts_prepare call-site wiring", () => {
  it.each(Object.entries(EXPECTED_WIRINGS))(
    "%s threads buildTtsPrepareHook exactly %d time(s)",
    (rel, expected) => {
      expect(countOccurrences(rel, "buildTtsPrepareHook(")).toBe(expected);
    },
  );

  it.each(FORBIDDEN_WIRINGS)("%s does not thread the tts_prepare hook", (rel) => {
    expect(countOccurrences(rel, "buildTtsPrepareHook(")).toBe(0);
  });
});
