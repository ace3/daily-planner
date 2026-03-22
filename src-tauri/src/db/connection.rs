use rusqlite::{Connection, Result};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct DbConnection(pub Mutex<Connection>);

/// Open (or create) the app database and return the connection together with
/// the on-disk path so the caller can pass it to `run_migrations` for
/// pre-migration backups.
pub fn init_db(app: &AppHandle) -> Result<(DbConnection, PathBuf)> {
    let app_dir = app
        .path()
        .app_data_dir()
        .expect("Failed to get app data dir");
    std::fs::create_dir_all(&app_dir).expect("Failed to create app data dir");
    let db_path = app_dir.join("planner.db");

    let conn = Connection::open(&db_path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    Ok((DbConnection(Mutex::new(conn)), db_path))
}
