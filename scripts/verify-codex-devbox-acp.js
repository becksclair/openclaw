#!/usr/bin/env -S node --import tsx

// End-to-end verification for the codex-devbox ACP Discord binding.
//
// Uses Gateway chat.send + agent.wait to simulate Discord inbound routing through
// the configured ACP binding. This avoids touching session files directly and
// works even when the Discord bot ignores its own messages.
//
// When run with --live-discord, it also posts a "test initiated" notice to the
// bound Discord thread so a human or another bot can reply there for a fully live
// test. Because the OpenClaw bot drops its own messages, the bot cannot post and
// reply to itself in the same thread.
//
// Prerequisites:
//   - One configured Discord ACP binding, or selectors when multiple bindings exist
//   - For --live-discord: rbw must be unlocked and --rbw-item or
//     OPENCLAW_CODEX_DEVBOX_ACP_DISCORD_TOKEN_RBW_ITEM must name the token item
//   - Gateway must be running with the codex-devbox ACP binding configured

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolveConfiguredAcpBindingRecord } from "../src/acp/persistent-bindings.resolve.ts";
import { loadConfig } from "../src/config/config.ts";
import { callGateway } from "../src/gateway/call.ts";
import { normalizeAccountId } from "../src/routing/session-key.ts";

const TEST_PHRASE_PREFIX = "LIVE-ACP-VERIFY-OK";
const TIMEOUT_MS = 120_000;
const DISCORD_POST_TIMEOUT_MS = 10_000;

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function usage() {
  return (
    "Usage: scripts/verify-codex-devbox-acp.js [--session-key <key>] [--thread-id <discord-thread-id>] [--account-id default] [--binding-label <label>] [--live-discord --rbw-item <item>]\n" +
    "When session/thread are omitted, the verifier discovers one configured Discord ACP binding.\n" +
    "Environment fallbacks:\n" +
    "  OPENCLAW_CODEX_DEVBOX_ACP_SESSION_KEY\n" +
    "  OPENCLAW_CODEX_DEVBOX_ACP_DISCORD_THREAD_ID\n" +
    "  OPENCLAW_CODEX_DEVBOX_ACP_DISCORD_ACCOUNT_ID\n" +
    "  OPENCLAW_CODEX_DEVBOX_ACP_DISCORD_TOKEN_RBW_ITEM"
  );
}

function discoverConfiguredDiscordBinding({ accountId, label, threadId }) {
  const cfg = loadConfig();
  const requestedAccountId = accountId ? normalizeAccountId(accountId) : undefined;
  const candidates = (cfg.bindings ?? []).filter((binding) => {
    if (
      binding.type !== "acp" ||
      binding.match?.channel !== "discord" ||
      binding.match.peer?.kind !== "channel"
    ) {
      return false;
    }
    if (label && binding.acp?.label !== label) {
      return false;
    }
    const accountPattern = binding.match.accountId?.trim();
    if (
      requestedAccountId &&
      accountPattern !== "*" &&
      normalizeAccountId(accountPattern) !== requestedAccountId
    ) {
      return false;
    }
    return !threadId || binding.match.peer?.id === threadId;
  });
  const conversationIds = [
    ...new Set(candidates.map((binding) => binding.match.peer?.id?.trim()).filter(Boolean)),
  ];
  if (conversationIds.length !== 1) {
    fail(
      `Expected exactly one configured Discord ACP conversation, found ${conversationIds.length}. ` +
        `Pass --thread-id or --binding-label to disambiguate.\n${usage()}`,
    );
  }
  const discoveredThreadId = conversationIds[0];
  const conversationBindings = candidates.filter(
    (binding) => binding.match.peer?.id?.trim() === discoveredThreadId,
  );
  const exactAccountIds = [
    ...new Set(
      conversationBindings
        .map((binding) => binding.match.accountId?.trim())
        .filter((value) => value && value !== "*"),
    ),
  ];
  let discoveredAccountId = requestedAccountId;
  if (!discoveredAccountId) {
    if (exactAccountIds.length === 1) {
      discoveredAccountId = exactAccountIds[0];
    } else if (exactAccountIds.length > 1) {
      fail(`Multiple Discord accounts match this ACP conversation; pass --account-id.\n${usage()}`);
    } else if (conversationBindings.some((binding) => !binding.match.accountId?.trim())) {
      discoveredAccountId = "default";
    } else {
      fail(`Wildcard Discord ACP bindings require a concrete --account-id.\n${usage()}`);
    }
  }
  const resolved = resolveConfiguredAcpBindingRecord({
    cfg,
    channel: "discord",
    accountId: discoveredAccountId,
    conversationId: discoveredThreadId,
  });
  if (!resolved) {
    fail(`Configured Discord ACP binding could not be materialized.\n${usage()}`);
  }
  return {
    sessionKey: resolved.record.targetSessionKey,
    threadId: discoveredThreadId,
    accountId: resolved.record.conversation.accountId,
  };
}

function requiredConfigValue(name, value) {
  const trimmed = value?.trim();
  if (!trimmed) {
    fail(`Missing ${name}.\n${usage()}`);
  }
  return trimmed;
}

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function fail(msg) {
  console.error(`\nFAIL: ${msg}\n`);
  process.exit(1);
}

function pass(msg) {
  console.log(`\nPASS: ${msg}\n`);
}

function getRbwToken(name) {
  try {
    return execFileSync("rbw", ["get", name], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

async function postDiscordNotice(token, threadId, content) {
  const res = await fetch(`https://discord.com/api/v10/channels/${threadId}/messages`, {
    method: "POST",
    signal: AbortSignal.timeout(DISCORD_POST_TIMEOUT_MS),
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`Discord post failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.ok;
}

function readMessageText(message) {
  const content = message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => (typeof block?.text === "string" ? block.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return typeof content?.text === "string" ? content.text : "";
}

async function runGatewaySimulationTest(config) {
  const opts = {
    clientName: "cli",
    mode: "cli",
    scopes: ["operator.admin"],
  };

  const testPhrase = `${TEST_PHRASE_PREFIX}-${randomUUID()}`;
  log(`Sending simulated Discord inbound to ${config.bindingSessionKey} ...`);

  const started = await callGateway({
    ...opts,
    method: "chat.send",
    params: {
      sessionKey: config.bindingSessionKey,
      message: `Reply with exactly ${testPhrase}`,
      idempotencyKey: randomUUID(),
      originatingChannel: "discord",
      originatingTo: `channel:${config.discordThreadId}`,
      originatingAccountId: config.discordAccountId,
    },
    timeoutMs: TIMEOUT_MS + 10_000,
  });

  const runId = typeof started?.runId === "string" ? started.runId : undefined;
  if (!runId) {
    fail(`chat.send did not return a runId: ${JSON.stringify(started)}`);
  }

  log(`Run started: ${runId}`);

  const waited = await callGateway({
    ...opts,
    method: "agent.wait",
    params: { runId, timeoutMs: TIMEOUT_MS },
    timeoutMs: TIMEOUT_MS + 10_000,
  });

  if (waited.status !== "ok") {
    fail(`agent.wait failed: ${JSON.stringify(waited)}`);
  }

  log("Run completed");

  const hist = await callGateway({
    ...opts,
    method: "chat.history",
    params: { sessionKey: config.bindingSessionKey, limit: 12 },
    timeoutMs: 10_000,
  });

  const messages = hist?.messages ?? [];
  const targetAssistant = messages.toReversed().find((m) => {
    if (m.role !== "assistant") {
      return false;
    }
    return readMessageText(m).includes(testPhrase);
  });

  if (!targetAssistant) {
    fail("No assistant turn containing the test phrase was found in history");
  }

  const model = targetAssistant.model;
  const text = readMessageText(targetAssistant);

  log(`Target assistant model: ${model}`);
  log(`Target assistant text:  ${text}`);

  if (model !== "acp-runtime") {
    fail(`Expected model "acp-runtime", got "${model}"`);
  }

  if (!text.includes(testPhrase)) {
    fail(`Response did not contain "${testPhrase}" (got: "${text}")`);
  }

  return { model, text };
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(usage());
    return;
  }
  const liveDiscord = process.argv.includes("--live-discord");
  const explicitSessionKey =
    argValue("--session-key") || process.env.OPENCLAW_CODEX_DEVBOX_ACP_SESSION_KEY;
  const explicitThreadId =
    argValue("--thread-id") || process.env.OPENCLAW_CODEX_DEVBOX_ACP_DISCORD_THREAD_ID;
  const explicitAccountId =
    argValue("--account-id") || process.env.OPENCLAW_CODEX_DEVBOX_ACP_DISCORD_ACCOUNT_ID;
  const discovered = discoverConfiguredDiscordBinding({
    accountId: explicitAccountId,
    label: argValue("--binding-label"),
    threadId: explicitThreadId,
  });
  if (explicitSessionKey && explicitSessionKey.trim() !== discovered.sessionKey) {
    fail("Explicit ACP session key does not match the configured Discord binding.");
  }
  const config = {
    bindingSessionKey: requiredConfigValue("ACP binding session key", discovered.sessionKey),
    discordThreadId: requiredConfigValue("Discord thread id", discovered.threadId),
    discordAccountId: discovered.accountId,
    discordTokenRbwItem:
      argValue("--rbw-item") || process.env.OPENCLAW_CODEX_DEVBOX_ACP_DISCORD_TOKEN_RBW_ITEM,
  };

  console.log("=== configured Discord ACP binding verification ===\n");

  if (liveDiscord) {
    const rbwItem = requiredConfigValue("Discord token rbw item", config.discordTokenRbwItem);
    const token = getRbwToken(rbwItem);
    if (!token) {
      fail(`Discord token item "${rbwItem}" not found in rbw. Run: rbw unlock`);
    }
    log("Fetched Discord token from rbw");
    const notice = `[TEST] codex-devbox ACP verification initiated ${new Date().toISOString()}. The OpenClaw bot cannot reply to its own messages; a human or external bot must post here for a fully live end-to-end test.`;
    const posted = await postDiscordNotice(token, config.discordThreadId, notice);
    if (posted) {
      log("Posted test-initiated notice to Discord thread");
    }
  }

  await runGatewaySimulationTest(config);

  if (liveDiscord) {
    log("\nGateway simulation passed, but live Discord routing was not verified.");
    log("   Post a message in the bound Discord thread from a non-bot account");
    log("   and check that codex-devbox replies via ACP (model=acp-runtime).");
  }

  pass("codex-devbox ACP Discord binding is routing correctly");
}

// oxlint-disable-next-line typescript/use-unknown-in-catch-callback-variable -- This verifier is plain JS, so catch callback variables cannot be type annotated.
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
