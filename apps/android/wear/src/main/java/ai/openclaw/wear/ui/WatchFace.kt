package ai.openclaw.wear.ui

import ai.openclaw.wear.WatchViewModel
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text

@Composable
fun WatchFace(
  viewModel: WatchViewModel,
  onRequestMicPermission: () -> Unit,
) {
  val state by viewModel.state.collectAsState()
  val statusText by viewModel.statusText.collectAsState()
  val hasMicPermission by viewModel.hasMicPermission.collectAsState()

  Column(
    modifier = Modifier.fillMaxSize().padding(16.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.Center,
  ) {
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
      }
      WatchViewModel.WatchState.Recording -> {
        StopButton(onClick = { viewModel.onMicButtonUp() })
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
      }
      WatchViewModel.WatchState.Playing -> {
        CircularProgressIndicator(
          modifier = Modifier.size(40.dp),
          indicatorColor = MaterialTheme.colors.secondary,
        )
        Spacer(modifier = Modifier.height(8.dp))
        StatusText(statusText)
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
private fun StopButton(onClick: () -> Unit) {
  Button(
    onClick = onClick,
    modifier = Modifier.size(64.dp),
  ) {
    Text("Done")
  }
}
