package ai.openclaw.wear.ambient

import androidx.compose.runtime.Immutable

/** Ambient details forwarded from [androidx.wear.ambient.AmbientLifecycleObserver]. */
@Immutable
data class AmbientDetails(
  val isAmbient: Boolean = false,
  val burnInProtectionRequired: Boolean = false,
  val tick: Int = 0,
)

/** Builds the [AmbientDetails] used when entering ambient mode. */
internal fun enterAmbientDetails(burnInProtectionRequired: Boolean): AmbientDetails =
  AmbientDetails(
    isAmbient = true,
    burnInProtectionRequired = burnInProtectionRequired,
    tick = 0,
  )

/** Builds the [AmbientDetails] used when exiting ambient mode. */
internal fun exitAmbientDetails(): AmbientDetails = AmbientDetails()

/** Returns the next [AmbientDetails] tick if currently in ambient with burn-in protection enabled. */
internal fun AmbientDetails.withAmbientTickUpdate(): AmbientDetails =
  when {
    isAmbient && burnInProtectionRequired -> copy(tick = tick + 1)
    else -> this
  }
