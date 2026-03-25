use anyhow::Context;
use rusqlite::{params, Connection};
use std::path::Path;

/// The highest schema version this build knows about.
pub const SCHEMA_VERSION: u32 = 13;

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
    if current < 6 {
        apply_v6(conn)?;
    }
    if current < 7 {
        apply_v7(conn)?;
    }
    if current < 8 {
        apply_v8(conn)?;
    }
    if current < 9 {
        apply_v9(conn)?;
    }
    if current < 10 {
        apply_v10(conn)?;
    }
    if current < 11 {
        apply_v11(conn)?;
    }
    if current < 12 {
        apply_v12(conn)?;
    }
    if current < 13 {
        apply_v13(conn)?;
    }

    eprintln!(
        "[migrations] All migrations applied.  Schema is now v{}.",
        SCHEMA_VERSION
    );
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

    if !column_exists(conn, "tasks", "worktree_path")?
        || !column_exists(conn, "tasks", "worktree_branch")?
        || !column_exists(conn, "tasks", "worktree_status")?
    {
        eprintln!("[migrations] Legacy DB detected; inferred v4.");
        record_version_row(conn, 1, "legacy v1 (inferred on startup)")?;
        record_version_row(conn, 2, "legacy v2 (inferred on startup)")?;
        record_version_row(conn, 3, "legacy v3 (inferred on startup)")?;
        record_version_row(conn, 4, "legacy v4 (inferred on startup)")?;
        return Ok(4);
    }

    if !setting_exists(conn, "default_model_codex")?
        || !setting_exists(conn, "default_model_claude")?
        || !setting_exists(conn, "default_model_opencode")?
        || !setting_exists(conn, "default_model_copilot")?
    {
        eprintln!("[migrations] Legacy DB detected; inferred v5.");
        record_version_row(conn, 1, "legacy v1 (inferred on startup)")?;
        record_version_row(conn, 2, "legacy v2 (inferred on startup)")?;
        record_version_row(conn, 3, "legacy v3 (inferred on startup)")?;
        record_version_row(conn, 4, "legacy v4 (inferred on startup)")?;
        record_version_row(conn, 5, "legacy v5 (inferred on startup)")?;
        return Ok(5);
    }

    if !setting_exists(conn, "active_ai_provider")? {
        eprintln!("[migrations] Legacy DB detected; inferred v6.");
        record_version_row(conn, 1, "legacy v1 (inferred on startup)")?;
        record_version_row(conn, 2, "legacy v2 (inferred on startup)")?;
        record_version_row(conn, 3, "legacy v3 (inferred on startup)")?;
        record_version_row(conn, 4, "legacy v4 (inferred on startup)")?;
        record_version_row(conn, 5, "legacy v5 (inferred on startup)")?;
        record_version_row(conn, 6, "legacy v6 (inferred on startup)")?;
        return Ok(6);
    }

    eprintln!("[migrations] Legacy DB detected; inferred v7.");
    record_version_row(conn, 1, "legacy v1 (inferred on startup)")?;
    record_version_row(conn, 2, "legacy v2 (inferred on startup)")?;
    record_version_row(conn, 3, "legacy v3 (inferred on startup)")?;
    record_version_row(conn, 4, "legacy v4 (inferred on startup)")?;
    record_version_row(conn, 5, "legacy v5 (inferred on startup)")?;
    record_version_row(conn, 6, "legacy v6 (inferred on startup)")?;
    record_version_row(conn, 7, "legacy v7 (inferred on startup)")?;
    Ok(7)
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

    eprintln!(
        "[migrations] Creating pre-migration backup at {:?} …",
        backup_path
    );

    // VACUUM INTO produces a defragmented, fully consistent snapshot.
    let escaped = backup_path.to_string_lossy().replace('\'', "''");
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
    f(&tx).with_context(|| {
        format!(
            "Migration v{} body failed; transaction rolled back",
            version
        )
    })?;

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
                worktree_path TEXT DEFAULT NULL,
                worktree_branch TEXT DEFAULT NULL,
                worktree_status TEXT DEFAULT NULL,
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
            INSERT OR IGNORE INTO settings VALUES ('default_model_codex', 'codex-mini-latest');
            INSERT OR IGNORE INTO settings VALUES ('default_model_claude', 'claude-sonnet-4-6');
            INSERT OR IGNORE INTO settings VALUES ('default_model_opencode', 'gpt-4.1');
            INSERT OR IGNORE INTO settings VALUES ('default_model_copilot', 'gpt-4.1');
            INSERT OR IGNORE INTO settings VALUES ('active_ai_provider', 'claude');
            INSERT OR IGNORE INTO settings VALUES ('theme',              'dark');
            INSERT OR IGNORE INTO settings VALUES ('work_days',          '[1,2,3,4,5]');
            INSERT OR IGNORE INTO settings VALUES ('show_in_tray',       'true');
            INSERT OR IGNORE INTO settings VALUES ('ai_provider',        'claude');

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
        tx.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS projects (
                id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                name       TEXT NOT NULL,
                path       TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);
        ",
        )
        .context("Failed to create projects table")?;

        // ALTER TABLE fails if column already exists; guard with existence check.
        if !column_exists(tx, "tasks", "project_id")? {
            tx.execute_batch("ALTER TABLE tasks ADD COLUMN project_id TEXT DEFAULT NULL;")
                .context("ALTER TABLE tasks ADD COLUMN project_id")?;
        }
        Ok(())
    })
}

fn apply_v3(conn: &mut Connection) -> anyhow::Result<()> {
    with_migration(conn, 3, "Add projects.prompt column", |tx| {
        if !column_exists(tx, "projects", "prompt")? {
            tx.execute_batch("ALTER TABLE projects ADD COLUMN prompt TEXT DEFAULT NULL;")
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

fn apply_v6(conn: &mut Connection) -> anyhow::Result<()> {
    with_migration(conn, 6, "Add per-provider default model settings", |tx| {
        tx.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES ('default_model_codex', 'codex-mini-latest')",
            [],
        )
        .context("Insert default_model_codex setting")?;
        tx.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES ('default_model_claude', 'claude-sonnet-4-6')",
            [],
        )
        .context("Insert default_model_claude setting")?;
        tx.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES ('default_model_opencode', 'gpt-4.1')",
            [],
        )
        .context("Insert default_model_opencode setting")?;
        tx.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES ('default_model_copilot', 'gpt-4.1')",
            [],
        )
        .context("Insert default_model_copilot setting")?;
        Ok(())
    })
}

fn apply_v7(conn: &mut Connection) -> anyhow::Result<()> {
    with_migration(conn, 7, "Add active AI provider setting", |tx| {
        tx.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES ('active_ai_provider', 'claude')",
            [],
        )
        .context("Insert active_ai_provider setting")?;
        Ok(())
    })
}

fn apply_v8(conn: &mut Connection) -> anyhow::Result<()> {
    with_migration(conn, 8, "Remove Pomodoro-only settings", |tx| {
        tx.execute_batch(
            "
            DROP TABLE IF EXISTS pomodoro_sessions;
            DROP TABLE IF EXISTS pomodoro_cycles;
            ",
        )
        .context("Drop legacy Pomodoro tables")?;
        tx.execute(
            "DELETE FROM settings WHERE key = 'pomodoro_work_min'",
            [],
        )
        .context("Delete pomodoro_work_min setting")?;
        tx.execute(
            "DELETE FROM settings WHERE key = 'pomodoro_break_min'",
            [],
        )
        .context("Delete pomodoro_break_min setting")?;
        Ok(())
    })
}

fn apply_v9(conn: &mut Connection) -> anyhow::Result<()> {
    with_migration(conn, 9, "Add backup_sessions table and auto-backup settings", |tx| {
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS backup_sessions (
                id               TEXT PRIMARY KEY,
                created_at       TEXT NOT NULL,
                schema_version   INTEGER NOT NULL DEFAULT 0,
                backup_size      INTEGER NOT NULL DEFAULT 0,
                item_count       INTEGER NOT NULL DEFAULT 0,
                integrity_status TEXT NOT NULL DEFAULT 'unknown',
                checksum         TEXT NOT NULL DEFAULT '',
                file_path        TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_backup_sessions_created ON backup_sessions(created_at);",
        )
        .context("v9 DDL failed")?;

        tx.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES ('backup_enabled', 'true')",
            [],
        )
        .context("Insert backup_enabled setting")?;
        tx.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES ('backup_interval_min', '30')",
            [],
        )
        .context("Insert backup_interval_min setting")?;
        tx.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES ('backup_max_sessions', '10')",
            [],
        )
        .context("Insert backup_max_sessions setting")?;
        Ok(())
    })
}

fn apply_v10(conn: &mut Connection) -> anyhow::Result<()> {
    with_migration(conn, 10, "Optimize builtin templates and add Fix Issue / Implement Feature", |tx| {
        tx.execute_batch("
            UPDATE prompt_templates SET template = 'I have these tasks for today:\n\n[list your tasks here]\n\nPrioritize by impact, estimate durations, flag blockers, and suggest execution order for a focused work session.', variables = '[]' WHERE id = 'builtin-1';

            UPDATE prompt_templates SET template = 'I''m debugging an issue.\n\nProblem: [describe symptom]\nError: [paste error message]\nCode: [paste relevant code]\n\nIdentify the root cause and provide a minimal fix.', variables = '[]' WHERE id = 'builtin-2';

            UPDATE prompt_templates SET template = 'Review the following code for bugs, performance issues, and security vulnerabilities. Suggest specific fixes.\n\n[paste code here]', variables = '[]' WHERE id = 'builtin-3';

            UPDATE prompt_templates SET template = 'Explain [topic] with practical examples.\n\nFocus on: [specific questions].', variables = '[]' WHERE id = 'builtin-4';

            UPDATE prompt_templates SET template = 'Write tests for the following code covering happy path, edge cases, and error cases.\n\n[paste code here]', variables = '[]' WHERE id = 'builtin-5';

            UPDATE prompt_templates SET template = 'Session ending.\n\nCompleted: [what was done]\nPending: [what remains]\n\nSummarize progress, recommend next-session priorities, and capture context to remember.', variables = '[]' WHERE id = 'builtin-6';

            INSERT OR IGNORE INTO prompt_templates (id, name, category, template, variables, is_builtin) VALUES
            ('builtin-7', 'Fix Issue', 'debugging',
             'Fix this issue in the codebase.\n\nSymptom: [describe what''s wrong]\nExpected behavior: [what should happen]\nContext: [relevant files, recent changes]\n\nFind the root cause, implement the fix, and add a test that reproduces the bug and passes after the fix.',
             '[]', 1),
            ('builtin-8', 'Implement Feature', 'coding',
             'Implement this feature.\n\nGoal: [what to build]\nAcceptance criteria: [list requirements]\nContext: [relevant existing code, patterns to follow]\n\nImplement end-to-end with validation, error handling, and tests. Follow existing codebase patterns.',
             '[]', 1);
        ").context("v10 DDL failed")
    })
}

fn apply_v11(conn: &mut Connection) -> anyhow::Result<()> {
    with_migration(conn, 11, "Add devices table for device linking", |tx| {
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS devices (
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL DEFAULT 'Unknown Device',
                last_seen  TEXT DEFAULT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_devices_created ON devices(created_at);",
        )
        .context("v11 DDL failed")
    })
}

fn apply_v12(conn: &mut Connection) -> anyhow::Result<()> {
    with_migration(conn, 12, "V3 refactor: project-centric model", |tx| {
        // 1. Drop session tables
        tx.execute_batch("
            DROP TABLE IF EXISTS focus_sessions;
            DROP TABLE IF EXISTS daily_sessions;
        ").context("Drop session tables")?;

        // 2. Recreate tasks table without session_slot/date, with new columns
        // SQLite requires table recreation for column removal
        tx.execute_batch("
            CREATE TABLE tasks_v3 (
                id              TEXT PRIMARY KEY,
                title           TEXT NOT NULL,
                notes           TEXT DEFAULT '',
                task_type       TEXT NOT NULL DEFAULT 'prompt',
                priority        INTEGER NOT NULL DEFAULT 2,
                status          TEXT NOT NULL DEFAULT 'pending',
                estimated_min   INTEGER DEFAULT NULL,
                actual_min      INTEGER DEFAULT NULL,
                raw_prompt      TEXT DEFAULT NULL,
                improved_prompt TEXT DEFAULT NULL,
                prompt_output   TEXT DEFAULT NULL,
                job_status      TEXT NOT NULL DEFAULT 'idle',
                job_id          TEXT DEFAULT NULL,
                provider        TEXT DEFAULT NULL,
                carried_from    TEXT DEFAULT NULL,
                position        INTEGER NOT NULL DEFAULT 0,
                project_id      TEXT DEFAULT NULL,
                worktree_path   TEXT DEFAULT NULL,
                worktree_branch TEXT DEFAULT NULL,
                worktree_status TEXT DEFAULT NULL,
                created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
                completed_at    TEXT DEFAULT NULL
            );
        ").context("Create tasks_v3")?;

        // 3. Migrate data from old tasks table
        tx.execute_batch("
            INSERT INTO tasks_v3 (id, title, notes, task_type, priority, status,
                estimated_min, actual_min, raw_prompt, improved_prompt,
                carried_from, position, project_id,
                worktree_path, worktree_branch, worktree_status,
                created_at, updated_at, completed_at)
            SELECT id, title, notes, task_type, priority, status,
                estimated_min, actual_min, prompt_used, prompt_result,
                carried_from, position, project_id,
                worktree_path, worktree_branch, worktree_status,
                created_at, updated_at, completed_at
            FROM tasks;

            DROP TABLE tasks;
            ALTER TABLE tasks_v3 RENAME TO tasks;

            CREATE INDEX idx_tasks_status ON tasks(status);
            CREATE INDEX idx_tasks_project ON tasks(project_id);
            CREATE INDEX idx_tasks_job_status ON tasks(job_status);
            CREATE INDEX idx_tasks_created ON tasks(created_at);
        ").context("Migrate tasks data")?;

        // 4. Create prompt_jobs table
        tx.execute_batch("
            CREATE TABLE prompt_jobs (
                id              TEXT PRIMARY KEY,
                task_id         TEXT NOT NULL,
                project_id      TEXT DEFAULT NULL,
                provider        TEXT NOT NULL,
                prompt          TEXT NOT NULL,
                output          TEXT DEFAULT NULL,
                status          TEXT NOT NULL DEFAULT 'queued',
                exit_code       INTEGER DEFAULT NULL,
                worktree_path   TEXT DEFAULT NULL,
                worktree_branch TEXT DEFAULT NULL,
                error_message   TEXT DEFAULT NULL,
                started_at      TEXT DEFAULT NULL,
                finished_at     TEXT DEFAULT NULL,
                created_at      TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX idx_prompt_jobs_status ON prompt_jobs(status);
            CREATE INDEX idx_prompt_jobs_task ON prompt_jobs(task_id);
            CREATE INDEX idx_prompt_jobs_project ON prompt_jobs(project_id);
        ").context("Create prompt_jobs table")?;

        // 5. Clean up session-related settings
        tx.execute_batch("
            DELETE FROM settings WHERE key IN (
                'session1_kickstart', 'planning_end', 'session2_start',
                'warn_before_min', 'work_days'
            );
        ").context("Clean session settings")?;

        // 6. Update daily_reports - remove session focus columns via recreate
        tx.execute_batch("
            CREATE TABLE daily_reports_v3 (
                id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                date            TEXT NOT NULL UNIQUE,
                tasks_planned   INTEGER DEFAULT 0,
                tasks_completed INTEGER DEFAULT 0,
                tasks_skipped   INTEGER DEFAULT 0,
                tasks_carried   INTEGER DEFAULT 0,
                total_focus_min INTEGER DEFAULT 0,
                ai_reflection   TEXT DEFAULT NULL,
                markdown_export TEXT DEFAULT NULL,
                generated_at    TEXT NOT NULL DEFAULT (datetime('now'))
            );

            INSERT INTO daily_reports_v3 (id, date, tasks_planned, tasks_completed,
                tasks_skipped, tasks_carried, total_focus_min,
                ai_reflection, markdown_export, generated_at)
            SELECT id, date, tasks_planned, tasks_completed,
                tasks_skipped, tasks_carried, total_focus_min,
                ai_reflection, markdown_export, generated_at
            FROM daily_reports;

            DROP TABLE daily_reports;
            ALTER TABLE daily_reports_v3 RENAME TO daily_reports;
        ").context("Migrate daily_reports")?;

        Ok(())
    })
}

fn apply_v13(conn: &mut Connection) -> anyhow::Result<()> {
    with_migration(conn, 13, "Add projects.deleted_at for soft-delete/trash", |tx| {
        if !column_exists(tx, "projects", "deleted_at")? {
            tx.execute_batch("ALTER TABLE projects ADD COLUMN deleted_at TEXT DEFAULT NULL;")
                .context("ALTER TABLE projects ADD COLUMN deleted_at")?;
        }
        tx.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON projects(deleted_at);",
        )
        .context("Create idx_projects_deleted_at")?;
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
        conn.execute_batch(
            "
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
        ",
        )
        .unwrap();
    }

    // --- 1. Fresh install ---

    #[test]
    fn test_fresh_install() {
        let mut conn = open_test_db();
        run_migrations(&mut conn, None).unwrap();

        // All expected tables exist (focus_sessions and daily_sessions dropped in v12).
        for tbl in &[
            "tasks",
            "prompt_templates",
            "daily_reports",
            "settings",
            "projects",
            "schema_version",
            "prompt_jobs",
        ] {
            assert!(table_exists(&conn, tbl).unwrap(), "Table '{}' missing", tbl);
        }

        // Session tables must NOT exist after v12.
        assert!(!table_exists(&conn, "focus_sessions").unwrap(), "focus_sessions must be dropped");
        assert!(!table_exists(&conn, "daily_sessions").unwrap(), "daily_sessions must be dropped");

        // New columns added.
        assert!(column_exists(&conn, "tasks", "project_id").unwrap());
        assert!(column_exists(&conn, "tasks", "worktree_path").unwrap());
        assert!(column_exists(&conn, "tasks", "worktree_branch").unwrap());
        assert!(column_exists(&conn, "tasks", "worktree_status").unwrap());
        assert!(column_exists(&conn, "tasks", "raw_prompt").unwrap());
        assert!(column_exists(&conn, "tasks", "improved_prompt").unwrap());
        assert!(column_exists(&conn, "tasks", "job_status").unwrap());
        assert!(column_exists(&conn, "projects", "prompt").unwrap());
        assert!(column_exists(&conn, "projects", "deleted_at").unwrap());

        // Schema version recorded correctly.
        let v: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, SCHEMA_VERSION as i64);

        // 8 builtin templates seeded (6 original + 2 from v10).
        let tmpl_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM prompt_templates WHERE is_builtin=1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tmpl_count, 8);

        // Default settings populated.
        let tz: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key='timezone_offset'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tz, "7");
        assert!(setting_exists(&conn, "default_model_codex").unwrap());
        assert!(setting_exists(&conn, "default_model_claude").unwrap());
        assert!(setting_exists(&conn, "default_model_opencode").unwrap());
        assert!(setting_exists(&conn, "default_model_copilot").unwrap());
        assert!(setting_exists(&conn, "active_ai_provider").unwrap());
        // session1_kickstart must be deleted by v12
        assert!(!setting_exists(&conn, "session1_kickstart").unwrap(), "session1_kickstart must be deleted");
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
            .query_row("SELECT title FROM tasks WHERE id='legacy-1'", [], |r| {
                r.get(0)
            })
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
        assert!(column_exists(&conn, "tasks", "worktree_branch").unwrap());
        assert!(column_exists(&conn, "tasks", "worktree_status").unwrap());
        assert!(column_exists(&conn, "projects", "prompt").unwrap());
        assert!(column_exists(&conn, "projects", "deleted_at").unwrap());

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
            .query_row("SELECT value FROM user_data WHERE id='row1'", [], |r| {
                r.get(0)
            })
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

        // Insert user data using v12 schema (no date/session_slot).
        conn.execute(
            "INSERT INTO tasks (id, title, task_type, priority, \
             status, position, created_at, updated_at) \
             VALUES ('t1','My Task','prompt',1,'pending',0,\
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
            .query_row("SELECT COUNT(*) FROM tasks WHERE id='t1'", [], |r| r.get(0))
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
        assert!(column_exists(&conn, "projects", "deleted_at").unwrap());
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
        assert!(
            result.is_ok(),
            "Future DB version must not crash: {:?}",
            result
        );
    }

    // --- 5d. Edge case: completely empty schema_version (no user tables) ---

    #[test]
    fn test_empty_db_is_fresh_install() {
        let conn = open_test_db();
        // Only bootstrap the version table, add no user tables.
        bootstrap_version_table(&conn).unwrap();

        let version = detect_version(&conn).unwrap();
        assert_eq!(
            version, 0,
            "Empty DB should be detected as v0 (fresh install)"
        );
    }
}
