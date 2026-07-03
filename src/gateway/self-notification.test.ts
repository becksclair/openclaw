// Covers own-agent notification detection used to keep the heartbeat from
// waking on its own channel output.
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  collectOwnNotificationIdentities,
  isSelfAuthoredNotification,
} from "./self-notification.js";
import type { ChannelRuntimeSnapshot } from "./server-channel-runtime.types.js";

const cfg = {
  ui: { assistant: { name: "Sky" } },
  agents: {
    list: [
      { id: "sky", name: "sky" },
      { id: "luke", name: "luke" },
    ],
  },
  channels: {
    telegram: { accounts: { default: {}, luke: { name: "Luke" } } },
    discord: { accounts: { default: {} } },
  },
} as unknown as OpenClawConfig;

const snapshot = {
  channels: {},
  channelAccounts: {
    telegram: { luke: { name: "Luke" } },
    discord: { default: { name: "SkyOps", bot: { username: "SkyOpsBot", id: "42" } } },
  },
} as unknown as ChannelRuntimeSnapshot;

describe("collectOwnNotificationIdentities", () => {
  it("gathers config agent names, the assistant name, and the framework", () => {
    const ids = collectOwnNotificationIdentities({ cfg });
    expect(ids.has("sky")).toBe(true);
    expect(ids.has("luke")).toBe(true);
    expect(ids.has("openclaw")).toBe(true);
  });

  it("adds runtime channel identities (bot username, account labels)", () => {
    const ids = collectOwnNotificationIdentities({ cfg, runtimeSnapshot: snapshot });
    expect(ids.has("skyopsbot")).toBe(true); // discord bot username
    expect(ids.has("skyops")).toBe(true); // discord account label
    expect(ids.has("luke")).toBe(true); // telegram account label
  });

  it("does not include single-character or empty tokens", () => {
    const ids = collectOwnNotificationIdentities({
      cfg: { agents: { list: [{ id: "x", name: "x" }] } } as unknown as OpenClawConfig,
    });
    expect(ids.has("x")).toBe(false);
  });
});

describe("isSelfAuthoredNotification", () => {
  const identities = new Set(["sky", "luke", "openclaw"]);

  it.each([
    { title: "Sky (2)", text: "", expected: true, note: "DM from our bot, unread count" },
    { title: "Sky", text: "", expected: true, note: "bare bot title" },
    {
      title: "Sky Life General",
      text: "clear skies tonight",
      expected: true,
      note: "group named after us",
    },
    {
      title: "Helia System #hermes: Luke",
      text: "deploy done",
      expected: true,
      note: "group + our agent sender",
    },
    {
      title: "Telegram",
      text: "Sky: heads up",
      expected: true,
      note: "grouped body sender prefix",
    },
    { title: "Esther", text: "Are you awake?", expected: false, note: "real human contact" },
    {
      title: "Esther",
      text: "Sky are you awake?",
      expected: false,
      note: "colonless body mentioning our agent",
    },
    { title: "Skylar", text: "hey", expected: false, note: "word-boundary: not our 'sky'" },
    { title: "Bob (3)", text: "call me", expected: false, note: "unrelated sender with count" },
    { title: "Risky business", text: "", expected: false, note: "substring inside another word" },
  ])("$note → $expected", ({ title, text, expected }) => {
    expect(isSelfAuthoredNotification({ title, text, identities })).toBe(expected);
  });

  it("returns false when the identity set is empty", () => {
    expect(isSelfAuthoredNotification({ title: "Sky (2)", text: "", identities: new Set() })).toBe(
      false,
    );
  });

  it("handles missing title/text without throwing", () => {
    expect(isSelfAuthoredNotification({ identities })).toBe(false);
    expect(isSelfAuthoredNotification({ title: null, text: null, identities })).toBe(false);
  });
});
