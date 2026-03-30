use crate::db::{queries, DbConnection};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::State;

#[tauri::command]
pub fn get_projects(db: State<'_, DbConnection>) -> Result<Vec<queries::Project>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::get_projects(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_trashed_projects(db: State<'_, DbConnection>) -> Result<Vec<queries::Project>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::get_trashed_projects(&conn).map_err(|e| e.to_string())
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
pub fn restore_project(id: String, db: State<'_, DbConnection>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::restore_project(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn hard_delete_project(id: String, db: State<'_, DbConnection>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::hard_delete_project(&conn, &id).map_err(|e| e.to_string())
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectPathValidation {
    pub exists: bool,
    pub is_directory: bool,
    pub normalized_path: String,
}

fn expand_tilde(path: &str) -> PathBuf {
    if let Some(stripped) = path.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(stripped);
        }
    }
    PathBuf::from(path)
}

fn normalize_path(path: &Path) -> String {
    if path.exists() {
        return path
            .canonicalize()
            .unwrap_or_else(|_| path.to_path_buf())
            .to_string_lossy()
            .into_owned();
    }

    if path.is_absolute() {
        return path.to_string_lossy().into_owned();
    }

    std::env::current_dir()
        .map(|cwd| cwd.join(path))
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

pub fn validate_project_path_internal(path: &str) -> ProjectPathValidation {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return ProjectPathValidation {
            exists: false,
            is_directory: false,
            normalized_path: String::new(),
        };
    }

    let expanded = expand_tilde(trimmed);
    ProjectPathValidation {
        exists: expanded.exists(),
        is_directory: expanded.is_dir(),
        normalized_path: normalize_path(&expanded),
    }
}

#[tauri::command]
pub fn validate_project_path(path: String) -> Result<ProjectPathValidation, String> {
    Ok(validate_project_path_internal(&path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp_path(prefix: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "{}-{}",
            prefix,
            uuid::Uuid::new_v4().to_string().replace('-', "")
        ))
    }

    #[test]
    fn validate_project_path_returns_error_for_empty_input() {
        let result = validate_project_path("   ".to_string()).expect("validate call");
        assert!(!result.exists);
        assert!(!result.is_directory);
        assert_eq!(result.normalized_path, "");
    }

    #[test]
    fn validate_project_path_detects_existing_directory_and_normalizes() {
        let dir = tmp_path("project-path-dir");
        fs::create_dir_all(&dir).expect("create dir");

        let result = validate_project_path(dir.to_string_lossy().to_string()).expect("validate call");
        assert!(result.exists);
        assert!(result.is_directory);
        assert!(!result.normalized_path.is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_project_path_detects_missing_path() {
        let path = tmp_path("project-path-missing");
        let result = validate_project_path(path.to_string_lossy().to_string()).expect("validate call");
        assert!(!result.exists);
        assert!(!result.is_directory);
    }

    #[test]
    fn validate_project_path_detects_file_not_directory() {
        let file = tmp_path("project-path-file");
        fs::write(&file, b"hello").expect("write file");

        let result = validate_project_path(file.to_string_lossy().to_string()).expect("validate call");
        assert!(result.exists);
        assert!(!result.is_directory);

        let _ = fs::remove_file(&file);
    }
}
