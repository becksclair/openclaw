package ai.openclaw.wear

import ai.openclaw.wear.ambient.AmbientDetails
import ai.openclaw.wear.ambient.enterAmbientDetails
import ai.openclaw.wear.ambient.exitAmbientDetails
import ai.openclaw.wear.ambient.withAmbientTickUpdate
import ai.openclaw.wear.assistant.AssistantRoleStatus
import ai.openclaw.wear.assistant.AssistantTrustedStartBridge
import ai.openclaw.wear.assistant.assistantRoleStatus
import ai.openclaw.wear.assistant.createAssistantRoleRequestIntent
import ai.openclaw.wear.assistant.isAssistantLaunchIntent
import ai.openclaw.wear.ui.WatchFace
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
import android.view.Window
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.wear.ambient.AmbientLifecycleObserver
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File
import java.net.HttpURLConnection
import java.net.URI

class WatchMainActivity : ComponentActivity() {
  companion object {
    private const val DEBUG_TURN_TAG = "OpenClawWearDebugTurn"
    private const val EXTRA_DEBUG_PROMPT_PCM_PATH = "openclaw.debugPromptPcmPath"
    private const val EXTRA_DEBUG_PROMPT_PCM_URL = "openclaw.debugPromptPcmUrl"
    private const val EXTRA_DEBUG_ENDPOINT_PROMPT_PCM_PATH = "openclaw.debugEndpointPromptPcmPath"
    private const val EXTRA_DEBUG_ENDPOINT_PROMPT_PCM_URL = "openclaw.debugEndpointPromptPcmUrl"
    private const val EXTRA_DEBUG_PLAYBACK_PCM_PATH = "openclaw.debugPlaybackPcmPath"
    private const val EXTRA_DEBUG_PLAYBACK_PCM_URL = "openclaw.debugPlaybackPcmUrl"
    private const val EXTRA_DEBUG_PLAYBACK_OPUS_PATH = "openclaw.debugPlaybackOpusPath"
    private const val EXTRA_DEBUG_PLAYBACK_OPUS_URL = "openclaw.debugPlaybackOpusUrl"
    private const val EXTRA_DEBUG_RUN_ID = "openclaw.debugRunId"
    private const val STATE_PENDING_ASSISTANT_START = "openclaw.pendingAssistantStart"
    private const val MIC_PERMISSION_TIMEOUT_MS = 20_000L
  }

  private val viewModel: WatchViewModel by viewModels()
  private val assistantRoleStatusState = mutableStateOf(AssistantRoleStatus(available = false, held = false))
  private val ambientDetailsState = mutableStateOf(AmbientDetails())
  private lateinit var ambientObserver: AmbientLifecycleObserver

  private val micPermissionLauncher =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) { isGranted ->
      onMicPermissionResult(isGranted)
    }

  private var pendingPermissionContinuation: CompletableDeferred<Boolean>? = null
  private var pendingAssistantStart = false

  private val assistantRoleLauncher =
    registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
      refreshAssistantRoleStatus()
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    ambientObserver =
      AmbientLifecycleObserver(
        this,
        object : AmbientLifecycleObserver.AmbientLifecycleCallback {
          override fun onEnterAmbient(ambientDetails: AmbientLifecycleObserver.AmbientDetails) {
            ambientDetailsState.value = enterAmbientDetails(ambientDetails.burnInProtectionRequired)
          }

          override fun onExitAmbient() {
            ambientDetailsState.value = exitAmbientDetails()
          }

          override fun onUpdateAmbient() {
            ambientDetailsState.value = ambientDetailsState.value.withAmbientTickUpdate()
          }
        },
      )
    lifecycle.addObserver(ambientObserver)
    refreshAssistantRoleStatus()
    if (
      ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
      PackageManager.PERMISSION_GRANTED
    ) {
      viewModel.onPermissionGranted()
    }
    setContent {
      val state by viewModel.state.collectAsState()
      val assistantRoleStatus by assistantRoleStatusState
      val ambientDetails by ambientDetailsState
      KeepScreenOn(window, state.keepsScreenAwake)
      OpenClawWearTheme {
        WatchFace(
          viewModel = viewModel,
          onRequestMicPermission = { requestMicPermission() },
          assistantRoleAvailable = assistantRoleStatus.available,
          assistantRoleHeld = assistantRoleStatus.held,
          onRequestAssistantRole = { requestAssistantRole() },
          ambientDetails = ambientDetails,
        )
      }
    }
    lifecycleScope.launch {
      repeatOnLifecycle(Lifecycle.State.RESUMED) {
        AssistantTrustedStartBridge.requests.collect {
          if (AssistantTrustedStartBridge.consumePendingStart()) {
            handleTrustedAssistantStart()
          }
        }
      }
    }
    handleAssistantIntent(intent)
    consumeTrustedAssistantStartIfPending()
    handleDebugIntent(intent)
  }

  override fun onDestroy() {
    if (::ambientObserver.isInitialized) {
      lifecycle.removeObserver(ambientObserver)
    }
    super.onDestroy()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    if (isAssistantLaunchIntent(intent)) {
      Log.d(WatchApp.TAG, "assistant intent foregrounded existing activity")
    }
    consumeTrustedAssistantStartIfPending()
    handleDebugIntent(intent)
  }

  override fun onResume() {
    super.onResume()
    refreshAssistantRoleStatus()
    consumeTrustedAssistantStartIfPending()
    if (pendingAssistantStart) {
      pendingAssistantStart = false
      handleTrustedAssistantStart()
    }
  }

  override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    outState.putBoolean(STATE_PENDING_ASSISTANT_START, pendingPermissionContinuation != null)
  }

  override fun onRestoreInstanceState(savedInstanceState: Bundle) {
    super.onRestoreInstanceState(savedInstanceState)
    if (savedInstanceState.getBoolean(STATE_PENDING_ASSISTANT_START, false)) {
      pendingAssistantStart = true
    }
  }

  private fun requestMicPermission() {
    when {
      ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
        PackageManager.PERMISSION_GRANTED -> {
        viewModel.onPermissionGranted()
      }
      else -> {
        micPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
      }
    }
  }

  private suspend fun requestMicPermissionIfMissing(): Boolean {
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
      PackageManager.PERMISSION_GRANTED
    ) {
      viewModel.onPermissionGranted()
      return true
    }
    val deferred =
      pendingPermissionContinuation
        ?: CompletableDeferred<Boolean>().also {
          pendingPermissionContinuation = it
          micPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    return try {
      val granted =
        withTimeoutOrNull(MIC_PERMISSION_TIMEOUT_MS) {
          deferred.await()
        }
      if (granted == null && pendingPermissionContinuation === deferred) {
        deferred.complete(false)
        return false
      }
      granted ?: false
    } finally {
      if (pendingPermissionContinuation === deferred && deferred.isCompleted) {
        pendingPermissionContinuation = null
      }
    }
  }

  private fun onMicPermissionResult(isGranted: Boolean) {
    if (isGranted) {
      viewModel.onPermissionGranted()
    } else {
      viewModel.onPermissionDenied()
    }
    pendingPermissionContinuation?.complete(isGranted)
  }

  private fun handleAssistantIntent(intent: Intent?) {
    val status = assistantRoleStatusState.value
    if (!isAssistantLaunchIntent(intent)) return
    if (!status.held) {
      Log.d(WatchApp.TAG, "assistant intent foregrounded activity without held role")
      return
    }
    Log.d(WatchApp.TAG, "assistant intent foregrounded activity")
  }

  private fun handleTrustedAssistantStart() {
    val status = assistantRoleStatusState.value
    if (!status.held) {
      Log.d(WatchApp.TAG, "trusted assistant start ignored without held role")
      return
    }
    Log.d(WatchApp.TAG, "trusted assistant session auto-starting dictation")
    lifecycleScope.launch {
      if (requestMicPermissionIfMissing()) {
        viewModel.onAssistantInvocation()
      }
    }
  }

  private fun consumeTrustedAssistantStartIfPending() {
    if (AssistantTrustedStartBridge.consumePendingStart()) {
      handleTrustedAssistantStart()
    }
  }

  private fun requestAssistantRole() {
    val roleRequest = createAssistantRoleRequestIntent(this) ?: return
    runCatching {
      assistantRoleLauncher.launch(roleRequest)
    }.onFailure { err ->
      Log.w(WatchApp.TAG, "assistant role request unavailable: ${err.message}")
      refreshAssistantRoleStatus()
    }
  }

  private fun refreshAssistantRoleStatus() {
    assistantRoleStatusState.value = assistantRoleStatus(this)
  }

  private fun handleDebugIntent(intent: Intent?) {
    if (!Log.isLoggable(DEBUG_TURN_TAG, Log.VERBOSE)) return
    val promptPath = intent?.getStringExtra(EXTRA_DEBUG_PROMPT_PCM_PATH)?.takeIf { it.isNotBlank() }
    val promptUrl = intent?.getStringExtra(EXTRA_DEBUG_PROMPT_PCM_URL)?.takeIf { it.isNotBlank() }
    val endpointPromptPath = intent?.getStringExtra(EXTRA_DEBUG_ENDPOINT_PROMPT_PCM_PATH)?.takeIf { it.isNotBlank() }
    val endpointPromptUrl = intent?.getStringExtra(EXTRA_DEBUG_ENDPOINT_PROMPT_PCM_URL)?.takeIf { it.isNotBlank() }
    val playbackPath = intent?.getStringExtra(EXTRA_DEBUG_PLAYBACK_PCM_PATH)?.takeIf { it.isNotBlank() }
    val playbackUrl = intent?.getStringExtra(EXTRA_DEBUG_PLAYBACK_PCM_URL)?.takeIf { it.isNotBlank() }
    val opusPlaybackPath = intent?.getStringExtra(EXTRA_DEBUG_PLAYBACK_OPUS_PATH)?.takeIf { it.isNotBlank() }
    val opusPlaybackUrl = intent?.getStringExtra(EXTRA_DEBUG_PLAYBACK_OPUS_URL)?.takeIf { it.isNotBlank() }
    if (
      promptPath == null &&
      promptUrl == null &&
      endpointPromptPath == null &&
      endpointPromptUrl == null &&
      playbackPath == null &&
      playbackUrl == null &&
      opusPlaybackPath == null &&
      opusPlaybackUrl == null
    ) {
      return
    }
    lifecycleScope.launch {
      val audioBytes =
        withContext(Dispatchers.IO) {
          runCatching {
            when {
              opusPlaybackUrl != null -> readDebugHttpUrl(opusPlaybackUrl)
              opusPlaybackPath != null -> File(opusPlaybackPath).readBytes()
              playbackUrl != null -> readDebugHttpUrl(playbackUrl)
              playbackPath != null -> File(playbackPath).readBytes()
              endpointPromptUrl != null -> readDebugHttpUrl(endpointPromptUrl)
              endpointPromptPath != null -> File(endpointPromptPath).readBytes()
              promptUrl != null -> readDebugHttpUrl(promptUrl)
              promptPath != null -> File(promptPath).readBytes()
              else -> byteArrayOf()
            }
          }.onFailure { Log.w(DEBUG_TURN_TAG, "debug prompt read failed: ${it.message}") }
            .getOrDefault(byteArrayOf())
        }
      Log.d(DEBUG_TURN_TAG, "debug prompt read bytes=${audioBytes.size} endpoint=${endpointPromptPath != null || endpointPromptUrl != null}")
      if (opusPlaybackPath != null || opusPlaybackUrl != null) {
        viewModel.runDebugCompressedPlayback(audioBytes, ".opus", intent.getStringExtra(EXTRA_DEBUG_RUN_ID))
      } else if (playbackPath != null || playbackUrl != null) {
        viewModel.runDebugPcmPlayback(audioBytes, intent.getStringExtra(EXTRA_DEBUG_RUN_ID))
      } else if (endpointPromptPath != null || endpointPromptUrl != null) {
        viewModel.runDebugEndpointPcmTurn(audioBytes)
      } else {
        viewModel.runDebugPcmTurn(audioBytes)
      }
    }
  }

  private fun readDebugHttpUrl(promptUrl: String): ByteArray {
    val uri = URI(promptUrl)
    check(uri.scheme == "http" || uri.scheme == "https") { "only http/https debug prompt URLs are supported" }
    // SSRF guard: this debug fetch is reachable from any Intent broadcaster on
    // the watch (anyone with permission to launch this activity). Even though
    // the path is gated by Log.isLoggable(DEBUG_TURN_TAG, VERBOSE) (set via
    // `adb shell setprop`), restrict the host to loopback addresses, which is
    // the only realistic shape for adb-forwarded debug prompts. This prevents
    // a malicious or buggy intent from coercing the watch into fetching
    // arbitrary internal URLs (cloud metadata services, on-device services,
    // tailnet hosts, etc.).
    val host = uri.host?.lowercase().orEmpty()
    check(isLoopbackDebugHost(host)) {
      "debug prompt host not in loopback allowlist: $host"
    }
    val connection = uri.toURL().openConnection() as HttpURLConnection
    connection.connectTimeout = 5_000
    connection.readTimeout = 10_000
    connection.requestMethod = "GET"
    connection.instanceFollowRedirects = false
    try {
      check(connection.responseCode == HttpURLConnection.HTTP_OK) {
        "debug prompt fetch failed: HTTP ${connection.responseCode}"
      }
      return connection.inputStream.use { it.readBytes() }
    } finally {
      connection.disconnect()
    }
  }

  private fun isLoopbackDebugHost(host: String): Boolean {
    if (host.isBlank()) return false
    if (host == "localhost" || host == "127.0.0.1" || host == "::1") return true
    // adb-forwarded host on the wear emulator/device side; bracketed IPv6 form
    // shows up as the unbracketed host on URI.host on JVM.
    if (host == "0:0:0:0:0:0:0:1") return true
    return false
  }
}

@Composable
private fun KeepScreenOn(
  window: Window,
  enabled: Boolean,
) {
  DisposableEffect(window, enabled) {
    if (enabled) {
      window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    } else {
      window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
    onDispose {
      window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
  }
}

@Composable
private fun OpenClawWearTheme(content: @Composable () -> Unit) {
  // Wear OS uses the system theme; this is a minimal wrapper.
  content()
}
