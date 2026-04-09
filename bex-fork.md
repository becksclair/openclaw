# Bex fork ledger

This file documents fork-specific seams and behaviors that are intentionally carried on top of upstream OpenClaw.

Goal: make rebases boring.

Use this file as the fork contract:

- before rebasing, read the seam list and touched files
- during rebase, check upstream changes against every seam below
- after rebase, re-verify the listed invariants instead of trusting merge conflict luck

## Rebase rules

- Do not silently drop any behavior in this file just because upstream changed nearby code.
- Prefer re-applying the behavior through the narrowest local seam instead of re-scattering logic through unrelated upstream files.
- If upstream adds an equivalent feature, replace the fork seam with the upstream implementation and update this file.
- If upstream changes a touched file but not the behavior, refactor the fork seam to fit upstream instead of forcing the old shape back in.

## Fork policy

This fork prefers named internal seams over inline fork logic.

Use these rules when changing forked areas:

- Treat `bex-fork.md` as required onboarding on this branch. Read it before touching fork-covered files.
- Prefer the smallest seam that makes the fork behavior work with upstream code.
- Reuse upstream types, functions, and control flow when they are good enough; do not invent new internal types or abstractions just to make the fork look prettier.
- Keep fork-specific policy in narrowly named seam files, not sprinkled through upstream coordinators.
- Prefer seam contract tests over asserting private coordinator state from end-to-end tests.
- If upstream gains a real extension point or equivalent behavior, delete the fork seam and collapse back to upstream instead of carrying vanity diffs.
- When in doubt, optimize for the next rebase and the working feature, not the cleverest local abstraction.

## Seam inventory

### 0. Branch inventory

Current carried seams:

- Discord native voice-bubble auto-TTS
- Control UI read-aloud via gateway Talk TTS
- agent-scoped TTS overrides

### 1. Discord native voice-bubble auto-TTS seam

Status: implemented

Why this exists:

- The fork wants Discord auto-TTS audio replies to land as native Discord voice bubbles when the synthesized output is already compatible.
- Upstream behavior does not necessarily preserve that channel-specific delivery preference.

Behavior added by this fork:

- Discord is treated as a channel that can consume Opus-compatible native voice payloads.
- Contract coverage asserts that Discord auto-TTS replies route through the native voice-message path instead of text-plus-attachment fallback when appropriate.

Primary seam files:

- `extensions/speech-core/src/tts.ts`
- `extensions/discord/src/monitor/reply-delivery.ts`

Files touched by this seam:

- `extensions/speech-core/src/tts.ts`
  - Adds Discord to the set of channels eligible for Opus/native voice delivery.
- `extensions/discord/src/monitor/reply-delivery.ts`
  - Preserves native voice-bubble routing when Discord reply delivery sees compatible synthesized audio and delegates shared voice follow-up sequencing through the send seam.
- `extensions/discord/src/monitor/reply-delivery.test.ts`
  - Verifies Discord reply delivery uses the voice-bubble path for compatible auto-TTS payloads.
- `extensions/discord/src/outbound-adapter.ts`
  - Keeps outbound Discord media delivery aligned with the native voice route while delegating shared follow-up sequencing to the send seam.
- `extensions/discord/src/send.outbound.ts`
  - Owns the native voice send path and the shared helper that sequences follow-up text and media after Discord voice-bubble delivery.
- `extensions/discord/src/send.ts`
  - Re-exports the shared Discord voice-delivery helper for callers that stay on the package seam.
- `extensions/discord/src/send.voice-route.test.ts`
  - Regression coverage for route selection.

Rebase notes:

- If upstream adds a dedicated per-channel voice-delivery capability contract, migrate this seam there instead of carrying a hard-coded channel list forever.
- If upstream already supports Discord native voice bubble routing for auto-TTS, remove the fork delta and keep only the regression coverage if it still adds value.

Required invariants after rebase:

- Discord auto-TTS Opus payloads route through native voice delivery.
- Discord does not regress to text-plus-media fallback for compatible voice payloads.

### 2. Control UI Talk read-aloud seam

Status: implemented

Why this exists:

- The fork wants the Control UI read-aloud button to use gateway Talk TTS output and browser audio playback instead of browser-native speech synthesis.
- This keeps voice output aligned with gateway/provider behavior instead of whatever the local browser feels like doing on a Tuesday.

Behavior added by this fork:

- Chat read-aloud requests `talk.speak` from the gateway.
- Returned audio is decoded and played in the browser via `AudioContext` or `Audio` fallback.
- UI chat rendering exposes a read-aloud control for assistant groups when a gateway client is available and browser playback is supported.

Primary seam files:

- `ui/src/ui/chat/talk-tts.ts`
- `ui/src/ui/chat/grouped-render.ts`

Files touched by this seam:

- `ui/src/ui/chat/talk-tts.ts`
  - Fork-local seam for gateway Talk request and browser playback behavior.
- `ui/src/ui/chat/speech.test.ts`
  - Contract tests for Talk request, audio playback, and error handling.
- `ui/src/ui/chat/grouped-render.ts`
  - Wires read-aloud controls into assistant message-group rendering by importing the gateway Talk playback seam directly.
- `ui/src/ui/chat/grouped-render.test.ts`
  - Regression coverage for read-aloud visibility and playback handoff.
- `ui/src/ui/views/chat.ts`
  - Threads the speech gateway client through chat rendering while leaving browser-native STT/TTS helpers in `speech.ts`.
- `ui/src/ui/views/chat.read-aloud.test.ts`
  - Verifies the chat view wiring around read-aloud behavior.
- `ui/src/ui/app-render.ts`
  - Passes the client into the chat view.

Rebase notes:

- If upstream adds a first-class chat read-aloud abstraction, move this seam to that abstraction and delete extra prop-threading.
- If upstream keeps browser-native speech synthesis, do not blindly reapply this seam without checking whether gateway Talk TTS can now be plugged in at a cleaner boundary.
- Keep the gateway Talk playback logic isolated from generic STT/browser speech code when upstream churns nearby files.

Required invariants after rebase:

- Chat read-aloud uses `talk.speak`, not browser speech synthesis.
- Assistant message groups still expose the read-aloud affordance when a gateway client is available.
- Browser playback still works through `AudioContext` when available and falls back sanely when it is not.

### 3. Agent-scoped TTS override seam

Status: implemented

Why this exists:

- The fork wants individual agents to override the global TTS provider, voice, and related settings without cloning the entire message/runtime config.
- Upstream TTS settings were previously too coarse, which made per-agent voice behavior clumsy or impossible.

Behavior added by this fork:

- `agents.list[].tts` can override the global `messages.tts` settings for that agent.
- Agent-scoped TTS resolution is centralized and reused by commands, tools, gateway Talk/TTS methods, and related secret-target reporting.
- Agent-specific provider requirements are reflected in secret-target and credential-surface output.

Primary seam files:

- `src/agents/tts-config.ts`
- `src/plugin-sdk/agent-runtime.ts`

Files touched by this seam:

- `src/agents/tts-config.ts`
  - Central merge and resolution helpers for agent-level TTS overrides.
- `src/agents/tts-config.test.ts`
  - Coverage for override precedence and provider-specific merges.
- `src/plugin-sdk/agent-runtime.ts`
  - Exposes the agent-scoped TTS resolution seam to callers that already live on the plugin/runtime boundary.
- `src/agents/tools/tts-tool.ts`
  - Uses the centralized resolver instead of ad hoc TTS config reads.
- `src/auto-reply/reply/commands-tts.ts`
  - Applies agent overrides to TTS command execution.
- `src/auto-reply/reply/dispatch-acp.ts`
  - Preserves agent-scoped TTS behavior for ACP dispatch.
- `src/auto-reply/reply/dispatch-from-config.ts`
  - Keeps runtime dispatch aligned with the central resolver.
- `src/gateway/server-methods/talk.ts`
  - Applies agent-scoped TTS config when gateway Talk synthesizes audio.
- `src/gateway/server-methods/tts.ts`
  - Applies the same resolution path for direct TTS calls.
- `src/cli/command-secret-targets.ts`
  - Includes agent-driven TTS provider requirements in secret-target output.
- `src/secrets/runtime-config-collectors-core.ts`
  - Keeps credential-surface discovery aligned with agent overrides.

Rebase notes:

- If upstream adds native agent-scoped TTS config, delete this seam and collapse back to the upstream implementation.
- Keep override merging centralized; do not let talk, tts, ACP, or auto-reply paths drift into bespoke merge logic.
- If provider-specific auth discovery moves upstream, prefer adopting the upstream seam instead of keeping local credential-surface glue.

Required invariants after rebase:

- Agent-specific TTS overrides win over global defaults for that agent only.
- Talk/TTS command and gateway paths all resolve agent-scoped TTS config through the same helper.
- Secret-target and credential-surface output stays consistent with the effective agent-scoped TTS configuration.

## Rebase playbook

Use this procedure whenever rebasing the fork onto a newer upstream base.

### 1. Triage upstream before replaying fork seams

For every seam in this file:

- inspect the upstream diff for the primary seam file and every touched file
- decide whether upstream now:
  - matches the fork behavior already
  - partially overlaps the fork behavior
  - conflicts with the fork behavior
  - introduces a cleaner native seam that should replace the fork seam

Questions to ask for each seam:

- Did upstream fix the underlying gap already?
- Did upstream move the ownership boundary to a better place?
- Did upstream add a public helper, event field, or contract we can adopt instead of carrying our own glue?
- Can part of the fork seam now be deleted instead of re-applied?

Default rule:

- prefer deleting or shrinking fork code when upstream now provides the behavior or a cleaner seam
- do not blindly reapply the old fork shape if upstream made the same area better

### 2. Re-apply seams in dependency order

Replay or re-implement the fork seams in this order:

1. agent-scoped TTS override seam
2. Control UI Talk read-aloud seam
3. Discord native voice-bubble auto-TTS seam

Why this order:

- agent-scoped TTS resolution stabilizes shared voice configuration first
- read-aloud builds on gateway TTS behavior but stays UI-local
- Discord native voice delivery reconciles last at the transport edge

### 3. Prefer seam migration over seam restoration

When upstream changed the same area:

- first try to move the fork behavior into the newest upstream seam
- only restore the old fork shape if no equivalent or better seam exists

Examples:

- if upstream adds first-class chat read-aloud hooks, use those instead of preserving local prop-threading by habit
- if upstream gains native agent-scoped TTS resolution, remove local merge helpers instead of carrying duplicate config plumbing
- if upstream lands Discord-native auto-TTS voice routing, delete the local route-preservation glue and keep only whatever regression coverage still earns its place

### 4. Re-verify each seam before moving on

After reconciling a seam:

- run the most direct scoped tests for that seam
- read the touched files once more to confirm the seam is still narrow
- update this file immediately if the seam shape changed

Do not wait until the end of the rebase to document seam changes. That is how fork knowledge dissolves into soup.

### 5. End every rebase by simplifying the fork

Before calling the rebase done, ask:

- what fork code can now be deleted?
- what seam can now be collapsed into upstream behavior?
- what helper can now become thinner?
- what touched files can now be removed from this ledger because they are no longer fork-specific?

The fork should get smaller when upstream improves. If it only ever grows, that is not a fork strategy; that is a landfill.
