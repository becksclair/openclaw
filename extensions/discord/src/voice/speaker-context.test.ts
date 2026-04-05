import type { Client } from "@buape/carbon";
import type { DiscordAccountConfig } from "openclaw/plugin-sdk/config-runtime";
import { describe, expect, it, vi } from "vitest";
import { DiscordVoiceSpeakerResolver } from "./speaker-context.js";

function createClient() {
  return {
    fetchMember: vi.fn(),
    fetchUser: vi.fn(),
  } as unknown as Client & {
    fetchMember: ReturnType<typeof vi.fn>;
    fetchUser: ReturnType<typeof vi.fn>;
  };
}

describe("DiscordVoiceSpeakerResolver", () => {
  it("caches full speaker context including ownership metadata", async () => {
    const client = createClient();
    client.fetchMember.mockResolvedValue({
      nickname: "Owner Nick",
      roles: ["role-voice"],
      user: {
        id: "u-owner",
        username: "owner",
        globalName: "Owner",
        discriminator: "1234",
      },
    });
    const resolver = new DiscordVoiceSpeakerResolver(client, {} as DiscordAccountConfig, [
      "discord:u-owner",
    ]);

    const first = await resolver.resolveSpeakerDetails("g1", "u-owner");
    const second = await resolver.resolveSpeakerDetails("g1", "u-owner");
    const cached = resolver.getCacheForTests().get("g1:u-owner");

    expect(first).toEqual({
      speaker: {
        id: "u-owner",
        label: "Owner Nick",
        name: "owner",
        tag: expect.any(String),
        senderIsOwner: true,
      },
      memberRoleIds: ["role-voice"],
    });
    expect(second).toEqual({
      speaker: {
        id: "u-owner",
        label: "Owner Nick",
        name: "owner",
        tag: expect.any(String),
        senderIsOwner: true,
      },
      memberRoleIds: [],
    });
    expect(cached).toEqual(
      expect.objectContaining({
        id: "u-owner",
        label: "Owner Nick",
        name: "owner",
        senderIsOwner: true,
      }),
    );
    expect(client.fetchMember).toHaveBeenCalledTimes(1);
  });

  it("re-fetches member roles when voice access checks need fresh role state", async () => {
    const client = createClient();
    client.fetchMember
      .mockResolvedValueOnce({
        nickname: "Role Speaker",
        roles: ["role-voice"],
        user: {
          id: "u-role",
          username: "role",
          globalName: "Role",
          discriminator: "2222",
        },
      })
      .mockResolvedValueOnce({
        nickname: "Role Speaker",
        roles: [],
        user: {
          id: "u-role",
          username: "role",
          globalName: "Role",
          discriminator: "2222",
        },
      });
    const resolver = new DiscordVoiceSpeakerResolver(
      client,
      {
        guilds: {
          g1: {
            channels: {
              c1: {
                roles: ["role:role-voice"],
              },
            },
          },
        },
      } as DiscordAccountConfig,
      [],
    );

    expect(
      resolver.voiceAccessNeedsMemberRoles({
        guildId: "g1",
        channelId: "c1",
      }),
    ).toBe(true);

    const first = await resolver.resolveSpeakerDetails("g1", "u-role", {
      needsMemberRoles: true,
    });
    const second = await resolver.resolveSpeakerDetails("g1", "u-role", {
      needsMemberRoles: true,
    });

    expect(first.memberRoleIds).toEqual(["role-voice"]);
    expect(second.memberRoleIds).toEqual([]);
    expect(second.speaker).toEqual(first.speaker);
    expect(client.fetchMember).toHaveBeenCalledTimes(2);
  });

  it("uses guild-name slug matching when channel metadata lacks a direct guild id entry", () => {
    const client = createClient();
    const resolver = new DiscordVoiceSpeakerResolver(
      client,
      {
        guilds: {
          "guild-one": {
            channels: {
              "voice-channel": {
                roles: ["role:voice"],
              },
            },
          },
        },
      } as DiscordAccountConfig,
      [],
    );

    expect(
      resolver.voiceAccessNeedsMemberRoles({
        guildId: "g1",
        guildName: "Guild One",
        channelId: "c1",
        channelName: "Voice Channel",
      }),
    ).toBe(true);
  });
});
