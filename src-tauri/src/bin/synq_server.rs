// synq_server.rs — Standalone Synq HTTP server (no Tauri dependency)
//
// Environment variables:
//   SYNQ_DB_PATH   — path to SQLite database (default: /data/planner.db)
//   SYNQ_DIST_PATH — path to built React dist/ directory (default: /app/dist)
//   SYNQ_PORT      — HTTP port override (default: 7734, also stored in DB settings)

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

fn main() {
    // 1. Determine DB path
    let db_path = std::env::var("SYNQ_DB_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/data/planner.db"));

    // Ensure parent directory exists
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).expect("Failed to create DB parent directory");
    }

    eprintln!("[synq-server] DB path: {:?}", db_path);

    // 2. Open connection with WAL mode + foreign keys, then run migrations
    {
        let mut conn = Connection::open(&db_path).expect("Failed to open DB");
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .expect("Failed to set PRAGMA");
        daily_planner_lib::db::run_migrations(&mut conn, Some(&db_path))
            .expect("Migrations failed");

        // 3. Auto-generate auth token if missing
        let existing = daily_planner_lib::db::queries::get_setting(&conn, "http_auth_token")
            .unwrap_or_default();
        if existing.trim().is_empty() {
            use rand::Rng;
            let token: String = rand::thread_rng()
                .sample_iter(&rand::distributions::Alphanumeric)
                .take(32)
                .map(char::from)
                .collect();
            daily_planner_lib::db::queries::set_setting(&conn, "http_auth_token", &token)
                .expect("Failed to store auth token");
            eprintln!("[synq-server] Auth token: {}", token);
        } else {
            eprintln!("[synq-server] Auth token already set.");
        }
    }

    // 4. Build job registry
    let registry = Arc::new(Mutex::new(HashMap::<String, u32>::new()));

    // 5. Determine dist/ path for static file serving
    let dist_path = std::env::var("SYNQ_DIST_PATH")
        .map(PathBuf::from)
        .ok()
        .filter(|p| p.join("index.html").exists())
        .or_else(|| {
            // Fallback: look relative to the binary
            std::env::current_exe().ok().and_then(|mut exe| {
                exe.pop(); // remove binary name
                exe.push("dist");
                if exe.join("index.html").exists() {
                    Some(exe)
                } else {
                    None
                }
            })
        });

    eprintln!("[synq-server] dist path: {:?}", dist_path);

    // 6. Start the Axum HTTP server (blocks until shutdown)
    let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
    rt.block_on(async {
        daily_planner_lib::http_server::start(db_path, registry, dist_path).await;
    });
}
