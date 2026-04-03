use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDesktopReadiness {
  pub desktop_environment: Option<String>,
  pub platform: String,
  pub portal_likely_available: bool,
  pub runtime: String,
  pub session_type: Option<String>,
  pub window_visible: bool,
}

fn read_env(name: &str) -> Option<String> {
  let value = std::env::var(name).ok()?;
  let trimmed = value.trim();
  if trimmed.is_empty() {
    return None;
  }
  Some(trimmed.to_string())
}

fn detect_session_type() -> Option<String> {
  if let Some(value) = read_env("XDG_SESSION_TYPE") {
    return Some(value);
  }
  if read_env("WAYLAND_DISPLAY").is_some() {
    return Some("wayland".to_string());
  }
  if read_env("DISPLAY").is_some() {
    return Some("x11".to_string());
  }
  None
}

fn portal_likely_available() -> bool {
  if cfg!(target_os = "linux") {
    return detect_session_type().is_some() || read_env("XDG_CURRENT_DESKTOP").is_some();
  }
  false
}

#[tauri::command]
pub fn desktop_readiness_probe<R: Runtime>(app: AppHandle<R>) -> NativeDesktopReadiness {
  let window_visible = app
    .get_webview_window("main")
    .and_then(|window| window.is_visible().ok())
    .unwrap_or(true);

  NativeDesktopReadiness {
    desktop_environment: read_env("XDG_CURRENT_DESKTOP").or_else(|| read_env("DESKTOP_SESSION")),
    platform: std::env::consts::OS.to_string(),
    portal_likely_available: portal_likely_available(),
    runtime: "tauri".to_string(),
    session_type: detect_session_type(),
    window_visible,
  }
}
