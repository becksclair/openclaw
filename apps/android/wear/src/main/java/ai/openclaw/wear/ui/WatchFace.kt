package ai.openclaw.wear.ui

import ai.openclaw.common.wear.WearReasoningLevel
import ai.openclaw.wear.ROTARY_CONTROL_MODE_MEDIA_VOLUME
import ai.openclaw.wear.ROTARY_CONTROL_MODE_TTS_GAIN
import ai.openclaw.wear.VolumeOverlayState
import ai.openclaw.wear.WatchViewModel
import ai.openclaw.wear.formatTtsPlaybackGain
import ai.openclaw.wear.ambient.AmbientDetails
import android.view.HapticFeedbackConstants
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.platform.LocalView
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
  LaunchedEffect(pagerState.currentPage) {
    when (pagerState.currentPage) {
      0 -> mainFocusRequester.requestFocus()
      else -> settingsFocusRequester.requestFocus()
    }
  }
  Box(
    modifier = Modifier.fillMaxSize(),
  ) {
    HorizontalPager(
      state = pagerState,
      modifier = Modifier.fillMaxSize(),
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
        Button(
          onClick = { onRequestMicPermission() },
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
      Button(
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
) {
  val currentLevel by viewModel.reasoningLevel.collectAsState()
  val rotaryControlMode by viewModel.rotaryControlMode.collectAsState()
  val ttsPlaybackGain by viewModel.ttsPlaybackGain.collectAsState()
  val scrollState = rememberScrollState()
  Column(
    modifier =
      Modifier
        .fillMaxSize()
        .focusRequester(focusRequester)
        .onRotaryScrollEvent { event ->
          scrollState.dispatchRawDelta(event.verticalScrollPixels)
          true
        }
        .focusable()
        .verticalScroll(scrollState)
        .padding(horizontal = 16.dp, vertical = 12.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Text(
      text = "Reasoning",
      style = MaterialTheme.typography.caption1,
      textAlign = TextAlign.Center,
    )
    Spacer(modifier = Modifier.height(6.dp))
    WearReasoningLevel.OPTIONS.chunked(2).forEach { rowOptions ->
      Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        rowOptions.forEach { option ->
          ReasoningOptionChip(
            label = reasoningLevelLabel(option),
            selected = isSelectedReasoningLevel(currentLevel, option),
            onClick = { viewModel.setReasoningLevel(option) },
          )
        }
      }
      Spacer(modifier = Modifier.height(4.dp))
    }
    Spacer(modifier = Modifier.height(6.dp))
    Text(
      text = "Ring control",
      style = MaterialTheme.typography.caption1,
      textAlign = TextAlign.Center,
    )
    Spacer(modifier = Modifier.height(6.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
      listOf(ROTARY_CONTROL_MODE_MEDIA_VOLUME, ROTARY_CONTROL_MODE_TTS_GAIN).forEach { mode ->
        ReasoningOptionChip(
          label = rotaryControlModeLabel(mode),
          selected = isSelectedRotaryControlMode(rotaryControlMode, mode),
          onClick = { viewModel.setRotaryControlMode(mode) },
        )
      }
    }
    Spacer(modifier = Modifier.height(4.dp))
    Text(
      text = formatTtsPlaybackGain(ttsPlaybackGain),
      style = MaterialTheme.typography.caption2,
      textAlign = TextAlign.Center,
      color = MaterialTheme.colors.onSurface.copy(alpha = 0.7f),
    )
  }
}

@Composable
private fun ReasoningOptionChip(
  label: String,
  selected: Boolean,
  onClick: () -> Unit,
) {
  Chip(
    onClick = onClick,
    label = {
      Text(
        text = label,
        style = MaterialTheme.typography.caption2,
        textAlign = TextAlign.Center,
        color = if (selected) MaterialTheme.colors.secondary else MaterialTheme.colors.onSurface,
        modifier = Modifier.fillMaxWidth(),
      )
    },
    modifier = Modifier.height(26.dp).width(72.dp),
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
    Chip(
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
  Button(
    onClick = onClick,
    modifier = Modifier.size(64.dp),
  ) {
    Text("Speak")
  }
}

@Composable
private fun CancelButton(onClick: () -> Unit) {
  Button(
    onClick = onClick,
    modifier = Modifier.size(64.dp),
  ) {
    Text("Cancel")
  }
}

@Composable
private fun CancelChip(onClick: () -> Unit) {
  Chip(
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
