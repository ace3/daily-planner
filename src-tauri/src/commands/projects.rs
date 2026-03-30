use crate::db::{queries, DbConnection};
use serde::Deserialize;
use serde::Serialize;
use std::path::Path;
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

#[derive(Serialize)]
pub struct ProjectPathCheckResult {
    pub is_valid: bool,
    pub normalized_path: String,
    pub exists: bool,
    pub is_directory: bool,
    pub message: String,
}

fn normalize_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed == "/" {
        return trimmed.to_string();
    }
    trimmed.trim_end_matches(['/', '\\']).to_string()
}

fn validate_project_name(name: &str) -> Result<String, String> {
    let normalized = name.trim();
    if normalized.is_empty() {
        return Err("Project name is required".to_string());
    }
    Ok(normalized.to_string())
}

fn validate_project_path_internal(path: &str) -> ProjectPathCheckResult {
    let normalized = normalize_path(path);
    if normalized.is_empty() {
        return ProjectPathCheckResult {
            is_valid: false,
            normalized_path: normalized,
            exists: false,
            is_directory: false,
            message: "Path is required".to_string(),
        };
    }

    if normalized.chars().any(|c| c.is_control()) {
        return ProjectPathCheckResult {
            is_valid: false,
            normalized_path: normalized,
            exists: false,
            is_directory: false,
            message: "Path contains invalid control characters".to_string(),
        };
    }

    let path_buf = Path::new(&normalized);
    let exists = path_buf.exists();
    let is_directory = exists && path_buf.is_dir();

    if !exists {
        return ProjectPathCheckResult {
            is_valid: false,
            normalized_path: normalized,
            exists,
            is_directory,
            message: "Path does not exist".to_string(),
        };
    }

    if !is_directory {
        return ProjectPathCheckResult {
            is_valid: false,
            normalized_path: normalized,
            exists,
            is_directory,
            message: "Path exists but is not a directory".to_string(),
        };
    }

    let canonical = std::fs::canonicalize(path_buf)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| normalized.clone());

    ProjectPathCheckResult {
        is_valid: true,
        normalized_path: canonical,
        exists: true,
        is_directory: true,
        message: "Path is valid".to_string(),
    }
}

#[tauri::command]
pub fn check_project_path(path: String) -> Result<ProjectPathCheckResult, String> {
    Ok(validate_project_path_internal(&path))
}

#[tauri::command]
pub fn create_project(
    input: CreateProjectInput,
    db: State<'_, DbConnection>,
) -> Result<String, String> {
    let name = validate_project_name(&input.name)?;
    let path_check = validate_project_path_internal(&input.path);
    if !path_check.is_valid {
        return Err(path_check.message);
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::create_project(&conn, &name, &path_check.normalized_path).map_err(|e| e.to_string())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_project_path_rejects_empty() {
        let result = validate_project_path_internal("   ");
        assert!(!result.is_valid);
        assert_eq!(result.message, "Path is required");
    }

    #[test]
    fn validate_project_path_rejects_nonexistent() {
        let result = validate_project_path_internal("/definitely/not/a/real/path");
        assert!(!result.is_valid);
        assert_eq!(result.message, "Path does not exist");
    }

    #[test]
    fn validate_project_path_accepts_existing_directory() {
        let tmp = std::env::temp_dir();
        let tmp_str = tmp.to_string_lossy().to_string();
        let result = validate_project_path_internal(&tmp_str);
        assert!(result.is_valid);
        assert!(result.exists);
        assert!(result.is_directory);
    }
}
