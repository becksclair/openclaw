package ai.openclaw.app.assistant

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import java.util.concurrent.atomic.AtomicBoolean

/**
 * In-process handoff from the system-bound voice session to the visible activity.
 * Kept identical to the wear copy at wear/src/main/java/ai/openclaw/wear/assistant/AssistantTrustedStartBridge.kt.
 */
internal object AssistantTrustedStartBridge {
  private val pendingStart = AtomicBoolean(false)
  private val _requests = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
  val requests: SharedFlow<Unit> = _requests

  fun requestStart() {
    pendingStart.set(true)
    _requests.tryEmit(Unit)
  }

  fun consumePendingStart(): Boolean = pendingStart.getAndSet(false)
}
