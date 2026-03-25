use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub notes: String,
    pub task_type: String,
    pub priority: i64,
    pub status: String,
    pub estimated_min: Option<i64>,
    pub actual_min: Option<i64>,
    pub raw_prompt: Option<String>,
    pub improved_prompt: Option<String>,
    pub prompt_output: Option<String>,
    pub job_status: String,
    pub job_id: Option<String>,
    pub provider: Option<String>,
    pub carried_from: Option<String>,
    pub position: i64,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub project_id: Option<String>,
    pub worktree_path: Option<String>,
    pub worktree_branch: Option<String>,
    pub worktree_status: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PromptJob {
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PromptTemplate {
    pub id: String,
    pub name: String,
    pub category: String,
    pub template: String,
    pub variables: String,
    pub is_builtin: bool,
    pub use_count: i64,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PromptTemplateItem {
    pub id: String,
    pub name: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DailyReport {
    pub id: String,
    pub date: String,
    pub tasks_planned: i64,
    pub tasks_completed: i64,
    pub tasks_skipped: i64,
    pub tasks_carried: i64,
    pub total_focus_min: i64,
    pub ai_reflection: Option<String>,
    pub markdown_export: Option<String>,
    pub generated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SettingRow {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub prompt: Option<String>,
    pub deleted_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub last_seen: Option<String>,
    pub created_at: String,
}

// ---- TASK QUERIES ----

/// Column list for all task SELECT queries — must match row_to_task indices exactly.
const TASK_COLUMNS: &str = "id, title, notes, task_type, priority, status,
    estimated_min, actual_min, raw_prompt, improved_prompt, prompt_output,
    job_status, job_id, provider, carried_from, position,
    created_at, updated_at, completed_at, project_id,
    worktree_path, worktree_branch, worktree_status";
const TASK_COLUMNS_T: &str = "t.id, t.title, t.notes, t.task_type, t.priority, t.status,
    t.estimated_min, t.actual_min, t.raw_prompt, t.improved_prompt, t.prompt_output,
    t.job_status, t.job_id, t.provider, t.carried_from, t.position,
    t.created_at, t.updated_at, t.completed_at, t.project_id,
    t.worktree_path, t.worktree_branch, t.worktree_status";

fn row_to_task(row: &rusqlite::Row) -> Result<Task> {
    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        notes: row.get(2)?,
        task_type: row.get(3)?,
        priority: row.get(4)?,
        status: row.get(5)?,
        estimated_min: row.get(6)?,
        actual_min: row.get(7)?,
        raw_prompt: row.get(8)?,
        improved_prompt: row.get(9)?,
        prompt_output: row.get(10)?,
        job_status: row.get(11)?,
        job_id: row.get(12)?,
        provider: row.get(13)?,
        carried_from: row.get(14)?,
        position: row.get(15)?,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
        completed_at: row.get(18)?,
        project_id: row.get(19)?,
        worktree_path: row.get(20)?,
        worktree_branch: row.get(21)?,
        worktree_status: row.get(22)?,
    })
}

pub fn get_tasks_by_project(conn: &Connection, project_id: &str) -> Result<Vec<Task>> {
    let sql = format!(
        "SELECT {} FROM tasks t
         INNER JOIN projects p ON p.id = t.project_id
         WHERE t.project_id = ?1 AND p.deleted_at IS NULL
         ORDER BY t.position, t.created_at",
        TASK_COLUMNS_T
    );
    let mut stmt = conn.prepare(&sql)?;
    let tasks = stmt.query_map(params![project_id], |row| row_to_task(row))?
        .collect::<Result<Vec<_>>>()?;
    Ok(tasks)
}

pub fn get_standalone_tasks(conn: &Connection) -> Result<Vec<Task>> {
    let sql = format!("SELECT {} FROM tasks WHERE project_id IS NULL ORDER BY position, created_at", TASK_COLUMNS);
    let mut stmt = conn.prepare(&sql)?;
    let tasks = stmt.query_map([], |row| row_to_task(row))?
        .collect::<Result<Vec<_>>>()?;
    Ok(tasks)
}

pub fn get_tasks_by_date_range(conn: &Connection, from: &str, to: &str) -> Result<Vec<Task>> {
    let sql = format!(
        "SELECT {} FROM tasks t
         WHERE date(t.created_at) >= ?1
           AND date(t.created_at) <= ?2
           AND (
             t.project_id IS NULL OR EXISTS (
               SELECT 1 FROM projects p
               WHERE p.id = t.project_id AND p.deleted_at IS NULL
             )
           )
         ORDER BY t.created_at DESC, t.position",
        TASK_COLUMNS_T
    );
    let mut stmt = conn.prepare(&sql)?;
    let tasks = stmt.query_map(params![from, to], |row| row_to_task(row))?
        .collect::<Result<Vec<_>>>()?;
    Ok(tasks)
}

pub fn get_task_by_id(conn: &Connection, id: &str) -> Result<Option<Task>> {
    let sql = format!("SELECT {} FROM tasks WHERE id = ?1", TASK_COLUMNS);
    let result = conn.query_row(&sql, params![id], |row| row_to_task(row));
    match result {
        Ok(task) => Ok(Some(task)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn create_task(
    conn: &Connection,
    title: &str,
    task_type: &str,
    priority: i64,
    estimated_min: Option<i64>,
    project_id: Option<&str>,
) -> Result<String> {
    let id = uuid::Uuid::new_v4().to_string().replace("-", "");
    let max_pos: i64 = if let Some(pid) = project_id {
        conn.query_row(
            "SELECT COALESCE(MAX(position), -1) FROM tasks WHERE project_id = ?1",
            params![pid],
            |row| row.get(0),
        ).unwrap_or(-1)
    } else {
        conn.query_row(
            "SELECT COALESCE(MAX(position), -1) FROM tasks WHERE project_id IS NULL",
            [],
            |row| row.get(0),
        ).unwrap_or(-1)
    };

    conn.execute(
        "INSERT INTO tasks (id, title, task_type, priority, estimated_min, position, project_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, title, task_type, priority, estimated_min, max_pos + 1, project_id],
    )?;
    Ok(id)
}

pub fn update_task_status(conn: &Connection, id: &str, status: &str) -> Result<()> {
    let completed_at = if status == "done" {
        Some(chrono::Utc::now().to_rfc3339())
    } else {
        None
    };
    conn.execute(
        "UPDATE tasks SET status = ?1, completed_at = ?2, updated_at = datetime('now') WHERE id = ?3",
        params![status, completed_at, id],
    )?;
    Ok(())
}

pub fn update_task(
    conn: &Connection,
    id: &str,
    title: Option<&str>,
    notes: Option<&str>,
    task_type: Option<&str>,
    priority: Option<i64>,
    estimated_min: Option<i64>,
    project_id: Option<&str>,
    clear_project: bool,
) -> Result<()> {
    if let Some(t) = title {
        conn.execute(
            "UPDATE tasks SET title = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![t, id],
        )?;
    }
    if let Some(n) = notes {
        conn.execute(
            "UPDATE tasks SET notes = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![n, id],
        )?;
    }
    if let Some(tt) = task_type {
        conn.execute(
            "UPDATE tasks SET task_type = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![tt, id],
        )?;
    }
    if let Some(p) = priority {
        conn.execute(
            "UPDATE tasks SET priority = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![p, id],
        )?;
    }
    if let Some(e) = estimated_min {
        conn.execute(
            "UPDATE tasks SET estimated_min = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![e, id],
        )?;
    }
    if clear_project {
        conn.execute(
            "UPDATE tasks SET project_id = NULL, updated_at = datetime('now') WHERE id = ?1",
            params![id],
        )?;
    } else if let Some(pid) = project_id {
        conn.execute(
            "UPDATE tasks SET project_id = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![pid, id],
        )?;
    }
    Ok(())
}

pub fn delete_task(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn carry_task_forward(conn: &Connection, id: &str) -> Result<String> {
    let sql = format!("SELECT {} FROM tasks WHERE id = ?1", TASK_COLUMNS);
    let task: Task = conn.query_row(&sql, params![id], |row| row_to_task(row))?;

    let new_id = uuid::Uuid::new_v4().to_string().replace("-", "");
    conn.execute(
        "INSERT INTO tasks (id, title, notes, task_type, priority, estimated_min, carried_from, project_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![new_id, task.title, task.notes, task.task_type, task.priority, task.estimated_min, id, task.project_id],
    )?;
    conn.execute(
        "UPDATE tasks SET status = 'carried_over', updated_at = datetime('now') WHERE id = ?1",
        params![id],
    )?;
    Ok(new_id)
}

// Stub kept for compatibility — callers that need bulk rollover can use carry_task_forward per task.
// This function previously required a date column; it now returns 0 as no-op.
#[allow(dead_code)]
pub fn rollover_incomplete_tasks(_conn: &Connection) -> Result<i64> {
    Ok(0)
}

pub fn save_task_prompt(
    conn: &Connection,
    id: &str,
    raw_prompt: Option<&str>,
    improved_prompt: Option<&str>,
) -> Result<()> {
    if let Some(rp) = raw_prompt {
        conn.execute(
            "UPDATE tasks SET raw_prompt = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![rp, id],
        )?;
    }
    if let Some(ip) = improved_prompt {
        conn.execute(
            "UPDATE tasks SET improved_prompt = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![ip, id],
        )?;
    }
    Ok(())
}

pub fn set_task_worktree_metadata(
    conn: &Connection,
    id: &str,
    worktree_path: Option<&str>,
    worktree_branch: Option<&str>,
    worktree_status: Option<&str>,
) -> Result<()> {
    conn.execute(
        "UPDATE tasks
         SET worktree_path = ?1,
             worktree_branch = ?2,
             worktree_status = ?3,
             updated_at = datetime('now')
         WHERE id = ?4",
        params![worktree_path, worktree_branch, worktree_status, id],
    )?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TaskWorktreeContext {
    pub id: String,
    pub title: String,
    pub notes: String,
    pub raw_prompt: Option<String>,
    pub improved_prompt: Option<String>,
    pub project_path: Option<String>,
    pub worktree_path: Option<String>,
    pub worktree_branch: Option<String>,
    pub worktree_status: Option<String>,
}

pub fn get_task_worktree_context(conn: &Connection, id: &str) -> Result<TaskWorktreeContext> {
    conn.query_row(
        "SELECT t.id, t.title, t.notes, t.raw_prompt, t.improved_prompt,
                p.path, t.worktree_path, t.worktree_branch, t.worktree_status
         FROM tasks t
         LEFT JOIN projects p ON p.id = t.project_id
         WHERE t.id = ?1",
        params![id],
        |row| {
            Ok(TaskWorktreeContext {
                id: row.get(0)?,
                title: row.get(1)?,
                notes: row.get(2)?,
                raw_prompt: row.get(3)?,
                improved_prompt: row.get(4)?,
                project_path: row.get(5)?,
                worktree_path: row.get(6)?,
                worktree_branch: row.get(7)?,
                worktree_status: row.get(8)?,
            })
        },
    )
}

pub fn reorder_tasks(conn: &Connection, task_ids: &[String]) -> Result<()> {
    for (i, id) in task_ids.iter().enumerate() {
        conn.execute(
            "UPDATE tasks SET position = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![i as i64, id],
        )?;
    }
    Ok(())
}

// ---- PROMPT JOB QUERIES ----

const JOB_COLUMNS: &str = "id, task_id, project_id, provider, prompt, output, status,
    exit_code, worktree_path, worktree_branch, error_message, started_at, finished_at, created_at";

fn row_to_job(row: &rusqlite::Row) -> Result<PromptJob> {
    Ok(PromptJob {
        id: row.get(0)?,
        task_id: row.get(1)?,
        project_id: row.get(2)?,
        provider: row.get(3)?,
        prompt: row.get(4)?,
        output: row.get(5)?,
        status: row.get(6)?,
        exit_code: row.get(7)?,
        worktree_path: row.get(8)?,
        worktree_branch: row.get(9)?,
        error_message: row.get(10)?,
        started_at: row.get(11)?,
        finished_at: row.get(12)?,
        created_at: row.get(13)?,
    })
}

pub fn create_prompt_job(
    conn: &Connection,
    task_id: &str,
    project_id: Option<&str>,
    provider: &str,
    prompt: &str,
    worktree_path: Option<&str>,
    worktree_branch: Option<&str>,
) -> Result<String> {
    let id = uuid::Uuid::new_v4().to_string().replace("-", "");
    conn.execute(
        "INSERT INTO prompt_jobs (id, task_id, project_id, provider, prompt, worktree_path, worktree_branch)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, task_id, project_id, provider, prompt, worktree_path, worktree_branch],
    )?;
    // Update task job_status and job_id
    conn.execute(
        "UPDATE tasks SET job_status = 'queued', job_id = ?1, provider = ?2, updated_at = datetime('now') WHERE id = ?3",
        params![id, provider, task_id],
    )?;
    Ok(id)
}

pub fn update_prompt_job_status(
    conn: &Connection,
    id: &str,
    status: &str,
    exit_code: Option<i64>,
    error_message: Option<&str>,
) -> Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    match status {
        "running" => {
            conn.execute(
                "UPDATE prompt_jobs SET status = 'running', started_at = ?1 WHERE id = ?2",
                params![now, id],
            )?;
        }
        "completed" | "failed" | "cancelled" => {
            conn.execute(
                "UPDATE prompt_jobs SET status = ?1, exit_code = ?2, error_message = ?3, finished_at = ?4 WHERE id = ?5",
                params![status, exit_code, error_message, now, id],
            )?;
        }
        _ => {
            conn.execute(
                "UPDATE prompt_jobs SET status = ?1 WHERE id = ?2",
                params![status, id],
            )?;
        }
    }
    // Sync task job_status
    let task_id: String = conn.query_row(
        "SELECT task_id FROM prompt_jobs WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )?;
    conn.execute(
        "UPDATE tasks SET job_status = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![status, task_id],
    )?;
    Ok(())
}

pub fn save_prompt_job_output(conn: &Connection, id: &str, output: &str) -> Result<()> {
    conn.execute(
        "UPDATE prompt_jobs SET output = ?1 WHERE id = ?2",
        params![output, id],
    )?;
    // Also save to task's prompt_output
    let task_id: String = conn.query_row(
        "SELECT task_id FROM prompt_jobs WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )?;
    conn.execute(
        "UPDATE tasks SET prompt_output = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![output, task_id],
    )?;
    Ok(())
}

pub fn get_prompt_job(conn: &Connection, id: &str) -> Result<Option<PromptJob>> {
    let sql = format!("SELECT {} FROM prompt_jobs WHERE id = ?1", JOB_COLUMNS);
    let result = conn.query_row(&sql, params![id], |row| row_to_job(row));
    match result {
        Ok(job) => Ok(Some(job)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn get_active_jobs(conn: &Connection) -> Result<Vec<PromptJob>> {
    let sql = format!("SELECT {} FROM prompt_jobs WHERE status IN ('queued', 'running') ORDER BY created_at", JOB_COLUMNS);
    let mut stmt = conn.prepare(&sql)?;
    let jobs = stmt.query_map([], |row| row_to_job(row))?
        .collect::<Result<Vec<_>>>()?;
    Ok(jobs)
}

pub fn get_recent_jobs(conn: &Connection, limit: i64) -> Result<Vec<PromptJob>> {
    let sql = format!("SELECT {} FROM prompt_jobs ORDER BY created_at DESC LIMIT ?1", JOB_COLUMNS);
    let mut stmt = conn.prepare(&sql)?;
    let jobs = stmt.query_map(params![limit], |row| row_to_job(row))?
        .collect::<Result<Vec<_>>>()?;
    Ok(jobs)
}

pub fn get_jobs_by_task(conn: &Connection, task_id: &str) -> Result<Vec<PromptJob>> {
    let sql = format!("SELECT {} FROM prompt_jobs WHERE task_id = ?1 ORDER BY created_at DESC", JOB_COLUMNS);
    let mut stmt = conn.prepare(&sql)?;
    let jobs = stmt.query_map(params![task_id], |row| row_to_job(row))?
        .collect::<Result<Vec<_>>>()?;
    Ok(jobs)
}

pub fn get_all_prompt_jobs(conn: &Connection) -> Result<Vec<PromptJob>> {
    let sql = format!("SELECT {} FROM prompt_jobs ORDER BY created_at", JOB_COLUMNS);
    let mut stmt = conn.prepare(&sql)?;
    let jobs = stmt.query_map([], |row| row_to_job(row))?
        .collect::<Result<Vec<_>>>()?;
    Ok(jobs)
}

// ---- TEMPLATE QUERIES ----

pub fn list_prompt_templates(conn: &Connection) -> Result<Vec<PromptTemplateItem>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, template FROM prompt_templates ORDER BY is_builtin DESC, use_count DESC, name"
    )?;
    let templates = stmt
        .query_map([], |row| {
            Ok(PromptTemplateItem {
                id: row.get(0)?,
                name: row.get(1)?,
                content: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(templates)
}

pub fn create_prompt_template(conn: &Connection, name: &str, content: &str) -> Result<PromptTemplateItem> {
    let id = uuid::Uuid::new_v4().to_string().replace("-", "");
    conn.execute(
        "INSERT INTO prompt_templates (id, name, template, category, variables, is_builtin, use_count)
         VALUES (?1, ?2, ?3, 'general', '[]', 0, 0)",
        params![id, name, content],
    )?;

    Ok(PromptTemplateItem {
        id,
        name: name.to_string(),
        content: content.to_string(),
    })
}

pub fn update_prompt_template(conn: &Connection, id: &str, name: &str, content: &str) -> Result<PromptTemplateItem> {
    let rows = conn.execute(
        "UPDATE prompt_templates SET name = ?1, template = ?2 WHERE id = ?3",
        params![name, content, id],
    )?;
    if rows == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }

    Ok(PromptTemplateItem {
        id: id.to_string(),
        name: name.to_string(),
        content: content.to_string(),
    })
}

pub fn delete_prompt_template(conn: &Connection, id: &str) -> Result<bool> {
    let rows = conn.execute("DELETE FROM prompt_templates WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

#[allow(dead_code)]
pub fn increment_template_use(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "UPDATE prompt_templates SET use_count = use_count + 1 WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

// ---- SETTINGS QUERIES ----

pub fn get_setting(conn: &Connection, key: &str) -> Result<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
        params![key, value],
    )?;
    Ok(())
}

pub fn get_all_settings(conn: &Connection) -> Result<std::collections::HashMap<String, String>> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let mut map = std::collections::HashMap::new();
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (k, v) = row?;
        map.insert(k, v);
    }
    Ok(map)
}

// ---- REPORT QUERIES ----

pub fn generate_report(conn: &Connection, date: &str) -> Result<DailyReport> {
    let tasks_planned: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tasks WHERE date(created_at) = ?1 AND status != 'carried_over'",
        params![date], |row| row.get(0),
    ).unwrap_or(0);
    let tasks_completed: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tasks WHERE date(created_at) = ?1 AND status = 'done'",
        params![date], |row| row.get(0),
    ).unwrap_or(0);
    let tasks_skipped: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tasks WHERE date(created_at) = ?1 AND status = 'skipped'",
        params![date], |row| row.get(0),
    ).unwrap_or(0);
    let tasks_carried: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tasks WHERE date(created_at) = ?1 AND status = 'carried_over'",
        params![date], |row| row.get(0),
    ).unwrap_or(0);

    let id = uuid::Uuid::new_v4().to_string().replace("-", "");

    conn.execute(
        "INSERT INTO daily_reports (id, date, tasks_planned, tasks_completed, tasks_skipped, tasks_carried, total_focus_min)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)
         ON CONFLICT(date) DO UPDATE SET
           tasks_planned = ?3, tasks_completed = ?4, tasks_skipped = ?5,
           tasks_carried = ?6, generated_at = datetime('now')",
        params![id, date, tasks_planned, tasks_completed, tasks_skipped, tasks_carried],
    )?;

    let report = conn.query_row(
        "SELECT id, date, tasks_planned, tasks_completed, tasks_skipped, tasks_carried,
                total_focus_min, ai_reflection, markdown_export, generated_at
         FROM daily_reports WHERE date = ?1", params![date],
        |row| Ok(DailyReport {
            id: row.get(0)?,
            date: row.get(1)?,
            tasks_planned: row.get(2)?,
            tasks_completed: row.get(3)?,
            tasks_skipped: row.get(4)?,
            tasks_carried: row.get(5)?,
            total_focus_min: row.get(6)?,
            ai_reflection: row.get(7)?,
            markdown_export: row.get(8)?,
            generated_at: row.get(9)?,
        }),
    )?;
    Ok(report)
}

pub fn get_report(conn: &Connection, date: &str) -> Result<Option<DailyReport>> {
    let result = conn.query_row(
        "SELECT id, date, tasks_planned, tasks_completed, tasks_skipped, tasks_carried,
                total_focus_min, ai_reflection, markdown_export, generated_at
         FROM daily_reports WHERE date = ?1", params![date],
        |row| Ok(DailyReport {
            id: row.get(0)?,
            date: row.get(1)?,
            tasks_planned: row.get(2)?,
            tasks_completed: row.get(3)?,
            tasks_skipped: row.get(4)?,
            tasks_carried: row.get(5)?,
            total_focus_min: row.get(6)?,
            ai_reflection: row.get(7)?,
            markdown_export: row.get(8)?,
            generated_at: row.get(9)?,
        }),
    );
    match result {
        Ok(r) => Ok(Some(r)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn save_ai_reflection(conn: &Connection, date: &str, reflection: &str) -> Result<()> {
    conn.execute(
        "UPDATE daily_reports SET ai_reflection = ?1 WHERE date = ?2",
        params![reflection, date],
    )?;
    Ok(())
}

pub fn get_reports_range(conn: &Connection, from: &str, to: &str) -> Result<Vec<DailyReport>> {
    let mut stmt = conn.prepare(
        "SELECT id, date, tasks_planned, tasks_completed, tasks_skipped, tasks_carried,
                total_focus_min, ai_reflection, markdown_export, generated_at
         FROM daily_reports WHERE date >= ?1 AND date <= ?2 ORDER BY date DESC"
    )?;
    let reports = stmt
        .query_map(params![from, to], |row| {
            Ok(DailyReport {
                id: row.get(0)?,
                date: row.get(1)?,
                tasks_planned: row.get(2)?,
                tasks_completed: row.get(3)?,
                tasks_skipped: row.get(4)?,
                tasks_carried: row.get(5)?,
                total_focus_min: row.get(6)?,
                ai_reflection: row.get(7)?,
                markdown_export: row.get(8)?,
                generated_at: row.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(reports)
}

// ---- BULK READ QUERIES (for backup) ----

pub fn get_all_tasks(conn: &Connection) -> Result<Vec<Task>> {
    let sql = format!("SELECT {} FROM tasks ORDER BY created_at", TASK_COLUMNS);
    let mut stmt = conn.prepare(&sql)?;
    let tasks = stmt.query_map([], |row| row_to_task(row))?
        .collect::<Result<Vec<_>>>()?;
    Ok(tasks)
}

pub fn get_all_tasks_active(conn: &Connection) -> Result<Vec<Task>> {
    let sql = format!(
        "SELECT {} FROM tasks t
         WHERE t.project_id IS NULL
            OR EXISTS (
                SELECT 1 FROM projects p
                WHERE p.id = t.project_id AND p.deleted_at IS NULL
            )
         ORDER BY t.created_at",
        TASK_COLUMNS_T
    );
    let mut stmt = conn.prepare(&sql)?;
    let tasks = stmt.query_map([], |row| row_to_task(row))?
        .collect::<Result<Vec<_>>>()?;
    Ok(tasks)
}

pub fn get_all_prompt_templates(conn: &Connection) -> Result<Vec<PromptTemplate>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, category, template, variables, is_builtin, use_count, created_at
         FROM prompt_templates ORDER BY is_builtin DESC, name",
    )?;
    let templates = stmt
        .query_map([], |row| {
            Ok(PromptTemplate {
                id: row.get(0)?,
                name: row.get(1)?,
                category: row.get(2)?,
                template: row.get(3)?,
                variables: row.get(4)?,
                is_builtin: row.get::<_, i64>(5)? == 1,
                use_count: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(templates)
}

pub fn get_all_daily_reports(conn: &Connection) -> Result<Vec<DailyReport>> {
    let mut stmt = conn.prepare(
        "SELECT id, date, tasks_planned, tasks_completed, tasks_skipped, tasks_carried,
                total_focus_min, ai_reflection, markdown_export, generated_at
         FROM daily_reports ORDER BY date"
    )?;
    let reports = stmt
        .query_map([], |row| {
            Ok(DailyReport {
                id: row.get(0)?,
                date: row.get(1)?,
                tasks_planned: row.get(2)?,
                tasks_completed: row.get(3)?,
                tasks_skipped: row.get(4)?,
                tasks_carried: row.get(5)?,
                total_focus_min: row.get(6)?,
                ai_reflection: row.get(7)?,
                markdown_export: row.get(8)?,
                generated_at: row.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(reports)
}

pub fn get_all_settings_non_sensitive(conn: &Connection) -> Result<Vec<SettingRow>> {
    let mut stmt =
        conn.prepare("SELECT key, value FROM settings WHERE key != 'claude_token_enc'")?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SettingRow {
                key: row.get(0)?,
                value: row.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(rows)
}

// ---- PROJECT QUERIES ----

pub fn get_projects(conn: &Connection) -> Result<Vec<Project>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, path, prompt, deleted_at, created_at
         FROM projects
         WHERE deleted_at IS NULL
         ORDER BY name",
    )?;
    let projects = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                prompt: row.get(3)?,
                deleted_at: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(projects)
}

pub fn get_trashed_projects(conn: &Connection) -> Result<Vec<Project>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, path, prompt, deleted_at, created_at
         FROM projects
         WHERE deleted_at IS NOT NULL
         ORDER BY deleted_at DESC, name",
    )?;
    let projects = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                prompt: row.get(3)?,
                deleted_at: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(projects)
}

pub fn get_project_prompt(conn: &Connection, project_id: &str) -> Result<Option<String>> {
    let result = conn.query_row(
        "SELECT prompt FROM projects WHERE id = ?1 AND deleted_at IS NULL",
        params![project_id],
        |row| row.get::<_, Option<String>>(0),
    );
    match result {
        Ok(p) => Ok(p.filter(|s| !s.is_empty())),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn set_project_prompt(conn: &Connection, project_id: &str, prompt: &str) -> Result<()> {
    conn.execute(
        "UPDATE projects SET prompt = ?1 WHERE id = ?2 AND deleted_at IS NULL",
        params![prompt, project_id],
    )?;
    Ok(())
}

pub fn create_project(conn: &Connection, name: &str, path: &str) -> Result<String> {
    let id = uuid::Uuid::new_v4().to_string().replace("-", "");
    conn.execute(
        "INSERT INTO projects (id, name, path) VALUES (?1, ?2, ?3)",
        params![id, name, path],
    )?;
    Ok(id)
}

pub fn delete_project(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "UPDATE projects SET deleted_at = datetime('now') WHERE id = ?1 AND deleted_at IS NULL",
        params![id],
    )?;
    Ok(())
}

pub fn restore_project(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "UPDATE projects SET deleted_at = NULL WHERE id = ?1 AND deleted_at IS NOT NULL",
        params![id],
    )?;
    Ok(())
}

pub fn hard_delete_project(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM prompt_jobs
         WHERE project_id = ?1
            OR task_id IN (SELECT id FROM tasks WHERE project_id = ?1)",
        params![id],
    )?;
    conn.execute("DELETE FROM tasks WHERE project_id = ?1", params![id])?;
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
    Ok(())
}

// ---- DEVICE QUERIES ----

pub fn list_devices(conn: &Connection) -> Result<Vec<Device>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, last_seen, created_at FROM devices ORDER BY created_at DESC",
    )?;
    let devices = stmt
        .query_map([], |row| {
            Ok(Device {
                id: row.get(0)?,
                name: row.get(1)?,
                last_seen: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(devices)
}

pub fn register_device(conn: &Connection, id: &str, name: &str) -> Result<Device> {
    conn.execute(
        "INSERT INTO devices (id, name, last_seen) VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, last_seen = datetime('now')",
        params![id, name],
    )?;
    conn.query_row(
        "SELECT id, name, last_seen, created_at FROM devices WHERE id = ?1",
        params![id],
        |row| {
            Ok(Device {
                id: row.get(0)?,
                name: row.get(1)?,
                last_seen: row.get(2)?,
                created_at: row.get(3)?,
            })
        },
    )
}

pub fn update_device_last_seen(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "UPDATE devices SET last_seen = datetime('now') WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

pub fn delete_device(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM devices WHERE id = ?1", params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::run_migrations;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        run_migrations(&mut conn, None).unwrap();
        conn
    }

    #[test]
    fn test_create_and_get_task() {
        let conn = setup_test_db();
        let id = create_task(&conn, "Test task", "prompt", 2, Some(30), None).unwrap();
        let tasks = get_standalone_tasks(&conn).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, id);
        assert_eq!(tasks[0].title, "Test task");
        assert_eq!(tasks[0].status, "pending");
        assert_eq!(tasks[0].job_status, "idle");
        assert_eq!(tasks[0].worktree_status, None);
    }

    #[test]
    fn test_create_task_with_project() {
        let conn = setup_test_db();
        let pid = create_project(&conn, "My Project", "/tmp/proj").unwrap();
        let id = create_task(&conn, "Project task", "prompt", 1, None, Some(&pid)).unwrap();
        let tasks = get_tasks_by_project(&conn, &pid).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, id);
        assert_eq!(tasks[0].project_id.as_deref(), Some(pid.as_str()));
        // standalone list must not include it
        let standalone = get_standalone_tasks(&conn).unwrap();
        assert!(standalone.is_empty());
    }

    #[test]
    fn test_update_task_status() {
        let conn = setup_test_db();
        let id = create_task(&conn, "Test", "prompt", 2, None, None).unwrap();
        update_task_status(&conn, &id, "done").unwrap();
        let task = get_task_by_id(&conn, &id).unwrap().unwrap();
        assert_eq!(task.status, "done");
        assert!(task.completed_at.is_some());
    }

    #[test]
    fn test_carry_forward() {
        let conn = setup_test_db();
        let id = create_task(&conn, "Carry me", "prompt", 1, None, None).unwrap();
        let new_id = carry_task_forward(&conn, &id).unwrap();
        let all = get_standalone_tasks(&conn).unwrap();
        // original is carried_over, new one is pending
        let original = all.iter().find(|t| t.id == id).unwrap();
        let carried = all.iter().find(|t| t.id == new_id).unwrap();
        assert_eq!(original.status, "carried_over");
        assert_eq!(carried.carried_from.as_deref(), Some(id.as_str()));
        assert_eq!(carried.status, "pending");
    }

    #[test]
    fn test_settings() {
        let conn = setup_test_db();
        set_setting(&conn, "timezone_offset", "8").unwrap();
        let val = get_setting(&conn, "timezone_offset").unwrap();
        assert_eq!(val, "8");
    }

    #[test]
    fn test_generate_report() {
        let conn = setup_test_db();
        let id1 = create_task(&conn, "Task 1", "prompt", 1, Some(30), None).unwrap();
        let id2 = create_task(&conn, "Task 2", "prompt", 2, Some(20), None).unwrap();
        update_task_status(&conn, &id1, "done").unwrap();
        update_task_status(&conn, &id2, "skipped").unwrap();
        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        let report = generate_report(&conn, &today).unwrap();
        assert_eq!(report.tasks_completed, 1);
        assert_eq!(report.tasks_skipped, 1);
    }

    #[test]
    fn test_reorder_tasks() {
        let conn = setup_test_db();
        let id1 = create_task(&conn, "Task A", "prompt", 1, None, None).unwrap();
        let id2 = create_task(&conn, "Task B", "prompt", 2, None, None).unwrap();
        reorder_tasks(&conn, &[id2.clone(), id1.clone()]).unwrap();
        let tasks = get_standalone_tasks(&conn).unwrap();
        let t2 = tasks.iter().find(|t| t.id == id2).unwrap();
        assert_eq!(t2.position, 0);
    }

    #[test]
    fn test_set_task_worktree_metadata() {
        let conn = setup_test_db();
        let id = create_task(&conn, "Worktree task", "prompt", 2, None, None).unwrap();

        set_task_worktree_metadata(
            &conn,
            &id,
            Some("/tmp/daily-planner-worktrees/abc"),
            Some("task/worktree-task-abc"),
            Some("active"),
        )
        .unwrap();

        let task = get_task_by_id(&conn, &id).unwrap().unwrap();
        assert_eq!(task.worktree_path.as_deref(), Some("/tmp/daily-planner-worktrees/abc"));
        assert_eq!(task.worktree_branch.as_deref(), Some("task/worktree-task-abc"));
        assert_eq!(task.worktree_status.as_deref(), Some("active"));
    }

    #[test]
    fn test_get_task_by_id_not_found() {
        let conn = setup_test_db();
        let result = get_task_by_id(&conn, "nonexistent-id").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_create_prompt_job() {
        let conn = setup_test_db();
        let task_id = create_task(&conn, "AI task", "prompt", 1, None, None).unwrap();
        let job_id = create_prompt_job(
            &conn, &task_id, None, "claude", "Do the thing", None, None,
        ).unwrap();

        // task should have job_status = queued and job_id set
        let task = get_task_by_id(&conn, &task_id).unwrap().unwrap();
        assert_eq!(task.job_status, "queued");
        assert_eq!(task.job_id.as_deref(), Some(job_id.as_str()));

        // job should be retrievable
        let job = get_prompt_job(&conn, &job_id).unwrap().unwrap();
        assert_eq!(job.task_id, task_id);
        assert_eq!(job.provider, "claude");
        assert_eq!(job.status, "queued");
    }

    #[test]
    fn test_get_active_jobs() {
        let conn = setup_test_db();
        let task_id = create_task(&conn, "AI task 2", "prompt", 1, None, None).unwrap();
        let job_id = create_prompt_job(
            &conn, &task_id, None, "claude", "Prompt text", None, None,
        ).unwrap();

        let active = get_active_jobs(&conn).unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].id, job_id);

        // After marking completed, active list should be empty
        update_prompt_job_status(&conn, &job_id, "completed", Some(0), None).unwrap();
        let active_after = get_active_jobs(&conn).unwrap();
        assert!(active_after.is_empty());
    }

    #[test]
    fn test_save_task_prompt() {
        let conn = setup_test_db();
        let id = create_task(&conn, "Prompt task", "prompt", 1, None, None).unwrap();
        save_task_prompt(&conn, &id, Some("raw text"), Some("improved text")).unwrap();
        let task = get_task_by_id(&conn, &id).unwrap().unwrap();
        assert_eq!(task.raw_prompt.as_deref(), Some("raw text"));
        assert_eq!(task.improved_prompt.as_deref(), Some("improved text"));
    }

    #[test]
    fn test_tasks_by_date_range() {
        let conn = setup_test_db();
        let _id = create_task(&conn, "Range task", "prompt", 1, None, None).unwrap();
        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        let tasks = get_tasks_by_date_range(&conn, &today, &today).unwrap();
        assert_eq!(tasks.len(), 1);
    }

    #[test]
    fn test_get_all_tasks_includes_project_tasks() {
        let conn = setup_test_db();
        // Create a standalone task
        let _s = create_task(&conn, "Standalone", "other", 2, None, None).unwrap();
        // Create a project and a task in that project
        let pid = create_project(&conn, "Proj", "/tmp/p").unwrap();
        let _p = create_task(&conn, "Project task", "prompt", 1, None, Some(&pid)).unwrap();

        // get_all_tasks must return both
        let all = get_all_tasks(&conn).unwrap();
        assert_eq!(all.len(), 2, "get_all_tasks should return standalone + project tasks");

        // get_standalone_tasks must return only the standalone one
        let standalone = get_standalone_tasks(&conn).unwrap();
        assert_eq!(standalone.len(), 1);
        assert_eq!(standalone[0].title, "Standalone");

        // get_tasks_by_project must return only the project one
        let proj_tasks = get_tasks_by_project(&conn, &pid).unwrap();
        assert_eq!(proj_tasks.len(), 1);
        assert_eq!(proj_tasks[0].title, "Project task");
    }

    #[test]
    fn test_soft_delete_restore_project_and_tasks_visibility() {
        let conn = setup_test_db();
        let pid = create_project(&conn, "Trash Me", "/tmp/trash-me").unwrap();
        let tid = create_task(&conn, "Keep for history", "prompt", 2, None, Some(&pid)).unwrap();

        let active_before = get_projects(&conn).unwrap();
        assert_eq!(active_before.len(), 1);
        assert_eq!(get_tasks_by_project(&conn, &pid).unwrap().len(), 1);

        delete_project(&conn, &pid).unwrap();

        let active_after_delete = get_projects(&conn).unwrap();
        assert!(active_after_delete.is_empty());
        let trashed = get_trashed_projects(&conn).unwrap();
        assert_eq!(trashed.len(), 1);
        assert_eq!(trashed[0].id, pid);

        // Tasks remain linked but hidden from active-project fetch
        assert!(get_tasks_by_project(&conn, &trashed[0].id).unwrap().is_empty());
        assert!(get_task_by_id(&conn, &tid).unwrap().is_some());

        restore_project(&conn, &trashed[0].id).unwrap();
        let active_after_restore = get_projects(&conn).unwrap();
        assert_eq!(active_after_restore.len(), 1);
        assert_eq!(get_trashed_projects(&conn).unwrap().len(), 0);
        assert_eq!(get_tasks_by_project(&conn, &active_after_restore[0].id).unwrap().len(), 1);
    }

    #[test]
    fn test_hard_delete_project_removes_tasks_and_jobs() {
        let conn = setup_test_db();
        let pid = create_project(&conn, "Hard Delete", "/tmp/hard-delete").unwrap();
        let tid = create_task(&conn, "Task to remove", "prompt", 1, None, Some(&pid)).unwrap();
        let jid = create_prompt_job(
            &conn,
            &tid,
            Some(&pid),
            "claude",
            "run this",
            None,
            None,
        )
        .unwrap();

        delete_project(&conn, &pid).unwrap();
        hard_delete_project(&conn, &pid).unwrap();

        assert!(get_projects(&conn).unwrap().is_empty());
        assert!(get_trashed_projects(&conn).unwrap().is_empty());
        assert!(get_task_by_id(&conn, &tid).unwrap().is_none());
        assert!(get_prompt_job(&conn, &jid).unwrap().is_none());
    }

    #[test]
    fn test_get_all_tasks_active_excludes_tasks_from_trashed_projects() {
        let conn = setup_test_db();
        let _standalone = create_task(&conn, "Standalone", "other", 2, None, None).unwrap();
        let pid = create_project(&conn, "Hidden Project", "/tmp/hidden-project").unwrap();
        let _proj_task = create_task(&conn, "Project task", "prompt", 2, None, Some(&pid)).unwrap();

        assert_eq!(get_all_tasks_active(&conn).unwrap().len(), 2);
        delete_project(&conn, &pid).unwrap();
        let active = get_all_tasks_active(&conn).unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].title, "Standalone");
    }
}
