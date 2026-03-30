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
    pub default_model_codex: String,
    pub default_model_claude: String,
    pub default_model_opencode: String,
    pub default_model_copilot: String,
    pub active_ai_provider: String,
    pub ai_provider: String,
    pub theme: String,
    pub work_days: Vec<i64>,
    pub show_in_tray: bool,
    pub telegram_bot_token: Option<String>,
    pub telegram_channel_id: Option<String>,
    pub tunnel_name: Option<String>,
    pub tunnel_hostname: Option<String>,
}

fn normalize_ai_provider(value: Option<&String>) -> String {
    match value.map(String::as_str) {
        Some("copilot_cli") => "copilot_cli".to_string(),
        Some("opencode") | Some("codex") => "opencode".to_string(),
        _ => "claude".to_string(),
    }
}

fn normalize_active_ai_provider(value: Option<&String>) -> Option<String> {
    match value.map(String::as_str) {
        Some("claude") => Some("claude".to_string()),
        Some("codex") => Some("codex".to_string()),
        Some("opencode") => Some("opencode".to_string()),
        Some("copilot") | Some("copilot_cli") => Some("copilot".to_string()),
        _ => None,
    }
}

fn normalize_copilot_model_identifier(value: &str) -> String {
    match value.trim() {
        "claude-sonnet-4-5" => "claude-sonnet-4.5".to_string(),
        "claude-opus-4-5" => "claude-opus-4.5".to_string(),
        "claude-haiku-4-5" => "claude-haiku-4.5".to_string(),
        other => other.to_string(),
    }
}

fn resolve_default_active_ai_provider(
    configured: Option<String>,
    detected: &[crate::commands::ai_providers::AiProvider],
) -> String {
    if let Some(value) = configured {
        return value;
    }

    if detected.iter().any(|provider| provider.id == "claude") {
        return "claude".to_string();
    }

    detected
        .first()
        .map(|provider| provider.id.clone())
        .unwrap_or_else(|| "claude".to_string())
}

#[tauri::command]
pub fn get_settings(db: State<'_, DbConnection>) -> Result<AppSettings, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let map = queries::get_all_settings(&conn).map_err(|e| e.to_string())?;
    let detected_providers = crate::commands::ai_providers::detect_available_providers();
    let active_ai_provider = resolve_default_active_ai_provider(
        normalize_active_ai_provider(
            map.get("active_ai_provider").or_else(|| map.get("ai_provider")),
        ),
        &detected_providers,
    );
    let should_persist_active_provider = map
        .get("active_ai_provider")
        .map(|value| value.trim().is_empty())
        .unwrap_or(true);
    if should_persist_active_provider {
        queries::set_setting(&conn, "active_ai_provider", &active_ai_provider)
            .map_err(|e| e.to_string())?;
    }

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
        default_model_codex: map
            .get("default_model_codex")
            .cloned()
            .unwrap_or_else(|| "gpt-5.3-codex".to_string()),
        default_model_claude: map
            .get("default_model_claude")
            .cloned()
            .unwrap_or_else(|| {
                map.get("claude_model")
                    .cloned()
                    .unwrap_or_else(|| "claude-sonnet-4-6".to_string())
            }),
        default_model_opencode: map
            .get("default_model_opencode")
            .cloned()
            .unwrap_or_else(|| "gpt-4.1".to_string()),
        default_model_copilot: map
            .get("default_model_copilot")
            .cloned()
            .map(|v| normalize_copilot_model_identifier(&v))
            .unwrap_or_else(|| "gpt-4.1".to_string()),
        active_ai_provider,
        ai_provider: normalize_ai_provider(map.get("ai_provider")),
        theme: map
            .get("theme")
            .cloned()
            .unwrap_or_else(|| "dark".to_string()),
        work_days,
        show_in_tray: map.get("show_in_tray").map(|v| v == "true").unwrap_or(true),
        telegram_bot_token: map.get("telegram_bot_token").cloned().filter(|v| !v.trim().is_empty()),
        telegram_channel_id: map.get("telegram_channel_id").cloned().filter(|v| !v.trim().is_empty()),
        tunnel_name: map.get("tunnel_name").cloned().filter(|v| !v.trim().is_empty()),
        tunnel_hostname: map.get("tunnel_hostname").cloned().filter(|v| !v.trim().is_empty()),
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
    if key == "active_ai_provider"
        && value != "claude"
        && value != "opencode"
        && value != "codex"
        && value != "copilot"
    {
        return Err(
            "Invalid active_ai_provider. Allowed values: claude, opencode, codex, copilot"
                .to_string(),
        );
    }
    if key.starts_with("default_model_") && value.trim().is_empty() {
        return Err("Default model value cannot be empty.".to_string());
    }
    let persisted_value = if key == "default_model_copilot" {
        normalize_copilot_model_identifier(&value)
    } else {
        value
    };

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::set_setting(&conn, &key, &persisted_value).map_err(|e| e.to_string())
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
