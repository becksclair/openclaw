package ai.openclaw.wear

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchViewModelTest {
  @Test
  fun `active turn states keep the watch screen awake`() {
    assertFalse(WatchViewModel.WatchState.Idle.keepsScreenAwake)
    assertFalse(WatchViewModel.WatchState.CheckingPhone.keepsScreenAwake)
    assertTrue(WatchViewModel.WatchState.Recording.keepsScreenAwake)
    assertTrue(WatchViewModel.WatchState.Processing.keepsScreenAwake)
    assertTrue(WatchViewModel.WatchState.Playing.keepsScreenAwake)
    assertFalse(WatchViewModel.WatchState.Error.keepsScreenAwake)
  }
}
