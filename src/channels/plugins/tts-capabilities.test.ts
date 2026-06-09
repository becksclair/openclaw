import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyPluginRegistry } from "../../plugins/registry-empty.js";
import { setActivePluginRegistry } from "../../plugins/runtime.js";
import {
  createChannelTestPluginBase,
  createTestRegistry,
} from "../../test-utils/channel-plugins.js";
import { resolveChannelTtsVoiceDelivery } from "./tts-capabilities.js";
import type { ChannelPlugin } from "./types.js";

function createChannelPlugin(
  id: string,
  capabilities: ChannelPlugin["capabilities"],
): ChannelPlugin {
  return createChannelTestPluginBase({
    id,
    label: id,
    capabilities,
    config: {
      listAccountIds: () => ["default"],
    },
  });
}

describe("resolveChannelTtsVoiceDelivery", () => {
  afterEach(() => {
    setActivePluginRegistry(createEmptyPluginRegistry());
  });

  it("reads bundled voice delivery behavior from lightweight public artifacts", () => {
    expect(resolveChannelTtsVoiceDelivery("discord")).toEqual({
      synthesisTarget: "voice-note",
      transcodesAudio: true,
    });
    expect(resolveChannelTtsVoiceDelivery("feishu")).toEqual({
      synthesisTarget: "voice-note",
      transcodesAudio: true,
    });
    expect(resolveChannelTtsVoiceDelivery("matrix")).toEqual({
      synthesisTarget: "voice-note",
    });
    expect(resolveChannelTtsVoiceDelivery("telegram")).toEqual({
      synthesisTarget: "voice-note",
      transcodesAudio: true,
    });
    expect(resolveChannelTtsVoiceDelivery("whatsapp")).toEqual({
      synthesisTarget: "voice-note",
      transcodesAudio: true,
    });
  });

  it("treats invalid artifact directory names as unknown channels", () => {
    expect(resolveChannelTtsVoiceDelivery("../telegram")).toBeUndefined();
    expect(resolveChannelTtsVoiceDelivery("telegram/../discord")).toBeUndefined();
    expect(resolveChannelTtsVoiceDelivery("telegram:voice")).toBeUndefined();
  });

  it("resolves registered aliases through the canonical lightweight artifact", () => {
    const feishu = createChannelPlugin("feishu", { chatTypes: ["direct"] });
    setActivePluginRegistry(
      createTestRegistry([
        {
          pluginId: "feishu",
          plugin: {
            ...feishu,
            meta: {
              ...feishu.meta,
              aliases: ["lark"],
            },
          },
          source: "test",
        },
      ]),
    );

    expect(resolveChannelTtsVoiceDelivery("lark")).toEqual({
      synthesisTarget: "voice-note",
      transcodesAudio: true,
    });
  });

  it("does not materialize a bundled channel plugin when the artifact exists", async () => {
    vi.resetModules();
    const getBundledChannelPlugin = vi.fn(() => {
      throw new Error("full bundled channel plugin should not load");
    });
    vi.doMock("./bundled.js", () => ({
      getBundledChannelPlugin,
    }));
    const { resolveChannelTtsVoiceDelivery: resolveWithoutBundledPluginLoad } =
      await import("./tts-capabilities.js");

    expect(resolveWithoutBundledPluginLoad("telegram")).toEqual({
      synthesisTarget: "voice-note",
      transcodesAudio: true,
    });
    expect(getBundledChannelPlugin).not.toHaveBeenCalled();
  });

  it("falls back to already-loaded channel plugin capabilities", () => {
    setActivePluginRegistry(
      createTestRegistry([
        {
          pluginId: "imessage",
          plugin: createChannelPlugin("imessage", {
            chatTypes: ["direct"],
            tts: {
              voice: {
                synthesisTarget: "audio-file",
                audioFileFormats: ["mp3", "caf", "audio/mpeg", "audio/x-caf"],
              },
            },
          }),
          source: "test",
        },
      ]),
    );
    expect(resolveChannelTtsVoiceDelivery("imessage")).toEqual({
      synthesisTarget: "audio-file",
      audioFileFormats: ["mp3", "caf", "audio/mpeg", "audio/x-caf"],
    });
    expect(resolveChannelTtsVoiceDelivery("slack")).toBeUndefined();
  });

  it("prefers loaded channel capabilities over bundled public artifacts", () => {
    setActivePluginRegistry(
      createTestRegistry([
        {
          pluginId: "telegram",
          plugin: createChannelPlugin("telegram", {
            chatTypes: ["direct"],
            tts: {
              voice: {
                synthesisTarget: "audio-file",
                audioFileFormats: ["mp3", "audio/mpeg"],
              },
            },
          }),
          source: "test",
        },
      ]),
    );

    expect(resolveChannelTtsVoiceDelivery("telegram")).toEqual({
      synthesisTarget: "audio-file",
      audioFileFormats: ["mp3", "audio/mpeg"],
    });
  });
});
