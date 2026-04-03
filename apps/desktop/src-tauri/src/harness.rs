use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{SocketAddrV4, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

const FRONTEND_EVENT: &str = "desktop-harness:request";
const FRONTEND_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone)]
pub struct HarnessState(pub Arc<HarnessStateInner>);

pub struct HarnessStateInner {
  pub frontend_ready: AtomicBool,
  pub next_request_id: AtomicU64,
  pub pending: Mutex<HashMap<String, mpsc::Sender<Result<Value, String>>>>,
  pub token: Mutex<String>,
  pub port: AtomicU16,
}

impl HarnessState {
  pub fn disabled() -> Self {
    Self(Arc::new(HarnessStateInner {
      frontend_ready: AtomicBool::new(false),
      next_request_id: AtomicU64::new(1),
      pending: Mutex::new(HashMap::new()),
      token: Mutex::new(String::new()),
      port: AtomicU16::new(0),
    }))
  }
}

#[derive(Clone, Serialize)]
struct HarnessFrontendRequest {
  #[serde(rename = "requestId")]
  request_id: String,
  method: String,
  params: Value,
}

#[derive(Deserialize)]
pub struct HarnessFrontendResponse {
  #[serde(rename = "requestId")]
  request_id: String,
  ok: bool,
  payload: Option<Value>,
  error: Option<String>,
}

#[derive(Serialize)]
pub struct HarnessStartupInfo {
  pub enabled: bool,
  pub port: Option<u16>,
}

#[tauri::command]
pub fn desktop_harness_ready(state: State<'_, HarnessState>) {
  state.0.frontend_ready.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn desktop_harness_respond(
  state: State<'_, HarnessState>,
  response: HarnessFrontendResponse,
) -> Result<(), String> {
  let tx = state
    .0
    .pending
    .lock()
    .map_err(|_| "harness pending map poisoned".to_string())?
    .remove(&response.request_id);

  if let Some(sender) = tx {
    let result = if response.ok {
      Ok(response.payload.unwrap_or(Value::Null))
    } else {
      Err(response.error.unwrap_or_else(|| "frontend request failed".to_string()))
    };
    let _ = sender.send(result);
  }

  Ok(())
}

pub fn maybe_start_harness<R: Runtime>(app: &AppHandle<R>) -> Result<HarnessStartupInfo, String> {
  if !cfg!(debug_assertions) {
    return Ok(HarnessStartupInfo {
      enabled: false,
      port: None,
    });
  }

  let enabled = std::env::var("OPENCLAW_DESKTOP_HARNESS")
    .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
    .unwrap_or(false);
  if !enabled {
    return Ok(HarnessStartupInfo {
      enabled: false,
      port: None,
    });
  }

  let requested_port = std::env::var("OPENCLAW_DESKTOP_HARNESS_PORT")
    .ok()
    .and_then(|value| value.parse::<u16>().ok())
    .unwrap_or(0);
  let listener = TcpListener::bind(SocketAddrV4::new(std::net::Ipv4Addr::LOCALHOST, requested_port))
    .map_err(|err| format!("failed to bind desktop harness listener: {err}"))?;
  let port = listener
    .local_addr()
    .map_err(|err| format!("failed to read desktop harness address: {err}"))?
    .port();
  let token = generate_token();
  let state = app.state::<HarnessState>().inner().clone();
  state.0.port.store(port, Ordering::SeqCst);
  if let Ok(mut guard) = state.0.token.lock() {
    *guard = token.clone();
  }

  let app_handle = app.clone();
  let server_token = token.clone();
  thread::spawn(move || {
    for stream in listener.incoming() {
      match stream {
        Ok(stream) => {
          let app = app_handle.clone();
          let state = state.clone();
          let token = server_token.clone();
          thread::spawn(move || {
            let _ = handle_connection(stream, &app, &state, &token);
          });
        }
        Err(err) => {
          eprintln!("openclaw desktop harness accept error: {err}");
          break;
        }
      }
    }
  });

  println!(
    "OPENCLAW_DESKTOP_HARNESS=http://127.0.0.1:{port} token={token}"
  );

  Ok(HarnessStartupInfo {
    enabled: true,
    port: Some(port),
  })
}

fn generate_token() -> String {
  let now = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_nanos())
    .unwrap_or(0);
  format!("ocdth-{}-{now:x}", std::process::id())
}

fn handle_connection<R: Runtime>(
  mut stream: TcpStream,
  app: &AppHandle<R>,
  state: &HarnessState,
  token: &str,
) -> Result<(), String> {
  stream
    .set_read_timeout(Some(Duration::from_secs(2)))
    .map_err(|err| format!("failed to set read timeout: {err}"))?;
  stream
    .set_write_timeout(Some(Duration::from_secs(2)))
    .map_err(|err| format!("failed to set write timeout: {err}"))?;

  let request = read_request(&mut stream)?;
  let authorized = request
    .headers
    .get("authorization")
    .map(|value| value == &format!("Bearer {token}"))
    .unwrap_or(false);
  if !authorized {
    return write_json_response(&mut stream, 401, json!({ "ok": false, "error": "unauthorized" }));
  }

  match route_request(app, state, request) {
    Ok(response) => write_json_response(&mut stream, 200, response),
    Err(error) => write_json_response(&mut stream, 500, json!({ "ok": false, "error": error })),
  }
}

fn route_request<R: Runtime>(
  app: &AppHandle<R>,
  state: &HarnessState,
  request: HttpRequest,
) -> Result<Value, String> {
  match (request.method.as_str(), request.path.as_str()) {
    ("GET", "/app/status") => Ok(json!({
      "ok": true,
      "frontendReady": state.0.frontend_ready.load(Ordering::SeqCst),
      "windowVisible": app
        .get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false),
      "port": state.0.port.load(Ordering::SeqCst),
    })),
    ("POST", "/window/show") => {
      if let Some(window) = app.get_webview_window("main") {
        crate::show_main_window(&window);
      }
      Ok(json!({ "ok": true }))
    }
    ("POST", "/window/hide") => {
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
      }
      Ok(json!({ "ok": true }))
    }
    ("GET", "/settings") => bridge_to_frontend(app, state, "settings.get", Value::Null),
    ("POST", "/settings") => bridge_to_frontend(app, state, "settings.set", request.json_body()?),
    ("GET", "/ui/snapshot") => bridge_to_frontend(app, state, "ui.snapshot", Value::Null),
    ("POST", "/ui/click") => bridge_to_frontend(app, state, "ui.click", request.json_body()?),
    ("POST", "/ui/type") => bridge_to_frontend(app, state, "ui.type", request.json_body()?),
    _ => Ok(json!({ "ok": false, "error": "not_found" })),
  }
}

fn bridge_to_frontend<R: Runtime>(
  app: &AppHandle<R>,
  state: &HarnessState,
  method: &str,
  params: Value,
) -> Result<Value, String> {
  let request_id = format!(
    "harness-{}",
    state.0.next_request_id.fetch_add(1, Ordering::SeqCst)
  );
  let (tx, rx) = mpsc::channel::<Result<Value, String>>();
  state
    .0
    .pending
    .lock()
    .map_err(|_| "harness pending map poisoned".to_string())?
    .insert(request_id.clone(), tx);

  let payload = HarnessFrontendRequest {
    request_id: request_id.clone(),
    method: method.to_string(),
    params,
  };

  let emit_result = app
    .get_webview_window("main")
    .ok_or_else(|| "main window missing".to_string())?
    .emit(FRONTEND_EVENT, payload)
    .map_err(|err| format!("failed to emit harness event: {err}"));

  if let Err(err) = emit_result {
    let _ = state
      .0
      .pending
      .lock()
      .map_err(|_| "harness pending map poisoned".to_string())?
      .remove(&request_id);
    return Err(err);
  }

  match rx.recv_timeout(FRONTEND_TIMEOUT) {
    Ok(result) => result,
    Err(_) => {
      let _ = state
        .0
        .pending
        .lock()
        .map_err(|_| "harness pending map poisoned".to_string())?
        .remove(&request_id);
      Err("frontend_unavailable".to_string())
    }
  }
}

struct HttpRequest {
  method: String,
  path: String,
  headers: HashMap<String, String>,
  body: Vec<u8>,
}

impl HttpRequest {
  fn json_body(&self) -> Result<Value, String> {
    if self.body.is_empty() {
      return Ok(Value::Null);
    }
    serde_json::from_slice(&self.body).map_err(|err| format!("invalid json body: {err}"))
  }
}

fn read_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
  let mut buffer = Vec::new();
  let mut temp = [0u8; 4096];
  let mut header_end = None;

  while header_end.is_none() {
    let read = stream
      .read(&mut temp)
      .map_err(|err| format!("failed to read request: {err}"))?;
    if read == 0 {
      break;
    }
    buffer.extend_from_slice(&temp[..read]);
    header_end = find_header_end(&buffer);
    if buffer.len() > 64 * 1024 {
      return Err("request headers too large".to_string());
    }
  }

  let header_end = header_end.ok_or_else(|| "incomplete http request".to_string())?;
  let header_bytes = &buffer[..header_end];
  let body_start = header_end + 4;
  let header_text = String::from_utf8(header_bytes.to_vec())
    .map_err(|err| format!("request headers not utf-8: {err}"))?;
  let mut lines = header_text.split("\r\n");
  let request_line = lines.next().ok_or_else(|| "missing request line".to_string())?;
  let mut request_parts = request_line.split_whitespace();
  let method = request_parts
    .next()
    .ok_or_else(|| "missing request method".to_string())?
    .to_string();
  let path = request_parts
    .next()
    .ok_or_else(|| "missing request path".to_string())?
    .to_string();

  let mut headers = HashMap::new();
  for line in lines {
    if line.is_empty() {
      continue;
    }
    if let Some((name, value)) = line.split_once(':') {
      headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
    }
  }

  let content_length = headers
    .get("content-length")
    .and_then(|value| value.parse::<usize>().ok())
    .unwrap_or(0);
  let mut body = buffer[body_start..].to_vec();
  while body.len() < content_length {
    let read = stream
      .read(&mut temp)
      .map_err(|err| format!("failed to read request body: {err}"))?;
    if read == 0 {
      break;
    }
    body.extend_from_slice(&temp[..read]);
  }
  body.truncate(content_length);

  Ok(HttpRequest {
    method,
    path,
    headers,
    body,
  })
}

fn find_header_end(bytes: &[u8]) -> Option<usize> {
  bytes.windows(4).position(|window| window == b"\r\n\r\n")
}

fn write_json_response(stream: &mut TcpStream, status: u16, payload: Value) -> Result<(), String> {
  let status_text = match status {
    200 => "OK",
    401 => "Unauthorized",
    500 => "Internal Server Error",
    _ => "Error",
  };
  let body = serde_json::to_vec(&payload).map_err(|err| format!("failed to encode response: {err}"))?;
  let response = format!(
    "HTTP/1.1 {status} {status_text}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
    body.len()
  );
  stream
    .write_all(response.as_bytes())
    .and_then(|_| stream.write_all(&body))
    .map_err(|err| format!("failed to write response: {err}"))
}
