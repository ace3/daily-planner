use crate::db::queries::{DailyReport, PromptTemplate, SettingRow, Task};
use crate::db::{queries, DbConnection};
use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize, Deserialize)]
pub struct BackupData {
    pub version: u32,
    pub created_at: String,
    pub tasks: Vec<Task>,
    pub prompt_templates: Vec<PromptTemplate>,
    pub daily_reports: Vec<DailyReport>,
    pub settings: Vec<SettingRow>,
}

#[tauri::command]
pub fn backup_data(app: tauri::AppHandle, db: State<'_, DbConnection>) -> Result<String, String> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    let file_path = app
        .dialog()
        .file()
        .add_filter("JSON Backup", &["json"])
        .set_file_name(&format!("daily-planner-backup-{}.json", today))
        .blocking_save_file();

    let path = match file_path {
        None => return Ok("cancelled".to_string()),
        Some(p) => match p {
            tauri_plugin_dialog::FilePath::Path(pb) => pb,
            _ => return Err("Unsupported path type".to_string()),
        },
    };

    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let backup = BackupData {
        version: 1,
        created_at: chrono::Utc::now().to_rfc3339(),
        tasks: queries::get_all_tasks(&conn).map_err(|e| e.to_string())?,
        prompt_templates: queries::get_all_prompt_templates(&conn).map_err(|e| e.to_string())?,
        daily_reports: queries::get_all_daily_reports(&conn).map_err(|e| e.to_string())?,
        settings: queries::get_all_settings_non_sensitive(&conn).map_err(|e| e.to_string())?,
    };

    let json = serde_json::to_string_pretty(&backup).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn restore_data(app: tauri::AppHandle, db: State<'_, DbConnection>) -> Result<String, String> {
    let file_path = app
        .dialog()
        .file()
        .add_filter("JSON Backup", &["json"])
        .blocking_pick_file();

    let path = match file_path {
        None => return Ok("cancelled".to_string()),
        Some(p) => match p {
            tauri_plugin_dialog::FilePath::Path(pb) => pb,
            _ => return Err("Unsupported path type".to_string()),
        },
    };

    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))?;

    let backup: BackupData =
        serde_json::from_str(&content).map_err(|e| format!("Corrupted backup: {}", e))?;

    if backup.version > 1 {
        return Err("Backup created by a newer app version".to_string());
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Delete in FK-safe order (focus_sessions refs tasks via CASCADE, but explicit is clearer)
    conn.execute("DELETE FROM focus_sessions", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tasks", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM daily_sessions", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM daily_reports", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM prompt_templates WHERE is_builtin = 0", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM settings WHERE key != 'claude_token_enc'", [])
        .map_err(|e| e.to_string())?;

    for task in &backup.tasks {
        conn.execute(
            "INSERT OR REPLACE INTO tasks
             (id, title, notes, task_type, priority, status,
              estimated_min, actual_min, raw_prompt, improved_prompt, prompt_output,
              job_status, job_id, provider, carried_from, position,
              created_at, updated_at, completed_at, project_id,
              worktree_path, worktree_branch, worktree_status)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23)",
            rusqlite::params![
                task.id, task.title, task.notes, task.task_type, task.priority, task.status,
                task.estimated_min, task.actual_min, task.raw_prompt, task.improved_prompt,
                task.prompt_output, task.job_status, task.job_id, task.provider,
                task.carried_from, task.position,
                task.created_at, task.updated_at, task.completed_at, task.project_id,
                task.worktree_path, task.worktree_branch, task.worktree_status
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    for dr in &backup.daily_reports {
        conn.execute(
            "INSERT OR REPLACE INTO daily_reports
             (id, date, tasks_planned, tasks_completed, tasks_skipped, tasks_carried,
              total_focus_min, ai_reflection, markdown_export, generated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            rusqlite::params![
                dr.id, dr.date, dr.tasks_planned, dr.tasks_completed, dr.tasks_skipped,
                dr.tasks_carried, dr.total_focus_min,
                dr.ai_reflection, dr.markdown_export, dr.generated_at
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    // Only restore non-builtin templates (builtin ones are seeded by migration)
    for pt in &backup.prompt_templates {
        if !pt.is_builtin {
            conn.execute(
                "INSERT OR REPLACE INTO prompt_templates
                 (id, name, category, template, variables, is_builtin, use_count, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                rusqlite::params![
                    pt.id,
                    pt.name,
                    pt.category,
                    pt.template,
                    pt.variables,
                    0i64,
                    pt.use_count,
                    pt.created_at
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    for setting in &backup.settings {
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![setting.key, setting.value],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok("ok".to_string())
}

#[tauri::command]
pub fn reset_app_data(
    keep_settings: bool,
    keep_builtin_templates: bool,
    db: State<'_, DbConnection>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM focus_sessions", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tasks", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM daily_sessions", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM daily_reports", [])
        .map_err(|e| e.to_string())?;

    if keep_builtin_templates {
        conn.execute("DELETE FROM prompt_templates WHERE is_builtin = 0", [])
            .map_err(|e| e.to_string())?;
    } else {
        conn.execute("DELETE FROM prompt_templates", [])
            .map_err(|e| e.to_string())?;
    }

    if !keep_settings {
        conn.execute("DELETE FROM settings WHERE key != 'claude_token_enc'", [])
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}
