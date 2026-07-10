package ai.openclaw.app

enum class SessionTargetMode(
  val rawValue: String,
) {
  Device("device"),
  Main("main"),
  FollowSelected("followSelected"),
  ;

  companion object {
    val default: SessionTargetMode = FollowSelected

    fun fromRawValue(raw: String?): SessionTargetMode {
      val normalized = raw?.trim()
      return entries.firstOrNull { it.rawValue == normalized } ?: default
    }
  }
}
