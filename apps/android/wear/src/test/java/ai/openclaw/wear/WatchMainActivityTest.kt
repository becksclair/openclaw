package ai.openclaw.wear

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchMainActivityTest {
  @Test
  fun `screen stays fully awake except while processing or playing`() {
    assertTrue(shouldKeepScreenFullyAwake(WatchViewModel.WatchState.Idle))
    assertTrue(shouldKeepScreenFullyAwake(WatchViewModel.WatchState.CheckingPhone))
    assertTrue(shouldKeepScreenFullyAwake(WatchViewModel.WatchState.Recording))
    assertTrue(shouldKeepScreenFullyAwake(WatchViewModel.WatchState.Error))

    assertFalse(shouldKeepScreenFullyAwake(WatchViewModel.WatchState.Processing))
    assertFalse(shouldKeepScreenFullyAwake(WatchViewModel.WatchState.Playing))
  }
}
