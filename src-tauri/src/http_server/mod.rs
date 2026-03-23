// =============================================================================
// Daily Planner — Embedded HTTP Server for Remote / Mobile Access
// =============================================================================
//
// This server runs on 0.0.0.0:<port> (default 7734) as a tokio task inside
// the Tauri process.  It is reachable from any device on the same WiFi network.
//
// Authentication
// --------------
// Bearer token stored in the `settings` table as `http_auth_token`.
// ALL /api/* routes (except /api/health) require:
//     Authorization: Bearer <token>
// OR query param:  ?token=<token>  (needed for EventSource which can't set headers)
//
// Static serving
// --------------
// GET / serves the built React app (dist/ embedded at compile time).
// Fallback to index.html for SPA routing.
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
    routing::{delete, get, patch, post, put},
    Router,
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{broadcast, mpsc};
use tokio_stream::wrappers::ReceiverStream;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};

use crate::commands::claude::{build_run_args, strip_ansi, AiProvider};
use crate::db::queries;

// ---------------------------------------------------------------------------
// SSE broadcast event
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum ServerEvent {
    TaskChanged { date: String },
    SettingsChanged,
    SessionChanged,
    ReportChanged { date: String },
    ProjectsChanged,
    TemplatesChanged,
}

// ---------------------------------------------------------------------------
// Shared server state
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct ServerState {
    /// Dedicated SQLite connection for HTTP handlers (WAL mode).
    db: Arc<Mutex<Connection>>,
    /// Shared job registry for cancellation (same Arc as Tauri commands).
    job_registry: Arc<Mutex<HashMap<String, u32>>>,
    /// Broadcast channel for real-time SSE events.
    event_tx: broadcast::Sender<ServerEvent>,
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
// Auth check — supports both header and query param
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct TokenQuery {
    token: Option<String>,
}

fn check_auth_inner(
    db: &Arc<Mutex<Connection>>,
    headers: &HeaderMap,
    query_token: Option<&str>,
) -> Result<(), ApiError> {
    let conn = db.lock().map_err(internal)?;
    let token_setting = queries::get_setting(&*conn, "http_auth_token")
        .unwrap_or_default();
    let token = token_setting.trim().to_string();
    drop(conn);
    if token.is_empty() {
        return Ok(());
    }
    // Check Authorization header
    let header_token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.to_string());
    // Check query param
    let provided = header_token.as_deref().or(query_token);
    if provided == Some(token.as_str()) {
        Ok(())
    } else {
        Err(unauthorized())
    }
}

fn check_auth(db: &Arc<Mutex<Connection>>, headers: &HeaderMap) -> Result<(), ApiError> {
    check_auth_inner(db, headers, None)
}

fn check_auth_with_query(
    db: &Arc<Mutex<Connection>>,
    headers: &HeaderMap,
    query_token: Option<&str>,
) -> Result<(), ApiError> {
    check_auth_inner(db, headers, query_token)
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
    token: Option<String>,
}

async fn get_tasks(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Query(q): Query<DateQuery>,
) -> Result<Json<Vec<queries::Task>>, ApiError> {
    check_auth_with_query(&s.db, &headers, q.token.as_deref())?;
    let date = q
        .date
        .filter(|d| !d.is_empty())
        .unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d").to_string());
    let conn = s.db.lock().map_err(internal)?;
    let tasks = queries::get_tasks_by_date(&*conn, &date).map_err(internal)?;
    Ok(Json(tasks))
}

// ---------------------------------------------------------------------------
// Route: GET /api/tasks/range?from=&to=
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct RangeQuery {
    from: Option<String>,
    to: Option<String>,
    token: Option<String>,
}

async fn get_tasks_range(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Query(q): Query<RangeQuery>,
) -> Result<Json<Vec<queries::Task>>, ApiError> {
    check_auth_with_query(&s.db, &headers, q.token.as_deref())?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let from = q.from.as_deref().unwrap_or(&today).to_string();
    let to = q.to.as_deref().unwrap_or(&today).to_string();
    let conn = s.db.lock().map_err(internal)?;
    let tasks = queries::get_tasks_by_date_range(&*conn, &from, &to).map_err(internal)?;
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
        &body.task_type.unwrap_or_else(|| "other".into()),
        body.priority.unwrap_or(2),
        body.estimated_min,
        body.project_id.as_deref(),
    )
    .map_err(internal)?;
    drop(conn);
    let _ = s.event_tx.send(ServerEvent::TaskChanged { date: body.date });
    Ok(Json(serde_json::json!({ "id": id })))
}

// ---------------------------------------------------------------------------
// Route: POST /api/tasks/rollover
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct RolloverBody {
    date: String,
}

async fn rollover_tasks(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Json(body): Json<RolloverBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let conn = s.db.lock().map_err(internal)?;
    let count = queries::rollover_incomplete_tasks(&*conn, &body.date).map_err(internal)?;
    drop(conn);
    let _ = s.event_tx.send(ServerEvent::TaskChanged { date: body.date });
    Ok(Json(serde_json::json!({ "rolled_over": count })))
}

// ---------------------------------------------------------------------------
// Route: POST /api/tasks/:id/carry-forward
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct CarryForwardBody {
    tomorrow_date: String,
    session_slot: i64,
}

async fn carry_task_forward(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<CarryForwardBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let conn = s.db.lock().map_err(internal)?;
    let new_id = queries::carry_task_forward(&*conn, &id, &body.tomorrow_date, body.session_slot)
        .map_err(internal)?;
    drop(conn);
    let _ = s.event_tx.send(ServerEvent::TaskChanged { date: body.tomorrow_date.clone() });
    Ok(Json(serde_json::json!({ "id": new_id })))
}

// ---------------------------------------------------------------------------
// Route: PATCH /api/tasks/reorder
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ReorderBody {
    task_ids: Vec<String>,
}

async fn reorder_tasks(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Json(body): Json<ReorderBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let conn = s.db.lock().map_err(internal)?;
    queries::reorder_tasks(&*conn, &body.task_ids).map_err(internal)?;
    Ok(Json(serde_json::json!({ "ok": true })))
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
    // Get task date for event
    let date = queries::get_task_by_id(&*conn, &id)
        .ok()
        .flatten()
        .map(|t| t.date)
        .unwrap_or_default();
    queries::update_task_status(&*conn, &id, &body.status).map_err(internal)?;
    drop(conn);
    if !date.is_empty() {
        let _ = s.event_tx.send(ServerEvent::TaskChanged { date });
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Route: PATCH /api/tasks/:id/move-session
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct MoveSessionBody {
    target_session: i64,
}

async fn move_task_session(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<MoveSessionBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let conn = s.db.lock().map_err(internal)?;
    let date = queries::get_task_by_id(&*conn, &id)
        .ok()
        .flatten()
        .map(|t| t.date)
        .unwrap_or_default();
    queries::move_task_to_session(&*conn, &id, body.target_session).map_err(internal)?;
    drop(conn);
    if !date.is_empty() {
        let _ = s.event_tx.send(ServerEvent::TaskChanged { date });
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Route: GET /api/tasks/:id
// ---------------------------------------------------------------------------

async fn get_task(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
    Path(id): Path<String>,
) -> Result<Json<queries::Task>, ApiError> {
    check_auth_with_query(&s.db, &headers, q.token.as_deref())?;
    let conn = s.db.lock().map_err(internal)?;
    let task = queries::get_task_by_id(&*conn, &id)
        .map_err(internal)?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Task not found".into()))?;
    Ok(Json(task))
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
    status: Option<String>,
    prompt_used: Option<String>,
    prompt_result: Option<String>,
}

async fn patch_task(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<PatchTaskBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let conn = s.db.lock().map_err(internal)?;
    let date = queries::get_task_by_id(&*conn, &id)
        .ok()
        .flatten()
        .map(|t| t.date)
        .unwrap_or_default();
    if let Some(status) = &body.status {
        queries::update_task_status(&*conn, &id, status).map_err(internal)?;
    } else if body.prompt_used.is_some() || body.prompt_result.is_some() {
        queries::save_prompt_result(
            &*conn,
            &id,
            body.prompt_used.as_deref().unwrap_or(""),
            body.prompt_result.as_deref().unwrap_or(""),
        )
        .map_err(internal)?;
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
    drop(conn);
    if !date.is_empty() {
        let _ = s.event_tx.send(ServerEvent::TaskChanged { date });
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Route: POST /api/tasks/:id/prompt-result
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct PromptResultBody {
    prompt_used: String,
    prompt_result: String,
}

async fn save_task_prompt_result(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<PromptResultBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let conn = s.db.lock().map_err(internal)?;
    queries::save_prompt_result(&*conn, &id, &body.prompt_used, &body.prompt_result)
        .map_err(internal)?;
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
    let date = queries::get_task_by_id(&*conn, &id)
        .ok()
        .flatten()
        .map(|t| t.date)
        .unwrap_or_default();
    queries::delete_task(&*conn, &id).map_err(internal)?;
    drop(conn);
    if !date.is_empty() {
        let _ = s.event_tx.send(ServerEvent::TaskChanged { date });
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Route: GET /api/settings
// ---------------------------------------------------------------------------

async fn get_settings(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth_with_query(&s.db, &headers, q.token.as_deref())?;
    let conn = s.db.lock().map_err(internal)?;
    let map = queries::get_all_settings(&*conn).map_err(internal)?;
    let safe: HashMap<_, _> = map
        .iter()
        .filter(|(k, _)| *k != "http_auth_token")
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    Ok(Json(serde_json::to_value(safe).unwrap_or_default()))
}

// ---------------------------------------------------------------------------
// Route: GET /api/settings/:key
// ---------------------------------------------------------------------------

async fn get_setting_by_key(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
    Path(key): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth_with_query(&s.db, &headers, q.token.as_deref())?;
    // Never expose auth token
    if key == "http_auth_token" {
        return Err(ApiError(StatusCode::FORBIDDEN, "Forbidden".into()));
    }
    let conn = s.db.lock().map_err(internal)?;
    let value = queries::get_setting(&*conn, &key).ok();
    Ok(Json(serde_json::json!({ "key": key, "value": value })))
}

// ---------------------------------------------------------------------------
// Route: PUT /api/settings/:key
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct SetSettingBody {
    value: String,
}

async fn set_setting_by_key(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(key): Path<String>,
    Json(body): Json<SetSettingBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    if key == "http_auth_token" {
        return Err(ApiError(StatusCode::FORBIDDEN, "Forbidden".into()));
    }
    let conn = s.db.lock().map_err(internal)?;
    queries::set_setting(&*conn, &key, &body.value).map_err(internal)?;
    drop(conn);
    let _ = s.event_tx.send(ServerEvent::SettingsChanged);
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Route: GET /api/session
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
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
) -> Result<Json<SessionInfo>, ApiError> {
    check_auth_with_query(&s.db, &headers, q.token.as_deref())?;
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
    token: Option<String>,
}

async fn get_reports(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Query(q): Query<ReportsQuery>,
) -> Result<Json<Vec<queries::DailyReport>>, ApiError> {
    check_auth_with_query(&s.db, &headers, q.token.as_deref())?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let from = q.from.as_deref().unwrap_or(&today).to_string();
    let to = q.to.as_deref().unwrap_or(&today).to_string();
    let conn = s.db.lock().map_err(internal)?;
    let reports = queries::get_reports_range(&*conn, &from, &to).map_err(internal)?;
    Ok(Json(reports))
}

// ---------------------------------------------------------------------------
// Route: GET /api/reports/:date
// ---------------------------------------------------------------------------

async fn get_report(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
    Path(date): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth_with_query(&s.db, &headers, q.token.as_deref())?;
    let conn = s.db.lock().map_err(internal)?;
    // queries::get_report returns Result<Option<DailyReport>>
    let report = queries::get_report(&*conn, &date).map_err(internal)?;
    Ok(Json(serde_json::to_value(report).unwrap_or(serde_json::Value::Null)))
}

// ---------------------------------------------------------------------------
// Route: POST /api/reports/:date/generate
// ---------------------------------------------------------------------------

async fn generate_report_endpoint(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(date): Path<String>,
) -> Result<Json<queries::DailyReport>, ApiError> {
    check_auth(&s.db, &headers)?;
    let conn = s.db.lock().map_err(internal)?;
    // queries::generate_report is the actual function name
    let report = queries::generate_report(&*conn, &date).map_err(internal)?;
    drop(conn);
    let _ = s.event_tx.send(ServerEvent::ReportChanged { date });
    Ok(Json(report))
}

// ---------------------------------------------------------------------------
// Route: POST /api/reports/:date/reflection
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ReflectionBody {
    reflection: String,
}

async fn save_report_reflection(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(date): Path<String>,
    Json(body): Json<ReflectionBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let conn = s.db.lock().map_err(internal)?;
    queries::save_ai_reflection(&*conn, &date, &body.reflection).map_err(internal)?;
    drop(conn);
    let _ = s.event_tx.send(ServerEvent::ReportChanged { date });
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Route: GET /api/projects
// ---------------------------------------------------------------------------

async fn get_projects(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
) -> Result<Json<Vec<queries::Project>>, ApiError> {
    check_auth_with_query(&s.db, &headers, q.token.as_deref())?;
    let conn = s.db.lock().map_err(internal)?;
    let projects = queries::get_projects(&*conn).map_err(internal)?;
    Ok(Json(projects))
}

// ---------------------------------------------------------------------------
// Route: POST /api/projects
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct CreateProjectBody {
    name: String,
    path: String,
}

async fn create_project(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Json(body): Json<CreateProjectBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let conn = s.db.lock().map_err(internal)?;
    let id = queries::create_project(&*conn, &body.name, &body.path).map_err(internal)?;
    drop(conn);
    let _ = s.event_tx.send(ServerEvent::ProjectsChanged);
    Ok(Json(serde_json::json!({ "id": id })))
}

// ---------------------------------------------------------------------------
// Route: DELETE /api/projects/:id
// ---------------------------------------------------------------------------

async fn delete_project(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let conn = s.db.lock().map_err(internal)?;
    queries::delete_project(&*conn, &id).map_err(internal)?;
    drop(conn);
    let _ = s.event_tx.send(ServerEvent::ProjectsChanged);
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Route: GET /api/projects/:id/prompt
// ---------------------------------------------------------------------------

async fn get_project_prompt(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth_with_query(&s.db, &headers, q.token.as_deref())?;
    let conn = s.db.lock().map_err(internal)?;
    let prompt = queries::get_project_prompt(&*conn, &id).map_err(internal)?;
    Ok(Json(serde_json::json!({ "prompt": prompt })))
}

// ---------------------------------------------------------------------------
// Route: PUT /api/projects/:id/prompt
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct SetPromptBody {
    prompt: String,
}

async fn set_project_prompt(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<SetPromptBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let conn = s.db.lock().map_err(internal)?;
    queries::set_project_prompt(&*conn, &id, &body.prompt).map_err(internal)?;
    drop(conn);
    let _ = s.event_tx.send(ServerEvent::ProjectsChanged);
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Route: GET /api/prompt/global
// ---------------------------------------------------------------------------

async fn get_global_prompt(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth_with_query(&s.db, &headers, q.token.as_deref())?;
    let conn = s.db.lock().map_err(internal)?;
    let prompt = queries::get_setting(&*conn, "global_prompt").ok();
    Ok(Json(serde_json::json!({ "prompt": prompt })))
}

// ---------------------------------------------------------------------------
// Route: PUT /api/prompt/global
// ---------------------------------------------------------------------------

async fn set_global_prompt(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Json(body): Json<SetPromptBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let conn = s.db.lock().map_err(internal)?;
    queries::set_setting(&*conn, "global_prompt", &body.prompt).map_err(internal)?;
    drop(conn);
    let _ = s.event_tx.send(ServerEvent::SettingsChanged);
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Route: GET /api/prompt/templates
// ---------------------------------------------------------------------------

async fn get_prompt_templates(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
) -> Result<Json<Vec<queries::PromptTemplateItem>>, ApiError> {
    check_auth_with_query(&s.db, &headers, q.token.as_deref())?;
    let conn = s.db.lock().map_err(internal)?;
    let templates = queries::list_prompt_templates(&*conn).map_err(internal)?;
    Ok(Json(templates))
}

// ---------------------------------------------------------------------------
// Route: POST /api/prompt/templates
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct CreateTemplateBody {
    name: String,
    content: String,
}

async fn create_prompt_template(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Json(body): Json<CreateTemplateBody>,
) -> Result<Json<queries::PromptTemplateItem>, ApiError> {
    check_auth(&s.db, &headers)?;
    let conn = s.db.lock().map_err(internal)?;
    let template = queries::create_prompt_template(&*conn, &body.name, &body.content)
        .map_err(internal)?;
    drop(conn);
    let _ = s.event_tx.send(ServerEvent::TemplatesChanged);
    Ok(Json(template))
}

// ---------------------------------------------------------------------------
// Route: PATCH /api/prompt/templates/:id
// Note: update_prompt_template takes &str (not Option<&str>) — both name and
// content are required. The client must supply both fields.
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct UpdateTemplateBody {
    name: String,
    content: String,
}

async fn update_prompt_template(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<UpdateTemplateBody>,
) -> Result<Json<queries::PromptTemplateItem>, ApiError> {
    check_auth(&s.db, &headers)?;
    let conn = s.db.lock().map_err(internal)?;
    let template = queries::update_prompt_template(
        &*conn,
        &id,
        &body.name,
        &body.content,
    )
    .map_err(internal)?;
    drop(conn);
    let _ = s.event_tx.send(ServerEvent::TemplatesChanged);
    Ok(Json(template))
}

// ---------------------------------------------------------------------------
// Route: DELETE /api/prompt/templates/:id
// ---------------------------------------------------------------------------

async fn delete_prompt_template_handler(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let conn = s.db.lock().map_err(internal)?;
    // delete_prompt_template returns Result<bool>; map the error only
    queries::delete_prompt_template(&*conn, &id).map_err(internal)?;
    drop(conn);
    let _ = s.event_tx.send(ServerEvent::TemplatesChanged);
    Ok(Json(serde_json::json!({ "ok": true })))
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
// Route: GET /api/events  (SSE — real-time push)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct EventsQuery {
    token: Option<String>,
}

async fn events_stream(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Query(q): Query<EventsQuery>,
) -> Result<impl IntoResponse, ApiError> {
    check_auth_with_query(&s.db, &headers, q.token.as_deref())?;

    let mut rx = s.event_tx.subscribe();
    let (tx, stream_rx) = mpsc::channel::<Result<Event, Infallible>>(64);

    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let data = serde_json::to_string(&event).unwrap_or_default();
                    let event_type = match &event {
                        ServerEvent::TaskChanged { .. } => "task_changed",
                        ServerEvent::SettingsChanged => "settings_changed",
                        ServerEvent::SessionChanged => "session_changed",
                        ServerEvent::ReportChanged { .. } => "report_changed",
                        ServerEvent::ProjectsChanged => "projects_changed",
                        ServerEvent::TemplatesChanged => "templates_changed",
                    };
                    if tx
                        .send(Ok(Event::default().event(event_type).data(data)))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Closed) => break,
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
            }
        }
    });

    Ok(sse_stream(stream_rx))
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
        let _ = child.wait().await;
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
        let tx_done = tx.clone();
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
        let _ = tx_done
            .send(Ok(Event::default()
                .event("done")
                .data(serde_json::json!({ "job_id": jid, "success": success }).to_string())))
            .await;
    });

    Ok(sse_stream(rx))
}

// ---------------------------------------------------------------------------
// Server entry point
// ---------------------------------------------------------------------------

pub async fn start(
    db_path: PathBuf,
    job_registry: Arc<Mutex<HashMap<String, u32>>>,
    dist_path: Option<PathBuf>,
) {
    let conn = match Connection::open(&db_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[http_server] Failed to open DB at {:?}: {}", db_path, e);
            return;
        }
    };
    if let Err(e) = conn.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;"
    ) {
        eprintln!("[http_server] Failed to set DB pragmas: {}", e);
    }
    let db = Arc::new(Mutex::new(conn));

    let port: u16 = {
        let c = db.lock().unwrap();
        queries::get_setting(&*c, "http_server_port")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(7734)
    };

    let (event_tx, _) = broadcast::channel::<ServerEvent>(256);

    let state = ServerState { db, job_registry, event_tx };

    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE, Method::PUT, Method::OPTIONS])
        .allow_headers(Any)
        .allow_origin(Any);

    let app = Router::new()
        // Health (no auth)
        .route("/api/health", get(health))
        // Real-time events SSE (auth via query param)
        .route("/api/events", get(events_stream))
        // Tasks
        .route("/api/tasks", get(get_tasks).post(create_task))
        .route("/api/tasks/range", get(get_tasks_range))
        .route("/api/tasks/rollover", post(rollover_tasks))
        .route("/api/tasks/reorder", patch(reorder_tasks))
        .route("/api/tasks/:id", get(get_task).patch(patch_task).delete(delete_task))
        .route("/api/tasks/:id/status", patch(patch_task_status))
        .route("/api/tasks/:id/move-session", patch(move_task_session))
        .route("/api/tasks/:id/carry-forward", post(carry_task_forward))
        .route("/api/tasks/:id/prompt-result", post(save_task_prompt_result))
        // Settings
        .route("/api/settings", get(get_settings))
        .route("/api/settings/:key", get(get_setting_by_key).put(set_setting_by_key))
        // Session
        .route("/api/session", get(get_session))
        // Reports
        .route("/api/reports", get(get_reports))
        .route("/api/reports/:date", get(get_report))
        .route("/api/reports/:date/generate", post(generate_report_endpoint))
        .route("/api/reports/:date/reflection", post(save_report_reflection))
        // Projects
        .route("/api/projects", get(get_projects).post(create_project))
        .route("/api/projects/:id", delete(delete_project))
        .route("/api/projects/:id/prompt", get(get_project_prompt).put(set_project_prompt))
        // Prompt
        .route("/api/prompt/global", get(get_global_prompt).put(set_global_prompt))
        .route("/api/prompt/templates", get(get_prompt_templates).post(create_prompt_template))
        .route("/api/prompt/templates/:id", patch(update_prompt_template).delete(delete_prompt_template_handler))
        .route("/api/prompt/improve", post(prompt_improve))
        .route("/api/prompt/run", post(prompt_run))
        .layer(cors)
        .with_state(state);

    // SPA fallback — serves dist/ for all non-API routes
    let app = if let Some(dist) = dist_path {
        let index = dist.join("index.html");
        let spa = ServeDir::new(&dist).not_found_service(ServeFile::new(index));
        app.fallback_service(spa)
    } else {
        app.fallback(|| async { (StatusCode::SERVICE_UNAVAILABLE, "Frontend not built. Run: npm run build") })
    };

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

#[tauri::command]
pub fn get_http_server_port(db: tauri::State<'_, crate::db::DbConnection>) -> Result<u16, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let port = queries::get_setting(&*conn, "http_server_port")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(7734u16);
    Ok(port)
}
