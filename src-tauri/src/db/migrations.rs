use rusqlite::Connection;
use anyhow::Result;

pub fn run_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch("
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

        INSERT OR IGNORE INTO settings VALUES ('timezone_offset', '7');
        INSERT OR IGNORE INTO settings VALUES ('session1_kickstart', '09:00');
        INSERT OR IGNORE INTO settings VALUES ('planning_end', '11:00');
        INSERT OR IGNORE INTO settings VALUES ('session2_start', '14:00');
        INSERT OR IGNORE INTO settings VALUES ('warn_before_min', '15');
        INSERT OR IGNORE INTO settings VALUES ('autostart', 'false');
        INSERT OR IGNORE INTO settings VALUES ('claude_token_enc', '');
        INSERT OR IGNORE INTO settings VALUES ('claude_model', 'claude-sonnet-4-6');
        INSERT OR IGNORE INTO settings VALUES ('theme', 'dark');
        INSERT OR IGNORE INTO settings VALUES ('work_days', '[1,2,3,4,5]');
        INSERT OR IGNORE INTO settings VALUES ('show_in_tray', 'true');
        INSERT OR IGNORE INTO settings VALUES ('pomodoro_work_min', '25');
        INSERT OR IGNORE INTO settings VALUES ('pomodoro_break_min', '5');
    ")?;

    // Insert built-in prompt templates
    conn.execute_batch("
        INSERT OR IGNORE INTO prompt_templates (id, name, category, template, variables, is_builtin) VALUES
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
    ")?;
    Ok(())
}
