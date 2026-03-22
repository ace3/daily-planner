use crate::db::{queries, DbConnection};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
pub struct AppSettings {
    pub timezone_offset: i64,
    pub session1_kickstart: String,
    pub planning_end: String,
    pub session2_start: String,
    pub warn_before_min: i64,
    pub autostart: bool,
    pub claude_model: String,
    pub ai_provider: String,
    pub theme: String,
    pub work_days: Vec<i64>,
    pub show_in_tray: bool,
    pub pomodoro_work_min: i64,
    pub pomodoro_break_min: i64,
}

fn normalize_ai_provider(value: Option<&String>) -> String {
    match value.map(String::as_str) {
        Some("copilot_cli") => "copilot_cli".to_string(),
        Some("opencode") | Some("codex") => "opencode".to_string(),
        _ => "claude".to_string(),
    }
}

#[tauri::command]
pub fn get_settings(db: State<'_, DbConnection>) -> Result<AppSettings, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let map = queries::get_all_settings(&conn).map_err(|e| e.to_string())?;

    let work_days: Vec<i64> = serde_json::from_str(
        map.get("work_days")
            .map(|s| s.as_str())
            .unwrap_or("[1,2,3,4,5]"),
    )
    .unwrap_or_else(|_| vec![1, 2, 3, 4, 5]);

    Ok(AppSettings {
        timezone_offset: map
            .get("timezone_offset")
            .and_then(|v| v.parse().ok())
            .unwrap_or(7),
        session1_kickstart: map
            .get("session1_kickstart")
            .cloned()
            .unwrap_or_else(|| "09:00".to_string()),
        planning_end: map
            .get("planning_end")
            .cloned()
            .unwrap_or_else(|| "11:00".to_string()),
        session2_start: map
            .get("session2_start")
            .cloned()
            .unwrap_or_else(|| "14:00".to_string()),
        warn_before_min: map
            .get("warn_before_min")
            .and_then(|v| v.parse().ok())
            .unwrap_or(15),
        autostart: map.get("autostart").map(|v| v == "true").unwrap_or(false),
        claude_model: map
            .get("claude_model")
            .cloned()
            .unwrap_or_else(|| "claude-sonnet-4-6".to_string()),
        ai_provider: normalize_ai_provider(map.get("ai_provider")),
        theme: map
            .get("theme")
            .cloned()
            .unwrap_or_else(|| "dark".to_string()),
        work_days,
        show_in_tray: map.get("show_in_tray").map(|v| v == "true").unwrap_or(true),
        pomodoro_work_min: map
            .get("pomodoro_work_min")
            .and_then(|v| v.parse().ok())
            .unwrap_or(25),
        pomodoro_break_min: map
            .get("pomodoro_break_min")
            .and_then(|v| v.parse().ok())
            .unwrap_or(5),
    })
}

#[tauri::command]
pub fn get_setting(key: String, db: State<'_, DbConnection>) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    match queries::get_setting(&conn, &key) {
        Ok(v) if v.is_empty() => Ok(None),
        Ok(v) => Ok(Some(v)),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub fn set_setting(key: String, value: String, db: State<'_, DbConnection>) -> Result<(), String> {
    if key == "ai_provider"
        && value != "claude"
        && value != "opencode"
        && value != "codex"
        && value != "copilot_cli"
    {
        return Err(
            "Invalid ai_provider. Allowed values: claude, opencode, codex, copilot_cli".to_string(),
        );
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::set_setting(&conn, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_global_prompt(db: State<'_, DbConnection>) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    match queries::get_setting(&conn, "global_prompt") {
        Ok(v) if v.is_empty() => Ok(None),
        Ok(v) => Ok(Some(v)),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub fn set_global_prompt(prompt: String, db: State<'_, DbConnection>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::set_setting(&conn, "global_prompt", &prompt).map_err(|e| e.to_string())
}
