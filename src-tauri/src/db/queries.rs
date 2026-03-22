use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Task {
    pub id: String,
    pub date: String,
    pub session_slot: i64,
    pub title: String,
    pub notes: String,
    pub task_type: String,
    pub priority: i64,
    pub status: String,
    pub estimated_min: Option<i64>,
    pub actual_min: Option<i64>,
    pub prompt_used: Option<String>,
    pub prompt_result: Option<String>,
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
pub struct FocusSession {
    pub id: String,
    pub task_id: String,
    pub date: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub duration_min: Option<i64>,
    pub notes: String,
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
    pub session1_focus: i64,
    pub session2_focus: i64,
    pub ai_reflection: Option<String>,
    pub markdown_export: Option<String>,
    pub generated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DailySession {
    pub id: String,
    pub date: String,
    pub session_slot: i64,
    pub started_at: String,
    pub tasks_planned: i64,
    pub tasks_completed: i64,
    pub tasks_skipped: i64,
    pub focus_minutes: i64,
    pub notes: String,
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
    pub created_at: String,
}

// ---- TASK QUERIES ----

pub fn get_tasks_by_date(conn: &Connection, date: &str) -> Result<Vec<Task>> {
    let mut stmt = conn.prepare(
        "SELECT id, date, session_slot, title, notes, task_type, priority, status,
                estimated_min, actual_min, prompt_used, prompt_result, carried_from,
                position, created_at, updated_at, completed_at, project_id,
                worktree_path, worktree_branch, worktree_status
         FROM tasks WHERE date = ?1 ORDER BY session_slot, position, created_at",
    )?;
    let tasks = stmt
        .query_map(params![date], |row| {
            Ok(Task {
                id: row.get(0)?,
                date: row.get(1)?,
                session_slot: row.get(2)?,
                title: row.get(3)?,
                notes: row.get(4)?,
                task_type: row.get(5)?,
                priority: row.get(6)?,
                status: row.get(7)?,
                estimated_min: row.get(8)?,
                actual_min: row.get(9)?,
                prompt_used: row.get(10)?,
                prompt_result: row.get(11)?,
                carried_from: row.get(12)?,
                position: row.get(13)?,
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
                completed_at: row.get(16)?,
                project_id: row.get(17)?,
                worktree_path: row.get(18)?,
                worktree_branch: row.get(19)?,
                worktree_status: row.get(20)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(tasks)
}

pub fn create_task(
    conn: &Connection,
    date: &str,
    session_slot: i64,
    title: &str,
    task_type: &str,
    priority: i64,
    estimated_min: Option<i64>,
    project_id: Option<&str>,
) -> Result<String> {
    let id = uuid::Uuid::new_v4().to_string().replace("-", "");
    let max_pos: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) FROM tasks WHERE date = ?1 AND session_slot = ?2",
            params![date, session_slot],
            |row| row.get(0),
        )
        .unwrap_or(-1);

    conn.execute(
        "INSERT INTO tasks (id, date, session_slot, title, task_type, priority, estimated_min, position, project_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![id, date, session_slot, title, task_type, priority, estimated_min, max_pos + 1, project_id],
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
    session_slot: Option<i64>,
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
    if let Some(s) = session_slot {
        conn.execute(
            "UPDATE tasks SET session_slot = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![s, id],
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

pub fn carry_task_forward(
    conn: &Connection,
    id: &str,
    tomorrow_date: &str,
    session_slot: i64,
) -> Result<String> {
    let task: Task = conn.query_row(
        "SELECT id, date, session_slot, title, notes, task_type, priority, status,
                estimated_min, actual_min, prompt_used, prompt_result, carried_from,
                position, created_at, updated_at, completed_at, project_id,
                worktree_path, worktree_branch, worktree_status
         FROM tasks WHERE id = ?1",
        params![id],
        |row| {
            Ok(Task {
                id: row.get(0)?,
                date: row.get(1)?,
                session_slot: row.get(2)?,
                title: row.get(3)?,
                notes: row.get(4)?,
                task_type: row.get(5)?,
                priority: row.get(6)?,
                status: row.get(7)?,
                estimated_min: row.get(8)?,
                actual_min: row.get(9)?,
                prompt_used: row.get(10)?,
                prompt_result: row.get(11)?,
                carried_from: row.get(12)?,
                position: row.get(13)?,
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
                completed_at: row.get(16)?,
                project_id: row.get(17)?,
                worktree_path: row.get(18)?,
                worktree_branch: row.get(19)?,
                worktree_status: row.get(20)?,
            })
        },
    )?;

    let new_id = uuid::Uuid::new_v4().to_string().replace("-", "");
    conn.execute(
        "INSERT INTO tasks (id, date, session_slot, title, notes, task_type, priority, estimated_min, carried_from, project_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![new_id, tomorrow_date, session_slot, task.title, task.notes,
                task.task_type, task.priority, task.estimated_min, id, task.project_id],
    )?;
    conn.execute(
        "UPDATE tasks SET status = 'carried_over', updated_at = datetime('now') WHERE id = ?1",
        params![id],
    )?;
    Ok(new_id)
}

pub fn save_prompt_result(
    conn: &Connection,
    id: &str,
    prompt_used: &str,
    prompt_result: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE tasks SET prompt_used = ?1, prompt_result = ?2, updated_at = datetime('now') WHERE id = ?3",
        params![prompt_used, prompt_result, id],
    )?;
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
    pub prompt_used: Option<String>,
    pub prompt_result: Option<String>,
    pub project_path: Option<String>,
    pub worktree_path: Option<String>,
    pub worktree_branch: Option<String>,
    pub worktree_status: Option<String>,
}

pub fn get_task_worktree_context(conn: &Connection, id: &str) -> Result<TaskWorktreeContext> {
    conn.query_row(
        "SELECT t.id, t.title, t.notes, t.prompt_used, t.prompt_result,
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
                prompt_used: row.get(3)?,
                prompt_result: row.get(4)?,
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

// ---- FOCUS SESSION QUERIES ----

pub fn start_focus_session(conn: &Connection, task_id: &str, date: &str) -> Result<String> {
    let id = uuid::Uuid::new_v4().to_string().replace("-", "");
    let started_at = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO focus_sessions (id, task_id, date, started_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, task_id, date, started_at],
    )?;
    conn.execute(
        "UPDATE tasks SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?1",
        params![task_id],
    )?;
    Ok(id)
}

pub fn end_focus_session(conn: &Connection, session_id: &str, notes: &str) -> Result<i64> {
    let started_at: String = conn.query_row(
        "SELECT started_at FROM focus_sessions WHERE id = ?1",
        params![session_id],
        |row| row.get(0),
    )?;
    let ended_at = chrono::Utc::now().to_rfc3339();
    let start = chrono::DateTime::parse_from_rfc3339(&started_at)
        .unwrap_or_else(|_| chrono::Utc::now().into());
    let end = chrono::DateTime::parse_from_rfc3339(&ended_at)
        .unwrap_or_else(|_| chrono::Utc::now().into());
    let duration_min = (end - start).num_minutes().max(0);

    conn.execute(
        "UPDATE focus_sessions SET ended_at = ?1, duration_min = ?2, notes = ?3 WHERE id = ?4",
        params![ended_at, duration_min, notes, session_id],
    )?;
    Ok(duration_min)
}

#[allow(dead_code)]
pub fn get_active_focus_session(conn: &Connection, task_id: &str) -> Result<Option<String>> {
    let result = conn.query_row(
        "SELECT id FROM focus_sessions WHERE task_id = ?1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1",
        params![task_id],
        |row| row.get::<_, String>(0),
    );
    match result {
        Ok(id) => Ok(Some(id)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
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
    let tasks_planned: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE date = ?1 AND status != 'carried_over'",
            params![date],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let tasks_completed: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE date = ?1 AND status = 'done'",
            params![date],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let tasks_skipped: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE date = ?1 AND status = 'skipped'",
            params![date],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let tasks_carried: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE date = ?1 AND status = 'carried_over'",
            params![date],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let total_focus_min: i64 = conn.query_row(
        "SELECT COALESCE(SUM(duration_min), 0) FROM focus_sessions WHERE date = ?1 AND duration_min IS NOT NULL",
        params![date], |row| row.get(0),
    ).unwrap_or(0);

    // Estimate session splits from task data
    let session1_focus: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(fs.duration_min), 0) FROM focus_sessions fs
         JOIN tasks t ON t.id = fs.task_id
         WHERE fs.date = ?1 AND t.session_slot = 1 AND fs.duration_min IS NOT NULL",
            params![date],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let session2_focus = total_focus_min - session1_focus;

    let id = uuid::Uuid::new_v4().to_string().replace("-", "");

    conn.execute(
        "INSERT INTO daily_reports (id, date, tasks_planned, tasks_completed, tasks_skipped, tasks_carried, total_focus_min, session1_focus, session2_focus)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(date) DO UPDATE SET
           tasks_planned = ?3, tasks_completed = ?4, tasks_skipped = ?5,
           tasks_carried = ?6, total_focus_min = ?7, session1_focus = ?8, session2_focus = ?9,
           generated_at = datetime('now')",
        params![id, date, tasks_planned, tasks_completed, tasks_skipped, tasks_carried, total_focus_min, session1_focus, session2_focus],
    )?;

    let report = conn.query_row(
        "SELECT id, date, tasks_planned, tasks_completed, tasks_skipped, tasks_carried,
                total_focus_min, session1_focus, session2_focus, ai_reflection, markdown_export, generated_at
         FROM daily_reports WHERE date = ?1", params![date],
        |row| Ok(DailyReport {
            id: row.get(0)?,
            date: row.get(1)?,
            tasks_planned: row.get(2)?,
            tasks_completed: row.get(3)?,
            tasks_skipped: row.get(4)?,
            tasks_carried: row.get(5)?,
            total_focus_min: row.get(6)?,
            session1_focus: row.get(7)?,
            session2_focus: row.get(8)?,
            ai_reflection: row.get(9)?,
            markdown_export: row.get(10)?,
            generated_at: row.get(11)?,
        }),
    )?;
    Ok(report)
}

pub fn get_report(conn: &Connection, date: &str) -> Result<Option<DailyReport>> {
    let result = conn.query_row(
        "SELECT id, date, tasks_planned, tasks_completed, tasks_skipped, tasks_carried,
                total_focus_min, session1_focus, session2_focus, ai_reflection, markdown_export, generated_at
         FROM daily_reports WHERE date = ?1", params![date],
        |row| Ok(DailyReport {
            id: row.get(0)?,
            date: row.get(1)?,
            tasks_planned: row.get(2)?,
            tasks_completed: row.get(3)?,
            tasks_skipped: row.get(4)?,
            tasks_carried: row.get(5)?,
            total_focus_min: row.get(6)?,
            session1_focus: row.get(7)?,
            session2_focus: row.get(8)?,
            ai_reflection: row.get(9)?,
            markdown_export: row.get(10)?,
            generated_at: row.get(11)?,
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
                total_focus_min, session1_focus, session2_focus, ai_reflection, markdown_export, generated_at
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
                session1_focus: row.get(7)?,
                session2_focus: row.get(8)?,
                ai_reflection: row.get(9)?,
                markdown_export: row.get(10)?,
                generated_at: row.get(11)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(reports)
}

// ---- BULK READ QUERIES (for backup) ----

pub fn get_all_tasks(conn: &Connection) -> Result<Vec<Task>> {
    let mut stmt = conn.prepare(
        "SELECT id, date, session_slot, title, notes, task_type, priority, status,
                estimated_min, actual_min, prompt_used, prompt_result, carried_from,
                position, created_at, updated_at, completed_at, project_id,
                worktree_path, worktree_branch, worktree_status
         FROM tasks ORDER BY created_at",
    )?;
    let tasks = stmt
        .query_map([], |row| {
            Ok(Task {
                id: row.get(0)?,
                date: row.get(1)?,
                session_slot: row.get(2)?,
                title: row.get(3)?,
                notes: row.get(4)?,
                task_type: row.get(5)?,
                priority: row.get(6)?,
                status: row.get(7)?,
                estimated_min: row.get(8)?,
                actual_min: row.get(9)?,
                prompt_used: row.get(10)?,
                prompt_result: row.get(11)?,
                carried_from: row.get(12)?,
                position: row.get(13)?,
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
                completed_at: row.get(16)?,
                project_id: row.get(17)?,
                worktree_path: row.get(18)?,
                worktree_branch: row.get(19)?,
                worktree_status: row.get(20)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(tasks)
}

pub fn get_all_focus_sessions(conn: &Connection) -> Result<Vec<FocusSession>> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, date, started_at, ended_at, duration_min, notes
         FROM focus_sessions ORDER BY started_at",
    )?;
    let sessions = stmt
        .query_map([], |row| {
            Ok(FocusSession {
                id: row.get(0)?,
                task_id: row.get(1)?,
                date: row.get(2)?,
                started_at: row.get(3)?,
                ended_at: row.get(4)?,
                duration_min: row.get(5)?,
                notes: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(sessions)
}

pub fn get_all_daily_sessions(conn: &Connection) -> Result<Vec<DailySession>> {
    let mut stmt = conn.prepare(
        "SELECT id, date, session_slot, started_at, tasks_planned, tasks_completed,
                tasks_skipped, focus_minutes, notes
         FROM daily_sessions ORDER BY date, session_slot",
    )?;
    let sessions = stmt
        .query_map([], |row| {
            Ok(DailySession {
                id: row.get(0)?,
                date: row.get(1)?,
                session_slot: row.get(2)?,
                started_at: row.get(3)?,
                tasks_planned: row.get(4)?,
                tasks_completed: row.get(5)?,
                tasks_skipped: row.get(6)?,
                focus_minutes: row.get(7)?,
                notes: row.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(sessions)
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
                total_focus_min, session1_focus, session2_focus, ai_reflection, markdown_export, generated_at
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
                session1_focus: row.get(7)?,
                session2_focus: row.get(8)?,
                ai_reflection: row.get(9)?,
                markdown_export: row.get(10)?,
                generated_at: row.get(11)?,
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
    let mut stmt =
        conn.prepare("SELECT id, name, path, prompt, created_at FROM projects ORDER BY name")?;
    let projects = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                prompt: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(projects)
}

pub fn get_project_prompt(conn: &Connection, project_id: &str) -> Result<Option<String>> {
    let result = conn.query_row(
        "SELECT prompt FROM projects WHERE id = ?1",
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
        "UPDATE projects SET prompt = ?1 WHERE id = ?2",
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
    // Nullify project_id on tasks before deleting
    conn.execute(
        "UPDATE tasks SET project_id = NULL WHERE project_id = ?1",
        params![id],
    )?;
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
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
        let id = create_task(
            &conn,
            "2026-03-22",
            1,
            "Test task",
            "code",
            2,
            Some(30),
            None,
        )
        .unwrap();
        let tasks = get_tasks_by_date(&conn, "2026-03-22").unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, id);
        assert_eq!(tasks[0].title, "Test task");
        assert_eq!(tasks[0].status, "pending");
        assert_eq!(tasks[0].worktree_status, None);
    }

    #[test]
    fn test_update_task_status() {
        let conn = setup_test_db();
        let id = create_task(&conn, "2026-03-22", 1, "Test", "code", 2, None, None).unwrap();
        update_task_status(&conn, &id, "done").unwrap();
        let tasks = get_tasks_by_date(&conn, "2026-03-22").unwrap();
        assert_eq!(tasks[0].status, "done");
        assert!(tasks[0].completed_at.is_some());
    }

    #[test]
    fn test_carry_forward() {
        let conn = setup_test_db();
        let id = create_task(&conn, "2026-03-22", 1, "Carry me", "code", 1, None, None).unwrap();
        let _new_id = carry_task_forward(&conn, &id, "2026-03-23", 1).unwrap();
        let tomorrow_tasks = get_tasks_by_date(&conn, "2026-03-23").unwrap();
        assert_eq!(tomorrow_tasks.len(), 1);
        assert_eq!(tomorrow_tasks[0].carried_from, Some(id.clone()));
        let today_tasks = get_tasks_by_date(&conn, "2026-03-22").unwrap();
        assert_eq!(today_tasks[0].status, "carried_over");
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
        let id1 = create_task(&conn, "2026-03-22", 1, "Task 1", "code", 1, Some(30), None).unwrap();
        let id2 = create_task(&conn, "2026-03-22", 1, "Task 2", "code", 2, Some(20), None).unwrap();
        update_task_status(&conn, &id1, "done").unwrap();
        update_task_status(&conn, &id2, "skipped").unwrap();
        let report = generate_report(&conn, "2026-03-22").unwrap();
        assert_eq!(report.tasks_completed, 1);
        assert_eq!(report.tasks_skipped, 1);
    }

    #[test]
    fn test_focus_session() {
        let conn = setup_test_db();
        let task_id =
            create_task(&conn, "2026-03-22", 1, "Focus task", "code", 1, None, None).unwrap();
        let session_id = start_focus_session(&conn, &task_id, "2026-03-22").unwrap();
        let active = get_active_focus_session(&conn, &task_id).unwrap();
        assert!(active.is_some());
        // Duration may be 0 since no real time passes; just verify it ends cleanly
        let duration = end_focus_session(&conn, &session_id, "Notes here").unwrap();
        assert!(duration >= 0);
        let active_after = get_active_focus_session(&conn, &task_id).unwrap();
        assert!(active_after.is_none());
    }

    #[test]
    fn test_reorder_tasks() {
        let conn = setup_test_db();
        let id1 = create_task(&conn, "2026-03-22", 1, "Task A", "code", 1, None, None).unwrap();
        let id2 = create_task(&conn, "2026-03-22", 1, "Task B", "code", 2, None, None).unwrap();
        reorder_tasks(&conn, &[id2.clone(), id1.clone()]).unwrap();
        let tasks = get_tasks_by_date(&conn, "2026-03-22").unwrap();
        // id2 should be position 0
        let t2 = tasks.iter().find(|t| t.id == id2).unwrap();
        assert_eq!(t2.position, 0);
    }

    #[test]
    fn test_set_task_worktree_metadata() {
        let conn = setup_test_db();
        let id = create_task(
            &conn,
            "2026-03-22",
            1,
            "Worktree task",
            "code",
            2,
            None,
            None,
        )
        .unwrap();

        set_task_worktree_metadata(
            &conn,
            &id,
            Some("/tmp/daily-planner-worktrees/abc"),
            Some("task/worktree-task-abc"),
            Some("active"),
        )
        .unwrap();

        let task = get_tasks_by_date(&conn, "2026-03-22").unwrap().remove(0);
        assert_eq!(
            task.worktree_path.as_deref(),
            Some("/tmp/daily-planner-worktrees/abc")
        );
        assert_eq!(
            task.worktree_branch.as_deref(),
            Some("task/worktree-task-abc")
        );
        assert_eq!(task.worktree_status.as_deref(), Some("active"));
    }
}
