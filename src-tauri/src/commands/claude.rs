use serde::Serialize;
use tauri::State;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use std::process::Stdio;
use crate::db::{DbConnection, queries};

fn strip_ansi(s: &str) -> String {
    let mut result = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' && chars.peek() == Some(&'[') {
            chars.next(); // consume '['
            while let Some(c2) = chars.next() {
                if c2.is_ascii_alphabetic() { break; }
            }
        } else {
            result.push(c);
        }
    }
    result
}

#[tauri::command]
pub async fn improve_prompt_with_claude(
    prompt: String,
    project_path: Option<String>,
    provider: Option<String>,
    project_id: Option<String>,
    db: State<'_, DbConnection>,
) -> Result<String, String> {
    // Fetch global and project prompts synchronously before the async CLI call
    let (global_prompt, project_prompt) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let gp = queries::get_setting(&conn, "global_prompt")
            .ok()
            .filter(|s| !s.is_empty());
        let pp = project_id.as_deref().and_then(|pid| {
            queries::get_project_prompt(&conn, pid).ok().flatten()
        });
        (gp, pp)
    };

    // Compose effective prompt: prepend system context if any
    let effective_prompt = match (global_prompt, project_prompt) {
        (Some(gp), Some(pp)) => format!("{}\n\n{}\n\n{}", gp, pp, prompt),
        (Some(gp), None) => format!("{}\n\n{}", gp, prompt),
        (None, Some(pp)) => format!("{}\n\n{}", pp, prompt),
        (None, None) => prompt.clone(),
    };

    let cli = provider.as_deref().unwrap_or("claude");
    let mut cmd = tokio::process::Command::new(cli);
    // codex non-interactive mode: `codex exec`; -p means --profile in codex
    // --full-auto: auto-approve shell commands (no human interaction)
    // --skip-git-repo-check: allow running outside a git repo
    if cli == "codex" {
        cmd.arg("exec").arg("--full-auto").arg("--skip-git-repo-check").arg(&effective_prompt);
    } else {
        cmd.arg("-p").arg(&effective_prompt);
    }
    cmd.env("NO_COLOR", "1");

    if let Some(path) = &project_path {
        cmd.current_dir(path);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to run '{}': {}. Make sure the CLI is installed and you're logged in.", cli, e))?;

    if output.status.success() {
        let raw = String::from_utf8_lossy(&output.stdout);
        Ok(strip_ansi(&raw).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        Err(format!("{} exited with error:\n{}{}", cli, stderr, stdout))
    }
}

#[derive(Serialize)]
pub struct CliStatus {
    pub claude_available: bool,
    pub codex_available: bool,
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
pub fn build_run_args(cli: &str, prompt: &str) -> Vec<String> {
    if cli == "codex" {
        vec![
            "exec".to_string(),
            "--full-auto".to_string(),
            "--skip-git-repo-check".to_string(),
            prompt.to_string(),
        ]
    } else {
        vec!["-p".to_string(), prompt.to_string()]
    }
}

/// Spawn the CLI and stream its output as Tauri events.
/// Returns immediately; streaming happens in a background task.
#[tauri::command]
pub async fn run_prompt(
    prompt: String,
    project_path: Option<String>,
    provider: Option<String>,
    job_id: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let cli = provider.as_deref().unwrap_or("claude").to_string();
    let args = build_run_args(&cli, &prompt);

    let mut cmd = tokio::process::Command::new(&cli);
    for arg in &args {
        cmd.arg(arg);
    }
    cmd.env("NO_COLOR", "1");
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    if let Some(path) = &project_path {
        cmd.current_dir(path);
    }

    tokio::spawn(async move {
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[run_prompt] Failed to spawn '{}': {}", cli, e);
                let _ = app_handle.emit("prompt_job_done", PromptJobDonePayload {
                    job_id,
                    success: false,
                    exit_code: -1,
                });
                return;
            }
        };

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        // Stream stdout lines
        let app_out = app_handle.clone();
        let jid_out = job_id.clone();
        let stdout_task = tokio::spawn(async move {
            if let Some(out) = stdout {
                let mut lines = BufReader::new(out).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let clean = strip_ansi(&line);
                    if !clean.trim().is_empty() {
                        let _ = app_out.emit("prompt_job_log", PromptJobLogPayload {
                            job_id: jid_out.clone(),
                            line: clean,
                        });
                    }
                }
            }
        });

        // Stream stderr lines (codex writes progress to stderr)
        let app_err = app_handle.clone();
        let jid_err = job_id.clone();
        let stderr_task = tokio::spawn(async move {
            if let Some(err) = stderr {
                let mut lines = BufReader::new(err).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let clean = strip_ansi(&line);
                    if !clean.trim().is_empty() {
                        let _ = app_err.emit("prompt_job_log", PromptJobLogPayload {
                            job_id: jid_err.clone(),
                            line: clean,
                        });
                    }
                }
            }
        });

        let _ = tokio::join!(stdout_task, stderr_task);

        let (success, exit_code) = match child.wait().await {
            Ok(status) => (status.success(), status.code().unwrap_or(-1)),
            Err(_) => (false, -1),
        };

        let _ = app_handle.emit("prompt_job_done", PromptJobDonePayload {
            job_id,
            success,
            exit_code,
        });
    });

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

    let codex_available = tokio::process::Command::new("which")
        .arg("codex")
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false);

    Ok(CliStatus { claude_available, codex_available })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_run_args_claude() {
        let args = build_run_args("claude", "hello world");
        assert_eq!(args, vec!["-p", "hello world"]);
    }

    #[test]
    fn test_build_run_args_codex() {
        let args = build_run_args("codex", "fix the bug");
        assert_eq!(args, vec!["exec", "--full-auto", "--skip-git-repo-check", "fix the bug"]);
    }

    #[test]
    fn test_build_run_args_unknown_defaults_to_claude_style() {
        // Any unknown CLI uses the -p convention
        let args = build_run_args("my-custom-cli", "do something");
        assert_eq!(args, vec!["-p", "do something"]);
    }

    #[test]
    fn test_build_run_args_preserves_prompt_with_special_chars() {
        let prompt = "fix: handle edge case with 'quotes' and \"double quotes\"";
        let args = build_run_args("claude", prompt);
        assert_eq!(args[1], prompt);
    }

    #[test]
    fn test_build_run_args_codex_prompt_is_last_arg() {
        let prompt = "my prompt";
        let args = build_run_args("codex", prompt);
        assert_eq!(args.last().unwrap(), prompt);
        // exec must be first
        assert_eq!(args[0], "exec");
    }
}
