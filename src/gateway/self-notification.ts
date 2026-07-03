import { isChannelConfigured } from "../config/channel-configured.js";
// Detects forwarded phone notifications that are actually one of our own
// OpenClaw agents posting on an active messaging channel, so the heartbeat does
// not wake on (and react to) its own output.
//
// The match is identity-driven and package-name-free: it compares the
// notification's visible sender (title, or the "Sender:" prefix of a grouped
// message body) against the set of our own agent/bot identities, derived from
// config plus the live channel runtime snapshot. Because it never keys on an
// Android package id, it works cross-platform (iOS notifications carry no
// package name).
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { ChannelRuntimeSnapshot } from "./server-channel-runtime.types.js";

/** Minimum identity token length; guards against over-broad single-char matches. */
const MIN_IDENTITY_LENGTH = 2;

function addIdentity(set: Set<string>, value: unknown): void {
  if (typeof value !== "string") {
    return;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.length >= MIN_IDENTITY_LENGTH) {
    set.add(normalized);
  }
}

/** Extract likely display-name/username fields from an opaque snapshot identity blob. */
function addIdentitiesFromUnknown(set: Set<string>, blob: unknown): void {
  if (!blob || typeof blob !== "object") {
    return;
  }
  const record = blob as Record<string, unknown>;
  for (const field of ["username", "name", "first_name", "displayName", "pushName"]) {
    addIdentity(set, record[field]);
  }
}

/**
 * Build the lowercased set of "our own" identity tokens that can appear as the
 * sender/title of a forwarded phone notification. Combines config-derived agent
 * identities (auto-adapts as agents are added) with runtime-resolved channel
 * identities (Discord bot username, WhatsApp self, account labels), scoped to
 * channels that are actually configured.
 */
export function collectOwnNotificationIdentities(params: {
  cfg: OpenClawConfig;
  runtimeSnapshot?: ChannelRuntimeSnapshot | null;
  env?: NodeJS.ProcessEnv;
}): Set<string> {
  const { cfg, runtimeSnapshot, env } = params;
  const identities = new Set<string>();

  // The framework itself, so its own status posts never wake a loop.
  identities.add("openclaw");

  // Config-derived agent identities (no disk I/O in this hot path).
  addIdentity(identities, cfg.ui?.assistant?.name);
  for (const agent of cfg.agents?.list ?? []) {
    addIdentity(identities, agent?.name);
    addIdentity(identities, agent?.identity?.name);
  }

  // Runtime channel identities, scoped to configured channels.
  const channelAccounts = runtimeSnapshot?.channelAccounts ?? {};
  for (const channelId of Object.keys(channelAccounts)) {
    if (!isChannelConfigured(cfg, channelId, env)) {
      continue;
    }
    const perAccount = channelAccounts[channelId as keyof typeof channelAccounts] ?? {};
    for (const account of Object.values(perAccount)) {
      if (!account) {
        continue;
      }
      addIdentity(identities, account.name);
      addIdentitiesFromUnknown(identities, account.bot);
      addIdentitiesFromUnknown(identities, (account as Record<string, unknown>).self);
    }
  }

  return identities;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when the notification's visible sender matches one of our own
 * identities as a bounded word. Checks the title and, for grouped messages
 * rendered as "Sender: message", the leading sender token of the body.
 * Tolerates a trailing "(N)" unread count and a mute/emoji glyph, mirroring the
 * shape real messaging-app notifications use. Content-based, so it is
 * independent of package name or OS.
 */
export function isSelfAuthoredNotification(params: {
  title?: string | null;
  text?: string | null;
  identities: Set<string>;
}): boolean {
  const { identities } = params;
  if (identities.size === 0) {
    return false;
  }
  const title = typeof params.title === "string" ? params.title : "";
  const text = typeof params.text === "string" ? params.text : "";

  const haystacks = [title];
  // Grouped notifications render as "Sender: message"; include the sender token.
  const colonIndex = text.indexOf(":");
  const senderPrefix = colonIndex >= 0 ? text.slice(0, colonIndex).trim() : "";
  if (senderPrefix.length > 0 && senderPrefix.length <= 64) {
    haystacks.push(senderPrefix);
  }
  const haystack = haystacks.join("\n").toLowerCase();
  if (!haystack.trim()) {
    return false;
  }

  for (const identity of identities) {
    const pattern = new RegExp(
      `(?:^|[\\s:#])${escapeRegExp(identity)}(?:\\s*\\(\\d+\\))?(?:\\s*[\\p{Extended_Pictographic}\\uFE0F])?(?=$|[\\s:#\\-])`,
      "u",
    );
    if (pattern.test(haystack)) {
      return true;
    }
  }
  return false;
}
