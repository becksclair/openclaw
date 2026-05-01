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

## Current replay status: 2026-04-24 onto upstream/main `7dc1aeebbf`

For `bex/replay-upstream-2026-04-24-tip`, this is the branch-truth snapshot.
The replay started from a fresh worktree at current `upstream/main` after the
planned `d16b879334` base had moved, then was replayed again after
`upstream/main` moved from `f04a3dced0` to `b164bb3717`, and again from
`b164bb3717` to `93e95a2057`, and finally from `93e95a2057` to `27b8aa1ddf`,
then from `27b8aa1ddf` to `c0a7b6a510`, and then from `c0a7b6a510` to
`754acc4478`, and finally from `754acc4478` to `7dc1aeebbf`, during validation.

- Context gaps in this fresh replay worktree:
  - `CONTINUITY.md` is absent.
  - `NOTES.md` is absent.
- Active product seams reimplemented upstream-first on this branch:
  - seam 1: shared voice-routing, preview fallback, Opus voice-note normalization, and Discord/Telegram native voice preservation
  - seam 3: agent-scoped Talk/TTS config resolution, session initialization, gateway `tts.convert`, and reply/tool/Discord voice paths
  - seam 5: Control UI Talk read-aloud through gateway Talk instead of browser speech synthesis
  - seam 6: Telegram inbound-audio auto-TTS via explicit `InboundAudio` context
  - seam 7: ACP local cwd validation, backend-managed runtime options, and persistent binding reset
  - seam 8: parent-side generic ACP/Discord support needed by the private `acpx-remote` extension
  - seam 9: Google Gemini TTS prompt-steering fields
  - seam 10: native Codex GPT-5.5 routing and OpenAI-family model-prefix defaults
  - Discord trusted-by-default inbound context remains opt-in through config.
- Support seams carried after re-check:
  - safe-bin trust now checks canonical realpaths when the resolver provides them; upstream still lacked the explicit realpath trust path
  - runtime-sidecar generation filters to tracked bundled plugin directories so ignored private nested repos do not leak into parent baselines
  - local test routing includes the private `acpx-remote` and `memory-maintenance` extension helpers when those nested repos are present
- Custom extension links tracked by this fork:
  - `extensions/acpx-remote` links to the private ACP-over-SSH runtime backend repo.
  - `extensions/codex-transcribe` links to the private Codex-backed audio transcription provider repo.
  - `extensions/memory-maintenance` links to the private memory-maintenance orchestration plugin repo.
  - Keep these gitlinks linked during replay unless the corresponding private extension is intentionally retired and this ledger is updated in the same change.
- Generated surfaces were regenerated on this branch after replay:
  - `src/config/schema.base.generated.ts`
  - `src/config/bundled-channel-config-metadata.generated.ts`
  - `docs/.generated/config-baseline.sha256`
  - `scripts/lib/bundled-runtime-sidecar-paths.json`
  - `docs/.generated/plugin-sdk-api-baseline.sha256`
- Validation state:
  - `pnpm install` passed in the fresh replay worktree, and again after temporary private nested-extension validation was removed.
  - Focused TTS/Talk/Gemini, Discord voice/interaction, Telegram voice, auto-reply/session/tool, UI read-aloud, Discord channel, ACP cwd/runtime, safe-bin, bundled-plugin metadata, and scoped-config tests passed on this branch.
  - Temporary private nested-extension proof passed with copied local checkouts: `pnpm test:extension acpx-remote` and `pnpm test:extension memory-maintenance`.
  - Final replay gates passed on this branch: `pnpm build`, `pnpm ui:build`, `pnpm check`, `pnpm test`, `pnpm config:docs:check`, and `pnpm plugin-sdk:api:check`.
  - Extra generated-surface checks passed: `pnpm config:channels:check`, `pnpm config:schema:check`, and `pnpm runtime-sidecars:check`. The schema check reported only the expected parent-worktree warnings for absent private nested plugins.
  - Landing is still intentionally unperformed: do not force-push `origin/main`, realign local `main`, or restart a gateway without explicit landing approval and a fresh upstream preflight.

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
  - Reimplemented upstream-first on the 2026-04-22 replay branch.
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

- `ddf51b11d9` — drop
  - On the 2026-04-22 replay branch, neither half re-proved itself.
  - Proof on the clean replay branch:
    - `pnpm test src/commands/daemon-install-helpers.test.ts` passed without carrying a daemon-install env-isolation patch.
    - `pnpm test src/agents/skills.build-workspace-skills-prompt.prefers-workspace-skills-managed-skills.test.ts src/agents/skills.build-workspace-skills-prompt.syncs-merged-skills-into-target-workspace.test.ts` passed without reintroducing the old env-scoped OS-home seam in `src/agents/skills/workspace.ts`.

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
  - The original replay carry normalized the `channel:` form near ACP spawn preparation.
  - The current carry is narrower and lives at the Discord plugin binding seam instead: configured ACP conversation ids and inbound Discord thread/parent ids are normalized before matching, so raw Discord ids and `channel:<id>` forms compare as the same target.
  - Source context:
    - upstream issue: `openclaw/openclaw#63686`
    - upstream PR: `openclaw/openclaw#63574`
  - Treat this as a temporary replay seam. If upstream lands an equivalent fix, delete the local normalization and remove this entry plus the active seam inventory entry below.

- 2026-04-16 ACP cwd validation and persistent binding reset seam — keep until upstream validates the same failure class
  - Root cause from live Discord persistent ACP debugging: a configured ACP `cwd` is not metadata. For a local `acpx` runtime it is the actual current-host working directory used when initializing/loading a session.
  - Remote paths such as `/opt/homelab` are invalid for the local runtime and can poison a configured persistent binding before the bound Discord thread ever reaches a usable ACP session.
  - The fork carries explicit local ACP cwd validation at config load plus session init/load/live mutation, and clears stale persistent runtime state when a configured binding changes backend/cwd/error state.
  - This is paired with the `acpx-remote` seam below, where the remote backend owns cwd mapping instead of forcing users to remember local alias paths.

- 2026-04-16 `acpx-remote` parent support seam — keep until upstream has equivalent backend-managed ACP runtime semantics
  - The `acpx-remote` implementation itself lives in its own private linked repository at `extensions/acpx-remote/`; the OpenClaw parent repo deliberately carries only the gitlink plus the generic support seams needed for that extension to work from an in-tree checkout.
  - Parent-side OpenClaw changes add backend-managed ACP runtime-option semantics, local cwd validation for unmanaged ACP backends, destructive persistent-binding reset when backend/cwd/error state changes, and Discord persistent-thread id normalization so remote bound sessions are actually reached.
  - The private extension registers backend id `acpx-remote`, creates private local alias directories for remote agent cwd mappings, starts ACP over SSH, rewrites ACP cwd fields across the bridge, and advertises `cwd` as backend-managed so core will not validate or mutate it as a local path.
  - Live proof was completed for both an Orion remote ACP binding and a Cesium remote ACP binding through Discord persistent threads; the persisted sessions used backend `acpx-remote`, remote cwd mapping, and returned successful Discord replies from the bound sessions.
  - Treat this as a fork product seam, not a temporary diagnostic. Delete it only if upstream grows a first-class remote ACP backend with equivalent lifecycle, cwd, SSH, backend-managed runtime options, and persistent-binding behavior.

- 2026-04-16 local Codex ChatGPT auth guardrail — local workflow note, not a fork carry
  - The local `codex-openclaw` ACP backend must use ChatGPT login/auth, not an inherited `OPENAI_API_KEY` from the gateway service environment.
  - The fix was local operator state: remove OpenAI/Codex API-key variables from the gateway process environment, re-login Codex with ChatGPT device auth, and keep Codex configured to reject API-key login.
  - This is documented below as a local workflow invariant because it should not become repo code or committed live config.

- 2026-04-24 native Codex GPT-5.5 routing seam — keep until upstream separates the three OpenAI-family runtime paths
  - Root cause from live gateway debugging: `codex/gpt-5.5` must run through the bundled native Codex app-server harness, while `openai/gpt-*` and `openai-codex/gpt-*` remain normal OpenClaw provider paths.
  - The fork carries explicit model-prefix policy:
    - `codex/gpt-5.5` is the native Codex app-server/default GPT-5.5 path.
    - `openai/gpt-5.4` is the direct OpenAI API-key default.
    - `openai-codex/gpt-5.4` is the OpenAI Codex OAuth-through-PI default.
  - The fork also carries a narrow harness-selection fix so legacy PI session pins or history defaults cannot override an explicitly configured native `codex` harness for Codex-provider sessions.
  - Cleanup decision: do not carry the discarded Codex binary resolver or agent-scoped `CODEX_HOME` auth-bridge experiments. The local stale Bun-installed `codex` binary was removed, and the repo patch should stay focused on routing/model policy, not local binary hygiene.
  - Proof on the source checkout:
    - `pnpm test src/agents/command/attempt-execution.cli.test.ts src/agents/harness/selection.test.ts extensions/openai/openai-codex-provider.test.ts src/commands/models/auth.test.ts src/plugins/provider-runtime.test.ts`
    - direct build path: `node scripts/tsdown-build.mjs && node --import tsx scripts/write-build-info.ts`
    - live gateway smoke after restart: `agentId=codex`, `sessionKey=agent:codex:main`, model `codex/gpt-5.5`, thinking `low`, no fallback, returned `OPENCLAW-CODEX-55-TIGHT-OK`.
  - Treat this as a temporary routing/defaults carry. If upstream adopts equivalent prefix semantics and native Codex harness selection behavior, delete the local patch and remove this entry plus seam 10 below.

- 2026-04-15 Discord auto-TTS native voice-note regression seam — keep until upstream preserves voice intent end-to-end
  - Plain-text auto-TTS on Discord regressed so routed replies could arrive as plain opus attachments instead of native voice-message bubbles, and direct voice sends could fail when the synthesized audio artifact was only reachable through trusted local-media access.
  - The fork carries a narrow Discord-focused fix across four adjacent seams:
    - Shared final-mode auto-TTS fallback:
      - `src/auto-reply/reply/dispatch-from-config.ts` must capture sanitized preview text during partial streaming and synthesize a TTS-only final payload from that visible text when partial streaming produces no final reply payload.
      - The same seam must dedupe against the final reply's visible text so it does not synthesize a redundant preview-fallback voice message when a final reply already resolves to the same user-visible text.
    - Routed outbound and direct voice-send materialization:
      - `extensions/discord/src/outbound-adapter.ts` must preserve `audioAsVoice` in the routed outbound adapter and send the first audio artifact through `sendVoiceMessageDiscord(...)` before any follow-up text/media.
      - `extensions/discord/src/send.outbound.ts` must materialize voice-message input through outbound media-load options so trusted local roots and host read capability apply to local synthesized artifacts.
      - Discord voice-send callers that already accept trusted media options must forward them into `sendVoiceMessageDiscord(...)`, including `extensions/discord/src/monitor/reply-delivery.ts` and `extensions/discord/src/actions/runtime.messaging.ts`.
    - Native slash-command and interaction reply delivery:
      - `extensions/discord/src/monitor/native-command.ts` must preserve `audioAsVoice`, route the first voice-compatible artifact through `sendVoiceMessageDiscord(...)` before any follow-up interaction text, forward agent-scoped `mediaLocalRoots` for both direct plugin replies and dispatcher replies, pass the effective routed account into direct plugin command execution and native model-picker replies, resolve text chunking / max-lines policy from the effective routed account, and close voice-only interaction cleanup through the same reply-vs-follow-up semantics as the normal interaction send path.
    - Native interaction UI rerouting:
      - `extensions/discord/src/monitor/native-command-ui.ts` must resolve the effective routed account before direct model-picker helper recents reads, model-picker component redispatch, recents-scope reads/writes, and command-arg redispatch, so button/select follow-ups stay aligned with the same routed account/session as the originating slash command.
  - Proof on the source checkout:
    - `pnpm test src/auto-reply/reply/dispatch-from-config.test.ts -t "uses cleaned preview text|does not retry preview fallback TTS"`
    - `pnpm test extensions/discord/src/monitor/native-command.plugin-dispatch.test.ts extensions/discord/src/monitor/native-command.model-picker.test.ts extensions/discord/src/monitor/native-command.status-direct.test.ts extensions/discord/src/actions/runtime.test.ts extensions/discord/src/outbound-adapter.test.ts extensions/discord/src/monitor/reply-delivery.test.ts extensions/discord/src/send.sends-basic-channel-messages.test.ts`
      - includes direct helper-level proof that voice-only native interaction cleanup uses follow-up semantics when required, not just dispatcher-path inference
      - includes native interaction UI proof that the direct model-picker helper, model-picker component follow-ups, and command-arg component follow-ups all stay on the effective routed account
    - `pnpm build`
    - live Discord smoke after restarting `openclaw-gateway.service`: a plain text prompt produced both the expected text reply and a native Discord voice message with flag `8192` plus waveform/duration attachment metadata, not a plain opus file attachment.
    - live Discord slash-command smoke after rebuilding and restarting `openclaw-gateway.service`: in the Sky DM, `/think high` on the stale pre-restart gateway still produced the bad `.opus` attachment, while the fresh `/think low` run on the rebuilt gateway produced the ephemeral text acknowledgment plus a separate native voice-bubble style message with only playback controls (`Play`, playback speed, volume) and no attachment filename/download affordance.
  - Treat this as a replay-sensitive behavior seam. If upstream starts preserving `audioAsVoice` and voice-send media access through the Discord outbound/send/reply chain, delete the local carry and remove this entry.

- 2026-04-17 voice-note Opus normalization seam — keep until upstream normalizes non-Opus fallback audio before channel delivery
  - The live Google fallback investigation exposed a broader contract gap than Discord alone: fallback providers can succeed with `wav`, `mp3`, or other non-Opus audio even on channels where the fork wants consistent Opus voice-note behavior (`discord`, `telegram`, `whatsapp`, `feishu`, `matrix`).
  - The fork carries a narrow post-synthesis seam in `extensions/speech-core/src/tts.ts`:
    - after synthesis succeeds, but before any channel adapter sees the artifact, voice-note-sensitive channels now normalize any non-Opus output through local ffmpeg into `.opus`
    - this applies generically to fallback providers instead of hard-coding Google-specific behavior
    - if Opus normalization fails, the seam keeps the original audio as a regular attachment by clearing `voiceCompatible` instead of pretending voice-note delivery is still safe
  - Proof on the source checkout:
    - `pnpm test extensions/speech-core/src/tts.test.ts extensions/discord/src/outbound-adapter.test.ts extensions/telegram/src/voice.test.ts extensions/whatsapp/src/send.test.ts`
    - `pnpm build`
  - Treat this as part of the voice-routing carry, not a provider-specific patch. If upstream starts normalizing non-Opus voice-note output in the shared TTS path, delete the local seam and remove this entry.

- 2026-04-16 Agent-scoped TTS session initialization fix — behavior correction to seam #3, keep as part of the agent-scoped Talk/TTS carry
  - **Root cause**: The 2026-04-15 replay of the Agent-scoped Talk/TTS seam (commit `3bc8c045a3`) added agent-scoped `tts.auto` config support but missed the session initialization path in `src/auto-reply/reply/session.ts`.
  - **Symptom**: New sessions for agents with `agents.list[].tts.auto: "always"` did not have their `ttsAuto` field initialized from the agent config, causing auto-TTS to fail on Discord DMs and other channels.
  - **Fix**: Modified `src/auto-reply/reply/session.ts` to initialize `ttsAuto` from the agent's TTS config when creating a new session:
    - Added import for `resolveAgentConfig` from agent-scope
    - Added import for `normalizeTtsAutoMode` from TTS auto-mode module
    - Modified the `ttsAuto` initialization to include `normalizeTtsAutoMode(resolveAgentConfig(cfg, agentId)?.tts?.auto)` as a fallback
  - **Verification**: New sessions for the "claude" agent now correctly inherit `ttsAuto: "always"` from agent config, while still respecting user overrides and persisted session values.
  - **Test gap**: The original seam validation (lines 71-76) did not include `src/auto-reply/reply/session.test.ts`; this file should be added to the Agent-scoped Talk/TTS seam test coverage.
  - Treat this as an essential correction to the Agent-scoped Talk/TTS seam; do not drop it during replay even though the delta is small.

- 2026-04-20 gateway `tts.convert` agent-scope correction — behavior correction to seam #3, keep as part of the agent-scoped Talk/TTS carry
  - **Root cause**: The fork already widened the internal agent-aware TTS lanes, but `src/gateway/server-methods/tts.ts` still resolved explicit overrides and synthesis from the raw global config even when callers supplied `agentId`.
  - **Symptom**: Gateway `tts.convert` requests could ignore agent-specific provider, voice, and provider-owned TTS options, so conversions fell back to global defaults instead of matching the speaking agent.
  - **Fix**: `tts.convert` now resolves `resolveConfigWithAgentTts(cfg, agentId)` before explicit override resolution and synthesis, so gateway conversion follows the same effective TTS seam as Talk, reply dispatch, and other agent-aware lanes.
  - **Verification**: `src/gateway/server-methods/tts.test.ts` now proves that `tts.convert` passes the scoped config into both explicit-override resolution and `textToSpeech(...)`.
  - Treat this as a seam-accuracy correction, not a new standalone feature. If upstream makes `tts.convert` agent-aware through the same merge seam, fold back to upstream and delete this entry.

- 2026-04-20 Google Gemini TTS prompt-steering seam — keep until upstream exposes an equivalent transcript-safe delivery-guidance surface
  - The fork wants Google Gemini TTS to accept expressive delivery guidance without polluting the spoken transcript itself.
  - The carry lives in `extensions/google/speech-provider.ts`:
    - `messages.tts.providers.google` and `talk.providers.google` now accept Google-owned prompt-steering fields: `scene`, `style`, `pace`, and `sampleContext`
    - when any of those fields are present, Google TTS builds a deterministic prompt wrapper with explicit `SCENE`, `DIRECTOR'S NOTES`, `SAMPLE CONTEXT`, and `TRANSCRIPT` sections so Gemini only speaks the transcript section verbatim
    - the same wrapper applies to both normal synthesis and telephony synthesis, and Talk overrides can selectively replace or inherit those Google-owned fields
  - This seam depends on agent-aware TTS routing when an agent-specific Google voice/style is requested through gateway `tts.convert`; keep the agent-scope correction above aligned with this feature.
  - Proof on the source checkout:
    - `pnpm test extensions/google/speech-provider.test.ts`
    - `pnpm test src/gateway/server-methods/tts.test.ts`
  - Docs for this carry live in `docs/providers/google.md` and `docs/tools/tts.md`; keep them aligned with the actual Google-owned fields and deterministic prompt shape.
  - Treat this as a provider-owned product seam. If upstream adds equivalent Google TTS prompt-steering fields with the same transcript-safe behavior, collapse back to upstream and remove this entry.

- 2026-04-16 safe-bin canonical-path trust seam — keep until upstream trusts canonical system-bin realpaths
  - The node-host/system-run allowlist lane correctly unwraps transparent `env` wrappers such as `env tr a b`, but the safe-bin trust check was still evaluating the discovered symlink path instead of the canonical executable path.
  - On this host `tr` resolves as `/usr/sbin/tr` with realpath `/usr/bin/tr`; the default trusted safe-bin dirs include `/usr/bin` but not `/usr/sbin`, so allowlist-mode system-run and adjacent safe-bin callers failed closed with `SYSTEM_RUN_DENIED: allowlist miss` even though the real binary was one of the default safe bins.
  - The fork carries a minimal trust fix:
    - `src/infra/exec-safe-bin-trust.ts` now accepts an optional `resolvedRealPath` and, when present, trusts the canonical realpath dir instead of the discovered symlink dir so trusted-dir symlinks cannot escape into untrusted targets.
    - `src/infra/exec-approvals-allowlist.ts` threads `resolution.resolvedRealPath` into that trust check so safe-bin evaluation follows the canonical executable when available.
  - Proof on the 2026-04-22 replay branch:
    - `pnpm test src/infra/exec-safe-bin-trust.test.ts src/infra/exec-approvals-safe-bins.test.ts src/node-host/invoke-system-run.test.ts -t "trusts canonical realpaths|fails closed when a trusted-dir symlink resolves outside trusted dirs|trusts safe-bin realpaths|handles transparent env wrappers in allowlist mode"`
    - keep the proof commands above as the seam-local bar; do not leave a lingering "current full gates are green" claim here unless you have just re-proved `pnpm test`, `pnpm check`, and `pnpm build` on the exact pending tree.
  - Treat this as a narrow execution-policy carry. If upstream starts canonicalizing trusted safe-bin paths before trust evaluation, delete the local patch and remove this entry.

- 2026-04-22 tracked bundled-runtime sidecar baseline filtering + ACPX test-root routing — keep while replay worktrees carry excluded private extensions
  - With `extensions/acpx-remote/` copied into the replay worktree but excluded from parent git status, the unpatched bundled-runtime sidecar baseline collector still treated that private nested checkout as a parent bundled plugin and leaked `dist/extensions/acpx-remote/runtime-api.js` into the parent baseline.
  - The ACPX scoped Vitest root list also still omitted `extensions/acpx-remote`, so extension-acpx scoped test routing did not cover the private nested checkout even when it was intentionally present for replay proof.
  - The replay branch carries two narrow support fixes:
    - `src/plugins/runtime-sidecar-paths-baseline.ts` filters bundled runtime sidecar collection to tracked bundled plugin dirs only, so locally excluded nested repos do not pollute the parent baseline.
    - `test/vitest/vitest.extension-acpx-paths.mjs` and `test/vitest-scoped-config.test.ts` include `extensions/acpx-remote` in the ACPX scoped test roots when the nested checkout is present in-tree.
  - Proof on the 2026-04-22 replay branch:
    - direct repro before patch: `collectBundledRuntimeSidecarPaths({ rootDir: process.cwd() })` included `"dist/extensions/acpx-remote/runtime-api.js"`
    - `pnpm test src/plugins/bundled-plugin-metadata.test.ts -t "matches the checked-in runtime sidecar path baseline"`
    - `pnpm test test/vitest-scoped-config.test.ts -t "normalizes acpx extension include patterns relative to the scoped dir"`
  - Keep this as replay/hygiene support only. If the private nested extensions are absent from the worktree, this carry should stay inert.

## Local workflow notes

These are local operating rules, not carried fork seams.

- Repo-root `bex-fork.md` is the active carry ledger for this checkout.
- Treat any replay worktree names in the historical snapshot above as provenance, not current workspace truth. Use `CONTINUITY.md` plus the live checkout state to identify the active replay branch or worktree for the current pass.
- Keep this file focused on active seams and replay invariants; when a seam changes, update the relevant inventory, invariants, and narrow validation entries together so the document stays readable instead of accreting one-off bullets.

- Local Codex ACP auth guardrail:
  - Local persistent Codex ACP sessions should use ChatGPT login/auth, not OpenAI/Codex API-key environment variables inherited from the gateway service.
  - Before blaming ACP routing for local Codex cost/auth surprises, check the gateway process environment for `OPENAI_API_KEY` / `CODEX_API_KEY` / `OPENAI_BASE_URL` style overrides and check `codex login status`.
  - Keep the local Codex config pinned to ChatGPT login so accidental API-key login fails fast instead of silently burning API credits.

- Custom extension link handling:
  - `extensions/acpx-remote/`, `extensions/codex-transcribe/`, and `extensions/memory-maintenance/` are intentional fork-owned links to private extension repositories.
  - Keep those links present during replay unless the private extension is intentionally retired; do not silently drop them just because upstream does not know about them.
  - The parent repo should track only the extension links and generic parent support seams, not vendored private extension source.
  - After creating or refreshing a replay worktree, ensure the linked private extension checkouts are populated, rerun `pnpm install`, then use their focused extension tests as external proof for extension-owned behavior.
  - `pnpm test:extension memory-maintenance` remains a valid focused proof when the private linked repo is present because the helper routes `extensions/memory-maintenance/**` through the memory extension Vitest config.

## Seam inventory

### 1. Voice-routing seam

Status: implemented in the source checkout; reimplemented on the 2026-04-22 replay branch

Why this exists:

- The fork wants compatible synthesized voice output to stay on the native voice path where upstream still falls back too early.
- Upstream covers parts of the Discord native-voice route, but the current tree still needs narrow Discord carry to preserve `audioAsVoice` through routed outbound delivery and trusted local-media voice sends.

Behavior carried by this fork:

- `extensions/speech-core/src/tts.ts` normalizes channel identity and infers voice compatibility from the synthesized artifact, not only provider metadata.
- `extensions/speech-core/src/tts.ts` also normalizes non-Opus voice-note output to local `.opus` for `discord`, `telegram`, `whatsapp`, `feishu`, and `matrix` before outbound delivery, and falls back to regular audio attachments if that Opus transcode fails.
- Shared final-mode auto-TTS in `src/auto-reply/reply/dispatch-from-config.ts` captures sanitized preview text during partial streaming and synthesizes a TTS-only final payload from that visible text when no final reply payload survives.
- That same shared dispatch seam dedupes preview-fallback synthesis against the final reply's visible text so it does not emit a redundant second voice message when the final reply already resolves to the same user-visible text.
- Discord routed outbound preserves `audioAsVoice` in `extensions/discord/src/outbound-adapter.ts` so voice-compatible TTS replies become native voice messages instead of plain audio attachments.
- Discord voice sends materialize source audio through outbound media-load options, and voice-send callers that already have trusted media access forward it into that path.
- Discord native slash-command and interaction replies in `extensions/discord/src/monitor/native-command.ts` preserve `audioAsVoice` by sending the first voice-compatible artifact through the native voice-message path before any interaction follow-up text, forwarding agent-scoped media roots, passing the effective routed account into direct plugin command execution, resolving text chunking from the effective routed account, and closing voice-only interaction cleanup with the same follow-up semantics used by the main interaction send path.
- Discord native interaction UI follow-ups in `extensions/discord/src/monitor/native-command-ui.ts` keep model-picker helper reads, model-picker component redispatch, recents-scope reads and writes, and command-arg redispatch on the effective routed account.
- Telegram outbound keeps `audioAsVoice` through the adapter.
- Shared outbound delivery routes `audioAsVoice` media payloads through `sendPayload` when that is the channel seam that can preserve voice semantics.
- Queued tool-media reply merging preserves `audioAsVoice` when a later assistant reply absorbs queued voice output.

Primary seam files:

- `extensions/speech-core/src/tts.ts`
- `src/auto-reply/reply/dispatch-from-config.ts`
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
- `src/auto-reply/reply/dispatch-from-config.test.ts`
- `extensions/discord/src/outbound-adapter.test.ts`
- `extensions/discord/src/send.sends-basic-channel-messages.test.ts`
- `extensions/discord/src/monitor/reply-delivery.test.ts`
- `extensions/discord/src/actions/runtime.test.ts`
- `extensions/discord/src/monitor/native-command.plugin-dispatch.test.ts`
- `extensions/discord/src/monitor/native-command.model-picker.test.ts`
- `extensions/discord/src/monitor/native-command.status-direct.test.ts`
- `extensions/telegram/src/outbound-adapter.test.ts`
- `extensions/telegram/src/voice.test.ts`
- `extensions/whatsapp/src/send.test.ts`
- `src/infra/outbound/deliver.test.ts`
- `src/agents/pi-embedded-subscribe.handlers.messages.test.ts`

Rebase notes:

- Treat upstream as authoritative for the base Discord voice-message protocol.
- Re-check Discord's routed outbound adapter plus direct voice-send media access on every replay; until upstream preserves both, keep the narrow Discord carry instead of assuming the upstream path is still complete.
- Do not revive `ttsArtifactId` or diagnostic breadcrumb plumbing.

Required invariants after rebase:

- Discord routed outbound does not strip `audioAsVoice` into a plain attachment send when the reply should become a native voice bubble.
- Shared final-mode auto-TTS still emits a voice-path reply when partial streaming only exposed the visible text through preview payloads and no final reply payload survives.
- Shared final-mode auto-TTS does not emit a redundant preview-fallback voice reply when the final reply already resolves to the same visible text.
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

Status: implemented in the source checkout; reimplemented on the 2026-04-22 replay branch

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

Status: implemented in the source checkout; reimplemented on the 2026-04-22 replay branch

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
  - `tts.convert` now also resolves through the effective agent-scoped config when `agentId` is provided, so gateway conversion uses the same provider/voice/options seam before explicit override resolution and synthesis.
  - In the 2026-04-22 replay branch, generic reply dispatch currently carries only the scoped-config resolution for agent-aware TTS behavior. Preview-text fallback and dedupe remain owned by seam 1.
  - The other standalone gateway `tts.*` RPCs and direct CLI/local conversion remain intentionally global in this pass.

Primary seam files:

- `src/config/types.agents.ts`
- `src/config/zod-schema.agent-runtime.ts`
- `src/agents/agent-scope-config.ts`
- `src/agents/openclaw-tools.ts`
- `src/tts/tts-config.ts`
- `src/auto-reply/reply/session.ts` — session initialization must inherit `ttsAuto` from agent config when creating new sessions
- `src/auto-reply/reply/commands-tts.ts`
- `src/auto-reply/reply/dispatch-acp.ts`
- `src/auto-reply/reply/dispatch-from-config.ts`
- `src/gateway/protocol/schema/channels.ts`
- `src/gateway/talk-agent-config.ts`
- `src/gateway/server-methods/tts.ts`
- `src/gateway/server-methods/talk.ts`
- `extensions/discord/src/voice/manager.ts`

Primary seam tests:

- `src/agents/openclaw-tools.tts-scope.test.ts`
- `src/auto-reply/reply/commands-tts.test.ts`
- `src/auto-reply/reply/dispatch-acp.test.ts`
- `src/auto-reply/reply/dispatch-from-config.test.ts`
- `src/auto-reply/reply/session.test.ts` — verifies that agent-scoped `tts.auto` is inherited on new session creation
- `src/tts/tts-config.test.ts`
- `src/gateway/talk-agent-config.test.ts`
- `src/gateway/server-methods/talk.test.ts`
- `src/gateway/server-methods/tts.test.ts`
- `src/gateway/server.talk-config.test.ts`

Rebase notes:

- Keep generic agent-level TTS merging out of Talk-specific helpers.
- Keep Talk-specific provider synthesis out of generic TTS helpers.
- Keep gateway `tts.convert` agent-aware by resolving scoped config through `src/tts/tts-config.ts`; do not duplicate provider/voice selection logic inside the RPC handler.
- If upstream adds native agent-scoped TTS or Talk seams, collapse back to upstream instead of carrying parallel local abstractions.

Required invariants after rebase:

- Agent-specific TTS overrides win over global defaults for that agent only.
- Internal agent-aware TTS lanes use the effective agent-scoped `messages.tts` config before mode, status, prefs, and provider decisions, not only at the final synth call.
- `tts.convert` uses the effective agent-scoped config when `agentId` is provided, before explicit override resolution and synthesis.
- `talk.speak` and `talk.config` both see the effective agent-scoped provider and voice.
- Talk only points at a provider it can actually resolve, and it stays on a working provider if the selected one cannot materialize a valid Talk config.

### 4. Telegram inbound-audio auto-TTS seam

Status: implemented in the source checkout; reimplemented on the 2026-04-22 replay branch

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

Replay proof on the 2026-04-22 branch:

- `pnpm test extensions/telegram/src/bot-message-context.audio-transcript.test.ts src/auto-reply/reply/dispatch-from-config.reply-dispatch.test.ts src/auto-reply/reply/dispatch-from-config.test.ts`
- `pnpm test src/auto-reply/reply/dispatch-from-config.acp-abort.test.ts`
- `pnpm build`

Rebase notes:

- Prefer the explicit inbound-audio bit over body-shape heuristics when both exist.
- Keep the flag local to real audio-origin turns; do not broaden it into a generic “body contains transcript” marker.
- If upstream adds an equivalent explicit context flag or equivalent dispatch contract, delete this seam and collapse to upstream behavior.

Required invariants after rebase:

- Telegram voice/audio turns keep `InboundAudio: true` in finalized context even when the transcript is already rendered into `Body` / `BodyForAgent`.
- Final auto-TTS dispatch still sees `inboundAudio: true` for those wrapped Telegram transcript turns.
- Telegram inbound auto-TTS preserves both audio-origin detection and the effective agent-scoped TTS voice/provider on agent-bound sessions.
- Non-audio text turns do not start opting into audio-origin behavior just because their body text resembles transcript formatting.

### 5. Discord inbound untrusted-context opt-in seam

Status: implemented in the source checkout; reimplemented on the 2026-04-22 replay branch

Why this exists:

- Upstream/local Discord guild inbound handling was still appending Discord `UntrustedContext` by default for guild traffic.
- The first narrow fork patch only stopped duplicating the live message body; it still appended untrusted channel-topic metadata for trusted guild channels.
- This fork wants guild traffic treated as trusted by default and only specific Discord channels to opt into any wrapped Discord untrusted context when the room really is untrusted.

Behavior carried by this fork:

- `channels.discord.guilds.<guild>.channels.<channel>.copyMessageBodyToUntrustedContext` is a valid Discord config surface.
- Guild messages do not append any Discord `UntrustedContext` by default.
- Channels explicitly marked with `copyMessageBodyToUntrustedContext: true` are treated as untrusted and add both the wrapped channel-topic metadata and the wrapped live message body into `UntrustedContext`.
- Discord threads inherit the effective setting from their parent channel through the existing Discord channel/thread resolution seam.

Primary seam files:

- `extensions/discord/src/monitor/inbound-context.ts`
- `extensions/discord/src/monitor/allow-list.ts`
- `src/config/types.discord.ts`
- `src/config/zod-schema.providers-core.ts`
- `extensions/discord/src/config-ui-hints.ts`
- `src/config/bundled-channel-config-metadata.generated.ts`
- `docs/channels/discord.md`
- `docs/.generated/config-baseline.sha256`

Primary seam tests:

- `extensions/discord/src/monitor/inbound-context.test.ts`
- `extensions/discord/src/monitor/message-handler.inbound-context.test.ts`
- `extensions/discord/src/monitor/native-command-context.test.ts`
- `extensions/discord/src/config-schema.test.ts`

Replay proof on the 2026-04-22 branch:

- `pnpm test extensions/discord/src/monitor/inbound-context.test.ts extensions/discord/src/monitor/message-handler.inbound-context.test.ts extensions/discord/src/monitor/native-command-context.test.ts extensions/discord/src/config-schema.test.ts`
- `pnpm config:docs:gen`
- `node --import tsx scripts/generate-bundled-channel-config-metadata.ts --write`
- `pnpm build`

Rebase notes:

- Keep this seam Discord-local; do not widen it into a generic trusted-room abstraction.
- Preserve the trusted-by-default behavior; do not let channel-topic metadata bypass the same channel-level gate.
- If upstream adds an equivalent channel-scoped control, delete this seam and collapse back to upstream behavior.

Required invariants after rebase:

- Default Discord guild inbound context does not append any Discord `UntrustedContext`.
- Channels with `copyMessageBodyToUntrustedContext: true` append both the wrapped channel-topic metadata and the wrapped live message body into `UntrustedContext`.
- Discord thread contexts inherit the effective opt-in from the parent channel.
- Generated config metadata and config docs still expose `copyMessageBodyToUntrustedContext`.

### 6. Discord persistent ACP thread-binding seam

Status: implemented in the source checkout; reimplemented on the 2026-04-22 replay branch

Why this exists:

- Discord persistent ACP bindings are commonly configured with raw Discord thread/channel ids, while OpenClaw channel plumbing can also surface the same target as `channel:<id>`.
- Bound Discord thread messages must match the configured persistent ACP binding at the plugin binding seam before core tries to initialize or dispatch to ACP.
- Parent-channel fallback must keep working for Discord threads without making the configured id form matter.

Behavior carried by this fork:

- Discord ACP binding compilation normalizes configured conversation ids through the same target-normalization helper used by inbound Discord targets.
- Discord inbound ACP matching compares normalized binding, thread, and parent ids while returning the original inbound conversation id selected by the match.
- Raw Discord ids and `channel:<id>` forms compare as the same target for both direct thread matches and parent fallback matches.

Primary seam files:

- `extensions/discord/src/channel.ts`

Primary seam tests:

- `extensions/discord/src/channel.test.ts`

Replay proof on the 2026-04-22 branch:

- `pnpm test extensions/discord/src/channel.test.ts`

Rebase notes:

- Keep this seam inside the Discord plugin binding adapter; do not teach generic ACP core about Discord id prefixes.
- On the 2026-04-17 replay onto upstream `a189394590`, this seam re-proved cleanly at the Discord plugin binding layer and the older `src/agents/acp-spawn.ts` normalization was intentionally left out of the carry.
- If upstream provides equivalent normalized channel/thread matching, delete the fork seam instead of layering another normalization path on top.

Required invariants after rebase:

- A configured Discord ACP binding with `channel:<thread-id>` matches an inbound raw thread id.
- A configured Discord ACP binding with `channel:<parent-id>` still matches an inbound raw parent id for a thread message.
- The match result keeps the inbound id that should be used for dispatch, rather than rewriting everything into the configured form.
- Bound Discord thread messages reach persistent ACP dispatch after startup apply and after live binding/config mutation.

### 7. ACP local cwd validation and persistent binding reset seam

Status: implemented in the source checkout; reimplemented on the 2026-04-22 replay branch

Why this exists:

- ACP `cwd` is runtime state. For local `acpx`, it must be an absolute directory that exists on the current host.
- Accepting a remote path as a local ACP cwd creates a configured persistent binding that looks correct in config but cannot initialize a usable ACP session.
- Persistent bindings must discard stale runtime metadata when the binding backend/cwd/error state changes, otherwise a repaired config can keep reusing poisoned session state.

Behavior carried by this fork:

- `validateAcpRuntimeCwd(...)` validates that configured local ACP cwd values are non-empty absolute paths, exist on the current host, and point to directories.
- Config validation rejects invalid `agents.list[].runtime.acp.cwd` and `bindings[].acp.cwd` values before the gateway starts with bad local runtime state.
- ACP session init/load validates unmanaged local cwd values before calling the runtime.
- Live ACP runtime-option mutation rejects missing/invalid cwd values with `ACP_INVALID_RUNTIME_OPTION` before persisting them.
- Persistent configured ACP binding reconfiguration closes the old session with persistent state discarded and metadata cleared before reinitializing.

Primary seam files:

- `src/acp/runtime/cwd-validation.ts`
- `src/config/validation.ts`
- `src/acp/control-plane/manager.core.ts`
- `src/acp/control-plane/manager.runtime-controls.ts`
- `src/acp/persistent-bindings.lifecycle.ts`
- `src/acp/runtime/types.ts`

Primary seam tests:

- `src/config/config.acp-cwd.validation.test.ts`
- `src/acp/control-plane/manager.test.ts`
- `src/acp/persistent-bindings.test.ts`

Replay proof on the 2026-04-22 branch:

- `pnpm test src/config/config.acp-cwd.validation.test.ts src/acp/control-plane/manager.test.ts src/acp/persistent-bindings.test.ts`
- `pnpm build`

Rebase notes:

- Keep validation generic and backend-aware; do not special-case Discord, Orion, Cesium, or any particular host in core.
- Do not validate backend-managed cwd values as local paths. That belongs to the backend that owns the mapping.
- Keep persistent binding reconfigure cleanup destructive enough to remove stale runtime state; preserving bad metadata is the bug.

Required invariants after rebase:

- Config load rejects missing or non-directory local ACP cwd values for agent runtime config and persistent ACP binding config.
- Local ACP session init/load rejects an invalid cwd before calling the runtime.
- Live ACP cwd mutation rejects invalid local paths before persisting or applying the change.
- Reconfiguring a persistent ACP binding across cwd/backend/error state closes the old session with persistent runtime state discarded and metadata cleared.
- Backend-managed runtime option keys are normalized and exposed through ACP runtime capabilities.

### 8. `acpx-remote` SSH ACP runtime support seam

Status: implemented in the source checkout and reimplemented in the 2026-04-22 replay branch for the OpenClaw parent checkout; extension implementation lives in private linked repo `extensions/acpx-remote/`

Why this exists:

- Remote ACP work should not require OpenClaw core to learn per-host SSH behavior or force users to remember hidden local alias cwd paths.
- The remote backend needs to let users configure the remote cwd they actually care about, while OpenClaw core still sees safe ACP runtime state and does not validate backend-owned remote paths as local directories.
- The private `acpx-remote` extension folds the old external `remote-acp` helper into an extension-owned runtime backend. The OpenClaw parent carries the generic ACP and Discord seams that make that extension viable without hardcoding Orion, Cesium, SSH, or remote-host behavior into core.

Behavior carried by this fork in the OpenClaw parent repo:

- ACP runtime capabilities now include `managedRuntimeOptionKeys`, allowing a backend to declare that a runtime option such as `cwd` is owned internally.
- The ACP session manager resolves backend capabilities before session init/load, omits backend-managed `cwd` values from local runtime validation, and refuses generic in-session mutation for managed keys with `ACP_INVALID_RUNTIME_OPTION`.
- Local unmanaged ACP cwd values are validated at config load, session init/load, and live runtime-option mutation. Missing, relative, non-directory, or inaccessible local cwd values fail before a poisoned persistent session can be created.
- Persistent configured ACP binding reconfiguration now closes the previous session with persistent state discarded and metadata cleared, so changing backend/cwd/error state does not keep reusing stale runtime metadata.
- Discord persistent ACP matching normalizes raw Discord ids and `channel:<id>` ids at the plugin binding seam, so bound thread messages can actually reach the configured remote ACP session after startup apply and live mutation.
- Local test routing knows that the private in-tree `extensions/acpx-remote/` checkout uses the ACPX Vitest config, but the extension source itself is excluded from the parent Git repo and committed separately.
- Plugin SDK and config generated baselines are regenerated for the new `managedRuntimeOptionKeys` capability and Discord channel config metadata touched by this fork carry.

Private extension behavior this parent seam supports:

- `acpx-remote` registers ACP runtime backend id `acpx-remote`.
- Plugin config maps per-agent remote targets, remote cwd values, commands, SSH options, remote environment allowlists, and private alias/state roots.
- The extension creates private local alias directories under its configured alias root and injects that alias cwd into runtime `ensureSession` calls.
- The SSH bridge starts the remote ACP command, rewrites ACP `cwd` fields from local alias paths to remote cwd paths, and forwards only the configured remote environment names.
- The backend advertises `managedRuntimeOptionKeys: ["cwd"]`, so core does not validate the remote cwd as a local path and does not allow in-session cwd mutation through generic ACP controls.
- Runtime handles returned through the delegate `acpx` backend are rebranded to `acpx-remote`, so persisted sessions do not collapse back to the wrong backend.

OpenClaw parent seam files:

- `src/acp/runtime/types.ts`
- `src/acp/runtime/cwd-validation.ts`
- `src/acp/control-plane/manager.core.ts`
- `src/acp/control-plane/manager.runtime-controls.ts`
- `src/acp/persistent-bindings.lifecycle.ts`
- `src/config/validation.ts`
- `src/config/zod-schema.providers-core.ts`
- `extensions/discord/src/channel.ts`
- `extensions/discord/src/config-ui-hints.ts`
- `extensions/discord/src/monitor/allow-list.ts`
- `extensions/discord/src/monitor/inbound-context.ts`
- `test/vitest/vitest.extension-acpx-paths.mjs`
- `docs/.generated/config-baseline.sha256`
- `docs/.generated/plugin-sdk-api-baseline.sha256`

Private nested extension repo files:

- `extensions/acpx-remote/openclaw.plugin.json`
- `extensions/acpx-remote/index.ts`
- `extensions/acpx-remote/register.runtime.ts`
- `extensions/acpx-remote/runtime-api.ts`
- `extensions/acpx-remote/bridge.ts`
- `extensions/acpx-remote/src/config-schema.ts`
- `extensions/acpx-remote/src/config.ts`
- `extensions/acpx-remote/src/path-utils.ts`
- `extensions/acpx-remote/src/service.ts`
- `extensions/acpx-remote/src/runtime.ts`
- `extensions/acpx-remote/src/transport/bridge.ts`
- `extensions/acpx-remote/src/transport/protocol.ts`
- `extensions/acpx-remote/src/transport/ssh-config.ts`

Primary OpenClaw parent tests:

- `src/config/config.acp-cwd.validation.test.ts`
- `src/acp/control-plane/manager.test.ts`
- `src/acp/persistent-bindings.test.ts`
- `extensions/discord/src/channel.test.ts`
- `extensions/discord/src/monitor/inbound-context.test.ts`
- `extensions/discord/src/monitor/message-handler.inbound-context.test.ts`

Replay proof on the 2026-04-22 branch:

- `pnpm test src/config/config.acp-cwd.validation.test.ts src/acp/control-plane/manager.test.ts src/acp/persistent-bindings.test.ts extensions/discord/src/channel.test.ts`
- `pnpm build`

Private extension tests:

- `extensions/acpx-remote/index.test.ts`
- `extensions/acpx-remote/src/config.test.ts`
- `extensions/acpx-remote/src/runtime.test.ts`
- `extensions/acpx-remote/src/service.test.ts`
- `extensions/acpx-remote/src/transport/protocol.test.ts`
- `extensions/acpx-remote/src/transport/ssh-config.test.ts`

Rebase notes:

- Keep SSH, remote cwd mapping, and remote environment policy extension-owned.
- Keep parent-repo core changes limited to generic ACP runtime capability semantics that any backend can use.
- Keep Discord id normalization inside the Discord plugin binding adapter; do not teach generic ACP core about Discord id prefixes.
- Do not reintroduce a separate `remote-acp` appendix unless there is a concrete reason the extension boundary cannot own the behavior.
- If the replay worktree does not include the private nested `extensions/acpx-remote/` checkout, treat parent-repo ACP/Discord tests plus build/check as the local proof bar and leave the private extension unit/live proof as an external nested-repo gate.
- For replay worktrees that need private extension proof, keep `extensions/acpx-remote/`, `extensions/codex-transcribe/`, and `extensions/memory-maintenance/` populated from their linked private repos, then rerun `pnpm install`. Keep any resulting workspace/lockfile churn out of the parent carry unless the parent repo actually gained a real tracked dependency change.
- If upstream adds an equivalent remote ACP backend, compare lifecycle, cwd rewriting, backend identity, SSH config handling, backend-managed runtime options, and persistent binding behavior before dropping this carry.

Required invariants after rebase:

- `acpx-remote` registers as an ACP runtime backend through extension startup and unregisters cleanly on stop.
- Per-agent remote cwd config is accepted as remote configuration, not validated as a local path by core.
- Runtime `ensureSession` receives a private local alias cwd, and the bridge rewrites ACP cwd fields to the configured remote cwd before messages reach the remote process.
- The backend reports `cwd` as managed, and generic ACP runtime-option mutation cannot change it in-session.
- Local ACP backends still reject missing, relative, non-directory, or inaccessible cwd values before session init/load and live cwd mutation.
- Persistent binding reconfiguration across backend/cwd/error state discards stale persistent runtime state and clears stale metadata.
- Discord raw thread ids and `channel:<id>` ids continue to match the same persistent ACP binding target.
- Persisted remote sessions keep backend id `acpx-remote`.
- SSH config materialization preserves target host aliases, includes the user's SSH config when enabled, and writes temporary identity/cert/known-host material only when configured.
- Real Discord persistent bindings for remote ACP continue to survive gateway restart and live binding mutation.

### 9. Google Gemini TTS prompt-steering seam

Status: implemented in the source checkout; reimplemented on the 2026-04-22 replay branch

Why this exists:

- The fork wants Google Gemini TTS to accept delivery guidance such as scene, tone, pacing, and setup context without leaking that guidance into the spoken transcript.
- The same Google-owned guidance should work for both `messages.tts.providers.google` and Talk-mode `talk.providers.google`, so agent-specific or Talk-specific Google voices can keep their own delivery shape.

Behavior carried by this fork:

- `extensions/google/speech-provider.ts` accepts Google-owned prompt-steering fields `scene`, `style`, `pace`, and `sampleContext` alongside the existing model/voice config.
- When any prompt-steering field is present, Google synthesis wraps the request in a deterministic prompt with explicit `SCENE`, `DIRECTOR'S NOTES`, `SAMPLE CONTEXT`, and `TRANSCRIPT` sections, and Gemini is told to speak only the transcript section verbatim.
- Normal synthesis and telephony synthesis both use that same transcript-safe prompt wrapper.
- Talk-mode Google overrides can selectively replace or inherit those prompt-steering fields on top of the base Google TTS config.
- Repo docs expose the feature in `docs/providers/google.md` and `docs/tools/tts.md` so operators know these are OpenClaw-owned prompt-steering helpers, not native Gemini `SpeechConfig` JSON keys.

Primary seam files:

- `extensions/google/speech-provider.ts`
- `docs/providers/google.md`
- `docs/tools/tts.md`

Primary seam tests:

- `extensions/google/speech-provider.test.ts`

Rebase notes:

- Keep this seam Google-local; do not widen it into a generic cross-provider prompt-wrapper abstraction unless another provider truly needs the same contract.
- Preserve the transcript-safe behavior: guidance sections shape delivery, but the transcript remains the only spoken content.
- Keep Talk inheritance/override behavior inside the Google speech provider seam rather than spreading Google-specific rules into generic Talk helpers.
- If upstream adds equivalent Google TTS guidance fields with deterministic transcript-safe synthesis, delete this seam and collapse back to upstream.

Required invariants after rebase:

- Google TTS prompt-steering fields remain `scene`, `style`, `pace`, and `sampleContext`.
- Google synthesis only wraps the request when at least one prompt-steering field is present; plain transcript-only requests stay plain.
- The prompt wrapper keeps the transcript isolated in its own section so Gemini only speaks the intended transcript text.
- Talk-mode Google overrides can inherit the base Google prompt-steering fields and selectively replace any subset of them.
- Docs still describe these fields as OpenClaw prompt-steering helpers rather than native Gemini `SpeechConfig` keys.

### 10. Native Codex GPT-5.5 routing seam

Status: implemented in the source checkout

Why this exists:

- The fork wants `codex/gpt-5.5` to mean the native Codex app-server harness, not the direct OpenAI API provider and not OpenAI Codex OAuth through PI.
- OpenAI-family prefixes carry different auth/runtime semantics:
  - `codex/*` is native Codex app-server harness.
  - `openai/*` is direct OpenAI API-key provider.
  - `openai-codex/*` is OpenAI Codex OAuth through PI.
- Existing session history can contain legacy PI pins. Those pins must not silently steal a run when config explicitly asks for the native Codex harness.

Behavior carried by this fork:

- OpenAI default model constants use `openai/gpt-5.4`.
- OpenAI Codex OAuth default model constants use `openai-codex/gpt-5.4`.
- Docs and auth/model hints explain that GPT-5.5 is available through `codex/gpt-5.5` on the native Codex harness, while OpenAI and OpenAI-Codex provider defaults stay on GPT-5.4.
- `runAgentAttempt(...)` does not synthesize or preserve a PI harness pin for Codex-provider sessions when the session history predates the native harness.
- `selectAgentHarness(...)` lets explicit plugin harness config override an existing PI pin, while preserving explicit non-PI plugin pins and normal PI behavior.

Primary seam files:

- `extensions/openai/default-models.ts`
- `src/plugins/provider-model-defaults.ts`
- `src/agents/command/attempt-execution.ts`
- `src/agents/harness/selection.ts`
- `docs/plugins/codex-harness.md`
- `docs/providers/openai.md`

Primary seam tests:

- `src/agents/command/attempt-execution.cli.test.ts`
- `src/agents/harness/selection.test.ts`
- `extensions/openai/openai-codex-provider.test.ts`
- `src/commands/models/auth.test.ts`
- `src/plugins/provider-runtime.test.ts`

Rebase notes:

- Keep this seam as routing/default policy only.
- Do not reintroduce the discarded Codex app-server binary resolver or agent-scoped `CODEX_HOME` materialization unless a fresh live failure proves repo code must own that behavior.
- If a local machine has multiple `codex` binaries, fix local PATH/binary state first; do not expand this fork seam for local binary hygiene.
- Keep `codex/gpt-*`, `openai/gpt-*`, and `openai-codex/gpt-*` semantics distinct in docs, auth hints, provider defaults, and tests.

Required invariants after rebase:

- `codex/gpt-5.5` selects the native Codex app-server harness and can complete a live low-thinking codex-agent turn without fallback.
- `openai/gpt-5.4` remains the direct OpenAI API-key default.
- `openai-codex/gpt-5.4` remains the OpenAI Codex OAuth-through-PI default.
- Explicit native Codex harness config wins over stale PI session pins for Codex-provider sessions.
- Existing explicit non-PI harness pins and explicit PI runtime selection keep their previous behavior.

## Replay checklist

When rebasing this fork onto a newer upstream base:

1. Start from a fresh branch off `upstream/main`.
2. Run `pnpm install` immediately after branching.
3. Replay only the active seams above.
4. Prefer upstream behavior wherever it now overlaps, but explicitly re-prove Discord voice delivery on the routed outbound lane, the direct reply lane, and the native slash-command/interaction lane before dropping any Discord voice-note carry.
5. Re-prove Discord persistent ACP binding behavior separately from raw ACP session tests; the failure class lives at the channel binding/startup/live-mutation seam.
6. If you need private extension validation in the replay worktree, keep `extensions/acpx-remote/`, `extensions/codex-transcribe/`, and `extensions/memory-maintenance/` populated from their linked private repos, rerun `pnpm install`, and keep any resulting linked-repo or lockfile churn out of the parent carry.
7. Re-prove `acpx-remote` with both unit tests and at least one real persistent Discord binding before treating remote ACP as carried; if the private linked repo is absent from the replay worktree, mark that extension proof as deferred external validation instead of faking a parent-repo green.
8. After replay, remove stale tests and redundant fork code before calling it done.

## Narrow validation set

Run these after replaying the live seams:

- `pnpm test extensions/speech-core/src/tts.test.ts`
- `pnpm test extensions/discord/src/monitor/native-command.plugin-dispatch.test.ts extensions/discord/src/monitor/native-command.model-picker.test.ts extensions/discord/src/monitor/native-command.status-direct.test.ts extensions/discord/src/actions/runtime.test.ts extensions/discord/src/outbound-adapter.test.ts extensions/discord/src/monitor/reply-delivery.test.ts extensions/discord/src/send.sends-basic-channel-messages.test.ts`
- `pnpm test extensions/telegram/src/outbound-adapter.test.ts extensions/telegram/src/voice.test.ts`
- `pnpm test src/infra/outbound/deliver.test.ts`
- `pnpm test src/agents/pi-embedded-subscribe.handlers.messages.test.ts`
- `pnpm test src/tts/tts-config.test.ts src/gateway/talk-agent-config.test.ts`
- `pnpm test extensions/google/speech-provider.test.ts src/gateway/server-methods/tts.test.ts`
- `pnpm test src/auto-reply/reply/dispatch-from-config.test.ts src/auto-reply/reply/dispatch-from-config.reply-dispatch.test.ts`
- `pnpm test src/auto-reply/reply/dispatch-acp.test.ts`
- `pnpm test src/auto-reply/reply/commands-tts.test.ts`
- `pnpm test src/agents/openclaw-tools.tts-scope.test.ts`
- `pnpm test src/gateway/server-methods/talk.test.ts src/gateway/server.talk-config.test.ts`
- `pnpm test ui/src/ui/views/chat.test.ts`
- `pnpm test extensions/discord/src/channel.test.ts`
- `pnpm test src/acp/control-plane/manager.test.ts src/acp/persistent-bindings.test.ts src/config/config.acp-cwd.validation.test.ts`
- `pnpm test:extension acpx-remote` (when the private linked repo checkout is present)
- `pnpm test:extension codex-transcribe` (when the private linked repo checkout is present)
- `pnpm test:extension memory-maintenance` (when the private linked repo checkout is present)
- `pnpm build`
- `pnpm check`
