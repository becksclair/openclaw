// Tracks detached TTS synthesis+send tasks so graceful shutdown can bound-wait them.
//
// TTS voice synthesis must not hold the dispatch turn's session lane: a slow
// provider would keep the session in `processing` and queue the next inbound
// message behind it (classified `blocked_tool_call`). The synth+send therefore
// runs after the reply operation clears its lane. This registry exists only so
// the gateway shutdown drain can wait (bounded) for in-flight audio before
// exiting — it is intentionally NOT consulted by next-turn admission, so a
// pending voice note never re-blocks the following reply.
import { resolveGlobalSingleton } from "../../shared/global-singleton.js";

type DetachedTtsTaskState = {
  inFlight: Set<Promise<void>>;
};

const DETACHED_TTS_TASK_STATE_KEY = Symbol.for("openclaw.detachedTtsTasks");

const state = resolveGlobalSingleton<DetachedTtsTaskState>(DETACHED_TTS_TASK_STATE_KEY, () => ({
  inFlight: new Set<Promise<void>>(),
}));

/**
 * Run `task` as a detached background job tracked for shutdown drain. The task
 * owns its own error handling and abort checks; this wrapper never rejects and
 * always releases its tracking slot when the task settles.
 */
export function registerDetachedTtsTask(task: () => Promise<void>): void {
  let settle: () => void = () => {};
  const tracked = new Promise<void>((resolve) => {
    settle = resolve;
  });
  state.inFlight.add(tracked);
  void (async () => {
    try {
      await task();
    } catch {
      // Detached: the task body owns its own logging. Swallow here so a rejected
      // background job can never become an unhandled rejection.
    } finally {
      state.inFlight.delete(tracked);
      settle();
    }
  })();
}

export function getDetachedTtsTaskCount(): number {
  return state.inFlight.size;
}

/**
 * Wait for all currently in-flight detached TTS tasks to settle, bounded by
 * `timeoutMs`. Returns true if they drained, false if the timeout elapsed first
 * (the caller then proceeds; process teardown cancels the stragglers).
 */
export async function waitForDetachedTtsTasks(timeoutMs: number): Promise<boolean> {
  if (state.inFlight.size === 0) {
    return true;
  }
  if (timeoutMs <= 0) {
    return false;
  }
  const drained = Promise.allSettled([...state.inFlight]).then(() => true);
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref?.();
  });
  const result = await Promise.race([drained, timedOut]);
  if (timer) {
    clearTimeout(timer);
  }
  return result;
}

export const __testing = {
  reset(): void {
    state.inFlight.clear();
  },
};
