# Shared realtime voice backend for desktop and Discord

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `/home/bex/.agents/PLANS.md`. That file requires every ExecPlan to be fully self-contained, to remain executable by a novice who only has the working tree and this file, and to keep each milestone independently verifiable.

## Purpose / Big Picture

After this change, OpenClaw will have one shared realtime voice backend that can power both a future desktop Tauri app and existing Discord voice channels. A user will be able to speak to OpenClaw with low latency, hear audio back without waiting for the old `STT -> chat.send -> talk.speak` loop, interrupt the assistant while it is speaking, and let the realtime session use the normal OpenClaw tool surface including direct shell access, file reads and writes, and web tools. The first provider target is OpenAI `gpt-realtime-1.5`. The design must also make it straightforward to add a Google Live adapter later without changing transport code.

The user-visible proof is concrete. On desktop, a Tauri app will connect to the gateway over WebRTC for audio and the gateway websocket for control, stream microphone audio into a realtime session, receive partial transcripts and spoken answers, and allow the voice session to run shell commands and small file edits under the existing OpenClaw trust model. In Discord, OpenClaw will join a voice channel, route voice audio through the same shared backend, and preserve existing owner and allowlist policy. The legacy voice path must remain available as a fallback so the feature remains useful if the realtime provider or transport fails.

## Progress

- [x] (2026-04-02 00:00Z) Researched the current macOS talk path, browser speech path, Discord voice path, exec approvals model, ACP/ACPX boundaries, gateway protocol rules, and voice-call realtime building blocks.
- [x] (2026-04-02 00:00Z) Resolved the initial architecture direction: one shared realtime session core, OpenAI `gpt-realtime-1.5` as the first provider target, Google Live as a future adapter, and direct `exec` support in the default realtime tool profile.
- [x] (2026-04-02 00:00Z) Created this ExecPlan artifact at `plans/realtime-voice-backend.md`.
- [x] Implement Milestone 1: define the typed gateway realtime session protocol and shared `RealtimeConversationSession` core.
- [x] Implement Milestone 2: add provider adapters with OpenAI first and a Google-ready boundary.
- [x] Implement Milestone 3: wire the realtime tool profile to allow `web_search`, `web_fetch`, `read`, `write`, and `exec` with existing OpenClaw trust and approval semantics.
- [x] Implement Milestone 4: integrate Discord voice with the shared realtime core while preserving owner and allowlist policy.
- [x] Harden Discord realtime integration with end-to-end smoke coverage and operator proof.
- [x] Implement the gateway-side desktop transport/WebRTC signaling seam to a clean branch handoff point.
- [x] Retain and verify the `STT -> agent -> TTS` backend as a first-class peer backend for Discord while adding realtime as an explicit alternative.
- [ ] Run the full validation gate, demonstrate the new behavior end to end, and update this ExecPlan with implementation discoveries and retrospective notes.

## Surprises & Discoveries

- Observation: the current macOS talk mode is not true speech-to-speech. It performs local speech recognition with Apple APIs, then sends text through `chat.send`, then fetches assistant text and synthesizes audio afterwards.
  Evidence: `apps/macos/Sources/OpenClaw/TalkModeRuntime.swift` sends via `GatewayConnection.shared.chatSend(...)`, waits for assistant text, then calls `playAssistant(...)`.

- Observation: the browser control UI also does not have a true shared realtime backend. Browser speech recognition is local to the browser, while TTS relies on `talk.speak` returning `audioBase64`.
  Evidence: `ui/src/ui/chat/speech.ts` documents “Browser-native speech services: STT via SpeechRecognition” and calls `client.request<TalkSpeakResult>("talk.speak", { text: cleaned })`.

- Observation: the repository already has a real voice transport that behaves like a backend service rather than a UI gimmick. Discord voice transcribes audio, runs the normal agent ingress, and synthesizes speech back to the channel.
  Evidence: `extensions/discord/src/voice/manager.ts` calls `transcribeAudio(...)`, then `agentCommandFromIngress(...)`, then `textToSpeech(...)`.

- Observation: the voice-call plugin already proves OpenAI realtime streaming pieces exist in this repository. It has an OpenAI realtime transcription session, server-side voice activity detection, partial transcript callbacks, and audio conversion helpers.
  Evidence: `extensions/voice-call/src/providers/stt-openai-realtime.ts` sends `transcription_session.update` with `input_audio_format: "g711_ulaw"` and `turn_detection: { type: "server_vad" }`. `extensions/voice-call/src/media-stream.ts` forwards media packets to the realtime STT session.

- Observation: OpenClaw already has a host execution trust model instead of raw unguarded process spawning. If the realtime layer gets `exec`, it should reuse that model rather than invent a second approvals system.
  Evidence: `docs/tools/exec-approvals.md` describes execution-host approvals, allowlists, ask behavior, and fallback behavior when the UI is unavailable.

- Observation: this repository explicitly treats broad non-interactive ACPX permissions as dangerous. That precedent matters because the realtime layer will also be a high-trust capability surface.
  Evidence: `src/security/dangerous-config-flags.ts` includes `plugins.entries.acpx.config.permissionMode=approve-all` in the dangerous flag list.

- Observation: the Discord plugin cannot safely import the shared realtime core directly, so the migration required a Plugin SDK facade rather than a drive-by deep import into `src/gateway/**`.
  Evidence: `src/plugin-sdk/AGENTS.md` requires purpose-built public seams, and the implementation now exposes the managed runtime through `src/plugin-sdk/gateway-runtime.ts`.

- Observation: OpenAI's current Realtime GA event names are annoyingly transitional. The docs describe GA names like `response.output_audio.delta`, but compatibility with older `response.audio.delta` style events is still useful in practice.
  Evidence: `src/gateway/realtime-audio/providers/openai.ts` now accepts both `response.output_audio.delta` / `response.output_audio.done` and the older `response.audio.delta` / `response.audio.done` names.

- Observation: the separate `STT -> agent -> TTS` voice pipeline should be treated as a first-class backend, not as dead weight waiting to be deleted.
  Evidence: Discord voice config now has an explicit `voice.backend` selector with `"stt-agent-tts"` as the default, documented in `src/config/types.discord.ts` and `docs/channels/discord.md`.

## Decision Log

- Decision: build one shared gateway-side realtime session core instead of separate desktop and Discord voice stacks.
  Rationale: Discord voice and desktop voice differ in transport, not in the underlying conversation lifecycle. A shared core avoids duplicate logic for interruption, provider integration, tool calls, and fallback.
  Date/Author: 2026-04-02 / Sky

- Decision: target OpenAI `gpt-realtime-1.5` first.
  Rationale: this is the desired primary target, and OpenClaw already contains OpenAI realtime speech plumbing that can be adapted more cheaply than starting from zero.
  Date/Author: 2026-04-02 / Sky

- Decision: design the provider boundary so a Google Live adapter can be added later without changing transport code.
  Rationale: the user explicitly wants Google compatibility later. Provider-specific event shapes must not leak into Discord or desktop transports.
  Date/Author: 2026-04-02 / Sky

- Decision: the default realtime tool profile includes real `exec`, `read`, and `write`, not wrapper tools.
  Rationale: the operator explicitly wants shell access and direct small config edits from the voice session.
  Date/Author: 2026-04-02 / Sky

- Decision: direct shell access in the realtime layer must still run inside the existing OpenClaw trust model.
  Rationale: the repository already has owner semantics, exec approvals, and explicit dangerous-mode posture. Reusing those rules is safer and more consistent than inventing a parallel execution policy just for voice.
  Date/Author: 2026-04-02 / Sky

- Decision: ACP and ACPX remain optional future delegation seams rather than a required part of the first realtime release.
  Rationale: the initial goal is direct conversational shell and config actions. Requiring ACP delegation from day one would increase complexity without proving the core realtime path.
  Date/Author: 2026-04-02 / Sky

- Decision: keep the legacy `STT -> agent -> TTS` path as an explicit fallback.
  Rationale: a realtime backend should add capability, not delete the only robust voice path already working in the repo.
  Date/Author: 2026-04-02 / Sky

## Outcomes & Retrospective

This section will be updated at the end of each major milestone and at completion.

Initial outcome on 2026-04-02: the design work converged on a practical architecture instead of a vague product aspiration. The repository already contains enough voice, transport, and approval primitives to make this tractable. The biggest remaining risks are choosing the exact server-side WebRTC stack, expressing realtime provider events behind a stable internal interface, and making direct voice-triggered shell execution feel safe and predictable under existing OpenClaw policy.

Milestone 1 outcome on 2026-04-02: the repo now has an additive realtime gateway control-plane contract (`realtime.session.create`, `realtime.session.interrupt`, `realtime.session.close`, and `realtime.session` events), plus a deterministic in-memory `RealtimeConversationSession` skeleton under `src/gateway/realtime-audio/`. The protocol deliberately stops short of SDP, ICE, or raw audio payload commitments so Milestones 2 through 5 can choose the right media plumbing without dragging a premature wire contract behind them like a dead Victorian wedding dress.

Milestone 2 outcome on 2026-04-02: the provider seam is now real rather than aspirational. `src/gateway/realtime-audio/providers/openai.ts` resolves OpenAI auth through the existing provider-auth path, opens a realtime WebSocket, emits normalized transcript and assistant-turn events, and carries interrupt through `response.cancel`. `src/gateway/realtime-audio/providers/google-live.ts` exists as a deterministic stub so the boundary is compile- and test-enforced from day one. The session core now binds provider lifecycle on start, interrupt, and close.

Milestone 3 outcome on 2026-04-02: the shared realtime session can now expose the normal OpenClaw tool surface rather than a fake toy subset. `src/gateway/realtime-audio/tool-runtime.ts` wraps the existing coding tools, normalizes queued/running/approval/completed/failed states, and the OpenAI adapter now round-trips provider-requested function calls through `function_call_output` responses. This keeps `exec`, `read`, `write`, `web_search`, and `web_fetch` inside the existing OpenClaw trust and approval model instead of creating a second cursed execution policy.

Milestone 4 outcome on 2026-04-02: Discord voice now uses the shared backend through a boundary-safe managed runtime facade instead of reaching directly into gateway internals. The Discord transport still owns speaker identity, owner resolution, allowlist checks, playback queueing, and receive-error recovery, but the conversation loop is no longer Discord-only. A new `voice.backend` selector lets Discord choose between realtime and the separate `stt-agent-tts` backend explicitly.

Milestone 6 outcome on 2026-04-02: the `STT -> agent -> TTS` path remains alive as a peer backend, not a deprecated fallback shame corner. Discord defaults to `stt-agent-tts`, while `realtime` is opt-in through `channels.discord.voice.backend`. The docs and generated config metadata now describe both modes neutrally so operators can choose based on latency, provider capability, and operational comfort.

Current execution cut on 2026-04-02: finish Discord all the way to believable smoke validation, then stop desktop work at the gateway-side transport boundary. That means additive realtime protocol and session support for input plus WebRTC signaling, but not a full desktop app scaffold on this branch. The desktop client can then move to a separate branch without dragging half-finished gateway contract churn behind it.

Discord hardening outcome on 2026-04-02: realtime voice now degrades back to the legacy `stt-agent-tts` path when realtime startup fails, input submission fails, or the session surfaces an error before producing a usable reply. The Discord manager test suite now includes a session-backed realtime smoke path that exercises the real shared session core rather than a pure hand-mocked runtime.

Gateway transport seam outcome on 2026-04-02: the typed realtime protocol now exposes session-scoped text input, audio input, audio output, and transport signaling shapes. `src/gateway/server-methods/realtime-audio.ts` now normalizes audio output for the wire, scopes events back to the creating gateway connection, and exposes a clean `transport.signal` handoff seam. The session core gained `submitText`, `submitAudio`, and transport-bridge hooks so the future desktop branch can attach a real WebRTC stack without reshaping Discord again.

## Context and Orientation

This repository already contains several voice and transport systems. A novice should understand them before making changes.

The current native macOS talk mode lives in `apps/macos/Sources/OpenClaw/TalkModeRuntime.swift`. In that file, a “talk mode” session means the app listens to the microphone using Apple speech recognition, finalizes text after silence, sends the text to the gateway with `chat.send`, waits for the assistant text to appear in chat history, and only then plays audio. That is not a realtime backend. It is a text round-trip with speech glued to each end.

The browser control UI lives under `ui/`. Its websocket transport is in `ui/src/ui/gateway.ts`, and browser speech helpers are in `ui/src/ui/chat/speech.ts`. That browser path is also not true realtime speech-to-speech. Browser speech recognition is local to the browser through `SpeechRecognition`, and TTS comes back through `talk.speak` as an audio blob.

Discord voice already behaves more like a backend. The implementation is in `extensions/discord/src/voice/manager.ts`. In plain language, that file receives voice audio from Discord, decodes it, turns it into a temporary audio file, sends it through OpenClaw transcription, then routes the resulting text into the normal OpenClaw agent ingress with `agentCommandFromIngress`, and finally synthesizes voice back into the channel. That existing path proves there is already a robust spoken “conversation backend” concept in this repository.

The voice-call plugin under `extensions/voice-call/` is another important orientation point. It contains realtime OpenAI speech pieces used for telephony. The files `extensions/voice-call/src/providers/stt-openai-realtime.ts`, `extensions/voice-call/src/media-stream.ts`, and `extensions/voice-call/src/telephony-audio.ts` show how this repository already handles realtime speech sessions, partial transcript callbacks, server-side voice activity detection, and audio format conversion. The current implementation is telephony-oriented, but the internal ideas are directly relevant.

The gateway wire contract lives under `src/gateway/protocol/`. A “wire contract” is the typed shape of messages sent between clients and the gateway. The repository rule in `src/gateway/protocol/AGENTS.md` is strict: protocol changes must be additive, typed, and kept in sync with validators and tests. Do not add freehand JSON payloads in random files.

Shell execution policy already exists in OpenClaw. The file `docs/tools/exec-approvals.md` explains that host execution is controlled on the execution host through allowlists, prompt policy, and fallback behavior. For this ExecPlan, “execution host” means the machine where the actual process is launched. For desktop voice, that will often be the gateway host or paired node host depending on runtime routing. For the new realtime backend, direct shell access means exposing the existing `exec` tool behavior to the realtime session, not bypassing those trust checks.

ACP and ACPX are external agent runtime systems that OpenClaw can bind to sessions. The relevant docs are `docs/tools/acp-agents.md` and `docs/cli/acp.md`. They are not required for the first version of this work, but they matter because the architecture must not block future delegation into persistent coding-agent sessions.

The repository currently does not contain a Tauri desktop app. The future desktop app will live in a new `apps/desktop` package and will need to be added to `pnpm-workspace.yaml`. The realtime backend in this ExecPlan must be designed so that the desktop app only needs to handle microphone capture, speaker playback, UI state, and gateway signaling, while the gateway owns provider integration and tool execution semantics.

The phrase “provider adapter” in this document means a small internal module that hides the details of one vendor’s realtime API behind a shared local interface. The phrase “transport adapter” means the code that connects one user-facing surface, such as Discord voice or desktop WebRTC, to the shared realtime session core. Those two concepts must remain separate.

## Plan of Work

The work starts in the gateway protocol layer. Add a new protocol schema file under `src/gateway/protocol/schema/` for realtime audio and conversation sessions. Define request and event shapes for creating a realtime session, negotiating desktop media transport, publishing transcript updates, reporting assistant audio state, delivering tool-call events and results, interrupting speech, and reporting fallback-mode transitions. Export the new schema through the existing protocol entrypoints and add validator coverage in the protocol test suite.

After the protocol exists, create a new gateway runtime area at `src/gateway/realtime-audio/`. This module is the shared backend core. It should define a `RealtimeConversationSession` type and a provider interface that can be implemented by OpenAI first and Google Live later. The session core must own conversation state, interruption, tool-call dispatch, and fallback transitions. It must not know whether its caller is Discord or desktop. It should only consume normalized audio and emit normalized events.

The OpenAI provider implementation should be the first concrete adapter and should live in `src/gateway/realtime-audio/providers/openai.ts`. Reuse the existing logic from `extensions/voice-call/src/providers/stt-openai-realtime.ts` where it actually helps, but do not couple the shared backend to telephony assumptions like `g711_ulaw` if desktop WebRTC audio wants a different format. The Google Live adapter file should be created at the same time with the same interface, even if it only contains a stub implementation and tests that enforce interface conformance. This makes the seam real instead of aspirational.

Next, update the gateway tool dispatch layer so the realtime session can use the normal OpenClaw tools. The first version must explicitly allow `web_search`, `web_fetch`, `read`, `write`, and `exec`. Do not invent synthetic wrapper tools to avoid shell access. Instead, route execution through the same owner, allowlist, approval, and fallback logic already used elsewhere. The realtime session needs structured tool-call results so it can narrate progress or failure. That means the gateway runtime should translate tool execution events into deterministic session events rather than leaving the model blind.

After tool dispatch exists, integrate Discord voice with the shared realtime session core. Replace the direct `transcribeAudio -> agentCommandFromIngress -> textToSpeech` path with a transport adapter that feeds audio into the shared session and plays assistant audio or fallback TTS back into the channel. Preserve current owner and allowlist semantics by keeping `authorizeDiscordVoiceIngress(...)` and speaker ownership checks in the transport adapter before tool-capable actions are allowed.

In parallel with the Discord work, scaffold the desktop transport boundary. Add protocol support for a desktop client to negotiate a realtime session and media transport. The desktop app itself is a later milestone, but the gateway side should already expose enough to support a future Tauri client using WebRTC for audio and the gateway websocket for control.

Finally, keep the legacy voice path alive. The shared session core must support a fallback backend that performs the old `STT -> agent -> TTS` workflow. Use this when realtime provider capability is missing, the transport fails, or a session explicitly degrades. The fallback path is not an embarrassment; it is the safety net that keeps the feature useful while the realtime provider integration matures.

## Milestones

### Milestone 1: Typed realtime session protocol and shared session skeleton

At the end of this milestone, the gateway will know how to describe a realtime conversation session in a typed, additive way, but no provider-specific logic will exist yet. A novice should be able to run the protocol tests and see that realtime request and event payloads validate. The new session core should exist as a local interface and state machine skeleton with fake or toy adapters, so future work has a place to land.

The work in this milestone is to add `src/gateway/protocol/schema/realtime-audio.ts`, export it through `src/gateway/protocol/schema.ts` and `src/gateway/protocol/index.ts`, add a runtime handler placeholder under `src/gateway/server-methods/realtime-audio.ts`, and create the initial `src/gateway/realtime-audio/types.ts` plus session-state files. Acceptance is a passing protocol and unit test suite plus a tiny internal toy test that opens a fake session, emits synthetic transcript and interrupt events, and proves the state machine behaves deterministically.

### Milestone 2: OpenAI provider adapter and Google-ready boundary

At the end of this milestone, the shared realtime session core will be able to run against a real provider adapter, specifically OpenAI `gpt-realtime-1.5`. The same interface must also support a future Google Live adapter. The proof is provider-level tests that show the adapter can receive partial transcript events, final transcript events, audio output events, and interrupt/cancel events without the transport layer caring about vendor-specific details.

The work is to implement the provider interface under `src/gateway/realtime-audio/providers/`, borrowing proven ideas from `extensions/voice-call/src/providers/stt-openai-realtime.ts` without binding the new core to telephony-only assumptions. The Google file should be created now even if it only contains a stub and capability declarations. Acceptance is a passing provider test suite and a small transcript showing the OpenAI adapter can be exercised from a test harness.

### Milestone 3: Realtime tools with direct shell access

At the end of this milestone, a realtime session can invoke OpenClaw tools directly, including `exec`, and receive structured results. The proof is an integration test where a trusted test session uses the realtime tool path to read a file, write a small config change, and run a harmless shell command, with all results coming back as structured session events.

The work is to add a default realtime tool profile in the gateway runtime, wire tool dispatch from the session core into the normal OpenClaw tool system, and map approval-needed, denied, and successful exec states back into the session event stream. The implementation must reuse the same trust and approval behavior described in `docs/tools/exec-approvals.md`. Acceptance is passing tests and a demonstrable transcript from a test harness showing successful shell execution and deterministic denial behavior when policy blocks a command.

### Milestone 4: Discord voice transport adapter over the shared backend

At the end of this milestone, Discord voice will no longer be a one-off pipeline. It will feed audio into the shared realtime backend and play assistant responses out of that backend, while preserving current owner and allowlist checks. The proof is a Discord voice integration test or harness run that shows transcript input, assistant response, and at least one shell-capable tool action flowing through the new core.

The work is to refactor `extensions/discord/src/voice/manager.ts` so it becomes a transport adapter. It should still resolve speaker context and owner status and should still reject non-owner use of dangerous capabilities, but it should stop owning the core conversation loop. Acceptance is an integration scenario proving the shared backend is now being used and that fallback still works.

### Milestone 5: Desktop transport boundary and Tauri-ready gateway support

At the end of this milestone, the gateway side will support a desktop client using WebRTC for audio and the normal gateway websocket for control and signaling. The proof is a transport-level test or prototype harness that simulates desktop session setup and validates realtime events over the gateway protocol.

The work is to implement the signaling handlers and session bridging in the gateway so a future `apps/desktop` Tauri client can connect without inventing its own provider logic. This milestone does not require a polished app UI, but it must leave the repository with a clear gateway-side path a novice can use for the next implementation step. Acceptance is a deterministic prototype transcript and passing tests for session negotiation.

### Milestone 6: Fallback behavior, validation, and operator proof

At the end of this milestone, the feature must be robust rather than merely exciting. The shared backend must degrade to the legacy `STT -> agent -> TTS` path when realtime capability fails, and the repository validation gate must pass. The proof is a test matrix that exercises both realtime and fallback modes, along with one operator-facing scenario that demonstrates the new behavior end to end.

The work is to retain the old voice path behind the shared session core, wire fallback transitions, and update documentation and tests. Acceptance is passing validation, passing targeted tests, and an operator-facing transcript proving that realtime works and fallback works when forced.

## Concrete Steps

All commands below assume the working directory is the repository root:

    cd /home/bex/projects/openclaw

Before implementation begins, read the current files named throughout this ExecPlan in full, especially:

    src/gateway/protocol/AGENTS.md
    src/gateway/protocol/schema/frames.ts
    src/gateway/protocol/index.ts
    src/gateway/server-methods/talk.ts
    extensions/discord/src/voice/manager.ts
    extensions/voice-call/src/providers/stt-openai-realtime.ts
    extensions/voice-call/src/media-stream.ts
    extensions/voice-call/src/telephony-audio.ts
    docs/tools/exec-approvals.md
    docs/tools/acp-agents.md

For Milestone 1, create the new realtime protocol and shared session skeleton. Run:

    pnpm test -- src/gateway/protocol

Expected result after the milestone:

    protocol tests pass, including new realtime schema validation cases

For Milestone 2, implement the OpenAI adapter and stub the Google Live boundary. Run provider-focused tests, for example:

    pnpm test -- src/gateway/realtime-audio

Expected result after the milestone:

    provider adapter tests pass
    OpenAI adapter emits normalized transcript/audio/tool events in the test harness

For Milestone 3, add realtime tool dispatch with `exec`, `read`, and `write`. Run targeted tests around tool dispatch and approvals:

    pnpm test -- src/gateway/realtime-audio src/agents

Expected result after the milestone:

    realtime tool integration tests pass
    approval-needed and denied exec states appear as structured session events

For Milestone 4, refactor Discord voice into a transport adapter and run the most direct Discord voice and integration tests available:

    pnpm test -- extensions/discord/src/voice

Expected result after the milestone:

    Discord voice tests pass
    realtime backend path is exercised in at least one integration-style test

For Milestone 5, scaffold and test the desktop signaling path:

    pnpm test -- src/gateway/realtime-audio src/gateway/protocol

Expected result after the milestone:

    desktop signaling and session negotiation tests pass

For Milestone 6 and final validation, run the normal repository gates in this order:

    pnpm tsgo
    pnpm check
    pnpm test
    pnpm build

Expected result at completion:

    all repository validation commands pass

As implementation progresses, replace these generic command blocks with the exact test paths and observed outputs that were actually used.

## Validation and Acceptance

The feature is accepted only when all of the following are true.

A trusted Discord voice session can join a voice channel, speak a request, receive partial transcript or realtime state updates, and hear an assistant response generated through the shared realtime backend. If the spoken request causes a shell command to run, the result comes back in the conversation instead of vanishing into logs.

A prototype desktop client or desktop transport harness can establish a realtime session through the gateway, stream microphone audio, receive assistant audio, and interrupt the assistant while it is speaking.

The shared backend can run against the OpenAI provider adapter using `gpt-realtime-1.5` without transport code knowing about provider-specific event names.

The codebase contains a second provider boundary for Google Live that compiles against the same local interface even if the full provider implementation is not complete yet.

A realtime session can use `web_search`, `web_fetch`, `read`, `write`, and `exec` through the normal OpenClaw tool surface. When policy blocks a command or approval is required, the session receives a deterministic structured failure or pending state.

The legacy `STT -> agent -> TTS` path still works as a fallback and is covered by tests.

All changed files pass `get_diagnostics`, and the final repository validation commands succeed.

## Idempotence and Recovery

This plan is intentionally additive. New protocol files, session modules, and provider adapters should be introduced alongside the existing voice path rather than by deleting the old system early. That makes retries safer and keeps tests green while the migration is in progress.

If a milestone lands partially, update the `Progress` section immediately so the next contributor can distinguish what is complete from what remains. If a protocol change is started but not wired through the validators, finish that wiring before moving on. The repository rule is that protocol work must not leave schema, validators, and tests out of sync.

If the realtime provider work stalls, keep the shared session skeleton and fallback backend compiling and validated. Do not strand Discord voice or desktop talk mode in a half-migrated state.

If desktop WebRTC transport proves too risky for the same patch series, complete the gateway-side signaling contract and transport harness first, update `Progress`, and leave the polished Tauri client implementation as a clearly documented remaining task rather than sneaking in protocol changes without a usable consumer.

## Artifacts and Notes

Update this section during implementation with the most important proof snippets. Keep them short and focused.

Expected examples to add later:

    Example provider transcript:
    partial: "checking PR comments"
    tool_call: exec {"command":"gh pr view 123 --comments"}
    tool_result: ok
    assistant_audio_started
    assistant_audio_completed

    Example fallback transition:
    realtime provider unavailable
    fallback_mode: legacy-stt-agent-tts
    assistant_text: "I couldn't start the realtime provider, so I switched to the legacy voice path."

    Example validation tail:
    pnpm check  -> pass
    pnpm test   -> pass
    pnpm build  -> pass

## Interfaces and Dependencies

The shared gateway runtime introduced by this ExecPlan must define stable local interfaces. Use these exact names unless implementation discoveries force a documented change.

In `src/gateway/realtime-audio/types.ts`, define a `RealtimeConversationSession` interface that owns the normalized conversation lifecycle. It must expose methods to start, stop, interrupt, receive transport audio, and subscribe to normalized session events.

In `src/gateway/realtime-audio/providers/types.ts`, define a `RealtimeProviderAdapter` interface responsible for vendor-specific realtime behavior. It must expose methods for session creation, session update, audio input, interruption, and shutdown. It must emit normalized events rather than provider-native payloads.

In `src/gateway/protocol/schema/realtime-audio.ts`, define typed schema objects for the new request and event payloads. Export them through the same paths used by other gateway protocol schemas.

In `src/gateway/server-methods/realtime-audio.ts`, define gateway request handlers for session setup and signaling. These handlers should delegate real behavior to the new gateway runtime module rather than embedding provider logic directly.

In the Discord integration, `extensions/discord/src/voice/manager.ts` should remain the transport adapter that understands Discord speaker identity, allowlist checks, and channel playback mechanics. It should stop owning the provider and conversation core.

The default realtime tool profile must include the normal OpenClaw tools `web_search`, `web_fetch`, `read`, `write`, and `exec`. Reuse existing gateway and agent tool dispatch modules instead of inventing a second tool runtime. Approval-needed, denied, and success states must be converted into normalized realtime session events.

For provider dependencies, the OpenAI implementation may reuse code and patterns from `extensions/voice-call/src/providers/stt-openai-realtime.ts`, but any shared logic promoted out of that plugin must remain transport-agnostic. The Google Live adapter should be shaped against the same internal interface even if its wire protocol differs.

For desktop transport dependencies, prefer the system webview plus WebRTC path in the future Tauri app, while keeping gateway-side signaling on the existing websocket control channel. The gateway must own provider credentials and provider session management.

## Change Notes

2026-04-02: Initial ExecPlan created to capture the agreed architecture and execution strategy. The plan records the explicit decision to give the realtime layer direct shell access through the normal OpenClaw trust model instead of hiding shell behavior behind wrapper tools.

2026-04-02: Milestone 1 landed with additive gateway protocol schemas, handler registration, method/event exposure, and deterministic tests for the shared in-memory session core.

2026-04-02: Milestone 2 landed with a normalized OpenAI realtime provider adapter, a Google Live stub adapter, provider factory wiring, and session/provider lifecycle tests.
