// Whatsapp helper module implements inbound message archiving behavior.
//
// Config-gated (channels.whatsapp.archive, default off) raw-message archive tap.
// Writes every message delivered on the `messages.upsert` stream — both
// directions, before any access-control filtering or dispatch — to a local
// SQLite file sharing the wa-fetch `messages.db` schema (WAL, busy_timeout,
// INSERT OR IGNORE on the platform-assigned Baileys message id), so offline
// re-deliveries and reconnect replays stay idempotent. Receipts/status updates
// are dropped; everything else (including reactions and protocol messages) is
// kept verbatim in raw_json for downstream consumers.
//
// Archiving must never affect dispatch: all entry points swallow their own
// errors and log instead of throwing.
import { Worker } from "node:worker_threads";
import type { WAMessage } from "baileys";

export type WhatsAppArchiveConfig = {
  enabled?: boolean;
  dbPath?: string;
};

export type WhatsAppMessageArchive = {
  store: (messages: Array<WAMessage>) => void;
  ready: () => Promise<boolean>;
  close: () => Promise<void>;
};

type ArchiveLogger = {
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
};

const MAX_QUEUED_MESSAGES = 2_000;
const ARCHIVE_WORKER_RUNTIME_MARKER = "openclaw.whatsapp-message-archive-worker";

function postWorkerMessage(worker: Worker, message: WhatsAppArchiveWorkerCommand): void {
  Reflect.apply(Reflect.get(worker, "postMessage") as (value: unknown) => void, worker, [message]);
}

export type WhatsAppArchiveWorkerData = {
  runtime: typeof ARCHIVE_WORKER_RUNTIME_MARKER;
  dbPath: string;
  accountId: string;
};

export type WhatsAppArchiveWorkerCommand =
  | { type: "batch"; batchId: number; messages: Array<WAMessage> }
  | { type: "close" };

export type WhatsAppArchiveWorkerDiagnostic = {
  type: "diagnostic";
  level: "warn" | "error";
  code: "unavailable" | "busy" | "write" | "commit" | "rollback" | "permissions" | "close";
  error: string;
  droppedMessages?: number;
};

export type WhatsAppArchiveWorkerMessage =
  | { type: "ready" }
  | { type: "batch-ack"; batchId: number; messageCount: number }
  | { type: "closed" }
  | WhatsAppArchiveWorkerDiagnostic;

function shouldArchiveMessage(msg: WAMessage): boolean {
  const remoteJid = msg.key?.remoteJid;
  if (!msg.key?.id || !remoteJid) {
    return false;
  }
  // Status stories/broadcast noise stays out; everything else (reactions,
  // protocol, fromMe echoes) is archived for raw fidelity.
  if (remoteJid === "status@broadcast" || remoteJid.endsWith("@broadcast")) {
    return false;
  }
  return true;
}

export function createWhatsAppMessageArchive(params: {
  dbPath: string;
  accountId: string;
  logger: ArchiveLogger;
}): WhatsAppMessageArchive | null {
  let worker: Worker;
  try {
    const runtimeUrl = import.meta.url.endsWith(".ts")
      ? new URL("../../message-archive-worker.runtime.ts", import.meta.url)
      : new URL("./message-archive-worker.runtime.js", import.meta.url);
    worker = new Worker(runtimeUrl, {
      workerData: {
        runtime: ARCHIVE_WORKER_RUNTIME_MARKER,
        dbPath: params.dbPath,
        accountId: params.accountId,
      } satisfies WhatsAppArchiveWorkerData,
    });
  } catch (err) {
    params.logger.error(
      { error: String(err), dbPath: params.dbPath, accountId: params.accountId },
      "whatsapp message archive unavailable (archiving disabled for this session)",
    );
    return null;
  }
  let closed = false;
  let closeRequested = false;
  let unavailable = false;
  let acceptedButUnacked = 0;
  let nextBatchId = 0;
  let closePromise: Promise<void> | undefined;
  let resolveClose: (() => void) | undefined;
  let resolveReady: ((available: boolean) => void) | undefined;
  let readySettled = false;
  const readyPromise = new Promise<boolean>((resolve) => {
    resolveReady = resolve;
  });

  const finishReady = (available: boolean) => {
    if (readySettled) {
      return;
    }
    readySettled = true;
    resolveReady?.(available);
  };

  const finishClose = () => {
    if (closed) {
      return;
    }
    closed = true;
    resolveClose?.();
  };

  const logDiagnostic = (message: WhatsAppArchiveWorkerDiagnostic) => {
    const details = {
      error: message.error,
      accountId: params.accountId,
      ...(message.droppedMessages === undefined
        ? {}
        : { droppedMessages: message.droppedMessages }),
      ...(message.code === "unavailable" ? { dbPath: params.dbPath } : {}),
    };
    const text = {
      unavailable: "whatsapp message archive unavailable (archiving disabled for this session)",
      busy: "whatsapp message archive busy (batch dropped; message dispatch unaffected)",
      write: "whatsapp message archive write failed (message dispatch unaffected)",
      commit: "whatsapp message archive batch commit failed (message dispatch unaffected)",
      rollback: "whatsapp message archive rollback failed",
      permissions: "whatsapp message archive permission hardening failed (archiving disabled)",
      close: "whatsapp message archive close failed",
    }[message.code];
    if (message.level === "error") {
      params.logger.error(details, text);
    } else {
      params.logger.warn(details, text);
    }
    if (message.code === "unavailable" || message.code === "permissions") {
      unavailable = true;
    }
  };

  worker.on("message", (message: WhatsAppArchiveWorkerMessage) => {
    if (message.type === "batch-ack") {
      acceptedButUnacked = Math.max(0, acceptedButUnacked - message.messageCount);
      return;
    }
    if (message.type === "diagnostic") {
      logDiagnostic(message);
      return;
    }
    if (message.type === "ready") {
      finishReady(true);
      return;
    }
    if (message.type === "closed") {
      finishClose();
    }
  });
  worker.once("error", (err) => {
    if (!unavailable) {
      params.logger.error(
        { error: String(err), dbPath: params.dbPath, accountId: params.accountId },
        "whatsapp message archive unavailable (archiving disabled for this session)",
      );
      unavailable = true;
    }
    finishReady(false);
    finishClose();
  });
  worker.once("exit", (code) => {
    if (code !== 0 && !unavailable) {
      params.logger.error(
        {
          error: `worker exited with code ${code}`,
          dbPath: params.dbPath,
          accountId: params.accountId,
        },
        "whatsapp message archive unavailable (archiving disabled for this session)",
      );
      unavailable = true;
    }
    finishReady(false);
    finishClose();
  });

  const store = (messages: Array<WAMessage>) => {
    if (closed || closeRequested || unavailable) {
      return;
    }
    const eligibleMessages = messages.filter(shouldArchiveMessage);
    const available = MAX_QUEUED_MESSAGES - acceptedButUnacked;
    const acceptedMessages = eligibleMessages.slice(0, Math.max(0, available));
    const droppedMessages = eligibleMessages.length - acceptedMessages.length;
    if (acceptedMessages.length > 0) {
      const batchId = ++nextBatchId;
      acceptedButUnacked += acceptedMessages.length;
      try {
        postWorkerMessage(worker, {
          type: "batch",
          batchId,
          messages: acceptedMessages,
        });
      } catch (err) {
        acceptedButUnacked -= acceptedMessages.length;
        params.logger.warn(
          {
            error: String(err),
            accountId: params.accountId,
            droppedMessages: acceptedMessages.length,
          },
          "whatsapp message archive write failed (message dispatch unaffected)",
        );
      }
    }
    if (droppedMessages > 0) {
      params.logger.warn(
        { accountId: params.accountId, droppedMessages, maxQueuedMessages: MAX_QUEUED_MESSAGES },
        "whatsapp message archive queue full (newest messages dropped; dispatch unaffected)",
      );
    }
  };

  const close = () => {
    if (closed) {
      return Promise.resolve();
    }
    if (closePromise) {
      return closePromise;
    }
    closeRequested = true;
    closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    try {
      postWorkerMessage(worker, { type: "close" });
    } catch {
      finishClose();
    }
    return closePromise;
  };

  return { store, ready: () => readyPromise, close };
}
