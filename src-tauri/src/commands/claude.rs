use crate::db::{queries, DbConnection};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use tauri::State;
use tokio::io::{AsyncBufReadExt, BufReader};

// ---------------------------------------------------------------------------
// JobRegistry — maps job_id → child PID for cancellation
// ---------------------------------------------------------------------------
pub struct JobRegistry(pub Arc<Mutex<HashMap<String, u32>>>);

pub(crate) fn strip_ansi(s: &str) -> String {
    let mut result = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' && chars.peek() == Some(&'[') {
            chars.next(); // consume '['
            while let Some(c2) = chars.next() {
                if c2.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            result.push(c);
        }
    }
    result
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AiProvider {
    Claude,
    OpenCode,
    Codex,
    Copilot,
}

pub(crate) fn default_model_setting_key(raw_provider: Option<&str>) -> &'static str {
    match raw_provider.unwrap_or("claude").to_ascii_lowercase().as_str() {
        "codex" => "default_model_codex",
        "opencode" => "default_model_opencode",
        "copilot" | "copilot_cli" => "default_model_copilot",
        _ => "default_model_claude",
    }
}

pub(crate) fn hardcoded_default_model(provider: AiProvider) -> &'static str {
    match provider {
        AiProvider::Claude => "claude-sonnet-4-6",
        AiProvider::OpenCode => "gpt-4.1",
        AiProvider::Codex => "gpt-5.3-codex",
        AiProvider::Copilot => "claude-sonnet-4.5",
    }
}

fn normalize_copilot_model_identifier(model: &str) -> String {
    match model.trim() {
        "claude-sonnet-4-5" => "claude-sonnet-4.5".to_string(),
        "claude-opus-4-5" => "claude-opus-4.5".to_string(),
        "claude-haiku-4-5" => "claude-haiku-4.5".to_string(),
        other => other.to_string(),
    }
}

impl AiProvider {
    pub(crate) fn from_input(raw: Option<&str>) -> Self {
        match raw.unwrap_or("claude").to_ascii_lowercase().as_str() {
            "opencode" => Self::OpenCode,
            "codex" => Self::Codex,
            "copilot" | "copilot_cli" => Self::Copilot,
            _ => Self::Claude,
        }
    }

    pub(crate) fn cli_binary(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::OpenCode => "opencode",
            Self::Codex => "codex",
            Self::Copilot => "copilot",
        }
    }

    pub(crate) fn hardcoded_default_model(self) -> &'static str {
        hardcoded_default_model(self)
    }
}

#[tauri::command]
pub async fn improve_prompt_with_claude(
    prompt: String,
    project_path: Option<String>,
    provider: Option<String>,
    project_id: Option<String>,
    job_id: Option<String>,
    task_id: Option<String>,
    app_handle: tauri::AppHandle,
    db: State<'_, DbConnection>,
) -> Result<String, String> {
    // Fetch global and project prompts synchronously before the async CLI call
    let (global_prompt, project_prompt, selected_model) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let gp = queries::get_setting(&conn, "global_prompt")
            .ok()
            .filter(|s| !s.is_empty());
        let pp = project_id
            .as_deref()
            .and_then(|pid| queries::get_project_prompt(&conn, pid).ok().flatten());
        let model_key = default_model_setting_key(provider.as_deref());
        let configured_model = queries::get_setting(&conn, model_key)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let legacy_claude_model = if model_key == "default_model_claude" {
            queries::get_setting(&conn, "claude_model")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        } else {
            None
        };
        (gp, pp, configured_model.or(legacy_claude_model))
    };

    // Compose effective prompt: prepend system context if any
    let effective_prompt = match (global_prompt, project_prompt) {
        (Some(gp), Some(pp)) => format!("{}\n\n{}\n\n{}", gp, pp, prompt),
        (Some(gp), None) => format!("{}\n\n{}", gp, prompt),
        (None, Some(pp)) => format!("{}\n\n{}", pp, prompt),
        (None, None) => prompt.clone(),
    };

    let ai_provider = AiProvider::from_input(provider.as_deref());
    let cli = ai_provider.cli_binary();
    let resolved_model = selected_model.unwrap_or_else(|| hardcoded_default_model(ai_provider).to_string());
    let args = build_run_args(ai_provider, &effective_prompt, Some(resolved_model.as_str()));
    let mut cmd = tokio::process::Command::new(cli);
    for arg in args {
        cmd.arg(arg);
    }
    cmd.env("NO_COLOR", "1");
    // Close stdin so CLIs don't block waiting for interactive input
    cmd.stdin(Stdio::null());

    if let Some(path) = &project_path {
        cmd.current_dir(path);
    }

    // If a job_id is provided, stream stdout/stderr as log events for UI feedback
    if let Some(ref jid) = job_id {
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| {
            format!(
                "Failed to run '{}': {}. Make sure the CLI is installed and you're logged in.",
                cli, e
            )
        })?;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        // Stream stdout lines as log events and collect for result
        let app_out = app_handle.clone();
        let jid_out = jid.clone();
        let stdout_task = tokio::spawn(async move {
            let mut collected = String::new();
            if let Some(out) = stdout {
                let mut lines = BufReader::new(out).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let clean = strip_ansi(&line);
                    if !clean.trim().is_empty() {
                        let _ = app_out.emit(
                            "prompt_job_log",
                            PromptJobLogPayload {
                                job_id: jid_out.clone(),
                                line: clean.clone(),
                            },
                        );
                    }
                    collected.push_str(&line);
                    collected.push('\n');
                }
            }
            collected
        });

        // Stream stderr lines as log events
        let app_err = app_handle.clone();
        let jid_err = jid.clone();
        let stderr_task = tokio::spawn(async move {
            let mut collected = String::new();
            if let Some(err) = stderr {
                let mut lines = BufReader::new(err).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let clean = strip_ansi(&line);
                    if !clean.trim().is_empty() {
                        let _ = app_err.emit(
                            "prompt_job_log",
                            PromptJobLogPayload {
                                job_id: jid_err.clone(),
                                line: clean,
                            },
                        );
                    }
                    collected.push_str(&line);
                    collected.push('\n');
                }
            }
            collected
        });

        let (stdout_result, stderr_result) = tokio::join!(stdout_task, stderr_task);
        let all_stdout = stdout_result.unwrap_or_default();
        let all_stderr = stderr_result.unwrap_or_default();

        let status = child.wait().await.map_err(|e| format!("Failed to wait for '{}': {}", cli, e))?;

        if status.success() {
            let result = strip_ansi(&all_stdout).trim().to_string();
            if let Some(ref tid) = task_id {
                let conn = db.0.lock().map_err(|e| e.to_string())?;
                let _ = queries::set_task_improved(&conn, tid);
            }
            Ok(result)
        } else {
            Err(format!("{} exited with error:\n{}{}", cli, all_stderr, all_stdout))
        }
    } else {
        // Legacy path: no streaming, just await output
        let output = cmd.output().await.map_err(|e| {
            format!(
                "Failed to run '{}': {}. Make sure the CLI is installed and you're logged in.",
                cli, e
            )
        })?;

        if output.status.success() {
            let raw = String::from_utf8_lossy(&output.stdout);
            let result = strip_ansi(&raw).trim().to_string();
            if let Some(ref tid) = task_id {
                let conn = db.0.lock().map_err(|e| e.to_string())?;
                let _ = queries::set_task_improved(&conn, tid);
            }
            Ok(result)
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            Err(format!("{} exited with error:\n{}{}", cli, stderr, stdout))
        }
    }
}

// ---------------------------------------------------------------------------
// generate_plan — AI generates a step-by-step execution plan for a task
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn generate_plan(
    task_id: String,
    task_title: String,
    prompt: String,
    project_path: Option<String>,
    provider: Option<String>,
    project_id: Option<String>,
    app_handle: tauri::AppHandle,
    db: State<'_, DbConnection>,
) -> Result<String, String> {
    let (global_prompt, project_prompt, selected_model) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let gp = queries::get_setting(&conn, "global_prompt")
            .ok()
            .filter(|s| !s.is_empty());
        let pp = project_id
            .as_deref()
            .and_then(|pid| queries::get_project_prompt(&conn, pid).ok().flatten());
        let model_key = default_model_setting_key(provider.as_deref());
        let configured_model = queries::get_setting(&conn, model_key)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let legacy = if model_key == "default_model_claude" {
            queries::get_setting(&conn, "claude_model")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        } else {
            None
        };
        (gp, pp, configured_model.or(legacy))
    };

    let system_context = match (global_prompt, project_prompt) {
        (Some(gp), Some(pp)) => format!("{}\n\n{}\n\n", gp, pp),
        (Some(gp), None) => format!("{}\n\n", gp),
        (None, Some(pp)) => format!("{}\n\n", pp),
        (None, None) => String::new(),
    };

    let plan_prompt = format!(
        "{}You are a planning assistant. Given the following task, produce a concise, numbered step-by-step execution plan in Markdown. Focus on concrete actions. Do not execute anything — only plan.\n\nTask title: {}\n\nTask prompt:\n{}\n\nRespond with ONLY the plan in Markdown format.",
        system_context, task_title, prompt
    );

    let ai_provider = AiProvider::from_input(provider.as_deref());
    let cli = ai_provider.cli_binary();
    let resolved_model = selected_model.unwrap_or_else(|| hardcoded_default_model(ai_provider).to_string());
    let args = build_run_args(ai_provider, &plan_prompt, Some(resolved_model.as_str()));
    let mut cmd = tokio::process::Command::new(cli);
    for arg in args {
        cmd.arg(arg);
    }
    cmd.env("NO_COLOR", "1").stdin(Stdio::null());
    if let Some(ref path) = project_path {
        cmd.current_dir(path);
    }

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| {
        format!("Failed to run '{}': {}. Make sure the CLI is installed.", cli, e)
    })?;

    let stdout_handle = child.stdout.take();
    let stderr_handle = child.stderr.take();

    let app_out = app_handle.clone();
    let tid_log = task_id.clone();
    let stdout_task = tokio::spawn(async move {
        let mut collected = String::new();
        if let Some(out) = stdout_handle {
            let mut lines = BufReader::new(out).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let clean = strip_ansi(&line);
                if !clean.trim().is_empty() {
                    let _ = app_out.emit("prompt_job_log", PromptJobLogPayload {
                        job_id: format!("plan:{}", tid_log),
                        line: clean.clone(),
                    });
                }
                collected.push_str(&line);
                collected.push('\n');
            }
        }
        collected
    });

    let stderr_task = tokio::spawn(async move {
        let mut collected = String::new();
        if let Some(err) = stderr_handle {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                collected.push_str(&line);
                collected.push('\n');
            }
        }
        collected
    });

    let (stdout_res, stderr_res) = tokio::join!(stdout_task, stderr_task);
    let all_stdout = stdout_res.unwrap_or_default();
    let all_stderr = stderr_res.unwrap_or_default();

    let status = child.wait().await.map_err(|e| format!("Failed to wait: {}", e))?;
    if status.success() {
        let plan = strip_ansi(&all_stdout).trim().to_string();
        {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            queries::update_task_plan(&conn, &task_id, &plan).map_err(|e| e.to_string())?;
        }
        Ok(plan)
    } else {
        Err(format!("{} exited with error:\n{}{}", cli, all_stderr, all_stdout))
    }
}

#[derive(Serialize)]
pub struct CliStatus {
    pub claude_available: bool,
    pub opencode_available: bool,
}

#[tauri::command]
pub async fn is_git_worktree(project_path: String) -> bool {
    if project_path.trim().is_empty() {
        return false;
    }

    let git_entry = Path::new(&project_path).join(".git");
    match tokio::fs::metadata(git_entry).await {
        Ok(metadata) => metadata.is_file(),
        Err(_) => false,
    }
}

// ---------------------------------------------------------------------------
// run_prompt — execute a prompt via the CLI with live log streaming
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct PromptJobLogPayload {
    pub job_id: String,
    pub line: String,
}

#[derive(Serialize, Clone)]
pub struct PromptJobDonePayload {
    pub job_id: String,
    pub success: bool,
    pub exit_code: i32,
}

/// Build the CLI argument list for a given provider and prompt.
/// Extracted to a pure function so it can be unit-tested independently.
pub(crate) fn build_run_args(provider: AiProvider, prompt: &str, model: Option<&str>) -> Vec<String> {
    let trimmed_model = model.map(str::trim).filter(|s| !s.is_empty());
    match provider {
        // OpenCode CLI docs use: `opencode run [message..]` for non-interactive execution.
        AiProvider::OpenCode => {
            let mut args = vec!["run".to_string()];
            if let Some(model) = trimmed_model {
                args.push("--model".to_string());
                args.push(model.to_string());
            }
            args.push(prompt.to_string());
            args
        }
        AiProvider::Codex => {
            let mut args = vec!["exec".to_string()];
            if let Some(model) = trimmed_model {
                args.push("--model".to_string());
                args.push(model.to_string());
            }
            args.push(prompt.to_string());
            args
        }
        AiProvider::Copilot => {
            let mut args = vec!["suggest".to_string()];
            if let Some(model) = trimmed_model {
                args.push("--model".to_string());
                args.push(normalize_copilot_model_identifier(model));
            }
            args.push(prompt.to_string());
            args
        }
        AiProvider::Claude => {
            let mut args = vec!["--dangerously-skip-permissions".to_string()];
            if let Some(model) = trimmed_model {
                args.push("--model".to_string());
                args.push(model.to_string());
            }
            args.push("-p".to_string());
            args.push(prompt.to_string());
            args
        }
    }
}

// ---------------------------------------------------------------------------
// Telegram helpers (reused from tunnel.rs pattern)
// ---------------------------------------------------------------------------

fn read_setting_sync(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .filter(|v| !v.trim().is_empty())
}

async fn send_telegram_message(bot_token: &str, chat_id: &str, text: &str) -> anyhow::Result<()> {
    let api_url = format!("https://api.telegram.org/bot{}/sendMessage", bot_token);
    let resp = reqwest::Client::new()
        .post(&api_url)
        .json(&serde_json::json!({ "chat_id": chat_id, "text": text }))
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let description = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| v["description"].as_str().map(|s| s.to_string()))
            .unwrap_or(body);
        anyhow::bail!("Telegram error {}: {}", status.as_u16(), description);
    }
    Ok(())
}

async fn notify_telegram_job_result(
    db_path: &std::path::Path,
    title: &str,
    project_name: &str,
    success: bool,
    exit_code: i32,
    error_msg: Option<&str>,
) {
    let conn = match Connection::open(db_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[claude] Failed to open DB for Telegram notify: {}", e);
            return;
        }
    };
    let bot_token = read_setting_sync(&conn, "telegram_bot_token");
    let channel_id = read_setting_sync(&conn, "telegram_channel_id");
    let (Some(token), Some(chat_id)) = (bot_token, channel_id) else {
        return;
    };
    let text = if success {
        format!(
            "Task '{}' on project '{}' completed (exit {})",
            title, project_name, exit_code
        )
    } else {
        let err = error_msg.unwrap_or("non-zero exit code");
        format!(
            "Task '{}' on project '{}' failed: {}",
            title, project_name, err
        )
    };
    if let Err(e) = send_telegram_message(&token, &chat_id, &text).await {
        eprintln!("[claude] Telegram notify error: {}", e);
    }
}

// ---------------------------------------------------------------------------
// ntfy.sh helpers
// ---------------------------------------------------------------------------

pub(crate) async fn send_ntfy_message(
    server: &str,
    topic: &str,
    title: &str,
    message: &str,
    tags: &str,
) -> anyhow::Result<()> {
    let url = format!("{}/{}", server.trim_end_matches('/'), topic);
    let resp = reqwest::Client::new()
        .post(&url)
        .header("Title", title)
        .header("Tags", tags)
        .body(message.to_string())
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("ntfy error {}: {}", status.as_u16(), body);
    }
    Ok(())
}

async fn notify_ntfy_job_result(
    db_path: &std::path::Path,
    title: &str,
    project_name: &str,
    success: bool,
    exit_code: i32,
    error_msg: Option<&str>,
) {
    let conn = match Connection::open(db_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[claude] Failed to open DB for ntfy notify: {}", e);
            return;
        }
    };
    let enabled = read_setting_sync(&conn, "ntfy_on_run_prompt");
    if enabled.as_deref() != Some("true") {
        return;
    }
    let topic = read_setting_sync(&conn, "ntfy_topic");
    let server = read_setting_sync(&conn, "ntfy_server");
    let Some(topic) = topic else { return };
    let server = server.unwrap_or_else(|| "https://ntfy.sh".to_string());

    let (msg, tags) = if success {
        (
            format!(
                "Task '{}' on project '{}' completed (exit {})",
                title, project_name, exit_code
            ),
            "white_check_mark",
        )
    } else {
        let err = error_msg.unwrap_or("non-zero exit code");
        (
            format!(
                "Task '{}' on project '{}' failed: {}",
                title, project_name, err
            ),
            "x",
        )
    };
    if let Err(e) = send_ntfy_message(&server, &topic, "Synq: Run Prompt", &msg, tags).await {
        eprintln!("[claude] ntfy notify error: {}", e);
    }
}

// ---------------------------------------------------------------------------
// Internal core: spawns CLI, streams output, updates DB job record.
// job_id must already exist in prompt_jobs (status = "queued").
// Opens its own DB connection from db_path to avoid holding a MutexGuard
// across await points.
// ---------------------------------------------------------------------------

fn open_db(db_path: &std::path::Path) -> Option<Connection> {
    Connection::open(db_path)
        .map_err(|e| eprintln!("[claude] Failed to open DB: {}", e))
        .ok()
}

async fn execute_prompt_job(
    job_id: String,
    prompt: String,
    project_path: Option<String>,
    provider: Option<String>,
    task_title: String,
    project_name: String,
    db_path: std::path::PathBuf,
    app_handle: tauri::AppHandle,
    registry: Arc<Mutex<HashMap<String, u32>>>,
    task_id: Option<String>,
    git_workflow: bool,
    branch_name: Option<String>,
) {
    let ai_provider = AiProvider::from_input(provider.as_deref());
    let cli = ai_provider.cli_binary().to_string();

    let selected_model = {
        let conn = open_db(&db_path);
        conn.and_then(|c| {
            let model_key = default_model_setting_key(provider.as_deref());
            let configured_model = queries::get_setting(&c, model_key)
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            let legacy_claude_model = if model_key == "default_model_claude" {
                queries::get_setting(&c, "claude_model")
                    .ok()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
            } else {
                None
            };
            configured_model.or(legacy_claude_model)
        })
        .unwrap_or_else(|| hardcoded_default_model(ai_provider).to_string())
    };

    let args = build_run_args(ai_provider, &prompt, Some(selected_model.as_str()));

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
    if let Some(ref path) = project_path {
        cmd.current_dir(path);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[run_prompt] Failed to spawn '{}': {}", cli, e);
            // Mark job failed
            if let Some(conn) = open_db(&db_path) {
                let _ = queries::update_prompt_job_status(
                    &conn,
                    &job_id,
                    "failed",
                    Some(-1),
                    Some(&format!("Failed to spawn '{}': {}", cli, e)),
                );
            }
            let _ = app_handle.emit(
                "prompt_job_done",
                PromptJobDonePayload { job_id: job_id.clone(), success: false, exit_code: -1 },
            );
            notify_telegram_job_result(
                &db_path,
                &task_title,
                &project_name,
                false,
                -1,
                Some(&format!("Failed to spawn '{}': {}", cli, e)),
            )
            .await;
            notify_ntfy_job_result(
                &db_path,
                &task_title,
                &project_name,
                false,
                -1,
                Some(&format!("Failed to spawn '{}': {}", cli, e)),
            )
            .await;
            return;
        }
    };

    // Register PID for cancellation
    if let Some(pid) = child.id() {
        registry.lock().unwrap().insert(job_id.clone(), pid);
    }

    // Mark job as running + set task status to in_progress
    if let Some(conn) = open_db(&db_path) {
        let _ = queries::update_prompt_job_status(&conn, &job_id, "running", None, None);
        if let Some(ref tid) = task_id {
            let _ = queries::update_task_status(&conn, tid, "in_progress");
        }
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Stream stdout lines and collect output
    let app_out = app_handle.clone();
    let jid_out = job_id.clone();
    let stdout_task = tokio::spawn(async move {
        let mut collected = String::new();
        if let Some(out) = stdout {
            let mut lines = BufReader::new(out).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let clean = strip_ansi(&line);
                if !clean.trim().is_empty() {
                    let _ = app_out.emit(
                        "prompt_job_log",
                        PromptJobLogPayload { job_id: jid_out.clone(), line: clean.clone() },
                    );
                }
                collected.push_str(&line);
                collected.push('\n');
            }
        }
        collected
    });

    // Stream stderr lines and collect output
    let app_err = app_handle.clone();
    let jid_err = job_id.clone();
    let stderr_task = tokio::spawn(async move {
        let mut collected = String::new();
        if let Some(err) = stderr {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let clean = strip_ansi(&line);
                if !clean.trim().is_empty() {
                    let _ = app_err.emit(
                        "prompt_job_log",
                        PromptJobLogPayload { job_id: jid_err.clone(), line: clean.clone() },
                    );
                }
                collected.push_str(&line);
                collected.push('\n');
            }
        }
        collected
    });

    let (stdout_result, stderr_result) = tokio::join!(stdout_task, stderr_task);
    let all_output = format!(
        "{}{}",
        stdout_result.unwrap_or_default(),
        stderr_result.unwrap_or_default()
    );

    // Deregister PID
    registry.lock().unwrap().remove(&job_id);

    let (success, exit_code) = match child.wait().await {
        Ok(status) => (status.success(), status.code().unwrap_or(-1)),
        Err(e) => {
            eprintln!("[run_prompt] wait() error: {}", e);
            (false, -1)
        }
    };

    // Git auto-commit on success (git workflow mode)
    if success && git_workflow {
        if let (Some(ref path), Some(ref branch)) = (&project_path, &branch_name) {
            // Stage all changes
            let stage = tokio::process::Command::new("git")
                .args(["-C", path, "add", "-A"])
                .output()
                .await;
            if stage.map(|o| o.status.success()).unwrap_or(false) {
                let commit_msg = format!("feat: task {} - {}", branch, task_title);
                let _ = tokio::process::Command::new("git")
                    .args(["-C", path, "commit", "-m", &commit_msg])
                    .output()
                    .await;
            }
        }
    }

    // Save output and update job status in DB
    if let Some(conn) = open_db(&db_path) {
        let _ = queries::save_prompt_job_output(&conn, &job_id, &all_output);
        let status = if success { "completed" } else { "failed" };
        let error_msg = if success {
            None
        } else {
            Some(format!("Exit code {}", exit_code))
        };
        let _ = queries::update_prompt_job_status(
            &conn,
            &job_id,
            status,
            Some(exit_code as i64),
            error_msg.as_deref(),
        );
        // Advance task status: in_progress → review on success
        if success {
            if let Some(ref tid) = task_id {
                let _ = queries::update_task_status(&conn, tid, "review");
            }
        }
    }

    let _ = app_handle.emit(
        "prompt_job_done",
        PromptJobDonePayload { job_id: job_id.clone(), success, exit_code },
    );

    // Send Telegram notification
    let error_detail = if success {
        None
    } else {
        Some(format!("exit code {}", exit_code))
    };
    notify_telegram_job_result(
        &db_path,
        &task_title,
        &project_name,
        success,
        exit_code,
        error_detail.as_deref(),
    )
    .await;
    notify_ntfy_job_result(
        &db_path,
        &task_title,
        &project_name,
        success,
        exit_code,
        error_detail.as_deref(),
    )
    .await;
}

/// Spawn the CLI and stream its output as Tauri events.
/// Returns immediately; streaming happens in a background task.
/// If the job_id corresponds to an existing prompt_job record, updates its status.
#[tauri::command]
pub async fn run_prompt(
    prompt: String,
    project_path: Option<String>,
    provider: Option<String>,
    job_id: String,
    app_handle: tauri::AppHandle,
    db: State<'_, DbConnection>,
    job_registry: State<'_, JobRegistry>,
) -> Result<(), String> {
    // Resolve task/project metadata for Telegram notifications
    let (task_title, project_name, db_path) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        // Try to get task title from the job record
        let (title, proj_name) = conn
            .query_row(
                "SELECT t.title, COALESCE(p.name, '') FROM prompt_jobs j
                 LEFT JOIN tasks t ON t.id = j.task_id
                 LEFT JOIN projects p ON p.id = j.project_id
                 WHERE j.id = ?1",
                rusqlite::params![job_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .unwrap_or_else(|_| (job_id.clone(), String::new()));
        let path = conn.path().map(std::path::PathBuf::from).unwrap_or_default();
        (title, proj_name, path)
    };

    let registry = Arc::clone(&job_registry.0);

    tokio::spawn(async move {
        execute_prompt_job(
            job_id,
            prompt,
            project_path,
            provider,
            task_title,
            project_name,
            db_path,
            app_handle,
            registry,
            None,
            false,
            None,
        )
        .await;
    });

    Ok(())
}

/// Create a prompt_job record and immediately trigger CLI execution.
/// Returns the job_id so the frontend can subscribe to events.
#[tauri::command]
pub async fn create_and_run_job(
    task_id: String,
    prompt: String,
    provider: Option<String>,
    project_path: Option<String>,
    app_handle: tauri::AppHandle,
    db: State<'_, DbConnection>,
    job_registry: State<'_, JobRegistry>,
) -> Result<String, String> {
    // Resolve project_id and names for the task
    let (job_id, task_title, project_name, db_path, task_git_workflow) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;

        // Get task details including git_workflow flag
        let (title, proj_id, git_wf): (String, Option<String>, bool) = conn
            .query_row(
                "SELECT title, project_id, COALESCE(git_workflow, 0) FROM tasks WHERE id = ?1",
                rusqlite::params![task_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get::<_, i64>(2).map(|v| v != 0).unwrap_or(false))),
            )
            .map_err(|e| format!("Task not found: {}", e))?;

        let proj_name: String = proj_id
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
            &conn,
            &task_id,
            proj_id.as_deref(),
            provider.as_deref().unwrap_or("claude"),
            &prompt,
            project_path.as_deref(),
            None,
        )
        .map_err(|e| e.to_string())?;

        let path = conn.path().map(std::path::PathBuf::from).unwrap_or_default();
        (id, title, proj_name, path, git_wf)
    };

    // If git workflow enabled and project path provided, create a branch before running
    let branch_name: Option<String> = if task_git_workflow {
        if let Some(ref path) = project_path {
            let slug: String = task_title
                .to_lowercase()
                .chars()
                .map(|c| if c.is_alphanumeric() { c } else { '-' })
                .collect::<String>()
                .split('-')
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join("-");
            let branch = format!("task/{}-{}", &task_id[..8.min(task_id.len())], slug);
            let created = tokio::process::Command::new("git")
                .args(["-C", path, "checkout", "-b", &branch])
                .output()
                .await
                .map(|o| o.status.success())
                .unwrap_or(false);
            if created { Some(branch) } else { None }
        } else {
            None
        }
    } else {
        None
    };

    let registry = Arc::clone(&job_registry.0);
    let jid_clone = job_id.clone();
    let tid_clone = task_id.clone();

    tokio::spawn(async move {
        execute_prompt_job(
            jid_clone,
            prompt,
            project_path,
            provider,
            task_title,
            project_name,
            db_path,
            app_handle,
            registry,
            Some(tid_clone),
            task_git_workflow,
            branch_name,
        )
        .await;
    });

    Ok(job_id)
}

/// Cancel a prompt job — kills the process if running, and updates DB status to "cancelled".
#[tauri::command]
pub async fn cancel_prompt_run(
    job_id: String,
    job_registry: State<'_, JobRegistry>,
    db: State<'_, DbConnection>,
) -> Result<(), String> {
    // Kill the child process if it has a PID (i.e. already running)
    let pid = {
        let reg = job_registry.0.lock().map_err(|e| e.to_string())?;
        reg.get(&job_id).copied()
    };
    if let Some(pid) = pid {
        let _ = tokio::process::Command::new("kill")
            .arg(pid.to_string())
            .status()
            .await;
    }

    // Always update DB status to "cancelled" (handles both queued and running jobs)
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::update_prompt_job_status(&conn, &job_id, "cancelled", None, Some("Cancelled by user"))
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn check_cli_availability() -> Result<CliStatus, String> {
    let claude_available = tokio::process::Command::new("which")
        .arg("claude")
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false);

    let opencode_available = tokio::process::Command::new("which")
        .arg("opencode")
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false);

    Ok(CliStatus {
        claude_available,
        opencode_available,
    })
}

// ---------------------------------------------------------------------------
// review_task — collect git diff + latest job output, ask AI to review
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn review_task(
    task_id: String,
    provider: Option<String>,
    db: State<'_, DbConnection>,
) -> Result<String, String> {
    // 1. Load task + project path + latest job output from DB
    let (title, improved_prompt, project_path, job_output) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let task = queries::get_task_by_id(&*conn, &task_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Task not found: {}", task_id))?;
        let proj_path: Option<String> = task.project_id.as_deref().and_then(|pid| {
            conn.query_row(
                "SELECT path FROM projects WHERE id = ?1",
                rusqlite::params![pid],
                |row| row.get::<_, String>(0),
            )
            .ok()
        });
        let output: Option<String> = conn
            .query_row(
                "SELECT output FROM prompt_jobs WHERE task_id = ?1 ORDER BY created_at DESC LIMIT 1",
                rusqlite::params![task_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten();
        (task.title, task.improved_prompt.or(task.raw_prompt).unwrap_or_default(), proj_path, output.unwrap_or_default())
    };

    // 2. Get git diff from project path
    let git_diff = if let Some(ref path) = project_path {
        let out = tokio::process::Command::new("git")
            .args(["-C", path, "diff", "HEAD"])
            .output()
            .await
            .ok();
        out.and_then(|o| {
            let s = String::from_utf8_lossy(&o.stdout).to_string();
            if s.trim().is_empty() { None } else { Some(s) }
        })
        .unwrap_or_else(|| {
            // fallback: unstaged diff
            String::new()
        })
    } else {
        String::new()
    };

    // 3. Build review prompt
    let review_prompt = format!(
        "Review the following code changes for a task titled '{}'.\nPrompt was: {}\nGit diff:\n{}\nOutput:\n{}\nProvide a concise code review in Markdown. Point out issues, risks, and improvements.\nEnd with a verdict: APPROVED or NEEDS_FIX.",
        title, improved_prompt, git_diff, job_output
    );

    // 4. Run AI CLI synchronously (no streaming)
    let ai_provider = AiProvider::from_input(provider.as_deref());
    let cli = ai_provider.cli_binary();
    let resolved_model = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let model_key = default_model_setting_key(provider.as_deref());
        let configured = queries::get_setting(&*conn, model_key)
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
        configured.or(legacy).unwrap_or_else(|| ai_provider.hardcoded_default_model().to_string())
    };
    let args = build_run_args(ai_provider, &review_prompt, Some(&resolved_model));
    let mut cmd = tokio::process::Command::new(cli);
    for arg in &args { cmd.arg(arg); }
    cmd.env("NO_COLOR", "1").stdin(Stdio::null());
    if let Some(ref path) = project_path {
        cmd.current_dir(path);
    }

    let output = cmd.output().await.map_err(|e| {
        format!("Failed to run '{}': {}. Make sure the CLI is installed.", cli, e)
    })?;

    let review_text = if output.status.success() {
        strip_ansi(&String::from_utf8_lossy(&output.stdout)).trim().to_string()
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("{} exited with error:\n{}", cli, stderr));
    };

    // 5. Store result
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        queries::update_task_review(&*conn, &task_id, &review_text, "pending")
            .map_err(|e| e.to_string())?;
    }

    Ok(review_text)
}

// ---------------------------------------------------------------------------
// approve_task_review — mark review as approved
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn approve_task_review(
    task_id: String,
    db: State<'_, DbConnection>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    // Fetch existing review_output so we don't clear it
    let existing_review = queries::get_task_by_id(&*conn, &task_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Task not found: {}", task_id))?
        .review_output
        .unwrap_or_default();
    queries::update_task_review(&*conn, &task_id, &existing_review, "approved")
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// fix_from_review — build a fix prompt from review feedback and re-execute
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn fix_from_review(
    task_id: String,
    provider: Option<String>,
    project_path: Option<String>,
    app_handle: tauri::AppHandle,
    db: State<'_, DbConnection>,
    job_registry: State<'_, JobRegistry>,
) -> Result<String, String> {
    // 1. Load task (title, improved_prompt, review_output, project_id)
    let (title, improved_prompt, review_output, project_id) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let task = queries::get_task_by_id(&*conn, &task_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Task not found: {}", task_id))?;
        let review = task.review_output.unwrap_or_default();
        let prompt = task.improved_prompt.or(task.raw_prompt).unwrap_or_default();
        (task.title, prompt, review, task.project_id)
    };

    // 2. Build fix prompt
    let fix_prompt = format!(
        "The following task needs fixes based on review feedback.\nOriginal prompt: {}\nReview feedback: {}\nPlease address all the issues raised in the review.",
        improved_prompt, review_output
    );

    // 3. Save as new improved_prompt and reset review status
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        queries::save_task_prompt(&*conn, &task_id, None, Some(&fix_prompt))
            .map_err(|e| e.to_string())?;
        queries::update_task_review(&*conn, &task_id, "", "none")
            .map_err(|e| e.to_string())?;
    }

    // 4. Create job and spawn execution
    let (job_id, task_title, project_name, db_path) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let proj_name: String = project_id
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
            provider.as_deref().unwrap_or("claude"),
            &fix_prompt,
            project_path.as_deref(),
            None,
        )
        .map_err(|e| e.to_string())?;
        let path = conn.path().map(std::path::PathBuf::from).unwrap_or_default();
        (id, title, proj_name, path)
    };

    let registry = Arc::clone(&job_registry.0);
    let jid_clone = job_id.clone();
    let tid_clone = task_id.clone();

    tokio::spawn(async move {
        execute_prompt_job(
            jid_clone,
            fix_prompt,
            project_path,
            provider,
            task_title,
            project_name,
            db_path,
            app_handle,
            registry,
            Some(tid_clone),
            false,
            None,
        )
        .await;
    });

    Ok(job_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_temp_dir(prefix: &str) -> std::path::PathBuf {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let pid = std::process::id();
        std::env::temp_dir().join(format!("daily-planner-{prefix}-{pid}-{ts}"))
    }

    #[test]
    fn test_build_run_args_claude() {
        let args = build_run_args(AiProvider::Claude, "hello world", None);
        assert_eq!(args, vec!["--dangerously-skip-permissions", "-p", "hello world"]);
    }

    #[test]
    fn test_build_run_args_opencode() {
        let args = build_run_args(AiProvider::OpenCode, "fix the bug", None);
        assert_eq!(args, vec!["run", "fix the bug"]);
    }

    #[test]
    fn test_provider_parsing() {
        assert_eq!(AiProvider::from_input(Some("codex")), AiProvider::Codex);
        assert_eq!(AiProvider::from_input(Some("opencode")), AiProvider::OpenCode);
        assert_eq!(AiProvider::from_input(Some("claude")), AiProvider::Claude);
        assert_eq!(AiProvider::from_input(Some("copilot")), AiProvider::Copilot);
    }

    #[test]
    fn test_build_run_args_preserves_prompt_with_special_chars() {
        let prompt = "fix: handle edge case with 'quotes' and \"double quotes\"";
        let args = build_run_args(AiProvider::Claude, prompt, None);
        // args: ["--dangerously-skip-permissions", "-p", prompt]
        assert_eq!(args.last().unwrap(), prompt);
    }

    #[test]
    fn test_build_run_args_opencode_prompt_is_last_arg() {
        let prompt = "my prompt";
        let args = build_run_args(AiProvider::OpenCode, prompt, None);
        assert_eq!(args.last().unwrap(), prompt);
        assert_eq!(args[0], "run");
    }

    #[test]
    fn test_build_run_args_with_model_for_claude() {
        let args = build_run_args(AiProvider::Claude, "prompt", Some("claude-opus-4-6"));
        assert_eq!(
            args,
            vec!["--dangerously-skip-permissions", "--model", "claude-opus-4-6", "-p", "prompt"]
        );
    }

    #[test]
    fn test_build_run_args_codex_includes_exec_subcommand() {
        let args = build_run_args(AiProvider::Codex, "do something", None);
        assert_eq!(args[0], "exec");
        assert_eq!(args.last().unwrap(), "do something");
    }

    #[test]
    fn test_build_run_args_codex_with_model() {
        let args = build_run_args(AiProvider::Codex, "do something", Some("gpt-5.3-codex"));
        assert_eq!(
            args,
            vec!["exec", "--model", "gpt-5.3-codex", "do something"]
        );
    }

    #[test]
    fn test_build_run_args_with_model_for_opencode() {
        let args = build_run_args(AiProvider::OpenCode, "prompt", Some("gpt-4.1"));
        assert_eq!(args, vec!["run", "--model", "gpt-4.1", "prompt"]);
    }

    #[test]
    fn test_build_run_args_copilot_normalizes_legacy_claude_model() {
        let args = build_run_args(AiProvider::Copilot, "prompt", Some("claude-sonnet-4-5"));
        assert_eq!(args, vec!["suggest", "--model", "claude-sonnet-4.5", "prompt"]);
    }

    #[tokio::test]
    async fn test_is_git_worktree_true_when_dot_git_is_file() {
        let root = test_temp_dir("worktree-file");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join(".git"), "gitdir: /tmp/repo/.git/worktrees/wt").unwrap();

        let result = is_git_worktree(root.to_string_lossy().to_string()).await;
        assert!(result);

        let _ = fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn test_is_git_worktree_false_when_dot_git_is_directory() {
        let root = test_temp_dir("repo-dir");
        fs::create_dir_all(root.join(".git")).unwrap();

        let result = is_git_worktree(root.to_string_lossy().to_string()).await;
        assert!(!result);

        let _ = fs::remove_dir_all(&root);
    }
}
