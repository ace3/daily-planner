use tauri::State;
use serde::Serialize;
use crate::db::{DbConnection, queries};
use crate::crypto;

#[derive(Serialize)]
pub struct AppSettings {
    pub timezone_offset: i64,
    pub session1_kickstart: String,
    pub planning_end: String,
    pub session2_start: String,
    pub warn_before_min: i64,
    pub autostart: bool,
    pub claude_model: String,
    pub theme: String,
    pub work_days: Vec<i64>,
    pub show_in_tray: bool,
    pub pomodoro_work_min: i64,
    pub pomodoro_break_min: i64,
    pub has_claude_token: bool,
}

#[tauri::command]
pub fn get_settings(db: State<'_, DbConnection>) -> Result<AppSettings, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let map = queries::get_all_settings(&conn).map_err(|e| e.to_string())?;

    let work_days: Vec<i64> = serde_json::from_str(
        map.get("work_days").map(|s| s.as_str()).unwrap_or("[1,2,3,4,5]")
    ).unwrap_or_else(|_| vec![1, 2, 3, 4, 5]);

    Ok(AppSettings {
        timezone_offset: map.get("timezone_offset").and_then(|v| v.parse().ok()).unwrap_or(7),
        session1_kickstart: map.get("session1_kickstart").cloned().unwrap_or_else(|| "09:00".to_string()),
        planning_end: map.get("planning_end").cloned().unwrap_or_else(|| "11:00".to_string()),
        session2_start: map.get("session2_start").cloned().unwrap_or_else(|| "14:00".to_string()),
        warn_before_min: map.get("warn_before_min").and_then(|v| v.parse().ok()).unwrap_or(15),
        autostart: map.get("autostart").map(|v| v == "true").unwrap_or(false),
        claude_model: map.get("claude_model").cloned().unwrap_or_else(|| "claude-sonnet-4-6".to_string()),
        theme: map.get("theme").cloned().unwrap_or_else(|| "dark".to_string()),
        work_days,
        show_in_tray: map.get("show_in_tray").map(|v| v == "true").unwrap_or(true),
        pomodoro_work_min: map.get("pomodoro_work_min").and_then(|v| v.parse().ok()).unwrap_or(25),
        pomodoro_break_min: map.get("pomodoro_break_min").and_then(|v| v.parse().ok()).unwrap_or(5),
        has_claude_token: map.get("claude_token_enc").map(|v| !v.is_empty()).unwrap_or(false),
    })
}

#[tauri::command]
pub fn set_setting(key: String, value: String, db: State<'_, DbConnection>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::set_setting(&conn, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_claude_token(token: String, db: State<'_, DbConnection>) -> Result<(), String> {
    let encrypted = crypto::encrypt(&token).map_err(|e| e.to_string())?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::set_setting(&conn, "claude_token_enc", &encrypted).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_claude_token(db: State<'_, DbConnection>) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let encrypted = queries::get_setting(&conn, "claude_token_enc").map_err(|e| e.to_string())?;
    if encrypted.is_empty() {
        return Ok(String::new());
    }
    crypto::decrypt(&encrypted).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn detect_claude_token() -> Result<String, String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "~".to_string());
    let candidates = vec![
        format!("{}/.claude/.credentials.json", home),
        format!("{}/.claude/auth.json", home),
        format!("{}/.config/claude/auth.json", home),
    ];

    for path in candidates {
        if let Ok(content) = std::fs::read_to_string(&path) {
            // Try JSON parse
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(token) = json.get("token").and_then(|t| t.as_str()) {
                    return Ok(token.to_string());
                }
                if let Some(token) = json.get("access_token").and_then(|t| t.as_str()) {
                    return Ok(token.to_string());
                }
                if let Some(token) = json
                    .get("claudeAiOauth")
                    .and_then(|t| t.get("accessToken"))
                    .and_then(|t| t.as_str())
                {
                    return Ok(token.to_string());
                }
            }
            // Try raw token
            let trimmed = content.trim();
            if trimmed.len() > 20 && !trimmed.contains('\n') {
                return Ok(trimmed.to_string());
            }
        }
    }
    Err("Claude token not found. Please paste it manually.".to_string())
}
