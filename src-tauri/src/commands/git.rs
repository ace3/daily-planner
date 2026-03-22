use serde::Serialize;
use tokio::process::Command;

#[derive(Serialize, Clone, Debug)]
pub struct GitFileStatus {
    pub status: String,
    pub path: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct GitStatusResult {
    pub branch: String,
    pub files: Vec<GitFileStatus>,
}

async fn run_git(args: &[&str], cwd: &str) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .await
        .map_err(|e| format!("Failed to run git: {}", e))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[tauri::command]
pub async fn git_status(project_path: String) -> Result<GitStatusResult, String> {
    if project_path.trim().is_empty() {
        return Err("project_path cannot be empty".to_string());
    }

    let branch = run_git(&["rev-parse", "--abbrev-ref", "HEAD"], &project_path)
        .await
        .unwrap_or_else(|_| "unknown".to_string())
        .trim()
        .to_string();

    let status_out = run_git(&["status", "--porcelain"], &project_path).await?;

    let files = status_out
        .lines()
        .filter(|line| line.len() > 2)
        .map(|line| {
            let status = line[..2].trim().to_string();
            let path = line[3..].trim_start().to_string();
            GitFileStatus { status, path }
        })
        .collect();

    Ok(GitStatusResult { branch, files })
}

#[tauri::command]
pub async fn git_diff(project_path: String) -> Result<String, String> {
    if project_path.trim().is_empty() {
        return Err("project_path cannot be empty".to_string());
    }

    // Prefer staged diff (after git add -A), fall back to diff vs HEAD
    let staged = run_git(&["diff", "--staged"], &project_path)
        .await
        .unwrap_or_default();
    let diff = if !staged.trim().is_empty() {
        staged
    } else {
        run_git(&["diff", "HEAD"], &project_path)
            .await
            .unwrap_or_default()
    };

    const MAX_CHARS: usize = 8000;
    if diff.len() > MAX_CHARS {
        Ok(format!("{}\n\n[...truncated — diff too large...]", &diff[..MAX_CHARS]))
    } else {
        Ok(diff)
    }
}

#[tauri::command]
pub async fn git_stage_all(project_path: String) -> Result<(), String> {
    if project_path.trim().is_empty() {
        return Err("project_path cannot be empty".to_string());
    }
    run_git(&["add", "-A"], &project_path).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_commit(project_path: String, message: String) -> Result<(), String> {
    if project_path.trim().is_empty() {
        return Err("project_path cannot be empty".to_string());
    }
    if message.trim().is_empty() {
        return Err("Commit message cannot be empty".to_string());
    }
    run_git(&["commit", "-m", message.trim()], &project_path).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_push(project_path: String) -> Result<String, String> {
    if project_path.trim().is_empty() {
        return Err("project_path cannot be empty".to_string());
    }
    let out = run_git(&["push"], &project_path).await?;
    Ok(out)
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
        std::env::temp_dir().join(format!("dp-git-{prefix}-{pid}-{ts}"))
    }

    #[tokio::test]
    async fn test_git_status_empty_path_errors() {
        let result = git_status("  ".to_string()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty"));
    }

    #[tokio::test]
    async fn test_git_commit_empty_message_errors() {
        let result = git_commit("/tmp".to_string(), "  ".to_string()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty"));
    }

    #[tokio::test]
    async fn test_git_stage_all_empty_path_errors() {
        let result = git_stage_all("  ".to_string()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty"));
    }

    #[tokio::test]
    async fn test_git_diff_empty_path_errors() {
        let result = git_diff("  ".to_string()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty"));
    }

    #[tokio::test]
    async fn test_git_status_on_fresh_repo() {
        let root = test_temp_dir("fresh");
        fs::create_dir_all(&root).unwrap();
        Command::new("git").args(["init"]).current_dir(&root).output().await.unwrap();
        Command::new("git").args(["config", "user.email", "t@t.com"]).current_dir(&root).output().await.unwrap();
        Command::new("git").args(["config", "user.name", "T"]).current_dir(&root).output().await.unwrap();

        let result = git_status(root.to_string_lossy().to_string()).await.unwrap();
        assert!(result.files.is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn test_git_status_detects_new_file() {
        let root = test_temp_dir("new-file");
        fs::create_dir_all(&root).unwrap();
        Command::new("git").args(["init"]).current_dir(&root).output().await.unwrap();
        Command::new("git").args(["config", "user.email", "t@t.com"]).current_dir(&root).output().await.unwrap();
        Command::new("git").args(["config", "user.name", "T"]).current_dir(&root).output().await.unwrap();
        fs::write(root.join("hello.txt"), "hello").unwrap();

        let result = git_status(root.to_string_lossy().to_string()).await.unwrap();
        assert!(!result.files.is_empty());
        assert!(result.files.iter().any(|f| f.path.contains("hello.txt")));
        let _ = fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn test_git_diff_empty_on_clean_repo() {
        let root = test_temp_dir("diff-clean");
        fs::create_dir_all(&root).unwrap();
        Command::new("git").args(["init"]).current_dir(&root).output().await.unwrap();
        Command::new("git").args(["config", "user.email", "t@t.com"]).current_dir(&root).output().await.unwrap();
        Command::new("git").args(["config", "user.name", "T"]).current_dir(&root).output().await.unwrap();
        fs::write(root.join("a.txt"), "a").unwrap();
        Command::new("git").args(["add", "-A"]).current_dir(&root).output().await.unwrap();
        Command::new("git").args(["commit", "-m", "init"]).current_dir(&root).output().await.unwrap();

        let diff = git_diff(root.to_string_lossy().to_string()).await.unwrap();
        assert!(diff.trim().is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn test_git_diff_shows_changes() {
        let root = test_temp_dir("diff-changes");
        fs::create_dir_all(&root).unwrap();
        Command::new("git").args(["init"]).current_dir(&root).output().await.unwrap();
        Command::new("git").args(["config", "user.email", "t@t.com"]).current_dir(&root).output().await.unwrap();
        Command::new("git").args(["config", "user.name", "T"]).current_dir(&root).output().await.unwrap();
        fs::write(root.join("a.txt"), "a").unwrap();
        Command::new("git").args(["add", "-A"]).current_dir(&root).output().await.unwrap();
        Command::new("git").args(["commit", "-m", "init"]).current_dir(&root).output().await.unwrap();
        fs::write(root.join("a.txt"), "b").unwrap();

        let diff = git_diff(root.to_string_lossy().to_string()).await.unwrap();
        assert!(!diff.trim().is_empty());
        let _ = fs::remove_dir_all(&root);
    }
}
