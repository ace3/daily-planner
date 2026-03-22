use tauri::State;
use crate::db::{DbConnection, queries};

#[tauri::command]
pub fn generate_report(date: String, db: State<'_, DbConnection>) -> Result<queries::DailyReport, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::generate_report(&conn, &date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_report(date: String, db: State<'_, DbConnection>) -> Result<Option<queries::DailyReport>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::get_report(&conn, &date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_reports_range(from: String, to: String, db: State<'_, DbConnection>) -> Result<Vec<queries::DailyReport>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::get_reports_range(&conn, &from, &to).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_ai_reflection(date: String, reflection: String, db: State<'_, DbConnection>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::save_ai_reflection(&conn, &date, &reflection).map_err(|e| e.to_string())
}
