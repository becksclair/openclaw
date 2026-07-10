// WhatsApp archive worker owns every blocking filesystem and SQLite operation.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";
import { proto, type WAMessage } from "baileys";
import type {
  WhatsAppArchiveWorkerCommand,
  WhatsAppArchiveWorkerData,
  WhatsAppArchiveWorkerDiagnostic,
  WhatsAppArchiveWorkerMessage,
} from "./src/inbound/message-archive.js";

const ARCHIVE_WORKER_RUNTIME_MARKER = "openclaw.whatsapp-message-archive-worker";

// Identical to the wa-fetch messages.db DDL (plus the contacts table other
// tooling expects). External readers bind to this exact shape.
const ARCHIVE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    jid TEXT NOT NULL,
    contact_name TEXT,
    from_me INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    text TEXT,
    media_type TEXT,
    raw_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_jid ON messages(jid);
  CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);
  CREATE TABLE IF NOT EXISTS contacts (
    jid TEXT PRIMARY KEY,
    name TEXT,
    phone TEXT,
    is_group INTEGER DEFAULT 0,
    updated_at INTEGER
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    id UNINDEXED,
    jid,
    contact_name,
    text,
    content='messages',
    content_rowid='rowid'
  );
  CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, id, jid, contact_name, text)
    VALUES (new.rowid, new.id, new.jid, new.contact_name, new.text);
  END;
  CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, id, jid, contact_name, text)
    VALUES ('delete', old.rowid, old.id, old.jid, old.contact_name, old.text);
  END;
  CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, id, jid, contact_name, text)
    VALUES ('delete', old.rowid, old.id, old.jid, old.contact_name, old.text);
    INSERT INTO messages_fts(rowid, id, jid, contact_name, text)
    VALUES (new.rowid, new.id, new.jid, new.contact_name, new.text);
  END;
`;

type ArchiveWorkerPort = {
  postMessage(message: WhatsAppArchiveWorkerMessage): void;
  onMessage(listener: (message: WhatsAppArchiveWorkerCommand) => void): void;
  close(): void;
};

export function extractArchiveText(msg: proto.IWebMessageInfo): string | null {
  const message = msg.message;
  if (!message) {
    return null;
  }
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    null
  );
}

export function extractArchiveMediaType(msg: proto.IWebMessageInfo): string | null {
  const message = msg.message;
  if (!message) {
    return null;
  }
  if (message.imageMessage) {
    return "image";
  }
  if (message.videoMessage) {
    return "video";
  }
  if (message.audioMessage) {
    return "audio";
  }
  if (message.documentMessage) {
    return "document";
  }
  if (message.stickerMessage) {
    return "sticker";
  }
  return null;
}

export function toArchiveTimestampSeconds(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }
  if (value && typeof value === "object") {
    const long = value as { toNumber?: () => number; low?: number; high?: number };
    if (typeof long.toNumber === "function") {
      try {
        const number = long.toNumber();
        return Number.isFinite(number) ? number : 0;
      } catch {
        // Fall through to the structured-clone-safe low/high representation.
      }
    }
    if (typeof long.low === "number" && typeof long.high === "number") {
      return long.high * 4294967296 + (long.low >>> 0);
    }
  }
  return 0;
}

function enforceArchiveFilePermissions(dbPath: string): void {
  if (process.platform === "win32") {
    return;
  }
  fs.chmodSync(path.dirname(dbPath), 0o700);
  for (const pathname of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      fs.chmodSync(pathname, 0o600);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message || err.name : String(err);
}

function diagnostic(
  port: ArchiveWorkerPort,
  message: Omit<WhatsAppArchiveWorkerDiagnostic, "type">,
): void {
  port.postMessage({ type: "diagnostic", ...message });
}

export function runWhatsAppArchiveWorkerRuntime(params: {
  options: WhatsAppArchiveWorkerData;
  port: ArchiveWorkerPort;
}): void {
  const { options, port } = params;
  let database: DatabaseSync | undefined;
  let insert: ReturnType<DatabaseSync["prepare"]>;
  let closed = false;

  const closeDatabase = () => {
    if (closed) {
      return;
    }
    closed = true;
    if (database) {
      try {
        enforceArchiveFilePermissions(options.dbPath);
      } catch (err) {
        diagnostic(port, {
          level: "warn",
          code: "permissions",
          error: formatError(err),
        });
      }
      try {
        database.close();
      } catch (err) {
        diagnostic(port, { level: "warn", code: "close", error: formatError(err) });
      }
    }
    port.postMessage({ type: "closed" });
    port.close();
  };

  try {
    fs.mkdirSync(path.dirname(options.dbPath), { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      fs.chmodSync(path.dirname(options.dbPath), 0o700);
    }
    database = new DatabaseSync(options.dbPath);
    database.exec("PRAGMA journal_mode=WAL");
    // This wait is intentionally worker-local. A contended archive must never
    // stall inbound dispatch on the Gateway thread.
    database.exec("PRAGMA busy_timeout=50");
    database.exec(ARCHIVE_SCHEMA);
    insert = database.prepare(
      `INSERT OR IGNORE INTO messages (id, jid, contact_name, from_me, timestamp, text, media_type, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    enforceArchiveFilePermissions(options.dbPath);
  } catch (err) {
    diagnostic(port, {
      level: "error",
      code: "unavailable",
      error: formatError(err),
    });
    closeDatabase();
    return;
  }

  const databaseHandle = database;
  const insertStatement = insert;
  port.postMessage({ type: "ready" });

  const persistBatch = (batchId: number, messages: Array<WAMessage>) => {
    try {
      databaseHandle.exec("BEGIN IMMEDIATE");
    } catch (err) {
      diagnostic(port, {
        level: "warn",
        code: "busy",
        error: formatError(err),
        droppedMessages: messages.length,
      });
      port.postMessage({ type: "batch-ack", batchId, messageCount: messages.length });
      return;
    }
    for (const clonedMessage of messages) {
      try {
        // Worker structured clone removes protobuf prototypes and normalizes
        // Buffer fields to Uint8Array. Rehydrate the canonical Baileys proto
        // so its toJSON keeps raw_json byte/Long/enum encoding unchanged.
        const message = proto.WebMessageInfo.fromObject(clonedMessage);
        insertStatement.run(
          String(message.key?.id),
          String(message.key?.remoteJid),
          message.pushName ?? null,
          message.key?.fromMe ? 1 : 0,
          toArchiveTimestampSeconds(message.messageTimestamp),
          extractArchiveText(message),
          extractArchiveMediaType(message),
          JSON.stringify(message),
        );
      } catch (err) {
        diagnostic(port, { level: "warn", code: "write", error: formatError(err) });
      }
    }
    try {
      databaseHandle.exec("COMMIT");
    } catch (err) {
      try {
        databaseHandle.exec("ROLLBACK");
      } catch (rollbackError) {
        diagnostic(port, {
          level: "warn",
          code: "rollback",
          error: formatError(rollbackError),
        });
      }
      diagnostic(port, { level: "warn", code: "commit", error: formatError(err) });
    }
    port.postMessage({ type: "batch-ack", batchId, messageCount: messages.length });
    try {
      enforceArchiveFilePermissions(options.dbPath);
    } catch (err) {
      diagnostic(port, { level: "warn", code: "permissions", error: formatError(err) });
      closeDatabase();
    }
  };

  port.onMessage((message) => {
    if (closed) {
      return;
    }
    if (message?.type === "batch") {
      persistBatch(message.batchId, message.messages);
      return;
    }
    if (message?.type === "close") {
      closeDatabase();
    }
  });
}

const workerPort = parentPort;
const runtimePort =
  workerPort === null
    ? null
    : ({
        postMessage(message) {
          Reflect.apply(
            Reflect.get(workerPort, "postMessage") as (value: unknown) => void,
            workerPort,
            [message],
          );
        },
        onMessage(listener) {
          workerPort.on("message", listener);
        },
        close() {
          workerPort.close();
        },
      } satisfies ArchiveWorkerPort);
const runtimeOptions =
  workerData &&
  typeof workerData === "object" &&
  "runtime" in workerData &&
  workerData.runtime === ARCHIVE_WORKER_RUNTIME_MARKER
    ? (workerData as WhatsAppArchiveWorkerData)
    : null;

if (runtimePort && runtimeOptions) {
  runWhatsAppArchiveWorkerRuntime({ options: runtimeOptions, port: runtimePort });
}
