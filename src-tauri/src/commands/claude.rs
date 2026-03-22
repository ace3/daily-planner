use crate::db::{queries, DbConnection};
use serde::Serialize;
use std::path::Path;
use std::process::Stdio;
use tauri::Emitter;
use tauri::State;
use tokio::io::{AsyncBufReadExt, BufReader};

fn strip_ansi(s: &str) -> String {
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
enum AiProvider {
    Claude,
    OpenCode,
}

fn default_model_setting_key(raw_provider: Option<&str>) -> &'static str {
    match raw_provider.unwrap_or("claude").to_ascii_lowercase().as_str() {
        "codex" => "default_model_codex",
        "opencode" => "default_model_opencode",
        _ => "default_model_claude",
    }
}

fn hardcoded_default_model(provider: AiProvider) -> &'static str {
    match provider {
        AiProvider::Claude => "claude-sonnet-4-6",
        AiProvider::OpenCode => "gpt-4.1",
    }
}

impl AiProvider {
    fn from_input(raw: Option<&str>) -> Self {
        match raw.unwrap_or("claude").to_ascii_lowercase().as_str() {
            // Backward-compat for older frontend value.
            "codex" | "opencode" => Self::OpenCode,
            _ => Self::Claude,
        }
    }

    fn cli_binary(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::OpenCode => "opencode",
        }
    }
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

    if let Some(path) = &project_path {
        cmd.current_dir(path);
    }

    let output = cmd.output().await.map_err(|e| {
        format!(
            "Failed to run '{}': {}. Make sure the CLI is installed and you're logged in.",
            cli, e
        )
    })?;

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
fn build_run_args(provider: AiProvider, prompt: &str, model: Option<&str>) -> Vec<String> {
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
        AiProvider::Claude => {
            let mut args = Vec::new();
            if let Some(model) = trimmed_model {
                args.push("-m".to_string());
                args.push(model.to_string());
            }
            args.push("-p".to_string());
            args.push(prompt.to_string());
            args
        }
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
    db: State<'_, DbConnection>,
) -> Result<(), String> {
    let ai_provider = AiProvider::from_input(provider.as_deref());
    let cli = ai_provider.cli_binary().to_string();
    let selected_model = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
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
        configured_model
            .or(legacy_claude_model)
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

    if let Some(path) = &project_path {
        cmd.current_dir(path);
    }

    tokio::spawn(async move {
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[run_prompt] Failed to spawn '{}': {}", cli, e);
                let _ = app_handle.emit(
                    "prompt_job_done",
                    PromptJobDonePayload {
                        job_id,
                        success: false,
                        exit_code: -1,
                    },
                );
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
                        let _ = app_out.emit(
                            "prompt_job_log",
                            PromptJobLogPayload {
                                job_id: jid_out.clone(),
                                line: clean,
                            },
                        );
                    }
                }
            }
        });

        // Stream stderr lines (some CLIs write progress to stderr)
        let app_err = app_handle.clone();
        let jid_err = job_id.clone();
        let stderr_task = tokio::spawn(async move {
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
                }
            }
        });

        let _ = tokio::join!(stdout_task, stderr_task);

        let (success, exit_code) = match child.wait().await {
            Ok(status) => (status.success(), status.code().unwrap_or(-1)),
            Err(_) => (false, -1),
        };

        let _ = app_handle.emit(
            "prompt_job_done",
            PromptJobDonePayload {
                job_id,
                success,
                exit_code,
            },
        );
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
        assert_eq!(args, vec!["-p", "hello world"]);
    }

    #[test]
    fn test_build_run_args_opencode() {
        let args = build_run_args(AiProvider::OpenCode, "fix the bug", None);
        assert_eq!(args, vec!["run", "fix the bug"]);
    }

    #[test]
    fn test_provider_parsing_maps_legacy_codex_to_opencode() {
        assert_eq!(AiProvider::from_input(Some("codex")), AiProvider::OpenCode);
        assert_eq!(
            AiProvider::from_input(Some("opencode")),
            AiProvider::OpenCode
        );
    }

    #[test]
    fn test_build_run_args_preserves_prompt_with_special_chars() {
        let prompt = "fix: handle edge case with 'quotes' and \"double quotes\"";
        let args = build_run_args(AiProvider::Claude, prompt, None);
        assert_eq!(args[1], prompt);
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
        assert_eq!(args, vec!["-m", "claude-opus-4-6", "-p", "prompt"]);
    }

    #[test]
    fn test_build_run_args_with_model_for_opencode() {
        let args = build_run_args(AiProvider::OpenCode, "prompt", Some("gpt-4.1"));
        assert_eq!(args, vec!["run", "--model", "gpt-4.1", "prompt"]);
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
