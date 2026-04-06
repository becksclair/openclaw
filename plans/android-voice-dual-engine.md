# Android dual-engine voice mode with backend STT and optional realtime

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `/home/bex/.agents/PLANS.md`. That file requires every ExecPlan to be fully self-contained, to remain executable by a novice who only has the working tree and this file, and to keep each milestone independently verifiable.

## Purpose / Big Picture

After this change, the Android app will support two explicit voice engines behind one Voice tab. The default engine will be `classic`, which captures microphone audio on Android, sends a completed voice turn to the gateway for transcription using the same core transcription path Discord voice already relies on, submits the resulting text through the existing chat pipeline, and plays replies through `talk.speak` so ElevenLabs or the configured Talk provider remains in charge of speech output. The optional engine will be `realtime`, which uses the fork’s new `realtime.session.*` gateway backend for low-latency speech-to-speech conversations.

The user-visible proof is simple and concrete. In `classic` mode, a user opens the Android Voice tab, taps the mic, speaks a sentence, pauses, sees the recognized text appear as a completed user bubble, receives the assistant response through the normal chat pipeline, and hears the reply spoken through Talk TTS. There is no live local partial text in this first version; the transcript appears only after the backend finishes recognition for the turn. In `realtime` mode, the same screen can be switched into the fork’s realtime backend and will stream transcripts and assistant audio with lower latency. The toggle lets the operator keep the higher-confidence STT/TTS path as the default while still opting into the new realtime backend when desired.

## Progress

- [x] (2026-04-05 00:00Z) Researched the current Android Voice tab implementation, the legacy TalkMode path, the gateway Talk TTS path, the Discord legacy voice transcription path, and the fork’s realtime session protocol and runtime seams.
- [x] (2026-04-05 00:00Z) Resolved the product direction: ship `classic` mode first as the default, remove Android-local live partial text from that path, keep `talk.speak` as the TTS seam, and make realtime an explicit optional engine.
- [x] (2026-04-05 00:00Z) Identified the missing seam: Android cannot directly call the Discord/plugin transcription runtime, so the repository needs a new gateway RPC for classic-mode voice-turn transcription.
- [x] (2026-04-05 00:00Z) Created this ExecPlan artifact at `plans/android-voice-dual-engine.md`.
- [x] (2026-04-05 11:30Z) Implemented Milestone 1: added a persisted `voiceEngineMode` preference, threaded it through `SecurePrefs`, `MainViewModel`, and `NodeRuntime`, and exposed it in `SettingsSheet` plus a quick switch in `VoiceTabScreen`.
- [x] (2026-04-05 12:05Z) Implemented Milestone 2: added the typed gateway `voice.transcribe` RPC, protocol schema/validator exports, gateway registration, method classification, and targeted tests.
- [x] (2026-04-05 12:40Z) Implemented Milestone 3: replaced Android classic-mode `SpeechRecognizer` transcription with `VoiceTurnRecorder` plus `VoiceTranscribeClient`, and refactored `MicCaptureManager` into a backend-transcription classic engine while preserving `chat.send` and `talk.speak`.
- [x] (2026-04-05 14:35Z) Implemented Milestone 4: added `RealtimeVoiceManager.kt`, `RealtimeAudioStreamPlayer.kt`, routed `realtime.session` events through `NodeRuntime`, and switched `NodeRuntime` to expose voice-tab state from the active engine.
- [x] (2026-04-05 14:35Z) Implemented Milestone 5: wired mode switching between classic and realtime through `SecurePrefs.voiceEngineMode`, ensured leaving the Voice tab stops the active engine, and re-ran Android plus targeted gateway validation.

## Surprises & Discoveries

- Observation: the current Android Voice tab is not true backend STT. It uses Android `SpeechRecognizer`, queues recognized text locally, sends that text through `chat.send`, and only uses `talk.speak` for reply audio.
  Evidence: `apps/android/app/src/main/java/ai/openclaw/app/NodeRuntime.kt` constructs `MicCaptureManager` with a `chat.send` closure and a reply speaker, while `apps/android/app/src/main/java/ai/openclaw/app/voice/MicCaptureManager.kt` owns `SpeechRecognizer`, partial transcript state, queued text turns, and chat-event handling.

- Observation: Android already has the correct TTS seam for the requested product shape. It calls `talk.speak`, and that gateway handler resolves provider-backed Talk synthesis, including ElevenLabs when configured.
  Evidence: `apps/android/app/src/main/java/ai/openclaw/app/voice/TalkSpeakClient.kt` calls `talk.speak`, and `src/gateway/server-methods/talk.ts` performs Talk provider resolution and `synthesizeSpeech(...)`.

- Observation: Discord legacy voice does not use a Discord-only STT algorithm. It decodes voice audio into a WAV file and then calls the core `transcribeAudioFile(...)` runtime helper.
  Evidence: `extensions/discord/src/voice/audio-processing.ts` defines `transcribeDiscordVoiceAudio(...)`, which calls `transcribeAudioFile(...)`, and `extensions/discord/src/voice/legacy-reply.ts` uses that transcript as the input to the legacy voice reply pipeline.

- Observation: Android cannot directly reuse the Discord transcription helper because Discord lives inside the plugin/runtime boundary while Android lives outside the TypeScript runtime and only talks to the gateway over RPC.
  Evidence: the Android app contains only Kotlin code plus gateway RPC access through `GatewaySession`, and there is no existing gateway RPC that exposes the same audio transcription helper Discord uses.

- Observation: the fork already has the backend contract needed for optional realtime mode. The gateway protocol supports `realtime.session.create`, `realtime.session.input.audio`, `realtime.session.interrupt`, `realtime.session.close`, and session events including `transcript.updated`, `assistant.turn.updated`, and `audio.output`.
  Evidence: `src/gateway/protocol/schema/realtime-audio.ts` defines these request and event schemas, and `src/gateway/server-methods/realtime-audio.ts` exposes the corresponding gateway handlers.

- Observation: the current Android Voice tab UI can survive a backend swap with only modest changes because it already renders a conversation list, status chip, mic controls, and speaker controls from observable state.
  Evidence: `apps/android/app/src/main/java/ai/openclaw/app/ui/VoiceTabScreen.kt` is almost entirely state-driven and does not hard-code `SpeechRecognizer` details into the UI layer.

- Observation: shipping classic mode without live partial text is a deliberate product simplification, not a regression accident. The classic path should optimize for confidence and reuse of the backend transcription stack rather than preserving Android-local partial text at all costs.
  Evidence: the desired product direction explicitly prefers the Discord-style transcription setup and a clean classic-vs-realtime split over preserving local partial previews.

## Decision Log

- Decision: ship two explicit Android voice engines, `classic` and `realtime`, behind one Voice tab.
  Rationale: the operator wants both the best STT/TTS setup and an optional low-latency realtime backend. A dual-engine design makes that tradeoff explicit instead of forcing one path to be both the quality mode and the latency mode.
  Date/Author: 2026-04-05 / Sky

- Decision: `classic` is the default voice engine.
  Rationale: the classic path is more conservative operationally, can reuse the same core transcription stack Discord already depends on, and lets the operator keep the predictable `chat.send` plus `talk.speak` behavior while realtime matures.
  Date/Author: 2026-04-05 / Sky

- Decision: remove Android-local live partial text from the first classic-mode implementation.
  Rationale: once classic mode stops using Android `SpeechRecognizer`, preserving local partial text would require a second streaming-STT seam or a fake preview layer. Shipping without partials keeps the implementation smaller and aligns with the operator’s explicit preference.
  Date/Author: 2026-04-05 / Sky

- Decision: add a new gateway RPC for classic-mode voice-turn transcription instead of trying to route Android directly into plugin runtime helpers.
  Rationale: Android is a gateway client, not a plugin runtime participant. The gateway must expose a stable RPC seam that decodes uploaded audio and calls the same core transcription path Discord relies on.
  Date/Author: 2026-04-05 / Sky

- Decision: keep `talk.speak` as the Android classic-mode TTS seam.
  Rationale: this already gives Android provider-backed Talk TTS, including ElevenLabs when configured, and preserves the fallback behavior already implemented in the app.
  Date/Author: 2026-04-05 / Sky

- Decision: do not turn `TalkModeManager` into the shared engine abstraction.
  Rationale: `TalkModeManager` is a legacy mixed-responsibility class. The cleaner long-term structure is one Android runtime orchestrator that chooses between a classic engine and a realtime engine, each with their own transport-specific helpers.
  Date/Author: 2026-04-05 / Sky

## Outcomes & Retrospective

This section will be updated at the end of each major milestone and at completion.

Initial outcome on 2026-04-05: the architecture is now scoped tightly enough to implement without improvising a mobile-only voice system. The Android app already has the right UI shell and state plumbing, the gateway already has the right Talk TTS seam, Discord already proves the desired transcription path, and the fork already provides a realtime backend contract. The one missing piece is a gateway transcription RPC for the classic engine.

Milestone 1 outcome on 2026-04-05: the Android app now persists `voiceEngineMode`, exposes it through `MainViewModel`, renders a durable selector in Settings, and adds a quick switch on the Voice tab. The current runtime still defaults to the classic engine, but the product surface is now explicit and stable.

Milestone 2 outcome on 2026-04-05: the gateway now exposes a typed `voice.transcribe` RPC through `src/gateway/protocol/schema/voice.ts`, `src/gateway/protocol/index.ts`, `src/gateway/server-methods/voice.ts`, `src/gateway/server-methods.ts`, `src/gateway/method-scopes.ts`, and `src/gateway/server-methods-list.ts`. The handler writes a temporary WAV file and calls `transcribeAudioFile(...)` through `openclaw/plugin-sdk/media-understanding-runtime` without importing Discord internals.

Milestone 3 outcome on 2026-04-05: Android classic mode no longer depends on `SpeechRecognizer` for transcription. `VoiceTurnRecorder.kt` now records PCM turns with `AudioRecord`, `VoiceTranscribeClient.kt` calls `voice.transcribe`, and `MicCaptureManager.kt` appends the user bubble only after backend transcription returns before continuing through `chat.send` and `talk.speak`.

Milestone 4 outcome on 2026-04-05: Android now has a dedicated realtime engine in `RealtimeVoiceManager.kt` backed by `realtime.session.create`, `realtime.session.input.audio`, `realtime.session.interrupt`, and `realtime.session.close`. The manager streams raw PCM microphone audio, consumes `realtime.session` transcript and assistant-turn events, and plays streamed PCM assistant audio through `RealtimeAudioStreamPlayer.kt`.

Milestone 5 outcome on 2026-04-05: `NodeRuntime.kt` now acts as the engine selector instead of hard-wiring the voice tab to classic mode. The Voice tab state flows are sourced from the currently selected engine, speaker mute now also controls realtime playback, and leaving the Voice tab disables whichever engine was active.

## Context and Orientation

The Android app lives under `apps/android/`. The current Voice tab state is owned by `apps/android/app/src/main/java/ai/openclaw/app/NodeRuntime.kt`, which acts as the central runtime coordinator for the app. It owns gateway connections, chat state, Talk mode state, mic state, and the shared event fanout. In plain language, `NodeRuntime` is the one place that already knows how to connect Android to the gateway and keep UI-facing state updated.

The current Voice tab user interface is in `apps/android/app/src/main/java/ai/openclaw/app/ui/VoiceTabScreen.kt`. That file is important because it is mostly a renderer over flows such as `micConversation`, `micStatusText`, `micInputLevel`, `micIsSending`, and `speakerEnabled`. A novice should understand that this is good news: most of the Android voice migration can happen behind the UI rather than by rewriting the screen.

The current classic Android voice engine is `apps/android/app/src/main/java/ai/openclaw/app/voice/MicCaptureManager.kt`. Today that file does two separate jobs. First, it owns Android-local speech recognition through `SpeechRecognizer`, including partial transcript state and restart logic. Second, it owns queueing completed text turns, sending them to the gateway through a callback, handling `chat` events, and updating the on-screen conversation state. The future implementation should keep the conversation-state job but replace the Android-local STT job.

The current Android reply playback seam is split across `apps/android/app/src/main/java/ai/openclaw/app/voice/TalkSpeakClient.kt` and `apps/android/app/src/main/java/ai/openclaw/app/voice/TalkModeManager.kt`. `TalkSpeakClient` calls the gateway RPC `talk.speak`. `TalkModeManager` then either plays the returned audio or falls back to Android system TTS when the gateway reports that Talk TTS is unavailable. In plain language, `talk.speak` is already the correct provider-backed speech-output seam.

The gateway’s Talk TTS handlers live in `src/gateway/server-methods/talk.ts`. That file validates `talk.speak` parameters, resolves the configured Talk provider, and synthesizes audio with `synthesizeSpeech(...)`. The gateway protocol types for Talk live in `src/gateway/protocol/schema/channels.ts` and are exported through `src/gateway/protocol/index.ts`. A novice implementing new gateway RPCs should follow that pattern exactly: define schemas, export them through the protocol index, add validators, and then add the corresponding gateway handler.

Discord legacy voice is relevant because it already implements the desired classic-mode transcription strategy. The Discord voice audio helper lives in `extensions/discord/src/voice/audio-processing.ts`, where `transcribeDiscordVoiceAudio(...)` calls the core runtime helper `transcribeAudioFile(...)` on a WAV file. The rest of the legacy Discord path in `extensions/discord/src/voice/legacy-reply.ts` turns that transcript into a normal agent ingress prompt. This proves that the desired “backend transcription, normal agent flow, Talk-based reply audio” shape already exists in the repository.

The realtime backend relevant to Android already exists on the gateway side. The wire contract lives in `src/gateway/protocol/schema/realtime-audio.ts`, the gateway handlers live in `src/gateway/server-methods/realtime-audio.ts`, and the shared runtime seam lives in `src/gateway/realtime-audio/runtime.ts`. In plain language, a “realtime session” is a gateway-managed conversation session that accepts audio input, emits transcript and assistant-turn updates, and can stream assistant audio back to the client.

The Android settings state lives in `apps/android/app/src/main/java/ai/openclaw/app/SecurePrefs.kt`. This file already persists voice-adjacent preferences such as `talk.enabled`, `voice.speakerEnabled`, and `voiceWake.mode`. The Android view-model layer lives in `apps/android/app/src/main/java/ai/openclaw/app/MainViewModel.kt`, which exposes those preferences and runtime flows to the UI.

The term “classic mode” in this ExecPlan means the non-realtime Android voice path that captures one completed voice turn at a time, obtains a transcript from the gateway, sends that transcript through the standard `chat.send` path, and plays the reply through `talk.speak`. The term “realtime mode” means the optional Android voice path that creates a gateway realtime session and streams both directions incrementally. The term “voice-turn transcription RPC” means the new gateway method that Android classic mode will call to transcribe an uploaded audio clip using the same core repository transcription helper that Discord voice already uses.

## Plan of Work

The work starts in Android preferences and UI because the dual-engine product shape should be explicit before the backend swap begins. Add a persisted voice-engine preference in `apps/android/app/src/main/java/ai/openclaw/app/SecurePrefs.kt`, expose it through `apps/android/app/src/main/java/ai/openclaw/app/MainViewModel.kt`, and render it in both `apps/android/app/src/main/java/ai/openclaw/app/ui/SettingsSheet.kt` and `apps/android/app/src/main/java/ai/openclaw/app/ui/VoiceTabScreen.kt`. The first UI version should be simple and boring: a persistent selector in Settings and a compact quick switch on the Voice tab. Default to `classic`.

After the UI shape exists, add the missing gateway seam for classic-mode transcription. Create a new request handler file `src/gateway/server-methods/voice.ts` and a new protocol schema file `src/gateway/protocol/schema/voice.ts` if a dedicated voice schema file is clearer, or extend the existing channel-oriented schema file if that matches the gateway protocol organization better. The new RPC should be named `voice.transcribe`. It must accept one completed audio turn, decode it safely, write a temporary WAV file, and call the same core transcription helper path that Discord uses. The method should return at least the final transcript text and may optionally include metadata such as provider id, model id, and duration.

Once the gateway seam exists, refactor Android classic mode so `MicCaptureManager` stops using `SpeechRecognizer` for transcription. Do not make one giant edit. First, add a new low-level Android audio-turn recorder, preferably in `apps/android/app/src/main/java/ai/openclaw/app/voice/VoiceTurnRecorder.kt`, that uses `AudioRecord` to collect PCM audio, computes input levels for the existing ring animation, and decides when a turn has ended based on silence or explicit mic stop. Second, add a new `apps/android/app/src/main/java/ai/openclaw/app/voice/VoiceTranscribeClient.kt` that calls `voice.transcribe`. Third, update `MicCaptureManager` so it becomes the classic conversation orchestrator rather than the transcription engine: it should receive completed clips, call the transcribe client, append the recognized text as the user bubble, submit that text to `chat.send`, render assistant deltas and finals, and trigger reply speech through the existing dedicated reply speaker.

A crucial design rule for the classic path is that there are no live local transcript partials in the first version. The user bubble appears only after the gateway transcription result returns. The UI can still show microphone level, listening state, sending state, and queue state. This must be documented in comments only where needed for tricky logic and in this plan’s acceptance criteria, so future contributors do not mistake it for a bug.

After classic mode is working, add a dedicated Android realtime engine in a new file such as `apps/android/app/src/main/java/ai/openclaw/app/voice/RealtimeVoiceManager.kt`. This manager should not reuse `TalkModeManager` as its state machine. Its responsibilities are to create and close realtime sessions, submit microphone PCM chunks through `realtime.session.input.audio`, handle session events delivered over the gateway connection, interrupt assistant speech, and update UI-facing flows that match the existing Voice tab shape. It also needs a dedicated streaming playback helper, such as `apps/android/app/src/main/java/ai/openclaw/app/voice/RealtimeAudioStreamPlayer.kt`, because the current `TalkAudioPlayer.kt` is designed for complete blobs rather than incremental PCM chunks.

Finally, update `apps/android/app/src/main/java/ai/openclaw/app/NodeRuntime.kt` so it becomes a clear engine selector rather than an all-purpose voice implementation blob. `NodeRuntime` should instantiate and own both engine managers, choose the active one based on the persisted preference, route gateway `chat` events to the classic engine, route gateway `realtime.session` events to the realtime engine, and expose one common set of UI-facing flows to `MainViewModel`. The user should be able to switch modes without changing screens, and leaving the Voice tab should stop whichever engine is active.

## Milestones

### Milestone 1: Persisted Android voice-engine preference and UI controls

At the end of this milestone, the Android app will know which voice engine the user wants and will let the user change that choice in a persistent, obvious way. The classic engine will still be the existing implementation at this point, but the mode selector will already exist so later milestones can plug the two engines into a stable product surface rather than improvising UI state mid-migration.

The work in this milestone is to add a new persisted preference in `apps/android/app/src/main/java/ai/openclaw/app/SecurePrefs.kt`, expose it through `apps/android/app/src/main/java/ai/openclaw/app/MainViewModel.kt`, and render it in `apps/android/app/src/main/java/ai/openclaw/app/ui/SettingsSheet.kt` plus `apps/android/app/src/main/java/ai/openclaw/app/ui/VoiceTabScreen.kt`. Acceptance is that the selector appears in the UI, changing it updates the current state immediately, and the choice survives process restarts.

### Milestone 2: Gateway voice-turn transcription RPC

At the end of this milestone, the gateway will expose a typed RPC that Android classic mode can call to transcribe a completed audio turn using the same core transcription path already proven by Discord legacy voice. A novice should be able to point to one protocol schema, one validator, one gateway handler, and one targeted test suite that proves the new method works.

The work is to define and export the request and result schemas, add validators through `src/gateway/protocol/index.ts`, implement a handler under `src/gateway/server-methods/voice.ts`, register it with the server-method bundle, and write targeted tests. Acceptance is a passing test that uploads valid audio and receives a transcript, plus deterministic failure behavior for invalid payloads or untranscribable input.

### Milestone 3: Android classic mode uses backend transcription

At the end of this milestone, Android `classic` mode will no longer use `SpeechRecognizer` to produce text. Instead it will capture microphone audio as a completed turn, send that clip to the gateway transcription RPC, display the recognized text when it comes back, and continue the existing `chat.send` plus `talk.speak` loop. There will be no live local partial text in this milestone.

The work is to add `VoiceTurnRecorder.kt`, add `VoiceTranscribeClient.kt`, refactor `MicCaptureManager.kt` into a classic conversation coordinator, and adjust `NodeRuntime.kt` state wiring where necessary. Acceptance is a manual or integration-style scenario where the user speaks, pauses, sees the recognized text appear as a completed user turn, and hears the assistant reply through Talk TTS. The existing mic ring and sending states must still behave sensibly.

### Milestone 4: Android realtime engine over the fork backend

At the end of this milestone, Android will have a dedicated realtime engine that can be selected with the new mode preference. The Voice tab will be able to create a realtime session, stream audio up, receive transcript and assistant-turn updates, play streamed audio back, and interrupt assistant playback. This milestone does not remove or weaken the classic path.

The work is to add `RealtimeVoiceManager.kt`, add `RealtimeAudioStreamPlayer.kt`, thread `realtime.session` event routing through `NodeRuntime.kt`, and normalize realtime state to the same UI-facing surface the Voice tab already expects. Acceptance is a targeted test or harness scenario proving that realtime events update the UI-facing state and that playback interruption works. This milestone is complete.

### Milestone 5: Engine switching, validation, and operator proof

At the end of this milestone, the Voice tab will feel like one feature with two backends rather than two unrelated experiments. The app will switch cleanly between classic and realtime modes, stop the active engine when leaving the Voice tab, and pass the repo validation gate for all touched surfaces.

The work is to harden `NodeRuntime.kt` as the engine selector, refine any remaining UI labeling or state mismatches, add regression tests for engine switching, and run the final validation commands. Acceptance is direct proof that classic mode works with backend transcription and `talk.speak`, realtime mode works with the fork backend, and switching modes does not leave the old engine alive behind the scenes. This milestone is complete.

## Concrete Steps

All commands below assume the working directory is the repository root:

    cd /home/bex/projects/openclaw

Before implementation begins, read the current files named throughout this ExecPlan in full, especially:

    apps/android/app/src/main/java/ai/openclaw/app/NodeRuntime.kt
    apps/android/app/src/main/java/ai/openclaw/app/MainViewModel.kt
    apps/android/app/src/main/java/ai/openclaw/app/SecurePrefs.kt
    apps/android/app/src/main/java/ai/openclaw/app/ui/VoiceTabScreen.kt
    apps/android/app/src/main/java/ai/openclaw/app/ui/SettingsSheet.kt
    apps/android/app/src/main/java/ai/openclaw/app/voice/MicCaptureManager.kt
    apps/android/app/src/main/java/ai/openclaw/app/voice/TalkModeManager.kt
    apps/android/app/src/main/java/ai/openclaw/app/voice/TalkSpeakClient.kt
    extensions/discord/src/voice/audio-processing.ts
    extensions/discord/src/voice/legacy-reply.ts
    src/gateway/protocol/schema/channels.ts
    src/gateway/protocol/index.ts
    src/gateway/server-methods/talk.ts
    src/gateway/protocol/schema/realtime-audio.ts
    src/gateway/server-methods/realtime-audio.ts

For Milestone 1, add the persisted voice-engine preference and render the selector UI. Run the Android unit test suite most directly associated with settings and runtime state:

    cd /home/bex/projects/openclaw/apps/android
    ./gradlew :app:testThirdPartyDebugUnitTest

Expected result after the milestone:

    Android unit tests pass
    the new voice-engine preference persists and is observable through MainViewModel state

For Milestone 2, add the gateway protocol schema, validator, handler, and tests for `voice.transcribe`. Run targeted gateway tests from the repo root:

    cd /home/bex/projects/openclaw
    pnpm test src/gateway/server-methods/voice.test.ts src/gateway/protocol

Expected result after the milestone:

    protocol tests pass
    voice.transcribe tests pass
    invalid payloads fail deterministically and valid audio returns a transcript

For Milestone 3, add Android audio-turn capture plus backend transcription for classic mode. Run the Android unit tests again, then any direct gateway tests used by the transcription handler:

    cd /home/bex/projects/openclaw/apps/android
    ./gradlew :app:testThirdPartyDebugUnitTest

    cd /home/bex/projects/openclaw
    pnpm test src/gateway/server-methods/voice.test.ts

Expected result after the milestone:

    Android unit tests pass
    the classic engine no longer depends on SpeechRecognizer for STT
    a completed transcript bubble appears only after backend recognition returns

For Milestone 4, add the realtime engine and targeted tests for both Android realtime state handling and the existing gateway realtime protocol:

    cd /home/bex/projects/openclaw/apps/android
    ./gradlew :app:testThirdPartyDebugUnitTest

    cd /home/bex/projects/openclaw
    pnpm test src/gateway/server-methods/realtime-audio.test.ts src/gateway/protocol/realtime-audio.test.ts

Expected result after the milestone:

    Android unit tests pass
    realtime protocol tests still pass
    the Android realtime engine can create sessions, handle events, and interrupt playback in tests

For Milestone 5 and final validation, run the repository gate plus the Android unit tests one more time:

    cd /home/bex/projects/openclaw/apps/android
    ./gradlew :app:testThirdPartyDebugUnitTest

    cd /home/bex/projects/openclaw
    pnpm check
    pnpm test
    pnpm build

Expected result at completion:

    Android unit tests pass
    pnpm check passes
    pnpm test passes
    pnpm build passes

As implementation progresses, replace these generic commands with the exact commands that were actually used and include brief transcripts in the `Artifacts and Notes` section.

## Validation and Acceptance

The feature is accepted only when all of the following are true.

In Android `classic` mode, a user can open the Voice tab, tap the mic, speak a sentence, pause, and see a completed user transcript bubble only after the backend transcription result returns. The app then sends that text through the existing chat pipeline, receives the assistant response, and plays the reply through `talk.speak` so the configured Talk provider, including ElevenLabs when configured, is responsible for speech output.

In Android `classic` mode, there is no live local partial transcript text. The UI must still show meaningful state such as listening, sending, queued, cooldown, or speaking. This is a product decision, not a test failure.

In Android `realtime` mode, the Voice tab can create a realtime session, stream microphone audio, receive transcript and assistant-turn updates, play streamed assistant audio, and interrupt assistant playback from the same screen.

Switching the engine selector changes which backend is active and leaving the Voice tab stops whichever engine was active so microphone capture and playback do not continue invisibly.

The gateway exposes a typed `voice.transcribe` RPC with tests proving that valid audio returns a transcript and invalid input returns a deterministic error.

The Android reply path still uses the existing `talk.speak` seam and remains compatible with Talk provider configuration and fallback behavior.

All changed files pass diagnostics, and the final validation commands succeed.

## Idempotence and Recovery

This plan is intentionally additive. The new classic-mode transcription path is introduced alongside the existing Android voice orchestration rather than by deleting all current voice code immediately. The realtime engine is also additive and must not replace the classic path until both are validated. That makes retries safer and keeps the Voice tab working while each milestone lands.

If Milestone 2 lands before Milestone 3, the gateway can safely carry the new `voice.transcribe` RPC even if the Android client has not started using it yet. If Milestone 3 lands partially, prefer leaving `MicCaptureManager.kt` in a compilable hybrid state with a clearly documented `Progress` entry rather than deleting `SpeechRecognizer` support halfway and breaking the Voice tab. If the realtime engine work stalls, the app must remain fully shippable in `classic` mode.

If a milestone introduces protocol changes, finish schema export, validator export, and tests before stopping. The repository’s gateway protocol rules do not tolerate leaving those pieces out of sync. If a temporary file write is used in the new transcription RPC, ensure it uses the repository’s normal temp-path conventions and is safe to retry after partial failure.

## Artifacts and Notes

Update this section during implementation with the most important proof snippets. Keep them short and focused.

Current examples:

    Classic-mode implementation snapshot:
    voice.engineMode persisted with values classic|realtime
    voice.transcribe RPC added to gateway protocol + handler registry
    VoiceTurnRecorder captures PCM16 turns at 16 kHz mono
    MicCaptureManager appends the user bubble only after backend transcription returns
    reply audio still routes through talk.speak via the dedicated reply speaker

Expected examples to add later:

    Example classic-mode flow:
    mic_on
    audio_turn_captured durationMs=1820
    voice.transcribe ok transcript="open the latest PR comments"
    chat.send ok runId=...
    chat final received
    talk.speak ok provider=elevenlabs

    Example realtime-mode flow:
    realtime.session.create ok sessionId=...
    transcript.updated role=user status=partial text="open"
    transcript.updated role=assistant status=partial text="Checking"
    audio.output sampleRate=24000 bytes=...
    interrupt.acknowledged target=assistant

    Example validation tail:
    ./gradlew :app:testThirdPartyDebugUnitTest -> pass
    pnpm check -> pass
    pnpm test -> pass
    pnpm build -> pass

## Interfaces and Dependencies

The Android side of this ExecPlan should end with two explicit engine-level helpers. Use these names unless implementation discoveries force a documented change.

In `apps/android/app/src/main/java/ai/openclaw/app/voice/VoiceTurnRecorder.kt`, define a focused helper that captures microphone PCM audio for one voice turn, reports input level updates for the existing Voice tab ring, and emits a completed audio clip once silence or explicit stop ends the turn. It must not own chat submission or TTS behavior.

In `apps/android/app/src/main/java/ai/openclaw/app/voice/VoiceTranscribeClient.kt`, define a focused client that calls the new gateway `voice.transcribe` RPC and returns a final transcript result. It should be reusable by the classic engine and small enough to test in isolation.

In `apps/android/app/src/main/java/ai/openclaw/app/voice/MicCaptureManager.kt`, keep or evolve the class so it becomes the classic engine coordinator: queue turns, request transcription, append user and assistant conversation items, submit chat requests, and trigger reply playback. Remove its responsibility for Android-local speech recognition.

In `apps/android/app/src/main/java/ai/openclaw/app/voice/RealtimeVoiceManager.kt`, define the dedicated Android realtime engine. It must own realtime session lifecycle, audio submission, event handling, interruption, and UI-facing state for the realtime path.

In `apps/android/app/src/main/java/ai/openclaw/app/voice/RealtimeAudioStreamPlayer.kt`, define a streaming PCM playback helper for realtime `audio.output` chunks. Do not force this through the existing complete-blob playback path in `TalkAudioPlayer.kt`.

In `src/gateway/protocol/schema/voice.ts` or the most appropriate existing gateway protocol schema file, define typed request and result schemas for `voice.transcribe`. Export them through `src/gateway/protocol/index.ts` with validators and type exports, following the same pattern used by `talk.speak`.

In `src/gateway/server-methods/voice.ts`, implement the gateway handler for `voice.transcribe`. It must decode uploaded audio safely, write a temporary WAV or compatible file, and call the same core transcription helper path Discord already relies on. Do not import Discord extension internals into gateway core. The core helper path should remain transport-agnostic.

The classic engine continues to depend on the existing gateway chat path and Talk TTS path. That means `NodeRuntime.kt` must keep routing `chat` events to the classic engine and must keep the reply speaker path wired through `talk.speak`. The realtime engine depends on the existing fork backend in `src/gateway/protocol/schema/realtime-audio.ts` and `src/gateway/server-methods/realtime-audio.ts`.

## Change Notes

2026-04-05: Initial ExecPlan created to capture the agreed Android product shape: default classic mode with backend STT plus `talk.speak`, no live local partial text in the first classic release, and an explicit optional realtime engine using the fork backend.
