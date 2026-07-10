---
title: "Wear Assistant Entrypoint"
summary: "ExecPlan for letting the Wear OS app respond to watch assistant invocation and start guarded dictation"
read_when:
  - You are implementing assistant or button invocation for the OpenClaw Wear OS app
  - You are checking whether OpenClaw can be selected as the default assistant on a watch
  - You are validating assistant invocation, watch dictation, and phone relay behavior end to end
---

# Implement Wear OS Assistant Invocation

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan format in `~/.agents/PLANS.md`. That file is not part of this repository, so the requirements are repeated here in operational form: keep this plan self-contained, keep progress current, and make every milestone produce behavior that can be observed on a watch, not only code that compiles.

## Purpose / Big Picture

After this work, a user can make OpenClaw eligible for the Wear OS assistant entrypoint on the watch. The safe v1 behavior is that the system-bound assistant session starts the existing watch dictation path directly. A public `ACTION_ASSIST` launch still only foregrounds the app; it does not start microphone capture.

The final implementation uses Androids voice interaction stack on the watch: `OpenClawVoiceInteractionService` is bound by the system when OpenClaw is the configured assistant, `OpenClawVoiceInteractionSession` receives the assistant trigger, and `AssistantTrustedStartBridge` performs an in-process handoff to `WatchMainActivity`. The activity then requests or uses microphone permission and calls the existing `WatchViewModel.onAssistantInvocation()` path. That path waits briefly for phone discovery and then uses the same SpeechRecognizer text-turn flow as the manual mic button.

The watch-side dictation behavior remains unchanged after invocation: platform `SpeechRecognizer` is primary, `/openclaw/watch/text/{turnId}` is the normal relay message, and raw 24 kHz PCM remains the pre-capture fallback when no recognizer is available or when debug/raw-audio paths are explicitly invoked.

## Progress

- [x] (2026-06-16T04:30:26Z) Researched the current code seams and Android assistant contracts enough to write this plan.
- [x] (2026-06-16T04:44:10Z) Implemented the watch assistant launch classifier and `ACTION_ASSIST` manifest entry.
- [x] (2026-06-16T04:44:10Z) Routed public assistant activity launches to foreground the existing watch UI without starting microphone capture.
- [x] (2026-06-16T04:44:10Z) Added a compact watch UI affordance for assistant role status and role request when the role is available.
- [x] (2026-06-16T04:48:31Z) Built release-signed phone and watch APKs with `./gradlew :app:assembleThirdPartyRelease :wear:assembleRelease`.
- [x] (2026-06-16T04:48:31Z) Installed the release Wear APK on the Wear emulator after uninstalling a mismatched older debug-signed `ai.openclaw.app`.
- [x] (2026-06-16T04:48:31Z) Validated on the Wear emulator that OpenClaw handles `ACTION_ASSIST`, can be added as `ROLE_ASSISTANT`, and shows the held-role UI state on cold start.
- [x] (2026-06-16T05:29:54Z) Validated on the physical Galaxy Watch that OpenClaw appears as an assistant candidate, can hold `ROLE_ASSISTANT`, and receives the assistant key event.
- [x] (2026-06-16T05:55:09Z) Installed the release Wear APK on the physical Galaxy Watch and proved the assistant key starts the watch voice path directly: `Checking phone...` followed by `Listening...`.
- [x] (2026-06-16T06:07:07Z) Replaced exported-activity caller-trust auto-start with a system-bound `VoiceInteractionService` session and in-process trusted bridge.
- [x] (2026-06-16T06:07:07Z) Validated on the physical Galaxy Watch that the configured assistant key invokes the voice interaction session and starts dictation directly.
- [ ] Run the final narrow Android test/lint set and required autoreview after the final docs update.

## Surprises & Discoveries

- Observation: The phone app already has an Android assistant entrypoint, but the watch app did not.
  Evidence: `apps/android/app/src/main/AndroidManifest.xml` declares `android.intent.action.ASSIST` on `.MainActivity`; the Wear manifest needed its own assistant activity and voice interaction service entries.

- Observation: The current Wear voice path already had the right post-invocation behavior.
  Evidence: `apps/android/wear/src/main/java/ai/openclaw/wear/WatchViewModel.kt` starts `AndroidSpeechDictation`, sends `relayClient.sendTextTurn(text)`, arms a processing watchdog, and plays compressed or PCM responses.

- Observation: A public exported activity action or extra is not a safe way to auto-start microphone capture.
  Evidence: `WatchMainActivity` is exported so the system can launch `ACTION_ASSIST`. Any external app can also send that public action or arbitrary extras. The activity now treats `ACTION_ASSIST` as foreground-only, and only the system-bound voice interaction session can request automatic dictation through `AssistantTrustedStartBridge`.

- Observation: Caller identity is not a reliable trust signal for a third-party role holder on this watch.
  Evidence: physical watch dumpsys showed the assistant trigger originating from Wear SystemUI, but Android did not expose usable `ComponentCaller` or launched-from identity to the release-signed app. Android source shows caller identity readback is intentionally restricted to privileged/same-identity cases. The implementation therefore avoids caller-identity auto-start.

- Observation: `cmd role add-role-holder android.app.role.ASSISTANT ai.openclaw.app 0` was not sufficient by itself on the Galaxy Watch.
  Evidence: role holder state changed, but `dumpsys voiceinteraction` did not bind OpenClaw until the secure `voice_interaction_service` value pointed at `ai.openclaw.app/ai.openclaw.wear.assistant.OpenClawVoiceInteractionService`. The user-facing settings path may handle this; adb validation should check both role state and `dumpsys voiceinteraction`.

- Observation: True always-on custom wake word support is a separate platform capability.
  Evidence: Android exposes `AlwaysOnHotwordDetector` through the voice interaction service stack, but support depends on SoundTrigger hardware, keyphrase enrollment, detector availability, and system/OEM integration. On this watch, `dumpsys voiceinteraction` currently shows no active hotword detection service.

## Decision Log

- Decision: Keep public `ACTION_ASSIST` foreground-only.
  Rationale: The action is useful for role qualification and explicit assist launches, but it is exported. Starting the microphone from this entrypoint would allow spoofed launches to capture audio.
  Date/Author: 2026-06-16 / Codex

- Decision: Use `VoiceInteractionService` plus `VoiceInteractionSession` as the trusted automatic assistant path.
  Rationale: The service is protected by `android.permission.BIND_VOICE_INTERACTION`, so third-party apps cannot bind or invoke the session directly. The session can hand off to the existing activity and ViewModel without creating a second dictation stack.
  Date/Author: 2026-06-16 / Codex

- Decision: Keep the actual user dictation in the existing watch `SpeechRecognizer` path.
  Rationale: `OpenClawRecognitionService` exists only to satisfy the voice interaction service metadata expected by the platform on this device. OpenClaw should not become a general-purpose recognition provider for other apps in v1.
  Date/Author: 2026-06-16 / Codex

- Decision: Do not implement custom wake word capture in this feature.
  Rationale: "Hey Sky" is not the same as assistant-button launch. It requires a hotword detector path that may be unavailable or OEM-gated, and faking it with a background microphone service would be a battery and platform-behavior regression.
  Date/Author: 2026-06-16 / Codex

## Outcomes & Retrospective

The release Wear APK now has three assistant-related surfaces:

- `WatchMainActivity` handles launcher and public `ACTION_ASSIST` foregrounding.
- `OpenClawVoiceInteractionService` and `OpenClawVoiceInteractionSessionService` make the watch app a system-bound voice interaction assistant.
- `OpenClawRecognitionService` is a recognition-service declaration for voice interaction metadata. It delegates to a non-OpenClaw recognizer component instead of doing recognition itself. It must not declare a global `android.speech.RecognitionService` intent filter, because that changes recognizer discovery and can suppress raw PCM fallback on devices without a real recognizer. It must also require `android.permission.BIND_SPEECH_RECOGNITION` so external apps cannot bind it directly.

The phone app now mirrors that native assistant shape. Its public `ACTION_ASSIST` activity path is foreground-only, and automatic dictation comes from the system-bound `VoiceInteractionSession` through `AssistantTrustedStartBridge`. The trusted phone session opens the Voice tab and starts the normal platform `SpeechRecognizer` dictation path after microphone permission is granted.

Physical Galaxy Watch validation showed OpenClaw as an assistant candidate, showed the assistant key routing through the voice interaction manager when secure assistant service settings point at OpenClaw, and proved that the release-signed watch app starts the voice path directly from the assistant key.

The main implementation lesson is that activity caller identity was the wrong trust boundary. The correct boundary is the system-bound voice interaction service. Keeping that distinction documented matters because the public activity path must stay foreground-only.

## Context and Orientation

This repository contains a phone app and a Wear OS watch app under `apps/android`. Both APKs use application id `ai.openclaw.app`, but they are installed on different devices. Android roles and assistant services are device-local, so making the phone app the default assistant does not automatically make the watch app the default assistant on the watch.

Important terms:

An assistant role is Androids named default-assistant slot, exposed as `RoleManager.ROLE_ASSISTANT`. A device can have one active holder for this role. A role holder may receive assist gestures, assistant button events, or privileged assistant behavior depending on the device build.

An assist action is the ordinary Android intent action `android.intent.action.ASSIST`. OpenClaw handles it on the watch only to foreground the app and participate in assistant discovery.

A voice interaction service is an Android service extending `android.service.voice.VoiceInteractionService`. It is kept and invoked by the system when selected as the voice interaction assistant. OpenClaw uses it as the trusted assistant-button entrypoint.

Speech dictation is the watch-side use of Android `SpeechRecognizer` to turn the users spoken words into final text. In this repo it lives in `apps/android/wear/src/main/java/ai/openclaw/wear/speech/SpeechDictation.kt`.

A text turn is the Wear Data Layer message from the watch to the phone carrying a final transcript. In this repo the watch sends it through `WearPhoneRelay.sendTextTurn(text)` and the phone handles it in the wear relay path. This skips raw PCM recording and uses the existing chat and TTS response pipeline.

Current relevant files:

- `apps/android/wear/src/main/AndroidManifest.xml` declares launcher, public assist, voice interaction, session, and recognition services.
- `apps/android/wear/src/main/java/ai/openclaw/wear/WatchMainActivity.kt` owns microphone permission prompting, Compose setup, debug intents, assistant foregrounding, and trusted session auto-start.
- `apps/android/wear/src/main/java/ai/openclaw/wear/WatchViewModel.kt` owns the watch state machine. `onAssistantInvocation()` waits briefly for phone discovery, then starts the same dictation-first path as the manual mic button.
- `apps/android/wear/src/main/java/ai/openclaw/wear/assistant/AssistantTrustedStartBridge.kt` carries the in-process trusted start request from the voice interaction session to the resumed activity instance.
- `apps/android/wear/src/main/java/ai/openclaw/wear/assistant/OpenClawVoiceInteractionService.kt` is the system-bound assistant service.
- `apps/android/wear/src/main/java/ai/openclaw/wear/assistant/OpenClawVoiceInteractionSessionService.kt` creates sessions for assistant invocation.
- `apps/android/wear/src/main/java/ai/openclaw/wear/assistant/OpenClawVoiceInteractionSession.kt` receives assistant `onShow()` and requests activity dictation through the trusted bridge. It disables the default voice-session UI before show so a blank session window cannot cover `WatchMainActivity`.
- `apps/android/wear/src/main/java/ai/openclaw/wear/assistant/OpenClawRecognitionService.kt` is the recognition service declared in voice interaction metadata. It delegates requests to a non-OpenClaw recognizer when available.
- `apps/android/wear/src/main/java/ai/openclaw/wear/assistant/WatchAssistantEntry.kt` contains assistant intent and role helpers.
- `apps/android/wear/src/main/res/xml/interaction_service.xml` declares the voice interaction service metadata.
- `apps/android/wear/src/main/res/xml/recognition_service.xml` declares the recognition service metadata and marks the stub as non-selectable.
- `apps/android/wear/src/main/java/ai/openclaw/wear/speech/SpeechDictation.kt` wraps Android `SpeechRecognizer` and explicitly targets a non-OpenClaw recognizer component so assistant setup cannot route dictation back into OpenClaw's metadata stub.
- `apps/android/wear/src/main/java/ai/openclaw/wear/ui/WatchFace.kt` renders the small watch UI.
- `apps/android/app/src/main/java/ai/openclaw/app/wear/WearAudioRelay.kt` and `apps/android/app/src/main/java/ai/openclaw/app/wear/WearSttTtsSession.kt` handle phone-side wear text and audio turns.

## Plan of Work

Start from the current voice interaction implementation and keep the trust boundary narrow:

1. Public assistant launches can foreground `WatchMainActivity`.
2. Only `OpenClawVoiceInteractionSession.onShow()` can request automatic dictation.
3. The trusted request goes through `AssistantTrustedStartBridge`, which is in-process and not exported. `WatchMainActivity` collects bridge requests only while resumed so a stopped activity instance cannot steal the one-shot start from the visible assistant-launched activity, and it also consumes the pending one-shot from `onCreate()`, `onNewIntent()`, and `onResume()` to cover cold-start and `SINGLE_TOP` reuse.
4. `WatchMainActivity` consumes the bridge request, checks that OpenClaw still holds the assistant role, prompts for microphone permission if needed, and calls `WatchViewModel.onAssistantInvocation()`.
5. `WatchViewModel.onAssistantInvocation()` waits briefly for phone discovery and starts the normal SpeechRecognizer text-turn path. `AndroidSpeechDictation` must resolve an external recognizer component; if only OpenClaw's stub is available, it reports unavailable and lets raw PCM fallback run.
6. Raw PCM fallback remains available only before capture starts or through existing debug/raw paths.

Do not add custom wake-word code in this plan. Add a separate hotword probe before promising or implementing "Hey Sky".

## Milestone 1: Normal Assist Activity Entrypoint

This milestone makes the Wear activity respond to Android assist launches and foreground the same UI that contains the Speak button.

Acceptance for this milestone:

- Launching `adb shell am start -a android.intent.action.ASSIST -n ai.openclaw.app/ai.openclaw.wear.WatchMainActivity` foregrounds OpenClaw.
- Explicit public `ACTION_ASSIST` does not start microphone capture.
- Manual Speak still starts the existing dictation-first path.

## Milestone 2: Watch Assistant Role Setup UI

This milestone gives the user a watch-side setup path instead of forcing them to dig through system settings. The idle watch UI can show whether the assistant role is available and whether OpenClaw holds it. If available and not held, tapping the assistant setup action launches the platform role request.

Acceptance for this milestone:

- On a watch/emulator where `RoleManager.ROLE_ASSISTANT` is unavailable, the UI remains clean and manual Speak still works.
- On a device where the role is available, the UI offers a role request and updates held/unheld status after returning from the request flow.
- The app never crashes if the role manager throws or the system settings activity is missing.

## Milestone 3: Voice Interaction Service Entrypoint

This milestone makes the system-bound assistant trigger start dictation without relying on spoofable activity extras or caller-identity readback.

Acceptance for this milestone:

- The watch package installs as a normal release APK.
- `cmd package query-services -a android.service.voice.VoiceInteractionService` lists `OpenClawVoiceInteractionService`.
- `dumpsys voiceinteraction` shows the OpenClaw voice interaction service, session service, recognition service, `mBound=true`, and `Supports assist=true` after OpenClaw is configured as the assistant service.
- Triggering the assistant button invokes the session, foregrounds OpenClaw, and starts dictation through the internal bridge.
- Public `ACTION_ASSIST` remains foreground-only.

## Milestone 4: Hotword Probe For "Hey Sky"

This milestone is intentionally not part of the v1 assistant-button implementation. It should be a follow-up that probes, logs, and documents whether the physical watch supports app-provided always-on hotword detection.

Probe design:

- In `OpenClawVoiceInteractionService.onReady()`, create a detector for the desired keyphrase, for example `Hey Sky`, only if the framework API is available to the Wear compile SDK.
- Log detector availability, supported recognition modes, enrollment state, and whether capture trigger audio, echo cancellation, or noise suppression are supported.
- Do not start background microphone capture to emulate hotwording.
- If the detector reports unavailable or unenrolled, keep assistant-button invocation as the supported path.
- If the detector reports available and enrolled on the physical watch, route hotword detections to the same `AssistantTrustedStartBridge.requestStart()` path used by the assistant button.

Acceptance for this milestone:

- Device logs show whether `Hey Sky` is supported by the platform hotword stack.
- Unsupported states produce no user-facing broken setting.
- Supported states start dictation through the same trusted bridge as the assistant button.

## Concrete Steps

Work from the repository root unless a command explicitly changes directory.

1. Confirm the tree state before editing:

   git status -sb

2. Keep `apps/android/wear/src/main/AndroidManifest.xml` aligned with the activity, voice interaction service, session service, and recognition service declarations. Keep the recognition service out of global speech recognizer discovery and protected by the platform bind permission unless it becomes a real speech recognizer.

3. Keep `WatchMainActivity` public assistant handling foreground-only and keep bridge-driven assistant starts role-gated.

4. Keep `WatchViewModel.onAssistantInvocation()` as a thin entrypoint into the existing voice-turn path. It may wait briefly for phone discovery on cold start, but it must not create a separate assistant-only dictation stack.

5. Keep `OpenClawVoiceInteractionSession.onShow()` minimal. It should request a trusted start and foreground `WatchMainActivity`; it should not build a second assistant UI or second dictation implementation. Keep `onPrepareShow()` disabling the session UI before the activity handoff.

6. Run focused tests from `apps/android`:

   ./gradlew :wear:testDebugUnitTest --tests ai.openclaw.wear.WatchViewModelTest --tests ai.openclaw.wear.assistant.WatchAssistantEntryTest --tests ai.openclaw.wear.speech.SpeechDictationTest

7. Run lint for touched Android modules:

   ./gradlew :wear:ktlintCheck

8. Build release artifacts:

   ./gradlew :app:assembleThirdPartyRelease :wear:assembleRelease

9. Run repository whitespace check from the repository root:

   git diff --check

10. Before committing code changes, run the required fresh autoreview loop:

    .agents/skills/autoreview/scripts/autoreview --mode local --engine codex --thinking high

Fix accepted/actionable findings and rerun until clean. This autoreview gate is required for code changes before landing.

## Validation and Acceptance

Unit validation must cover these behaviors:

- `isAssistantLaunchIntent(Intent(Intent.ACTION_ASSIST))` returns true.
- `isAssistantLaunchIntent(Intent().putExtra("openclaw.assistant.autoStart", true))` returns false because exported activity extras must not start microphone capture.
- Random launcher/debug intents do not count as assistant launch intents.
- Existing Speak-button dictation still sends one text turn and transitions to processing.
- Assistant invocation starts the same dictation path and sends one text turn after phone discovery.
- Existing raw PCM fallback still starts only when dictation is unavailable before capture starts.

Device validation must prove these user-visible behaviors:

- Manual Speak still works after the assistant changes.
- Explicit `ACTION_ASSIST` foregrounds OpenClaw on the watch and does not capture audio.
- If the watch role/service picker accepts OpenClaw, the real assistant trigger starts OpenClaw dictation.
- A successful assistant-triggered turn logs the text-turn behavior on the phone and plays audio on the watch.
- A failed role request or unavailable role leaves the manual Speak path intact.

The feature is accepted when the voice interaction session auto-start path is demonstrated on a release-signed watch install, or when release-signed validation proves that the device blocks normal third-party assistant service routing and the plan records that limitation with logs and commands.

## Idempotence and Recovery

All Gradle test, lint, and build commands are safe to rerun. If `adb install -r` fails because an older build is installed with a different signature, stop and confirm before uninstalling; do not silently remove user data.

If `cmd role add-role-holder android.app.role.ASSISTANT ai.openclaw.app 0` succeeds but `dumpsys voiceinteraction` still does not show OpenClaw as the active voice interaction service, check the secure setting:

    settings get secure voice_interaction_service

On the validated Galaxy Watch, adb role assignment alone did not set the active voice interaction service. The physical-device proof used:

    settings put secure voice_interaction_service ai.openclaw.app/ai.openclaw.wear.assistant.OpenClawVoiceInteractionService
    settings put secure assistant ai.openclaw.app/ai.openclaw.wear.assistant.OpenClawVoiceInteractionService

If assistant invocation wedges the watch in `Processing`, use the existing Retry button or:

    rtk adb -s <watch> shell am force-stop ai.openclaw.app

Then relaunch the watch app normally. Do not reset the watch or clear app data unless there is a separate reason.

## Artifacts and Notes

Observed release Wear emulator evidence after Milestone 1 includes the watch activity:

    ActivityInfo:
      name=ai.openclaw.wear.WatchMainActivity
      packageName=ai.openclaw.app
      exported=true

Observed explicit assistant launch command:

    rtk adb -s <watch> shell am start -a android.intent.action.ASSIST -n ai.openclaw.app/ai.openclaw.wear.WatchMainActivity

Observed role qualification on the Wear emulator:

    rtk adb -s emulator-5554 shell cmd role add-role-holder android.app.role.ASSISTANT ai.openclaw.app 0
    rtk adb -s emulator-5554 shell cmd role get-role-holders android.app.role.ASSISTANT
    ai.openclaw.app

Observed physical Galaxy Watch package proof after installing `apps/android/wear/build/outputs/apk/release/wear-release.apk`:

    versionCode=2026060501
    versionName=2026.6.5
    signatures=[9c8d58fa]

Observed physical Galaxy Watch voice interaction state after assistant service configuration:

    mComponent=ai.openclaw.app/ai.openclaw.wear.assistant.OpenClawVoiceInteractionService
    Session service=ai.openclaw.wear.assistant.OpenClawVoiceInteractionSessionService
    Recognition service=ai.openclaw.wear.assistant.OpenClawRecognitionService
    Supports assist=true
    mBound=true

Observed watch logs after pressing the assistant key from home:

    OpenClawWear: voice interaction session requested dictation
    OpenClawWear: assistant intent foregrounded activity
    OpenClawWear: trusted assistant session auto-starting dictation
    OpenClawWear: state=CheckingPhone msg=Checking phone...
    OpenClawWear: state=Recording msg=Listening...

Expected phone log shape for the text-turn path:

    WearAudioRelay: watch text turn ...
    WearSttTtsSession: chat.send ok ...
    WearSttTtsSession: talk.speak ok bytes=... format=...

## Interfaces and Dependencies

Use Android framework APIs already available to the Wear app. Do not add a new dependency for the assistant-button feature.

Helper API in `apps/android/wear/src/main/java/ai/openclaw/wear/assistant/WatchAssistantEntry.kt`:

    internal data class AssistantRoleStatus(
      val available: Boolean,
      val held: Boolean,
    )

    internal fun isAssistantLaunchIntent(intent: Intent?): Boolean

    internal fun assistantRoleStatus(context: Context): AssistantRoleStatus

    internal fun createAssistantRoleRequestIntent(context: Context): Intent?

Trusted bridge API in `apps/android/wear/src/main/java/ai/openclaw/wear/assistant/AssistantTrustedStartBridge.kt`:

    internal object AssistantTrustedStartBridge {
      val requests: SharedFlow<Unit>
      fun requestStart()
      fun consumePendingStart(): Boolean
    }

The watch app must continue using:

- `AndroidSpeechDictation` for system speech recognition.
- `WearPhoneRelay.sendTextTurn(text)` for final dictation text.
- `WearPhoneRelay.sendStartRecording()` and raw PCM only as the existing fallback before capture starts.
- `AudioPlayer` and `CompressedAudioDecoder` for response playback.

Do not change phone-side chat/TTS contracts unless device validation shows the assistant entrypoint needs a new source marker. If a marker is needed for logs, add it as optional metadata and keep existing text-turn behavior backward compatible.

## Revision Notes

- 2026-06-16T04:30:26Z: Initial ExecPlan created. It chooses `ACTION_ASSIST` plus role validation as the first implementation and keeps deeper assistant service and hotword behavior behind live device proof because those paths are device-policy-sensitive on Wear OS.
- 2026-06-16T04:44:10Z: Updated during implementation to remove the private auto-start extra from the contract. The reason is security: `WatchMainActivity` is exported and extras are spoofable.
- 2026-06-16T04:48:31Z: Updated after release-emulator validation. The Wear emulator accepts the release APK as an assistant role holder through `cmd role`, explicit assist launches the watch activity, and physical Galaxy Watch validation remains the only open device proof.
- 2026-06-16T04:53:26Z: Updated after autoreview found that exported-activity assistant auto-start is not a safe or reliable trust boundary for a third-party app. The implementation keeps `ACTION_ASSIST` foreground-only and leaves automatic assistant-triggered dictation to a non-spoofable voice-interaction/internal handoff.
- 2026-06-16T05:36:10Z: Updated after physical Galaxy Watch proof showed the assistant key route, but Android did not reliably expose trusted caller identity to the release-signed app.
- 2026-06-16T06:07:07Z: Updated after implementing and validating the system-bound `VoiceInteractionService` route. Automatic dictation now starts only from the voice interaction session bridge; public `ACTION_ASSIST` remains foreground-only.
