/**
 * Host bridge for the `tts_prepare` plugin hook.
 *
 * speech-core is import-restricted and cannot reach the plugin hook dispatcher,
 * so it accepts a threaded `TtsPrepareHook` callback (Layer A) instead of calling
 * hooks directly. This file is the ONLY host code that touches the global hook
 * runner for `tts_prepare`: it maps the Layer-A callback shape to/from the
 * Layer-B plugin hook event/context and returns `undefined` (zero overhead) when
 * no plugin has registered the hook.
 */
import { getGlobalHookRunner } from "../plugins/hook-runner-global.js";
import type {
  PluginHookTtsPrepareContext,
  PluginHookTtsPrepareEvent,
} from "../plugins/hook-types.js";
import type { TtsPrepareHook } from "./tts.js";

/**
 * Build the injectable `tts_prepare` callback for a synthesis call site, or
 * `undefined` when no `tts_prepare` hook is registered so speech-core skips the
 * hook path entirely. The returned callback is defensively fail-open: any bridge
 * or dispatch error resolves to `undefined` (original text spoken).
 */
export function buildTtsPrepareHook(ctxInfo: {
  agentId?: string;
  channelId?: string;
  accountId?: string;
}): TtsPrepareHook | undefined {
  if (!getGlobalHookRunner()?.hasHooks("tts_prepare")) {
    return undefined;
  }
  return async (input) => {
    try {
      const runner = getGlobalHookRunner();
      if (!runner) {
        return undefined;
      }
      const event: PluginHookTtsPrepareEvent = {
        text: input.text,
        providerId: input.providerId,
        providerModelId: input.providerModel,
        personaId: input.personaId ?? input.persona?.id,
        persona: input.persona,
        attempt: input.attempt,
        agentId: ctxInfo.agentId,
      };
      const ctx: PluginHookTtsPrepareContext = {
        channelId: ctxInfo.channelId ?? "",
        accountId: ctxInfo.accountId,
      };
      const result = await runner.runTtsPrepare(event, ctx);
      if (!result) {
        return undefined;
      }
      return {
        text: result.text,
        providerOverrides: result.providerOverrides,
      };
    } catch {
      // Defensive fail-open: a hook bridge error must never fail synthesis.
      return undefined;
    }
  };
}
