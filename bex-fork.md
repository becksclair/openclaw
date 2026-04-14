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

## Replay impact: 2026-04-14 onto upstream/main `56625a189b`

This replay was re-based onto upstream `main` at `56625a189b` on 2026-04-14.

Verdicts for the previous fork-only commits:

- `7c6c377fb0` — keep
  - Replay the voice-routing behavior only.
  - Upstream touched `extensions/speech-core/src/tts.ts` and `src/infra/outbound/deliver.ts`, so the fork behavior was ported onto upstream structure without reviving older Discord-specific fork logic.

- `3bc8c045a3` — keep
  - Replay the agent-scoped Talk/TTS seam fully.
  - Upstream still has no native `src/gateway/talk-agent-config.ts`, but `src/agents/agent-scope.ts` was refactored upstream; keep that upstream split and carry the fork's `tts` extension in `src/agents/agent-scope-config.ts`.

- `4838dcd86c` — keep
  - Replay the UI read-aloud seam fully.
  - Upstream still uses browser speech synthesis and does not provide `ui/src/ui/chat/talk-tts.ts` or `ui/src/ui/chat/read-aloud-agent.ts`.

- `2874c4766f` — keep
  - Fork ledger remains the replay contract.

- `bf5068a111` — keep
  - `CONTINUITY.md` remains ignored in `.gitignore`.

- `ddf51b11d9` — partial keep
  - The daemon install env-isolation fix is still required.
  - Proof: on the fresh replay branch, `pnpm test src/commands/daemon-install-helpers.test.ts` still leaked ambient env vars and failed until the tests passed isolated `HOME` / `OPENAI_API_KEY` input explicitly.
  - The global-skills half is still required, but in a reduced upstream-shaped form.
  - Proof:
    - `pnpm test src/agents/skills.agents-skills-directory.test.ts` passed initially on the fresh replay branch.
    - Later full-suite coverage reproduced the real leak class through workspace-skill prompt tests, which picked up personal `~/.agents/skills` state until `src/agents/skills/workspace.ts` was switched to the env-scoped OS-home seam and the regression test was restored.

- `90e5779609` — drop
  - The Firecrawl-specific secrets runtime test-support change did not re-prove itself.
  - Proof: the scoped secrets runtime suite passed on the fresh replay branch without carrying the old patch.

- `e9ecf5d7a4` — partial keep
  - Keep the plugin-boundary registration assertions for `opencode` and `opencode-go`.
  - Drop the compaction-harness patch.
  - Proof:
    - `pnpm test extensions/opencode/index.test.ts extensions/opencode-go/index.test.ts` passed after restoring the provider-boundary registration assertions.
    - `pnpm test src/agents/pi-embedded-runner/run.timeout-triggered-compaction.test.ts src/agents/pi-embedded-runner/run.overflow-compaction.test.ts` passed without the old compaction-harness change.

- `db25acf3fb` — regenerate only
  - Never replay generated baselines by cherry-pick.
  - Regenerate after carrying public config-surface changes.

- `d900ee4b20` / `dc0e30e262` — keep
  - Carry the Telegram inbound-audio auto-TTS patch and its regression coverage.
  - Proof:
    - Telegram inbound audio now sets an explicit `InboundAudio` flag in the finalized inbound context instead of relying on body-shape or media-type heuristics later in dispatch.
    - `dispatch-from-config` now treats that explicit flag as authoritative, so wrapped Telegram transcript bodies still trigger the correct auto-TTS lane.
    - Focused validation passed on the replay branch:
      - `pnpm test extensions/telegram/src/bot-message-context.audio-transcript.test.ts`
      - `pnpm test src/auto-reply/reply/dispatch-from-config.reply-dispatch.test.ts`
      - `pnpm test src/auto-reply/reply/dispatch-from-config.test.ts -t "preserves explicit inbound-audio detection for final TTS dispatch when body text is wrapped"`
      - `pnpm tsgo`

## Local workflow notes

These are local operating rules, not carried fork seams.

- `main` now points at the replayed line that was pushed to `origin/main` on 2026-04-14.
  - The old pre-repoint local-main history lives on `bex/local-main-pre-repoint-2026-04-14`; treat it as salvage, not the live continuation branch.

- `extensions/memory-maintenance/` is intentionally a nested git repo, not part of the outer repo's carried fork surface.
  - Keep it hidden from the outer repo via local `.git/info/exclude` with `/extensions/memory-maintenance/`.
  - Do not track that ignore in `.gitignore` or convert the directory into a submodule unless the outer repo intentionally decides to own that lifecycle.
  - Outer-repo stash, reset, rebase, and replay flows do not manage the nested repo's internal state.

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

### 4. Telegram inbound-audio auto-TTS seam

Status: implemented

Why this exists:

- Telegram voice/audio turns can be preflight-transcribed into wrapped body text before reply dispatch sees them.
- Auto-TTS dispatch should still know that the inbound turn was audio-originated even when later body text no longer looks like a raw audio placeholder.

Behavior carried by this fork:

- Telegram inbound context sets `InboundAudio` explicitly when current-turn media contains audio.
- The shared reply-dispatch path treats `InboundAudio` as authoritative before falling back to media-type or body-shape heuristics.
- Regression coverage proves the final TTS dispatch path keeps `inboundAudio: true` even when Telegram has already wrapped the transcript into envelope text.

Primary seam files:

- `extensions/telegram/src/bot-message-context.session.ts`
- `src/auto-reply/reply/dispatch-from-config.ts`
- `src/auto-reply/templating.ts`

Primary seam tests:

- `extensions/telegram/src/bot-message-context.audio-transcript.test.ts`
- `src/auto-reply/reply/dispatch-from-config.reply-dispatch.test.ts`
- `src/auto-reply/reply/dispatch-from-config.test.ts`

Rebase notes:

- Prefer the explicit inbound-audio bit over body-shape heuristics when both exist.
- Keep the flag local to real audio-origin turns; do not broaden it into a generic “body contains transcript” marker.
- If upstream adds an equivalent explicit context flag or equivalent dispatch contract, delete this seam and collapse to upstream behavior.

Required invariants after rebase:

- Telegram voice/audio turns keep `InboundAudio: true` in finalized context even when the transcript is already rendered into `Body` / `BodyForAgent`.
- Final auto-TTS dispatch still sees `inboundAudio: true` for those wrapped Telegram transcript turns.
- Non-audio text turns do not start opting into audio-origin behavior just because their body text resembles transcript formatting.

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
