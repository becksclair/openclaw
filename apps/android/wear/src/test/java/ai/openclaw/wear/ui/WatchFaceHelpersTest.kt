package ai.openclaw.wear.ui

import ai.openclaw.common.wear.WearReasoningLevel
import ai.openclaw.wear.WatchViewModel
import ai.openclaw.wear.ambient.AmbientDetails
import ai.openclaw.wear.ambient.enterAmbientDetails
import ai.openclaw.wear.ambient.exitAmbientDetails
import ai.openclaw.wear.ambient.withAmbientTickUpdate
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Test

class WatchFaceHelpersTest {
  @Test
  fun `ambient status text is placeholder for processing and playing`() {
    assertEquals("...", ambientStatusText(WatchViewModel.WatchState.Processing, "Processing..."))
    assertEquals("...", ambientStatusText(WatchViewModel.WatchState.Playing, "Playing..."))
  }

  @Test
  fun `ambient status text uses status text for other states`() {
    assertEquals("Idle", ambientStatusText(WatchViewModel.WatchState.Idle, "Idle"))
    assertEquals("Checking", ambientStatusText(WatchViewModel.WatchState.CheckingPhone, "Checking"))
    assertEquals("Recording", ambientStatusText(WatchViewModel.WatchState.Recording, "Recording"))
    assertEquals("Error", ambientStatusText(WatchViewModel.WatchState.Error, "Error"))
  }

  @Test
  fun `burn-in offset cycles every four ticks`() {
    assertEquals(2.dp, burnInOffsetDp(0))
    assertEquals((-2).dp, burnInOffsetDp(1))
    assertEquals((-2).dp, burnInOffsetDp(2))
    assertEquals(2.dp, burnInOffsetDp(3))
    assertEquals(2.dp, burnInOffsetDp(4))
    assertEquals((-2).dp, burnInOffsetDp(5))
  }

  @Test
  fun `resolved burn-in offset is zero when protection not required`() {
    assertEquals(
      0.dp,
      resolvedBurnInOffsetDp(
        AmbientDetails(
          isAmbient = true,
          burnInProtectionRequired = false,
          tick = 3,
        ),
      ),
    )
  }

  @Test
  fun `resolved burn-in offset applies offset when protection required`() {
    assertEquals(
      (-2).dp,
      resolvedBurnInOffsetDp(
        AmbientDetails(
          isAmbient = true,
          burnInProtectionRequired = true,
          tick = 1,
        ),
      ),
    )
  }

  @Test
  fun `reasoning labels match selectable options`() {
    assertEquals("Off", reasoningLevelLabel(WearReasoningLevel.OFF))
    assertEquals("Minimal", reasoningLevelLabel(WearReasoningLevel.MINIMAL))
    assertEquals("Low", reasoningLevelLabel(WearReasoningLevel.LOW))
    assertEquals("Medium", reasoningLevelLabel(WearReasoningLevel.MEDIUM))
    assertEquals("High", reasoningLevelLabel(WearReasoningLevel.HIGH))
  }

  @Test
  fun `reasoning selected-state uses normalized values`() {
    assertEquals(true, isSelectedReasoningLevel("HIGH", WearReasoningLevel.HIGH))
    assertEquals(false, isSelectedReasoningLevel(WearReasoningLevel.LOW, WearReasoningLevel.HIGH))
    assertEquals(true, isSelectedReasoningLevel("invalid", WearReasoningLevel.LOW))
  }

  @Test
  fun `enter ambient details sets ambient and captures burn-in flag with tick zero`() {
    val details = enterAmbientDetails(burnInProtectionRequired = true)
    assertEquals(true, details.isAmbient)
    assertEquals(true, details.burnInProtectionRequired)
    assertEquals(0, details.tick)
  }

  @Test
  fun `exit ambient details returns default non-ambient details`() {
    val details = exitAmbientDetails()
    assertEquals(false, details.isAmbient)
    assertEquals(false, details.burnInProtectionRequired)
    assertEquals(0, details.tick)
  }

  @Test
  fun `ambient tick update increments only when ambient and burn-in protection required`() {
    val ambientWithProtection = AmbientDetails(isAmbient = true, burnInProtectionRequired = true, tick = 5)
    assertEquals(6, ambientWithProtection.withAmbientTickUpdate().tick)

    val ambientWithoutProtection = AmbientDetails(isAmbient = true, burnInProtectionRequired = false, tick = 5)
    assertEquals(5, ambientWithoutProtection.withAmbientTickUpdate().tick)

    val notAmbient = AmbientDetails(isAmbient = false, burnInProtectionRequired = true, tick = 5)
    assertEquals(5, notAmbient.withAmbientTickUpdate().tick)
  }
}
