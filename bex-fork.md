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
- Keep transport mechanics separate from policy. Discord/Gateway loops should orchestrate; seams should decide policy.
- Keep translator code at boundaries. If upstream API shapes churn, one seam should absorb it.
- Prefer seam contract tests over asserting private coordinator state from end-to-end tests.
- If a seam needs shared state, expose a minimal test hook rather than forcing tests to reach through unrelated classes.
- If upstream gains a real extension point or equivalent behavior, delete the fork seam and collapse back to upstream instead of carrying vanity diffs.
- When in doubt, optimize for the next rebase and the working feature, not the cleverest local abstraction.

## Seam inventory

### 0. Branch inventory

Current fork scope is split across two layers:

- committed branch seams already present on `bex-fork`
- newer worktree seams not yet committed upstream to the branch tip

Committed branch seams currently include:

- Discord native voice-bubble auto-TTS
- Control UI read-aloud via gateway Talk TTS

Worktree seams currently include:

- Discord shared realtime voice backend and gateway protocol additions
- transcript append orchestration
- transcript persistence guarantees
- explicit transcript sequence handling
- session initialization protection
- canonical session-store key normalization
- store lock timeout accounting
- repeatable Android APK build and packaging helpers

Rebase rule:

- always inventory both committed branch deltas and uncommitted fork work before assuming the ledger is complete

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
- `extensions/discord/src/monitor/reply-delivery.test.ts`

Files touched by this seam:

- `extensions/speech-core/src/tts.ts`
  - Adds Discord to the set of channels eligible for Opus/native voice delivery.
- `extensions/discord/src/monitor/reply-delivery.test.ts`
  - Verifies Discord reply delivery uses the voice-bubble path for compatible auto-TTS payloads.
- `src/plugins/contracts/tts.contract.test.ts`
  - Keeps the TTS contract honest around telephony and provider/output behavior that this channel-specific routing depends on.

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
- UI chat rendering exposes a read-aloud control for assistant groups using the gateway client.

Primary seam files:

- `ui/src/ui/chat/speech.ts`
- `ui/src/ui/chat/grouped-render.ts`

Files touched by this seam:

- `ui/src/ui/chat/talk-tts.ts`
  - Fork-local seam for gateway Talk request and browser playback behavior.
- `ui/src/ui/chat/speech.ts`
  - Now holds STT/browser input behavior and re-exports TTS helpers only for compatibility.
- `ui/src/ui/chat/speech.test.ts`
  - Contract tests for Talk request, audio playback, and error handling.
- `ui/src/ui/chat/grouped-render.ts`
  - Wires read-aloud controls into assistant message-group rendering.
- `ui/src/ui/views/chat.ts`
  - Threads the speech gateway client through chat rendering.
- `ui/src/ui/app-render.ts`
  - Passes the client into the chat view.

Rebase notes:

- If upstream adds a first-class chat read-aloud abstraction, move this seam to that abstraction and delete extra prop-threading.
- If upstream keeps browser-native speech synthesis, do not blindly reapply this seam without checking whether gateway Talk TTS can now be plugged in at a cleaner boundary.
- This seam likely still has tightening headroom: if possible, keep the gateway Talk playback logic isolated from generic STT/browser speech code.

Required invariants after rebase:

- Chat read-aloud uses `talk.speak`, not browser speech synthesis.
- Assistant message groups still expose the read-aloud affordance when a gateway client is available.
- Browser playback still works through `AudioContext` when available and falls back sanely when it is not.

### 3. Discord shared realtime voice backend seam

Status: in progress, implemented enough to warrant ledger coverage

Why this exists:

- The fork adds a shared realtime voice backend across Discord and gateway/client surfaces.
- This is intentionally ahead of upstream and touches protocol, runtime, Discord voice transport, and session bootstrap behavior.
- Without explicit seam boundaries, this kind of feature becomes a rebase tax factory almost immediately.

Behavior added by this fork:

- Gateway exposes typed realtime session create/input/interrupt/close/tool/transport methods and events.
- Discord voice can use a managed realtime conversation runtime instead of only the legacy `STT -> agent -> TTS` path.
- Realtime transcript replay and runtime lifecycle state are kept separate from the raw Discord transport loop.
- Session bootstrap for realtime voice can seed prompt/history/tool context from the existing OpenClaw session environment.

Primary seam files:

- `src/gateway/realtime-audio/runtime.ts`
- `src/agents/realtime-session-bootstrap.ts`
- `src/agents/realtime-session-prompt-seam.ts`
- `extensions/discord/src/voice/realtime-runtime.ts`
- `extensions/discord/src/voice/audio-processing.ts`

Files touched by this seam:

- `src/gateway/protocol/schema/realtime-audio.ts`
  - Additive wire contract for realtime session methods and events.
- `src/gateway/server-methods/realtime-audio.ts`
  - Gateway method boundary for realtime session control.
- `src/gateway/realtime-audio/**`
  - Shared session core, tool runtime, history handling, and upstream-aware provider selection via the realtime provider registry.
- `src/plugin-sdk/gateway-runtime.ts`
  - Public facade exposing the managed realtime runtime to plugin code.
- `src/agents/realtime-session-bootstrap.ts`
  - Fork seam for resolving workspace and bounded history bootstrap for realtime sessions.
- `src/agents/realtime-session-prompt-seam.ts`
  - Fork-local seam for realtime prompt assembly so upstream system-prompt churn is isolated from transport/bootstrap code.
- `extensions/discord/src/voice/manager.ts`
  - Discord voice transport adapter that now consumes the shared runtime instead of owning the whole conversation loop.
- `extensions/discord/src/voice/realtime-runtime.ts`
  - Fork-local seam for Discord realtime runtime lifecycle and transcript replay glue.
- `extensions/discord/src/voice/audio-processing.ts`
  - Fork-local seam for Discord voice audio decode, WAV staging, and transcription plumbing so transport logic stays separate.
- `extensions/discord/src/voice/speaker-context.ts`
  - Fork-local seam for speaker identity resolution, owner classification, role-aware access checks, and cache behavior.
- `extensions/discord/src/voice/legacy-reply.ts`
  - Fork-local seam for the legacy `STT -> agent -> TTS` reply path and Discord-specific TTS override handling.
- `src/agents/realtime-session-bootstrap.test.ts`
  - Regression coverage for workspace and history bootstrap behavior.
- `extensions/discord/src/voice/manager.e2e.test.ts`
  - Discord-side smoke coverage for the shared runtime path.
- `src/gateway/protocol/realtime-audio.test.ts`
  - Protocol and server-method coverage for the realtime wire contract.

Rebase notes:

- This seam is the highest-risk rebase area on the branch because it spans protocol, runtime, plugin facade, and Discord transport.
- Prefer shrinking this seam aggressively if upstream adds any native realtime conversation or voice runtime support.
- Keep Discord transport concerns separate from shared runtime concerns; do not let transport fallback logic leak back into the gateway session core.
- Keep bootstrap, prompt, and history logic isolated from transport code so upstream voice-channel changes do not force prompt rebuild churn.
- Keep Discord audio decode/transcription mechanics isolated from transport/session policy so upstream transport fixes do not reopen the fork seam unnecessarily.
- Keep speaker resolution/cache and legacy reply generation outside the transport coordinator so upstream Discord transport changes do not force unrelated fork rebases.

Required invariants after rebase:

- Gateway realtime session methods remain typed and additive.
- Discord can still opt into the shared realtime backend without losing the legacy backend.
- Realtime runtime lifecycle and replay history logic stay outside the main Discord voice transport loop.
- Session bootstrap still uses the configured workspace and bounded prior history.

### 4. Transcript persistence guarantee seam

Status: implemented

Why this exists:

- The fork requires transcript events to represent messages that actually reached disk.
- The fork also requires user-only transcript writes to persist immediately instead of waiting for a later assistant message.
- Upstream `SessionManager` behavior around header-only and user-only transcripts is not strong enough for this fork's realtime and durability expectations.

Behavior added by this fork:

- User-only transcript batches are force-persisted even when no assistant message exists yet.
- Transcript append functions fail closed with `transcript persistence incomplete` if an append appears to succeed in memory but the message id is not present on disk.
- Live transcript events are emitted only for message ids that can be confirmed on disk.
- Event emission still happens while the per-session write lock is held so consumers observe persisted order.

Primary seam file:

- `src/config/sessions/transcript-append-seam.ts`

Files touched by this seam:

- `src/config/sessions/transcript-append-seam.ts`
  - Fork-only append seam for resolving the transcript target, opening/preparing a locked `SessionManager`, forcing user-only flushes, verifying persisted message ids, and emitting persisted transcript updates.
  - Exists to keep fork append logic and persistence guarantees in one boundary instead of splitting policy across multiple seam files.
- `src/config/sessions/transcript.ts`
  - Uses the seam for both `appendTextMessagesToSessionTranscript` and `appendAssistantMessageToSessionTranscript`.
  - This is the main upstream conflict surface for transcript writes.
- `src/config/sessions/sessions.test.ts`
  - Contract tests for persisted ordering, dedupe, and fail-closed behavior.

Rebase notes:

- If upstream changes transcript append flow, keep this seam as an imported helper instead of inlining the fork behavior back into multiple call sites.
- If upstream adds its own persisted-event or force-flush API, migrate this seam to that API and remove direct dependence on private `SessionManager` internals.

Required invariants after rebase:

- Appending a user-only message writes it to the transcript file immediately.
- A message append does not return success unless the written message id exists on disk.
- Emitted transcript updates reflect persisted order.
- Concurrent appends do not invert event order.

### 5. Explicit transcript sequence seam

Status: implemented

Why this exists:

- Realtime consumers were previously re-deriving sequence numbers from file length or local history, which can drift under concurrent writes and batched updates.
- The fork requires explicit per-message sequence fidelity.

Behavior added by this fork:

- Transcript updates can carry `messageSeq` directly from the writer.
- Gateway consumers prefer `messageSeq` from the event payload.
- Legacy fallback logic is centralized in one helper instead of duplicated across consumers.

Primary seam files:

- `src/sessions/transcript-events.ts`
- `src/sessions/transcript-message-seq.ts`

Files touched by this seam:

- `src/sessions/transcript-events.ts`
  - Event contract includes optional `messageSeq`.
- `src/sessions/transcript-message-seq.ts`
  - Central helper for sequence fallback policy.
- `src/config/sessions/transcript.ts`
  - Writers populate explicit `messageSeq`.
- `src/gateway/server.impl.ts`
  - Gateway session message broadcast uses the helper instead of inline fallback logic.
- `src/gateway/sessions-history-http.ts`
  - SSE history/live stream uses the same helper.
- `src/sessions/transcript-events.test.ts`
  - Contract tests for event normalization and sequence fallback.

Rebase notes:

- Do not let new consumers invent their own sequence fallback logic.
- If upstream changes the transcript event shape, preserve a single helper for sequence resolution.
- If upstream starts emitting authoritative sequence numbers everywhere, shrink this seam down to normalization only.

Required invariants after rebase:

- Batched transcript appends emit stable increasing `messageSeq` values.
- SSE and gateway message broadcasts prefer the explicit `messageSeq` from events.
- Fallback ordering logic exists in exactly one helper.

### 6. Session initialization protection seam

Status: implemented

Why this exists:

- Restarting or re-opening a transcript with user-only history could previously destroy that history or duplicate the header when the first assistant message arrived.

Behavior added by this fork:

- Existing user-only transcript history is preserved across session-manager reinitialization.
- Only strictly header-only transcript files are reset to avoid duplicate header writes.

Primary file:

- `src/agents/pi-embedded-runner/session-manager-init.ts`

Files touched by this seam:

- `src/agents/pi-embedded-runner/session-manager-init.ts`
  - Limits reset behavior to header-only files and preserves pre-existing user-only history.
- `src/agents/pi-embedded-runner/session-manager-init.test.ts`
  - Regression tests for preservation and header-only reset behavior.
- `src/config/sessions/transcript.ts`
  - Relies on this behavior when preparing append paths.

Rebase notes:

- If upstream changes `SessionManager` bootstrap semantics, verify that user-only history is still preserved before removing this seam.
- This seam exists because `SessionManager` has persistence quirks; if those quirks disappear upstream, delete this seam and update this file.

Required invariants after rebase:

- Reopening a transcript with user-only messages does not truncate those messages.
- The first assistant append after a header-only file does not create a duplicate header row.

### 7. Canonical session-store key seam

Status: implemented

Why this exists:

- Mixed-case session keys could create duplicate logical store entries pointing at the same session.
- That creates nasty fork-only bugs in transcript resolution and session metadata updates.

Behavior added by this fork:

- Store writes resolve through the normalized canonical key.
- Legacy mixed-case keys are cleaned up as part of persistence.

Primary file:

- `src/config/sessions/session-file.ts`

Files touched by this seam:

- `src/config/sessions/session-file.ts`
  - Persists session-file updates through normalized store entry resolution.
- `src/config/sessions/store.ts`
  - Provides normalized key resolution primitives used by the seam.
- `src/config/sessions/sessions.test.ts`
  - Contains coverage around normalized persistence behavior.

Rebase notes:

- If upstream changes session-store layout, keep the normalization step centralized.
- Do not reintroduce direct writes against raw incoming `sessionKey` values.

Required invariants after rebase:

- Store updates for a session land under the canonical normalized key.
- Mixed-case legacy keys do not survive once the entry is rewritten.

### 8. Store lock timeout accounting seam

Status: implemented

Why this exists:

- Queue wait time used to escape the effective timeout budget, which could cause misleadingly long waits under contention.
- The fork requires total timeout to include both waiting and lock hold time.

Behavior added by this fork:

- `withSessionStoreLock` computes its deadline when the task is queued, not after it starts executing.
- Timeout tests allow realistic timing ranges instead of brittle exact millisecond assertions.

Primary file:

- `src/config/sessions/store.ts`

Files touched by this seam:

- `src/config/sessions/store.ts`
  - Queue deadline and timeout accounting.
- `src/config/sessions/store.lock.test.ts`
  - Range-based regression coverage for timeout behavior.

Rebase notes:

- If upstream rewrites store locking, preserve the invariant that queue wait counts against timeout.
- Keep the tests contract-based; exact stopwatch equality is fake precision and future pain.

Required invariants after rebase:

- A waiter can time out before acquiring the store lock if the queue already consumed its timeout budget.
- Lock timeout tests remain range-based, not exact-time brittle.

### 9. Android repeatable APK build seam

Status: implemented

Why this exists:

- The fork needs a boring, repeatable way to build Android debug APKs and signed sideload release APKs without remembering flavor-specific Gradle incantations.
- The existing repo scripts covered direct assemble/install tasks and signed AAB release bundles, but not a stable APK-oriented workflow for local device install and distribution.

Behavior added by this fork:

- A dedicated Android APK build script auto-detects the Android SDK path, runs the right Gradle assemble task for debug or release, copies the resulting APK into a stable output directory, prints SHA-256 hashes, and verifies release signatures with `apksigner`.
- Root package scripts now expose the common APK flows directly.
- Android docs now point operators at the APK scripts and stable output paths instead of only the raw Gradle tasks.
- Current local operator config for Android remote pairing is `gateway.bind=loopback` with `gateway.tailscale.mode=serve`, using the MagicDNS Serve endpoint for Android setup-code/manual remote pairing.

Primary seam files:

- `apps/android/scripts/build-apk.ts`
- `apps/android/README.md`

Files touched by this seam:

- `apps/android/scripts/build-apk.ts`
  - Fork-local APK build helper for debug/release + play/third-party flows, SDK autodetection, stable artifact copy paths, hashing, and release signature verification.
- `package.json`
  - Adds root scripts for repeatable APK workflows.
- `apps/android/README.md`
  - Documents the APK-oriented build path and stable artifact locations.

Rebase notes:

- If upstream adds first-class APK build scripts with stable output contracts, delete this seam and collapse to the upstream workflow.
- Keep the script focused on operator ergonomics and artifact determinism; do not let release-version bump logic leak in from the AAB bundling script.
- Treat the Tailscale Serve Android remote-pairing setup as an operator runbook choice, not a repo-wide product default unless upstream adopts the same guidance.

Required invariants after rebase:

- `bun run android:apk:debug` still emits a stable debug APK artifact path.
- `bun run android:apk:release` still emits a signed sideloadable third-party release APK artifact path.
- Release APK verification still uses the installed Android build-tools `apksigner` rather than assuming trust.

## Plugin boundary note

This fork intentionally does not implement these seams as a plugin.

Reason:

- Current plugin/runtime surfaces can observe transcript events and modify message-write content, but they do not own transcript persistence, session-store mutation, or session write-lock ordering.
- Forcing these behaviors into a plugin would spread the seam across unsupported boundaries and make rebases worse.

If upstream ever adds a real plugin or SDK seam for transcript persistence policy, revisit this decision.

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

- Did upstream fix the underlying bug or add the missing guarantee?
- Did upstream move the ownership boundary to a better place?
- Did upstream add a public helper, event field, or contract we can adopt instead of carrying our own glue?
- Can part of the fork seam now be deleted instead of re-applied?

Default rule:

- prefer deleting or shrinking fork code when upstream now provides the behavior or a cleaner seam
- do not blindly re-apply the old fork shape if upstream made the same area better

### 2. Re-apply seams in dependency order

Replay or re-implement the fork seams in this order:

1. Discord shared realtime voice backend seam
2. session initialization protection seam
3. canonical session-store key seam
4. store lock timeout accounting seam
5. transcript append orchestration seam
6. transcript persistence guarantee seam
7. explicit transcript sequence seam

Why this order:

- the lower seams stabilize transcript and store behavior first
- append/persistence logic sits on top of those guarantees
- sequence and gateway consumer behavior should be reconciled last, once writer semantics are settled

### 3. Prefer seam migration over seam restoration

When upstream changed the same area:

- first try to move the fork behavior into the newest upstream seam
- only restore the old fork shape if no equivalent or better seam exists

Examples:

- if upstream adds a native persisted transcript update helper, replace the fork persistence helper with that instead of preserving custom verification glue by habit
- if upstream emits authoritative sequence numbers everywhere, remove fallback logic instead of dragging `transcript-message-seq.ts` forward forever
- if upstream fixes `SessionManager` behavior, remove forced user-only flush logic and preserve only the contract tests that still matter

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
- what touched files can be removed from this ledger because they are no longer fork-specific?

The fork should get smaller when upstream improves. If it only ever grows, that is not a fork strategy; that is a landfill.

## How to add new fork features cleanly

When adding a new fork-only behavior, optimize for a tiny ownership surface rather than a tiny diff.

### Rules for new fork work

- Start by identifying the narrowest real seam that already exists.
- If a plugin or SDK seam truly owns the behavior, use it.
- If not, create a small internal seam near the ownership boundary instead of scattering edits through consumers.
- Prefer one helper module plus a couple of imports over repeated inline logic in multiple files.
- Add contract tests for the seam, not just implementation-detail tests.
- Update this file in the same change that introduces the seam.

### Preferred fork design pattern

For new fork features, aim for this shape:

- one primary seam file
- one or two upstream-facing integration points
- one set of contract tests
- one ledger entry in this file

Avoid this shape:

- many unrelated files each carrying one fork condition
- consumers compensating for producer behavior in ad hoc ways
- duplicated fallback logic
- undocumented fork behavior living only in test names or commit history

### When to use a plugin seam

Use a plugin seam only if the plugin/runtime boundary actually owns the behavior.

Good plugin candidates:

- message transformation that is already exposed through hooks
- runtime observation or extension behavior already supported by plugin APIs
- channel/provider behaviors intentionally delegated to plugins

Bad plugin candidates:

- transcript file persistence policy
- session-store mutation semantics
- session write-lock ordering
- any behavior that currently depends on core-only `src/config/sessions/**` ownership

Do not invent a fake plugin seam just to make the diff look tidy.

### How to keep new fork code rebase-friendly

For every new fork feature:

- isolate the fork policy from the upstream mechanics
- keep fallback logic centralized
- keep public contracts additive where possible
- avoid changing more than one subsystem unless the feature truly crosses that boundary
- write down explicit removal conditions in this file

A good seam entry should make it obvious when upstream has made the seam obsolete.

### Required checklist for new fork features

Before landing a new fork-specific feature, make sure all of this is true:

- the owning seam is identified
- the feature is implemented through the smallest reasonable seam
- duplicate logic was extracted instead of copied
- contract tests exist
- `bex-fork.md` documents the feature, touched files, invariants, and verification commands
- the feature includes a note describing when it should be removed or simplified in favor of upstream

## Verification checklist after rebasing

Run these after any rebase that touches the files above:

1. `pnpm check`
2. `pnpm test -- src/config/sessions/sessions.test.ts src/agents/pi-embedded-runner/session-manager-init.test.ts src/sessions/transcript-events.test.ts src/gateway/sessions-history-http.test.ts src/gateway/session-message-events.test.ts`
3. `pnpm test`
4. `pnpm build`

Manual spot checks:

- Append a user-only message and confirm it lands on disk before any assistant reply.
- Trigger concurrent transcript appends and confirm live order matches file order.
- Confirm gateway and SSE consumers surface stable increasing `messageSeq` values.
- Confirm no duplicate session headers appear when the first assistant reply lands.

## How to extend this file

Whenever this fork adds or changes a behavior that is not meant to track upstream exactly, append a new seam entry with:

- status
- reason for divergence
- behavior added or changed
- primary seam file
- all touched files and why
- rebase notes, including when the seam should be removed or simplified
- required invariants after rebase
- exact verification commands
