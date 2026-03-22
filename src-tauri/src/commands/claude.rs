use serde::Serialize;
use tauri::State;
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
