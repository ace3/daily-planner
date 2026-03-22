use serde::Serialize;
use std::process::Output;
use tokio::process::Command;

#[derive(Serialize)]
pub struct CopilotCliStatus {
    pub available: bool,
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

pub async fn invoke_copilot_cli_internal(
    input: String,
    mode: Option<String>,
    project_path: Option<String>,
) -> Result<String, String> {
    if input.trim().is_empty() {
        return Err("Copilot input cannot be empty.".to_string());
    }

    let mode = validate_mode(mode.as_deref())?;
    let project_path = project_path.as_deref();

    let gh_version = run_command("gh", &["--version"], project_path).await?;
    ensure_success(&gh_version, "GitHub CLI check")?;

    let copilot_version = run_command("gh", &["copilot", "--version"], project_path).await?;
    ensure_success(
        &copilot_version,
        "GitHub Copilot CLI check (install/upgrade with: gh extension install github/gh-copilot)",
    )?;

    let auth = run_command("gh", &["auth", "status"], project_path).await?;
    ensure_success(
        &auth,
        "GitHub CLI authentication check (run: gh auth login)",
    )?;

    let output = run_command("gh", &["copilot", mode, &input], project_path).await?;
    if output.status.success() {
        let body = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if body.is_empty() {
            Err("GitHub Copilot returned an empty response.".to_string())
        } else {
            Ok(body)
        }
    } else {
        let code = output.status.code().unwrap_or(-1);
        let details = output_to_text(&output);
        if details.is_empty() {
            Err(format!(
                "gh copilot {} failed with exit code {}.",
                mode, code
            ))
        } else {
            Err(format!(
                "gh copilot {} failed with exit code {}:\n{}",
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
) -> Result<String, String> {
    invoke_copilot_cli_internal(input, mode, project_path).await
}

#[tauri::command]
pub async fn check_copilot_cli_availability() -> Result<CopilotCliStatus, String> {
    let output = run_command("gh", &["copilot", "--version"], None).await;
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
