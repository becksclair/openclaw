import type { Client } from "@buape/carbon";
import type { DiscordAccountConfig } from "openclaw/plugin-sdk/config-runtime";
import {
  normalizeDiscordSlug,
  resolveDiscordChannelConfig,
  resolveDiscordGuildEntry,
  resolveDiscordOwnerAccess,
} from "../monitor/allow-list.js";
import { formatDiscordUserTag } from "../monitor/format.js";

const SPEAKER_CONTEXT_CACHE_TTL_MS = 60_000;

export type CachedSpeakerContext = {
  id: string;
  label: string;
  name?: string;
  tag?: string;
  senderIsOwner: boolean;
};

export class DiscordVoiceSpeakerResolver {
  private readonly cache = new Map<
    string,
    CachedSpeakerContext & {
      expiresAt: number;
    }
  >();

  constructor(
    private readonly client: Client,
    private readonly discordConfig: DiscordAccountConfig,
    private readonly ownerAllowFrom: string[],
  ) {}

  private resolveSpeakerContextCacheKey(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
  }

  private resolveSpeakerIsOwner(params: { id: string; name?: string; tag?: string }): boolean {
    return resolveDiscordOwnerAccess({
      allowFrom: this.ownerAllowFrom,
      sender: {
        id: params.id,
        name: params.name,
        tag: params.tag,
      },
      allowNameMatching: false,
    }).ownerAllowed;
  }

  private getCachedSpeakerContext(
    guildId: string,
    userId: string,
  ): CachedSpeakerContext | undefined {
    const key = this.resolveSpeakerContextCacheKey(guildId, userId);
    const cached = this.cache.get(key);
    if (!cached) {
      return undefined;
    }
    if (cached.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    return {
      id: cached.id,
      label: cached.label,
      name: cached.name,
      tag: cached.tag,
      senderIsOwner: cached.senderIsOwner,
    };
  }

  private setCachedSpeakerContext(
    guildId: string,
    userId: string,
    context: CachedSpeakerContext,
  ): void {
    const key = this.resolveSpeakerContextCacheKey(guildId, userId);
    this.cache.set(key, {
      ...context,
      expiresAt: Date.now() + SPEAKER_CONTEXT_CACHE_TTL_MS,
    });
  }

  voiceAccessNeedsMemberRoles(entry: {
    guildId: string;
    guildName?: string;
    channelId: string;
    channelName?: string;
  }): boolean {
    const guildInfo = resolveDiscordGuildEntry({
      guildId: entry.guildId,
      guild: entry.guildName ? ({ id: entry.guildId, name: entry.guildName } as never) : null,
      guildEntries: this.discordConfig.guilds,
    });
    const channelConfig = resolveDiscordChannelConfig({
      guildInfo,
      channelId: entry.channelId,
      channelName: entry.channelName,
      channelSlug: entry.channelName ? normalizeDiscordSlug(entry.channelName) : "",
    });
    const roleAllowList = channelConfig?.roles ?? guildInfo?.roles;
    return Array.isArray(roleAllowList) && roleAllowList.length > 0;
  }

  async resolveSpeakerDetails(
    guildId: string,
    userId: string,
    options?: { needsMemberRoles?: boolean },
  ): Promise<{
    speaker: CachedSpeakerContext;
    memberRoleIds: string[];
  }> {
    const cached = this.getCachedSpeakerContext(guildId, userId);
    if (cached && !options?.needsMemberRoles) {
      return {
        speaker: cached,
        memberRoleIds: [],
      };
    }
    const identity = await this.resolveSpeakerIdentity(guildId, userId);
    if (cached) {
      return {
        speaker: cached,
        memberRoleIds: identity.memberRoleIds,
      };
    }
    const speaker = {
      id: identity.id,
      label: identity.label,
      name: identity.name,
      tag: identity.tag,
      senderIsOwner: this.resolveSpeakerIsOwner({
        id: identity.id,
        name: identity.name,
        tag: identity.tag,
      }),
    };
    this.setCachedSpeakerContext(guildId, userId, speaker);
    return {
      speaker,
      memberRoleIds: identity.memberRoleIds,
    };
  }

  getCacheForTests() {
    return this.cache;
  }

  async resolveSpeakerIdentity(
    guildId: string,
    userId: string,
  ): Promise<{
    id: string;
    label: string;
    name?: string;
    tag?: string;
    memberRoleIds: string[];
  }> {
    try {
      const member = await this.client.fetchMember(guildId, userId);
      const username = member.user?.username ?? undefined;
      return {
        id: userId,
        label: member.nickname ?? member.user?.globalName ?? username ?? userId,
        name: username,
        tag: member.user ? formatDiscordUserTag(member.user) : undefined,
        memberRoleIds: Array.isArray(member.roles)
          ? member.roles
              .map((role) =>
                typeof role === "string" ? role : typeof role?.id === "string" ? role.id : "",
              )
              .filter(Boolean)
          : [],
      };
    } catch {
      try {
        const user = await this.client.fetchUser(userId);
        const username = user.username ?? undefined;
        return {
          id: userId,
          label: user.globalName ?? username ?? userId,
          name: username,
          tag: formatDiscordUserTag(user),
          memberRoleIds: [],
        };
      } catch {
        return { id: userId, label: userId, memberRoleIds: [] };
      }
    }
  }
}
