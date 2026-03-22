use tauri::State;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use crate::db::{DbConnection, queries};

#[derive(Deserialize)]
pub struct CreateTaskInput {
    pub date: String,
    pub session_slot: i64,
    pub title: String,
    pub task_type: Option<String>,
    pub priority: Option<i64>,
    pub estimated_min: Option<i64>,
    pub project_id: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateTaskInput {
    pub id: String,
    pub title: Option<String>,
    pub notes: Option<String>,
    pub task_type: Option<String>,
    pub priority: Option<i64>,
    pub estimated_min: Option<i64>,
    pub session_slot: Option<i64>,
    pub project_id: Option<String>,
    pub clear_project: Option<bool>,
}

#[derive(Serialize)]
pub struct RunTaskWorktreeResult {
    pub task_id: String,
    pub worktree_path: String,
    pub branch_name: String,
    pub launch_command: String,
    pub prompt: String,
    pub status: String,
}

#[derive(Serialize)]
pub struct CleanupTaskWorktreeResult {
    pub task_id: String,
    pub status: String,
    pub branch_deleted: bool,
    pub warning: Option<String>,
}

const WORKTREE_ROOT: &str = "/tmp/daily-planner-worktrees";

#[tauri::command]
pub fn get_tasks(date: String, db: State<'_, DbConnection>) -> Result<Vec<queries::Task>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::get_tasks_by_date(&conn, &date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_task(input: CreateTaskInput, db: State<'_, DbConnection>) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::create_task(
        &conn, &input.date, input.session_slot, &input.title,
        &input.task_type.unwrap_or_else(|| "code".to_string()),
        input.priority.unwrap_or(2), input.estimated_min,
        input.project_id.as_deref(),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_task(input: UpdateTaskInput, db: State<'_, DbConnection>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::update_task(
        &conn, &input.id,
        input.title.as_deref(), input.notes.as_deref(),
        input.task_type.as_deref(), input.priority,
        input.estimated_min, input.session_slot,
        input.project_id.as_deref(), input.clear_project.unwrap_or(false),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_task_status(id: String, status: String, db: State<'_, DbConnection>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::update_task_status(&conn, &id, &status).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_task(id: String, db: State<'_, DbConnection>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::delete_task(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn carry_task_forward(id: String, tomorrow_date: String, session_slot: i64, db: State<'_, DbConnection>) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::carry_task_forward(&conn, &id, &tomorrow_date, session_slot).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_tasks(task_ids: Vec<String>, db: State<'_, DbConnection>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::reorder_tasks(&conn, &task_ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_prompt_result(id: String, prompt_used: String, prompt_result: String, db: State<'_, DbConnection>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::save_prompt_result(&conn, &id, &prompt_used, &prompt_result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn start_focus_session(task_id: String, date: String, db: State<'_, DbConnection>) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::start_focus_session(&conn, &task_id, &date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn end_focus_session(session_id: String, notes: String, db: State<'_, DbConnection>) -> Result<i64, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::end_focus_session(&conn, &session_id, &notes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_prompt_templates(db: State<'_, DbConnection>) -> Result<Vec<queries::PromptTemplate>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::get_prompt_templates(&conn).map_err(|e| e.to_string())
}

fn run_git(repo_path: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git")
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))
}

fn ensure_git_available() -> Result<(), String> {
    let output = Command::new("git")
        .arg("--version")
        .output()
        .map_err(|_| "git is not available. Please install git and retry.".to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err("git is not available. Please install git and retry.".to_string())
    }
}

fn ensure_git_repo(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("Project path does not exist: {}", path.display()));
    }
    let output = run_git(path, &["rev-parse", "--is-inside-work-tree"])?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!("Project path is not a git repository: {}", path.display()))
    }
}

fn ensure_repo_clean(path: &Path) -> Result<(), String> {
    let output = run_git(path, &["status", "--porcelain", "--untracked-files=no"])?;
    if !output.status.success() {
        return Err("Failed to inspect repository status.".to_string());
    }
    if !String::from_utf8_lossy(&output.stdout).trim().is_empty() {
        return Err("Repository has uncommitted changes. Commit or stash them before creating a worktree.".to_string());
    }
    Ok(())
}

fn branch_exists(repo_path: &Path, branch: &str) -> Result<bool, String> {
    let ref_name = format!("refs/heads/{}", branch);
    let output = run_git(repo_path, &["show-ref", "--verify", "--quiet", &ref_name])?;
    Ok(output.status.success())
}

fn branch_is_merged_into_head(repo_path: &Path, branch: &str) -> Result<bool, String> {
    let output = run_git(repo_path, &["merge-base", "--is-ancestor", branch, "HEAD"])?;
    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err("Failed to determine whether worktree branch is merged.".to_string()),
    }
}

fn sanitize_slug(input: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn build_branch_name(task_id: &str, title: &str) -> String {
    let slug = sanitize_slug(title);
    let slug = if slug.is_empty() { "task".to_string() } else { slug };
    let suffix = &task_id[..task_id.len().min(8)];
    format!("task/{}-{}", slug, suffix)
}

fn build_task_prompt(ctx: &queries::TaskWorktreeContext) -> String {
    if let Some(prompt) = ctx.prompt_result.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        return prompt.to_string();
    }
    if let Some(prompt) = ctx.prompt_used.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        return prompt.to_string();
    }
    if ctx.notes.trim().is_empty() {
        format!("Task: {}", ctx.title.trim())
    } else {
        format!("Task: {}\n\nNotes:\n{}", ctx.title.trim(), ctx.notes.trim())
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn build_launch_command(worktree_path: &str, prompt: &str) -> String {
    format!(
        "cd {} && claude --worktree -p {}",
        shell_quote(worktree_path),
        shell_quote(prompt),
    )
}

#[tauri::command]
pub fn run_task_as_worktree(task_id: String, db: State<'_, DbConnection>) -> Result<RunTaskWorktreeResult, String> {
    ensure_git_available()?;

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let ctx = queries::get_task_worktree_context(&conn, &task_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Task not found.".to_string())?;

    let repo_path = ctx
        .project_path
        .clone()
        .ok_or_else(|| "Task has no associated repo. Assign a project before running as worktree.".to_string())?;
    let repo = Path::new(&repo_path);

    ensure_git_repo(repo)?;
    ensure_repo_clean(repo)?;

    if let (Some(existing_path), Some(existing_branch), Some(existing_status)) = (
        ctx.worktree_path.as_deref(),
        ctx.worktree_branch.as_deref(),
        ctx.worktree_status.as_deref(),
    ) {
        if existing_status == "active" && Path::new(existing_path).exists() {
            let prompt = build_task_prompt(&ctx);
            return Ok(RunTaskWorktreeResult {
                task_id,
                worktree_path: existing_path.to_string(),
                branch_name: existing_branch.to_string(),
                launch_command: build_launch_command(existing_path, &prompt),
                prompt,
                status: "active".to_string(),
            });
        }
    }

    let worktree_root = PathBuf::from(WORKTREE_ROOT);
    std::fs::create_dir_all(&worktree_root)
        .map_err(|e| format!("Failed to create worktree root: {}", e))?;

    let worktree_path = worktree_root.join(&task_id);
    if worktree_path.exists() {
        return Err(format!(
            "Worktree path already exists: {}. Clean it up first or delete the directory.",
            worktree_path.display()
        ));
    }

    let mut branch = build_branch_name(&task_id, &ctx.title);
    let mut counter = 2;
    while branch_exists(repo, &branch)? {
        branch = format!("{}-{}", build_branch_name(&task_id, &ctx.title), counter);
        counter += 1;
    }

    let output = run_git(
        repo,
        &[
            "worktree",
            "add",
            "-b",
            &branch,
            worktree_path.to_string_lossy().as_ref(),
        ],
    )?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to create worktree: {}", stderr.trim()));
    }

    let path_str = worktree_path.to_string_lossy().to_string();
    queries::set_task_worktree_metadata(&conn, &task_id, Some(&path_str), Some(&branch), Some("active"))
        .map_err(|e| e.to_string())?;

    let prompt = build_task_prompt(&ctx);
    Ok(RunTaskWorktreeResult {
        task_id,
        worktree_path: path_str.clone(),
        branch_name: branch,
        launch_command: build_launch_command(&path_str, &prompt),
        prompt,
        status: "active".to_string(),
    })
}

#[tauri::command]
pub fn cleanup_task_worktree(task_id: String, db: State<'_, DbConnection>) -> Result<CleanupTaskWorktreeResult, String> {
    ensure_git_available()?;

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let ctx = queries::get_task_worktree_context(&conn, &task_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Task not found.".to_string())?;

    let repo_path = ctx
        .project_path
        .clone()
        .ok_or_else(|| "Task has no associated repo.".to_string())?;
    let repo = Path::new(&repo_path);
    ensure_git_repo(repo)?;

    let worktree_path = ctx
        .worktree_path
        .clone()
        .ok_or_else(|| "Task has no saved worktree path.".to_string())?;
    let branch = ctx
        .worktree_branch
        .clone()
        .ok_or_else(|| "Task has no saved worktree branch.".to_string())?;

    let wt_path = Path::new(&worktree_path);
    if wt_path.exists() {
        let output = run_git(repo, &["worktree", "remove", "--force", &worktree_path])?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to remove worktree: {}", stderr.trim()));
        }
    }

    let exists = branch_exists(repo, &branch)?;
    if !exists {
        queries::set_task_worktree_metadata(&conn, &task_id, None, None, Some("merged"))
            .map_err(|e| e.to_string())?;
        return Ok(CleanupTaskWorktreeResult {
            task_id,
            status: "merged".to_string(),
            branch_deleted: true,
            warning: None,
        });
    }

    let merged = branch_is_merged_into_head(repo, &branch)?;
    if merged {
        let output = run_git(repo, &["branch", "-d", &branch])?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to delete merged branch: {}", stderr.trim()));
        }
        queries::set_task_worktree_metadata(&conn, &task_id, None, None, Some("merged"))
            .map_err(|e| e.to_string())?;
        return Ok(CleanupTaskWorktreeResult {
            task_id,
            status: "merged".to_string(),
            branch_deleted: true,
            warning: None,
        });
    }

    let warning = "Worktree removed, but branch still has unmerged commits and was kept.".to_string();
    queries::set_task_worktree_metadata(&conn, &task_id, None, Some(&branch), Some("abandoned"))
        .map_err(|e| e.to_string())?;
    Ok(CleanupTaskWorktreeResult {
        task_id,
        status: "abandoned".to_string(),
        branch_deleted: false,
        warning: Some(warning),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_slug() {
        assert_eq!(sanitize_slug("Fix API: Edge Cases!!!"), "fix-api-edge-cases");
        assert_eq!(sanitize_slug("   "), "");
    }

    #[test]
    fn test_build_branch_name_contains_task_prefix_and_id() {
        let branch = build_branch_name("1234567890abcdef", "Implement Worktree");
        assert_eq!(branch, "task/implement-worktree-12345678");
    }

    #[test]
    fn test_build_launch_command_quotes_values() {
        let cmd = build_launch_command("/tmp/hello world", "fix 'quoted' value");
        assert!(cmd.contains("claude --worktree -p"));
        assert!(cmd.contains("hello world"));
        assert!(cmd.contains("'\"'\"'quoted'\"'\"'"));
    }
}
