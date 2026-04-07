# Rebase `bex-fork` onto upstream and reconcile fork seams

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `/home/bex/.agents/PLANS.md`. That file requires every ExecPlan to be fully self-contained, to remain executable by a novice who only has the working tree and this file, and to keep each milestone independently verifiable.

## Purpose / Big Picture

After this work, `bex-fork` will rebase cleanly onto current upstream `main`, the fork ledger in `bex-fork.md` will describe a smaller and more coherent set of seams, and the remaining fork behavior will sit on narrow, intentional boundaries instead of being dragged through upstream files by habit. The user-visible win is practical rather than glamorous: rebases become boring, fork-only behavior keeps working, duplicated upstream-equivalent code gets deleted, and the next rebase no longer requires an archeological dig through Discord voice, transcript persistence, and Control UI chat paths.

The proof is concrete. A contributor will be able to check out the rebased branch, run the seam-specific tests listed in this plan, and observe that each required invariant from `bex-fork.md` still holds. For seams where upstream now provides 90% to 95% of the behavior, the branch should prefer upstream implementation plus thin regression coverage over carrying a fork-shaped reimplementation forever.

## Progress

- [x] (2026-04-07 00:00Z) Read `bex-fork.md`, inventoried the explicit fork seams, and confirmed local `main` was rebased onto `upstream/main`.
- [x] (2026-04-07 00:00Z) Generated an upstream-only changelog for `bex-fork..upstream/main` and grouped it by seam and importance.
- [x] (2026-04-07 00:00Z) Built an initial and refined conflict-risk map against the fork seam files.
- [x] (2026-04-07 00:00Z) Created this ExecPlan at `plans/bex-fork-rebase-reconciliation.md`.
- [x] (2026-04-07 12:40Z) Created one dossier per fork seam comparing current fork behavior, upstream behavior, overlap commits, and a keep/shrink/delete recommendation under `plans/rebase-dossiers/`.
- [x] (2026-04-07 12:00Z) Wrote the first three seam dossiers: `plans/rebase-dossiers/explicit-transcript-sequence.md`, `plans/rebase-dossiers/discord-shared-realtime-voice-backend.md`, and `plans/rebase-dossiers/control-ui-talk-read-aloud.md`.
- [x] (2026-04-07 12:25Z) Wrote the next four seam dossiers: `plans/rebase-dossiers/transcript-persistence-guarantee.md`, `plans/rebase-dossiers/session-initialization-protection.md`, `plans/rebase-dossiers/canonical-session-store-key-normalization.md`, and `plans/rebase-dossiers/store-lock-timeout-accounting.md`.
- [x] (2026-04-07 12:40Z) Wrote the final two seam dossiers: `plans/rebase-dossiers/discord-native-voice-bubble-auto-tts.md` and `plans/rebase-dossiers/android-repeatable-apk-build-helpers.md`.
- [x] (2026-04-07 15:00Z) Reconciled the highest-risk runtime seam by moving `src/gateway/sessions-history-http.ts` onto upstream-style snapshot/SSE state via new `src/gateway/session-history-state.ts`, while preserving explicit `messageSeq` handling through the fork helper.
- [ ] Reconcile the Discord shared realtime voice backend seam and shrink it to transport and policy seams only.
- [x] (2026-04-07 15:35Z) Took the first concrete Discord shrink step by adopting an upstream-shaped DAVE receive-recovery helper in `extensions/discord/src/voice/receive-recovery.ts` and moving passthrough/rejoin accounting out of `extensions/discord/src/voice/manager.ts`.
- [x] (2026-04-07 15:52Z) Took the next Discord shrink step by adopting an upstream-shaped capture-state helper in `extensions/discord/src/voice/capture-state.ts` and moving speaker capture generations, finalize timing, and stream teardown out of `extensions/discord/src/voice/manager.ts`.
- [x] (2026-04-07 16:08Z) Took the next Discord shrink step by adopting upstream-shaped `prompt.ts` and `sanitize.ts`, wiring both legacy ingress and realtime replay-history user text through the upstream prompt shape, and sanitizing Discord TTS text before synthesis.
- [x] (2026-04-07 15:00Z) Reconciled the session persistence seam cluster while keeping the remaining correctness deltas narrow: `src/config/sessions/transcript-append-seam.ts` now resolves canonical store entries before append prep and always routes through `prepareSessionManagerForRun()`, while the existing tiny fixes in `session-manager-init.ts`, `session-file.ts`, and `store.ts` remain the live preserved seams.
- [x] Reconcile user-surface seams: Discord native voice-bubble auto-TTS, Control UI Talk read-aloud, and Android repeatable APK build helpers.
- [x] (2026-04-07 16:29Z) Audited the Discord native auto-TTS seam and confirmed it remains a deliberate two-file preserve seam; removed the stale ledger reference to the deleted `src/plugins/contracts/tts.contract.test.ts` file.
- [x] (2026-04-07 16:34Z) Tightened the Control UI Talk seam by routing `ui/src/ui/chat/grouped-render.ts` back through the upstream `speech.ts` surface, keeping `talk-tts.ts` as the hidden gateway Talk seam, and adding a focused `grouped-render` regression test.
- [x] (2026-04-07 16:36Z) Cleaned the Android APK helper seam by removing dead variant metadata from `apps/android/scripts/build-apk.ts` and re-verifying the operator-facing script usage output.
- [x] (2026-04-07 17:26Z) Re-ran seam-focused validation and landing gates, fixed the stale Control UI context-notice browser test drift in `ui/src/ui/views/chat.ts` plus `ui/src/ui/views/chat.browser.test.ts`, and updated `bex-fork.md` so the seam inventory matches the shrunken code instead of historical fanfic.

## Surprises & Discoveries

- Observation: the highest-risk fork area is not the seam with the most files; it is the seam where upstream changed the ownership boundary underneath the fork.
  Evidence: upstream-only overlap is heaviest around `src/gateway/sessions-history-http.ts`, `src/gateway/server.impl.ts`, Discord voice manager files, and `ui/src/ui/app-render.ts`, all of which are coordinator or boundary files rather than isolated helpers.

- Observation: the explicit transcript sequence seam now overlaps upstream fixes for seq-based cursor pagination, single-snapshot Server-Sent Events refresh, and transcript history sanitization.
  Evidence: upstream-only commits include `aaf5307638` (`fix(gateway): seq-based cursor pagination + sanitize SSE fast path`), `d519f39c6e` (`fix(gateway): eliminate SSE history double-read race`), `9e0d632928` (`fix(gateway): unify session history snapshots`), and `3d9c6affce` (`gateway: fix bounded SSE sanitization and rawTranscriptSeq init`).

- Observation: the Control UI read-aloud seam now has likely upstream overlap rather than just adjacent churn.
  Evidence: upstream-only commit `9aaa000da0` is `fix(gateway): show /tts audio in Control UI webchat`, and `ui/src/ui/app-render.ts` has nine upstream-only commits touching the same rendering path.

- Observation: upstream still does not have a dedicated gateway Talk playback seam for the Control UI.
  Evidence: `ui/src/ui/chat/talk-tts.ts` does not exist on `upstream/main`, while upstream `ui/src/ui/chat/speech.ts` still uses browser-native `speechSynthesis` for Text-to-Speech.

- Observation: upstream session-history state is much closer to the fork’s needs than the old codebase was, but the event contract still lacks writer-supplied `messageSeq`.
  Evidence: upstream added `src/gateway/session-history-state.ts` with `SessionHistorySseState`, but upstream `src/sessions/transcript-events.ts` still has no `messageSeq` field.

- Observation: the Discord shared realtime voice backend seam is dangerous because upstream changed Discord voice receive, recovery, and capability routing in the same window that the fork introduced a shared realtime backend.
  Evidence: upstream-only commits include `37e89b930f` (`fix(discord): restore voice receive path and reply playback`), `33cdb342cb` (`refactor(discord): split voice receive and capture helpers`), `dfa14001a4` (`fix: harden discord voice receive recovery`), and `b57372d665` (`refactor: route capability runtime through channel stores`).

- Observation: upstream still lacks the fork’s persisted-only transcript append contract.
  Evidence: `src/config/sessions/transcript-append-seam.ts` does not exist on `upstream/main`, and upstream `src/config/sessions/transcript.ts` still emits transcript updates immediately after `SessionManager.appendMessage()` instead of confirming message ids on disk first.

- Observation: the session initialization protection seam is still a live bug fix, not a style preference.
  Evidence: upstream `src/agents/pi-embedded-runner/session-manager-init.ts` still resets any pre-existing transcript with no assistant message, while the fork now resets only strictly header-only files and has dedicated regression coverage in `src/agents/pi-embedded-runner/session-manager-init.test.ts`.

- Observation: upstream already owns most of the canonical session-store key architecture, so this seam has become a narrow finish-the-last-10-percent fix.
  Evidence: upstream `src/config/sessions/store.ts` already provides `resolveSessionStoreEntry()` with `normalizedKey` and `legacyKeys`, but upstream `src/config/sessions/session-file.ts` still writes through the raw incoming `sessionKey` instead of the resolved canonical key.

- Observation: store lock timeout accounting remains a real correctness seam under contention.
  Evidence: upstream `src/config/sessions/store.ts` still stores `timeoutMs` on queued tasks, while the fork stores enqueue-time `deadlineMs` and adds queue-wait timeout coverage in `src/config/sessions/store.lock.test.ts`.

- Observation: the Discord native auto-TTS seam has already collapsed to a two-file delta, and the ledger still mentions one old test file that no longer exists.
  Evidence: the only live branch diff is `extensions/speech-core/src/tts.ts` plus `extensions/discord/src/monitor/reply-delivery.test.ts`, while `src/plugins/contracts/tts.contract.test.ts` is absent from the current tree.

- Observation: upstream still has the Discord voice send path but not the TTS-side classification needed to trigger it automatically.
  Evidence: upstream `extensions/speech-core/src/tts.ts` still omits `discord` from `OPUS_CHANNELS`, while upstream Discord delivery tests already cover generic `audioAsVoice` handling once that flag is present.

- Observation: generic `package.json` churn made the Android APK seam look scarier than it really is; once generic manifest churn is discounted, the seam is still annoying but not existential.
  Evidence: the refined risk map drops the Android seam from a false “very-high” panic to a medium-risk, mostly mechanical replay.

- Observation: upstream still lacks any first-class repeatable APK helper flow.
  Evidence: upstream has `android:bundle:release` backed by `apps/android/scripts/build-release-aab.ts`, but no `apps/android/scripts/build-apk.ts` and no root `android:apk:*` scripts.

- Observation: one clean Discord shrink point was available immediately even though the core shared realtime runtime is still fork-only.
  Evidence: upstream `extensions/discord/src/voice/receive-recovery.ts` encapsulates DAVE passthrough and decrypt-failure recovery, and the fork can adopt that helper without giving up the shared realtime runtime, replay-history overlay, or legacy-backend fallback seams.

- Observation: the next clean Discord shrink point was also transport-only.
  Evidence: upstream `extensions/discord/src/voice/capture-state.ts` encapsulates capture generations, finalize timers, and speaking-end teardown; the fork can adopt that helper while keeping realtime interrupt policy, replay-history overlay, and backend selection in the fork-owned seams.

- Observation: prompt/sanitize adoption is slightly more than file choreography because upstream also changes the speaker-labeled prompt shape.
  Evidence: upstream `extensions/discord/src/voice/prompt.ts` uses `Voice transcript from speaker "...":` instead of the fork's older `speaker: text` prefix; adopting it required updating both legacy ingress and realtime replay-history user entries so they stay aligned.

- Observation: the Control UI seam now shrinks cleanly if `grouped-render.ts` depends on the upstream `speech.ts` surface instead of importing `talk-tts.ts` directly.
  Evidence: current `ui/src/ui/chat/speech.ts` already re-exports Talk TTS helpers from `talk-tts.ts`, so switching `grouped-render.ts` back to `speech.ts` reduces the visible UI delta without giving up gateway `talk.speak` behavior.

- Observation: the Discord native auto-TTS seam is still boring in the best possible way.
  Evidence: after re-audit, the live behavior delta is still just `extensions/speech-core/src/tts.ts` plus `extensions/discord/src/monitor/reply-delivery.test.ts`; the old ledger mention of `src/plugins/contracts/tts.contract.test.ts` was stale history, not a real seam.

- Observation: the `oracle` tool returned no advisory output in this environment during planning, so this ExecPlan records the strategy directly instead of pretending the oracle handed us tablets from the mountain.
  Evidence: two oracle calls returned no content while the local analysis artifacts were produced successfully.

## Decision Log

- Decision: treat this work as a reconcile-and-shrink project, not a naive rebase replay.
  Rationale: the fork ledger explicitly prefers deleting or shrinking fork code when upstream now provides the behavior or a cleaner seam. Reapplying the old shape blindly would maximize future fork tax.
  Date/Author: 2026-04-07 / Sky

- Decision: evaluate every seam with a three-way outcome: delete, shrink, or preserve.
  Rationale: many seams are neither fully obsolete nor fully irreducible. A delete-or-keep binary would miss the common case where upstream now owns 80% to 95% of the responsibility and the fork should collapse to a much thinner adapter or regression test.
  Date/Author: 2026-04-07 / Sky

- Decision: study and reconcile seams in risk order, not in the order they appear in the ledger.
  Rationale: transcript sequencing and Discord shared realtime have the highest chance of semantic regressions and the highest upstream churn. Leaving them until late would cause repeated rediscovery of the same broken assumptions.
  Date/Author: 2026-04-07 / Sky

- Decision: when upstream appears to cover roughly 90% to 95% of a seam, default toward upstream plus thin regression coverage unless a required invariant in `bex-fork.md` would be weakened.
  Rationale: the purpose of the fork is behavior, not aesthetic attachment to local code. If upstream now owns the core behavior, keeping a fork-local duplicate usually makes the next rebase worse without giving the user anything useful in return.
  Date/Author: 2026-04-07 / Sky

- Decision: if parity remains ambiguous after direct code reading and targeted proof gathering, stop and ask Bex before deleting the seam.
  Rationale: the user explicitly asked for careful judgment rather than aggressive cleanup theater. Ambiguity is a decision boundary, not a cue to improvise.
  Date/Author: 2026-04-07 / Sky

## Outcomes & Retrospective

Initial outcome on 2026-04-07: the fork is not a random pile of local hacks. It already has a seam ledger, existing fork-specific ExecPlans, and a plausible path to a cleaner rebase. The bad news is that upstream moved heavily in the same areas that the fork touched, especially gateway session history, Discord voice, and Control UI chat plumbing. The good news is that this makes seam deletion or shrinkage genuinely possible, which is better than carrying perpetual fork-shaped copies.

Update after the first reconcile pass on 2026-04-07: the session persistence cluster is now narrower and the gateway session-history HTTP path no longer carries the older fork-local pagination/SSE implementation. `src/gateway/session-history-state.ts` was introduced from the upstream shape, and `src/gateway/sessions-history-http.ts` now delegates snapshot/SSE state there while still preserving the fork’s explicit `messageSeq` preference. On the persistence side, `src/config/sessions/transcript-append-seam.ts` now resolves canonical store entries through the upstream normalization primitive and always routes transcript append prep through `prepareSessionManagerForRun()`, so the header-only/user-history protection applies consistently.

Validation status after this pass: targeted diagnostics passed, targeted seam tests passed, `pnpm check` passed, and `pnpm build` passed. `pnpm test` still has many unrelated failures across agents, commands, plugins, and extensions outside the touched session/transcript files, so the full-suite result is not yet a meaningful landing signal for this seam cluster alone.

## Context and Orientation

A “fork seam” in this repository means a narrow local boundary where `bex-fork` intentionally carries behavior on top of upstream OpenClaw. The canonical seam list and required invariants live in `bex-fork.md`. That file is not advisory fluff. It is the fork contract. If this plan and the code diverge from `bex-fork.md`, the ledger must be updated immediately.

The current committed seams are:

- Discord native voice-bubble auto-TTS.
- Control UI Talk read-aloud via gateway Talk Text-to-Speech (TTS).

The current worktree-and-ledger seams that matter for this reconciliation are:

- Discord shared realtime voice backend and gateway protocol additions.
- Transcript persistence guarantee.
- Explicit transcript sequence.
- Session initialization protection.
- Canonical session-store key normalization.
- Store lock timeout accounting.
- Android repeatable APK build helpers.

This plan uses a few terms in precise ways.

A “coordinator file” is a file that ties many behaviors together, such as `src/gateway/server.impl.ts`, `src/gateway/sessions-history-http.ts`, `extensions/discord/src/voice/manager.ts`, or `ui/src/ui/app-render.ts`. Coordinator files are dangerous during rebases because upstream and fork changes are both likely to land there even when they care about different behavior.

A “delete” decision means removing the fork-local implementation and relying on upstream behavior, while preserving only the minimum regression coverage or documentation needed to keep the invariant honest.

A “shrink” decision means upstream now owns most of the behavior, but the fork still needs a smaller adapter, helper, or test seam to preserve a required invariant.

A “preserve” decision means upstream still does not meet the invariant and the fork seam remains necessary in roughly its current form, though it may still be refactored for clarity.

A “proof packet” for a seam means the exact evidence gathered before choosing delete, shrink, or preserve. Each packet must include four things: the fork invariant from `bex-fork.md`, the current upstream implementation path, the exact tests or manual scenarios that prove behavior, and the specific reason the fork code can be deleted, shrunk, or must remain.

### Current risk picture

The current risk picture, derived from direct path overlap and nearby upstream churn, is:

- Very high risk: explicit transcript sequence.
- High risk: Discord shared realtime voice backend, Control UI Talk read-aloud, session initialization protection, Discord native voice-bubble auto-TTS.
- Medium risk: transcript persistence guarantee, canonical session-store key normalization, store lock timeout accounting, Android repeatable APK build helpers.

The highest-value upstream changes to study first are the ones already known to overlap these seams.

For transcript and session history, inspect upstream commits around:

- `aaf5307638` `fix(gateway): seq-based cursor pagination + sanitize SSE fast path`
- `d519f39c6e` `fix(gateway): eliminate SSE history double-read race`
- `9e0d632928` `fix(gateway): unify session history snapshots`
- `c7c0550dc9` `fix: seed SSE history state from one snapshot`
- `3d9c6affce` `gateway: fix bounded SSE sanitization and rawTranscriptSeq init`
- `b04dd6d05c` `refactor: consolidate session history sanitization`

For Discord voice and TTS routing, inspect:

- `37e89b930f` `fix(discord): restore voice receive path and reply playback`
- `33cdb342cb` `refactor(discord): split voice receive and capture helpers`
- `dfa14001a4` `fix: harden discord voice receive recovery`
- `b57372d665` `refactor: route capability runtime through channel stores`
- `6b627d4707` `fix(discord): add batched reply mode`
- `a32a3e2331` `fix(discord): honor explicit reply tags in delivery`

For Control UI chat and read-aloud, inspect:

- `9aaa000da0` `fix(gateway): show /tts audio in Control UI webchat`
- the upstream-only churn in `ui/src/ui/app-render.ts`, `ui/src/ui/chat/grouped-render.ts`, and `ui/src/ui/views/chat.ts`

For session store helpers, inspect:

- `6bd6f4d27c` `refactor: dedupe shared lowercase helpers`

For Android build ergonomics, inspect current upstream `package.json`, Android scripts, and `apps/android/README.md` rather than overreacting to every manifest churn commit.

### Existing plan artifacts that must be respected

The repo already contains at least one fork-specific ExecPlan that matters to this reconciliation:

- `plans/realtime-voice-backend.md`

That plan explains the intended ownership boundaries for the shared realtime voice backend. Use it as historical context when reconciling the Discord shared realtime seam, but do not let it override newer upstream seams if upstream now owns the behavior more cleanly.

This plan is self-contained, but the following locally generated artifacts may be helpful during execution if they still exist in the working tree:

- `upstream-only-changelog-2026-04-07.md`
- `upstream-only-changelog-detailed-2026-04-07.md`
- `fork-seam-risk-report-2026-04-07-refined.md`

They are convenience inputs, not required truth sources. The code and `bex-fork.md` remain the ground truth.

## Plan of Work

The work begins with study, not editing. For each seam, create a small dossier under `plans/rebase-dossiers/` using the seam name as the file stem, for example `plans/rebase-dossiers/explicit-transcript-sequence.md`. Each dossier must restate the required invariant from `bex-fork.md`, list the exact fork files, list the exact upstream files and commits studied, and end with a recommendation of delete, shrink, or preserve. Do not change code until the dossier for that seam exists and contains a proof packet.

The highest-risk seam, explicit transcript sequence, should be studied first because it overlaps upstream work on session history snapshots, Server-Sent Events refresh, cursor pagination, and raw transcript sequence initialization. The goal is to determine whether upstream now provides authoritative sequence ordering end-to-end, whether the fork only needs a small normalization seam, or whether the explicit `messageSeq` preference still needs to remain fork-local. If upstream now guarantees authoritative sequence everywhere, delete the local fallback duplication and keep only a regression helper that normalizes the event shape. If upstream still has mixed authoritative and inferred sequence paths, preserve exactly one local helper and remove any duplicated fallback logic.

Next reconcile the Discord shared realtime voice backend seam. The study must separate transport mechanics from shared runtime ownership. Transport mechanics are Discord-specific concerns such as receive recovery, speaker context, playback queueing, and voice-channel lifecycle. Shared runtime ownership is the gateway realtime session lifecycle, transcript replay, prompt bootstrap, and tool execution policy. The goal is to move the fork toward a thinner transport adapter that plugs into the best current upstream runtime and plugin-SDK seams. If upstream now owns capability routing, receive/capture helper split, or recovery behavior more cleanly, delete those parts from the fork and keep the fork only where it adds shared realtime behavior that upstream still lacks.

After the Discord runtime work, reconcile the session persistence seams as one cluster rather than as isolated trivia. Session initialization protection, canonical session-store key normalization, store lock timeout accounting, and transcript persistence guarantee all sit in `src/config/sessions/` and can interfere with each other if treated as separate drive-by edits. Study the current upstream session manager bootstrap, transcript append path, store locking, and normalization helpers together. The implementation goal is to preserve the behavioral invariants while reducing the number of fork-owned entry points. For example, if upstream now has a stronger session history sanitization or snapshot helper, route the persistence guarantee seam through that helper instead of preserving older direct `SessionManager` assumptions.

Then reconcile the user-facing seams. For Discord native voice-bubble auto-TTS, determine whether upstream now has a cleaner capability or channel-delivery seam than the fork’s hard-coded channel eligibility list. If so, shrink the fork to that seam and keep only regression coverage that proves Discord still uses native voice bubbles for compatible Opus payloads. For Control UI Talk read-aloud, inspect whether upstream’s `/tts` webchat support now covers playback plumbing and UI affordance well enough that the fork only needs a thinner gateway `talk.speak` adapter or can delete the seam entirely. For the Android APK build helper, keep the focus ruthlessly narrow: stable debug and signed sideload release APK outputs, root scripts that call the helper, and documentation that points operators to predictable artifact paths.

After each seam cluster is reconciled, update `bex-fork.md` immediately. If a seam was deleted, remove it from the ledger or rewrite it as a regression note. If a seam was shrunk, rewrite the primary seam file list and the required invariants so the ledger matches reality. If a seam was preserved, update the ledger to reflect the newer upstream boundary it now sits on.

## Deletion, Shrink, and Preserve Framework

For every seam, answer these questions in writing before touching code.

First, what exact user-visible or operator-visible behavior does the seam guarantee? Copy the invariant from `bex-fork.md` verbatim and translate it into a human test scenario.

Second, where does current upstream own the same behavior now? Name the precise files and functions. A guess like “somewhere in gateway history code” is worthless.

Third, what is the remaining delta between upstream and the fork? Classify the delta as one of four kinds: no delta, cosmetic delta, boundary delta, or behavioral delta.

A “no delta” means upstream already satisfies the invariant. Delete the seam and keep only regression coverage if that coverage still adds value.

A “cosmetic delta” means upstream differs in shape or naming but not in behavior. Delete the seam unless carrying a tiny adapter buys a much cleaner call site.

A “boundary delta” means upstream owns the core behavior but not at the clean integration point the fork wants. Shrink the seam to the smallest adapter that preserves the invariant while embracing upstream ownership.

A “behavioral delta” means upstream still fails the invariant or only partially satisfies it under specific conditions such as concurrent transcript writes, Discord receive recovery, or Control UI playback fallback. Preserve the seam, but refactor it so the local code depends on the newest upstream helper or boundary rather than replaying the old fork shape.

Use the following deletion threshold. If upstream provides 90% to 95% of the behavior and the remaining 5% to 10% is either test-only, naming-only, or expressible as a small adapter with no duplicate business logic, delete the old seam implementation and embrace upstream. If the missing 5% to 10% weakens an invariant in `bex-fork.md`, do not silently delete it; either shrink to a tiny adapter or stop and ask Bex.

Warning signs that upstream is only “close enough” in a dangerous way include:

- upstream passes the happy path but loses ordering, durability, or recovery behavior under retries, concurrent writes, or reconnects;
- upstream preserves visible output but changes the trust or authorization boundary underneath it;
- upstream now emits similar events but with weaker guarantees about sequence, persistence, or source-of-truth ordering;
- upstream plays audio or renders UI affordances but no longer routes through the intended gateway/provider path;
- upstream moved the code into a coordinator file while the fork invariant still needs an isolated seam.

## Milestones

### Milestone 1: Build seam dossiers and proof packets

At the end of this milestone, every fork seam will have a dossier file under `plans/rebase-dossiers/` that a novice can read to understand the fork invariant, the current upstream implementation, the overlapping upstream commits, and the delete/shrink/preserve recommendation. No seam may be reconciled before its dossier exists.

The work is to create the dossier directory, write one file per seam, read the current upstream and fork files in full, and record the proof packet for each. Acceptance is simple and observable: all dossier files exist, each includes exact file paths and test commands, and each ends with a recommendation plus the specific open question, if any, that would require asking Bex before deletion.

### Milestone 2: Reconcile transcript ordering and session-history semantics

At the end of this milestone, the fork will have a settled story for explicit transcript sequence, session history snapshots, and Server-Sent Events ordering. A novice should be able to run the listed transcript and gateway tests and see stable, deterministic sequence behavior. This milestone must leave exactly one place where fallback ordering policy lives, or none if upstream now owns authoritative sequence everywhere.

The work is to study and then reconcile `src/sessions/transcript-events.ts`, `src/sessions/transcript-message-seq.ts`, `src/config/sessions/transcript.ts`, `src/gateway/server.impl.ts`, and `src/gateway/sessions-history-http.ts` against the upstream session history fixes listed earlier. Acceptance is passing targeted tests and a clear ledger update that states whether the seam was deleted, shrunk, or preserved.

### Milestone 3: Reconcile Discord shared realtime runtime and native voice delivery

At the end of this milestone, Discord voice will use the cleanest available upstream transport and capability seams, while the fork carries only the remaining shared realtime behavior and native voice-bubble routing that upstream still lacks. A novice should be able to run the Discord voice tests and observe that the shared realtime path and native Opus voice-bubble delivery still work without reintroducing transport logic into the runtime core.

The work is to study and then reconcile `extensions/discord/src/voice/manager.ts`, `extensions/discord/src/voice/realtime-runtime.ts`, `extensions/discord/src/voice/audio-processing.ts`, `extensions/discord/src/voice/speaker-context.ts`, `extensions/discord/src/voice/legacy-reply.ts`, `extensions/speech-core/src/tts.ts`, and the related tests. Acceptance is targeted Discord voice and reply-delivery coverage plus an updated ledger that reflects the thinner seam boundary.

### Milestone 4: Reconcile session persistence and initialization guarantees

At the end of this milestone, transcript writes, session bootstrap, store key normalization, and store lock timeout accounting will rely on the smallest possible set of fork-owned helpers. A novice should be able to run the listed session and store tests and observe that user-only transcript writes persist immediately, transcript updates reflect persisted order, existing user-only history survives reinitialization, canonical keys are used for store writes, and queue wait time still counts against timeout budgets.

The work is to reconcile `src/agents/pi-embedded-runner/session-manager-init.ts`, `src/config/sessions/transcript-append-seam.ts`, `src/config/sessions/transcript.ts`, `src/config/sessions/session-file.ts`, `src/config/sessions/store.ts`, and the relevant tests. Acceptance is passing targeted tests plus a ledger update that records exactly which helpers remain fork-local.

### Milestone 5: Reconcile Control UI read-aloud and Android build ergonomics

At the end of this milestone, the Control UI will use the cleanest available upstream audio rendering path while preserving the requirement that read-aloud goes through gateway Talk Text-to-Speech rather than browser-native speech synthesis, and the Android build workflow will still expose stable APK-oriented scripts and artifact paths. A novice should be able to run the Control UI tests, inspect the Android scripts, and confirm that both seams are either thinner or fully deleted.

The work is to reconcile `ui/src/ui/chat/talk-tts.ts`, `ui/src/ui/chat/speech.ts`, `ui/src/ui/chat/grouped-render.ts`, `ui/src/ui/views/chat.ts`, `ui/src/ui/app-render.ts`, `apps/android/scripts/build-apk.ts`, `apps/android/README.md`, and `package.json`. Acceptance is passing targeted UI and Android script validation and a final ledger update for both seams.

### Milestone 6: Land the rebased fork and prove it

At the end of this milestone, the rebased branch will have a coherent seam ledger, targeted seam-specific coverage, and a passing repository landing gate. The proof is the complete validation run plus the updated `bex-fork.md` and this ExecPlan, both of which must describe the final state honestly.

The work is to re-run targeted seam tests, run the repo landing gate, update this plan’s retrospective, and update `bex-fork.md`. Acceptance is passing validation and a final written summary of which seams were deleted, shrunk, or preserved and why.

## Concrete Steps

All commands below assume the working directory is the repository root:

    cd /home/bex/projects/openclaw

Before reconciling any seam, generate or refresh the local comparison context:

    git fetch upstream --prune
    git log --no-merges --reverse --date=short --pretty=format:'%H %ad %s' bex-fork..upstream/main > /tmp/upstream-only.log
    git diff --stat --find-renames upstream/main...bex-fork > /tmp/bex-fork-vs-upstream.stat

For each seam dossier, inspect both fork and upstream state directly. Example commands for the explicit transcript sequence seam:

    git log --oneline -- src/gateway/sessions-history-http.ts src/gateway/server.impl.ts src/sessions/transcript-events.ts src/config/sessions/transcript.ts
    git log upstream/main --oneline -- src/gateway/sessions-history-http.ts src/gateway/server.impl.ts src/sessions/transcript-events.ts src/config/sessions/transcript.ts
    git diff upstream/main...bex-fork -- src/gateway/sessions-history-http.ts src/gateway/server.impl.ts src/sessions/transcript-events.ts src/config/sessions/transcript.ts

Create the dossier file after that reading pass. The dossier should include the fork invariant, upstream files, overlapping commits, targeted tests, and the recommendation.

For Discord runtime and native voice delivery, use the same pattern against:

    extensions/discord/src/voice/manager.ts
    extensions/discord/src/voice/realtime-runtime.ts
    extensions/discord/src/voice/audio-processing.ts
    extensions/discord/src/voice/speaker-context.ts
    extensions/discord/src/voice/legacy-reply.ts
    extensions/speech-core/src/tts.ts
    extensions/discord/src/monitor/reply-delivery.test.ts

For session persistence seams, use the same pattern against:

    src/agents/pi-embedded-runner/session-manager-init.ts
    src/config/sessions/transcript-append-seam.ts
    src/config/sessions/transcript.ts
    src/config/sessions/session-file.ts
    src/config/sessions/store.ts
    src/config/sessions/sessions.test.ts
    src/config/sessions/store.lock.test.ts

For Control UI read-aloud and Android build helpers, use the same pattern against:

    ui/src/ui/chat/talk-tts.ts
    ui/src/ui/chat/speech.ts
    ui/src/ui/chat/grouped-render.ts
    ui/src/ui/views/chat.ts
    ui/src/ui/app-render.ts
    apps/android/scripts/build-apk.ts
    apps/android/README.md
    package.json

As code changes begin, keep the verification loop narrow and truthful. Run the most direct tests after each seam lands, then the broader repo gate near the end. Start with file-specific or seam-specific tests, for example:

    pnpm test src/sessions/transcript-events.test.ts
    pnpm test src/config/sessions/sessions.test.ts src/config/sessions/store.lock.test.ts
    pnpm test extensions/discord/src/voice/manager.e2e.test.ts extensions/discord/src/monitor/reply-delivery.test.ts
    pnpm test ui/src/ui/chat/speech.test.ts

Once the seam clusters are reconciled, run the repo landing gate in this order:

    pnpm check
    pnpm test
    pnpm build

If the touched surface includes build output, lazy-loading boundaries, or published plugin-SDK surfaces, `pnpm build` is mandatory before calling the rebase done.

As work proceeds, replace these generic commands with the exact commands and observed results that were actually used.

## Validation and Acceptance

A seam is only accepted when three things are true.

First, the updated code passes the direct tests for that seam. The relevant tests are named in the milestone and dossier sections.

Second, the behavior can be described as an observable scenario that a human could believe. Examples include: a user-only transcript append is present on disk immediately rather than after a later assistant message; a Discord-compatible Opus auto-TTS reply is sent as a native voice bubble instead of text plus attachment fallback; the Control UI read-aloud affordance routes through gateway Talk Text-to-Speech rather than browser-native speech synthesis; a queued session-store waiter times out based on total waiting plus lock-hold time instead of only in-lock time.

Third, `bex-fork.md` and this ExecPlan both reflect the actual result. If the code says a seam was deleted but the ledger still describes it as active, the work is not done.

The final acceptance for the whole plan is:

- the rebased branch passes `pnpm check`, `pnpm test`, and `pnpm build`;
- every seam in `bex-fork.md` is explicitly marked deleted, shrunk, or preserved;
- every delete decision has a proof packet showing why upstream parity is good enough;
- every preserved seam sits on the newest upstream boundary rather than on a replayed historical fork shape.

## Idempotence and Recovery

This plan is safe to execute incrementally. The study phase is read-only except for dossier files and plan updates. Re-reading files, regenerating local logs, and re-running targeted tests are all safe.

When reconciling code, keep changes seam-scoped. Do not combine Discord runtime work, transcript persistence work, and Android script cleanup into one heroic diff. Small seam-scoped commits make it possible to re-run just the relevant tests and to recover if one seam turns out to depend on a mistaken assumption.

If a delete decision later proves wrong, recover by reverting only that seam’s commit, not the entire rebase. This is another reason to keep each seam or seam cluster in its own commit and to update `bex-fork.md` at the same time as the code.

If upstream parity remains ambiguous after code reading and targeted proof gathering, stop before deleting the seam and ask Bex. The safe fallback is to preserve the seam temporarily and document the unresolved question in the dossier rather than gambling on silent behavior loss.

## Artifacts and Notes

Helpful local artifacts from the planning pass included:

    upstream-only-changelog-2026-04-07.md
    upstream-only-changelog-detailed-2026-04-07.md
    fork-seam-risk-report-2026-04-07-refined.md

Important upstream commits to study early:

    aaf5307638  fix(gateway): seq-based cursor pagination + sanitize SSE fast path
    d519f39c6e  fix(gateway): eliminate SSE history double-read race
    9e0d632928  fix(gateway): unify session history snapshots
    3d9c6affce  gateway: fix bounded SSE sanitization and rawTranscriptSeq init
    37e89b930f  fix(discord): restore voice receive path and reply playback
    33cdb342cb  refactor(discord): split voice receive and capture helpers
    dfa14001a4  fix: harden discord voice receive recovery
    9aaa000da0  fix(gateway): show /tts audio in Control UI webchat
    6bd6f4d27c  refactor: dedupe shared lowercase helpers

A seam dossier should end with a short result block like this:

    Result: shrink
    Why: upstream now owns the coordinator logic, but the fork still needs one narrow adapter to preserve persisted-before-event ordering.
    Proof: targeted tests X and Y pass; upstream path Z preserves ordering under the manual scenario described above.
    Open question: none

When this ExecPlan changes, add a note at the bottom describing the revision and the reason.

Revision note on 2026-04-07 by Sky: created the initial rebase reconciliation ExecPlan after studying `bex-fork.md`, generating upstream-only changelog artifacts, and building a refined fork seam conflict-risk map.

## Interfaces and Dependencies

The reconciliation work must use existing repository seams and must not introduce new dependencies without explicit approval.

The main interfaces and modules that matter at the end of this plan are:

- `src/gateway/sessions-history-http.ts` and `src/gateway/server.impl.ts` for transcript and session-history event delivery.
- `src/sessions/transcript-events.ts` and `src/sessions/transcript-message-seq.ts` for explicit transcript sequence policy.
- `src/config/sessions/transcript-append-seam.ts`, `src/config/sessions/transcript.ts`, `src/config/sessions/session-file.ts`, and `src/config/sessions/store.ts` for persistence, key normalization, and lock accounting.
- `src/agents/pi-embedded-runner/session-manager-init.ts` for session initialization protection.
- `src/gateway/realtime-audio/*`, `src/plugin-sdk/gateway-runtime.ts`, and `extensions/discord/src/voice/*` for the shared realtime backend and Discord transport boundaries.
- `extensions/speech-core/src/tts.ts` and `extensions/discord/src/monitor/reply-delivery.test.ts` for native voice-bubble delivery.
- `ui/src/ui/chat/talk-tts.ts`, `ui/src/ui/chat/speech.ts`, `ui/src/ui/chat/grouped-render.ts`, `ui/src/ui/views/chat.ts`, and `ui/src/ui/app-render.ts` for Control UI read-aloud.
- `apps/android/scripts/build-apk.ts`, `apps/android/README.md`, and `package.json` for the Android APK build seam.

At the end of the plan, there must be a clear answer for each seam stating whether the authoritative implementation is upstream, fork-local, or shared through a thinner adapter. If the answer is “shared through a thinner adapter,” the adapter must live at the narrowest ownership boundary available and the ledger must name it explicitly.
