package ai.openclaw.app

enum class VoiceEngineMode(val rawValue: String) {
  Classic("classic"),
  Realtime("realtime"),
  ;

  companion object {
    fun fromRawValue(raw: String?): VoiceEngineMode {
      return entries.firstOrNull { it.rawValue == raw?.trim()?.lowercase() } ?: Classic
    }
  }
}
