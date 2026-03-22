use crate::db::{queries, DbConnection};
use serde::Deserialize;
use tauri::State;

#[derive(Deserialize)]
pub struct CreateTaskInput {
    pub date: String,
    pub session_slot: i64,
    pub title: String,
    pub task_type: Option<String>,
    pub priority: Option<i64>,
    pub estimated_min: Option<i64>,
    pub project_id: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateTaskInput {
    pub id: String,
    pub title: Option<String>,
    pub notes: Option<String>,
    pub task_type: Option<String>,
    pub priority: Option<i64>,
    pub estimated_min: Option<i64>,
    pub session_slot: Option<i64>,
    pub project_id: Option<String>,
    pub clear_project: Option<bool>,
}

#[tauri::command]
pub fn get_tasks(date: String, db: State<'_, DbConnection>) -> Result<Vec<queries::Task>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::get_tasks_by_date(&conn, &date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_task(input: CreateTaskInput, db: State<'_, DbConnection>) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::create_task(
        &conn,
        &input.date,
        input.session_slot,
        &input.title,
        &input.task_type.unwrap_or_else(|| "code".to_string()),
        input.priority.unwrap_or(2),
        input.estimated_min,
        input.project_id.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_task(input: UpdateTaskInput, db: State<'_, DbConnection>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::update_task(
        &conn,
        &input.id,
        input.title.as_deref(),
        input.notes.as_deref(),
        input.task_type.as_deref(),
        input.priority,
        input.estimated_min,
        input.session_slot,
        input.project_id.as_deref(),
        input.clear_project.unwrap_or(false),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_task_status(
    id: String,
    status: String,
    db: State<'_, DbConnection>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::update_task_status(&conn, &id, &status).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_task(id: String, db: State<'_, DbConnection>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::delete_task(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn carry_task_forward(
    id: String,
    tomorrow_date: String,
    session_slot: i64,
    db: State<'_, DbConnection>,
) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::carry_task_forward(&conn, &id, &tomorrow_date, session_slot).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_tasks(task_ids: Vec<String>, db: State<'_, DbConnection>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::reorder_tasks(&conn, &task_ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_prompt_result(
    id: String,
    prompt_used: String,
    prompt_result: String,
    db: State<'_, DbConnection>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::save_prompt_result(&conn, &id, &prompt_used, &prompt_result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn start_focus_session(
    task_id: String,
    date: String,
    db: State<'_, DbConnection>,
) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::start_focus_session(&conn, &task_id, &date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn end_focus_session(
    session_id: String,
    notes: String,
    db: State<'_, DbConnection>,
) -> Result<i64, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::end_focus_session(&conn, &session_id, &notes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_prompt_templates(
    db: State<'_, DbConnection>,
) -> Result<Vec<queries::PromptTemplateItem>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::list_prompt_templates(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_prompt_template(name: String, content: String, db: State<'_, DbConnection>) -> Result<queries::PromptTemplateItem, String> {
    let trimmed_name = name.trim();
    let trimmed_content = content.trim();
    if trimmed_name.is_empty() {
        return Err("Template name is required".to_string());
    }
    if trimmed_content.is_empty() {
        return Err("Template content is required".to_string());
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::create_prompt_template(&conn, trimmed_name, trimmed_content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_prompt_template(id: String, name: String, content: String, db: State<'_, DbConnection>) -> Result<queries::PromptTemplateItem, String> {
    let trimmed_id = id.trim();
    let trimmed_name = name.trim();
    let trimmed_content = content.trim();
    if trimmed_id.is_empty() {
        return Err("Template id is required".to_string());
    }
    if trimmed_name.is_empty() {
        return Err("Template name is required".to_string());
    }
    if trimmed_content.is_empty() {
        return Err("Template content is required".to_string());
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::update_prompt_template(&conn, trimmed_id, trimmed_name, trimmed_content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_prompt_template(id: String, db: State<'_, DbConnection>) -> Result<bool, String> {
    let trimmed_id = id.trim();
    if trimmed_id.is_empty() {
        return Err("Template id is required".to_string());
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::delete_prompt_template(&conn, trimmed_id).map_err(|e| e.to_string())
}
