use rusqlite::{Connection, params};
use std::path::Path;
use anyhow::Context;

/// The highest schema version this build knows about.
pub const SCHEMA_VERSION: u32 = 5;

/// Run all pending migrations against `conn`.
///
/// * `db_path` – on-disk path of `planner.db`.  Pass `None` for in-memory
///   (test) connections to skip the backup step.
/// * Idempotent: calling on an up-to-date DB is a no-op.
/// * Each migration runs inside its own transaction and only records its
///   version after a successful COMMIT, so a crash mid-migration leaves
///   the DB at the previous clean version.
pub fn run_migrations(conn: &mut Connection, db_path: Option<&Path>) -> anyhow::Result<()> {
    bootstrap_version_table(conn).context("Failed to create schema_version table")?;

    let current = detect_version(conn).context("Failed to detect schema version")?;

    if current >= SCHEMA_VERSION {
        eprintln!("[migrations] Schema up-to-date at v{}.", current);
        return Ok(());
    }

    eprintln!("[migrations] Migrating v{} → v{}.", current, SCHEMA_VERSION);

    // One backup per upgrade run, taken before any DDL.
    if let Some(path) = db_path {
        create_backup(conn, path, current)
            .with_context(|| format!("Pre-v{} backup failed", current + 1))?;
    }

    if current < 1 {
        apply_v1(conn)?;
    }
    if current < 2 {
        apply_v2(conn)?;
    }
    if current < 3 {
        apply_v3(conn)?;
    }
    if current < 4 {
        apply_v4(conn)?;
    }
    if current < 5 {
        apply_v5(conn)?;
    }

    eprintln!("[migrations] All migrations applied.  Schema is now v{}.", SCHEMA_VERSION);
    Ok(())
}

// ---------------------------------------------------------------------------
// Bootstrap & version detection
// ---------------------------------------------------------------------------

fn bootstrap_version_table(conn: &Connection) -> anyhow::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
             version     INTEGER NOT NULL,
             applied_at  TEXT    NOT NULL DEFAULT (datetime('now')),
             description TEXT    NOT NULL DEFAULT ''
         );",
    )
    .context("CREATE TABLE schema_version")
}

/// Return the highest version that has been fully applied.
///
/// Three cases:
///  (a) `schema_version` has rows     → trust `MAX(version)`
///  (b) `schema_version` is empty but user tables exist → legacy DB, infer
///  (c) completely empty DB           → 0 (fresh install)
fn detect_version(conn: &Connection) -> anyhow::Result<u32> {
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM schema_version", [], |r| r.get(0))
        .context("COUNT(*) FROM schema_version")?;

    if count > 0 {
        let v: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .context("MAX(version) FROM schema_version")?;

        if v < 0 {
            anyhow::bail!(
                "Corrupt schema_version: version {} is negative. \
                 Restore from a backup or delete the database to start fresh.",
                v
            );
        }

        if v as u32 > SCHEMA_VERSION {
            eprintln!(
                "[migrations] WARNING: DB is at v{} which is newer than this build's v{}. \
                 Skipping migrations to avoid downgrade damage.",
                v, SCHEMA_VERSION
            );
        }

        return Ok(v as u32);
    }

    // schema_version is empty — legacy DB or fresh install.
    infer_legacy_version(conn)
}

/// Inspect an un-versioned legacy DB and return the equivalent version,
/// backfilling `schema_version` rows so subsequent startups take the fast path.
fn infer_legacy_version(conn: &Connection) -> anyhow::Result<u32> {
    if !table_exists(conn, "tasks")? {
        // Genuinely empty — fresh install.
        return Ok(0);
    }

    if !table_exists(conn, "projects")? {
        eprintln!("[migrations] Legacy DB detected; inferred v1.");
        record_version_row(conn, 1, "legacy v1 (inferred on startup)")?;
        return Ok(1);
    }

    if !column_exists(conn, "projects", "prompt")? {
        eprintln!("[migrations] Legacy DB detected; inferred v2.");
        record_version_row(conn, 1, "legacy v1 (inferred on startup)")?;
        record_version_row(conn, 2, "legacy v2 (inferred on startup)")?;
        return Ok(2);
    }

    if !setting_exists(conn, "ai_provider")? {
        eprintln!("[migrations] Legacy DB detected; inferred v3.");
        record_version_row(conn, 1, "legacy v1 (inferred on startup)")?;
        record_version_row(conn, 2, "legacy v2 (inferred on startup)")?;
        record_version_row(conn, 3, "legacy v3 (inferred on startup)")?;
        return Ok(3);
    }

    if !column_exists(conn, "tasks", "worktree_path")? {
        eprintln!("[migrations] Legacy DB detected; inferred v4.");
        record_version_row(conn, 1, "legacy v1 (inferred on startup)")?;
        record_version_row(conn, 2, "legacy v2 (inferred on startup)")?;
        record_version_row(conn, 3, "legacy v3 (inferred on startup)")?;
        record_version_row(conn, 4, "legacy v4 (inferred on startup)")?;
        return Ok(4);
    }

    eprintln!("[migrations] Legacy DB detected; inferred v5.");
    record_version_row(conn, 1, "legacy v1 (inferred on startup)")?;
    record_version_row(conn, 2, "legacy v2 (inferred on startup)")?;
    record_version_row(conn, 3, "legacy v3 (inferred on startup)")?;
    record_version_row(conn, 4, "legacy v4 (inferred on startup)")?;
    record_version_row(conn, 5, "legacy v5 (inferred on startup)")?;
    Ok(5)
}

fn record_version_row(conn: &Connection, version: u32, description: &str) -> anyhow::Result<()> {
    conn.execute(
        "INSERT INTO schema_version (version, description) VALUES (?1, ?2)",
        params![version as i64, description],
    )
    .context("INSERT INTO schema_version")?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

/// `VACUUM INTO` a clean copy of the DB before any migration DDL runs.
/// Skips if the target backup file already exists (crash-safe: a previous run
/// already made the backup before crashing mid-migration).
fn create_backup(conn: &Connection, db_path: &Path, from_version: u32) -> anyhow::Result<()> {
    let parent = db_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = db_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("planner");
    let backup_name = format!("{}-backup-pre-v{}.db", stem, from_version + 1);
    let backup_path = parent.join(&backup_name);

    if backup_path.exists() {
        eprintln!(
            "[migrations] Backup already exists at {:?}; skipping creation.",
            backup_path
        );
        return Ok(());
    }

    eprintln!("[migrations] Creating pre-migration backup at {:?} …", backup_path);

    // VACUUM INTO produces a defragmented, fully consistent snapshot.
    let escaped = backup_path
        .to_string_lossy()
        .replace('\'', "''");
    conn.execute_batch(&format!("VACUUM INTO '{}';", escaped))
        .with_context(|| format!("VACUUM INTO {:?} failed", backup_path))?;

    eprintln!("[migrations] Backup created successfully.");
    Ok(())
}

// ---------------------------------------------------------------------------
// Migration runner helper
// ---------------------------------------------------------------------------

/// Execute `f` inside a transaction.  On success, record `version` in
/// `schema_version` and commit.  On any failure, the transaction is dropped
/// (auto-rollback) and the error is returned with context.
fn with_migration<F>(
    conn: &mut Connection,
    version: u32,
    description: &str,
    f: F,
) -> anyhow::Result<()>
where
    F: FnOnce(&Connection) -> anyhow::Result<()>,
{
    eprintln!("[migrations] Applying v{}: {} …", version, description);

    let tx = conn
        .transaction()
        .context("Failed to open migration transaction")?;

    // Run the user-supplied DDL.  On Err, `tx` is dropped → auto-rollback.
    f(&tx).with_context(|| format!("Migration v{} body failed; transaction rolled back", version))?;

    // Record the version inside the same transaction so it's atomic.
    tx.execute(
        "INSERT INTO schema_version (version, description) VALUES (?1, ?2)",
        params![version as i64, description],
    )
    .context("Failed to record version in schema_version")?;

    tx.commit()
        .with_context(|| format!("Failed to commit migration v{}", version))?;

    eprintln!("[migrations] v{} committed successfully.", version);
    Ok(())
}

// ---------------------------------------------------------------------------
// Individual migrations
// ---------------------------------------------------------------------------

fn apply_v1(conn: &mut Connection) -> anyhow::Result<()> {
    with_migration(conn, 1, "Initial schema", |tx| {
        tx.execute_batch("
            CREATE TABLE IF NOT EXISTS tasks (
                id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                date          TEXT NOT NULL,
                session_slot  INTEGER NOT NULL DEFAULT 1,
                title         TEXT NOT NULL,
                notes         TEXT DEFAULT '',
                task_type     TEXT NOT NULL DEFAULT 'code',
                priority      INTEGER NOT NULL DEFAULT 2,
                status        TEXT NOT NULL DEFAULT 'pending',
                estimated_min INTEGER DEFAULT NULL,
                actual_min    INTEGER DEFAULT NULL,
                prompt_used   TEXT DEFAULT NULL,
                prompt_result TEXT DEFAULT NULL,
                carried_from  TEXT DEFAULT NULL,
                position      INTEGER NOT NULL DEFAULT 0,
                created_at    TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
                completed_at  TEXT DEFAULT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(date);
            CREATE INDEX IF NOT EXISTS idx_tasks_date_session ON tasks(date, session_slot);
            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

            CREATE TABLE IF NOT EXISTS focus_sessions (
                id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                date         TEXT NOT NULL,
                started_at   TEXT NOT NULL,
                ended_at     TEXT DEFAULT NULL,
                duration_min INTEGER DEFAULT NULL,
                notes        TEXT DEFAULT ''
            );

            CREATE INDEX IF NOT EXISTS idx_focus_task ON focus_sessions(task_id);
            CREATE INDEX IF NOT EXISTS idx_focus_date ON focus_sessions(date);

            CREATE TABLE IF NOT EXISTS daily_sessions (
                id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                date            TEXT NOT NULL,
                session_slot    INTEGER NOT NULL,
                started_at      TEXT NOT NULL,
                tasks_planned   INTEGER DEFAULT 0,
                tasks_completed INTEGER DEFAULT 0,
                tasks_skipped   INTEGER DEFAULT 0,
                focus_minutes   INTEGER DEFAULT 0,
                notes           TEXT DEFAULT '',
                UNIQUE(date, session_slot)
            );

            CREATE TABLE IF NOT EXISTS prompt_templates (
                id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                name       TEXT NOT NULL,
                category   TEXT NOT NULL DEFAULT 'general',
                template   TEXT NOT NULL,
                variables  TEXT NOT NULL DEFAULT '[]',
                is_builtin INTEGER NOT NULL DEFAULT 0,
                use_count  INTEGER DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS daily_reports (
                id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                date            TEXT NOT NULL UNIQUE,
                tasks_planned   INTEGER DEFAULT 0,
                tasks_completed INTEGER DEFAULT 0,
                tasks_skipped   INTEGER DEFAULT 0,
                tasks_carried   INTEGER DEFAULT 0,
                total_focus_min INTEGER DEFAULT 0,
                session1_focus  INTEGER DEFAULT 0,
                session2_focus  INTEGER DEFAULT 0,
                ai_reflection   TEXT DEFAULT NULL,
                markdown_export TEXT DEFAULT NULL,
                generated_at    TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            INSERT OR IGNORE INTO settings VALUES ('timezone_offset',    '7');
            INSERT OR IGNORE INTO settings VALUES ('session1_kickstart', '09:00');
            INSERT OR IGNORE INTO settings VALUES ('planning_end',       '11:00');
            INSERT OR IGNORE INTO settings VALUES ('session2_start',     '14:00');
            INSERT OR IGNORE INTO settings VALUES ('warn_before_min',    '15');
            INSERT OR IGNORE INTO settings VALUES ('autostart',          'false');
            INSERT OR IGNORE INTO settings VALUES ('claude_model',       'claude-sonnet-4-6');
            INSERT OR IGNORE INTO settings VALUES ('theme',              'dark');
            INSERT OR IGNORE INTO settings VALUES ('work_days',          '[1,2,3,4,5]');
            INSERT OR IGNORE INTO settings VALUES ('show_in_tray',       'true');
            INSERT OR IGNORE INTO settings VALUES ('pomodoro_work_min',  '25');
            INSERT OR IGNORE INTO settings VALUES ('pomodoro_break_min', '5');

            INSERT OR IGNORE INTO prompt_templates
                (id, name, category, template, variables, is_builtin) VALUES
            ('builtin-1', 'Plan My Day', 'planning',
             'I have the following tasks for today:\n\n{{tasks}}\n\nPlease help me:\n1. Prioritize these tasks\n2. Estimate time for each\n3. Identify any blockers or dependencies\n4. Suggest the best order to tackle them in my 5-hour session',
             '[\"tasks\"]', 1),
            ('builtin-2', 'Debug This Issue', 'debugging',
             'I am debugging the following issue:\n\n**Problem**: {{problem}}\n\n**Error message**: {{error}}\n\n**Code context**: {{code}}\n\nPlease help me identify the root cause and provide a fix.',
             '[\"problem\",\"error\",\"code\"]', 1),
            ('builtin-3', 'Code Review', 'code-review',
             'Please review the following code for:\n- Correctness and bugs\n- Performance issues\n- Security vulnerabilities\n- Best practices\n\n```{{language}}\n{{code}}\n```',
             '[\"language\",\"code\"]', 1),
            ('builtin-4', 'Research Topic', 'research',
             'I need to understand: {{topic}}\n\nSpecifically:\n1. {{question1}}\n2. {{question2}}\n\nPlease provide a concise technical explanation with examples.',
             '[\"topic\",\"question1\",\"question2\"]', 1),
            ('builtin-5', 'Write Tests', 'code-review',
             'Please write comprehensive tests for the following code:\n\n```{{language}}\n{{code}}\n```\n\nInclude: unit tests, edge cases, error cases. Use TDD red-green approach.',
             '[\"language\",\"code\"]', 1),
            ('builtin-6', 'End of Session Wrap-up', 'planning',
             'My session is ending in 15 minutes. Here is what I accomplished:\n\n{{completed}}\n\nStill pending:\n{{pending}}\n\nPlease help me:\n1. Write a summary of today''s progress\n2. Identify what to tackle first in the next session\n3. Capture any important context to remember',
             '[\"completed\",\"pending\"]', 1);
        ").context("v1 DDL failed")
    })
}

fn apply_v2(conn: &mut Connection) -> anyhow::Result<()> {
    with_migration(conn, 2, "Add projects table and tasks.project_id", |tx| {
        tx.execute_batch("
            CREATE TABLE IF NOT EXISTS projects (
                id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                name       TEXT NOT NULL,
                path       TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);
        ")
        .context("Failed to create projects table")?;

        // ALTER TABLE fails if column already exists; guard with existence check.
        if !column_exists(tx, "tasks", "project_id")? {
            tx.execute_batch(
                "ALTER TABLE tasks ADD COLUMN project_id TEXT DEFAULT NULL;",
            )
            .context("ALTER TABLE tasks ADD COLUMN project_id")?;
        }
        Ok(())
    })
}

fn apply_v3(conn: &mut Connection) -> anyhow::Result<()> {
    with_migration(conn, 3, "Add projects.prompt column", |tx| {
        if !column_exists(tx, "projects", "prompt")? {
            tx.execute_batch(
                "ALTER TABLE projects ADD COLUMN prompt TEXT DEFAULT NULL;",
            )
            .context("ALTER TABLE projects ADD COLUMN prompt")?;
        }
        Ok(())
    })
}

fn apply_v4(conn: &mut Connection) -> anyhow::Result<()> {
    with_migration(conn, 4, "Add persisted AI provider setting", |tx| {
        tx.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_provider', 'claude')",
            [],
        )
        .context("Insert default ai_provider setting")?;
        Ok(())
    })
}

fn apply_v5(conn: &mut Connection) -> anyhow::Result<()> {
    with_migration(conn, 5, "Add task worktree metadata columns", |tx| {
        if !column_exists(tx, "tasks", "worktree_path")? {
            tx.execute_batch("ALTER TABLE tasks ADD COLUMN worktree_path TEXT DEFAULT NULL;")
                .context("ALTER TABLE tasks ADD COLUMN worktree_path")?;
        }
        if !column_exists(tx, "tasks", "worktree_branch")? {
            tx.execute_batch("ALTER TABLE tasks ADD COLUMN worktree_branch TEXT DEFAULT NULL;")
                .context("ALTER TABLE tasks ADD COLUMN worktree_branch")?;
        }
        if !column_exists(tx, "tasks", "worktree_status")? {
            tx.execute_batch("ALTER TABLE tasks ADD COLUMN worktree_status TEXT DEFAULT NULL;")
                .context("ALTER TABLE tasks ADD COLUMN worktree_status")?;
        }
        Ok(())
    })
}

// ---------------------------------------------------------------------------
// Schema introspection helpers (take &Connection — works on both Connection
// and Transaction<'_> via Deref coercion)
// ---------------------------------------------------------------------------

fn table_exists(conn: &Connection, name: &str) -> anyhow::Result<bool> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            params![name],
            |r| r.get(0),
        )
        .context("Failed to query sqlite_master")?;
    Ok(count > 0)
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> anyhow::Result<bool> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name=?2",
            params![table, column],
            |r| r.get(0),
        )
        .context("Failed to query pragma_table_info")?;
    Ok(count > 0)
}

fn setting_exists(conn: &Connection, key: &str) -> anyhow::Result<bool> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM settings WHERE key = ?1",
            params![key],
            |r| r.get(0),
        )
        .context("Failed to query settings key")?;
    Ok(count > 0)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn open_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn
    }

    /// Build a minimal v1-equivalent schema with no schema_version rows.
    fn seed_v1_schema(conn: &Connection) {
        conn.execute_batch("
            CREATE TABLE tasks (
                id TEXT PRIMARY KEY, date TEXT NOT NULL,
                session_slot INTEGER NOT NULL DEFAULT 1,
                title TEXT NOT NULL, notes TEXT DEFAULT '',
                task_type TEXT NOT NULL DEFAULT 'code',
                priority INTEGER NOT NULL DEFAULT 2,
                status TEXT NOT NULL DEFAULT 'pending',
                estimated_min INTEGER DEFAULT NULL,
                actual_min INTEGER DEFAULT NULL,
                prompt_used TEXT DEFAULT NULL,
                prompt_result TEXT DEFAULT NULL,
                carried_from TEXT DEFAULT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                completed_at TEXT DEFAULT NULL
            );
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE focus_sessions (
                id TEXT PRIMARY KEY, task_id TEXT NOT NULL,
                date TEXT NOT NULL, started_at TEXT NOT NULL,
                ended_at TEXT DEFAULT NULL,
                duration_min INTEGER DEFAULT NULL,
                notes TEXT DEFAULT ''
            );
            CREATE TABLE daily_sessions (
                id TEXT PRIMARY KEY, date TEXT NOT NULL,
                session_slot INTEGER NOT NULL, started_at TEXT NOT NULL,
                tasks_planned INTEGER DEFAULT 0,
                tasks_completed INTEGER DEFAULT 0,
                tasks_skipped INTEGER DEFAULT 0,
                focus_minutes INTEGER DEFAULT 0,
                notes TEXT DEFAULT '',
                UNIQUE(date, session_slot)
            );
            CREATE TABLE prompt_templates (
                id TEXT PRIMARY KEY, name TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'general',
                template TEXT NOT NULL,
                variables TEXT NOT NULL DEFAULT '[]',
                is_builtin INTEGER NOT NULL DEFAULT 0,
                use_count INTEGER DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE daily_reports (
                id TEXT PRIMARY KEY, date TEXT NOT NULL UNIQUE,
                tasks_planned INTEGER DEFAULT 0,
                tasks_completed INTEGER DEFAULT 0,
                tasks_skipped INTEGER DEFAULT 0,
                tasks_carried INTEGER DEFAULT 0,
                total_focus_min INTEGER DEFAULT 0,
                session1_focus INTEGER DEFAULT 0,
                session2_focus INTEGER DEFAULT 0,
                ai_reflection TEXT DEFAULT NULL,
                markdown_export TEXT DEFAULT NULL,
                generated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            INSERT OR IGNORE INTO settings VALUES ('timezone_offset', '7');
        ").unwrap();
    }

    // --- 1. Fresh install ---

    #[test]
    fn test_fresh_install() {
        let mut conn = open_test_db();
        run_migrations(&mut conn, None).unwrap();

        // All expected tables exist.
        for tbl in &["tasks", "focus_sessions", "daily_sessions",
                      "prompt_templates", "daily_reports", "settings",
                      "projects", "schema_version"] {
            assert!(table_exists(&conn, tbl).unwrap(), "Table '{}' missing", tbl);
        }

        // New columns added.
        assert!(column_exists(&conn, "tasks", "project_id").unwrap());
        assert!(column_exists(&conn, "tasks", "worktree_path").unwrap());
        assert!(column_exists(&conn, "tasks", "worktree_branch").unwrap());
        assert!(column_exists(&conn, "tasks", "worktree_status").unwrap());
        assert!(column_exists(&conn, "projects", "prompt").unwrap());

        // Schema version recorded correctly.
        let v: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, SCHEMA_VERSION as i64);

        // 6 builtin templates seeded.
        let tmpl_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM prompt_templates WHERE is_builtin=1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tmpl_count, 6);

        // Default settings populated.
        let tz: String = conn
            .query_row("SELECT value FROM settings WHERE key='timezone_offset'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tz, "7");
    }

    // --- 2. Upgrade with existing populated data ---

    #[test]
    fn test_upgrade_from_v1_preserves_data() {
        let mut conn = open_test_db();
        seed_v1_schema(&conn);

        // Add legacy user data.
        conn.execute(
            "INSERT INTO tasks (id, date, session_slot, title, task_type, priority, \
             status, position, created_at, updated_at) \
             VALUES ('legacy-1', '2025-01-01', 1, 'Legacy Task', 'code', 1, \
             'done', 0, datetime('now'), datetime('now'))",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings VALUES ('timezone_offset', '9') \
             ON CONFLICT(key) DO UPDATE SET value='9'",
            [],
        )
        .unwrap();

        run_migrations(&mut conn, None).unwrap();

        // Data must survive migration.
        let title: String = conn
            .query_row(
                "SELECT title FROM tasks WHERE id='legacy-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(title, "Legacy Task", "Task title must be preserved");

        let tz: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key='timezone_offset'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tz, "9", "User setting must be preserved");

        // New schema elements added.
        assert!(table_exists(&conn, "projects").unwrap());
        assert!(column_exists(&conn, "tasks", "project_id").unwrap());
        assert!(column_exists(&conn, "tasks", "worktree_path").unwrap());
        assert!(column_exists(&conn, "projects", "prompt").unwrap());

        let v: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, SCHEMA_VERSION as i64);
    }

    // --- 3. Failed migration — transaction rollback ---

    #[test]
    fn test_failed_migration_rollback() {
        let mut conn = open_test_db();

        // Seed user data in a plain table.
        conn.execute_batch(
            "CREATE TABLE user_data (id TEXT PRIMARY KEY, value TEXT NOT NULL);
             INSERT INTO user_data VALUES ('row1', 'important');",
        )
        .unwrap();

        // Simulate a migration that starts but is never committed.
        {
            let tx = conn.transaction().unwrap();
            tx.execute_batch(
                "CREATE TABLE temp_migration (x TEXT);
                 INSERT INTO temp_migration VALUES ('partial');",
            )
            .unwrap();
            // Drop without commit → auto-rollback.
        }

        // Rolled-back table must not exist.
        assert!(
            !table_exists(&conn, "temp_migration").unwrap(),
            "Rolled-back migration must not persist the table"
        );

        // Original data must be untouched.
        let val: String = conn
            .query_row(
                "SELECT value FROM user_data WHERE id='row1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(val, "important");
    }

    // --- 4. Idempotent — second startup is a strict no-op ---

    #[test]
    fn test_idempotent_reruns() {
        let mut conn = open_test_db();

        // First run.
        run_migrations(&mut conn, None).unwrap();
        let version_rows_after_first: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_version", [], |r| r.get(0))
            .unwrap();

        // Insert user data.
        conn.execute(
            "INSERT INTO tasks (id, date, session_slot, title, task_type, priority, \
             status, position, created_at, updated_at) \
             VALUES ('t1','2026-01-01',1,'My Task','code',1,'pending',0,\
             datetime('now'),datetime('now'))",
            [],
        )
        .unwrap();

        // Second run — must be a no-op.
        run_migrations(&mut conn, None).unwrap();
        let version_rows_after_second: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_version", [], |r| r.get(0))
            .unwrap();

        assert_eq!(
            version_rows_after_first, version_rows_after_second,
            "Second run must not add new schema_version rows"
        );

        // Data must still be intact.
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE id='t1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "User data must survive a no-op second run");
    }

    // --- 5a. Edge case: legacy DB inferred at v1 ---

    #[test]
    fn test_legacy_v1_inferred_and_migrated() {
        let mut conn = open_test_db();
        seed_v1_schema(&conn);

        // No schema_version rows yet.
        bootstrap_version_table(&conn).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);

        run_migrations(&mut conn, None).unwrap();

        // Should have applied v2 and v3.
        let v: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, SCHEMA_VERSION as i64);
        assert!(table_exists(&conn, "projects").unwrap());
        assert!(column_exists(&conn, "projects", "prompt").unwrap());
        assert!(column_exists(&conn, "tasks", "worktree_path").unwrap());
    }

    // --- 5b. Edge case: corrupt negative version ---

    #[test]
    fn test_corrupt_negative_version_errors() {
        let mut conn = open_test_db();
        bootstrap_version_table(&conn).unwrap();
        conn.execute(
            "INSERT INTO schema_version (version, description) VALUES (-1, 'corrupt')",
            [],
        )
        .unwrap();

        let result = run_migrations(&mut conn, None);
        assert!(result.is_err(), "Negative version must return an error");
        let msg = format!("{:#}", result.unwrap_err());
        assert!(
            msg.contains("negative") || msg.contains("-1"),
            "Error must mention corrupt/negative version; got: {}",
            msg
        );
    }

    // --- 5c. Edge case: DB from a newer (future) build ---

    #[test]
    fn test_future_version_skips_migrations_safely() {
        let mut conn = open_test_db();
        // Fully migrate first so all tables are present.
        run_migrations(&mut conn, None).unwrap();
        // Pretend a future build wrote version 99.
        conn.execute(
            "INSERT INTO schema_version (version, description) VALUES (99, 'future')",
            [],
        )
        .unwrap();

        // Must not panic or corrupt anything.
        let result = run_migrations(&mut conn, None);
        assert!(result.is_ok(), "Future DB version must not crash: {:?}", result);
    }

    // --- 5d. Edge case: completely empty schema_version (no user tables) ---

    #[test]
    fn test_empty_db_is_fresh_install() {
        let mut conn = open_test_db();
        // Only bootstrap the version table, add no user tables.
        bootstrap_version_table(&conn).unwrap();

        let version = detect_version(&conn).unwrap();
        assert_eq!(version, 0, "Empty DB should be detected as v0 (fresh install)");
    }
}
