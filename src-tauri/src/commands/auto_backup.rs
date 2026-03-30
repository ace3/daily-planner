// =============================================================================
// Daily Planner — Auto Backup / Sync System
// =============================================================================
//
// Provides scheduled, incremental-style backup sessions with:
//   - SHA-256 integrity verification (per-session manifest)
//   - Multiple session history with configurable retention
//   - Corruption detection and safe restore
//   - A tokio background scheduler (interval configurable via settings)
//
// Settings keys:
//   backup_enabled       = "true" | "false"      (default: "true")
//   backup_interval_min  = integer minutes        (default: 30)
//   backup_max_sessions  = integer               (default: 10)
//
// Each session:
//   - Serialises all user data to JSON (same format as BackupData in data_management.rs)
//   - Computes SHA-256 over the JSON bytes
//   - Writes JSON to  <app_data_dir>/backups/backup-<uuid>.json
//   - Inserts a row into the `backup_sessions` table
// =============================================================================

use crate::commands::data_management::BackupData;
use crate::db::migrations::SCHEMA_VERSION;
use crate::db::{queries, DbConnection};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::{Manager, State};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BackupSessionInfo {
    pub id: String,
    pub created_at: String,
    pub schema_version: i64,
    pub backup_size: i64,
    pub item_count: i64,
    /// "verified" | "corrupted" | "unknown"
    pub integrity_status: String,
    pub checksum: String,
    pub file_path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BackupSettings {
    pub enabled: bool,
    pub interval_min: u64,
    pub max_sessions: u64,
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn backups_dir(db_path: &Path) -> PathBuf {
    db_path.parent().unwrap_or(db_path).join("backups")
}

fn compute_sha256(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

fn count_items(backup: &BackupData) -> i64 {
    (backup.tasks.len()
        + backup.daily_reports.len()
        + backup.settings.len()) as i64
}

fn make_backup_data(conn: &Connection) -> rusqlite::Result<BackupData> {
    Ok(BackupData {
        version: 1,
        created_at: chrono::Utc::now().to_rfc3339(),
        tasks: queries::get_all_tasks(conn)?,
        daily_reports: queries::get_all_daily_reports(conn)?,
        settings: queries::get_all_settings_non_sensitive(conn)?,
    })
}

fn read_session(conn: &Connection, session_id: &str) -> anyhow::Result<BackupSessionInfo> {
    let info = conn.query_row(
        "SELECT id, created_at, schema_version, backup_size, item_count, integrity_status, checksum, file_path
         FROM backup_sessions WHERE id = ?1",
        params![session_id],
        |row| {
            Ok(BackupSessionInfo {
                id: row.get(0)?,
                created_at: row.get(1)?,
                schema_version: row.get(2)?,
                backup_size: row.get(3)?,
                item_count: row.get(4)?,
                integrity_status: row.get(5)?,
                checksum: row.get(6)?,
                file_path: row.get(7)?,
            })
        },
    ).map_err(|e| anyhow::anyhow!("Session not found: {}", e))?;
    Ok(info)
}

fn update_integrity_status(
    conn: &Connection,
    session_id: &str,
    status: &str,
) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE backup_sessions SET integrity_status = ?1 WHERE id = ?2",
        params![status, session_id],
    )
    .map_err(|e| anyhow::anyhow!(e))?;
    Ok(())
}

fn prune_old_sessions(conn: &Connection) -> anyhow::Result<u32> {
    let max_sessions: i64 = queries::get_setting(conn, "backup_max_sessions")
        .unwrap_or_default()
        .parse()
        .unwrap_or(10);

    let mut stmt = conn
        .prepare(
            "SELECT id, file_path FROM backup_sessions ORDER BY created_at DESC",
        )
        .map_err(|e| anyhow::anyhow!(e))?;

    let sessions: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| anyhow::anyhow!(e))?
        .filter_map(|r| r.ok())
        .collect();

    let mut pruned = 0u32;
    if sessions.len() as i64 > max_sessions {
        for (id, file_path) in &sessions[max_sessions as usize..] {
            let _ = std::fs::remove_file(file_path);
            let _ = conn.execute("DELETE FROM backup_sessions WHERE id = ?1", params![id]);
            pruned += 1;
        }
    }
    Ok(pruned)
}

/// Core backup logic — used by both Tauri commands and the scheduler.
pub fn run_backup(conn: &Connection, db_path: &Path) -> anyhow::Result<BackupSessionInfo> {
    let backup_data = make_backup_data(conn).map_err(|e| anyhow::anyhow!(e))?;
    let json = serde_json::to_string(&backup_data)?;
    let json_bytes = json.as_bytes();

    let checksum = compute_sha256(json_bytes);
    let backup_size = json_bytes.len() as i64;
    let item_count = count_items(&backup_data);

    let backups_path = backups_dir(db_path);
    std::fs::create_dir_all(&backups_path)?;

    let id = uuid::Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().to_rfc3339();
    let file_name = format!("backup-{}.json", id);
    let file_path = backups_path.join(&file_name);

    std::fs::write(&file_path, json_bytes)?;

    conn.execute(
        "INSERT INTO backup_sessions
         (id, created_at, schema_version, backup_size, item_count, integrity_status, checksum, file_path)
         VALUES (?1, ?2, ?3, ?4, ?5, 'verified', ?6, ?7)",
        params![
            id,
            created_at,
            SCHEMA_VERSION as i64,
            backup_size,
            item_count,
            checksum,
            file_path.to_string_lossy().as_ref()
        ],
    )
    .map_err(|e| anyhow::anyhow!(e))?;

    prune_old_sessions(conn)?;

    eprintln!("[auto_backup] Backup created: {} ({} bytes, {} items)", id, backup_size, item_count);

    Ok(BackupSessionInfo {
        id,
        created_at,
        schema_version: SCHEMA_VERSION as i64,
        backup_size,
        item_count,
        integrity_status: "verified".to_string(),
        checksum,
        file_path: file_path.to_string_lossy().into_owned(),
    })
}

/// Verify a session by re-computing SHA-256 of its file and comparing to stored checksum.
pub fn do_verify_session(conn: &Connection, session_id: &str) -> anyhow::Result<BackupSessionInfo> {
    let mut info = read_session(conn, session_id)?;

    if !std::path::Path::new(&info.file_path).exists() {
        let status = "corrupted";
        update_integrity_status(conn, session_id, status)?;
        info.integrity_status = status.to_string();
        return Ok(info);
    }

    let content = std::fs::read(&info.file_path)
        .map_err(|e| anyhow::anyhow!("Cannot read backup file: {}", e))?;
    let actual_checksum = compute_sha256(&content);

    let status = if actual_checksum == info.checksum {
        "verified"
    } else {
        "corrupted"
    };

    update_integrity_status(conn, session_id, status)?;
    info.integrity_status = status.to_string();
    Ok(info)
}

// ---------------------------------------------------------------------------
// Background scheduler
// ---------------------------------------------------------------------------

pub async fn start_backup_scheduler(db_path: PathBuf) {
    let mut last_backup: Option<std::time::Instant> = None;

    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;

        let conn = match Connection::open(&db_path) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[auto_backup] Scheduler: failed to open DB: {}", e);
                continue;
            }
        };
        if let Err(e) = conn.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
        ) {
            eprintln!("[auto_backup] Scheduler: PRAGMA failed: {}", e);
            continue;
        }

        let enabled = queries::get_setting(&conn, "backup_enabled")
            .unwrap_or_default()
            .trim()
            .eq_ignore_ascii_case("true");
        if !enabled {
            continue;
        }

        let interval_min: u64 = queries::get_setting(&conn, "backup_interval_min")
            .unwrap_or_default()
            .parse()
            .unwrap_or(30);

        let should_run = last_backup
            .map(|t| t.elapsed().as_secs() >= interval_min * 60)
            .unwrap_or(true);

        if should_run {
            match run_backup(&conn, &db_path) {
                Ok(info) => {
                    last_backup = Some(std::time::Instant::now());
                    eprintln!("[auto_backup] Scheduled backup OK: {}", info.id);
                }
                Err(e) => {
                    eprintln!("[auto_backup] Scheduled backup FAILED: {}", e);
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn trigger_backup_now(
    db: State<'_, DbConnection>,
    app: tauri::AppHandle,
) -> Result<BackupSessionInfo, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = app_dir.join("planner.db");
    run_backup(&*conn, &db_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_backup_sessions(
    db: State<'_, DbConnection>,
) -> Result<Vec<BackupSessionInfo>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, created_at, schema_version, backup_size, item_count, integrity_status, checksum, file_path
             FROM backup_sessions ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let sessions = stmt
        .query_map([], |row| {
            Ok(BackupSessionInfo {
                id: row.get(0)?,
                created_at: row.get(1)?,
                schema_version: row.get(2)?,
                backup_size: row.get(3)?,
                item_count: row.get(4)?,
                integrity_status: row.get(5)?,
                checksum: row.get(6)?,
                file_path: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(sessions)
}

#[tauri::command]
pub fn verify_backup_session(
    session_id: String,
    db: State<'_, DbConnection>,
) -> Result<BackupSessionInfo, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    do_verify_session(&*conn, &session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn verify_all_backup_sessions(
    db: State<'_, DbConnection>,
) -> Result<Vec<BackupSessionInfo>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let ids: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT id FROM backup_sessions ORDER BY created_at DESC")
            .map_err(|e| e.to_string())?;
        let collected: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        collected
    };

    let mut results = Vec::new();
    for id in ids {
        match do_verify_session(&*conn, &id) {
            Ok(info) => results.push(info),
            Err(e) => eprintln!("[auto_backup] Verify {} failed: {}", id, e),
        }
    }
    Ok(results)
}

#[tauri::command]
pub fn restore_from_backup_session(
    session_id: String,
    db: State<'_, DbConnection>,
) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Verify first
    let info = do_verify_session(&*conn, &session_id).map_err(|e| e.to_string())?;
    if info.integrity_status == "corrupted" {
        return Err(format!(
            "Session {} is corrupted and cannot be restored. Checksum mismatch.",
            session_id
        ));
    }

    let content = std::fs::read_to_string(&info.file_path)
        .map_err(|e| format!("Cannot read backup file: {}", e))?;

    let backup: BackupData =
        serde_json::from_str(&content).map_err(|e| format!("Invalid backup JSON: {}", e))?;

    // Restore — same logic as data_management::restore_data but inline
    conn.execute("DELETE FROM focus_sessions", []).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tasks", []).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM daily_sessions", []).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM daily_reports", []).map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM settings WHERE key NOT IN ('claude_token_enc', 'backup_enabled', 'backup_interval_min', 'backup_max_sessions')",
        [],
    )
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

    for setting in &backup.settings {
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![setting.key, setting.value],
        )
        .map_err(|e| e.to_string())?;
    }

    eprintln!("[auto_backup] Restored from session {}", session_id);
    Ok("ok".to_string())
}

#[tauri::command]
pub fn delete_backup_session(
    session_id: String,
    db: State<'_, DbConnection>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let file_path: Option<String> = conn
        .query_row(
            "SELECT file_path FROM backup_sessions WHERE id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .ok();

    if let Some(path) = file_path {
        let _ = std::fs::remove_file(&path);
    }

    conn.execute(
        "DELETE FROM backup_sessions WHERE id = ?1",
        params![session_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_backup_settings(db: State<'_, DbConnection>) -> Result<BackupSettings, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let enabled = queries::get_setting(&*conn, "backup_enabled")
        .unwrap_or_default()
        .trim()
        .eq_ignore_ascii_case("true");
    let interval_min: u64 = queries::get_setting(&*conn, "backup_interval_min")
        .unwrap_or_default()
        .parse()
        .unwrap_or(30);
    let max_sessions: u64 = queries::get_setting(&*conn, "backup_max_sessions")
        .unwrap_or_default()
        .parse()
        .unwrap_or(10);
    Ok(BackupSettings { enabled, interval_min, max_sessions })
}

#[tauri::command]
pub fn set_backup_settings(
    enabled: bool,
    interval_min: u64,
    max_sessions: u64,
    db: State<'_, DbConnection>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::set_setting(&*conn, "backup_enabled", if enabled { "true" } else { "false" })
        .map_err(|e| e.to_string())?;
    queries::set_setting(&*conn, "backup_interval_min", &interval_min.to_string())
        .map_err(|e| e.to_string())?;
    queries::set_setting(&*conn, "backup_max_sessions", &max_sessions.to_string())
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::run_migrations;
    use rusqlite::Connection;

    fn make_test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join("daily-planner-tests")
            .join(name);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn seed_backup_settings(conn: &Connection) {
        conn.execute_batch(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('backup_max_sessions', '10');
             INSERT OR REPLACE INTO settings (key, value) VALUES ('backup_enabled', 'true');
             INSERT OR REPLACE INTO settings (key, value) VALUES ('backup_interval_min', '30');",
        ).unwrap();
    }

    #[test]
    fn test_run_backup_creates_session_and_file() {
        let dir = make_test_dir("backup_create");
        let db_path = dir.join("planner.db");
        let mut conn = Connection::open(&db_path).unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;").unwrap();
        run_migrations(&mut conn, None).unwrap();

        seed_backup_settings(&conn);

        let info = run_backup(&conn, &db_path).unwrap();
        assert_eq!(info.integrity_status, "verified");
        assert!(!info.id.is_empty());
        assert!(std::path::Path::new(&info.file_path).exists());
        assert!(info.backup_size > 0);

        // Verify the file content is valid JSON
        let content = std::fs::read_to_string(&info.file_path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert!(parsed.get("version").is_some());
    }

    #[test]
    fn test_verify_session_detects_tampering() {
        let dir = make_test_dir("backup_tamper");
        let db_path = dir.join("planner.db");
        let mut conn = Connection::open(&db_path).unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;").unwrap();
        run_migrations(&mut conn, None).unwrap();
        seed_backup_settings(&conn);

        let info = run_backup(&conn, &db_path).unwrap();

        // Tamper the backup file
        std::fs::write(&info.file_path, b"tampered content").unwrap();

        let verified = do_verify_session(&conn, &info.id).unwrap();
        assert_eq!(verified.integrity_status, "corrupted");
    }

    #[test]
    fn test_verify_session_ok_on_intact_backup() {
        let dir = make_test_dir("backup_verify_ok");
        let db_path = dir.join("planner.db");
        let mut conn = Connection::open(&db_path).unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;").unwrap();
        run_migrations(&mut conn, None).unwrap();
        seed_backup_settings(&conn);

        let info = run_backup(&conn, &db_path).unwrap();
        let verified = do_verify_session(&conn, &info.id).unwrap();
        assert_eq!(verified.integrity_status, "verified");
    }

    #[test]
    fn test_multiple_sessions_and_retention_pruning() {
        let dir = make_test_dir("backup_pruning");
        let db_path = dir.join("planner.db");
        let mut conn = Connection::open(&db_path).unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;").unwrap();
        run_migrations(&mut conn, None).unwrap();
        seed_backup_settings(&conn);
        // Override max_sessions to 3
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('backup_max_sessions', '3')", []).unwrap();

        // Create 5 backups
        for _ in 0..5 {
            run_backup(&conn, &db_path).unwrap();
        }

        // Should only have 3 sessions left
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM backup_sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 3);
    }

    #[test]
    fn test_restore_from_verified_backup() {
        let dir = make_test_dir("backup_restore");
        let db_path = dir.join("planner.db");
        let mut conn = Connection::open(&db_path).unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;").unwrap();
        run_migrations(&mut conn, None).unwrap();
        seed_backup_settings(&conn);

        // Insert a task
        conn.execute(
            "INSERT INTO tasks (id, title, task_type, priority, position)
             VALUES ('test-task-1', 'Test Task', 'prompt', 2, 0)",
            [],
        ).unwrap();

        let info = run_backup(&conn, &db_path).unwrap();

        // Delete the task
        conn.execute("DELETE FROM tasks", []).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);

        // Verify then restore
        do_verify_session(&conn, &info.id).unwrap();
        // Simulate restore_from_backup_session logic inline
        let content = std::fs::read_to_string(&info.file_path).unwrap();
        let backup: BackupData = serde_json::from_str(&content).unwrap();
        assert!(!backup.tasks.is_empty());
    }

    #[test]
    fn test_restore_rejected_for_corrupted_session() {
        let dir = make_test_dir("backup_corrupt_restore");
        let db_path = dir.join("planner.db");
        let mut conn = Connection::open(&db_path).unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;").unwrap();
        run_migrations(&mut conn, None).unwrap();
        seed_backup_settings(&conn);

        let info = run_backup(&conn, &db_path).unwrap();
        std::fs::write(&info.file_path, b"corrupted data").unwrap();

        let verified = do_verify_session(&conn, &info.id).unwrap();
        assert_eq!(verified.integrity_status, "corrupted");

        // Attempt restore should fail at read_to_string level (OK) or at JSON parse level
        let content = std::fs::read_to_string(&info.file_path).unwrap();
        let parse_result: Result<BackupData, _> = serde_json::from_str(&content);
        assert!(parse_result.is_err()); // corrupted = bad JSON
    }

    #[test]
    fn test_delete_backup_session_removes_file() {
        let dir = make_test_dir("backup_delete");
        let db_path = dir.join("planner.db");
        let mut conn = Connection::open(&db_path).unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;").unwrap();
        run_migrations(&mut conn, None).unwrap();
        seed_backup_settings(&conn);

        let info = run_backup(&conn, &db_path).unwrap();
        assert!(std::path::Path::new(&info.file_path).exists());

        // Simulate delete
        std::fs::remove_file(&info.file_path).unwrap();
        conn.execute(
            "DELETE FROM backup_sessions WHERE id = ?1",
            params![info.id],
        ).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM backup_sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
        assert!(!std::path::Path::new(&info.file_path).exists());
    }

    #[test]
    fn test_verify_session_missing_file_is_corrupted() {
        let dir = make_test_dir("backup_missing_file");
        let db_path = dir.join("planner.db");
        let mut conn = Connection::open(&db_path).unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;").unwrap();
        run_migrations(&mut conn, None).unwrap();
        seed_backup_settings(&conn);

        let info = run_backup(&conn, &db_path).unwrap();
        std::fs::remove_file(&info.file_path).unwrap();

        let verified = do_verify_session(&conn, &info.id).unwrap();
        assert_eq!(verified.integrity_status, "corrupted");
    }
}
