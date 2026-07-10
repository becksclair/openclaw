// Whatsapp tests cover index plugin behavior.
import { assertBundledChannelEntries } from "openclaw/plugin-sdk/channel-test-helpers";
import { describe, expect, it } from "vitest";
import { whatsappPlugin } from "./channel-plugin-api.js";
import entry from "./index.js";
import setupEntry from "./setup-entry.js";

describe("whatsapp bundled entries", () => {
  assertBundledChannelEntries({
    entry,
    expectedId: "whatsapp",
    expectedName: "WhatsApp",
    setupEntry,
  });

  it("declares account and archive config as channel-restart reload metadata", () => {
    expect(whatsappPlugin.reload).toEqual({
      configPrefixes: [
        "web",
        "channels.whatsapp.accounts",
        "channels.whatsapp.archive",
        "channels.whatsapp.selfChatMode",
      ],
      noopPrefixes: ["channels.whatsapp"],
    });
  });
});
