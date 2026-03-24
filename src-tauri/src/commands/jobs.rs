use crate::db::queries;
use crate::db::DbConnection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct JobInfo {
    pub id: String,
    pub task_id: String,
    pub project_id: Option<String>,
    pub provider: String,
    pub prompt: String,
    pub output: Option<String>,
    pub status: String,
    pub exit_code: Option<i64>,
    pub worktree_path: Option<String>,
    pub worktree_branch: Option<String>,
    pub error_message: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub created_at: String,
}

impl From<queries::PromptJob> for JobInfo {
    fn from(j: queries::PromptJob) -> Self {
        Self {
            id: j.id,
            task_id: j.task_id,
            project_id: j.project_id,
            provider: j.provider,
            prompt: j.prompt,
            output: j.output,
            status: j.status,
            exit_code: j.exit_code,
            worktree_path: j.worktree_path,
            worktree_branch: j.worktree_branch,
            error_message: j.error_message,
            started_at: j.started_at,
            finished_at: j.finished_at,
            created_at: j.created_at,
        }
    }
}

#[tauri::command]
pub fn get_active_jobs(db: tauri::State<'_, DbConnection>) -> Result<Vec<JobInfo>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::get_active_jobs(&conn)
        .map(|jobs| jobs.into_iter().map(JobInfo::from).collect())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_recent_jobs(
    db: tauri::State<'_, DbConnection>,
    limit: Option<i64>,
) -> Result<Vec<JobInfo>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::get_recent_jobs(&conn, limit.unwrap_or(20))
        .map(|jobs| jobs.into_iter().map(JobInfo::from).collect())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_job(db: tauri::State<'_, DbConnection>, id: String) -> Result<Option<JobInfo>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::get_prompt_job(&conn, &id)
        .map(|opt| opt.map(JobInfo::from))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_jobs_by_task(
    db: tauri::State<'_, DbConnection>,
    task_id: String,
) -> Result<Vec<JobInfo>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::get_jobs_by_task(&conn, &task_id)
        .map(|jobs| jobs.into_iter().map(JobInfo::from).collect())
        .map_err(|e| e.to_string())
}
