package ai.openclaw.wear.ui

import ai.openclaw.common.wear.WearReasoningLevel
import ai.openclaw.wear.ROTARY_CONTROL_MODE_MEDIA_VOLUME
import ai.openclaw.wear.ROTARY_CONTROL_MODE_TTS_GAIN
import ai.openclaw.wear.VolumeOverlayState
import ai.openclaw.wear.WatchViewModel
import ai.openclaw.wear.formatTtsPlaybackGain
import ai.openclaw.wear.ambient.AmbientDetails
import android.os.SystemClock
import android.view.HapticFeedbackConstants
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.pager.HorizontalPager
import androidx.wear.compose.foundation.pager.rememberPagerState
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import kotlinx.coroutines.delay
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

private val SettingsGroupColor = Color(0xFF171B21)
private val SettingsGroupBorderColor = Color.White.copy(alpha = 0.12f)
private val SettingsValueColor = Color(0xFF76D7FF)
private val WatchTimeFormatter: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")
private const val TWO_PI = (Math.PI * 2.0).toFloat()
private const val ORB_SPEECH_WAVE_DURATION_MS = 1_650L
private const val ORB_SPEECH_WAVE_COOLDOWN_MS = 520L
private const val ORB_SPEECH_MAX_WAVES = 3
private const val ORB_SPEECH_WAVE_THRESHOLD = 0.14f

private data class OrbSpeechWave(
  val startedAtMillis: Long,
  val strength: Float,
)

private enum class SettingsPane {
  Main,
  Reasoning,
  RingControl,
}

private data class SettingsPaneTarget(
  val pane: SettingsPane,
  val depth: Int,
)

private const val SETTINGS_BACK_SWIPE_THRESHOLD_PX = 80f
private const val SETTINGS_STACK_ANIMATION_MS = 180

/** Resolves the burn-in offset for the given [AmbientDetails], returning 0.dp when not required. */
internal fun resolvedBurnInOffsetDp(ambientDetails: AmbientDetails): Dp =
  when {
    ambientDetails.burnInProtectionRequired -> burnInOffsetDp(ambientDetails.tick)
    else -> 0.dp
  }

@Composable
fun WatchFace(
  viewModel: WatchViewModel,
  onRequestMicPermission: () -> Unit,
  assistantRoleAvailable: Boolean = false,
  assistantRoleHeld: Boolean = false,
  onRequestAssistantRole: () -> Unit = {},
  ambientDetails: AmbientDetails = AmbientDetails(),
) {
  if (ambientDetails.isAmbient) {
    Column(
      modifier = Modifier.fillMaxSize().padding(16.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.Center,
    ) {
      val state by viewModel.state.collectAsState()
      val statusText by viewModel.statusText.collectAsState()
      AmbientStatusText(
        text = ambientStatusText(state, statusText),
        ambientDetails = ambientDetails,
      )
    }
    return
  }

  val pagerState = rememberPagerState(pageCount = { 2 })
  val mainFocusRequester = remember { FocusRequester() }
  val settingsFocusRequester = remember { FocusRequester() }
  var settingsSubmenuOpen by remember { mutableStateOf(false) }
  LaunchedEffect(pagerState.currentPage) {
    when (pagerState.currentPage) {
      0 -> {
        settingsSubmenuOpen = false
        mainFocusRequester.requestFocus()
      }
      else -> settingsFocusRequester.requestFocus()
    }
  }
  Box(
    modifier = Modifier.fillMaxSize(),
  ) {
    HorizontalPager(
      state = pagerState,
      modifier = Modifier.fillMaxSize(),
      userScrollEnabled = !settingsSubmenuOpen,
    ) { page ->
      when (page) {
        0 -> {
          val view = LocalView.current
          Column(
            modifier =
              Modifier
                .fillMaxSize()
                .background(Color.Black)
                .focusRequester(mainFocusRequester)
                .onRotaryScrollEvent { event ->
                  if (viewModel.onRotaryVolumeDelta(event.verticalScrollPixels)) {
                    view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                  }
                  true
                }
                .focusable()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
          ) {
            InteractiveWatchFace(
              viewModel = viewModel,
              onRequestMicPermission = onRequestMicPermission,
              assistantRoleAvailable = assistantRoleAvailable,
              assistantRoleHeld = assistantRoleHeld,
              onRequestAssistantRole = onRequestAssistantRole,
            )
          }
        }
        else ->
          WatchSettingsPage(
            viewModel = viewModel,
            focusRequester = settingsFocusRequester,
            onSubmenuOpenChange = { settingsSubmenuOpen = it },
          )
      }
    }
    val overlay by viewModel.volumeOverlay.collectAsState()
    VolumeOverlay(overlay = overlay, modifier = Modifier.align(Alignment.Center))
  }
}

@Composable
private fun InteractiveWatchFace(
  viewModel: WatchViewModel,
  onRequestMicPermission: () -> Unit,
  assistantRoleAvailable: Boolean,
  assistantRoleHeld: Boolean,
  onRequestAssistantRole: () -> Unit,
) {
  val state by viewModel.state.collectAsState()
  val statusText by viewModel.statusText.collectAsState()
  val hasMicPermission by viewModel.hasMicPermission.collectAsState()
  val voiceActivity by viewModel.voiceActivity.collectAsState()

  MainOrbFace(
    state = state,
    statusText = statusText,
    hasMicPermission = hasMicPermission,
    voiceActivity = voiceActivity,
    onPrimaryClick =
      when {
        !hasMicPermission && state == WatchViewModel.WatchState.Idle -> onRequestMicPermission
        state == WatchViewModel.WatchState.Idle || state == WatchViewModel.WatchState.CheckingPhone -> {
          { viewModel.onMicButtonDown() }
        }
        state == WatchViewModel.WatchState.Error -> {
          { viewModel.onRetry() }
        }
        else -> {
          { viewModel.onCancelTurn() }
        }
      },
    assistantRoleAvailable = assistantRoleAvailable,
    assistantRoleHeld = assistantRoleHeld,
    onRequestAssistantRole = onRequestAssistantRole,
  )
}

@Composable
private fun MainOrbFace(
  state: WatchViewModel.WatchState,
  statusText: String,
  hasMicPermission: Boolean,
  voiceActivity: Float,
  onPrimaryClick: () -> Unit,
  assistantRoleAvailable: Boolean,
  assistantRoleHeld: Boolean,
  onRequestAssistantRole: () -> Unit,
) {
  val errorTint = state == WatchViewModel.WatchState.Error
  val showTopActionLabel = mainActionLabelMovesToTop(state, statusText)
  Box(
    modifier =
      Modifier
        .fillMaxSize()
        .drawBehind {
          if (!errorTint) return@drawBehind
          val sceneCenter = Offset(size.width / 2f, size.height * 0.48f)
          drawCircle(
            brush =
              Brush.radialGradient(
                colors =
                  listOf(
                    Color(0xFFFF365F).copy(alpha = 0.34f),
                    Color(0xFF8F102C).copy(alpha = 0.18f),
                    Color(0xFF210007).copy(alpha = 0.1f),
                    Color.Transparent,
                  ),
                center = sceneCenter,
                radius = size.minDimension * 0.78f,
              ),
            radius = size.minDimension * 0.78f,
            center = sceneCenter,
          )
        },
  ) {
    Column(
      modifier = Modifier.fillMaxSize().offset(y = (-8).dp),
      horizontalAlignment = Alignment.CenterHorizontally,
    ) {
      WatchTimeText()
      if (showTopActionLabel) {
        Text(
          text = mainActionLabel(state, hasMicPermission),
          style = MaterialTheme.typography.caption2.copy(fontSize = 11.sp),
          textAlign = TextAlign.Center,
          color = Color(0xFFB6A7FF),
          maxLines = 1,
          modifier = Modifier.fillMaxWidth(),
        )
        Spacer(modifier = Modifier.height(1.dp))
      } else {
        Spacer(modifier = Modifier.height(4.dp))
      }
      VoiceOrb(
        state = state,
        voiceActivity = voiceActivity,
        modifier =
          Modifier
            .width(186.dp)
            .height(184.dp)
            .hapticClickable(onClick = onPrimaryClick),
      )
      AssistantRoleButton(
        available = assistantRoleAvailable,
        held = assistantRoleHeld,
        onClick = onRequestAssistantRole,
      )
    }
    Column(
      modifier =
        Modifier
          .align(Alignment.BottomCenter)
          .offset(y = mainStatusBottomOffset(state, statusText))
          .fillMaxWidth()
          .padding(horizontal = mainStatusHorizontalPadding(state, statusText), vertical = 0.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
    ) {
      Text(
        text = mainStatusLabel(state, statusText, hasMicPermission),
        style = MaterialTheme.typography.caption1.copy(fontSize = 14.sp),
        textAlign = TextAlign.Center,
        color = if (state == WatchViewModel.WatchState.Error) MaterialTheme.colors.error else Color.White,
        maxLines = mainStatusMaxLines(state, statusText),
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.fillMaxWidth(),
      )
      if (!showTopActionLabel) {
        Text(
          text = mainActionLabel(state, hasMicPermission),
          style = MaterialTheme.typography.caption2.copy(fontSize = 12.sp),
          textAlign = TextAlign.Center,
          color = if (errorTint) Color(0xFFFF9CB0) else Color(0xFFB6A7FF),
          maxLines = 1,
          modifier = Modifier.fillMaxWidth(),
        )
      }
    }
  }
}

@Composable
private fun WatchTimeText() {
  var currentTime by remember { mutableStateOf(currentWatchTime()) }
  LaunchedEffect(Unit) {
    while (true) {
      delay(30_000)
      currentTime = currentWatchTime()
    }
  }
  Text(
    text = currentTime,
    style = MaterialTheme.typography.body2.copy(fontSize = 14.sp, fontWeight = FontWeight.SemiBold),
    textAlign = TextAlign.Center,
    color = Color.White.copy(alpha = 0.84f),
    modifier = Modifier.fillMaxWidth(),
  )
}

private fun currentWatchTime(): String = LocalTime.now().format(WatchTimeFormatter)

internal fun mainStatusLabel(
  state: WatchViewModel.WatchState,
  statusText: String,
  hasMicPermission: Boolean,
): String =
  when {
    !hasMicPermission && state == WatchViewModel.WatchState.Idle -> "Allow microphone"
    state == WatchViewModel.WatchState.Idle -> "Ready"
    state == WatchViewModel.WatchState.CheckingPhone -> "Connecting..."
    state == WatchViewModel.WatchState.Recording -> statusText.ifBlank { "Listening..." }
    state == WatchViewModel.WatchState.Processing -> "Thinking..."
    state == WatchViewModel.WatchState.Playing -> "Speaking..."
    state == WatchViewModel.WatchState.Error -> statusText
    else -> statusText
  }

internal fun mainStatusMaxLines(
  state: WatchViewModel.WatchState,
  statusText: String,
): Int =
  if (mainActionLabelMovesToTop(state, statusText)) {
    3
  } else if (
    state == WatchViewModel.WatchState.Recording &&
      statusText.isNotBlank() &&
      statusText != "Listening..." &&
      statusText != "Processing speech..."
  ) {
    2
  } else {
    1
  }

internal fun mainStatusHorizontalPadding(
  state: WatchViewModel.WatchState,
  statusText: String,
): Dp = if (mainActionLabelMovesToTop(state, statusText)) 36.dp else 8.dp

internal fun mainStatusBottomOffset(
  state: WatchViewModel.WatchState,
  statusText: String,
): Dp = if (mainActionLabelMovesToTop(state, statusText)) (-14).dp else (-4).dp

internal fun mainActionLabelMovesToTop(
  state: WatchViewModel.WatchState,
  statusText: String,
): Boolean =
  if (
    state == WatchViewModel.WatchState.Recording &&
      statusText.isNotBlank() &&
      statusText != "Listening..." &&
      statusText != "Processing speech..."
  ) {
    true
  } else {
    false
  }

internal fun mainActionLabel(
  state: WatchViewModel.WatchState,
  hasMicPermission: Boolean,
): String =
  when {
    !hasMicPermission && state == WatchViewModel.WatchState.Idle -> "Tap to allow"
    state == WatchViewModel.WatchState.Idle -> "Tap to speak"
    state == WatchViewModel.WatchState.CheckingPhone -> "Tap to cancel"
    state == WatchViewModel.WatchState.Error -> "Tap to retry"
    else -> "Tap to cancel"
  }

@Composable
private fun VoiceOrb(
  state: WatchViewModel.WatchState,
  voiceActivity: Float,
  modifier: Modifier = Modifier,
) {
  val activeAudioState =
    state == WatchViewModel.WatchState.Recording ||
      state == WatchViewModel.WatchState.Playing
  val animatedActivity by animateFloatAsState(
    targetValue = voiceActivity.coerceIn(0f, 1f),
    animationSpec = tween(durationMillis = 120, easing = LinearEasing),
    label = "voice-activity",
  )
  val breathing = rememberInfiniteTransition(label = "orb-breathing")
  val breathe by breathing.animateFloat(
    initialValue = 0.0f,
    targetValue = 1.0f,
    animationSpec =
      infiniteRepeatable(
        animation = tween(durationMillis = 1_800, easing = FastOutSlowInEasing),
        repeatMode = RepeatMode.Reverse,
    ),
    label = "orb-breathe",
  )
  val wobblePhase by breathing.animateFloat(
    initialValue = 0.0f,
    targetValue = 1.0f,
    animationSpec =
      infiniteRepeatable(
        animation = tween(durationMillis = 4_200, easing = LinearEasing),
        repeatMode = RepeatMode.Restart,
    ),
    label = "orb-wobble",
  )
  val ringPhase by breathing.animateFloat(
    initialValue = 0.0f,
    targetValue = 1.0f,
    animationSpec =
      infiniteRepeatable(
        animation = tween(durationMillis = 15_200, easing = LinearEasing),
        repeatMode = RepeatMode.Restart,
    ),
    label = "orb-rings",
  )
  val fireflyPhase by breathing.animateFloat(
    initialValue = 0.0f,
    targetValue = 1.0f,
    animationSpec =
      infiniteRepeatable(
        animation = tween(durationMillis = 18_000, easing = LinearEasing),
        repeatMode = RepeatMode.Restart,
    ),
    label = "orb-fireflies",
  )
  val basePulse =
    when {
      state == WatchViewModel.WatchState.Processing -> 0.16f + breathe * 0.16f
      activeAudioState -> breathe * 0.04f
      else -> breathe * 0.08f
    }
  val energyPulse = if (activeAudioState) animatedActivity else 0f
  val speechWaves = remember { mutableStateListOf<OrbSpeechWave>() }
  var lastSpeechWaveAtMillis by remember { mutableStateOf(0L) }
  LaunchedEffect(activeAudioState, energyPulse, ringPhase) {
    val now = SystemClock.uptimeMillis()
    speechWaves.removeAll { now - it.startedAtMillis > ORB_SPEECH_WAVE_DURATION_MS }
    if (!activeAudioState) {
      speechWaves.clear()
      lastSpeechWaveAtMillis = 0L
      return@LaunchedEffect
    }
    if (
      energyPulse >= ORB_SPEECH_WAVE_THRESHOLD &&
        now - lastSpeechWaveAtMillis >= ORB_SPEECH_WAVE_COOLDOWN_MS
    ) {
      speechWaves.add(
        OrbSpeechWave(
          startedAtMillis = now,
          strength = energyPulse.coerceIn(0.16f, 1f),
        ),
      )
      while (speechWaves.size > ORB_SPEECH_MAX_WAVES) {
        speechWaves.removeAt(0)
      }
      lastSpeechWaveAtMillis = now
    }
  }
  val errorTint = state == WatchViewModel.WatchState.Error
  Canvas(modifier = modifier) {
    val center = Offset(size.width / 2f, size.height / 2f)
    val orbBasis = size.width.coerceAtMost(size.height * 0.89f)
    val radius = orbBasis * (0.27f + basePulse * 0.018f)
    val glowRadius = orbBasis * (0.72f + basePulse * 0.08f)
    val wobblePath = orbWobblePath(
      center = center,
      radius = radius,
      phase = wobblePhase,
      intensity = 0.018f + basePulse * 0.018f,
    )
    drawCircle(
      brush =
        Brush.radialGradient(
          colors =
            listOf(
              if (errorTint) Color(0xFFFF9CB0).copy(alpha = 0.46f) else Color(0xFF8CF9FF).copy(alpha = 0.52f),
              if (errorTint) Color(0xFFFF315D).copy(alpha = 0.32f) else Color(0xFF1D8CFF).copy(alpha = 0.34f),
              if (errorTint) Color(0xFFB3092F).copy(alpha = 0.18f) else Color(0xFF143DFF).copy(alpha = 0.18f),
              Color.Transparent,
            ),
          center = center,
          radius = glowRadius,
        ),
      radius = glowRadius,
      center = center,
    )
    drawOrbFireflies(center, radius, fireflyPhase, basePulse, errorTint)
    repeat(4) { index ->
      val progress = (ringPhase + index / 4f) % 1f
      drawOrbRingPulse(
        center = center,
        radius = radius,
        progress = progress,
        basePulse = basePulse,
        scale = 0.95f + index * 0.012f,
        brightness = 0.72f + 0.08f * sin(index * 1.73f),
        frontLayer = false,
        errorTint = errorTint,
      )
    }
    drawOrbContactGlow(center, radius, basePulse, errorTint)
    drawOrbGlowStroke(
      center = center,
      radius = radius,
      phase = wobblePhase,
      basePulse = basePulse,
      errorTint = errorTint,
    )
    clipPath(wobblePath) {
      drawRect(
        brush =
          Brush.radialGradient(
            colors =
              listOf(
                Color.White.copy(alpha = 0.92f),
                if (errorTint) Color(0xFFFFB1C0) else Color(0xFFBDF8FF),
                if (errorTint) Color(0xFFFF557A) else Color(0xFF347CFF),
                if (errorTint) Color(0xFFA6002A).copy(alpha = 0.48f) else Color(0xFF1232D8).copy(alpha = 0.48f),
                Color.Transparent,
              ),
            center = Offset(center.x - radius * 0.28f, center.y + radius * 0.24f),
            radius = radius * 1.52f,
          ),
      )
      drawCircle(
        brush =
          Brush.radialGradient(
            colors = listOf(Color.White.copy(alpha = 0.88f), Color.Transparent),
            center = Offset(center.x - radius * 0.43f, center.y - radius * 0.44f),
            radius = radius * 0.55f,
          ),
        radius = radius * 0.58f,
        center = Offset(center.x - radius * 0.34f, center.y - radius * 0.35f),
      )
    }
    drawOrbSpeechHaloPulses(
      center = center,
      radius = radius,
      waves = speechWaves,
      nowMillis = SystemClock.uptimeMillis(),
      errorTint = errorTint,
    )
    repeat(4) { index ->
      val progress = (ringPhase + index / 4f) % 1f
      drawOrbRingPulse(
        center = center,
        radius = radius,
        progress = progress,
        basePulse = basePulse,
        scale = 0.95f + index * 0.012f,
        brightness = 0.72f + 0.08f * sin(index * 1.73f),
        frontLayer = true,
        errorTint = errorTint,
      )
    }
  }
}

private fun orbWobblePath(
  center: Offset,
  radius: Float,
  phase: Float,
  intensity: Float,
): Path {
  val pointCount = 16
  val points =
    List(pointCount) { index ->
      val angle = index / pointCount.toFloat() * TWO_PI
      val wobble =
        1f +
          intensity * sin(angle * 3f + phase * TWO_PI) +
          intensity * 0.62f * cos(angle * 5f - phase * TWO_PI * 0.73f)
      Offset(
        x = center.x + cos(angle) * radius * wobble,
        y = center.y + sin(angle) * radius * wobble,
      )
    }
  return Path().apply {
    val first = points.first()
    moveTo(first.x, first.y)
    points.forEachIndexed { index, current ->
      val next = points[(index + 1) % pointCount]
      quadraticTo(
        current.x,
        current.y,
        current.x + (next.x - current.x) * 0.5f,
        current.y + (next.y - current.y) * 0.5f,
      )
    }
    close()
  }
}

private fun DrawScope.drawOrbGlowStroke(
  center: Offset,
  radius: Float,
  phase: Float,
  basePulse: Float,
  errorTint: Boolean,
) {
  val path = orbWobblePath(
    center = Offset(center.x - radius * 0.07f, center.y + radius * 0.08f),
    radius = radius,
    phase = phase,
    intensity = 0.018f + basePulse * 0.018f,
  )
  val outerColor = if (errorTint) Color(0xFFFF9CB0) else Color(0xFF8CEFFF)
  val innerColor = if (errorTint) Color(0xFFFF557A) else Color(0xFF315CFF)
  drawPath(
    path = path,
    color = innerColor.copy(alpha = 0.032f + basePulse * 0.012f),
    style = Stroke(width = 16.dp.toPx(), cap = StrokeCap.Round),
  )
  drawPath(
    path = path,
    color = outerColor.copy(alpha = 0.04f + basePulse * 0.014f),
    style = Stroke(width = 9.dp.toPx(), cap = StrokeCap.Round),
  )
  drawPath(
    path = path,
    color = innerColor.copy(alpha = 0.035f + basePulse * 0.012f),
    style = Stroke(width = 4.dp.toPx(), cap = StrokeCap.Round),
  )
}

private fun DrawScope.drawOrbFireflies(
  center: Offset,
  radius: Float,
  phase: Float,
  basePulse: Float,
  errorTint: Boolean,
) {
  repeat(9) { index ->
    val seed = index + 1f
    val orbit = radius * (1.18f + 0.42f * ((index % 3) / 2f))
    val direction = if (index % 2 == 0) 1f else -1f
    val angle = direction * phase * TWO_PI + seed * 2.17f
    val verticalCycle = if (index % 3 == 0) 2f else 1f
    val drift = sin(phase * TWO_PI * verticalCycle + seed) * radius * 0.16f
    val x = center.x + cos(angle) * orbit
    val y = center.y + sin(angle) * orbit * 0.72f + drift
    val sparkleCycle = 2f + (index % 2)
    val sparkle = (0.5f + 0.5f * sin(phase * TWO_PI * sparkleCycle + seed * 1.9f)).coerceIn(0f, 1f)
    val alpha = (0.08f + sparkle * 0.2f + basePulse * 0.06f).coerceIn(0f, 0.34f)
    val dotRadius = (1.3f + sparkle * 1.8f + (index % 2) * 0.6f).dp.toPx()
    val dotCenter = Offset(x, y)
    val coreColor =
      if (errorTint) {
        Color(0xFFFFC1CE)
      } else if (index % 3 == 0) {
        Color(0xFFB7A7FF)
      } else {
        Color(0xFF9CFBFF)
      }
    drawCircle(
      brush =
        Brush.radialGradient(
          colors =
            listOf(
              coreColor.copy(alpha = alpha),
              coreColor.copy(alpha = alpha * 0.36f),
              Color.Transparent,
            ),
          center = dotCenter,
          radius = dotRadius * 3.2f,
        ),
      radius = dotRadius * 3.2f,
      center = dotCenter,
    )
    drawCircle(
      color = coreColor.copy(alpha = alpha * 0.82f),
      radius = dotRadius * 0.46f,
      center = dotCenter,
    )
  }
}

private fun DrawScope.drawOrbSpeechHaloPulses(
  center: Offset,
  radius: Float,
  waves: List<OrbSpeechWave>,
  nowMillis: Long,
  errorTint: Boolean,
) {
  if (waves.isEmpty()) return
  val stackAlphaScale = if (waves.size > 1) 0.82f else 1f
  waves.forEach { wave ->
    drawOrbSpeechHaloPulse(
      center = center,
      radius = radius,
      wave = wave,
      nowMillis = nowMillis,
      alphaScale = stackAlphaScale,
      errorTint = errorTint,
    )
  }
}

private fun DrawScope.drawOrbSpeechHaloPulse(
  center: Offset,
  radius: Float,
  wave: OrbSpeechWave,
  nowMillis: Long,
  alphaScale: Float,
  errorTint: Boolean,
) {
  val ageMillis = nowMillis - wave.startedAtMillis
  if (ageMillis !in 0..ORB_SPEECH_WAVE_DURATION_MS) return
  val progress = ageMillis / ORB_SPEECH_WAVE_DURATION_MS.toFloat()
  val attack = (progress / 0.14f).coerceIn(0f, 1f)
  val decay = (1f - progress).coerceIn(0f, 1f)
  val alpha = (wave.strength * attack * decay * 0.72f * alphaScale).coerceIn(0f, 0.42f)
  if (alpha <= 0.01f) return

  val color = if (errorTint) Color(0xFFFFC1CE) else Color(0xFF92FFE8)
  val plasmaCore = if (errorTint) Color(0xFFFFE1E8) else Color(0xFFE6FF78)
  val plasmaFog = if (errorTint) Color(0xFFFFC1CE) else Color(0xFF79FF68)
  val waveRadius = radius * (0.98f + progress * 1.42f)
  val path = orbWobblePath(
    center = center,
    radius = waveRadius,
    phase = progress,
    intensity = 0.025f + wave.strength * 0.018f,
  )
  drawCircle(
    brush =
      Brush.radialGradient(
        colors =
          listOf(
            plasmaCore.copy(alpha = alpha * 0.22f),
            plasmaFog.copy(alpha = if (errorTint) alpha * 0.04f else alpha * 0.11f),
            Color(0xFF315CFF).copy(alpha = alpha * 0.05f),
            Color.Transparent,
          ),
        center = Offset(center.x - radius * 0.05f, center.y + radius * 0.02f),
        radius = radius * (1.0f + progress * 0.6f),
      ),
    radius = radius * (1.0f + progress * 0.6f),
    center = Offset(center.x - radius * 0.05f, center.y + radius * 0.02f),
  )
  drawPath(
    path = path,
    color = color.copy(alpha = alpha * 0.025f),
    style = Stroke(width = (18.0f + decay * 6.0f).dp.toPx(), cap = StrokeCap.Round),
  )
  drawPath(
    path = path,
    color = color.copy(alpha = alpha * 0.04f),
    style = Stroke(width = (7.0f + decay * 3.0f).dp.toPx(), cap = StrokeCap.Round),
  )
  drawPath(
    path = path,
    color = color.copy(alpha = alpha * 0.035f),
    style = Stroke(width = (1.2f + decay * 0.8f).dp.toPx(), cap = StrokeCap.Round),
  )
  drawOrbSpeechFilaments(
    center = center,
    radius = radius,
    progress = progress,
    strength = wave.strength,
    alpha = alpha,
    errorTint = errorTint,
  )
}

private fun DrawScope.drawOrbSpeechFilaments(
  center: Offset,
  radius: Float,
  progress: Float,
  strength: Float,
  alpha: Float,
  errorTint: Boolean,
) {
  val filamentColor = if (errorTint) Color(0xFFFFC1CE) else Color(0xFF92FFE8)
  val accentColor = if (errorTint) Color(0xFFFFE1E8) else Color(0xFFE6FF78)
  val fogColor = if (errorTint) Color(0xFFFFC1CE) else Color(0xFF79FF68)
  val cloudAlpha = (alpha * (0.7f + strength * 0.34f)).coerceIn(0f, 0.32f)
  repeat(12) { index ->
    val seed = index + 1f
    val angle = seed * 2.17f + progress * 0.22f * if (index % 2 == 0) 1f else -1f
    val cloudCenter = Offset(
      x = center.x + cos(angle) * radius * (0.28f + progress * 0.46f + 0.08f * sin(seed)),
      y = center.y + sin(angle + seed * 0.31f) * radius * (0.22f + progress * 0.36f),
    )
    val cloudRadius = radius * (0.52f + progress * 0.42f + 0.08f * sin(seed * 1.8f))
    val cloudColor = when (index % 4) {
      0 -> accentColor
      1 -> fogColor
      else -> filamentColor
    }
    drawCircle(
      brush =
        Brush.radialGradient(
          colors =
            listOf(
              cloudColor.copy(alpha = cloudAlpha * 0.22f),
              cloudColor.copy(alpha = cloudAlpha * 0.08f),
              Color.Transparent,
            ),
          center = cloudCenter,
          radius = cloudRadius,
        ),
      radius = cloudRadius,
      center = cloudCenter,
    )
  }
  repeat(4) { index ->
    val seed = index + 1f
    val direction = if (index % 2 == 0) 1f else -1f
    val angle = seed * 1.74f + progress * (0.18f + seed * 0.01f) * direction
    val startRadius = radius * (0.54f + 0.12f * sin(seed * 1.4f))
    val midRadius = radius * (0.9f + progress * (0.68f + 0.14f * sin(seed * 2.1f)))
    val endRadius = radius * (1.14f + progress * (1.2f + 0.16f * sin(seed * 2.3f)))
    val curl = radius * (0.3f + 0.1f * cos(seed * 1.4f)) * (0.45f + progress * 0.7f)
    val start = Offset(
      x = center.x + cos(angle) * startRadius,
      y = center.y + sin(angle) * startRadius,
    )
    val mid = Offset(
      x = center.x + cos(angle + sin(seed) * 0.38f) * midRadius,
      y = center.y + sin(angle + cos(seed) * 0.26f) * midRadius,
    )
    val end = Offset(
      x = center.x + cos(angle + sin(seed) * 0.42f) * endRadius,
      y = center.y + sin(angle + cos(seed) * 0.36f) * endRadius,
    )
    val controlOne = Offset(
      x = center.x + cos(angle + 0.72f) * (radius + curl),
      y = center.y + sin(angle + 0.72f) * (radius * 0.78f + curl),
    )
    val controlTwo = Offset(
      x = center.x + cos(angle - 0.62f) * (endRadius - curl * 0.25f),
      y = center.y + sin(angle - 0.62f) * (endRadius * 0.78f),
    )
    val filamentPath =
      Path().apply {
        moveTo(start.x, start.y)
        cubicTo(controlOne.x, controlOne.y, controlTwo.x, controlTwo.y, end.x, end.y)
      }
    val filamentAlpha = (alpha * (0.18f + strength * 0.12f) * (0.42f + 0.16f * sin(seed * 2.9f))).coerceIn(0f, 0.07f)
    if (filamentAlpha <= 0.008f) return@repeat
    drawPath(
      path = filamentPath,
      color = fogColor.copy(alpha = filamentAlpha * 0.2f),
      style = Stroke(width = (2.0f + 1.0f * (1f - progress)).dp.toPx(), cap = StrokeCap.Round),
    )
    drawPath(
      path = filamentPath,
      color = if (index % 3 == 0) {
        accentColor.copy(alpha = filamentAlpha * 0.42f)
      } else {
        filamentColor.copy(alpha = filamentAlpha * 0.46f)
      },
      style = Stroke(width = (0.35f + 0.45f * (1f - progress)).dp.toPx(), cap = StrokeCap.Round),
    )
  }
  repeat(72) { index ->
    val seed = index + 3f
    val angle = seed * 2.399f + progress * 0.2f * if (index % 2 == 0) 1f else -1f
    val sparkleRadius = radius * (0.48f + progress * (1.45f + 0.18f * sin(seed)) + 0.28f * abs(sin(seed * 0.73f)))
    val dotCenter = Offset(
      x = center.x + cos(angle) * sparkleRadius,
      y = center.y + sin(angle + cos(seed) * 0.18f) * sparkleRadius * (0.8f + 0.16f * sin(seed)),
    )
    val sparkleAlpha = (alpha * (0.12f + 0.1f * sin(seed * 1.9f + progress * TWO_PI))).coerceIn(0f, 0.18f)
    if (sparkleAlpha <= 0.008f) return@repeat
    val sparkleColor = when (index % 5) {
      0 -> accentColor
      1 -> fogColor
      else -> filamentColor
    }
    val sparkleSize = (0.62f + (index % 5) * 0.18f).dp.toPx()
    drawCircle(
      brush =
        Brush.radialGradient(
          colors =
            listOf(
              sparkleColor.copy(alpha = sparkleAlpha),
              sparkleColor.copy(alpha = sparkleAlpha * 0.3f),
              Color.Transparent,
            ),
          center = dotCenter,
          radius = sparkleSize * 3.6f,
        ),
      radius = sparkleSize * 3.6f,
      center = dotCenter,
    )
    drawCircle(
      color = sparkleColor.copy(alpha = sparkleAlpha * 0.7f),
      radius = sparkleSize * 0.34f,
      center = dotCenter,
    )
  }
}

private fun DrawScope.drawOrbRingPulse(
  center: Offset,
  radius: Float,
  progress: Float,
  basePulse: Float,
  scale: Float,
  brightness: Float,
  frontLayer: Boolean,
  errorTint: Boolean,
) {
  val attack = (progress / 0.12f).coerceIn(0f, 1f)
  val decay = (1f - progress).coerceIn(0f, 1f)
  val alpha = (attack * decay * decay * decay * (0.96f + basePulse * 0.18f) * brightness).coerceIn(0f, 0.5f)
  if (alpha <= 0.01f) return
  val ringWidth = size.width * (0.34f + progress * 1.18f) * scale
  val ringHeight = size.height * (0.05f + progress * 0.42f) * scale
  val ringCenterY = center.y + radius * (0.86f + progress * 0.02f)
  val outerTopLeft = Offset(center.x - ringWidth / 2f, ringCenterY - ringHeight / 2f)
  val outerSize = Size(ringWidth, ringHeight)
  val innerTopLeft = Offset(center.x - ringWidth * 0.46f, ringCenterY - ringHeight * 0.38f)
  val innerSize = Size(ringWidth * 0.92f, ringHeight * 0.76f)
  if (frontLayer) {
    val frontAlpha = alpha * 0.52f
    val outerFront = if (errorTint) Color(0xFFFFB1C0) else Color(0xFFC3BBFF)
    val innerFront = if (errorTint) Color(0xFFFF4F72) else Color(0xFF6D82FF)
    drawArc(
      color = outerFront.copy(alpha = frontAlpha),
      startAngle = 12f,
      sweepAngle = 156f,
      useCenter = false,
      topLeft = outerTopLeft,
      size = outerSize,
      style = Stroke(width = (0.8f + decay * 0.7f).dp.toPx(), cap = StrokeCap.Round),
    )
    drawArc(
      color = innerFront.copy(alpha = frontAlpha * 0.86f),
      startAngle = 12f,
      sweepAngle = 156f,
      useCenter = false,
      topLeft = innerTopLeft,
      size = innerSize,
      style = Stroke(width = (0.6f + decay * 0.6f).dp.toPx(), cap = StrokeCap.Round),
    )
    return
  }
  val outerBack = if (errorTint) Color(0xFFFF9CB0) else Color(0xFFA69CFF)
  val innerBack = if (errorTint) Color(0xFFFF315D) else Color(0xFF526CFF)
  drawOval(
    color = outerBack.copy(alpha = alpha * 0.58f),
    topLeft = outerTopLeft,
    size = outerSize,
    style = Stroke(width = (1.0f + decay * 1.1f).dp.toPx(), cap = StrokeCap.Round),
  )
  drawOval(
    color = innerBack.copy(alpha = alpha * 0.7f),
    topLeft = innerTopLeft,
    size = innerSize,
    style = Stroke(width = (0.8f + decay * 0.9f).dp.toPx(), cap = StrokeCap.Round),
  )
}

private fun DrawScope.drawOrbContactGlow(
  center: Offset,
  radius: Float,
  basePulse: Float,
  errorTint: Boolean,
) {
  val glowWidth = size.width * (0.78f + basePulse * 0.05f)
  val glowHeight = size.height * (0.24f + basePulse * 0.04f)
  val glowCenter = Offset(center.x, center.y + radius * 0.86f)
  drawOval(
    brush =
      Brush.radialGradient(
        colors =
          listOf(
            if (errorTint) Color(0xFFFFCBD4).copy(alpha = 0.34f + basePulse * 0.08f) else Color(0xFFB6F7FF).copy(alpha = 0.34f + basePulse * 0.08f),
            if (errorTint) Color(0xFFFF315D).copy(alpha = 0.18f + basePulse * 0.05f) else Color(0xFF375DFF).copy(alpha = 0.18f + basePulse * 0.05f),
            Color.Transparent,
          ),
        center = glowCenter,
        radius = glowWidth * 0.52f,
      ),
    topLeft = Offset(glowCenter.x - glowWidth / 2f, glowCenter.y - glowHeight / 2f),
    size = Size(glowWidth, glowHeight),
  )
  drawCircle(
    brush =
      Brush.radialGradient(
        colors =
          listOf(
            if (errorTint) Color(0xFFFF9CB0).copy(alpha = 0.28f + basePulse * 0.08f) else Color(0xFF9CFBFF).copy(alpha = 0.28f + basePulse * 0.08f),
            Color.Transparent,
          ),
        center = center,
        radius = radius * 1.65f,
      ),
    center = center,
    radius = radius * 1.65f,
  )
}

internal fun ambientStatusText(
  state: WatchViewModel.WatchState,
  statusText: String,
): String =
  when (state) {
    WatchViewModel.WatchState.Processing,
    WatchViewModel.WatchState.Playing,
    -> "..."

    else -> statusText
  }

internal fun reasoningLevelLabel(level: String): String =
  when (WearReasoningLevel.normalize(level)) {
    WearReasoningLevel.OFF -> "Off"
    WearReasoningLevel.MINIMAL -> "Minimal"
    WearReasoningLevel.MEDIUM -> "Medium"
    WearReasoningLevel.HIGH -> "High"
    else -> "Low"
  }

internal fun isSelectedReasoningLevel(
  currentLevel: String,
  optionLevel: String,
): Boolean = WearReasoningLevel.normalize(currentLevel) == WearReasoningLevel.normalize(optionLevel)

internal fun rotaryControlModeLabel(mode: String): String =
  when (mode) {
    ROTARY_CONTROL_MODE_TTS_GAIN -> "TTS gain"
    else -> "Media"
  }

internal fun isSelectedRotaryControlMode(
  currentMode: String,
  optionMode: String,
): Boolean = currentMode == optionMode

@Composable
private fun WatchSettingsPage(
  viewModel: WatchViewModel,
  focusRequester: FocusRequester,
  onSubmenuOpenChange: (Boolean) -> Unit,
) {
  val currentLevel by viewModel.reasoningLevel.collectAsState()
  val rotaryControlMode by viewModel.rotaryControlMode.collectAsState()
  val ttsPlaybackGain by viewModel.ttsPlaybackGain.collectAsState()
  val scrollState = rememberScrollState()
  var paneStack by remember { mutableStateOf(listOf(SettingsPane.Main)) }
  var scrollIndicatorVisible by remember { mutableStateOf(false) }
  var lastScrollValue by remember { mutableStateOf(scrollState.value) }
  val currentPane = paneStack.last()
  val canPopPane = paneStack.size > 1
  fun pushPane(pane: SettingsPane) {
    paneStack = paneStack + pane
  }
  fun popPane() {
    if (paneStack.size > 1) {
      paneStack = paneStack.dropLast(1)
    }
  }
  BackHandler(enabled = canPopPane) {
    popPane()
  }
  LaunchedEffect(canPopPane) {
    onSubmenuOpenChange(canPopPane)
  }
  LaunchedEffect(currentPane) {
    scrollState.scrollTo(0)
    lastScrollValue = scrollState.value
    scrollIndicatorVisible = false
  }
  LaunchedEffect(scrollState.value) {
    val scrollChanged = scrollState.value != lastScrollValue
    lastScrollValue = scrollState.value
    if (scrollChanged && scrollState.maxValue > 0) {
      scrollIndicatorVisible = true
      delay(900)
      scrollIndicatorVisible = false
    }
  }
  Box(
    modifier =
      Modifier
        .fillMaxSize()
        .focusRequester(focusRequester)
        .settingsBackSwipe(
          enabled = canPopPane,
          onBack = ::popPane,
        )
        .onRotaryScrollEvent { event ->
          scrollState.dispatchRawDelta(event.verticalScrollPixels)
          true
        }
        .focusable(),
  ) {
    Column(
      modifier =
        Modifier
          .fillMaxSize()
          .verticalScroll(scrollState)
          .padding(horizontal = 16.dp, vertical = 14.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
    ) {
      AnimatedContent(
        targetState = SettingsPaneTarget(currentPane, paneStack.lastIndex),
        transitionSpec = {
          val forward = targetState.depth > initialState.depth
          val slideIn =
            slideInHorizontally(
              animationSpec = tween(SETTINGS_STACK_ANIMATION_MS),
              initialOffsetX = { width -> if (forward) width else -width / 3 },
            )
          val slideOut =
            slideOutHorizontally(
              animationSpec = tween(SETTINGS_STACK_ANIMATION_MS),
              targetOffsetX = { width -> if (forward) -width / 3 else width },
            )
          (slideIn + fadeIn(animationSpec = tween(SETTINGS_STACK_ANIMATION_MS)))
            .togetherWith(slideOut + fadeOut(animationSpec = tween(SETTINGS_STACK_ANIMATION_MS)))
            .using(SizeTransform(clip = false))
        },
        label = "settings-stack",
      ) { target ->
        Column {
          when (target.pane) {
            SettingsPane.Main ->
              SettingsMainPane(
                currentLevel = currentLevel,
                rotaryControlMode = rotaryControlMode,
                ttsPlaybackGain = ttsPlaybackGain,
                onOpenReasoning = { pushPane(SettingsPane.Reasoning) },
                onOpenRingControl = { pushPane(SettingsPane.RingControl) },
              )
            SettingsPane.Reasoning ->
              ReasoningSettingsPane(
                currentLevel = currentLevel,
                onSelect = {
                  viewModel.setReasoningLevel(it)
                  popPane()
                },
              )
            SettingsPane.RingControl ->
              RingControlSettingsPane(
                rotaryControlMode = rotaryControlMode,
                ttsPlaybackGain = ttsPlaybackGain,
                onSelect = {
                  viewModel.setRotaryControlMode(it)
                  popPane()
                },
              )
          }
        }
      }
      Spacer(modifier = Modifier.height(18.dp))
    }
    SettingsScrollIndicator(
      scrollState = scrollState,
      visible = scrollIndicatorVisible,
      modifier = Modifier.matchParentSize(),
    )
  }
}

@Composable
private fun SettingsScrollIndicator(
  scrollState: androidx.compose.foundation.ScrollState,
  visible: Boolean,
  modifier: Modifier = Modifier,
) {
  val maxScroll = scrollState.maxValue
  if (!visible || maxScroll <= 0) return

  val scrollFraction = (scrollState.value / maxScroll.toFloat()).coerceIn(0f, 1f)
  Canvas(modifier = modifier) {
    val trackStroke = 2.5.dp.toPx()
    val viewportHeightPx = size.height
    val contentHeightPx = viewportHeightPx + maxScroll
    val visibleFraction = (viewportHeightPx / contentHeightPx).coerceIn(0.24f, 0.92f)
    val diameter = size.minDimension - trackStroke - 4.dp.toPx()
    val topLeft = androidx.compose.ui.geometry.Offset(
      x = (size.width - diameter) / 2f,
      y = (size.height - diameter) / 2f,
    )
    val arcSize = androidx.compose.ui.geometry.Size(diameter, diameter)
    val trackStartAngle = -23f
    val trackSweepAngle = 46f
    val thumbSweepAngle = trackSweepAngle * visibleFraction
    val thumbStartAngle = trackStartAngle + (trackSweepAngle - thumbSweepAngle) * scrollFraction
    val trackStyle = Stroke(width = trackStroke, cap = StrokeCap.Round)
    drawArc(
      color = Color.White.copy(alpha = 0.16f),
      startAngle = trackStartAngle,
      sweepAngle = trackSweepAngle,
      useCenter = false,
      topLeft = topLeft,
      size = arcSize,
      style = trackStyle,
    )
    drawArc(
      color = Color.White.copy(alpha = 0.9f),
      startAngle = thumbStartAngle,
      sweepAngle = thumbSweepAngle,
      useCenter = false,
      topLeft = topLeft,
      size = arcSize,
      style = trackStyle,
    )
  }
}

@Composable
private fun SettingsMainPane(
  currentLevel: String,
  rotaryControlMode: String,
  ttsPlaybackGain: Double,
  onOpenReasoning: () -> Unit,
  onOpenRingControl: () -> Unit,
) {
  SettingsTitle("Settings")
  Spacer(modifier = Modifier.height(14.dp))
  SettingsSectionLabel("Assistant")
  SettingsGroup {
    SettingsOptionRow(
      title = "Reasoning",
      subtitle = reasoningLevelLabel(currentLevel),
      emphasizeSubtitle = true,
      onClick = onOpenReasoning,
    )
  }
  Spacer(modifier = Modifier.height(12.dp))
  SettingsSectionLabel("Controls")
  SettingsGroup {
    SettingsOptionRow(
      title = "Rotary action",
      subtitle = rotaryControlSummary(rotaryControlMode, ttsPlaybackGain),
      emphasizeSubtitle = true,
      onClick = onOpenRingControl,
    )
  }
}

@Composable
private fun ReasoningSettingsPane(
  currentLevel: String,
  onSelect: (String) -> Unit,
) {
  SettingsTitle("Reasoning")
  Spacer(modifier = Modifier.height(14.dp))
  SettingsGroup {
    WearReasoningLevel.OPTIONS.forEachIndexed { index, option ->
      val selected = isSelectedReasoningLevel(currentLevel, option)
      SettingsOptionRow(
        title = reasoningLevelLabel(option),
        subtitle = if (selected) "Selected" else null,
        selected = selected,
        onClick = { onSelect(option) },
      )
      if (index != WearReasoningLevel.OPTIONS.lastIndex) {
        SettingsDivider()
      }
    }
  }
}

@Composable
private fun RingControlSettingsPane(
  rotaryControlMode: String,
  ttsPlaybackGain: Double,
  onSelect: (String) -> Unit,
) {
  SettingsTitle("Ring control")
  Spacer(modifier = Modifier.height(14.dp))
  SettingsGroup {
    val modes = listOf(ROTARY_CONTROL_MODE_MEDIA_VOLUME, ROTARY_CONTROL_MODE_TTS_GAIN)
    modes.forEachIndexed { index, mode ->
      val selected = isSelectedRotaryControlMode(rotaryControlMode, mode)
      SettingsOptionRow(
        title = rotaryControlModeLabel(mode),
        subtitle =
          when (mode) {
            ROTARY_CONTROL_MODE_TTS_GAIN -> "Assistant responses - ${formatTtsPlaybackGain(ttsPlaybackGain)}"
            else -> "Android media volume"
          },
        selected = selected,
        emphasizeSubtitle = selected,
        onClick = { onSelect(mode) },
      )
      if (index != modes.lastIndex) {
        SettingsDivider()
      }
    }
  }
}

@Composable
private fun SettingsTitle(text: String) {
  Text(
    text = text,
    style = MaterialTheme.typography.title2,
    textAlign = TextAlign.Center,
    fontWeight = FontWeight.SemiBold,
    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
  )
}

private fun rotaryControlSummary(
  mode: String,
  ttsPlaybackGain: Double,
): String =
  when (mode) {
    ROTARY_CONTROL_MODE_TTS_GAIN -> "TTS gain - ${formatTtsPlaybackGain(ttsPlaybackGain)}"
    else -> "Media volume"
  }

@Composable
private fun SettingsSectionLabel(text: String) {
  Text(
    text = text,
    style = MaterialTheme.typography.caption1,
    textAlign = TextAlign.Left,
    color = MaterialTheme.colors.onSurface.copy(alpha = 0.78f),
    fontWeight = FontWeight.SemiBold,
    modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 5.dp),
  )
}

@Composable
private fun SettingsGroup(content: @Composable ColumnScope.() -> Unit) {
  Column(
    modifier =
      Modifier
        .fillMaxWidth()
        .clip(RoundedCornerShape(28.dp))
        .background(SettingsGroupColor)
        .drawBehind {
          drawRoundRect(
            color = SettingsGroupBorderColor,
            style = Stroke(width = 1.dp.toPx()),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(28.dp.toPx()),
          )
        }
        .padding(vertical = 4.dp),
    content = content,
  )
}

@Composable
private fun SettingsOptionRow(
  title: String,
  subtitle: String?,
  selected: Boolean = false,
  emphasizeSubtitle: Boolean = false,
  onClick: () -> Unit,
) {
  Row(
    modifier =
      Modifier
        .fillMaxWidth()
        .height(52.dp)
        .hapticClickable(onClick = onClick)
        .padding(horizontal = 18.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Column(
      modifier = Modifier.weight(1f),
      verticalArrangement = Arrangement.Center,
    ) {
      Text(
        text = title,
        style = MaterialTheme.typography.body1,
        color = Color.White,
        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
        maxLines = 1,
      )
      if (subtitle != null) {
        Spacer(modifier = Modifier.height(2.dp))
        Text(
          text = subtitle,
          style = MaterialTheme.typography.caption2,
          color = if (selected || emphasizeSubtitle) SettingsValueColor else Color.White.copy(alpha = 0.72f),
          maxLines = 1,
        )
      }
    }
  }
}

@Composable
private fun SettingsDivider() {
  Box(
    modifier =
      Modifier
        .fillMaxWidth()
        .padding(horizontal = 18.dp)
        .height(1.dp)
        .background(Color.White.copy(alpha = 0.22f)),
  )
}

private fun Modifier.settingsBackSwipe(
  enabled: Boolean,
  onBack: () -> Unit,
): Modifier {
  if (!enabled) return this
  return pointerInput(onBack) {
    var horizontalDrag = 0f
    detectHorizontalDragGestures(
      onDragStart = {
        horizontalDrag = 0f
      },
      onHorizontalDrag = { change, dragAmount ->
        if (abs(dragAmount) > 0f) {
          change.consume()
        }
        horizontalDrag += dragAmount
      },
      onDragEnd = {
        if (horizontalDrag > SETTINGS_BACK_SWIPE_THRESHOLD_PX) {
          onBack()
        }
      },
      onDragCancel = {
        horizontalDrag = 0f
      },
    )
  }
}

@Composable
private fun Modifier.hapticClickable(onClick: () -> Unit): Modifier {
  val hapticClick = rememberHapticClick(onClick)
  return clickable(onClick = hapticClick)
}

@Composable
private fun rememberHapticClick(onClick: () -> Unit): () -> Unit {
  val view = LocalView.current
  return remember(view, onClick) {
    {
      view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
      onClick()
    }
  }
}

@Composable
private fun HapticChip(
  onClick: () -> Unit,
  label: @Composable RowScope.() -> Unit,
  modifier: Modifier = Modifier,
) {
  Chip(
    onClick = rememberHapticClick(onClick),
    label = label,
    modifier = modifier,
  )
}

@Composable
private fun AssistantRoleButton(
  available: Boolean,
  held: Boolean,
  onClick: () -> Unit,
) {
  if (!available) return
  Spacer(modifier = Modifier.height(6.dp))
  if (held) {
    return
  } else {
    HapticChip(
      onClick = onClick,
      label = {
        Text(
          text = "Enable assistant",
          style = MaterialTheme.typography.caption2,
          textAlign = TextAlign.Center,
          modifier = Modifier.fillMaxWidth(),
        )
      },
      modifier = Modifier.height(28.dp).width(120.dp),
    )
  }
}

@Composable
private fun AmbientStatusText(
  text: String,
  ambientDetails: AmbientDetails,
) {
  val burnInOffsetDp = resolvedBurnInOffsetDp(ambientDetails)
  Text(
    text = text,
    style = MaterialTheme.typography.body1,
    textAlign = TextAlign.Center,
    // Dimmed gray to reduce OLED burn-in during long ambient sessions.
    color = MaterialTheme.colors.onSurface.copy(alpha = 0.5f),
    modifier =
      Modifier
        .fillMaxWidth()
        .padding(horizontal = 8.dp)
        .offset(x = burnInOffsetDp, y = burnInOffsetDp),
  )
}

internal fun burnInOffsetDp(tick: Int): Dp {
  // Shift ambient text between two diagonal offsets on each system ambient
  // update tick to avoid leaving it at one static OLED position.
  return when (tick % 4) {
    0,
    3,
    -> 2.dp

    else -> (-2).dp
  }
}

@Composable
private fun VolumeOverlay(
  overlay: VolumeOverlayState,
  modifier: Modifier = Modifier,
) {
  if (!overlay.visible) return
  Box(
    modifier =
      modifier
        .size(128.dp)
        .background(MaterialTheme.colors.surface.copy(alpha = 0.92f), CircleShape)
        .padding(14.dp),
    contentAlignment = Alignment.Center,
  ) {
    Column(
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.Center,
    ) {
      Text(
        text = overlay.title,
        style = MaterialTheme.typography.caption2,
        textAlign = TextAlign.Center,
        color = MaterialTheme.colors.onSurface,
      )
      if (overlay.value.isNotEmpty()) {
        Spacer(modifier = Modifier.height(4.dp))
        Text(
          text = overlay.value,
          style = MaterialTheme.typography.title2,
          textAlign = TextAlign.Center,
          color = MaterialTheme.colors.secondary,
        )
      }
      if (overlay.detail.isNotEmpty()) {
        Spacer(modifier = Modifier.height(2.dp))
        Text(
          text = overlay.detail,
          style = MaterialTheme.typography.caption2,
          textAlign = TextAlign.Center,
          color = MaterialTheme.colors.onSurface,
          modifier = Modifier.alpha(0.72f),
        )
      }
    }
  }
}
