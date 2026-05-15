package ai.openclaw.app

import ai.openclaw.app.voice.RealtimeAudioPlayer
import ai.openclaw.app.voice.RealtimeAudioTrace
import ai.openclaw.app.voice.TalkAudioPlayer
import ai.openclaw.app.voice.TalkSpeakAudio
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.util.Base64
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File
import kotlin.math.PI
import kotlin.math.sin

class DebugAudioTraceReceiver : BroadcastReceiver() {
  override fun onReceive(
    context: Context,
    intent: Intent,
  ) {
    if (intent.action != action) return
    val pending = goAsync()
    val mode =
      intent
        .getStringExtra("mode")
        ?.trim()
        ?.lowercase()
        .orEmpty()
    val durationMs = intent.getIntExtra("durationMs", 1_200).coerceIn(100, 5_000)
    Log.i(tag, "trace requested mode=${mode.ifBlank { "talk" }} durationMs=$durationMs routes=${describeRoutes(context)}")
    CoroutineScope(SupervisorJob() + Dispatchers.Default).launch {
      try {
        val pcm = sinePcm(durationMs = durationMs)
        when (mode) {
          "start-trace" -> startTrace(context, intent)
          "stop-trace" -> stopTrace()
          "inject-talk" -> injectTalkModePrompt(context, intent)
          "inject-talk-text" -> injectTalkModeText(context, intent)
          "realtime" -> playRealtime(pcm)
          else -> playTalk(context, pcm)
        }
        Log.i(tag, "trace playback completed mode=${mode.ifBlank { "talk" }} routes=${describeRoutes(context)}")
      } catch (err: Throwable) {
        Log.e(tag, "trace playback failed: ${err.message ?: err::class.simpleName}", err)
      } finally {
        pending.finish()
      }
    }
  }

  private fun startTrace(
    context: Context,
    intent: Intent,
  ) {
    val files = RealtimeAudioTrace.start(context, name = intent.getStringExtra("name"))
    Log.i(tag, "trace started wav=${files.wavFile.absolutePath} metadata=${files.metadataFile.absolutePath}")
  }

  private fun stopTrace() {
    val files = RealtimeAudioTrace.stop()
    if (files == null) {
      Log.i(tag, "trace stop requested but no trace is active")
      return
    }
    Log.i(tag, "trace stopped wav=${files.wavFile.absolutePath} metadata=${files.metadataFile.absolutePath}")
  }

  private suspend fun injectTalkModePrompt(
    context: Context,
    intent: Intent,
  ) {
    val app = context.applicationContext as? NodeApp ?: error("NodeApp unavailable")
    val runtime = app.ensureRuntime()
    val label = intent.getStringExtra("label")?.trim()?.takeIf { it.isNotEmpty() } ?: "input"
    if (intent.getBooleanExtra("trace", false)) {
      startTrace(context, intent)
    }
    if (intent.getBooleanExtra("enableTalk", true)) {
      runtime.setTalkModeEnabled(true)
    }
    val waitMs = intent.getIntExtra("waitForListeningMs", 15_000).coerceIn(0, 60_000)
    val listening = waitMs <= 0 || waitForTalkModeListening(runtime, waitMs)
    if (!listening) {
      Log.w(tag, "inject-talk continuing before listening; status=${runtime.talkModeStatusText.value}")
    }
    val path = intent.getStringExtra("audioPath")?.trim().orEmpty()
    require(path.isNotEmpty()) { "inject-talk requires audioPath" }
    val pcm = File(path).readBytes()
    val chunkMs = intent.getIntExtra("chunkMs", 20).coerceIn(10, 200)
    val trailingSilenceMs = intent.getIntExtra("trailingSilenceMs", 900).coerceIn(0, 3_000)
    RealtimeAudioTrace.recordEvent(
      "input-start",
      mapOf(
        "label" to label,
        "audioPath" to path,
        "bytes" to pcm.size.toString(),
        "chunkMs" to chunkMs.toString(),
        "trailingSilenceMs" to trailingSilenceMs.toString(),
        "waitForListeningMs" to waitMs.toString(),
        "status" to runtime.talkModeStatusText.value,
      ),
    )
    sendPcmToTalkMode(runtime = runtime, pcm = pcm, chunkMs = chunkMs)
    if (trailingSilenceMs > 0) {
      sendPcmToTalkMode(runtime = runtime, pcm = ByteArray(bytesForDurationMs(trailingSilenceMs)), chunkMs = chunkMs)
    }
    RealtimeAudioTrace.recordEvent(
      "input-end",
      mapOf(
        "label" to label,
        "status" to runtime.talkModeStatusText.value,
      ),
    )
    Log.i(
      tag,
      "inject-talk completed label=$label audioPath=$path bytes=${pcm.size} chunkMs=$chunkMs trailingSilenceMs=$trailingSilenceMs status=${runtime.talkModeStatusText.value}",
    )
  }

  private suspend fun injectTalkModeText(
    context: Context,
    intent: Intent,
  ) {
    val app = context.applicationContext as? NodeApp ?: error("NodeApp unavailable")
    val runtime = app.ensureRuntime()
    val label = intent.getStringExtra("label")?.trim()?.takeIf { it.isNotEmpty() } ?: "input"
    val text = intent.getStringExtra("text")?.trim().orEmpty()
    require(text.isNotEmpty()) { "inject-talk-text requires text" }
    if (intent.getBooleanExtra("trace", false)) {
      startTrace(context, intent)
    }
    if (intent.getBooleanExtra("enableTalk", true)) {
      if (intent.getBooleanExtra("restartTalk", false)) {
        runtime.setTalkModeEnabled(false)
        delay(300)
      }
      val gatewayWaitMs = intent.getIntExtra("waitForGatewayMs", 15_000).coerceIn(0, 60_000)
      val gatewayReady = gatewayWaitMs <= 0 || waitForGatewayConnected(runtime, gatewayWaitMs)
      if (!gatewayReady) {
        recordTextInjectionError(runtime = runtime, label = label, text = text, reason = "gateway-not-connected")
        error("inject-talk-text requires connected gateway; status=${runtime.statusText.value}")
      }
      runtime.setTalkModeEnabled(true)
    }
    val waitMs = intent.getIntExtra("waitForListeningMs", 15_000).coerceIn(0, 60_000)
    val listening = waitMs <= 0 || waitForTalkModeListening(runtime, waitMs)
    if (!listening) {
      Log.w(tag, "inject-talk-text continuing before listening; status=${runtime.talkModeStatusText.value}")
    }
    val realtimeWaitMs = intent.getIntExtra("waitForRealtimeMs", waitMs).coerceIn(0, 60_000)
    val realtimeReady = realtimeWaitMs <= 0 || waitForActiveRealtimeRelay(runtime, realtimeWaitMs)
    if (!realtimeReady) {
      recordTextInjectionError(runtime = runtime, label = label, text = text, reason = "no-active-realtime-relay")
      error(
        "inject-talk-text requires active realtime relay; gateway=${runtime.statusText.value} talk=${runtime.talkModeStatusText.value}",
      )
    }
    RealtimeAudioTrace.recordEvent(
      "input-start",
      mapOf(
        "kind" to "text",
        "label" to label,
        "text" to text,
        "waitForListeningMs" to waitMs.toString(),
        "status" to runtime.talkModeStatusText.value,
      ),
    )
    runtime.debugInjectTalkModeText(text)
    RealtimeAudioTrace.recordEvent(
      "input-end",
      mapOf(
        "kind" to "text",
        "label" to label,
        "status" to runtime.talkModeStatusText.value,
      ),
    )
    Log.i(
      tag,
      "inject-talk-text completed label=$label textLength=${text.length} status=${runtime.talkModeStatusText.value}",
    )
  }

  private fun recordTextInjectionError(
    runtime: NodeRuntime,
    label: String,
    text: String,
    reason: String,
  ) {
    RealtimeAudioTrace.recordEvent(
      "input-error",
      mapOf(
        "kind" to "text",
        "label" to label,
        "textLength" to text.length.toString(),
        "reason" to reason,
        "gatewayStatus" to runtime.statusText.value,
        "talkStatus" to runtime.talkModeStatusText.value,
      ),
    )
  }

  private suspend fun waitForGatewayConnected(
    runtime: NodeRuntime,
    timeoutMs: Int,
  ): Boolean {
    val deadline = android.os.SystemClock.elapsedRealtime() + timeoutMs
    while (android.os.SystemClock.elapsedRealtime() < deadline) {
      if (runtime.isConnected.value) {
        return true
      }
      delay(100)
    }
    return false
  }

  private suspend fun waitForActiveRealtimeRelay(
    runtime: NodeRuntime,
    timeoutMs: Int,
  ): Boolean {
    val deadline = android.os.SystemClock.elapsedRealtime() + timeoutMs
    while (android.os.SystemClock.elapsedRealtime() < deadline) {
      if (runtime.hasActiveTalkModeRealtimeRelay()) {
        return true
      }
      delay(100)
    }
    return false
  }

  private suspend fun waitForTalkModeListening(
    runtime: NodeRuntime,
    timeoutMs: Int,
  ): Boolean {
    val deadline = android.os.SystemClock.elapsedRealtime() + timeoutMs
    while (android.os.SystemClock.elapsedRealtime() < deadline) {
      if (runtime.talkModeListening.value) {
        return true
      }
      delay(100)
    }
    return false
  }

  private suspend fun sendPcmToTalkMode(
    runtime: NodeRuntime,
    pcm: ByteArray,
    chunkMs: Int,
  ) {
    val chunkBytes = bytesForDurationMs(chunkMs).coerceAtLeast(2)
    var offset = 0
    while (offset < pcm.size) {
      val end = minOf(offset + chunkBytes, pcm.size)
      val chunk = pcm.copyOfRange(offset, end)
      runtime.debugInjectTalkModeAudioBase64(Base64.encodeToString(chunk, Base64.NO_WRAP))
      offset = end
      delay(chunkMs.toLong())
    }
  }

  private suspend fun playTalk(
    context: Context,
    pcm: ByteArray,
  ) {
    TalkAudioPlayer(context).play(
      TalkSpeakAudio(
        bytes = pcm,
        provider = "debug",
        outputFormat = "pcm_24000",
        voiceCompatible = null,
        mimeType = null,
        fileExtension = null,
      ),
    )
  }

  private suspend fun playRealtime(pcm: ByteArray) {
    val player = RealtimeAudioPlayer(sampleRateHz = sampleRateHz)
    try {
      player.start()
      player.writeBase64(Base64.encodeToString(pcm, Base64.NO_WRAP))
      player.waitUntilDrained(timeoutMs = 5_000)
    } finally {
      player.stop()
    }
  }

  private fun sinePcm(durationMs: Int): ByteArray {
    val samples = sampleRateHz * durationMs / 1_000
    val bytes = ByteArray(samples * 2)
    for (i in 0 until samples) {
      val sample = (sin(2.0 * PI * 440.0 * i / sampleRateHz) * Short.MAX_VALUE * 0.25).toInt()
      bytes[i * 2] = (sample and 0xff).toByte()
      bytes[i * 2 + 1] = ((sample ushr 8) and 0xff).toByte()
    }
    return bytes
  }

  private fun bytesForDurationMs(durationMs: Int): Int = sampleRateHz * 2 * durationMs / 1_000

  private fun describeRoutes(context: Context): String {
    val audio = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return "audio-manager-unavailable"
    val outputs =
      audio
        .getDevices(AudioManager.GET_DEVICES_OUTPUTS)
        .filter { it.isSink }
        .joinToString(separator = ";") { device ->
          "${device.typeName}:${device.productName}"
        }
    return "mode=${audio.mode} musicVolume=${audio.getStreamVolume(AudioManager.STREAM_MUSIC)} outputs=[$outputs]"
  }

  private val AudioDeviceInfo.typeName: String
    get() =
      when (type) {
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "speaker"
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> "bt_a2dp"
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "bt_sco"
        AudioDeviceInfo.TYPE_BLE_HEADSET -> "ble_headset"
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "wired_headphones"
        AudioDeviceInfo.TYPE_WIRED_HEADSET -> "wired_headset"
        AudioDeviceInfo.TYPE_USB_HEADSET -> "usb_headset"
        else -> "type_$type"
      }

  private companion object {
    private const val action = "ai.openclaw.app.DEBUG_AUDIO_TRACE"
    private const val sampleRateHz = 24_000
    private const val tag = "OpenClawAudioTrace"
  }
}
