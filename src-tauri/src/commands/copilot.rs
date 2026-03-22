use crate::db::{queries, DbConnection};
use serde::Serialize;
use std::process::Output;
use tauri::State;
use tokio::process::Command;

#[derive(Serialize)]
pub struct CopilotCliStatus {
    pub available: bool,
}

fn normalize_copilot_model_identifier(model: &str) -> String {
    match model.trim() {
        "claude-sonnet-4-5" => "claude-sonnet-4.5".to_string(),
        "claude-opus-4-5" => "claude-opus-4.5".to_string(),
        "claude-haiku-4-5" => "claude-haiku-4.5".to_string(),
        other => other.to_string(),
    }
}

fn validate_mode(mode: Option<&str>) -> Result<&str, String> {
    match mode.unwrap_or("suggest") {
        "suggest" => Ok("suggest"),
        "explain" => Ok("explain"),
        other => Err(format!(
            "Invalid copilot mode '{}'. Use 'suggest' or 'explain'.",
            other
        )),
    }
}

async fn run_command(
    binary: &str,
    args: &[&str],
    project_path: Option<&str>,
) -> Result<Output, String> {
    let mut cmd = Command::new(binary);
    cmd.args(args);
    cmd.env("NO_COLOR", "1");
    if let Some(path) = project_path {
        cmd.current_dir(path);
    }

    cmd.output().await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            format!("'{}' is not installed or not in PATH.", binary)
        } else {
            format!("Failed to run '{}': {}", binary, e)
        }
    })
}

fn output_to_text(output: &Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    format!("{}{}", stderr, stdout).trim().to_string()
}

fn ensure_success(output: &Output, context: &str) -> Result<(), String> {
    if output.status.success() {
        return Ok(());
    }

    let code = output.status.code().unwrap_or(-1);
    let details = output_to_text(output);
    if details.is_empty() {
        Err(format!("{} failed with exit code {}.", context, code))
    } else {
        Err(format!(
            "{} failed with exit code {}:\n{}",
            context, code, details
        ))
    }
}

fn prompt_for_mode(mode: &str, input: &str) -> String {
    if mode == "explain" {
        format!(
            "Explain the following command/code in practical terms, including what it does and key caveats:\n\n{}",
            input.trim()
        )
    } else {
        input.trim().to_string()
    }
}

pub async fn invoke_copilot_cli_internal(
    input: String,
    mode: Option<String>,
    project_path: Option<String>,
    model: Option<String>,
) -> Result<String, String> {
    if input.trim().is_empty() {
        return Err("Copilot input cannot be empty.".to_string());
    }

    let mode = validate_mode(mode.as_deref())?;
    let project_path = project_path.as_deref();

    let copilot_version = run_command("copilot", &["--version"], project_path).await?;
    ensure_success(
        &copilot_version,
        "Copilot CLI check (make sure 'copilot' is installed and in PATH)",
    )?;

    let prompt_input = prompt_for_mode(mode, &input);

    let mut copilot_args = vec![
        "-p".to_string(),
        prompt_input,
        "--silent".to_string(),
    ];
    if let Some(m) = model.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        copilot_args.push("--model".to_string());
        copilot_args.push(m.to_string());
    }
    let copilot_args_refs: Vec<&str> = copilot_args.iter().map(String::as_str).collect();

    let output = run_command("copilot", &copilot_args_refs, project_path).await?;
    if output.status.success() {
        let body = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if body.is_empty() {
            Err("Copilot returned an empty response.".to_string())
        } else {
            Ok(body)
        }
    } else {
        let code = output.status.code().unwrap_or(-1);
        let details = output_to_text(&output);
        if details.is_empty() {
            Err(format!(
                "copilot {} failed with exit code {}.",
                mode, code
            ))
        } else {
            Err(format!(
                "copilot {} failed with exit code {}:\n{}",
                mode, code, details
            ))
        }
    }
}

#[tauri::command]
pub async fn invoke_copilot_cli(
    input: String,
    mode: Option<String>,
    project_path: Option<String>,
    model: Option<String>,
    db: State<'_, DbConnection>,
) -> Result<String, String> {
    let configured_default = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        queries::get_setting(&conn, "default_model_copilot")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .map(|s| normalize_copilot_model_identifier(&s))
            .unwrap_or_else(|| "claude-sonnet-4.5".to_string())
    };
    let selected_model = model
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(normalize_copilot_model_identifier)
        .or(Some(configured_default));

    invoke_copilot_cli_internal(input, mode, project_path, selected_model).await
}

#[tauri::command]
pub async fn check_copilot_cli_availability() -> Result<CopilotCliStatus, String> {
    let output = run_command("copilot", &["--version"], None).await;
    Ok(CopilotCliStatus {
        available: output.map(|o| o.status.success()).unwrap_or(false),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_mode_defaults_to_suggest() {
        assert_eq!(validate_mode(None).unwrap(), "suggest");
    }

    #[test]
    fn test_validate_mode_rejects_invalid_values() {
        let err = validate_mode(Some("invalid")).unwrap_err();
        assert!(err.contains("Invalid copilot mode"));
    }

    #[test]
    fn test_prompt_for_mode_suggest_returns_trimmed_input() {
        assert_eq!(prompt_for_mode("suggest", "  hello  "), "hello");
    }

    #[test]
    fn test_prompt_for_mode_explain_wraps_input() {
        let text = prompt_for_mode("explain", "npm run build");
        assert!(text.contains("Explain the following command/code"));
        assert!(text.contains("npm run build"));
    }

    #[test]
    fn test_normalize_copilot_model_identifier_maps_legacy_claude_names() {
        assert_eq!(
            normalize_copilot_model_identifier("claude-sonnet-4-5"),
            "claude-sonnet-4.5"
        );
        assert_eq!(
            normalize_copilot_model_identifier("claude-opus-4-5"),
            "claude-opus-4.5"
        );
        assert_eq!(
            normalize_copilot_model_identifier("claude-haiku-4-5"),
            "claude-haiku-4.5"
        );
    }

    #[tokio::test]
    async fn test_run_command_missing_binary_error() {
        let err = run_command("definitely-missing-gh-binary", &["--version"], None)
            .await
            .unwrap_err();
        assert!(err.contains("not installed"));
    }

    #[tokio::test]
    async fn test_run_command_non_zero_exit_error_path() {
        let output = run_command("sh", &["-c", "echo boom >&2; exit 9"], None)
            .await
            .unwrap();
        assert!(!output.status.success());

        let err = ensure_success(&output, "Synthetic command").unwrap_err();
        assert!(err.contains("exit code 9"));
        assert!(err.contains("boom"));
    }
}
