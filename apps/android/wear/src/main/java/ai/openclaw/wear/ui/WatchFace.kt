package ai.openclaw.wear.ui

import ai.openclaw.common.wear.WearReasoningLevel
import ai.openclaw.wear.ROTARY_CONTROL_MODE_MEDIA_VOLUME
import ai.openclaw.wear.ROTARY_CONTROL_MODE_TTS_GAIN
import ai.openclaw.wear.VolumeOverlayState
import ai.openclaw.wear.WatchViewModel
import ai.openclaw.wear.formatTtsPlaybackGain
import ai.openclaw.wear.ambient.AmbientDetails
import android.view.HapticFeedbackConstants
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
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
import androidx.compose.foundation.layout.BoxScope
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.pager.HorizontalPager
import androidx.wear.compose.foundation.pager.rememberPagerState
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import kotlinx.coroutines.delay
import kotlin.math.abs

private val SettingsGroupColor = Color(0xFF171B21)
private val SettingsGroupBorderColor = Color.White.copy(alpha = 0.12f)
private val SettingsValueColor = Color(0xFF76D7FF)

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
                .focusRequester(mainFocusRequester)
                .onRotaryScrollEvent { event ->
                  if (viewModel.onRotaryVolumeDelta(event.verticalScrollPixels)) {
                    view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                  }
                  true
                }
                .focusable()
                .padding(16.dp),
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

  when (state) {
    WatchViewModel.WatchState.Idle,
    WatchViewModel.WatchState.CheckingPhone,
    -> {
      if (hasMicPermission) {
        StartButton(onClick = { viewModel.onMicButtonDown() })
      } else {
        HapticButton(
          onClick = onRequestMicPermission,
          modifier = Modifier.size(56.dp),
        ) {
          Text("Allow")
        }
      }
      Spacer(modifier = Modifier.height(8.dp))
      StatusText(statusText)
      AssistantRoleButton(
        available = assistantRoleAvailable,
        held = assistantRoleHeld,
        onClick = onRequestAssistantRole,
      )
    }
    WatchViewModel.WatchState.Recording -> {
      CancelButton(onClick = { viewModel.onCancelTurn() })
      Spacer(modifier = Modifier.height(8.dp))
      StatusText(statusText)
    }
    WatchViewModel.WatchState.Processing -> {
      CircularProgressIndicator(
        modifier = Modifier.size(40.dp),
        indicatorColor = MaterialTheme.colors.primary,
      )
      Spacer(modifier = Modifier.height(8.dp))
      StatusText(statusText)
      Spacer(modifier = Modifier.height(8.dp))
      CancelChip(onClick = { viewModel.onCancelTurn() })
    }
    WatchViewModel.WatchState.Playing -> {
      CircularProgressIndicator(
        modifier = Modifier.size(40.dp),
        indicatorColor = MaterialTheme.colors.secondary,
      )
      Spacer(modifier = Modifier.height(8.dp))
      StatusText(statusText)
      Spacer(modifier = Modifier.height(8.dp))
      CancelChip(onClick = { viewModel.onCancelTurn() })
    }
    WatchViewModel.WatchState.Error -> {
      Text(
        text = statusText,
        style = MaterialTheme.typography.body2,
        textAlign = TextAlign.Center,
        color = MaterialTheme.colors.error,
      )
      Spacer(modifier = Modifier.height(8.dp))
      HapticButton(
        onClick = { viewModel.onRetry() },
        modifier = Modifier.size(48.dp),
      ) {
        Text("Retry")
      }
    }
  }
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
private fun HapticButton(
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  content: @Composable BoxScope.() -> Unit,
) {
  Button(
    onClick = rememberHapticClick(onClick),
    modifier = modifier,
    content = content,
  )
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
    Text(
      text = "Assistant ready",
      style = MaterialTheme.typography.caption2,
      textAlign = TextAlign.Center,
      color = MaterialTheme.colors.secondary,
    )
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
private fun StatusText(text: String) {
  Text(
    text = text,
    style = MaterialTheme.typography.caption2,
    textAlign = TextAlign.Center,
  )
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

@Composable
private fun StartButton(onClick: () -> Unit) {
  HapticButton(
    onClick = onClick,
    modifier = Modifier.size(64.dp),
  ) {
    Text("Speak")
  }
}

@Composable
private fun CancelButton(onClick: () -> Unit) {
  HapticButton(
    onClick = onClick,
    modifier = Modifier.size(64.dp),
  ) {
    Text("Cancel")
  }
}

@Composable
private fun CancelChip(onClick: () -> Unit) {
  HapticChip(
    onClick = onClick,
    label = {
      Text(
        text = "Cancel",
        style = MaterialTheme.typography.caption2,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth(),
      )
    },
    modifier = Modifier.height(28.dp).width(96.dp),
  )
}
