import type { RealtimeSessionBootstrap } from "./types.js";

const DEFAULT_REALTIME_HISTORY_MESSAGES = 6;
const DEFAULT_REALTIME_HISTORY_TOTAL_CHARS = 8_000;
const DEFAULT_REALTIME_HISTORY_ITEM_CHARS = 2_000;

export type RealtimeHistoryItem = NonNullable<RealtimeSessionBootstrap["history"]>[number];

export function trimRealtimeHistoryItems(items: RealtimeHistoryItem[]): RealtimeHistoryItem[] {
  const trimmed = items
    .map((item) => ({
      role: item.role,
      text: item.text.slice(0, DEFAULT_REALTIME_HISTORY_ITEM_CHARS).trim(),
    }))
    .filter((item) => item.text.length > 0);
  if (trimmed.length <= DEFAULT_REALTIME_HISTORY_MESSAGES) {
    let totalChars = trimmed.reduce((sum, item) => sum + item.text.length, 0);
    while (totalChars > DEFAULT_REALTIME_HISTORY_TOTAL_CHARS && trimmed.length > 1) {
      const removed = trimmed.shift();
      totalChars -= removed?.text.length ?? 0;
    }
    return trimmed;
  }
  const capped = trimmed.slice(-DEFAULT_REALTIME_HISTORY_MESSAGES);
  let totalChars = capped.reduce((sum, item) => sum + item.text.length, 0);
  while (totalChars > DEFAULT_REALTIME_HISTORY_TOTAL_CHARS && capped.length > 1) {
    const removed = capped.shift();
    totalChars -= removed?.text.length ?? 0;
  }
  return capped;
}

export function mergeRealtimeHistoryItems(
  base: RealtimeHistoryItem[] | undefined,
  overlay: RealtimeHistoryItem[] | undefined,
): RealtimeHistoryItem[] {
  return trimRealtimeHistoryItems([...(base ?? []), ...(overlay ?? [])]);
}
