import type { SessionTranscriptUpdate } from "./transcript-events.js";

export function resolveTranscriptUpdateMessageSeq(params: {
  update: SessionTranscriptUpdate;
  previousSeq?: number;
  readPersistedCount?: () => number | undefined;
}): number | undefined {
  if (typeof params.update.messageSeq === "number") {
    return params.update.messageSeq;
  }
  if (typeof params.previousSeq === "number") {
    return params.previousSeq + 1;
  }
  return params.readPersistedCount?.();
}
