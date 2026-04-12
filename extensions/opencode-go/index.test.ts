import { describe, expect, it } from "vitest";
import { registerSingleProviderPlugin } from "../../test/helpers/plugins/plugin-registration.js";
import { expectPassthroughReplayPolicy } from "../../test/helpers/provider-replay-policy.ts";
import plugin from "./index.js";

describe("opencode-go provider plugin", () => {
  it("registers the provider through the plugin boundary", async () => {
    const provider = await registerSingleProviderPlugin(plugin);

    expect(provider).toMatchObject({
      id: "opencode-go",
      label: "OpenCode Go",
      envVars: ["OPENCODE_API_KEY", "OPENCODE_ZEN_API_KEY"],
    });
  });

  it("owns passthrough-gemini replay policy for Gemini-backed models", async () => {
    await expectPassthroughReplayPolicy({
      plugin,
      providerId: "opencode-go",
      modelId: "gemini-2.5-pro",
      sanitizeThoughtSignatures: true,
    });
  });

  it("keeps non-Gemini replay policy minimal on passthrough routes", async () => {
    await expectPassthroughReplayPolicy({
      plugin,
      providerId: "opencode-go",
      modelId: "qwen3-coder",
    });
  });
});
