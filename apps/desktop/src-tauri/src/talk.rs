use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopTalkFixtureAudio {
  pub bytes: Vec<u8>,
  pub file_name: String,
  pub mime_type: String,
}

#[cfg(debug_assertions)]
const SKY_VOICE_TEST_WAV: &[u8] = include_bytes!("../../../../test-fixtures/audio/sky_voice_test.wav");

#[tauri::command]
pub fn desktop_talk_test_fixture_audio() -> Result<DesktopTalkFixtureAudio, String> {
  #[cfg(debug_assertions)]
  {
    return Ok(DesktopTalkFixtureAudio {
      bytes: SKY_VOICE_TEST_WAV.to_vec(),
      file_name: "sky_voice_test.wav".to_string(),
      mime_type: "audio/wav".to_string(),
    });
  }

  #[cfg(not(debug_assertions))]
  {
    Err("desktop talk fixture audio is only available in debug builds".to_string())
  }
}
