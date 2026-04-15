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

## Replay impact snapshot: 2026-04-15 onto upstream/main `d7cc6f7643`

This section is historical replay provenance from the 2026-04-15 replay pass.
Use the active seam inventory below as the current carry contract; do not assume the old replay worktree names or upstream tip here are still current.

Verdicts for the previous fork-only commits:

- `7c6c377fb0` — keep
  - Replay the voice-routing behavior only.
  - Voice-routing focused validation passed on the fresh replay branch:
    - `pnpm test extensions/speech-core/src/tts.test.ts`
    - `pnpm test extensions/telegram/src/outbound-adapter.test.ts extensions/telegram/src/voice.test.ts`
    - `pnpm test src/infra/outbound/deliver.test.ts`
    - `pnpm test src/agents/pi-embedded-subscribe.handlers.messages.test.ts`
    - `pnpm test extensions/discord/src/monitor/reply-delivery.test.ts`

- `3bc8c045a3` — keep
  - Replay the agent-scoped Talk/TTS seam, including the widened internal agent-aware TTS lanes.
  - Keep upstream's split around agent scope helpers, but carry the fork-owned TTS behavior through `src/tts/tts-config.ts`, `src/gateway/talk-agent-config.ts`, and the agent-aware reply/tool/Discord voice paths that already know which agent is speaking.
  - Focused validation passed on the fresh replay branch:
    - `pnpm test src/tts/tts-config.test.ts src/gateway/talk-agent-config.test.ts`
    - `pnpm test src/gateway/server-methods/talk.test.ts src/gateway/server.talk-config.test.ts`
    - `pnpm test src/agents/openclaw-tools.tts-scope.test.ts`
    - `pnpm test src/auto-reply/reply/commands-tts.test.ts`
    - `pnpm test src/auto-reply/reply/dispatch-acp.test.ts`
    - `pnpm test src/auto-reply/reply/dispatch-from-config.test.ts src/auto-reply/reply/dispatch-from-config.reply-dispatch.test.ts`

- `4838dcd86c` — keep
  - Replay the UI read-aloud seam fully.
  - Upstream still uses browser speech synthesis and does not provide `ui/src/ui/chat/talk-tts.ts` or `ui/src/ui/chat/read-aloud-agent.ts`.
  - Focused validation passed on the fresh replay branch:
    - `pnpm test ui/src/ui/views/chat.test.ts`

- `2874c4766f` — keep
  - Fork ledger remains the replay contract.

- `bf5068a111` — drop
  - `CONTINUITY.md` ignore hygiene was not carried in this replay pass because the user asked to carry only the active seams from this ledger.

- `ddf51b11d9` — partial keep
  - The daemon install env-isolation fix is still required.
  - Proof: on a clean fresh worktree from `upstream/main`, `pnpm test src/commands/daemon-install-helpers.test.ts` failed until the tests passed isolated `HOME` / `OPENAI_API_KEY` input explicitly.
  - The global-skills half is still required, but in a reduced upstream-shaped form.
  - Proof:
    - `pnpm test src/agents/skills.agents-skills-directory.test.ts` passed on clean upstream.
    - `pnpm test src/agents/skills.build-workspace-skills-prompt.prefers-workspace-skills-managed-skills.test.ts src/agents/skills.build-workspace-skills-prompt.syncs-merged-skills-into-target-workspace.test.ts` failed on clean upstream until `src/agents/skills/workspace.ts` was switched back to the env-scoped OS-home seam.

- `90e5779609` — drop
  - The Firecrawl-specific secrets runtime test-support change did not re-prove itself.
  - Proof: it was not needed to make the fresh replay branch green.

- `e9ecf5d7a4` — drop
  - The provider-boundary and compaction support patch did not re-prove on the new base.
  - Proof:
    - `pnpm test extensions/opencode/index.test.ts extensions/opencode-go/index.test.ts` passed on clean upstream.
    - `pnpm test src/agents/pi-embedded-runner/run.timeout-triggered-compaction.test.ts src/agents/pi-embedded-runner/run.overflow-compaction.test.ts` passed on clean upstream.

- `db25acf3fb` — regenerate only
  - Never replay generated baselines by cherry-pick.
  - Regenerate after carrying public config-surface or Plugin SDK surface changes.
  - In this replay pass, `docs/.generated/plugin-sdk-api-baseline.sha256` was regenerated because `src/plugin-sdk/agent-runtime.ts` intentionally widened the public runtime surface.

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

- 2026-04-15 pnpm runner tooling support patch — keep for now
  - `scripts/pnpm-runner.mjs` must distinguish JS pnpm shims from native `@pnpm/exe` binaries and Windows `pnpm.cmd` shims.
  - Proof: in this source checkout, `pnpm build` failed at `[build-all] canvas:a2ui:bundle` because Node tried to execute the native pnpm binary as JavaScript (`SyntaxError: Invalid or unexpected token`) until the runner stopped routing native pnpm executables through `node`.
  - Focused validation passed in the source checkout:
    - `pnpm test test/scripts/pnpm-runner.test.ts`
    - `pnpm build`
  - Treat this as a replay-sensitive tooling carry, not a product seam; re-check it on the next upstream replay and drop it if upstream or the local pnpm/runtime path no longer needs it.

- 2026-04-15 Discord ACP thread-binding conversation-id normalization seam — keep until upstream lands an equivalent fix
  - Discord ACP thread-bound spawns can fail with `Session binding adapter failed to bind target conversation` because the plugin-resolved inbound conversation id may arrive as OpenClaw's internal `channel:<id>` form.
  - The ACP thread-binding path passes that value into session binding as if it were a raw Discord channel id, which breaks the later Discord REST lookup/create-thread path.
  - The fork carries a narrow Discord-only normalization in `src/agents/acp-spawn.ts`, stripping the `channel:` prefix from plugin-resolved conversation ids before preparing ACP thread bindings.
  - Source context:
    - upstream issue: `openclaw/openclaw#63686`
    - upstream PR: `openclaw/openclaw#63574`
  - Treat this as a temporary replay seam. If upstream lands an equivalent fix, delete the local normalization and remove this entry.

- 2026-04-15 Discord auto-TTS native voice-note regression seam — keep until upstream preserves voice intent end-to-end
  - Plain-text auto-TTS on Discord regressed so routed replies could arrive as plain opus attachments instead of native voice-message bubbles, and direct voice sends could fail when the synthesized audio artifact was only reachable through trusted local-media access.
  - The fork carries a narrow Discord-only fix across three adjacent seams:
    - Routed outbound and direct voice-send materialization:
      - `extensions/discord/src/outbound-adapter.ts` must preserve `audioAsVoice` in the routed outbound adapter and send the first audio artifact through `sendVoiceMessageDiscord(...)` before any follow-up text/media.
      - `extensions/discord/src/send.outbound.ts` must materialize voice-message input through outbound media-load options so trusted local roots and host read capability apply to local synthesized artifacts.
      - Discord voice-send callers that already accept trusted media options must forward them into `sendVoiceMessageDiscord(...)`, including `extensions/discord/src/monitor/reply-delivery.ts` and `extensions/discord/src/actions/runtime.messaging.ts`.
    - Native slash-command and interaction reply delivery:
      - `extensions/discord/src/monitor/native-command.ts` must preserve `audioAsVoice`, route the first voice-compatible artifact through `sendVoiceMessageDiscord(...)` before any follow-up interaction text, forward agent-scoped `mediaLocalRoots` for both direct plugin replies and dispatcher replies, pass the effective routed account into direct plugin command execution and native model-picker replies, resolve text chunking / max-lines policy from the effective routed account, and close voice-only interaction cleanup through the same reply-vs-follow-up semantics as the normal interaction send path.
    - Native interaction UI rerouting:
      - `extensions/discord/src/monitor/native-command-ui.ts` must resolve the effective routed account before direct model-picker helper recents reads, model-picker component redispatch, recents-scope reads/writes, and command-arg redispatch, so button/select follow-ups stay aligned with the same routed account/session as the originating slash command.
  - Proof on the source checkout:
    - `pnpm test extensions/discord/src/monitor/native-command.plugin-dispatch.test.ts extensions/discord/src/monitor/native-command.model-picker.test.ts extensions/discord/src/monitor/native-command.status-direct.test.ts extensions/discord/src/actions/runtime.test.ts extensions/discord/src/outbound-adapter.test.ts extensions/discord/src/monitor/reply-delivery.test.ts extensions/discord/src/send.sends-basic-channel-messages.test.ts`
      - includes direct helper-level proof that voice-only native interaction cleanup uses follow-up semantics when required, not just dispatcher-path inference
      - includes native interaction UI proof that the direct model-picker helper, model-picker component follow-ups, and command-arg component follow-ups all stay on the effective routed account
    - `pnpm build`
    - live Discord smoke after restarting `openclaw-gateway.service`: a plain text prompt produced both the expected text reply and a native Discord voice message with flag `8192` plus waveform/duration attachment metadata, not a plain opus file attachment.
    - live Discord slash-command smoke after rebuilding and restarting `openclaw-gateway.service`: in the Sky DM, `/think high` on the stale pre-restart gateway still produced the bad `.opus` attachment, while the fresh `/think low` run on the rebuilt gateway produced the ephemeral text acknowledgment plus a separate native voice-bubble style message with only playback controls (`Play`, playback speed, volume) and no attachment filename/download affordance.
  - Treat this as a replay-sensitive behavior seam. If upstream starts preserving `audioAsVoice` and voice-send media access through the Discord outbound/send/reply chain, delete the local carry and remove this entry.

## Local workflow notes

These are local operating rules, not carried fork seams.

- Repo-root `bex-fork.md` is the active carry ledger for this checkout.
- Treat any replay worktree names in the historical snapshot above as provenance, not current workspace truth. Use `CONTINUITY.md` plus the live checkout state to identify the active replay branch or worktree for the current pass.
- Keep this file focused on active seams and replay invariants; when a seam changes, update the relevant inventory, invariants, and narrow validation entries together so the document stays readable instead of accreting one-off bullets.

- Nested repo handling:
  - `extensions/memory-maintenance/` remains outside the carried fork surface.
  - Keep that nested repo managed from the source checkout's local exclude rules; do not fold it into the replay diff.

## Seam inventory

### 1. Voice-routing seam

Status: implemented

Why this exists:

- The fork wants compatible synthesized voice output to stay on the native voice path where upstream still falls back too early.
- Upstream covers parts of the Discord native-voice route, but the current tree still needs narrow Discord carry to preserve `audioAsVoice` through routed outbound delivery and trusted local-media voice sends.

Behavior carried by this fork:

- `extensions/speech-core/src/tts.ts` normalizes channel identity and infers voice compatibility from the synthesized artifact, not only provider metadata.
- Discord routed outbound preserves `audioAsVoice` in `extensions/discord/src/outbound-adapter.ts` so voice-compatible TTS replies become native voice messages instead of plain audio attachments.
- Discord voice sends materialize source audio through outbound media-load options, and voice-send callers that already have trusted media access forward it into that path.
- Discord native slash-command and interaction replies in `extensions/discord/src/monitor/native-command.ts` preserve `audioAsVoice` by sending the first voice-compatible artifact through the native voice-message path before any interaction follow-up text, forwarding agent-scoped media roots, passing the effective routed account into direct plugin command execution, resolving text chunking from the effective routed account, and closing voice-only interaction cleanup with the same follow-up semantics used by the main interaction send path.
- Discord native interaction UI follow-ups in `extensions/discord/src/monitor/native-command-ui.ts` keep model-picker helper reads, model-picker component redispatch, recents-scope reads and writes, and command-arg redispatch on the effective routed account.
- Telegram outbound keeps `audioAsVoice` through the adapter.
- Shared outbound delivery routes `audioAsVoice` media payloads through `sendPayload` when that is the channel seam that can preserve voice semantics.
- Queued tool-media reply merging preserves `audioAsVoice` when a later assistant reply absorbs queued voice output.

Primary seam files:

- `extensions/speech-core/src/tts.ts`
- `extensions/discord/src/outbound-adapter.ts`
- `extensions/discord/src/send.outbound.ts`
- `extensions/discord/src/monitor/reply-delivery.ts`
- `extensions/discord/src/actions/runtime.messaging.ts`
- `extensions/discord/src/monitor/native-command.ts`
- `extensions/discord/src/monitor/native-command-ui.ts`
- `extensions/telegram/src/outbound-adapter.ts`
- `src/infra/outbound/deliver.ts`
- `src/agents/pi-embedded-subscribe.handlers.messages.ts`

Primary seam tests:

- `extensions/speech-core/src/tts.test.ts`
- `extensions/discord/src/outbound-adapter.test.ts`
- `extensions/discord/src/send.sends-basic-channel-messages.test.ts`
- `extensions/discord/src/monitor/reply-delivery.test.ts`
- `extensions/discord/src/actions/runtime.test.ts`
- `extensions/discord/src/monitor/native-command.plugin-dispatch.test.ts`
- `extensions/discord/src/monitor/native-command.model-picker.test.ts`
- `extensions/discord/src/monitor/native-command.status-direct.test.ts`
- `extensions/telegram/src/outbound-adapter.test.ts`
- `extensions/telegram/src/voice.test.ts`
- `src/infra/outbound/deliver.test.ts`
- `src/agents/pi-embedded-subscribe.handlers.messages.test.ts`

Rebase notes:

- Treat upstream as authoritative for the base Discord voice-message protocol.
- Re-check Discord's routed outbound adapter plus direct voice-send media access on every replay; until upstream preserves both, keep the narrow Discord carry instead of assuming the upstream path is still complete.
- Do not revive `ttsArtifactId` or diagnostic breadcrumb plumbing.

Required invariants after rebase:

- Discord routed outbound does not strip `audioAsVoice` into a plain attachment send when the reply should become a native voice bubble.
- Discord voice sends can read trusted local synthesized artifacts through outbound media-access plumbing.
- Discord voice-send callers that already receive trusted media options pass them through instead of silently dropping them on the floor.
- Discord native slash-command and interaction replies do not fall back to `interaction.reply` or `interaction.followUp` file attachments when the reply should become a native voice bubble.
- Live slash-command proof should still show the interaction lane as an ephemeral text acknowledgment plus a separate voice-bubble style message, not a `voice-*.opus` attachment row with download controls.
- Discord direct plugin slash replies still forward agent-scoped local-media roots into the native voice path.
- Discord direct plugin slash replies execute under the effective routed account, not the incoming command account.
- Discord native model-picker replies resolve through the effective routed account, not the incoming command account.
- Discord native model-picker component follow-ups and command-arg component follow-ups also redispatch through the effective routed account, not the provider account they were instantiated under.
- Discord direct model-picker helper recents reads also use the effective routed account, not the caller account that happened to open the picker.
- Discord native slash-command text chunking and max-lines limits follow the effective routed account, not the incoming command account.
- Discord voice-only native interaction cleanup does not get left hanging after the voice message is sent, and does not call `interaction.reply(...)` when the flow already requires follow-up semantics.
- The helper-level native interaction delivery test still proves the voice-only cleanup branch directly, not only through slash-command dispatcher integration.
- Telegram-compatible voice output still delivers as voice, even when provider metadata is pessimistic but the artifact is clearly compatible.
- Shared outbound delivery does not strip `audioAsVoice` by routing through the wrong sender.
- Queued voice tool media does not lose voice intent when merged into the next reply.
- Discord reply delivery still passes the native voice path end-to-end, including routed outbound replies and direct monitor replies, unless upstream re-proves an equivalent fix.

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
- Internal agent-aware TTS paths scope `messages.tts` through that same merge seam before they inspect mode, prefs, provider config, or synthesize audio.
  - This includes generic reply dispatch, ACP reply dispatch, `/tts` commands, the shipped TTS agent tool, and Discord voice-manager synthesis when those lanes already know which agent is speaking.
  - Standalone gateway `tts.*` RPCs and direct CLI/local conversion remain intentionally global in this pass.

Primary seam files:

- `src/config/types.agents.ts`
- `src/config/zod-schema.agent-runtime.ts`
- `src/agents/agent-scope.ts`
- `src/agents/openclaw-tools.ts`
- `src/tts/tts-config.ts`
- `src/auto-reply/reply/commands-tts.ts`
- `src/auto-reply/reply/dispatch-acp.ts`
- `src/auto-reply/reply/dispatch-from-config.ts`
- `src/gateway/protocol/schema/channels.ts`
- `src/gateway/talk-agent-config.ts`
- `src/gateway/server-methods/talk.ts`
- `extensions/discord/src/voice/manager.ts`

Primary seam tests:

- `src/agents/openclaw-tools.tts-scope.test.ts`
- `src/auto-reply/reply/commands-tts.test.ts`
- `src/auto-reply/reply/dispatch-acp.test.ts`
- `src/auto-reply/reply/dispatch-from-config.test.ts`
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
- Internal agent-aware TTS lanes use the effective agent-scoped `messages.tts` config before mode, status, prefs, and provider decisions, not only at the final synth call.
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
- When the session is agent-bound, that same final auto-TTS path also keeps the effective agent-scoped voice/provider instead of silently falling back to global `messages.tts`.

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
- Telegram inbound auto-TTS preserves both audio-origin detection and the effective agent-scoped TTS voice/provider on agent-bound sessions.
- Non-audio text turns do not start opting into audio-origin behavior just because their body text resembles transcript formatting.

### 5. Discord inbound untrusted-body opt-in seam

Status: implemented

Why this exists:

- Upstream/local Discord guild inbound handling was duplicating the live message body into `UntrustedContext` for every guild message.
- This fork wants guild traffic treated as trusted by default and only specific Discord channels to opt into that wrapped external-body copy when the room really is untrusted.
- Channel topic metadata stays separate from this policy; it remains its own context seam instead of being coupled to message-body duplication.

Behavior carried by this fork:

- `channels.discord.guilds.<guild>.channels.<channel>.copyMessageBodyToUntrustedContext` is a valid Discord config surface.
- Guild messages do not copy their live body into `UntrustedContext` by default.
- Discord channel topic metadata still contributes its separate untrusted context block by default.
- Channels explicitly marked with `copyMessageBodyToUntrustedContext: true` add the wrapped live message body back into `UntrustedContext`.
- Discord threads inherit the effective setting from their parent channel through the existing Discord channel/thread resolution seam.

Primary seam files:

- `extensions/discord/src/monitor/inbound-context.ts`
- `extensions/discord/src/monitor/allow-list.ts`
- `src/config/types.discord.ts`
- `src/config/zod-schema.providers-core.ts`
- `extensions/discord/src/config-ui-hints.ts`
- `src/config/bundled-channel-config-metadata.generated.ts`

Primary seam tests:

- `extensions/discord/src/monitor/inbound-context.test.ts`
- `extensions/discord/src/monitor/message-handler.inbound-context.test.ts`
- `extensions/discord/src/monitor.test.ts`
- `src/config/config.discord.test.ts`

Rebase notes:

- Keep this seam Discord-local; do not widen it into a generic trusted-room abstraction.
- Keep channel-topic metadata behavior separate from the message-body opt-in.
- If upstream adds an equivalent channel-scoped control, delete this seam and collapse back to upstream behavior.

Required invariants after rebase:

- Default Discord guild inbound context does not duplicate the live message body into `UntrustedContext`.
- Discord channel topic metadata still contributes its separate untrusted context block.
- Channels with `copyMessageBodyToUntrustedContext: true` do duplicate the wrapped live message body into `UntrustedContext`.
- Discord thread contexts inherit the effective opt-in from the parent channel.
- Generated config metadata and config docs still expose `copyMessageBodyToUntrustedContext`.

## Replay checklist

When rebasing this fork onto a newer upstream base:

1. Start from a fresh branch off `upstream/main`.
2. Run `pnpm install` immediately after branching.
3. Replay only the active seams above.
4. Prefer upstream behavior wherever it now overlaps, but explicitly re-prove Discord voice delivery on the routed outbound lane, the direct reply lane, and the native slash-command/interaction lane before dropping any Discord voice-note carry.
5. After replay, remove stale tests and redundant fork code before calling it done.

## Narrow validation set

Run these after replaying the live seams:

- `pnpm test extensions/speech-core/src/tts.test.ts`
- `pnpm test extensions/discord/src/monitor/native-command.plugin-dispatch.test.ts extensions/discord/src/monitor/native-command.model-picker.test.ts extensions/discord/src/monitor/native-command.status-direct.test.ts extensions/discord/src/actions/runtime.test.ts extensions/discord/src/outbound-adapter.test.ts extensions/discord/src/monitor/reply-delivery.test.ts extensions/discord/src/send.sends-basic-channel-messages.test.ts`
- `pnpm test extensions/telegram/src/outbound-adapter.test.ts extensions/telegram/src/voice.test.ts`
- `pnpm test src/infra/outbound/deliver.test.ts`
- `pnpm test src/agents/pi-embedded-subscribe.handlers.messages.test.ts`
- `pnpm test src/tts/tts-config.test.ts src/gateway/talk-agent-config.test.ts`
- `pnpm test src/auto-reply/reply/dispatch-from-config.test.ts src/auto-reply/reply/dispatch-from-config.reply-dispatch.test.ts`
- `pnpm test src/auto-reply/reply/dispatch-acp.test.ts`
- `pnpm test src/auto-reply/reply/commands-tts.test.ts`
- `pnpm test src/agents/openclaw-tools.tts-scope.test.ts`
- `pnpm test src/gateway/server-methods/talk.test.ts src/gateway/server.talk-config.test.ts`
- `pnpm test ui/src/ui/views/chat.test.ts`
- `pnpm build`
- `pnpm check`
