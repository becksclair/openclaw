# Bex fork ledger

This file documents the fork-specific seams intentionally carried on top of upstream OpenClaw.

Goal: make rebases boring.

Use this file as the fork contract:

- before rebasing, read the seam list and touched files
- during replay, keep upstream structure where possible and re-carry only the behavior listed here
- after replay, verify the listed invariants instead of trusting merge conflict luck

## Rebase rules

- Do not silently drop any behavior in this file just because upstream changed nearby code.
- Prefer re-applying behavior through the narrowest local seam instead of re-scattering logic through unrelated upstream files.
- If upstream adds an equivalent feature, delete the fork seam and update this file.
- If upstream changes a touched file but not the behavior, refit the seam to upstream instead of forcing the old shape back in.

## Seam hygiene lessons

These are the working rules that kept this branch smaller during the voice-routing, Talk, and UI replay.

- Prefer behavior seams over tracing seams.
  - Keep behavior that changes the product.
  - Delete correlation ids, debug breadcrumbs, and intermediate payload metadata unless runtime correctness depends on them.
  - Temporary diagnostics should leave the branch once the failure class is understood.

- Keep seam ownership local to the subsystem that actually owns the behavior.
  - Agent-scoped `messages.tts` merging belongs in `src/tts/tts-config.ts`.
  - Talk-specific provider synthesis and repointing belongs in `src/gateway/talk-agent-config.ts`.
  - UI read-aloud agent selection belongs in `ui/src/ui/chat/read-aloud-agent.ts`, not generic render helpers.

- Prefer deletion over supporting a fork diff with more fork diff.
  - If a production-file change exists only to satisfy a stale test or example value, change the test or delete it.
  - If upstream already covers a channel path, do not keep a second fork path alive out of habit.

- Keep fork helpers narrowly named and obviously owned.
  - Good seams advertise what they own: `talk-agent-config`, `read-aloud-agent`, `talk-tts`.
  - Avoid hiding fork policy inside broad coordinators where unrelated upstream churn creates merge noise.

- Prefer contract tests over seam-internal bookkeeping tests.
  - Test that compatible voice output is delivered as voice where the fork still differs.
  - Test that Talk sees the effective agent-scoped provider and voice.
  - Test that UI read-aloud resolves the right agent and calls gateway Talk.

- Shrink the touched-file set after every working fix.
  - Once behavior is green, review the diff and remove files that no longer carry fork-specific value.
  - Do not keep formatting churn, stale tests, or dead imports in the fork.

## Seam inventory

### 1. Voice-routing seam

Status: implemented

Why this exists:

- The fork wants compatible synthesized voice output to stay on the native voice path where upstream still falls back too early.
- Upstream now covers the basic Discord native-voice route, so the fork only keeps the still-missing behavior.

Behavior carried by this fork:

- `extensions/speech-core/src/tts.ts` normalizes channel identity and infers voice compatibility from the synthesized artifact, not only provider metadata.
- Telegram outbound keeps `audioAsVoice` through the adapter.
- Shared outbound delivery routes `audioAsVoice` media payloads through `sendPayload` when that is the channel seam that can preserve voice semantics.
- Queued tool-media reply merging preserves `audioAsVoice` when a later assistant reply absorbs queued voice output.

Primary seam files:

- `extensions/speech-core/src/tts.ts`
- `extensions/telegram/src/outbound-adapter.ts`
- `src/infra/outbound/deliver.ts`
- `src/agents/pi-embedded-subscribe.handlers.messages.ts`

Primary seam tests:

- `extensions/speech-core/src/tts.test.ts`
- `extensions/telegram/src/outbound-adapter.test.ts`
- `extensions/telegram/src/voice.test.ts`
- `src/infra/outbound/deliver.test.ts`
- `src/agents/pi-embedded-subscribe.handlers.messages.test.ts`
- `extensions/discord/src/monitor/reply-delivery.test.ts`

Rebase notes:

- Treat upstream as authoritative for the basic Discord native-voice path.
- Do not re-carry custom Discord monitor/outbound/send logic unless tests prove a real regression.
- Do not revive `ttsArtifactId` or diagnostic breadcrumb plumbing.

Required invariants after rebase:

- Telegram-compatible voice output still delivers as voice, even when provider metadata is pessimistic but the artifact is clearly compatible.
- Shared outbound delivery does not strip `audioAsVoice` by routing through the wrong sender.
- Queued voice tool media does not lose voice intent when merged into the next reply.
- Discord reply delivery still passes on upstream's native voice path without extra fork logic unless a regression proves otherwise.

### 2. Control UI Talk read-aloud seam

Status: implemented

Why this exists:

- The fork wants the Control UI read-aloud button to use gateway `talk.speak` output and browser audio playback instead of browser-native speech synthesis.
- This keeps voice output aligned with gateway/provider behavior.

Behavior carried by this fork:

- Chat read-aloud requests `talk.speak` from the gateway.
- Returned audio is played in the browser via `AudioContext` or `Audio` fallback.
- Read-aloud resolves the effective agent id through a chat-owned helper instead of generic render helpers.

Primary seam files:

- `ui/src/ui/chat/talk-tts.ts`
- `ui/src/ui/chat/read-aloud-agent.ts`
- `ui/src/ui/chat/grouped-render.ts`
- `ui/src/ui/views/chat.ts`
- `ui/src/ui/app-render.ts`

Primary seam tests:

- `ui/src/ui/views/chat.test.ts`

Rebase notes:

- Keep read-aloud policy in chat-owned files.
- Minimize prop threading through `ui/src/ui/app-render.ts` and `ui/src/ui/views/chat.ts`.
- Do not move agent-resolution policy back into broad helper files.

Required invariants after rebase:

- Chat read-aloud uses `talk.speak`, not browser speech synthesis.
- Assistant message groups still expose the read-aloud affordance when a gateway client is available.
- Read-aloud resolves the default/main session to the intended agent instead of blindly using the selected panel agent.

### 3. Agent-scoped Talk/TTS seam

Status: implemented

Why this exists:

- The fork wants individual agents to override global `messages.tts` settings without cloning the entire runtime config.
- Talk must see the effective agent-scoped provider and voice, including synthesized Talk config when the selected TTS provider differs from the global Talk provider.

Behavior carried by this fork:

- `agents.list[].tts` is a valid config surface.
- Agent-scoped `messages.tts` merging is centralized in `src/tts/tts-config.ts`.
- Talk-specific provider synthesis and repointing is centralized in `src/gateway/talk-agent-config.ts`.
- `talk.speak` and `talk.config` both accept `agentId` and resolve through the same seam.

Primary seam files:

- `src/config/types.agents.ts`
- `src/config/zod-schema.agent-runtime.ts`
- `src/agents/agent-scope.ts`
- `src/tts/tts-config.ts`
- `src/gateway/protocol/schema/channels.ts`
- `src/gateway/talk-agent-config.ts`
- `src/gateway/server-methods/talk.ts`

Primary seam tests:

- `src/tts/tts-config.test.ts`
- `src/gateway/talk-agent-config.test.ts`
- `src/gateway/server-methods/talk.test.ts`
- `src/gateway/server.talk-config.test.ts`

Rebase notes:

- Keep generic agent-level TTS merging out of Talk-specific helpers.
- Keep Talk-specific provider synthesis out of generic TTS helpers.
- If upstream adds native agent-scoped TTS or Talk seams, collapse back to upstream instead of carrying parallel local abstractions.

Required invariants after rebase:

- Agent-specific TTS overrides win over global defaults for that agent only.
- `talk.speak` and `talk.config` both see the effective agent-scoped provider and voice.
- Talk only points at a provider it can actually resolve, and it stays on a working provider if the selected one cannot materialize a valid Talk config.

## Replay checklist

When rebasing this fork onto a newer upstream base:

1. Start from a fresh branch off `upstream/main`.
2. Run `pnpm install` immediately after branching.
3. Replay only the active seams above.
4. Prefer upstream behavior wherever it now overlaps, especially in Discord voice delivery.
5. After replay, remove stale tests and redundant fork code before calling it done.

## Narrow validation set

Run these after replaying the live seams:

- `pnpm test extensions/speech-core/src/tts.test.ts`
- `pnpm test extensions/telegram/src/outbound-adapter.test.ts extensions/telegram/src/voice.test.ts`
- `pnpm test src/infra/outbound/deliver.test.ts`
- `pnpm test src/agents/pi-embedded-subscribe.handlers.messages.test.ts`
- `pnpm test extensions/discord/src/monitor/reply-delivery.test.ts`
- `pnpm test src/tts/tts-config.test.ts src/gateway/talk-agent-config.test.ts`
- `pnpm test src/gateway/server-methods/talk.test.ts src/gateway/server.talk-config.test.ts`
- `pnpm test ui/src/ui/views/chat.test.ts`
- `pnpm check`
