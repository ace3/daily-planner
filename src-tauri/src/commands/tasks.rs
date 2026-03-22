use crate::db::{queries, DbConnection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::State;

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
    pub status: String,
    pub launch_command: String,
    pub prompt_to_run: String,
}

#[derive(Serialize)]
pub struct CleanupTaskWorktreeResult {
    pub task_id: String,
    pub worktree_path: Option<String>,
    pub branch_name: Option<String>,
    pub status: String,
    pub branch_deleted: bool,
    pub warning: Option<String>,
}

fn slugify_branch_component(title: &str) -> String {
    let mut slug = String::new();
    let mut prev_dash = false;
    for ch in title.chars() {
        let c = ch.to_ascii_lowercase();
        if c.is_ascii_alphanumeric() {
            slug.push(c);
            prev_dash = false;
        } else if !prev_dash {
            slug.push('-');
            prev_dash = true;
        }
    }
    let slug = slug.trim_matches('-');
    let slug = if slug.is_empty() { "task" } else { slug };
    slug.chars().take(40).collect()
}

fn build_branch_name(task_id: &str, title: &str) -> String {
    let suffix: String = task_id.chars().take(8).collect();
    format!("task/{}-{}", slugify_branch_component(title), suffix)
}

fn default_worktree_path(task_id: &str) -> PathBuf {
    std::env::temp_dir()
        .join("daily-planner-worktrees")
        .join(task_id)
}

fn shell_escape(input: &str) -> String {
    format!("'{}'", input.replace('\'', "'\"'\"'"))
}

fn build_launch_command(worktree_path: &str, prompt: &str) -> String {
    format!(
        "cd {} && claude --worktree -p {}",
        shell_escape(worktree_path),
        shell_escape(prompt)
    )
}

fn pick_prompt(ctx: &queries::TaskWorktreeContext) -> String {
    let from_improved = ctx
        .prompt_result
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if let Some(prompt) = from_improved {
        return prompt.to_string();
    }
    let from_used = ctx
        .prompt_used
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if let Some(prompt) = from_used {
        return prompt.to_string();
    }
    let from_notes = ctx.notes.trim();
    if !from_notes.is_empty() {
        return from_notes.to_string();
    }
    format!("Implement this task: {}", ctx.title)
}

fn run_git(cwd: Option<&Path>, args: &[&str]) -> Result<std::process::Output, String> {
    let mut cmd = Command::new("git");
    cmd.args(args);
    if let Some(path) = cwd {
        cmd.current_dir(path);
    }
    cmd.output()
        .map_err(|e| format!("Failed to run git {:?}: {}", args, e))
}

#[tauri::command]
pub fn get_tasks(date: String, db: State<'_, DbConnection>) -> Result<Vec<queries::Task>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::get_tasks_by_date(&conn, &date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_task(input: CreateTaskInput, db: State<'_, DbConnection>) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::create_task(
        &conn,
        &input.date,
        input.session_slot,
        &input.title,
        &input.task_type.unwrap_or_else(|| "code".to_string()),
        input.priority.unwrap_or(2),
        input.estimated_min,
        input.project_id.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_task(input: UpdateTaskInput, db: State<'_, DbConnection>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::update_task(
        &conn,
        &input.id,
        input.title.as_deref(),
        input.notes.as_deref(),
        input.task_type.as_deref(),
        input.priority,
        input.estimated_min,
        input.session_slot,
        input.project_id.as_deref(),
        input.clear_project.unwrap_or(false),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_task_status(
    id: String,
    status: String,
    db: State<'_, DbConnection>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::update_task_status(&conn, &id, &status).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_task(id: String, db: State<'_, DbConnection>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::delete_task(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn carry_task_forward(
    id: String,
    tomorrow_date: String,
    session_slot: i64,
    db: State<'_, DbConnection>,
) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::carry_task_forward(&conn, &id, &tomorrow_date, session_slot).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_tasks(task_ids: Vec<String>, db: State<'_, DbConnection>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::reorder_tasks(&conn, &task_ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_prompt_result(
    id: String,
    prompt_used: String,
    prompt_result: String,
    db: State<'_, DbConnection>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::save_prompt_result(&conn, &id, &prompt_used, &prompt_result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn run_task_as_worktree(
    task_id: String,
    db: State<'_, DbConnection>,
) -> Result<RunTaskWorktreeResult, String> {
    let ctx = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        queries::get_task_worktree_context(&conn, &task_id).map_err(|e| e.to_string())?
    };

    let project_path = ctx
        .project_path
        .as_deref()
        .ok_or_else(|| "Task has no associated project/repository.".to_string())?;
    let repo_path = Path::new(project_path);
    if !repo_path.exists() {
        return Err(format!("Repository path does not exist: {}", project_path));
    }

    let git_version = run_git(None, &["--version"])?;
    if !git_version.status.success() {
        return Err("Git is not available in PATH.".to_string());
    }

    let inside_git = run_git(Some(repo_path), &["rev-parse", "--is-inside-work-tree"])?;
    if !inside_git.status.success() {
        return Err(format!("Project path is not a git repository: {}", project_path));
    }

    let status_output = run_git(Some(repo_path), &["status", "--porcelain"])?;
    if !status_output.status.success() {
        let stderr = String::from_utf8_lossy(&status_output.stderr);
        return Err(format!("Failed to inspect git status: {}", stderr.trim()));
    }
    if !String::from_utf8_lossy(&status_output.stdout)
        .trim()
        .is_empty()
    {
        return Err("Repository has uncommitted changes. Commit or stash them before creating a worktree.".to_string());
    }

    let branch_name = ctx
        .worktree_branch
        .clone()
        .unwrap_or_else(|| build_branch_name(&ctx.id, &ctx.title));
    let worktree_path = ctx
        .worktree_path
        .clone()
        .unwrap_or_else(|| default_worktree_path(&ctx.id).to_string_lossy().into_owned());
    let worktree_path_obj = Path::new(&worktree_path);

    if worktree_path_obj.exists() {
        let is_existing_active = ctx.worktree_status.as_deref() == Some("active")
            && ctx.worktree_path.as_deref() == Some(worktree_path.as_str())
            && ctx.worktree_branch.as_deref() == Some(branch_name.as_str());
        if !is_existing_active {
            return Err(format!(
                "Worktree path already exists: {}. Clean it up first.",
                worktree_path
            ));
        }
    } else {
        let branch_exists = run_git(Some(repo_path), &["show-ref", "--verify", &format!("refs/heads/{}", branch_name)])?;
        if branch_exists.status.success() {
            return Err(format!(
                "Branch '{}' already exists. Clean up previous worktree first.",
                branch_name
            ));
        }

        if let Some(parent) = worktree_path_obj.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create worktree parent directory: {}", e))?;
        }

        let add_output = Command::new("git")
            .current_dir(repo_path)
            .arg("worktree")
            .arg("add")
            .arg("-b")
            .arg(&branch_name)
            .arg(&worktree_path)
            .arg("HEAD")
            .output()
            .map_err(|e| format!("Failed to run git worktree add: {}", e))?;

        if !add_output.status.success() {
            let stderr = String::from_utf8_lossy(&add_output.stderr);
            return Err(format!("git worktree add failed: {}", stderr.trim()));
        }
    }

    let prompt_to_run = pick_prompt(&ctx);
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        queries::set_task_worktree_metadata(
            &conn,
            &ctx.id,
            Some(&worktree_path),
            Some(&branch_name),
            Some("active"),
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(RunTaskWorktreeResult {
        task_id: ctx.id,
        worktree_path: worktree_path.clone(),
        branch_name: branch_name.clone(),
        status: "active".to_string(),
        launch_command: build_launch_command(&worktree_path, &prompt_to_run),
        prompt_to_run,
    })
}

#[tauri::command]
pub fn cleanup_task_worktree(
    task_id: String,
    db: State<'_, DbConnection>,
) -> Result<CleanupTaskWorktreeResult, String> {
    let ctx = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        queries::get_task_worktree_context(&conn, &task_id).map_err(|e| e.to_string())?
    };

    let project_path = ctx
        .project_path
        .as_deref()
        .ok_or_else(|| "Task has no associated project/repository.".to_string())?;
    let repo_path = Path::new(project_path);
    let worktree_path = ctx
        .worktree_path
        .clone()
        .ok_or_else(|| "Task does not have a recorded worktree path.".to_string())?;
    let branch_name = ctx
        .worktree_branch
        .clone()
        .ok_or_else(|| "Task does not have a recorded worktree branch.".to_string())?;
    let worktree_path_obj = Path::new(&worktree_path);

    if worktree_path_obj.exists() {
        let remove_output = Command::new("git")
            .current_dir(repo_path)
            .arg("worktree")
            .arg("remove")
            .arg("--force")
            .arg(&worktree_path)
            .output()
            .map_err(|e| format!("Failed to run git worktree remove: {}", e))?;
        if !remove_output.status.success() {
            let stderr = String::from_utf8_lossy(&remove_output.stderr);
            return Err(format!("git worktree remove failed: {}", stderr.trim()));
        }
    }

    let merged_probe = Command::new("git")
        .current_dir(repo_path)
        .arg("merge-base")
        .arg("--is-ancestor")
        .arg(&branch_name)
        .arg("HEAD")
        .output()
        .map_err(|e| format!("Failed to check branch merge status: {}", e))?;

    let mut branch_deleted = false;
    let mut warning = None;
    let status = if merged_probe.status.success() {
        let delete_branch = Command::new("git")
            .current_dir(repo_path)
            .arg("branch")
            .arg("-d")
            .arg(&branch_name)
            .output()
            .map_err(|e| format!("Failed to delete merged branch: {}", e))?;
        if delete_branch.status.success() {
            branch_deleted = true;
            "merged".to_string()
        } else {
            let stderr = String::from_utf8_lossy(&delete_branch.stderr);
            warning = Some(format!(
                "Worktree removed, but branch '{}' was kept: {}",
                branch_name,
                stderr.trim()
            ));
            "abandoned".to_string()
        }
    } else {
        warning = Some(format!(
            "Worktree removed. Branch '{}' has unmerged changes and was kept.",
            branch_name
        ));
        "abandoned".to_string()
    };

    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        queries::set_task_worktree_metadata(
            &conn,
            &ctx.id,
            Some(&worktree_path),
            Some(&branch_name),
            Some(&status),
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(CleanupTaskWorktreeResult {
        task_id: ctx.id,
        worktree_path: Some(worktree_path),
        branch_name: Some(branch_name),
        status,
        branch_deleted,
        warning,
    })
}

#[tauri::command]
pub fn start_focus_session(
    task_id: String,
    date: String,
    db: State<'_, DbConnection>,
) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::start_focus_session(&conn, &task_id, &date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn end_focus_session(
    session_id: String,
    notes: String,
    db: State<'_, DbConnection>,
) -> Result<i64, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::end_focus_session(&conn, &session_id, &notes).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slugify_branch_component() {
        assert_eq!(slugify_branch_component("Fix Planner: Tab Reset!"), "fix-planner-tab-reset");
        assert_eq!(slugify_branch_component("___"), "task");
    }

    #[test]
    fn test_build_branch_name_has_prefix_and_suffix() {
        let branch = build_branch_name("abcdef123456", "My Task");
        assert!(branch.starts_with("task/my-task-"));
        assert!(branch.ends_with("abcdef12"));
    }

    #[test]
    fn test_build_launch_command_quotes_values() {
        let cmd = build_launch_command("/tmp/work tree", "do 'this' now");
        assert!(cmd.contains("claude --worktree -p"));
        assert!(cmd.contains("cd '/tmp/work tree'"));
        assert!(cmd.contains("'do '\"'\"'this'\"'\"' now'"));
    }

    #[test]
    fn test_pick_prompt_prefers_improved_then_used_then_notes() {
        let mut ctx = queries::TaskWorktreeContext {
            id: "t1".to_string(),
            title: "Task".to_string(),
            notes: "notes".to_string(),
            prompt_used: Some("used".to_string()),
            prompt_result: Some("improved".to_string()),
            project_path: Some("/tmp/repo".to_string()),
            worktree_path: None,
            worktree_branch: None,
            worktree_status: None,
        };
        assert_eq!(pick_prompt(&ctx), "improved");

        ctx.prompt_result = None;
        assert_eq!(pick_prompt(&ctx), "used");

        ctx.prompt_used = None;
        assert_eq!(pick_prompt(&ctx), "notes");
    }
}

#[tauri::command]
pub fn get_prompt_templates(
    db: State<'_, DbConnection>,
) -> Result<Vec<queries::PromptTemplateItem>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::list_prompt_templates(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_prompt_template(name: String, content: String, db: State<'_, DbConnection>) -> Result<queries::PromptTemplateItem, String> {
    let trimmed_name = name.trim();
    let trimmed_content = content.trim();
    if trimmed_name.is_empty() {
        return Err("Template name is required".to_string());
    }
    if trimmed_content.is_empty() {
        return Err("Template content is required".to_string());
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::create_prompt_template(&conn, trimmed_name, trimmed_content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_prompt_template(id: String, name: String, content: String, db: State<'_, DbConnection>) -> Result<queries::PromptTemplateItem, String> {
    let trimmed_id = id.trim();
    let trimmed_name = name.trim();
    let trimmed_content = content.trim();
    if trimmed_id.is_empty() {
        return Err("Template id is required".to_string());
    }
    if trimmed_name.is_empty() {
        return Err("Template name is required".to_string());
    }
    if trimmed_content.is_empty() {
        return Err("Template content is required".to_string());
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::update_prompt_template(&conn, trimmed_id, trimmed_name, trimmed_content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_prompt_template(id: String, db: State<'_, DbConnection>) -> Result<bool, String> {
    let trimmed_id = id.trim();
    if trimmed_id.is_empty() {
        return Err("Template id is required".to_string());
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::delete_prompt_template(&conn, trimmed_id).map_err(|e| e.to_string())
}
