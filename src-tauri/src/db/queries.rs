use rusqlite::{Connection, Result, params};
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

// ---- TASK QUERIES ----

pub fn get_tasks_by_date(conn: &Connection, date: &str) -> Result<Vec<Task>> {
    let mut stmt = conn.prepare(
        "SELECT id, date, session_slot, title, notes, task_type, priority, status,
                estimated_min, actual_min, prompt_used, prompt_result, carried_from,
                position, created_at, updated_at, completed_at
         FROM tasks WHERE date = ?1 ORDER BY session_slot, position, created_at"
    )?;
    let tasks = stmt.query_map(params![date], |row| {
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
        })
    })?.collect::<Result<Vec<_>>>()?;
    Ok(tasks)
}

pub fn create_task(conn: &Connection, date: &str, session_slot: i64, title: &str,
                   task_type: &str, priority: i64, estimated_min: Option<i64>) -> Result<String> {
    let id = uuid::Uuid::new_v4().to_string().replace("-", "");
    let max_pos: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position), -1) FROM tasks WHERE date = ?1 AND session_slot = ?2",
        params![date, session_slot],
        |row| row.get(0),
    ).unwrap_or(-1);

    conn.execute(
        "INSERT INTO tasks (id, date, session_slot, title, task_type, priority, estimated_min, position)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, date, session_slot, title, task_type, priority, estimated_min, max_pos + 1],
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

pub fn update_task(conn: &Connection, id: &str, title: Option<&str>, notes: Option<&str>,
                   task_type: Option<&str>, priority: Option<i64>, estimated_min: Option<i64>,
                   session_slot: Option<i64>) -> Result<()> {
    if let Some(t) = title {
        conn.execute("UPDATE tasks SET title = ?1, updated_at = datetime('now') WHERE id = ?2", params![t, id])?;
    }
    if let Some(n) = notes {
        conn.execute("UPDATE tasks SET notes = ?1, updated_at = datetime('now') WHERE id = ?2", params![n, id])?;
    }
    if let Some(tt) = task_type {
        conn.execute("UPDATE tasks SET task_type = ?1, updated_at = datetime('now') WHERE id = ?2", params![tt, id])?;
    }
    if let Some(p) = priority {
        conn.execute("UPDATE tasks SET priority = ?1, updated_at = datetime('now') WHERE id = ?2", params![p, id])?;
    }
    if let Some(e) = estimated_min {
        conn.execute("UPDATE tasks SET estimated_min = ?1, updated_at = datetime('now') WHERE id = ?2", params![e, id])?;
    }
    if let Some(s) = session_slot {
        conn.execute("UPDATE tasks SET session_slot = ?1, updated_at = datetime('now') WHERE id = ?2", params![s, id])?;
    }
    Ok(())
}

pub fn delete_task(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn carry_task_forward(conn: &Connection, id: &str, tomorrow_date: &str, session_slot: i64) -> Result<String> {
    let task: Task = conn.query_row(
        "SELECT id, date, session_slot, title, notes, task_type, priority, status,
                estimated_min, actual_min, prompt_used, prompt_result, carried_from,
                position, created_at, updated_at, completed_at
         FROM tasks WHERE id = ?1", params![id],
        |row| Ok(Task {
            id: row.get(0)?, date: row.get(1)?, session_slot: row.get(2)?,
            title: row.get(3)?, notes: row.get(4)?, task_type: row.get(5)?,
            priority: row.get(6)?, status: row.get(7)?, estimated_min: row.get(8)?,
            actual_min: row.get(9)?, prompt_used: row.get(10)?, prompt_result: row.get(11)?,
            carried_from: row.get(12)?, position: row.get(13)?, created_at: row.get(14)?,
            updated_at: row.get(15)?, completed_at: row.get(16)?,
        }),
    )?;

    let new_id = uuid::Uuid::new_v4().to_string().replace("-", "");
    conn.execute(
        "INSERT INTO tasks (id, date, session_slot, title, notes, task_type, priority, estimated_min, carried_from)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![new_id, tomorrow_date, session_slot, task.title, task.notes,
                task.task_type, task.priority, task.estimated_min, id],
    )?;
    conn.execute(
        "UPDATE tasks SET status = 'carried_over', updated_at = datetime('now') WHERE id = ?1",
        params![id],
    )?;
    Ok(new_id)
}

pub fn save_prompt_result(conn: &Connection, id: &str, prompt_used: &str, prompt_result: &str) -> Result<()> {
    conn.execute(
        "UPDATE tasks SET prompt_used = ?1, prompt_result = ?2, updated_at = datetime('now') WHERE id = ?3",
        params![prompt_used, prompt_result, id],
    )?;
    Ok(())
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
    conn.execute("UPDATE tasks SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?1", params![task_id])?;
    Ok(id)
}

pub fn end_focus_session(conn: &Connection, session_id: &str, notes: &str) -> Result<i64> {
    let started_at: String = conn.query_row(
        "SELECT started_at FROM focus_sessions WHERE id = ?1", params![session_id],
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

pub fn get_prompt_templates(conn: &Connection) -> Result<Vec<PromptTemplate>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, category, template, variables, is_builtin, use_count, created_at FROM prompt_templates ORDER BY is_builtin DESC, use_count DESC, name"
    )?;
    let templates = stmt.query_map([], |row| {
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
    })?.collect::<Result<Vec<_>>>()?;
    Ok(templates)
}

pub fn increment_template_use(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("UPDATE prompt_templates SET use_count = use_count + 1 WHERE id = ?1", params![id])?;
    Ok(())
}

// ---- SETTINGS QUERIES ----

pub fn get_setting(conn: &Connection, key: &str) -> Result<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1", params![key],
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
        "SELECT COUNT(*) FROM tasks WHERE date = ?1 AND status != 'carried_over'", params![date],
        |row| row.get(0),
    ).unwrap_or(0);
    let tasks_completed: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tasks WHERE date = ?1 AND status = 'done'", params![date],
        |row| row.get(0),
    ).unwrap_or(0);
    let tasks_skipped: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tasks WHERE date = ?1 AND status = 'skipped'", params![date],
        |row| row.get(0),
    ).unwrap_or(0);
    let tasks_carried: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tasks WHERE date = ?1 AND status = 'carried_over'", params![date],
        |row| row.get(0),
    ).unwrap_or(0);
    let total_focus_min: i64 = conn.query_row(
        "SELECT COALESCE(SUM(duration_min), 0) FROM focus_sessions WHERE date = ?1 AND duration_min IS NOT NULL",
        params![date], |row| row.get(0),
    ).unwrap_or(0);

    // Estimate session splits from task data
    let session1_focus: i64 = conn.query_row(
        "SELECT COALESCE(SUM(fs.duration_min), 0) FROM focus_sessions fs
         JOIN tasks t ON t.id = fs.task_id
         WHERE fs.date = ?1 AND t.session_slot = 1 AND fs.duration_min IS NOT NULL",
        params![date], |row| row.get(0),
    ).unwrap_or(0);
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
    let reports = stmt.query_map(params![from, to], |row| {
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
    })?.collect::<Result<Vec<_>>>()?;
    Ok(reports)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use crate::db::migrations::run_migrations;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn test_create_and_get_task() {
        let conn = setup_test_db();
        let id = create_task(&conn, "2026-03-22", 1, "Test task", "code", 2, Some(30)).unwrap();
        let tasks = get_tasks_by_date(&conn, "2026-03-22").unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, id);
        assert_eq!(tasks[0].title, "Test task");
        assert_eq!(tasks[0].status, "pending");
    }

    #[test]
    fn test_update_task_status() {
        let conn = setup_test_db();
        let id = create_task(&conn, "2026-03-22", 1, "Test", "code", 2, None).unwrap();
        update_task_status(&conn, &id, "done").unwrap();
        let tasks = get_tasks_by_date(&conn, "2026-03-22").unwrap();
        assert_eq!(tasks[0].status, "done");
        assert!(tasks[0].completed_at.is_some());
    }

    #[test]
    fn test_carry_forward() {
        let conn = setup_test_db();
        let id = create_task(&conn, "2026-03-22", 1, "Carry me", "code", 1, None).unwrap();
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
        let id1 = create_task(&conn, "2026-03-22", 1, "Task 1", "code", 1, Some(30)).unwrap();
        let id2 = create_task(&conn, "2026-03-22", 1, "Task 2", "code", 2, Some(20)).unwrap();
        update_task_status(&conn, &id1, "done").unwrap();
        update_task_status(&conn, &id2, "skipped").unwrap();
        let report = generate_report(&conn, "2026-03-22").unwrap();
        assert_eq!(report.tasks_completed, 1);
        assert_eq!(report.tasks_skipped, 1);
    }

    #[test]
    fn test_focus_session() {
        let conn = setup_test_db();
        let task_id = create_task(&conn, "2026-03-22", 1, "Focus task", "code", 1, None).unwrap();
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
        let id1 = create_task(&conn, "2026-03-22", 1, "Task A", "code", 1, None).unwrap();
        let id2 = create_task(&conn, "2026-03-22", 1, "Task B", "code", 2, None).unwrap();
        reorder_tasks(&conn, &[id2.clone(), id1.clone()]).unwrap();
        let tasks = get_tasks_by_date(&conn, "2026-03-22").unwrap();
        // id2 should be position 0
        let t2 = tasks.iter().find(|t| t.id == id2).unwrap();
        assert_eq!(t2.position, 0);
    }
}
