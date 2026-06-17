package ai.openclaw.wear.ui

import ai.openclaw.wear.WatchViewModel
import ai.openclaw.wear.ambient.AmbientDetails
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
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
  Column(
    modifier = Modifier.fillMaxSize().padding(16.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.Center,
  ) {
    if (ambientDetails.isAmbient) {
      val state by viewModel.state.collectAsState()
      val statusText by viewModel.statusText.collectAsState()
      AmbientStatusText(
        text = ambientStatusText(state, statusText),
        ambientDetails = ambientDetails,
      )
    } else {
      InteractiveWatchFace(
        viewModel = viewModel,
        onRequestMicPermission = onRequestMicPermission,
        assistantRoleAvailable = assistantRoleAvailable,
        assistantRoleHeld = assistantRoleHeld,
        onRequestAssistantRole = onRequestAssistantRole,
      )
    }
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
