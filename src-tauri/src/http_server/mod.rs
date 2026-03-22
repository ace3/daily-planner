// =============================================================================
// Daily Planner — Embedded HTTP Server for Remote / Mobile Access
// =============================================================================
//
// This server runs on 0.0.0.0:<port> (default 7734) as a tokio task inside
// the Tauri process.  It is reachable from any device on the same WiFi network:
//
//   http://<mac-local-ip>:7734          e.g.  http://192.168.1.42:7734
//
// For access over mobile data, pair it with a tunnel (cloudflared / bore):
//
//   cloudflared tunnel --url http://localhost:7734
//   bore local 7734 --to bore.pub
//
// The tunnel URL is managed by the RemoteAccessPage in the desktop UI.
//
// Authentication
// --------------
// Optional single static Bearer token stored in the `settings` table as
// `http_auth_token`.  If the value is non-empty every mutating request
// (POST / PATCH / DELETE) requires:
//     Authorization: Bearer <token>
// GET requests are unauthenticated so the page itself loads freely.
//
// SQLite concurrency
// ------------------
// The HTTP server opens its **own** SQLite connection (WAL mode allows
// concurrent readers alongside the Tauri IPC connection).  All DB access
// in this module uses that private connection; it never touches the Tauri
// `DbConnection` managed state.
// =============================================================================

use chrono::Timelike;
use std::collections::HashMap;
use std::convert::Infallible;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, Method, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Json, Response,
    },
    routing::{get, patch, post},
    Router,
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tower_http::cors::{Any, CorsLayer};

use crate::commands::claude::{build_run_args, strip_ansi, AiProvider};
use crate::db::queries;

// ---------------------------------------------------------------------------
// Shared server state
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct ServerState {
    /// Dedicated SQLite connection for HTTP handlers (WAL mode).
    db: Arc<Mutex<Connection>>,
    /// Shared job registry for cancellation (same Arc as Tauri commands).
    job_registry: Arc<Mutex<HashMap<String, u32>>>,
}

// ---------------------------------------------------------------------------
// Error helper
// ---------------------------------------------------------------------------

struct ApiError(StatusCode, String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        #[derive(Serialize)]
        struct Body {
            error: String,
        }
        (self.0, Json(Body { error: self.1 })).into_response()
    }
}

fn internal(e: impl std::fmt::Display) -> ApiError {
    ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

fn bad_request(msg: impl Into<String>) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, msg.into())
}

fn unauthorized() -> ApiError {
    ApiError(StatusCode::UNAUTHORIZED, "Invalid or missing auth token".into())
}

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

fn check_auth(db: &Arc<Mutex<Connection>>, headers: &HeaderMap) -> Result<(), ApiError> {
    let conn = db.lock().map_err(internal)?;
    let token_setting = queries::get_setting(&*conn, "http_auth_token")
        .unwrap_or_default();
    let token = token_setting.trim();
    if token.is_empty() {
        return Ok(());
    }
    let provided = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let expected = format!("Bearer {}", token);
    if provided == expected {
        Ok(())
    } else {
        Err(unauthorized())
    }
}

// ---------------------------------------------------------------------------
// Route: GET /
// ---------------------------------------------------------------------------

const MOBILE_HTML: &str = include_str!("../../assets/web/index.html");

async fn serve_ui() -> impl IntoResponse {
    (
        [("content-type", "text/html; charset=utf-8")],
        MOBILE_HTML,
    )
}

// ---------------------------------------------------------------------------
// Route: GET /api/health
// ---------------------------------------------------------------------------

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true }))
}

// ---------------------------------------------------------------------------
// Route: GET /api/tasks?date=YYYY-MM-DD
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct DateQuery {
    date: Option<String>,
}

async fn get_tasks(
    State(s): State<ServerState>,
    Query(q): Query<DateQuery>,
) -> Result<Json<Vec<queries::Task>>, ApiError> {
    let date = q
        .date
        .filter(|d| !d.is_empty())
        .unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d").to_string());
    let conn = s.db.lock().map_err(internal)?;
    let tasks = queries::get_tasks_by_date(&*conn, &date).map_err(internal)?;
    Ok(Json(tasks))
}

// ---------------------------------------------------------------------------
// Route: POST /api/tasks
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct CreateTaskBody {
    date: String,
    session_slot: i64,
    title: String,
    task_type: Option<String>,
    priority: Option<i64>,
    estimated_min: Option<i64>,
    project_id: Option<String>,
}

async fn create_task(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Json(body): Json<CreateTaskBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    if body.title.trim().is_empty() {
        return Err(bad_request("title is required"));
    }
    let conn = s.db.lock().map_err(internal)?;
    let id = queries::create_task(
        &*conn,
        &body.date,
        body.session_slot,
        &body.title,
        &body.task_type.unwrap_or_else(|| "code".into()),
        body.priority.unwrap_or(2),
        body.estimated_min,
        body.project_id.as_deref(),
    )
    .map_err(internal)?;
    Ok(Json(serde_json::json!({ "id": id })))
}

// ---------------------------------------------------------------------------
// Route: PATCH /api/tasks/:id/status
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct PatchStatusBody {
    status: String,
}

async fn patch_task_status(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<PatchStatusBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let conn = s.db.lock().map_err(internal)?;
    queries::update_task_status(&*conn, &id, &body.status).map_err(internal)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Route: PATCH /api/tasks/:id
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct PatchTaskBody {
    title: Option<String>,
    notes: Option<String>,
    task_type: Option<String>,
    priority: Option<i64>,
    estimated_min: Option<i64>,
    session_slot: Option<i64>,
    project_id: Option<String>,
    clear_project: Option<bool>,
    // convenience: if present, just update status
    status: Option<String>,
}

async fn patch_task(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<PatchTaskBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let conn = s.db.lock().map_err(internal)?;
    if let Some(status) = &body.status {
        queries::update_task_status(&*conn, &id, status).map_err(internal)?;
    } else {
        queries::update_task(
            &*conn,
            &id,
            body.title.as_deref(),
            body.notes.as_deref(),
            body.task_type.as_deref(),
            body.priority,
            body.estimated_min,
            body.session_slot,
            body.project_id.as_deref(),
            body.clear_project.unwrap_or(false),
        )
        .map_err(internal)?;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Route: DELETE /api/tasks/:id
// ---------------------------------------------------------------------------

async fn delete_task(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let conn = s.db.lock().map_err(internal)?;
    queries::delete_task(&*conn, &id).map_err(internal)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Route: GET /api/settings
// ---------------------------------------------------------------------------

async fn get_settings(
    State(s): State<ServerState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let conn = s.db.lock().map_err(internal)?;
    let map = queries::get_all_settings(&*conn).map_err(internal)?;
    // Return safe subset (omit sensitive keys like auth token)
    let safe: HashMap<_, _> = map
        .iter()
        .filter(|(k, _)| *k != "http_auth_token")
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    Ok(Json(serde_json::to_value(safe).unwrap_or_default()))
}

// ---------------------------------------------------------------------------
// Route: GET /api/session  — current phase based on settings + local time
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct SessionInfo {
    phase: String,
    phase_label: String,
    session1_kickstart: String,
    planning_end: String,
    session2_start: String,
    timezone_offset: i64,
}

fn minutes_from_hhmm(s: &str) -> i64 {
    let parts: Vec<&str> = s.splitn(2, ':').collect();
    let h: i64 = parts.first().and_then(|v| v.parse().ok()).unwrap_or(0);
    let m: i64 = parts.get(1).and_then(|v| v.parse().ok()).unwrap_or(0);
    h * 60 + m
}

async fn get_session(
    State(s): State<ServerState>,
) -> Result<Json<SessionInfo>, ApiError> {
    let conn = s.db.lock().map_err(internal)?;
    let map = queries::get_all_settings(&*conn).map_err(internal)?;
    drop(conn);

    let tz: i64 = map
        .get("timezone_offset")
        .and_then(|v| v.parse().ok())
        .unwrap_or(7);
    let kickstart = map
        .get("session1_kickstart")
        .cloned()
        .unwrap_or_else(|| "09:00".into());
    let planning_end = map
        .get("planning_end")
        .cloned()
        .unwrap_or_else(|| "11:00".into());
    let session2 = map
        .get("session2_start")
        .cloned()
        .unwrap_or_else(|| "14:00".into());

    // Current local time in configured timezone (offset in hours)
    let utc_now = chrono::Utc::now();
    let offset = chrono::FixedOffset::east_opt(tz as i32 * 3600).unwrap_or_else(|| {
        chrono::FixedOffset::east_opt(0).unwrap()
    });
    let local_now = utc_now.with_timezone(&offset);
    let current_min = local_now.hour() as i64 * 60 + local_now.minute() as i64;

    let kickstart_min = minutes_from_hhmm(&kickstart);
    let planning_end_min = minutes_from_hhmm(&planning_end);
    let session2_min = minutes_from_hhmm(&session2);

    let (phase, phase_label) = if current_min < kickstart_min {
        ("pre_session", "Before Session 1")
    } else if current_min < planning_end_min {
        ("session1", "Session 1")
    } else if current_min < session2_min {
        ("break", "Break")
    } else {
        ("session2", "Session 2")
    };

    Ok(Json(SessionInfo {
        phase: phase.into(),
        phase_label: phase_label.into(),
        session1_kickstart: kickstart,
        planning_end,
        session2_start: session2,
        timezone_offset: tz,
    }))
}

// ---------------------------------------------------------------------------
// Route: GET /api/reports?from=YYYY-MM-DD&to=YYYY-MM-DD
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ReportsQuery {
    from: Option<String>,
    to: Option<String>,
}

async fn get_reports(
    State(s): State<ServerState>,
    Query(q): Query<ReportsQuery>,
) -> Result<Json<Vec<queries::DailyReport>>, ApiError> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let from = q.from.as_deref().unwrap_or(&today).to_string();
    let to = q.to.as_deref().unwrap_or(&today).to_string();
    let conn = s.db.lock().map_err(internal)?;
    let reports = queries::get_reports_range(&*conn, &from, &to).map_err(internal)?;
    Ok(Json(reports))
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

fn sse_stream(
    rx: mpsc::Receiver<Result<Event, Infallible>>,
) -> Sse<ReceiverStream<Result<Event, Infallible>>> {
    Sse::new(ReceiverStream::new(rx)).keep_alive(KeepAlive::default())
}

// ---------------------------------------------------------------------------
// Route: POST /api/prompt/improve  (SSE stream)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ImproveBody {
    prompt: String,
    provider: Option<String>,
    project_id: Option<String>,
    project_path: Option<String>,
}

async fn prompt_improve(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Json(body): Json<ImproveBody>,
) -> Result<impl IntoResponse, ApiError> {
    check_auth(&s.db, &headers)?;

    // Read context from DB before spawning
    let (global_prompt, project_prompt, selected_model) = {
        let conn = s.db.lock().map_err(internal)?;
        let gp = queries::get_setting(&*conn, "global_prompt")
            .ok()
            .filter(|s| !s.is_empty());
        let pp = body
            .project_id
            .as_deref()
            .and_then(|pid| queries::get_project_prompt(&*conn, pid).ok().flatten());
        let provider_str = body.provider.as_deref();
        let model_key = crate::commands::claude::default_model_setting_key(provider_str);
        let model = queries::get_setting(&*conn, model_key)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let legacy = if model_key == "default_model_claude" {
            queries::get_setting(&*conn, "claude_model")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        } else {
            None
        };
        (gp, pp, model.or(legacy))
    };

    let effective_prompt = match (global_prompt, project_prompt) {
        (Some(gp), Some(pp)) => format!("{}\n\n{}\n\n{}", gp, pp, body.prompt),
        (Some(gp), None) => format!("{}\n\n{}", gp, body.prompt),
        (None, Some(pp)) => format!("{}\n\n{}", pp, body.prompt),
        (None, None) => body.prompt.clone(),
    };

    let ai_provider = AiProvider::from_input(body.provider.as_deref());
    let model = selected_model
        .unwrap_or_else(|| ai_provider.hardcoded_default_model().to_string());
    let args = build_run_args(ai_provider, &effective_prompt, Some(&model));
    let cli = ai_provider.cli_binary().to_string();
    let project_path = body.project_path.clone();

    let (tx, rx) = mpsc::channel::<Result<Event, Infallible>>(128);

    tokio::spawn(async move {
        let mut cmd = tokio::process::Command::new(&cli);
        for arg in &args {
            cmd.arg(arg);
        }
        cmd.env("NO_COLOR", "1");
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        if ai_provider == AiProvider::Codex {
            cmd.stdin(Stdio::null());
        }
        if let Some(path) = &project_path {
            cmd.current_dir(path);
        }

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = tx
                    .send(Ok(Event::default()
                        .event("error")
                        .data(format!("Failed to spawn {}: {}", cli, e))))
                    .await;
                return;
            }
        };

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let tx2 = tx.clone();

        let stdout_task = tokio::spawn(async move {
            if let Some(out) = stdout {
                let mut lines = BufReader::new(out).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let clean = strip_ansi(&line);
                    if !clean.trim().is_empty() {
                        let _ = tx.send(Ok(Event::default().event("line").data(clean))).await;
                    }
                }
            }
        });
        let stderr_task = tokio::spawn(async move {
            if let Some(err) = stderr {
                let mut lines = BufReader::new(err).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let clean = strip_ansi(&line);
                    if !clean.trim().is_empty() {
                        let _ = tx2
                            .send(Ok(Event::default().event("line").data(clean)))
                            .await;
                    }
                }
            }
        });

        let _ = tokio::join!(stdout_task, stderr_task);
        let success = child.wait().await.map(|s| s.success()).unwrap_or(false);
        let _ = success;
    });

    Ok(sse_stream(rx))
}

// ---------------------------------------------------------------------------
// Route: POST /api/prompt/run  (SSE stream)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct RunBody {
    prompt: String,
    provider: Option<String>,
    project_path: Option<String>,
    job_id: Option<String>,
}

async fn prompt_run(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Json(body): Json<RunBody>,
) -> Result<impl IntoResponse, ApiError> {
    check_auth(&s.db, &headers)?;

    let selected_model = {
        let conn = s.db.lock().map_err(internal)?;
        let model_key = crate::commands::claude::default_model_setting_key(body.provider.as_deref());
        let model = queries::get_setting(&*conn, model_key)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let legacy = if model_key == "default_model_claude" {
            queries::get_setting(&*conn, "claude_model")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        } else {
            None
        };
        model.or(legacy)
    };

    let ai_provider = AiProvider::from_input(body.provider.as_deref());
    let model = selected_model
        .unwrap_or_else(|| ai_provider.hardcoded_default_model().to_string());
    let args = build_run_args(ai_provider, &body.prompt, Some(&model));
    let cli = ai_provider.cli_binary().to_string();
    let project_path = body.project_path.clone();
    let job_id = body.job_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let registry = Arc::clone(&s.job_registry);

    let (tx, rx) = mpsc::channel::<Result<Event, Infallible>>(256);

    tokio::spawn(async move {
        let mut cmd = tokio::process::Command::new(&cli);
        for arg in &args {
            cmd.arg(arg);
        }
        cmd.env("NO_COLOR", "1");
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        if ai_provider == AiProvider::Codex {
            cmd.stdin(Stdio::null());
        }
        if let Some(path) = &project_path {
            cmd.current_dir(path);
        }

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = tx
                    .send(Ok(Event::default()
                        .event("error")
                        .data(format!("Failed to spawn {}: {}", cli, e))))
                    .await;
                return;
            }
        };

        if let Some(pid) = child.id() {
            registry.lock().unwrap().insert(job_id.clone(), pid);
        }

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let tx_err = tx.clone();
        let jid = job_id.clone();

        let stdout_task = tokio::spawn(async move {
            if let Some(out) = stdout {
                let mut lines = BufReader::new(out).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let clean = strip_ansi(&line);
                    if !clean.trim().is_empty() {
                        if tx.send(Ok(Event::default().event("line").data(clean))).await.is_err() {
                            break;
                        }
                    }
                }
            }
        });
        let stderr_task = tokio::spawn(async move {
            if let Some(err) = stderr {
                let mut lines = BufReader::new(err).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let clean = strip_ansi(&line);
                    if !clean.trim().is_empty() {
                        if tx_err.send(Ok(Event::default().event("line").data(clean))).await.is_err() {
                            break;
                        }
                    }
                }
            }
        });

        let _ = tokio::join!(stdout_task, stderr_task);
        registry.lock().unwrap().remove(&jid);
        let success = child.wait().await.map(|s| s.success()).unwrap_or(false);
        let exit_code = 0i32; // simplified
        let _ = exit_code;
        let _ = success;
        // channel drops, SSE stream ends naturally
    });

    Ok(sse_stream(rx))
}

// ---------------------------------------------------------------------------
// Server entry point
// ---------------------------------------------------------------------------

pub async fn start(
    db_path: PathBuf,
    job_registry: Arc<Mutex<HashMap<String, u32>>>,
) {
    // Open dedicated DB connection for the HTTP server
    let conn = match Connection::open(&db_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[http_server] Failed to open DB at {:?}: {}", db_path, e);
            return;
        }
    };
    if let Err(e) = conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;") {
        eprintln!("[http_server] Failed to set DB pragmas: {}", e);
    }
    let db = Arc::new(Mutex::new(conn));

    // Read port + auth token from settings
    let (port, _auth_token) = {
        let c = db.lock().unwrap();
        let port: u16 = queries::get_setting(&*c, "http_server_port")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(7734);
        let tok = queries::get_setting(&*c, "http_auth_token")
            .unwrap_or_default();
        (port, tok)
    };

    let state = ServerState { db, job_registry };

    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE, Method::OPTIONS])
        .allow_headers(Any)
        .allow_origin(Any);

    let app = Router::new()
        .route("/", get(serve_ui))
        .route("/api/health", get(health))
        .route("/api/tasks", get(get_tasks).post(create_task))
        .route("/api/tasks/:id", patch(patch_task).delete(delete_task))
        .route("/api/tasks/:id/status", patch(patch_task_status))
        .route("/api/settings", get(get_settings))
        .route("/api/session", get(get_session))
        .route("/api/reports", get(get_reports))
        .route("/api/prompt/improve", post(prompt_improve))
        .route("/api/prompt/run", post(prompt_run))
        .layer(cors)
        .with_state(state);

    let bind_addr = format!("0.0.0.0:{}", port);
    let listener = match tokio::net::TcpListener::bind(&bind_addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[http_server] Failed to bind on {}: {}", bind_addr, e);
            return;
        }
    };
    eprintln!("[http_server] Listening on http://{}", bind_addr);

    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("[http_server] Server error: {}", e);
    }
}

// ---------------------------------------------------------------------------
// Tauri commands for remote-access settings
// ---------------------------------------------------------------------------

/// Return the machine's primary local network IP address (best-effort).
#[tauri::command]
pub fn get_local_ip() -> String {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0")
        .ok()
        .and_then(|s| {
            s.connect("8.8.8.8:80").ok()?;
            s.local_addr().ok()
        });
    socket
        .map(|addr| addr.ip().to_string())
        .unwrap_or_else(|| "127.0.0.1".to_string())
}

/// Return the configured HTTP server port (default 7734).
#[tauri::command]
pub fn get_http_server_port(db: tauri::State<'_, crate::db::DbConnection>) -> Result<u16, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let port = queries::get_setting(&*conn, "http_server_port")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(7734u16);
    Ok(port)
}
