use crate::db::{queries, DbConnection};
use serde::Deserialize;
use tauri::State;

#[tauri::command]
pub fn get_projects(db: State<'_, DbConnection>) -> Result<Vec<queries::Project>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::get_projects(&conn).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
pub struct CreateProjectInput {
    pub name: String,
    pub path: String,
}

#[tauri::command]
pub fn create_project(
    input: CreateProjectInput,
    db: State<'_, DbConnection>,
) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::create_project(&conn, &input.name, &input.path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_project(id: String, db: State<'_, DbConnection>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::delete_project(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_project_prompt(
    id: String,
    db: State<'_, DbConnection>,
) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::get_project_prompt(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_project_prompt(
    id: String,
    prompt: String,
    db: State<'_, DbConnection>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::set_project_prompt(&conn, &id, &prompt).map_err(|e| e.to_string())
}
