import process from "node:process";
import { createArgReader } from "./gateway-ws-client.ts";

type HarnessCommand =
  | "status"
  | "snapshot"
  | "show"
  | "hide"
  | "settings:get"
  | "settings:set"
  | "click"
  | "type"
  | "request"
  | "wait-for"
  | "chat:send"
  | "node:pair"
  | "node:approve-first"
  | "node:reject-first"
  | "node:invoke";

type RequestOptions = {
  baseUrl: string;
  token: string;
  method: string;
  path: string;
  body?: unknown;
  timeoutMs: number;
};

type SnapshotSource = "status" | "snapshot" | "settings";

function writeStdoutLine(message: string): void {
  process.stdout.write(`${message}\n`);
}

function writeStderrLine(message: string): void {
  process.stderr.write(`${message}\n`);
}

function usage(): string {
  return [
    "Usage:",
    "  bun scripts/dev/desktop-harness.ts <command> [options]",
    "",
    "Commands:",
    "  status",
    "  snapshot",
    "  show",
    "  hide",
    "  settings:get",
    "  settings:set [--gateway-url <url>] [--gateway-token <token>] [--last-tab <chat|voice|settings>] [--launch-at-login <true|false>] [--json <json>]",
    "  click --target <action>",
    "  type --target <chat.input|settings.gatewayToken|settings.gatewayUrl> --value <text>",
    "  wait-for --path <dot.path> [--source <status|snapshot|settings>] [--equals <value-or-json>] [--contains <text>] [--truthy] [--exists] [--interval-ms <ms>] [--timeout-ms <ms>]",
    "  chat:send --message <text>",
    "  node:pair",
    "  node:approve-first",
    "  node:reject-first",
    "  node:invoke --action <device.info|device.status|system.notify>",
    "  request --method <GET|POST> --path </app/status> [--json <json>]",
    "",
    "Auth:",
    "  --url <http://127.0.0.1:PORT> or OPENCLAW_DESKTOP_HARNESS_URL",
    "  --token <token> or OPENCLAW_DESKTOP_HARNESS_TOKEN",
    "",
    "Examples:",
    "  bun scripts/dev/desktop-harness.ts status --url http://127.0.0.1:40123 --token ocdth-...",
    "  bun scripts/dev/desktop-harness.ts wait-for --path frontendReady --source status --truthy",
    "  bun scripts/dev/desktop-harness.ts chat:send --message 'hello from harness'",
    "  bun scripts/dev/desktop-harness.ts node:invoke --action device.status",
    "  bun scripts/dev/desktop-harness.ts settings:set --gateway-url ws://127.0.0.1:18789 --gateway-token secret --last-tab settings",
  ].join("\n");
}

function fail(message: string, exitCode = 1): never {
  writeStderrLine(message);
  process.exit(exitCode);
}

function resolveBaseUrl(raw: string): string {
  const normalized = raw.includes("://") ? raw : `http://${raw}`;
  const url = new URL(normalized);
  if (!url.port) {
    url.port = url.protocol === "https:" ? "443" : "80";
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

function parseJsonArg(raw: string, flagName: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    fail(
      `${flagName} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseLooseValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function parseBooleanArg(raw: string, flagName: string): boolean {
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  fail(`${flagName} must be 'true' or 'false'`);
}

function parsePositiveNumber(raw: string | undefined, flagName: string, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    fail(`${flagName} must be a positive number`);
  }
  return value;
}

function parseTimeoutMs(raw: string | undefined): number {
  return parsePositiveNumber(raw, "--timeout-ms", 5000);
}

function parseIntervalMs(raw: string | undefined): number {
  return parsePositiveNumber(raw, "--interval-ms", 250);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }
    return left.every((entry, index) => jsonEqual(entry, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    return leftKeys.every((key) => rightKeys.includes(key) && jsonEqual(left[key], right[key]));
  }
  return false;
}

async function requestJson(options: RequestOptions): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(`${options.baseUrl}${options.path}`, {
      method: options.method,
      headers: {
        Authorization: `Bearer ${options.token}`,
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as unknown) : null;
    if (!response.ok) {
      fail(
        `desktop harness request failed (${response.status} ${response.statusText}): ${JSON.stringify(payload, null, 2)}`,
        2,
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      fail(`desktop harness request timed out after ${options.timeoutMs}ms`, 2);
    }
    fail(
      `desktop harness request failed: ${error instanceof Error ? error.message : String(error)}`,
      2,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function getSourcePayload(
  baseUrl: string,
  token: string,
  source: SnapshotSource,
  timeoutMs: number,
): Promise<unknown> {
  if (source === "status") {
    return requestJson({ baseUrl, token, method: "GET", path: "/app/status", timeoutMs });
  }
  if (source === "settings") {
    return requestJson({ baseUrl, token, method: "GET", path: "/settings", timeoutMs });
  }
  return requestJson({ baseUrl, token, method: "GET", path: "/ui/snapshot", timeoutMs });
}

async function clickAction(
  baseUrl: string,
  token: string,
  target: string,
  timeoutMs: number,
): Promise<unknown> {
  return requestJson({
    baseUrl,
    token,
    method: "POST",
    path: "/ui/click",
    body: { target },
    timeoutMs,
  });
}

async function typeAction(
  baseUrl: string,
  token: string,
  target: string,
  value: string,
  timeoutMs: number,
): Promise<unknown> {
  return requestJson({
    baseUrl,
    token,
    method: "POST",
    path: "/ui/type",
    body: { target, value },
    timeoutMs,
  });
}

function getValueAtPath(payload: unknown, dotPath: string): unknown {
  if (!dotPath.trim()) {
    return payload;
  }
  const segments = dotPath.split(".").filter(Boolean);
  let current: unknown = payload;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    if (isRecord(current)) {
      current = current[segment];
      continue;
    }
    return undefined;
  }
  return current;
}

function matchesWaitCondition(
  value: unknown,
  options: {
    expectedEquals?: unknown;
    expectedContains?: string;
    truthy: boolean;
    exists: boolean;
  },
): boolean {
  if (options.exists && value === undefined) {
    return false;
  }
  if (options.truthy && !value) {
    return false;
  }
  if (options.expectedContains !== undefined) {
    if (typeof value !== "string" || !value.includes(options.expectedContains)) {
      return false;
    }
  }
  if (options.expectedEquals !== undefined && !jsonEqual(value, options.expectedEquals)) {
    return false;
  }
  return true;
}

function describeValue(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? String(value);
}

function printJson(payload: unknown): void {
  writeStdoutLine(JSON.stringify(payload, null, 2));
}

async function main(): Promise<void> {
  const { argv, get: getArg, has: hasArg } = createArgReader();
  const command = argv.find((value) => !value.startsWith("-")) as HarnessCommand | undefined;

  if (!command || hasArg("--help") || hasArg("-h")) {
    writeStdoutLine(usage());
    return;
  }

  const urlRaw = getArg("--url") ?? process.env.OPENCLAW_DESKTOP_HARNESS_URL;
  const token = getArg("--token") ?? process.env.OPENCLAW_DESKTOP_HARNESS_TOKEN;
  if (!urlRaw || !token) {
    fail(
      `${usage()}\n\nMissing harness auth. Set --url/--token or OPENCLAW_DESKTOP_HARNESS_URL/OPENCLAW_DESKTOP_HARNESS_TOKEN.`,
    );
  }

  const baseUrl = resolveBaseUrl(urlRaw);
  const timeoutMs = parseTimeoutMs(getArg("--timeout-ms"));

  if (command === "status") {
    printJson(await getSourcePayload(baseUrl, token, "status", timeoutMs));
    return;
  }

  if (command === "snapshot") {
    printJson(await getSourcePayload(baseUrl, token, "snapshot", timeoutMs));
    return;
  }

  if (command === "show") {
    printJson(
      await requestJson({ baseUrl, token, method: "POST", path: "/window/show", timeoutMs }),
    );
    return;
  }

  if (command === "hide") {
    printJson(
      await requestJson({ baseUrl, token, method: "POST", path: "/window/hide", timeoutMs }),
    );
    return;
  }

  if (command === "settings:get") {
    printJson(await getSourcePayload(baseUrl, token, "settings", timeoutMs));
    return;
  }

  if (command === "settings:set") {
    const jsonPatchRaw = getArg("--json");
    const patch = jsonPatchRaw ? parseJsonArg(jsonPatchRaw, "--json") : {};
    if (!isRecord(patch)) {
      fail("settings:set --json must decode to an object");
    }
    const nextPatch: Record<string, unknown> = { ...patch };
    const gatewayUrl = getArg("--gateway-url");
    const gatewayToken = getArg("--gateway-token");
    const lastTab = getArg("--last-tab");
    const launchAtLogin = getArg("--launch-at-login");
    if (gatewayUrl) {
      nextPatch.gatewayUrl = gatewayUrl;
    }
    if (gatewayToken !== undefined) {
      nextPatch.gatewayToken = gatewayToken;
    }
    if (lastTab) {
      if (lastTab !== "chat" && lastTab !== "voice" && lastTab !== "settings") {
        fail("--last-tab must be one of: chat, voice, settings");
      }
      nextPatch.lastTab = lastTab;
    }
    if (launchAtLogin !== undefined) {
      nextPatch.launchAtLogin = parseBooleanArg(launchAtLogin, "--launch-at-login");
    }
    printJson(
      await requestJson({
        baseUrl,
        token,
        method: "POST",
        path: "/settings",
        body: nextPatch,
        timeoutMs,
      }),
    );
    return;
  }

  if (command === "click") {
    const target = getArg("--target");
    if (!target) {
      fail("click requires --target");
    }
    printJson(await clickAction(baseUrl, token, target, timeoutMs));
    return;
  }

  if (command === "type") {
    const target = getArg("--target");
    const value = getArg("--value");
    if (!target || value === undefined) {
      fail("type requires --target and --value");
    }
    printJson(await typeAction(baseUrl, token, target, value, timeoutMs));
    return;
  }

  if (command === "wait-for") {
    const path = getArg("--path");
    const sourceRaw = getArg("--source") ?? "snapshot";
    const expectedEqualsRaw = getArg("--equals");
    const expectedContains = getArg("--contains");
    const truthy = hasArg("--truthy");
    const exists = hasArg("--exists");
    const intervalMs = parseIntervalMs(getArg("--interval-ms"));
    if (!path) {
      fail("wait-for requires --path");
    }
    if (sourceRaw !== "status" && sourceRaw !== "snapshot" && sourceRaw !== "settings") {
      fail("--source must be one of: status, snapshot, settings");
    }
    if (!truthy && !exists && expectedEqualsRaw === undefined && expectedContains === undefined) {
      fail("wait-for needs one condition: --equals, --contains, --truthy, or --exists");
    }

    const expectedEquals =
      expectedEqualsRaw === undefined ? undefined : parseLooseValue(expectedEqualsRaw);
    const deadline = Date.now() + timeoutMs;
    let lastPayload: unknown = null;
    let lastValue: unknown = undefined;

    while (Date.now() <= deadline) {
      lastPayload = await getSourcePayload(baseUrl, token, sourceRaw, timeoutMs);
      lastValue = getValueAtPath(lastPayload, path);
      if (
        matchesWaitCondition(lastValue, {
          expectedEquals,
          expectedContains: expectedContains ?? undefined,
          truthy,
          exists,
        })
      ) {
        printJson({ ok: true, path, source: sourceRaw, value: lastValue, payload: lastPayload });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    fail(
      `wait-for timed out after ${timeoutMs}ms for ${sourceRaw}.${path}; last value was ${describeValue(lastValue)}`,
      2,
    );
  }

  if (command === "chat:send") {
    const message = getArg("--message");
    if (!message) {
      fail("chat:send requires --message");
    }
    await clickAction(baseUrl, token, "tab.chat", timeoutMs);
    await typeAction(baseUrl, token, "chat.input", message, timeoutMs);
    await clickAction(baseUrl, token, "chat.send", timeoutMs);
    printJson(await getSourcePayload(baseUrl, token, "snapshot", timeoutMs));
    return;
  }

  if (command === "node:pair") {
    await clickAction(baseUrl, token, "tab.settings", timeoutMs);
    await clickAction(baseUrl, token, "node.pair", timeoutMs);
    printJson(await getSourcePayload(baseUrl, token, "snapshot", timeoutMs));
    return;
  }

  if (command === "node:approve-first") {
    await clickAction(baseUrl, token, "tab.settings", timeoutMs);
    await clickAction(baseUrl, token, "node.approveFirstPending", timeoutMs);
    printJson(await getSourcePayload(baseUrl, token, "snapshot", timeoutMs));
    return;
  }

  if (command === "node:reject-first") {
    await clickAction(baseUrl, token, "tab.settings", timeoutMs);
    await clickAction(baseUrl, token, "node.rejectFirstPending", timeoutMs);
    printJson(await getSourcePayload(baseUrl, token, "snapshot", timeoutMs));
    return;
  }

  if (command === "node:invoke") {
    const action = getArg("--action");
    if (action !== "device.info" && action !== "device.status" && action !== "system.notify") {
      fail("node:invoke requires --action device.info|device.status|system.notify");
    }
    await clickAction(baseUrl, token, "tab.settings", timeoutMs);
    await clickAction(baseUrl, token, `node.invoke.${action}`, timeoutMs);
    printJson(await getSourcePayload(baseUrl, token, "snapshot", timeoutMs));
    return;
  }

  if (command === "request") {
    const method = getArg("--method")?.toUpperCase();
    const path = getArg("--path");
    const bodyRaw = getArg("--json");
    if (!method || !path) {
      fail("request requires --method and --path");
    }
    printJson(
      await requestJson({
        baseUrl,
        token,
        method,
        path,
        body: bodyRaw === undefined ? undefined : parseJsonArg(bodyRaw, "--json"),
        timeoutMs,
      }),
    );
    return;
  }

  fail(`Unsupported desktop harness command: ${String(command)}`);
}

await main();
