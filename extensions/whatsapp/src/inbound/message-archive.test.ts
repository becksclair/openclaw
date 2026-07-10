import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { proto } from "baileys";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractArchiveMediaType,
  extractArchiveText,
  toArchiveTimestampSeconds,
} from "../../message-archive-worker.runtime.js";
import { createWhatsAppMessageArchive } from "./message-archive.js";

type TestMessage = import("baileys").WAMessage;

const silentLogger = {
  warn: () => {},
  error: () => {},
};

function makeMessage(overrides: {
  id?: string;
  remoteJid?: string;
  fromMe?: boolean;
  timestamp?: unknown;
  pushName?: string;
  message?: Record<string, unknown> | null;
}): TestMessage {
  return {
    key: {
      id: overrides.id ?? "3EB0TEST0001",
      remoteJid: overrides.remoteJid ?? "34600111222@s.whatsapp.net",
      fromMe: overrides.fromMe ?? false,
    },
    messageTimestamp: overrides.timestamp ?? 1770000000,
    pushName: overrides.pushName,
    message: overrides.message === undefined ? { conversation: "hola" } : overrides.message,
  } as unknown as TestMessage;
}

describe("whatsapp message archive", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "wa-archive-test-"));
    dbPath = path.join(dir, "nested", "messages.db");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function rows(file: string = dbPath) {
    const db = new DatabaseSync(file);
    const out = db
      .prepare(
        "SELECT id, jid, contact_name, from_me, timestamp, text, media_type, raw_json FROM messages ORDER BY id",
      )
      .all() as Array<Record<string, unknown>>;
    db.close();
    return out;
  }

  it("archives text and media-caption messages with the wa-fetch row shape", async () => {
    const archive = createWhatsAppMessageArchive({
      dbPath,
      accountId: "default",
      logger: silentLogger,
    });
    expect(archive).not.toBeNull();
    archive?.store([
      makeMessage({ id: "A1", pushName: "Marius", message: { conversation: "hola" } }),
      makeMessage({
        id: "A2",
        fromMe: true,
        message: { extendedTextMessage: { text: "respuesta" } },
      }),
      makeMessage({
        id: "A3",
        message: { imageMessage: { caption: "mira esto" } },
      }),
    ]);
    await archive?.close();

    const stored = rows();
    expect(stored.map((r) => r.id)).toEqual(["A1", "A2", "A3"]);
    expect(stored[0]).toMatchObject({
      jid: "34600111222@s.whatsapp.net",
      contact_name: "Marius",
      from_me: 0,
      timestamp: 1770000000,
      text: "hola",
      media_type: null,
    });
    expect(stored[1]).toMatchObject({ from_me: 1, text: "respuesta" });
    expect(stored[2]).toMatchObject({ text: "mira esto", media_type: "image" });
    expect(JSON.parse(String(stored[0].raw_json)).key.id).toBe("A1");
  });

  it("preserves canonical Baileys proto JSON across the worker boundary", async () => {
    const archive = createWhatsAppMessageArchive({
      dbPath,
      accountId: "default",
      logger: silentLogger,
    });
    const message = proto.WebMessageInfo.create({
      key: {
        id: "PROTO1",
        remoteJid: "34600111222@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: 1_770_000_000,
      messageSecret: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
      message: {
        imageMessage: {
          caption: "proto bytes",
          mediaKey: Buffer.from([0x00, 0x01, 0xfe, 0xff]),
          fileSha256: Buffer.from([0x10, 0x20, 0x30]),
        },
      },
    });
    const expectedRawJson = JSON.stringify(message);

    archive?.store([message as TestMessage]);
    await archive?.close();

    const [stored] = rows();
    expect(stored.raw_json).toBe(expectedRawJson);
    expect(JSON.parse(String(stored.raw_json))).toMatchObject({
      messageSecret: "3q2+7w==",
      message: {
        imageMessage: {
          mediaKey: "AAH+/w==",
          fileSha256: "ECAw",
        },
      },
    });
  });

  it("creates private archive files and drains outside the store callback", async () => {
    const archive = createWhatsAppMessageArchive({
      dbPath,
      accountId: "default",
      logger: silentLogger,
    });
    expect(archive).not.toBeNull();
    await expect(archive?.ready()).resolves.toBe(true);
    if (process.platform !== "win32") {
      expect(fs.statSync(path.dirname(dbPath)).mode & 0o777).toBe(0o700);
      expect(fs.statSync(dbPath).mode & 0o777).toBe(0o600);
    }

    archive?.store([makeMessage({ id: "ASYNC1" })]);
    expect(rows()).toEqual([]);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    if (process.platform !== "win32") {
      for (const pathname of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
        if (fs.existsSync(pathname)) {
          expect(fs.statSync(pathname).mode & 0o777).toBe(0o600);
        }
      }
    }
    await archive?.close();
    expect(rows().map((row) => row.id)).toEqual(["ASYNC1"]);
  });

  it("is idempotent on re-delivery (INSERT OR IGNORE keeps the first row)", async () => {
    const archive = createWhatsAppMessageArchive({
      dbPath,
      accountId: "default",
      logger: silentLogger,
    });
    const msg = makeMessage({ id: "DUP1", message: { conversation: "first" } });
    archive?.store([msg]);
    // Reconnect replay delivers the same key again (possibly mutated upstream).
    archive?.store([makeMessage({ id: "DUP1", message: { conversation: "second" } })]);
    await archive?.close();

    const stored = rows();
    expect(stored).toHaveLength(1);
    expect(stored[0].text).toBe("first");
  });

  it("drops status/broadcast and key-less messages, keeps reactions and protocol raw", async () => {
    const archive = createWhatsAppMessageArchive({
      dbPath,
      accountId: "default",
      logger: silentLogger,
    });
    archive?.store([
      makeMessage({ id: "S1", remoteJid: "status@broadcast" }),
      { key: { id: undefined, remoteJid: undefined } } as unknown as TestMessage,
      makeMessage({
        id: "R1",
        message: { reactionMessage: { text: "👍", key: { id: "A1" } } },
      }),
      makeMessage({ id: "P1", message: { protocolMessage: { type: 0 } } }),
      makeMessage({ id: "G1", remoteJid: "120363000000000000@g.us" }),
    ]);
    await archive?.close();

    const ids = rows().map((r) => r.id);
    expect(ids).toEqual(["G1", "P1", "R1"]);
    const reaction = rows().find((r) => r.id === "R1");
    // Reactions carry no extractable text/media but survive verbatim in raw_json.
    expect(reaction?.text).toBeNull();
    expect(JSON.parse(String(reaction?.raw_json)).message.reactionMessage.text).toBe("👍");
  });

  it("stores a large replay batch in one call (single batched transaction)", async () => {
    const archive = createWhatsAppMessageArchive({
      dbPath,
      accountId: "default",
      logger: silentLogger,
    });
    const batch = Array.from({ length: 500 }, (_, i) =>
      makeMessage({ id: `BULK${String(i).padStart(4, "0")}`, message: { conversation: `m${i}` } }),
    );
    // A mid-batch skip (status row) must not break the surrounding transaction.
    batch.splice(250, 0, makeMessage({ id: "SKIP", remoteJid: "status@broadcast" }));
    archive?.store(batch);
    await archive?.close();

    const stored = rows();
    expect(stored).toHaveLength(500);
    expect(stored.some((r) => r.id === "SKIP")).toBe(false);
  });

  it("bounds the ordered queue and drops newest overflow messages", async () => {
    const warnings: Array<{ details: Record<string, unknown>; message: string }> = [];
    const archive = createWhatsAppMessageArchive({
      dbPath,
      accountId: "default",
      logger: {
        warn: (details, message) => warnings.push({ details, message }),
        error: () => {},
      },
    });
    const messages = Array.from({ length: 2_001 }, (_, index) =>
      makeMessage({ id: `QUEUE${String(index).padStart(4, "0")}` }),
    );

    archive?.store(messages.slice(0, 1_500));
    archive?.store(messages.slice(1_500));
    await archive?.close();

    const stored = rows();
    expect(stored).toHaveLength(2_000);
    expect(stored.some((row) => row.id === "QUEUE2000")).toBe(false);
    expect(warnings).toContainEqual({
      details: {
        accountId: "default",
        droppedMessages: 1,
        maxQueuedMessages: 2_000,
      },
      message: "whatsapp message archive queue full (newest messages dropped; dispatch unaffected)",
    });
  });

  it("drops a busy batch without per-row autocommit retries", async () => {
    const warnings: Array<{ details: Record<string, unknown>; message: string }> = [];
    const archive = createWhatsAppMessageArchive({
      dbPath,
      accountId: "default",
      logger: {
        warn: (details, message) => warnings.push({ details, message }),
        error: () => {},
      },
    });
    await expect(archive?.ready()).resolves.toBe(true);
    const blocker = new DatabaseSync(dbPath);
    blocker.exec("BEGIN IMMEDIATE");

    archive?.store([makeMessage({ id: "BUSY1" }), makeMessage({ id: "BUSY2" })]);
    let closeSettled = false;
    const closePromise = archive?.close().then(() => {
      closeSettled = true;
    });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(closeSettled).toBe(false);
    await closePromise;
    blocker.exec("ROLLBACK");
    blocker.close();

    expect(rows()).toEqual([]);
    expect(warnings).toContainEqual({
      details: expect.objectContaining({ accountId: "default", droppedMessages: 2 }),
      message: "whatsapp message archive busy (batch dropped; message dispatch unaffected)",
    });
  });

  it("never throws from store() after close and attaches to an existing archive", async () => {
    const first = createWhatsAppMessageArchive({
      dbPath,
      accountId: "default",
      logger: silentLogger,
    });
    first?.store([makeMessage({ id: "E1" })]);
    await first?.close();
    expect(() => first?.store([makeMessage({ id: "E2" })])).not.toThrow();
    await expect(first?.close()).resolves.toBeUndefined();

    // Second session attaches to the same file (IF NOT EXISTS schema) and appends.
    const second = createWhatsAppMessageArchive({
      dbPath,
      accountId: "default",
      logger: silentLogger,
    });
    second?.store([makeMessage({ id: "E3" })]);
    await second?.close();
    expect(rows().map((r) => r.id)).toEqual(["E1", "E3"]);
  });

  it("disables itself asynchronously (and does not throw) when the db path is unusable", async () => {
    const archive = createWhatsAppMessageArchive({
      dbPath: path.join(dir, "not-a-dir-file"),
      accountId: "default",
      logger: silentLogger,
    });
    expect(archive).not.toBeNull();
    await archive?.close();

    fs.writeFileSync(path.join(dir, "blocker"), "x");
    const errors: Array<{ details: Record<string, unknown>; message: string }> = [];
    const broken = createWhatsAppMessageArchive({
      dbPath: path.join(dir, "blocker", "messages.db"),
      accountId: "default",
      logger: {
        warn: () => {},
        error: (details, message) => errors.push({ details, message }),
      },
    });
    expect(broken).not.toBeNull();
    await expect(broken?.ready()).resolves.toBe(false);
    await expect(broken?.close()).resolves.toBeUndefined();
    expect(errors).toContainEqual({
      details: expect.objectContaining({ accountId: "default", dbPath: expect.any(String) }),
      message: "whatsapp message archive unavailable (archiving disabled for this session)",
    });
  });

  it("disables itself asynchronously for an incompatible existing schema", async () => {
    // IF NOT EXISTS leaves a pre-existing messages table untouched, so the
    // column mismatch surfaces at prepare time — which must degrade to null.
    const staleDb = path.join(dir, "stale.db");
    const db = new DatabaseSync(staleDb);
    db.exec("CREATE TABLE messages (id TEXT PRIMARY KEY, body TEXT)");
    db.close();

    const errors: Array<{ details: Record<string, unknown>; message: string }> = [];
    const archive = createWhatsAppMessageArchive({
      dbPath: staleDb,
      accountId: "default",
      logger: {
        warn: () => {},
        error: (details, message) => errors.push({ details, message }),
      },
    });
    expect(archive).not.toBeNull();
    await expect(archive?.ready()).resolves.toBe(false);
    await expect(archive?.close()).resolves.toBeUndefined();
    expect(errors).toContainEqual({
      details: expect.objectContaining({ accountId: "default", dbPath: staleDb }),
      message: "whatsapp message archive unavailable (archiving disabled for this session)",
    });
  });

  it("normalizes Long-shaped, string, and numeric timestamps to epoch seconds", () => {
    expect(toArchiveTimestampSeconds(1770000000)).toBe(1770000000);
    expect(toArchiveTimestampSeconds("1770000001")).toBe(1770000001);
    expect(toArchiveTimestampSeconds({ toNumber: () => 1770000002 })).toBe(1770000002);
    expect(toArchiveTimestampSeconds({ low: 1770000003, high: 0 })).toBe(1770000003);
    expect(toArchiveTimestampSeconds(undefined)).toBe(0);
    expect(toArchiveTimestampSeconds("not-a-number")).toBe(0);
  });

  it("extract helpers mirror the wa-fetch recipe", () => {
    expect(extractArchiveText(makeMessage({ message: { conversation: "a" } }))).toBe("a");
    expect(extractArchiveText(makeMessage({ message: { videoMessage: { caption: "v" } } }))).toBe(
      "v",
    );
    expect(extractArchiveText(makeMessage({ message: null }))).toBeNull();
    expect(extractArchiveMediaType(makeMessage({ message: { stickerMessage: {} } }))).toBe(
      "sticker",
    );
    expect(extractArchiveMediaType(makeMessage({ message: { documentMessage: {} } }))).toBe(
      "document",
    );
    expect(extractArchiveMediaType(makeMessage({ message: { conversation: "t" } }))).toBeNull();
  });
});
