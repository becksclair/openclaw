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
//   - --session-key or OPENCLAW_CODEX_DEVBOX_ACP_SESSION_KEY
//   - --thread-id or OPENCLAW_CODEX_DEVBOX_ACP_DISCORD_THREAD_ID
//   - For --live-discord: rbw must be unlocked and --rbw-item or
//     OPENCLAW_CODEX_DEVBOX_ACP_DISCORD_TOKEN_RBW_ITEM must name the token item
//   - Gateway must be running with the codex-devbox ACP binding configured

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { callGateway } from "../src/gateway/call.ts";

const TEST_PHRASE = "LIVE-ACP-VERIFY-OK";
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
    "Usage: scripts/verify-codex-devbox-acp.js --session-key <key> --thread-id <discord-thread-id> [--account-id default] [--live-discord --rbw-item <item>]\n" +
    "Environment fallbacks:\n" +
    "  OPENCLAW_CODEX_DEVBOX_ACP_SESSION_KEY\n" +
    "  OPENCLAW_CODEX_DEVBOX_ACP_DISCORD_THREAD_ID\n" +
    "  OPENCLAW_CODEX_DEVBOX_ACP_DISCORD_ACCOUNT_ID\n" +
    "  OPENCLAW_CODEX_DEVBOX_ACP_DISCORD_TOKEN_RBW_ITEM"
  );
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

  log(`Sending simulated Discord inbound to ${config.bindingSessionKey} ...`);

  const started = await callGateway({
    ...opts,
    method: "chat.send",
    params: {
      sessionKey: config.bindingSessionKey,
      message: `Reply with exactly ${TEST_PHRASE}`,
      idempotencyKey: randomUUID(),
      originatingChannel: "discord",
      originatingTo: `channel:${config.discordThreadId}`,
      originatingAccountId: config.discordAccountId,
    },
    timeoutMs: 10_000,
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
    return readMessageText(m).includes(TEST_PHRASE);
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

  if (!text.includes(TEST_PHRASE)) {
    fail(`Response did not contain "${TEST_PHRASE}" (got: "${text}")`);
  }

  return { model, text };
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(usage());
    return;
  }
  const liveDiscord = process.argv.includes("--live-discord");
  const config = {
    bindingSessionKey: requiredConfigValue(
      "ACP binding session key",
      argValue("--session-key") || process.env.OPENCLAW_CODEX_DEVBOX_ACP_SESSION_KEY,
    ),
    discordThreadId: requiredConfigValue(
      "Discord thread id",
      argValue("--thread-id") || process.env.OPENCLAW_CODEX_DEVBOX_ACP_DISCORD_THREAD_ID,
    ),
    discordAccountId:
      argValue("--account-id") ||
      process.env.OPENCLAW_CODEX_DEVBOX_ACP_DISCORD_ACCOUNT_ID ||
      "default",
    discordTokenRbwItem:
      argValue("--rbw-item") || process.env.OPENCLAW_CODEX_DEVBOX_ACP_DISCORD_TOKEN_RBW_ITEM,
  };

  console.log("=== codex-devbox ACP binding verification ===\n");

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
