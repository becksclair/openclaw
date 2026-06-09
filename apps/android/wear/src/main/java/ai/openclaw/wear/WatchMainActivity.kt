package ai.openclaw.wear

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
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URI

class WatchMainActivity : ComponentActivity() {
  companion object {
    private const val DEBUG_TURN_TAG = "OpenClawWearDebugTurn"
    private const val EXTRA_DEBUG_PROMPT_PCM_PATH = "openclaw.debugPromptPcmPath"
    private const val EXTRA_DEBUG_PROMPT_PCM_URL = "openclaw.debugPromptPcmUrl"
    private const val EXTRA_DEBUG_PLAYBACK_PCM_PATH = "openclaw.debugPlaybackPcmPath"
    private const val EXTRA_DEBUG_PLAYBACK_PCM_URL = "openclaw.debugPlaybackPcmUrl"
    private const val EXTRA_DEBUG_PLAYBACK_OPUS_PATH = "openclaw.debugPlaybackOpusPath"
    private const val EXTRA_DEBUG_PLAYBACK_OPUS_URL = "openclaw.debugPlaybackOpusUrl"
    private const val EXTRA_DEBUG_RUN_ID = "openclaw.debugRunId"
  }

  private val viewModel: WatchViewModel by viewModels()

  private val micPermissionLauncher =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) { isGranted ->
      if (isGranted) {
        viewModel.onPermissionGranted()
      } else {
        viewModel.onPermissionDenied()
      }
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (
      ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
      PackageManager.PERMISSION_GRANTED
    ) {
      viewModel.onPermissionGranted()
    }
    setContent {
      val state by viewModel.state.collectAsState()
      KeepScreenOn(window, state.keepsScreenAwake)
      OpenClawWearTheme {
        WatchFace(
          viewModel = viewModel,
          onRequestMicPermission = { requestMicPermission() },
        )
      }
    }
    handleDebugIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleDebugIntent(intent)
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

  private fun handleDebugIntent(intent: Intent?) {
    if (!Log.isLoggable(DEBUG_TURN_TAG, Log.VERBOSE)) return
    val promptPath = intent?.getStringExtra(EXTRA_DEBUG_PROMPT_PCM_PATH)?.takeIf { it.isNotBlank() }
    val promptUrl = intent?.getStringExtra(EXTRA_DEBUG_PROMPT_PCM_URL)?.takeIf { it.isNotBlank() }
    val playbackPath = intent?.getStringExtra(EXTRA_DEBUG_PLAYBACK_PCM_PATH)?.takeIf { it.isNotBlank() }
    val playbackUrl = intent?.getStringExtra(EXTRA_DEBUG_PLAYBACK_PCM_URL)?.takeIf { it.isNotBlank() }
    val opusPlaybackPath = intent?.getStringExtra(EXTRA_DEBUG_PLAYBACK_OPUS_PATH)?.takeIf { it.isNotBlank() }
    val opusPlaybackUrl = intent?.getStringExtra(EXTRA_DEBUG_PLAYBACK_OPUS_URL)?.takeIf { it.isNotBlank() }
    if (promptPath == null && promptUrl == null && playbackPath == null && playbackUrl == null && opusPlaybackPath == null && opusPlaybackUrl == null) return
    lifecycleScope.launch {
      val audioBytes =
        withContext(Dispatchers.IO) {
          runCatching {
            when {
              opusPlaybackUrl != null -> readDebugHttpUrl(opusPlaybackUrl)
              opusPlaybackPath != null -> File(opusPlaybackPath).readBytes()
              playbackUrl != null -> readDebugHttpUrl(playbackUrl)
              playbackPath != null -> File(playbackPath).readBytes()
              promptUrl != null -> readDebugHttpUrl(promptUrl)
              promptPath != null -> File(promptPath).readBytes()
              else -> byteArrayOf()
            }
          }.onFailure { Log.w(DEBUG_TURN_TAG, "debug prompt read failed: ${it.message}") }
            .getOrDefault(byteArrayOf())
        }
      if (opusPlaybackPath != null || opusPlaybackUrl != null) {
        viewModel.runDebugCompressedPlayback(audioBytes, ".opus", intent.getStringExtra(EXTRA_DEBUG_RUN_ID))
      } else if (playbackPath != null || playbackUrl != null) {
        viewModel.runDebugPcmPlayback(audioBytes, intent.getStringExtra(EXTRA_DEBUG_RUN_ID))
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
