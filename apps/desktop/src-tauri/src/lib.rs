mod harness;
mod readiness;
mod talk;

use tauri::{Manager, Runtime, WebviewWindow};

pub(crate) fn show_main_window<R: Runtime>(window: &WebviewWindow<R>) {
  let _ = window.unminimize();
  let _ = window.show();
  let _ = window.set_focus();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      harness::desktop_harness_ready,
      harness::desktop_harness_respond,
      readiness::desktop_readiness_probe,
      talk::desktop_talk_test_fixture_audio,
    ])
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      if let Some(window) = app.get_webview_window("main") {
        show_main_window(&window);
      }
    }))
    .plugin(tauri_plugin_autostart::Builder::new().build())
    .setup(|app| {
      app.manage(harness::HarnessState::disabled());

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      if let Some(window) = app.get_webview_window("main") {
        show_main_window(&window);
      }

      if let Err(error) = harness::maybe_start_harness(app.handle()) {
        eprintln!("openclaw desktop harness failed to start: {error}");
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
