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

use crate::auth;
use crate::commands::claude::{build_run_args, strip_ansi, AiProvider};
use crate::commands::tasks::{
    build_brainstorm_prompt, validate_and_sanitize_suggestions, validate_attachments,
    BrainstormTaskSuggestion, TaskAttachmentInput,
};
use crate::db::queries;

// ---------------------------------------------------------------------------
// SSE broadcast event
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum ServerEvent {
    TaskChanged { date: String },
    SettingsChanged,
    ProjectsChanged,
    TemplatesChanged,
    DevicesChanged,
    JobStatusChanged { job_id: String },
    JobOutput { job_id: String },
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
    /// Shared Cloudflare tunnel manager.
    tunnel_manager: Arc<crate::tunnel::TunnelManager>,
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
// Auth helpers
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct TokenQuery {
    token: Option<String>,
}

/// Extract the `synq-session` cookie value from the `Cookie` header, if present.
fn extract_session_cookie(headers: &HeaderMap) -> Option<String> {
    let cookie_header = headers.get("cookie")?.to_str().ok()?;
    for part in cookie_header.split(';') {
        let part = part.trim();
        if let Some(value) = part.strip_prefix("synq-session=") {
            return Some(value.to_string());
        }
    }
    None
}

/// Build a Set-Cookie header value for the session cookie.
/// Adds the `Secure` flag when the request came in over HTTPS (X-Forwarded-Proto).
fn build_set_cookie(token: &str, headers: &HeaderMap, max_age_secs: i64) -> String {
    let secure = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.eq_ignore_ascii_case("https"))
        .unwrap_or(false);
    let mut cookie = format!(
        "synq-session={}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}",
        token, max_age_secs
    );
    if secure {
        cookie.push_str("; Secure");
    }
    cookie
}

/// Check authentication — session cookie first, then Bearer token fallback.
/// Returns the authenticated user_id (or sentinel) on success.
fn check_auth_inner(db: &Arc<Mutex<Connection>>, headers: &HeaderMap) -> Result<String, ApiError> {
    let conn = db.lock().map_err(internal)?;

    // 1. Check synq-session cookie → validate session in DB
    if let Some(token) = extract_session_cookie(headers) {
        match auth::validate_session(&*conn, &token) {
            Ok(Some(user_id)) => return Ok(user_id),
            Ok(None) => {}
            Err(e) => eprintln!("[auth] session validation error: {}", e),
        }
    }

    // 2. Fall back to Bearer token (backward compat for MCP/API clients)
    let token_setting = queries::get_setting(&*conn, "http_auth_token").unwrap_or_default();
    let token = token_setting.trim().to_string();
    if !token.is_empty() {
        let provided = headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        let expected = format!("Bearer {}", token);
        if provided == expected {
            return Ok("__bearer__".to_string());
        }
        return Err(unauthorized());
    }

    // 3. No auth configured — open access mode
    Ok("__open__".to_string())
}

fn check_auth(db: &Arc<Mutex<Connection>>, headers: &HeaderMap) -> Result<(), ApiError> {
    check_auth_inner(db, headers).map(|_| ())
}

/// Legacy query-token wrapper (kept for SSE EventSource compat).
fn check_auth_with_query(
    db: &Arc<Mutex<Connection>>,
    headers: &HeaderMap,
    query_token: Option<&str>,
) -> Result<(), ApiError> {
    // Try session/Bearer first; if that fails and a query token was supplied, check it
    match check_auth_inner(db, headers) {
        Ok(_) => Ok(()),
        Err(_) => {
            if let Some(qt) = query_token {
                let conn = db.lock().map_err(internal)?;
                let stored = queries::get_setting(&*conn, "http_auth_token").unwrap_or_default();
                if !stored.trim().is_empty() && qt == stored.trim() {
                    return Ok(());
                }
            }
            Err(unauthorized())
        }
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/auth/login
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct LoginBody {
    username: String,
    password: String,
}

#[derive(Serialize)]
struct LoginResponse {
    must_change_password: bool,
}

async fn auth_login(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Json(body): Json<LoginBody>,
) -> Result<impl IntoResponse, ApiError> {
    if body.password.len() < 6 {
        return Err(bad_request("Password too short"));
    }
    let (user, stored_hash) = {
        let conn = s.db.lock().map_err(internal)?;
        let user = auth::get_user_by_username(&*conn, &body.username)
            .map_err(internal)?
            .ok_or_else(unauthorized)?;
        let hash = auth::get_password_hash(&*conn, &user.id)
            .map_err(internal)?
            .ok_or_else(unauthorized)?;
        (user, hash)
    };
    let password = body.password.clone();
    let ok = tokio::task::spawn_blocking(move || auth::verify_password(&password, &stored_hash))
        .await
        .map_err(|e| internal(e))?
        .map_err(internal)?;
    if !ok {
        return Err(unauthorized());
    }
    let token = {
        let conn = s.db.lock().map_err(internal)?;
        auth::create_session(&*conn, &user.id).map_err(internal)?
    };
    let max_age: i64 = 30 * 24 * 3600;
    let set_cookie = build_set_cookie(&token, &headers, max_age);
    let mut response_headers = axum::http::HeaderMap::new();
    response_headers.insert(
        axum::http::header::SET_COOKIE,
        set_cookie.parse().map_err(internal)?,
    );
    Ok((response_headers, Json(LoginResponse { must_change_password: user.must_change_password })))
}

// ---------------------------------------------------------------------------
// Route: POST /api/auth/logout
// ---------------------------------------------------------------------------

async fn auth_logout(
    State(s): State<ServerState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    if let Some(token) = extract_session_cookie(&headers) {
        let conn = s.db.lock().map_err(internal)?;
        let _ = auth::delete_session(&*conn, &token);
    }
    let clear_cookie = "synq-session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0".to_string();
    let mut response_headers = axum::http::HeaderMap::new();
    response_headers.insert(
        axum::http::header::SET_COOKIE,
        clear_cookie.parse().map_err(internal)?,
    );
    Ok((response_headers, Json(serde_json::json!({ "ok": true }))))
}

// ---------------------------------------------------------------------------
// Route: POST /api/auth/change-password
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ChangePasswordBody {
    new_password: String,
}

async fn auth_change_password(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Json(body): Json<ChangePasswordBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if body.new_password.len() < 6 {
        return Err(bad_request("Password must be at least 6 characters"));
    }
    let user_id = check_auth_inner(&s.db, &headers)?;
    if user_id == "__bearer__" || user_id == "__open__" {
        return Err(unauthorized());
    }
    let new_pass = body.new_password.clone();
    let new_hash = tokio::task::spawn_blocking(move || auth::hash_password(&new_pass))
        .await
        .map_err(|e| internal(e))?
        .map_err(internal)?;
    {
        let conn = s.db.lock().map_err(internal)?;
        auth::change_password(&*conn, &user_id, &new_hash).map_err(internal)?;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Route: POST /api/auth/forgot-password
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ForgotPasswordBody {
    username: String,
}

async fn auth_forgot_password(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Json(body): Json<ForgotPasswordBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let username = body.username.trim();
    if username.is_empty() {
        return Err(bad_request("Username is required"));
    }

    let user = {
        let conn = s.db.lock().map_err(internal)?;
        auth::get_user_by_username(&*conn, username).map_err(internal)?
    };

    if let Some(u) = user {
        let token = uuid::Uuid::new_v4().to_string();
        let expires_at = chrono::Utc::now() + chrono::Duration::minutes(30);
        let expires_str = expires_at.to_rfc3339();

        {
            let conn = s.db.lock().map_err(internal)?;
            queries::set_setting(&*conn, "password_reset_token", &token).map_err(internal)?;
            queries::set_setting(&*conn, "password_reset_expires_at", &expires_str).map_err(internal)?;
            queries::set_setting(&*conn, "password_reset_user_id", &u.id).map_err(internal)?;
        }

        let proto = headers
            .get("x-forwarded-proto")
            .and_then(|v| v.to_str().ok())
            .filter(|v| !v.trim().is_empty())
            .unwrap_or("http");
        let host = headers
            .get("x-forwarded-host")
            .or_else(|| headers.get("host"))
            .and_then(|v| v.to_str().ok())
            .filter(|v| !v.trim().is_empty())
            .unwrap_or("localhost:7734");
        let link = format!("{}://{}/?reset_token={}", proto, host, token);
        eprintln!("[auth] Password reset link for {}: {}", username, link);
    }

    // Return a generic success response to avoid username enumeration.
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Route: POST /api/auth/reset-password
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ResetPasswordBody {
    token: String,
    new_password: String,
}

async fn auth_reset_password(
    State(s): State<ServerState>,
    Json(body): Json<ResetPasswordBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if body.new_password.len() < 6 {
        return Err(bad_request("Password must be at least 6 characters"));
    }
    if body.token.trim().is_empty() {
        return Err(bad_request("Reset token is required"));
    }

    let (stored_token, expires_at_str, user_id) = {
        let conn = s.db.lock().map_err(internal)?;
        (
            queries::get_setting(&*conn, "password_reset_token").map_err(internal)?,
            queries::get_setting(&*conn, "password_reset_expires_at").map_err(internal)?,
            queries::get_setting(&*conn, "password_reset_user_id").map_err(internal)?,
        )
    };

    let token_ok = stored_token.trim() == body.token.trim();
    let user_id = user_id.trim().to_string();
    let exp = chrono::DateTime::parse_from_rfc3339(expires_at_str.trim())
        .map_err(|_| bad_request("Invalid or expired reset token"))?
        .with_timezone(&chrono::Utc);
    if !token_ok || user_id.is_empty() || chrono::Utc::now() > exp {
        return Err(bad_request("Invalid or expired reset token"));
    }

    let new_pass = body.new_password.clone();
    let new_hash = tokio::task::spawn_blocking(move || auth::hash_password(&new_pass))
        .await
        .map_err(|e| internal(e))?
        .map_err(internal)?;

    {
        let conn = s.db.lock().map_err(internal)?;
        auth::change_password(&*conn, &user_id, &new_hash).map_err(internal)?;
        queries::set_setting(&*conn, "password_reset_token", "").map_err(internal)?;
        queries::set_setting(&*conn, "password_reset_expires_at", "").map_err(internal)?;
        queries::set_setting(&*conn, "password_reset_user_id", "").map_err(internal)?;
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Route: GET /api/auth/me
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct MeResponse {
    username: String,
    must_change_password: bool,
}

async fn auth_me(
    State(s): State<ServerState>,
    headers: HeaderMap,
) -> Result<Json<MeResponse>, ApiError> {
    let user_id = check_auth_inner(&s.db, &headers)?;
    if user_id == "__bearer__" || user_id == "__open__" {
        return Err(ApiError(StatusCode::UNAUTHORIZED, "Session auth required".into()));
    }
    let conn = s.db.lock().map_err(internal)?;
    let user = auth::get_user_by_id(&*conn, &user_id)
        .map_err(internal)?
        .ok_or_else(|| ApiError(StatusCode::UNAUTHORIZED, "User not found".into()))?;
    Ok(Json(MeResponse {
        username: user.username,
        must_change_password: user.must_change_password,
    }))
}


// ---------------------------------------------------------------------------
// Route: GET /api/health
// ---------------------------------------------------------------------------

async fn health() -> Json<serde_json::Value> {
    #[cfg(target_os = "linux")]
    let headless = std::env::var("DISPLAY").ok().map(|v| !v.trim().is_empty()).unwrap_or(false) == false
        && std::env::var("WAYLAND_DISPLAY").ok().map(|v| !v.trim().is_empty()).unwrap_or(false) == false;
    #[cfg(not(target_os = "linux"))]
    let headless = false;

    Json(serde_json::json!({
        "ok": true,
        "platform": std::env::consts::OS,
        "headless": headless
    }))
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
    let conn = s.db.lock().map_err(internal)?;
    let tasks = queries::get_all_tasks_active(&*conn).map_err(internal)?;
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
    title: String,
    description: Option<String>,
    task_type: Option<String>,
    priority: Option<i64>,
    estimated_min: Option<i64>,
    project_id: Option<String>,
    deadline: Option<String>,
    agent: Option<String>,
    git_workflow: Option<bool>,
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
        &body.title,
        body.description.as_deref(),
        &body.task_type.unwrap_or_else(|| "prompt".into()),
        body.priority.unwrap_or(2),
        body.estimated_min,
        body.project_id.as_deref(),
        body.deadline.as_deref(),
        body.agent.as_deref(),
        body.git_workflow.unwrap_or(false),
    )
    .map_err(internal)?;
    drop(conn);
    let _ = s.event_tx.send(ServerEvent::TaskChanged { date: String::new() });
    Ok(Json(serde_json::json!({ "id": id })))
}

// ---------------------------------------------------------------------------
// Route: POST /api/tasks/:id/carry-forward
// ---------------------------------------------------------------------------

async fn carry_task_forward(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let conn = s.db.lock().map_err(internal)?;
    let new_id = queries::carry_task_forward(&*conn, &id).map_err(internal)?;
    drop(conn);
    let _ = s.event_tx.send(ServerEvent::TaskChanged { date: String::new() });
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
    queries::update_task_status(&*conn, &id, &body.status).map_err(internal)?;
    drop(conn);
    let _ = s.event_tx.send(ServerEvent::TaskChanged { date: String::new() });
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
    description: Option<String>,
    notes: Option<String>,
    task_type: Option<String>,
    priority: Option<i64>,
    estimated_min: Option<i64>,
    project_id: Option<String>,
    clear_project: Option<bool>,
    status: Option<String>,
    raw_prompt: Option<String>,
    improved_prompt: Option<String>,
    deadline: Option<Option<String>>,
    agent: Option<Option<String>>,
    git_workflow: Option<bool>,
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
    } else if body.raw_prompt.is_some() || body.improved_prompt.is_some() {
        queries::save_task_prompt(
            &*conn,
            &id,
            body.raw_prompt.as_deref(),
            body.improved_prompt.as_deref(),
        )
        .map_err(internal)?;
    } else {
        queries::update_task(
            &*conn,
            &id,
            body.title.as_deref(),
            body.description.as_deref(),
            body.notes.as_deref(),
            body.task_type.as_deref(),
            body.priority,
            body.estimated_min,
            body.project_id.as_deref(),
            body.clear_project.unwrap_or(false),
            body.deadline.as_ref().map(|d| d.as_deref()),
            body.agent.as_ref().map(|a| a.as_deref()),
            body.git_workflow,
        )
        .map_err(internal)?;
    }
    drop(conn);
    let _ = s.event_tx.send(ServerEvent::TaskChanged { date: String::new() });
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Route: POST /api/tasks/:id/prompt-result
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct PromptResultBody {
    raw_prompt: Option<String>,
    improved_prompt: Option<String>,
}

async fn save_task_prompt_result(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<PromptResultBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let conn = s.db.lock().map_err(internal)?;
    queries::save_task_prompt(&*conn, &id, body.raw_prompt.as_deref(), body.improved_prompt.as_deref())
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
    queries::delete_task(&*conn, &id).map_err(internal)?;
    drop(conn);
    let _ = s.event_tx.send(ServerEvent::TaskChanged { date: String::new() });
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
// Route: GET /api/ai-providers
// ---------------------------------------------------------------------------

async fn get_ai_providers(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth_with_query(&s.db, &headers, q.token.as_deref())?;
    let providers = crate::commands::ai_providers::detect_available_providers();
    Ok(Json(serde_json::to_value(providers).unwrap_or_default()))
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
// Route: GET /api/remote/auth-token
// ---------------------------------------------------------------------------

async fn get_remote_auth_token(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth_with_query(&s.db, &headers, q.token.as_deref())?;
    let conn = s.db.lock().map_err(internal)?;
    let token = queries::get_setting(&*conn, "http_auth_token").unwrap_or_default();
    let trimmed = token.trim().to_string();
    let value = if trimmed.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(trimmed) };
    Ok(Json(serde_json::json!({ "token": value })))
}

// ---------------------------------------------------------------------------
// Route: POST /api/remote/auth-token/regenerate
// ---------------------------------------------------------------------------

async fn regenerate_remote_auth_token(
    State(s): State<ServerState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let new_token: String = {
        use rand::Rng;
        rand::thread_rng()
            .sample_iter(&rand::distributions::Alphanumeric)
            .take(32)
            .map(char::from)
            .collect()
    };
    let conn = s.db.lock().map_err(internal)?;
    queries::set_setting(&*conn, "http_auth_token", &new_token).map_err(internal)?;
    drop(conn);
    let _ = s.event_tx.send(ServerEvent::SettingsChanged);
    Ok(Json(serde_json::json!({ "token": new_token })))
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
// Route: GET /api/projects/trash
// ---------------------------------------------------------------------------

async fn get_trashed_projects(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
) -> Result<Json<Vec<queries::Project>>, ApiError> {
    check_auth_with_query(&s.db, &headers, q.token.as_deref())?;
    let conn = s.db.lock().map_err(internal)?;
    let projects = queries::get_trashed_projects(&*conn).map_err(internal)?;
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

#[derive(Deserialize)]
struct ValidateProjectPathBody {
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

async fn validate_project_path_http(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Json(body): Json<ValidateProjectPathBody>,
) -> Result<Json<crate::commands::projects::ProjectPathValidation>, ApiError> {
    check_auth(&s.db, &headers)?;
    Ok(Json(crate::commands::projects::validate_project_path_internal(
        &body.path,
    )))
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
// Route: POST /api/projects/:id/restore
// ---------------------------------------------------------------------------

async fn restore_project(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let conn = s.db.lock().map_err(internal)?;
    queries::restore_project(&*conn, &id).map_err(internal)?;
    drop(conn);
    let _ = s.event_tx.send(ServerEvent::ProjectsChanged);
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Route: DELETE /api/projects/:id/hard
// ---------------------------------------------------------------------------

async fn hard_delete_project(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let conn = s.db.lock().map_err(internal)?;
    queries::hard_delete_project(&*conn, &id).map_err(internal)?;
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
// Route: GET /api/devices
// ---------------------------------------------------------------------------

async fn list_devices_handler(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
) -> Result<Json<Vec<queries::Device>>, ApiError> {
    check_auth_with_query(&s.db, &headers, q.token.as_deref())?;
    let conn = s.db.lock().map_err(internal)?;
    let devices = queries::list_devices(&*conn).map_err(internal)?;
    Ok(Json(devices))
}

// ---------------------------------------------------------------------------
// Route: POST /api/devices/register
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct RegisterDeviceBody {
    id: String,
    name: String,
}

async fn register_device_handler(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
    Json(body): Json<RegisterDeviceBody>,
) -> Result<Json<queries::Device>, ApiError> {
    check_auth_with_query(&s.db, &headers, q.token.as_deref())?;
    let conn = s.db.lock().map_err(internal)?;
    let device = queries::register_device(&*conn, &body.id, &body.name).map_err(internal)?;
    drop(conn);
    let _ = s.event_tx.send(ServerEvent::DevicesChanged);
    Ok(Json(device))
}

// ---------------------------------------------------------------------------
// Route: DELETE /api/devices/:id
// ---------------------------------------------------------------------------

async fn delete_device_handler(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let conn = s.db.lock().map_err(internal)?;
    queries::delete_device(&*conn, &id).map_err(internal)?;
    drop(conn);
    let _ = s.event_tx.send(ServerEvent::DevicesChanged);
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Tunnel routes (Cloudflare)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct StartTunnelHttpBody {
    port: Option<u16>,
}

async fn get_tunnel_status_handler(
    State(s): State<ServerState>,
    headers: HeaderMap,
) -> Result<Json<crate::tunnel::TunnelStatus>, ApiError> {
    check_auth(&s.db, &headers)?;
    Ok(Json(s.tunnel_manager.status().await))
}

async fn start_tunnel_handler(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Json(body): Json<StartTunnelHttpBody>,
) -> Result<Json<crate::tunnel::TunnelStatus>, ApiError> {
    check_auth(&s.db, &headers)?;
    let port = if let Some(p) = body.port {
        p
    } else {
        let conn = s.db.lock().map_err(internal)?;
        queries::get_setting(&*conn, "http_server_port")
            .ok()
            .and_then(|v| v.parse::<u16>().ok())
            .unwrap_or(7734)
    };
    let status = s
        .tunnel_manager
        .start(port)
        .await
        .map_err(internal)?;
    Ok(Json(status))
}

async fn stop_tunnel_handler(
    State(s): State<ServerState>,
    headers: HeaderMap,
) -> Result<Json<crate::tunnel::TunnelStatus>, ApiError> {
    check_auth(&s.db, &headers)?;
    let status = s.tunnel_manager.stop().await.map_err(internal)?;
    Ok(Json(status))
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
                        ServerEvent::ProjectsChanged => "projects_changed",
                        ServerEvent::TemplatesChanged => "templates_changed",
                        ServerEvent::DevicesChanged => "devices_changed",
                        ServerEvent::JobStatusChanged { .. } => "job_status_changed",
                        ServerEvent::JobOutput { .. } => "job_output",
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

#[derive(Deserialize)]
struct BrainstormBody {
    notes: String,
    attachments: Option<Vec<TaskAttachmentInput>>,
    provider: Option<String>,
    project_path: Option<String>,
}

async fn brainstorm_tasks(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Json(body): Json<BrainstormBody>,
) -> Result<Json<Vec<BrainstormTaskSuggestion>>, ApiError> {
    check_auth(&s.db, &headers)?;
    let trimmed_notes = body.notes.trim();
    if trimmed_notes.is_empty() {
        return Err(bad_request("notes are required"));
    }

    let attachments = body.attachments.unwrap_or_default();
    let attachment_lines = validate_attachments(&attachments)
        .map_err(|e| ApiError(StatusCode::BAD_REQUEST, e))?;
    let prompt = build_brainstorm_prompt(trimmed_notes, &attachment_lines);

    let selected_model = {
        let conn = s.db.lock().map_err(internal)?;
        let model_key = crate::commands::claude::default_model_setting_key(body.provider.as_deref());
        let model = queries::get_setting(&*conn, model_key)
            .ok()
            .map(|x| x.trim().to_string())
            .filter(|x| !x.is_empty());
        let legacy = if model_key == "default_model_claude" {
            queries::get_setting(&*conn, "claude_model")
                .ok()
                .map(|x| x.trim().to_string())
                .filter(|x| !x.is_empty())
        } else {
            None
        };
        model.or(legacy)
    };

    let ai_provider = AiProvider::from_input(body.provider.as_deref());
    let model = selected_model
        .unwrap_or_else(|| ai_provider.hardcoded_default_model().to_string());
    let args = build_run_args(ai_provider, &prompt, Some(&model));

    let mut cmd = tokio::process::Command::new(ai_provider.cli_binary());
    for arg in args {
        cmd.arg(arg);
    }
    cmd.env("NO_COLOR", "1");
    cmd.stdin(Stdio::null());
    if let Some(path) = body.project_path.as_deref().filter(|p| !p.trim().is_empty()) {
        cmd.current_dir(path);
    }

    let output = cmd.output().await.map_err(|e| {
        ApiError(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to run AI brainstorm command: {}", e),
        )
    })?;
    if !output.status.success() {
        return Err(ApiError(
            StatusCode::BAD_GATEWAY,
            format!(
                "AI brainstorm failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ),
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let tasks = validate_and_sanitize_suggestions(&stdout)
        .map_err(|e| ApiError(StatusCode::BAD_GATEWAY, e))?;

    Ok(Json(tasks))
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
// Helper: look up a project by id using the existing connection guard
// ---------------------------------------------------------------------------

fn get_project_by_id(conn: &Connection, id: &str) -> Option<queries::Project> {
    conn.query_row(
        "SELECT id, name, path, prompt, deleted_at, created_at FROM projects WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(queries::Project {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                prompt: row.get(3)?,
                deleted_at: row.get(4)?,
                created_at: row.get(5)?,
            })
        },
    )
    .ok()
}

// ---------------------------------------------------------------------------
// Route: GET /api/projects/:id/tasks
// ---------------------------------------------------------------------------

async fn get_project_tasks(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth_with_query(&s.db, &headers, q.token.as_deref())?;
    let conn = s.db.lock().map_err(internal)?;
    let tasks = queries::get_tasks_by_project(&*conn, &id).map_err(internal)?;
    Ok(Json(serde_json::json!({ "tasks": tasks })))
}

// ---------------------------------------------------------------------------
// Route: GET /api/tasks/standalone
// ---------------------------------------------------------------------------

async fn get_standalone_tasks_http(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth_with_query(&s.db, &headers, q.token.as_deref())?;
    let conn = s.db.lock().map_err(internal)?;
    let tasks = queries::get_standalone_tasks(&*conn).map_err(internal)?;
    Ok(Json(serde_json::json!({ "tasks": tasks })))
}

// ---------------------------------------------------------------------------
// Route: GET /api/jobs[?status=active]
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct JobsQuery {
    status: Option<String>,
    token: Option<String>,
}

async fn get_jobs_http(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Query(q): Query<JobsQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth_with_query(&s.db, &headers, q.token.as_deref())?;
    let conn = s.db.lock().map_err(internal)?;
    let jobs = if q.status.as_deref() == Some("active") {
        queries::get_active_jobs(&*conn).map_err(internal)?
    } else {
        queries::get_recent_jobs(&*conn, 50).map_err(internal)?
    };
    Ok(Json(serde_json::json!({ "jobs": jobs })))
}

// ---------------------------------------------------------------------------
// Route: GET /api/jobs/:id
// ---------------------------------------------------------------------------

async fn get_job_http(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth_with_query(&s.db, &headers, q.token.as_deref())?;
    let conn = s.db.lock().map_err(internal)?;
    match queries::get_prompt_job(&*conn, &id).map_err(internal)? {
        Some(job) => Ok(Json(serde_json::to_value(job).unwrap_or_default())),
        None => Err(ApiError(StatusCode::NOT_FOUND, "Job not found".into())),
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/tasks/:id/run  — create a prompt job record
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct RunPromptBody {
    prompt: Option<String>,
    provider: Option<String>,
}

async fn run_task_prompt(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(task_id): Path<String>,
    Json(body): Json<RunPromptBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let conn = s.db.lock().map_err(internal)?;
    let task = queries::get_task_by_id(&*conn, &task_id)
        .map_err(internal)?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Task not found".into()))?;

    let prompt = body.prompt.unwrap_or_else(|| {
        task.improved_prompt
            .clone()
            .or(task.raw_prompt.clone())
            .unwrap_or_default()
    });
    let provider = body.provider.unwrap_or_else(|| "claude".to_string());

    let job_id = queries::create_prompt_job(
        &*conn,
        &task_id,
        task.project_id.as_deref(),
        &provider,
        &prompt,
        None,
        None,
    )
    .map_err(internal)?;
    drop(conn);
    let _ = s
        .event_tx
        .send(ServerEvent::JobStatusChanged { job_id: job_id.clone() });
    Ok(Json(serde_json::json!({ "job_id": job_id, "status": "queued" })))
}

// ---------------------------------------------------------------------------
// Route: PATCH /api/tasks/:id/prompt  — update raw/improved prompt fields
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct UpdatePromptBody {
    raw_prompt: Option<String>,
    improved_prompt: Option<String>,
}

async fn update_task_prompt(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(task_id): Path<String>,
    Json(body): Json<UpdatePromptBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let conn = s.db.lock().map_err(internal)?;
    queries::save_task_prompt(
        &*conn,
        &task_id,
        body.raw_prompt.as_deref(),
        body.improved_prompt.as_deref(),
    )
    .map_err(internal)?;
    drop(conn);
    let _ = s.event_tx.send(ServerEvent::TaskChanged { date: String::new() });
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Route: POST /api/tasks/:id/generate-plan  — AI generates execution plan
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct GeneratePlanBody {
    provider: Option<String>,
}

async fn generate_plan_http(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(task_id): Path<String>,
    Json(body): Json<GeneratePlanBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let (task_title, prompt_text, project_id, global_prompt, project_prompt, selected_model) = {
        let conn = s.db.lock().map_err(internal)?;
        let task = queries::get_task_by_id(&*conn, &task_id)
            .map_err(internal)?
            .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Task not found".into()))?;
        let prompt_text = task
            .improved_prompt
            .clone()
            .or(task.raw_prompt.clone())
            .unwrap_or_default();
        let provider = body.provider.as_deref().unwrap_or("claude");
        let model_key = format!("default_model_{}", provider);
        let configured_model = queries::get_setting(&conn, &model_key)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let legacy_model = if provider == "claude" {
            queries::get_setting(&conn, "claude_model")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        } else {
            None
        };
        let gp = queries::get_setting(&conn, "global_prompt").ok().filter(|s| !s.is_empty());
        let pp = task
            .project_id
            .as_deref()
            .and_then(|pid| queries::get_project_prompt(&conn, pid).ok().flatten());
        (task.title, prompt_text, task.project_id, gp, pp, configured_model.or(legacy_model))
    };

    let system_context = match (global_prompt, project_prompt) {
        (Some(gp), Some(pp)) => format!("{}\n\n{}\n\n", gp, pp),
        (Some(gp), None) => format!("{}\n\n", gp),
        (None, Some(pp)) => format!("{}\n\n", pp),
        (None, None) => String::new(),
    };

    let plan_prompt = format!(
        "{}You are a planning assistant. Given the following task, produce a concise, numbered step-by-step execution plan in Markdown. Focus on concrete actions. Do not execute anything — only plan.\n\nTask title: {}\n\nTask prompt:\n{}\n\nRespond with ONLY the plan in Markdown format.",
        system_context, task_title, prompt_text
    );

    let provider_str = body.provider.unwrap_or_else(|| "claude".to_string());
    let ai_provider = AiProvider::from_input(Some(&provider_str));
    let cli = ai_provider.cli_binary();
    let resolved_model = selected_model.unwrap_or_else(|| {
        match ai_provider {
            AiProvider::OpenCode => "claude-sonnet-4-5".to_string(),
            _ => "claude-sonnet-4-5".to_string(),
        }
    });
    let args = build_run_args(ai_provider, &plan_prompt, Some(&resolved_model));
    let mut cmd = tokio::process::Command::new(cli);
    for arg in args { cmd.arg(arg); }
    cmd.env("NO_COLOR", "1").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());

    let output = cmd.output().await.map_err(|e| {
        ApiError(StatusCode::INTERNAL_SERVER_ERROR, format!("CLI error: {}", e))
    })?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(ApiError(StatusCode::INTERNAL_SERVER_ERROR, format!("CLI failed: {}", err)));
    }

    let plan = strip_ansi(&String::from_utf8_lossy(&output.stdout)).trim().to_string();
    {
        let conn = s.db.lock().map_err(internal)?;
        queries::update_task_plan(&*conn, &task_id, &plan).map_err(internal)?;
    }
    let _ = s.event_tx.send(ServerEvent::TaskChanged { date: String::new() });
    Ok(Json(serde_json::json!({ "plan": plan })))
}

// ---------------------------------------------------------------------------
// Route: POST /api/tasks/:id/improve  — AI improves task prompt
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ImprovePromptBody {
    provider: Option<String>,
}

async fn improve_task_prompt_http(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(task_id): Path<String>,
    Json(body): Json<ImprovePromptBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let (raw_prompt, project_id, global_prompt, project_prompt, selected_model) = {
        let conn = s.db.lock().map_err(internal)?;
        let task = queries::get_task_by_id(&*conn, &task_id)
            .map_err(internal)?
            .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Task not found".into()))?;
        let raw = task.raw_prompt.clone().unwrap_or_else(|| task.title.clone());
        let provider = body.provider.as_deref().unwrap_or("claude");
        let model_key = format!("default_model_{}", provider);
        let configured_model = queries::get_setting(&conn, &model_key)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let legacy_model = if provider == "claude" {
            queries::get_setting(&conn, "claude_model")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        } else {
            None
        };
        let gp = queries::get_setting(&conn, "global_prompt").ok().filter(|s| !s.is_empty());
        let pp = task
            .project_id
            .as_deref()
            .and_then(|pid| queries::get_project_prompt(&conn, pid).ok().flatten());
        (raw, task.project_id, gp, pp, configured_model.or(legacy_model))
    };

    let system_context = match (global_prompt, project_prompt) {
        (Some(gp), Some(pp)) => format!("{}\n\n{}\n\n", gp, pp),
        (Some(gp), None) => format!("{}\n\n", gp),
        (None, Some(pp)) => format!("{}\n\n", pp),
        (None, None) => String::new(),
    };

    let improve_meta = format!(
        "{}You are a prompt improvement assistant. Rewrite the following task prompt to be clearer, more actionable, and better suited for an AI coding agent. Return ONLY the improved prompt, no explanation.\n\nOriginal prompt:\n{}",
        system_context, raw_prompt
    );

    let provider_str = body.provider.unwrap_or_else(|| "claude".to_string());
    let ai_provider = AiProvider::from_input(Some(&provider_str));
    let cli = ai_provider.cli_binary();
    let resolved_model = selected_model.unwrap_or_else(|| "claude-sonnet-4-5".to_string());
    let args = build_run_args(ai_provider, &improve_meta, Some(&resolved_model));
    let mut cmd = tokio::process::Command::new(cli);
    for arg in args { cmd.arg(arg); }
    cmd.env("NO_COLOR", "1").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());

    let output = cmd.output().await.map_err(|e| {
        ApiError(StatusCode::INTERNAL_SERVER_ERROR, format!("CLI error: {}", e))
    })?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(ApiError(StatusCode::INTERNAL_SERVER_ERROR, format!("CLI failed: {}", err)));
    }

    let improved = strip_ansi(&String::from_utf8_lossy(&output.stdout)).trim().to_string();
    {
        let conn = s.db.lock().map_err(internal)?;
        queries::save_task_prompt(&*conn, &task_id, None, Some(&improved)).map_err(internal)?;
        queries::set_task_improved(&*conn, &task_id).map_err(internal)?;
    }
    let _ = s.event_tx.send(ServerEvent::TaskChanged { date: String::new() });
    Ok(Json(serde_json::json!({ "improved_prompt": improved })))
}

// ---------------------------------------------------------------------------
// Route: POST /api/tasks/:id/review  — AI reviews code changes for a task
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ReviewTaskBody {
    provider: Option<String>,
}

async fn review_task_http(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(task_id): Path<String>,
    Json(body): Json<ReviewTaskBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;

    // Load task + project path + latest job output
    let (title, improved_prompt, project_path, job_output, selected_model) = {
        let conn = s.db.lock().map_err(internal)?;
        let task = queries::get_task_by_id(&*conn, &task_id)
            .map_err(internal)?
            .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Task not found".into()))?;
        let proj_path: Option<String> = task.project_id.as_deref().and_then(|pid| {
            get_project_by_id(&*conn, pid).map(|p| p.path)
        });
        let output: Option<String> = conn
            .query_row(
                "SELECT output FROM prompt_jobs WHERE task_id = ?1 ORDER BY created_at DESC LIMIT 1",
                rusqlite::params![task_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten();
        let provider = body.provider.as_deref().unwrap_or("claude");
        let model_key = format!("default_model_{}", provider);
        let configured_model = queries::get_setting(&conn, &model_key)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let legacy_model = if provider == "claude" {
            queries::get_setting(&conn, "claude_model")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        } else {
            None
        };
        let prompt_text = task.improved_prompt.or(task.raw_prompt).unwrap_or_default();
        (task.title, prompt_text, proj_path, output.unwrap_or_default(), configured_model.or(legacy_model))
    };

    // Get git diff
    let git_diff = if let Some(ref path) = project_path {
        let out = tokio::process::Command::new("git")
            .args(["-C", path, "diff", "HEAD"])
            .output()
            .await
            .ok();
        out.map(|o| String::from_utf8_lossy(&o.stdout).to_string())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_default()
    } else {
        String::new()
    };

    // Build review prompt
    let review_prompt = format!(
        "Review the following code changes for a task titled '{}'.\nPrompt was: {}\nGit diff:\n{}\nOutput:\n{}\nProvide a concise code review in Markdown. Point out issues, risks, and improvements.\nEnd with a verdict: APPROVED or NEEDS_FIX.",
        title, improved_prompt, git_diff, job_output
    );

    let provider_str = body.provider.unwrap_or_else(|| "claude".to_string());
    let ai_provider = AiProvider::from_input(Some(&provider_str));
    let cli = ai_provider.cli_binary();
    let resolved_model = selected_model.unwrap_or_else(|| "claude-sonnet-4-5".to_string());
    let args = build_run_args(ai_provider, &review_prompt, Some(&resolved_model));
    let mut cmd = tokio::process::Command::new(cli);
    for arg in args { cmd.arg(arg); }
    cmd.env("NO_COLOR", "1").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(ref path) = project_path {
        cmd.current_dir(path);
    }

    let output = cmd.output().await.map_err(|e| {
        ApiError(StatusCode::INTERNAL_SERVER_ERROR, format!("CLI error: {}", e))
    })?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(ApiError(StatusCode::INTERNAL_SERVER_ERROR, format!("CLI failed: {}", err)));
    }

    let review_text = strip_ansi(&String::from_utf8_lossy(&output.stdout)).trim().to_string();
    {
        let conn = s.db.lock().map_err(internal)?;
        queries::update_task_review(&*conn, &task_id, &review_text, "pending").map_err(internal)?;
    }
    let _ = s.event_tx.send(ServerEvent::TaskChanged { date: String::new() });
    Ok(Json(serde_json::json!({ "review": review_text })))
}

// ---------------------------------------------------------------------------
// Route: POST /api/tasks/:id/review/approve  — mark review as approved
// ---------------------------------------------------------------------------

async fn approve_task_review_http(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(task_id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let conn = s.db.lock().map_err(internal)?;
    let existing_review = queries::get_task_by_id(&*conn, &task_id)
        .map_err(internal)?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Task not found".into()))?
        .review_output
        .unwrap_or_default();
    queries::update_task_review(&*conn, &task_id, &existing_review, "approved").map_err(internal)?;
    drop(conn);
    let _ = s.event_tx.send(ServerEvent::TaskChanged { date: String::new() });
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Route: POST /api/tasks/:id/fix-review  — create fix job from review feedback
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct FixReviewBody {
    provider: Option<String>,
    project_path: Option<String>,
}

async fn fix_review_http(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(task_id): Path<String>,
    Json(body): Json<FixReviewBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;

    // Load task
    let (improved_prompt, review_output, project_id) = {
        let conn = s.db.lock().map_err(internal)?;
        let task = queries::get_task_by_id(&*conn, &task_id)
            .map_err(internal)?
            .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Task not found".into()))?;
        let review = task.review_output.unwrap_or_default();
        let prompt = task.improved_prompt.or(task.raw_prompt).unwrap_or_default();
        (prompt, review, task.project_id)
    };

    // Build fix prompt
    let fix_prompt = format!(
        "The following task needs fixes based on review feedback.\nOriginal prompt: {}\nReview feedback: {}\nPlease address all the issues raised in the review.",
        improved_prompt, review_output
    );

    // Save new improved_prompt and clear review
    {
        let conn = s.db.lock().map_err(internal)?;
        queries::save_task_prompt(&*conn, &task_id, None, Some(&fix_prompt)).map_err(internal)?;
        queries::update_task_review(&*conn, &task_id, "", "none").map_err(internal)?;
    }

    // Resolve project path: prefer body, fallback to DB project path
    let resolved_project_path: Option<String> = body.project_path.clone().or_else(|| {
        let conn = s.db.lock().ok()?;
        project_id.as_deref().and_then(|pid| get_project_by_id(&*conn, pid).map(|p| p.path))
    });

    // Create job and queue it
    let (job_id, proj_name, db_path) = {
        let conn = s.db.lock().map_err(internal)?;
        let pname: String = project_id
            .as_deref()
            .and_then(|pid| {
                conn.query_row(
                    "SELECT name FROM projects WHERE id = ?1",
                    rusqlite::params![pid],
                    |row| row.get::<_, String>(0),
                )
                .ok()
            })
            .unwrap_or_default();
        let id = queries::create_prompt_job(
            &*conn,
            &task_id,
            project_id.as_deref(),
            body.provider.as_deref().unwrap_or("claude"),
            &fix_prompt,
            resolved_project_path.as_deref(),
            None,
        )
        .map_err(internal)?;
        let path = conn.path().map(std::path::PathBuf::from).unwrap_or_default();
        (id, pname, path)
    };

    let _ = s.event_tx.send(ServerEvent::JobStatusChanged { job_id: job_id.clone() });
    let _ = s.event_tx.send(ServerEvent::TaskChanged { date: String::new() });
    Ok(Json(serde_json::json!({ "job_id": job_id })))
}

// ---------------------------------------------------------------------------
// Route: GET /api/projects/:id/git/status
// ---------------------------------------------------------------------------

async fn get_project_git_status(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth_with_query(&s.db, &headers, q.token.as_deref())?;
    let project = {
        let conn = s.db.lock().map_err(internal)?;
        get_project_by_id(&*conn, &id)
            .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Project not found".into()))?
    };

    let output = tokio::process::Command::new("git")
        .args(["-C", &project.path, "status", "--porcelain", "-b"])
        .output()
        .await
        .map_err(internal)?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let line_count = stdout.lines().count();
    // With -b the first line is always the branch header; clean means only that line
    Ok(Json(serde_json::json!({
        "status": stdout,
        "clean": line_count <= 1
    })))
}

// ---------------------------------------------------------------------------
// Route: GET /api/projects/:id/git/diff
// ---------------------------------------------------------------------------

async fn get_project_git_diff(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth_with_query(&s.db, &headers, q.token.as_deref())?;
    let project = {
        let conn = s.db.lock().map_err(internal)?;
        get_project_by_id(&*conn, &id)
            .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Project not found".into()))?
    };

    let output = tokio::process::Command::new("git")
        .args(["-C", &project.path, "diff", "HEAD"])
        .output()
        .await
        .map_err(internal)?;
    let diff = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(Json(serde_json::json!({ "diff": diff })))
}

// ---------------------------------------------------------------------------
// Route: POST /api/projects/:id/git/commit
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct CommitBody {
    message: String,
}

async fn commit_project(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<CommitBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let project = {
        let conn = s.db.lock().map_err(internal)?;
        get_project_by_id(&*conn, &id)
            .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Project not found".into()))?
    };

    // Stage all changes first
    let _ = tokio::process::Command::new("git")
        .args(["-C", &project.path, "add", "-A"])
        .output()
        .await;

    let output = tokio::process::Command::new("git")
        .args(["-C", &project.path, "commit", "-m", &body.message])
        .output()
        .await
        .map_err(internal)?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let success = output.status.success();
    Ok(Json(serde_json::json!({ "success": success, "output": stdout })))
}

// ---------------------------------------------------------------------------
// Route: POST /api/projects/:id/git/push
// ---------------------------------------------------------------------------

async fn push_project(
    State(s): State<ServerState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_auth(&s.db, &headers)?;
    let project = {
        let conn = s.db.lock().map_err(internal)?;
        get_project_by_id(&*conn, &id)
            .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Project not found".into()))?
    };

    let output = tokio::process::Command::new("git")
        .args(["-C", &project.path, "push"])
        .output()
        .await
        .map_err(internal)?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let success = output.status.success();
    Ok(Json(serde_json::json!({
        "success": success,
        "output": format!("{}{}", stdout, stderr)
    })))
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
    let tunnel_manager = Arc::new(crate::tunnel::TunnelManager::new(db_path.clone()));

    let state = ServerState { db, job_registry, event_tx, tunnel_manager };

    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE, Method::PUT, Method::OPTIONS])
        .allow_headers(Any)
        .allow_origin(Any);

    let app = Router::new()
        // Auth (no auth required)
        .route("/api/auth/login", post(auth_login))
        .route("/api/auth/logout", post(auth_logout))
        .route("/api/auth/change-password", post(auth_change_password))
        .route("/api/auth/forgot-password", post(auth_forgot_password))
        .route("/api/auth/reset-password", post(auth_reset_password))
        .route("/api/auth/me", get(auth_me))
        // Health (no auth)
        .route("/api/health", get(health))
        // Real-time events SSE (auth via query param)
        .route("/api/events", get(events_stream))
        // Tasks
        .route("/api/tasks", get(get_tasks).post(create_task))
        .route("/api/tasks/range", get(get_tasks_range))
        .route("/api/tasks/reorder", patch(reorder_tasks))
        .route("/api/tasks/:id", get(get_task).patch(patch_task).delete(delete_task))
        .route("/api/tasks/:id/status", patch(patch_task_status))
        .route("/api/tasks/:id/carry-forward", post(carry_task_forward))
        .route("/api/tasks/:id/prompt-result", post(save_task_prompt_result))
        // Settings
        .route("/api/settings", get(get_settings))
        .route("/api/settings/:key", get(get_setting_by_key).put(set_setting_by_key))
        .route("/api/remote/auth-token", get(get_remote_auth_token))
        .route("/api/remote/auth-token/regenerate", post(regenerate_remote_auth_token))
        .route("/api/ai-providers", get(get_ai_providers))
        // Session
        .route("/api/session", get(get_session))
        // Projects
        .route("/api/projects", get(get_projects).post(create_project))
        .route("/api/projects/validate-path", post(validate_project_path_http))
        .route("/api/projects/trash", get(get_trashed_projects))
        .route("/api/projects/:id", delete(delete_project))
        .route("/api/projects/:id/restore", post(restore_project))
        .route("/api/projects/:id/hard", delete(hard_delete_project))
        .route("/api/projects/:id/prompt", get(get_project_prompt).put(set_project_prompt))
        .route("/api/projects/:id/tasks", get(get_project_tasks))
        .route("/api/projects/:id/git/status", get(get_project_git_status))
        .route("/api/projects/:id/git/diff", get(get_project_git_diff))
        .route("/api/projects/:id/git/commit", post(commit_project))
        .route("/api/projects/:id/git/push", post(push_project))
        // Tasks — extra routes
        .route("/api/tasks/standalone", get(get_standalone_tasks_http))
        .route("/api/tasks/:id/run", post(run_task_prompt))
        .route("/api/tasks/:id/prompt", patch(update_task_prompt))
        .route("/api/tasks/:id/generate-plan", post(generate_plan_http))
        .route("/api/tasks/:id/improve", post(improve_task_prompt_http))
        .route("/api/tasks/:id/review", post(review_task_http))
        .route("/api/tasks/:id/review/approve", post(approve_task_review_http))
        .route("/api/tasks/:id/fix-review", post(fix_review_http))
        // Jobs
        .route("/api/jobs", get(get_jobs_http))
        .route("/api/jobs/:id", get(get_job_http))
        // Devices
        .route("/api/devices", get(list_devices_handler).post(register_device_handler))
        .route("/api/devices/:id", delete(delete_device_handler))
        // Tunnel
        .route("/api/tunnel/status", get(get_tunnel_status_handler))
        .route("/api/tunnel/start", post(start_tunnel_handler))
        .route("/api/tunnel/stop", post(stop_tunnel_handler))
        // Prompt
        .route("/api/prompt/global", get(get_global_prompt).put(set_global_prompt))
        .route("/api/prompt/templates", get(get_prompt_templates).post(create_prompt_template))
        .route("/api/prompt/templates/:id", patch(update_prompt_template).delete(delete_prompt_template_handler))
        .route("/api/prompt/improve", post(prompt_improve))
        .route("/api/prompt/run", post(prompt_run))
        .route("/api/tasks/brainstorm", post(brainstorm_tasks))
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
