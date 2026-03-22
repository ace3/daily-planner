# Developer Daily Planner — Tauri Desktop App
## Comprehensive Build Plan for Claude Code Agent

> **Target**: A Tauri desktop app that optimizes daily developer workflow, built around Claude Code's 5-hour session model (9 AM and 2 PM resets, UTC+7). Supports Claude Code OAuth token authentication.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Claude Code Session Strategy](#2-claude-code-session-strategy)
3. [Tech Stack](#3-tech-stack)
4. [Project Structure](#4-project-structure)
5. [Database Schema](#5-database-schema)
6. [Feature Specifications](#6-feature-specifications)
   - 6.1 [Morning Kickoff — 9 AM Reminder](#61-morning-kickoff--9-am-reminder)
   - 6.2 [Session Timer & Reset Tracker](#62-session-timer--reset-tracker)
   - 6.3 [Task Manager](#63-task-manager)
   - 6.4 [Claude Code Prompt Builder](#64-claude-code-prompt-builder)
   - 6.5 [Focus Mode](#65-focus-mode)
   - 6.6 [Daily Report](#66-daily-report)
   - 6.7 [Settings & Auth](#67-settings--auth)
7. [Tauri Backend — Rust Implementation](#7-tauri-backend--rust-implementation)
8. [Frontend — React Implementation](#8-frontend--react-implementation)
9. [UI/UX Specifications](#9-uiux-specifications)
10. [Build & Release](#10-build--release)
11. [Implementation Phases](#11-implementation-phases)
12. [File-by-File Implementation Guide](#12-file-by-file-implementation-guide)

---

## 1. Project Overview

### Goals

- Serve as the daily command center for a solo developer
- Maximize productivity within Claude Code's 5-hour session windows (9 AM–2 PM and 2 PM–7 PM, UTC+7)
- Track tasks, notes, and prompts tied to each Claude Code session
- Generate daily reports that reflect real output
- Keep all data local — no cloud sync, no accounts

### Core Session Model

Claude Code Pro resets every **5 hours**. For a developer in **UTC+7** working 9 AM to 7 PM:

| Session | Start | Reset/End | Duration |
|---------|-------|-----------|----------|
| Morning | 9:00 AM | 2:00 PM | 5 hours |
| Afternoon | 2:00 PM | 7:00 PM | 5 hours |

The app is built entirely around these two sessions as the primary productivity unit.

### Key Constraints

- Desktop-only (Tauri — Windows, macOS, Linux)
- Auth via **Claude Code OAuth token** (not Anthropic API key)
- All data stored in local SQLite
- System tray presence with minimal footprint
- Must work offline (only Claude API calls require internet)

---

## 2. Claude Code Session Strategy

### Understanding the 5-Hour Window

Claude Code (Pro plan) provides a usage quota that resets every 5 hours on a rolling basis from first use, or at fixed intervals depending on the plan. This app treats it as two fixed daily sessions anchored to the developer's start time.

### How the App Uses This

**Session 1 (Morning — 9 AM to 2 PM)**
- 9:00 AM OS notification fires: "Morning session starting — plan your day"
- The app opens the Morning Planning view
- Developer plans tasks, writes Claude prompts, sets session goals
- A visible session countdown timer shows remaining time in Session 1
- At 1:45 PM a 15-minute warning notification fires: "Session resets in 15 min — wrap up or queue next prompt"
- At 2:00 PM the session counter resets; Session 2 begins

**Session 2 (Afternoon — 2 PM to 7 PM)**
- 2:00 PM notification: "Afternoon session started — pick your next task"
- Developer loads queued tasks or plans new ones
- At 6:45 PM a wrap-up warning fires
- At 7:00 PM the app prompts for end-of-day report generation

### Claude Code OAuth Token

Claude Code uses an OAuth-based login flow rather than a simple API key. The token is stored locally by Claude Code in:

- **macOS/Linux**: `~/.claude/` directory (commonly `~/.claude/.credentials.json` or similar)
- **Windows**: `%APPDATA%\Claude\` or similar

The app will:
1. Let the user paste their OAuth token manually in Settings, OR
2. Attempt to auto-detect it from the Claude Code credential file path
3. Store it encrypted in the app's local config (using Tauri's `tauri-plugin-store` with AES encryption via the Rust backend)
4. Use it as a Bearer token in API calls to `https://api.claude.ai/` or the Claude Code endpoint

**Token format used in API calls:**
```
Authorization: Bearer <oauth_token>
```

**Model to use for in-app Claude calls**: `claude-sonnet-4-5` (fast, cost-effective for planning tasks)

---

## 3. Tech Stack

### Frontend
- **Framework**: React 18 with TypeScript
- **Styling**: Tailwind CSS v3
- **State Management**: Zustand (lightweight, no boilerplate)
- **Routing**: React Router v6 (hash routing for Tauri)
- **Charts**: Recharts (for daily report visualizations)
- **Date handling**: date-fns with timezone support
- **Icons**: Lucide React

### Backend (Rust / Tauri)
- **Tauri**: v2 (latest stable)
- **Database**: SQLite via `rusqlite` crate
- **Scheduler**: `tokio-cron-scheduler` for UTC+7 time-based notifications
- **HTTP client**: `reqwest` (for Claude API calls from Rust side)
- **Encryption**: `aes-gcm` crate for token encryption at rest
- **System tray**: Tauri's built-in tray plugin
- **Notifications**: `tauri-plugin-notification`
- **Store**: `tauri-plugin-store` for key-value config

### Tauri Plugins Required
```toml
tauri-plugin-notification = "2"
tauri-plugin-store = "2"
tauri-plugin-autostart = "2"
tauri-plugin-shell = "2"
tauri-plugin-window-state = "2"
```

---

## 4. Project Structure

```
dev-daily-planner/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   │   └── default.json
│   └── src/
│       ├── main.rs                  # App entry point
│       ├── lib.rs                   # Tauri builder & plugin setup
│       ├── db/
│       │   ├── mod.rs               # DB module exports
│       │   ├── connection.rs        # SQLite connection pool
│       │   ├── migrations.rs        # Schema migrations
│       │   └── queries.rs           # All SQL query functions
│       ├── commands/
│       │   ├── mod.rs               # Command module exports
│       │   ├── tasks.rs             # Task CRUD commands
│       │   ├── sessions.rs          # Session management commands
│       │   ├── reports.rs           # Report generation commands
│       │   ├── claude.rs            # Claude API proxy commands
│       │   └── settings.rs          # Settings & auth commands
│       ├── scheduler/
│       │   ├── mod.rs               # Scheduler module
│       │   └── jobs.rs              # Cron job definitions (9AM, 1:45PM, 2PM, 6:45PM, 7PM)
│       ├── tray/
│       │   └── mod.rs               # System tray setup & menu
│       └── crypto/
│           └── mod.rs               # Token encryption/decryption
│
├── src/
│   ├── main.tsx                     # React entry point
│   ├── App.tsx                      # Root component with router
│   ├── index.css                    # Tailwind base styles
│   │
│   ├── stores/
│   │   ├── taskStore.ts             # Zustand task state
│   │   ├── sessionStore.ts          # Session timer state
│   │   ├── settingsStore.ts         # Settings state
│   │   └── reportStore.ts           # Report data state
│   │
│   ├── pages/
│   │   ├── Dashboard.tsx            # Main view (today's tasks + session timer)
│   │   ├── MorningPlanning.tsx      # Morning kickoff modal/page
│   │   ├── FocusMode.tsx            # Distraction-free task view
│   │   ├── Reports.tsx              # Daily/weekly report view
│   │   └── Settings.tsx             # App settings & auth
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx          # Nav sidebar
│   │   │   └── TopBar.tsx           # Session timer + current task
│   │   ├── session/
│   │   │   ├── SessionTimer.tsx     # Countdown to next reset
│   │   │   ├── SessionBadge.tsx     # "Session 1" / "Session 2" indicator
│   │   │   └── SessionWarning.tsx   # 15-min warning banner
│   │   ├── tasks/
│   │   │   ├── TaskList.tsx         # Full task list
│   │   │   ├── TaskItem.tsx         # Single task row
│   │   │   ├── TaskForm.tsx         # Create/edit task form
│   │   │   ├── TaskNotes.tsx        # Expandable notes panel
│   │   │   └── TaskFilters.tsx      # Filter by session, status, type
│   │   ├── claude/
│   │   │   ├── PromptBuilder.tsx    # Structured prompt builder
│   │   │   ├── PromptTemplates.tsx  # Preset prompt templates
│   │   │   ├── QuickPrompt.tsx      # Floating mini prompt window
│   │   │   └── ClaudeResponse.tsx   # Rendered Claude response
│   │   ├── reports/
│   │   │   ├── DailyReport.tsx      # Daily summary view
│   │   │   ├── WeeklyChart.tsx      # Weekly productivity chart
│   │   │   ├── StreakCalendar.tsx   # Contribution-style calendar
│   │   │   └── ReportExport.tsx     # Export as markdown/text
│   │   └── ui/
│   │       ├── Button.tsx
│   │       ├── Input.tsx
│   │       ├── Modal.tsx
│   │       ├── Badge.tsx
│   │       ├── Tooltip.tsx
│   │       └── Toast.tsx
│   │
│   ├── hooks/
│   │   ├── useSessionTimer.ts       # Session countdown logic
│   │   ├── useNotifications.ts      # Notification permission/sending
│   │   ├── useClaude.ts             # Claude API hook
│   │   └── useKeyboardShortcuts.ts  # Global hotkey bindings
│   │
│   ├── lib/
│   │   ├── tauri.ts                 # Tauri invoke wrappers (typed)
│   │   ├── time.ts                  # UTC+7 time utilities
│   │   ├── session.ts               # Session window calculations
│   │   └── markdown.ts              # Markdown rendering helpers
│   │
│   └── types/
│       ├── task.ts
│       ├── session.ts
│       ├── report.ts
│       └── settings.ts
│
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts
└── README.md
```

---

## 5. Database Schema

All tables stored in a single SQLite file at: `{app_data_dir}/planner.db`

```sql
-- ============================================================
-- TASKS
-- ============================================================
CREATE TABLE tasks (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  date          TEXT NOT NULL,          -- ISO date 'YYYY-MM-DD' (UTC+7 local date)
  session_slot  INTEGER NOT NULL,       -- 1 = morning (9AM-2PM), 2 = afternoon (2PM-7PM)
  title         TEXT NOT NULL,
  notes         TEXT DEFAULT '',        -- Freeform: prompt drafts, research links, context
  task_type     TEXT NOT NULL DEFAULT 'code',
                                        -- 'code' | 'research' | 'prompt' | 'meeting' | 'review' | 'other'
  priority      INTEGER NOT NULL DEFAULT 2,
                                        -- 1=high, 2=medium, 3=low
  status        TEXT NOT NULL DEFAULT 'pending',
                                        -- 'pending' | 'in_progress' | 'done' | 'skipped' | 'carried_over'
  estimated_min INTEGER DEFAULT NULL,   -- Developer's time estimate in minutes
  actual_min    INTEGER DEFAULT NULL,   -- Auto-tracked actual time (from focus sessions)
  prompt_used   TEXT DEFAULT NULL,      -- Final Claude prompt that was sent
  prompt_result TEXT DEFAULT NULL,      -- Claude's response (optional, user can save)
  carried_from  TEXT DEFAULT NULL,      -- References id of task this was carried over from
  position      INTEGER NOT NULL DEFAULT 0, -- Display order within the day
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at  TEXT DEFAULT NULL
);

CREATE INDEX idx_tasks_date ON tasks(date);
CREATE INDEX idx_tasks_date_session ON tasks(date, session_slot);
CREATE INDEX idx_tasks_status ON tasks(status);

-- ============================================================
-- FOCUS SESSIONS (Pomodoro / work blocks)
-- ============================================================
CREATE TABLE focus_sessions (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  started_at  TEXT NOT NULL,            -- ISO datetime
  ended_at    TEXT DEFAULT NULL,        -- NULL = session still running
  duration_min INTEGER DEFAULT NULL,    -- Computed on end
  notes       TEXT DEFAULT '',          -- Scratch pad during focus
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE INDEX idx_focus_task ON focus_sessions(task_id);
CREATE INDEX idx_focus_date ON focus_sessions(date);

-- ============================================================
-- DAILY SESSIONS (Claude Code session windows)
-- ============================================================
CREATE TABLE daily_sessions (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  date            TEXT NOT NULL,
  session_slot    INTEGER NOT NULL,     -- 1 or 2
  started_at      TEXT NOT NULL,        -- When the session window opened (9AM or 2PM)
  tasks_planned   INTEGER DEFAULT 0,
  tasks_completed INTEGER DEFAULT 0,
  tasks_skipped   INTEGER DEFAULT 0,
  focus_minutes   INTEGER DEFAULT 0,    -- Total focused work time in this session
  notes           TEXT DEFAULT '',      -- Session-level notes
  UNIQUE(date, session_slot)
);

-- ============================================================
-- PROMPT TEMPLATES
-- ============================================================
CREATE TABLE prompt_templates (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name        TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'general',
                                        -- 'planning' | 'debugging' | 'code-review' | 'research' | 'general'
  template    TEXT NOT NULL,            -- Template with {{variable}} placeholders
  variables   TEXT NOT NULL DEFAULT '[]', -- JSON array of variable names
  is_builtin  INTEGER NOT NULL DEFAULT 0,  -- 1 = shipped with app, 0 = user-created
  use_count   INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- DAILY REPORTS
-- ============================================================
CREATE TABLE daily_reports (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  date              TEXT NOT NULL UNIQUE,
  tasks_planned     INTEGER DEFAULT 0,
  tasks_completed   INTEGER DEFAULT 0,
  tasks_skipped     INTEGER DEFAULT 0,
  tasks_carried     INTEGER DEFAULT 0,
  total_focus_min   INTEGER DEFAULT 0,
  session1_focus    INTEGER DEFAULT 0,
  session2_focus    INTEGER DEFAULT 0,
  ai_reflection     TEXT DEFAULT NULL,  -- Claude-generated end-of-day summary
  markdown_export   TEXT DEFAULT NULL,  -- Cached markdown for export
  generated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- SETTINGS (single-row config table)
-- ============================================================
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Default settings inserted on first run:
-- key: 'timezone_offset'    value: '+7'
-- key: 'session1_start'     value: '09:00'
-- key: 'session2_start'     value: '14:00'
-- key: 'warn_before_min'    value: '15'
-- key: 'autostart'          value: 'false'
-- key: 'claude_token_enc'   value: ''        (AES-encrypted OAuth token)
-- key: 'claude_model'       value: 'claude-sonnet-4-5'
-- key: 'theme'              value: 'system'
-- key: 'work_days'          value: '[1,2,3,4,5]'  (Mon-Fri)
-- key: 'show_in_tray'       value: 'true'
```

---

## 6. Feature Specifications

### 6.1 Morning Kickoff — 9 AM Reminder

**Trigger**: Cron job fires at 09:00 in UTC+7 (01:00 UTC) on configured work days.

**Behavior**:
1. OS notification appears: title "Good morning 🌅", body "Session 1 starts now — plan your day"
2. Clicking notification brings the app window to focus (if minimized to tray)
3. If the app is closed, it is NOT auto-opened — notification is the nudge only
4. Inside the app, a **Morning Planning Modal** automatically opens on first load after 9 AM

**Morning Planning Modal content**:
- Greeting with current date and session info
- "Yesterday's unfinished tasks" section — shows carried-over tasks from prior day
- Quick task input: type tasks for Session 1 rapidly, one per line, then hit "Add All"
- A "Start with Claude" button that opens the Prompt Builder pre-filled with a "Plan my day" template
- A "Jump to Focus" button to skip planning and start working immediately

**Notification schedule for weekdays (UTC+7)**:
```
09:00  — Session 1 start
13:45  — Session 1 warning: "15 minutes until reset — wrap up"
14:00  — Session 2 start
18:45  — Session 2 warning: "15 minutes left — finish or queue for tomorrow"
19:00  — End of day: "Great work! Generate your daily report?"
```

---

### 6.2 Session Timer & Reset Tracker

This is the most prominent UI element — always visible in the top bar.

**Display**:
```
[Session 1 of 2]  [▶ 3:42:15 remaining]  [████████░░░░░░░░░░░░ 47%]
```

**Logic** (`src/lib/session.ts`):
```typescript
// Session windows (UTC+7)
const SESSION_WINDOWS = [
  { slot: 1, start: '09:00', end: '14:00' },
  { slot: 2, start: '14:00', end: '19:00' },
];

// getCurrentSession(): returns active session or null if outside work hours
// getTimeToNextReset(): returns seconds until next session boundary
// getSessionProgress(): returns 0-100 float for progress bar
// isWorkHour(): returns boolean — is it currently within a session window?
```

**States**:
- **Before 9 AM**: "Session starts at 9:00 AM" with countdown to start
- **Session 1 active**: Live countdown from 5:00:00 down to 0:00:00
- **Session 2 active**: Same, for afternoon window
- **After 7 PM**: "Great work today! Session ended." with link to daily report
- **Weekend**: "Enjoy your weekend 🎉" — no timers, app still usable

**Warning state**: When < 15 minutes remain, the timer turns amber and shows a pulsing dot. A toast notification appears inside the app as well.

**Reset animation**: At exactly 2:00 PM, the timer resets with a brief "Session 2 starting!" animation and the progress bar fills back to full.

---

### 6.3 Task Manager

**Core data model** (TypeScript):
```typescript
interface Task {
  id: string;
  date: string;          // YYYY-MM-DD local date
  sessionSlot: 1 | 2;
  title: string;
  notes: string;
  taskType: 'code' | 'research' | 'prompt' | 'meeting' | 'review' | 'other';
  priority: 1 | 2 | 3;
  status: 'pending' | 'in_progress' | 'done' | 'skipped' | 'carried_over';
  estimatedMin: number | null;
  actualMin: number | null;
  promptUsed: string | null;
  promptResult: string | null;
  carriedFrom: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}
```

**Task List UI**:
- Grouped by session slot (Session 1 / Session 2)
- Within each group: ordered by priority then position (drag to reorder)
- Each task row shows: status checkbox, title, type badge, priority dot, estimated time, notes indicator
- Click row to expand inline notes panel
- Right-click context menu: Mark done, Skip, Carry to tomorrow, Delete, Duplicate

**Task actions**:

| Action | Behavior |
|--------|----------|
| Mark done | Sets status=done, records completedAt, calculates actual_min from focus sessions |
| Skip | Sets status=skipped — stays visible but grayed out |
| Carry over | Creates a new task for tomorrow with carriedFrom=this.id, marks this as carried_over |
| Focus | Opens Focus Mode with this task active |
| Add to Claude | Opens Prompt Builder with task title/notes pre-populated |

**Task notes panel** (expands inline below task row):
- Full markdown editor (textarea with preview toggle)
- "Build Prompt" button — opens Prompt Builder with notes as context
- "Attach Claude response" — paste area to save Claude's output to this task
- Research links section — paste URLs, they render as titled links
- Time tracker button — start/stop a focus timer for this specific task

**Quick add**: A persistent input at the bottom of each session group. Hit Enter to add a task, Tab to add another. Type `#` to prefix task type: `#code Build authentication` auto-sets type to 'code'.

**Keyboard shortcuts**:
```
N          — New task (Session 1 by default)
Shift+N    — New task (Session 2)
Enter      — Mark selected task done
S          — Skip selected task
F          — Focus mode for selected task
Cmd+Enter  — Open Prompt Builder for selected task
```

---

### 6.4 Claude Code Prompt Builder

A structured interface for composing, refining, and sending prompts to Claude — designed around developer use cases.

**Prompt Builder view**:

```
┌─────────────────────────────────────────────────────┐
│ PROMPT BUILDER                          [Templates ▼]│
├─────────────────────────────────────────────────────┤
│ Context (auto-filled from task notes)               │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Working on: authentication middleware            │ │
│ │ Tech: Node.js, Express, JWT                     │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ Task / Goal                                         │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Implement refresh token rotation with Redis...  │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ Constraints (optional)                              │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Must work with existing User model schema       │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ Output format: [Code + Explanation ▼]               │
│                                                     │
│ ──── Assembled Prompt ────────────────────────────  │
│ [preview of final prompt]                           │
│                                                     │
│        [Copy to Clipboard]  [Send to Claude]        │
└─────────────────────────────────────────────────────┘
```

**Built-in prompt templates**:

```typescript
const BUILTIN_TEMPLATES = [
  {
    name: "Plan my day",
    category: "planning",
    template: `I'm a developer starting my work session. Here are my tasks for today:
{{task_list}}

Session time available: {{session_duration}} hours.
Please help me prioritize these tasks, suggest a time allocation, and flag any that might need to be broken down into smaller steps.`
  },
  {
    name: "Debug this issue",
    category: "debugging",
    template: `I'm debugging an issue in my code.

**Problem description**: {{problem}}
**Error message**: {{error}}
**Relevant code**:
\`\`\`{{language}}
{{code}}
\`\`\`

**What I've tried**: {{attempts}}

Please analyze the issue and suggest solutions.`
  },
  {
    name: "Code review",
    category: "code-review",
    template: `Please review this code for correctness, performance, and best practices:

\`\`\`{{language}}
{{code}}
\`\`\`

Focus on: {{focus_areas}}`
  },
  {
    name: "Write tests",
    category: "code",
    template: `Write comprehensive tests for the following function/module:

\`\`\`{{language}}
{{code}}
\`\`\`

Use {{test_framework}}. Include: unit tests, edge cases, and any integration tests where appropriate.`
  },
  {
    name: "Research summary",
    category: "research",
    template: `Research topic: {{topic}}

Please provide a concise technical summary covering:
1. Core concept and how it works
2. Key use cases and tradeoffs
3. Best practices
4. Recommended resources for deeper reading

Context: I need this to {{use_case}}`
  },
  {
    name: "End-of-day reflection",
    category: "planning",
    template: `Here's my work log for today ({{date}}):

**Completed**: {{completed_tasks}}
**Skipped**: {{skipped_tasks}}
**Time logged**: {{total_minutes}} minutes

Please write a brief daily summary I can save, highlight any patterns you notice, and suggest priorities for tomorrow.`
  },
];
```

**Send to Claude behavior**:
1. Assembles final prompt from fields
2. Calls Rust `send_claude_prompt` command with the OAuth token
3. Streams response back (using Tauri event system for streaming)
4. Renders response in a panel below the prompt
5. "Save to task" button attaches the response to the current task's `promptResult` field
6. "Copy" button copies just the response

**Claude API call (Rust side)**:
```rust
// Uses the Claude Code OAuth token as Bearer auth
// Calls the standard Anthropic messages endpoint
// Model: claude-sonnet-4-5 (configurable)
// Streaming: yes, via SSE — events forwarded to frontend via Tauri emit
```

---

### 6.5 Focus Mode

A minimal, distraction-free view activated when working on a specific task.

**Layout**:
```
┌─────────────────────────────────────────────────────┐
│  ← Exit Focus          Session 1  |  2:34:15 left   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  [CODE]  HIGH PRIORITY                              │
│  Build authentication middleware                    │
│                                                     │
│  Notes:                                             │
│  - Implement refresh token rotation                 │
│  - Redis for token storage                         │
│                                                     │
│  ┌─────────────── Pomodoro ──────────────────────┐  │
│  │            25:00  [Work]                      │  │
│  │         ● ● ● ○  (3 of 4 pomodoros)          │  │
│  │  [▶ Start]   [Skip Break]   [Reset]           │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  Scratch Pad:                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │ type notes here...                              │ │
│  └─────────────────────────────────────────────────┘ │
│                                                     │
│  [✓ Mark Done]  [→ Skip]  [⚡ Quick Claude]         │
└─────────────────────────────────────────────────────┘
```

**Pomodoro configuration** (in Settings):
- Work interval: default 25 min (configurable: 15, 20, 25, 30, 45, 60)
- Short break: default 5 min
- Long break: default 15 min (after every 4 pomodoros)
- Auto-start breaks: toggle

**Time tracking**:
- Timer starts on "▶ Start"
- Each completed pomodoro adds to the task's `actualMin` and the daily focus total
- Pausing does not count time
- Interruptions can be logged (simple count, for report)

**Quick Claude** (floating mini-window):
- `Cmd+Shift+C` (or configurable hotkey) opens a compact Claude chat overlay
- Does not exit Focus Mode
- Limited to 3 exchanges to stay focused
- Pre-filled with current task context

---

### 6.6 Daily Report

Generated on-demand or triggered by the 7 PM end-of-day notification.

**Report sections**:

**Header**
```
Daily Work Report — Tuesday, March 18, 2025
Session 1: 9:00 AM → 2:00 PM  |  Session 2: 2:00 PM → 7:00 PM
```

**Summary stats** (shown as metric cards):
- Tasks planned: 8
- Tasks completed: 6 (75%)
- Tasks skipped: 1
- Carried to tomorrow: 1
- Total focus time: 4h 20m
- Session 1 focus: 2h 45m
- Session 2 focus: 1h 35m

**Task breakdown** (grouped by session, then by type):
```
Session 1 — Morning
  ✅ [CODE]    Build authentication middleware      45 min
  ✅ [CODE]    Fix pagination bug in user list     20 min
  ✅ [REVIEW]  Code review: PR #142                15 min
  ⏭  [MEETING] Sync with design team               —

Session 2 — Afternoon
  ✅ [PROMPT]  Draft API documentation             30 min
  ✅ [CODE]    Write unit tests for auth module    55 min
  → [CODE]    Deploy to staging            (carried to tomorrow)
```

**AI Reflection** (optional, requires Claude token):
- Button: "Generate AI Reflection"
- Sends day summary to Claude
- Returns 2-3 paragraph narrative + tomorrow's suggested priorities
- Saved to `daily_reports.ai_reflection`

**Weekly trend** (small bar chart, Recharts):
- 7-day view showing: tasks completed per day, focus time per day
- Streak indicator (consecutive productive days)

**Export options**:
- Copy as Markdown
- Save as `.md` file
- (Future: share via Slack/email)

**Export format**:
```markdown
# Daily Report — 2025-03-18

## Summary
- Tasks completed: 6/8 (75%)
- Focus time: 4h 20m
- Sessions used: 2/2

## Session 1 (9:00 AM – 2:00 PM)
- ✅ Build authentication middleware (45 min) [code]
- ✅ Fix pagination bug (20 min) [code]
...

## Reflection
[AI-generated or manual notes]
```

---

### 6.7 Settings & Auth

**Settings page sections**:

**Claude Code Authentication**
- Token type: OAuth (Claude Code) — readonly label
- Token input: password field (obscured), shows "Connected ✓" or "Not connected ✗"
- Auto-detect button: scans `~/.claude/` for credential files
- Test connection button: sends a minimal API call to verify
- Token is stored AES-256-GCM encrypted in the SQLite settings table

**Session Configuration**
- Session 1 start time: time picker (default 09:00)
- Session 2 start time: time picker (default 14:00)
- Session duration: display-only "5 hours" (locked to Claude Code model)
- Warning before reset: number input in minutes (default 15)
- Timezone: display-only "UTC+7 (Asia/Bangkok)" — auto-detected from system

**Work Days**
- Checkboxes for Monday–Sunday (default: Mon–Fri checked)

**Notifications**
- Enable OS notifications: toggle
- Morning reminder: toggle + time override
- Session reset alerts: toggle
- End-of-day report prompt: toggle
- Notification permission status: shown with "Request Permission" button if not granted

**Pomodoro**
- Work interval: select (15/20/25/30/45/60 min)
- Short break: select (3/5/10 min)
- Long break: select (10/15/20 min)
- Auto-start breaks: toggle

**App Behavior**
- Launch at system startup: toggle (uses `tauri-plugin-autostart`)
- Minimize to system tray on close: toggle
- Theme: System / Light / Dark select

**Data Management**
- Database location: shows path, "Open folder" button
- Export all data: exports full SQLite as JSON
- Clear today's data: dangerous action with confirmation
- Reset all data: very dangerous, double confirmation required

---

## 7. Tauri Backend — Rust Implementation

### 7.1 `src-tauri/src/main.rs`

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    dev_daily_planner_lib::run();
}
```

### 7.2 `src-tauri/src/lib.rs`

```rust
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            // Initialize database
            db::connection::init_db(app.handle())?;

            // Start scheduler (notifications cron)
            scheduler::jobs::start_scheduler(app.handle().clone());

            // Setup system tray
            tray::setup_tray(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Tasks
            commands::tasks::get_tasks,
            commands::tasks::create_task,
            commands::tasks::update_task,
            commands::tasks::delete_task,
            commands::tasks::reorder_tasks,
            commands::tasks::carry_task_forward,
            // Sessions
            commands::sessions::get_session_info,
            commands::sessions::get_daily_session,
            commands::sessions::update_daily_session,
            // Reports
            commands::reports::get_daily_report,
            commands::reports::generate_report,
            commands::reports::export_report_markdown,
            // Claude
            commands::claude::send_prompt,
            commands::claude::test_connection,
            commands::claude::detect_claude_token,
            // Settings
            commands::settings::get_settings,
            commands::settings::update_setting,
            commands::settings::save_claude_token,
            commands::settings::get_claude_token,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 7.3 `src-tauri/src/db/migrations.rs`

The database module runs migrations on startup. Each migration is versioned and idempotent.

```rust
pub fn run_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
    ")?;

    let version: i64 = conn
        .query_row("SELECT COALESCE(MAX(version), 0) FROM schema_version", [], |r| r.get(0))
        .unwrap_or(0);

    if version < 1 {
        conn.execute_batch(MIGRATION_001)?;
        conn.execute("INSERT INTO schema_version VALUES (1)", [])?;
    }
    // Add future migrations here: if version < 2 { ... }

    Ok(())
}

const MIGRATION_001: &str = "
    CREATE TABLE IF NOT EXISTS tasks ( ... );
    CREATE TABLE IF NOT EXISTS focus_sessions ( ... );
    CREATE TABLE IF NOT EXISTS daily_sessions ( ... );
    CREATE TABLE IF NOT EXISTS prompt_templates ( ... );
    CREATE TABLE IF NOT EXISTS daily_reports ( ... );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

    INSERT OR IGNORE INTO settings VALUES
        ('timezone_offset', '+7'),
        ('session1_start', '09:00'),
        ('session2_start', '14:00'),
        ('warn_before_min', '15'),
        ('autostart', 'false'),
        ('claude_token_enc', ''),
        ('claude_model', 'claude-sonnet-4-5'),
        ('theme', 'system'),
        ('work_days', '[1,2,3,4,5]'),
        ('show_in_tray', 'true');
";
```

### 7.4 `src-tauri/src/commands/claude.rs`

```rust
use tauri::{AppHandle, Emitter};
use reqwest::Client;
use serde_json::json;

#[tauri::command]
pub async fn send_prompt(
    app: AppHandle,
    prompt: String,
    model: String,
    task_id: Option<String>,
) -> Result<String, String> {
    let token = get_decrypted_token(&app)?;

    let client = Client::new();
    let body = json!({
        "model": model,
        "max_tokens": 4096,
        "stream": true,
        "messages": [
            { "role": "user", "content": prompt }
        ]
    });

    // POST to Anthropic API with OAuth Bearer token
    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("Authorization", format!("Bearer {}", token))
        .header("anthropic-version", "2023-06-01")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    // Stream SSE events back to frontend via Tauri events
    let mut full_response = String::new();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&chunk);

        // Parse SSE data events
        for line in text.lines() {
            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" { break; }
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(delta_text) = v["delta"]["text"].as_str() {
                        full_response.push_str(delta_text);
                        // Emit chunk to frontend
                        app.emit("claude-stream-chunk", delta_text).ok();
                    }
                }
            }
        }
    }

    app.emit("claude-stream-done", &full_response).ok();
    Ok(full_response)
}

#[tauri::command]
pub async fn detect_claude_token(app: AppHandle) -> Result<String, String> {
    // Try common Claude Code credential paths
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let candidates = vec![
        home.join(".claude").join(".credentials.json"),
        home.join(".claude").join("credentials.json"),
        home.join(".config").join("claude").join("credentials.json"),
    ];

    for path in candidates {
        if path.exists() {
            let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
            // Parse JSON and extract token
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(token) = v["oauth_token"].as_str()
                    .or_else(|| v["access_token"].as_str())
                    .or_else(|| v["token"].as_str()) {
                    return Ok(token.to_string());
                }
            }
        }
    }

    Err("Claude Code credentials not found. Please paste your token manually.".to_string())
}
```

### 7.5 `src-tauri/src/scheduler/jobs.rs`

```rust
use tokio_cron_scheduler::{Job, JobScheduler};
use chrono_tz::Asia::Bangkok; // UTC+7

pub fn start_scheduler(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let scheduler = JobScheduler::new().await.unwrap();

        // 9:00 AM UTC+7 = 2:00 AM UTC = "0 0 2 * * Mon-Fri"
        // Session 1 start
        scheduler.add(Job::new_async("0 0 2 * * Mon,Tue,Wed,Thu,Fri", {
            let app = app.clone();
            move |_, _| {
                let app = app.clone();
                Box::pin(async move {
                    send_notification(&app, "Session 1 Starting 🌅",
                        "Good morning! Plan your day and start your first Claude Code session.");
                    app.emit("session-started", 1).ok();
                })
            }
        }).unwrap());

        // 1:45 PM UTC+7 = 6:45 AM UTC — Session 1 warning
        scheduler.add(Job::new_async("0 45 6 * * Mon,Tue,Wed,Thu,Fri", {
            let app = app.clone();
            move |_, _| {
                let app = app.clone();
                Box::pin(async move {
                    send_notification(&app, "⚠️ Session Reset in 15 min",
                        "Wrap up your current work — Session 1 resets at 2:00 PM.");
                    app.emit("session-warning", 1).ok();
                })
            }
        }).unwrap());

        // 2:00 PM UTC+7 = 7:00 AM UTC — Session 2 start
        scheduler.add(Job::new_async("0 0 7 * * Mon,Tue,Wed,Thu,Fri", {
            let app = app.clone();
            move |_, _| {
                let app = app.clone();
                Box::pin(async move {
                    send_notification(&app, "Session 2 Starting 🚀",
                        "Afternoon session unlocked! Your Claude Code quota has reset.");
                    app.emit("session-started", 2).ok();
                })
            }
        }).unwrap());

        // 6:45 PM UTC+7 = 11:45 AM UTC — Session 2 warning
        scheduler.add(Job::new_async("0 45 11 * * Mon,Tue,Wed,Thu,Fri", {
            let app = app.clone();
            move |_, _| {
                let app = app.clone();
                Box::pin(async move {
                    send_notification(&app, "⚠️ 15 min left in Session 2",
                        "Finish up or queue tasks for tomorrow.");
                    app.emit("session-warning", 2).ok();
                })
            }
        }).unwrap());

        // 7:00 PM UTC+7 = 12:00 PM UTC — End of day
        scheduler.add(Job::new_async("0 0 12 * * Mon,Tue,Wed,Thu,Fri", {
            let app = app.clone();
            move |_, _| {
                let app = app.clone();
                Box::pin(async move {
                    send_notification(&app, "Day Complete! 🎉",
                        "Your sessions are done. Generate your daily report?");
                    app.emit("day-ended", ()).ok();
                })
            }
        }).unwrap());

        scheduler.start().await.unwrap();

        // Keep scheduler alive
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
        }
    });
}

fn send_notification(app: &tauri::AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .ok();
}
```

### 7.6 `src-tauri/src/crypto/mod.rs`

```rust
use aes_gcm::{Aes256Gcm, Key, Nonce, aead::{Aead, KeyInit, OsRng, rand_core::RngCore}};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};

// Derive a machine-specific key from system info (hostname + username)
// This ensures the token is useless if the DB file is copied to another machine
fn derive_key() -> [u8; 32] {
    let machine_id = format!("{}-{}", hostname::get().unwrap().to_string_lossy(), whoami::username());
    let mut key = [0u8; 32];
    let bytes = machine_id.as_bytes();
    for (i, b) in key.iter_mut().enumerate() {
        *b = bytes[i % bytes.len()].wrapping_add(i as u8);
    }
    key
}

pub fn encrypt_token(plaintext: &str) -> Result<String, String> {
    let key = Key::<Aes256Gcm>::from_slice(&derive_key());
    let cipher = Aes256Gcm::new(key);
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher.encrypt(nonce, plaintext.as_bytes()).map_err(|e| e.to_string())?;
    let combined = [nonce_bytes.as_slice(), ciphertext.as_slice()].concat();
    Ok(BASE64.encode(combined))
}

pub fn decrypt_token(encoded: &str) -> Result<String, String> {
    let combined = BASE64.decode(encoded).map_err(|e| e.to_string())?;
    if combined.len() < 12 { return Err("Invalid token data".to_string()); }
    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let key = Key::<Aes256Gcm>::from_slice(&derive_key());
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(nonce_bytes);
    let plaintext = cipher.decrypt(nonce, ciphertext).map_err(|e| e.to_string())?;
    String::from_utf8(plaintext).map_err(|e| e.to_string())
}
```

---

## 8. Frontend — React Implementation

### 8.1 `src/lib/session.ts` — Session Time Utilities

```typescript
import { format, parseISO } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

const TIMEZONE = 'Asia/Bangkok'; // UTC+7

export interface SessionWindow {
  slot: 1 | 2;
  startHour: number;
  startMin: number;
  endHour: number;
  endMin: number;
  label: string;
}

export const SESSION_WINDOWS: SessionWindow[] = [
  { slot: 1, startHour: 9,  startMin: 0, endHour: 14, endMin: 0, label: 'Morning' },
  { slot: 2, startHour: 14, startMin: 0, endHour: 19, endMin: 0, label: 'Afternoon' },
];

export function getCurrentLocalTime(): Date {
  return toZonedTime(new Date(), TIMEZONE);
}

export function getCurrentSession(): SessionWindow | null {
  const now = getCurrentLocalTime();
  const h = now.getHours();
  const m = now.getMinutes();
  const totalMins = h * 60 + m;

  for (const session of SESSION_WINDOWS) {
    const start = session.startHour * 60 + session.startMin;
    const end = session.endHour * 60 + session.endMin;
    if (totalMins >= start && totalMins < end) return session;
  }
  return null;
}

export function getSecondsUntilNextEvent(): {
  seconds: number;
  event: 'session-start' | 'session-reset' | 'session-warning' | 'day-end' | 'next-day';
  sessionSlot?: 1 | 2;
} {
  const now = getCurrentLocalTime();
  const h = now.getHours();
  const m = now.getMinutes();
  const s = now.getSeconds();
  const totalSecs = h * 3600 + m * 60 + s;

  const events = [
    { timeSecs: 9 * 3600,              event: 'session-start',   sessionSlot: 1 },
    { timeSecs: (14 - 0.25) * 3600,    event: 'session-warning', sessionSlot: 1 },
    { timeSecs: 14 * 3600,             event: 'session-reset',   sessionSlot: 2 },
    { timeSecs: (19 - 0.25) * 3600,    event: 'session-warning', sessionSlot: 2 },
    { timeSecs: 19 * 3600,             event: 'day-end',         sessionSlot: 2 },
  ];

  for (const ev of events) {
    if (totalSecs < ev.timeSecs) {
      return { seconds: ev.timeSecs - totalSecs, event: ev.event as any, sessionSlot: ev.sessionSlot as any };
    }
  }

  // After 7PM — next event is 9AM tomorrow
  const secsUntilMidnight = 86400 - totalSecs;
  const secsMidnightTo9 = 9 * 3600;
  return { seconds: secsUntilMidnight + secsMidnightTo9, event: 'next-day' };
}

export function getSessionProgress(): number {
  const session = getCurrentSession();
  if (!session) return 0;

  const now = getCurrentLocalTime();
  const totalSecs = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const startSecs = session.startHour * 3600 + session.startMin * 60;
  const endSecs = session.endHour * 3600 + session.endMin * 60;
  const duration = endSecs - startSecs;
  const elapsed = totalSecs - startSecs;

  return Math.min(Math.max(elapsed / duration, 0), 1);
}

export function getLocalDateString(): string {
  return format(getCurrentLocalTime(), 'yyyy-MM-dd');
}
```

### 8.2 `src/stores/taskStore.ts` — Zustand Task Store

```typescript
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Task } from '../types/task';

interface TaskStore {
  tasks: Task[];
  isLoading: boolean;
  selectedTaskId: string | null;

  fetchTasks: (date: string) => Promise<void>;
  createTask: (task: Partial<Task>) => Promise<Task>;
  updateTask: (id: string, updates: Partial<Task>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  markDone: (id: string) => Promise<void>;
  markSkipped: (id: string) => Promise<void>;
  carryForward: (id: string) => Promise<void>;
  startFocus: (id: string) => Promise<void>;
  setSelected: (id: string | null) => void;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  isLoading: false,
  selectedTaskId: null,

  fetchTasks: async (date) => {
    set({ isLoading: true });
    const tasks = await invoke<Task[]>('get_tasks', { date });
    set({ tasks, isLoading: false });
  },

  createTask: async (partial) => {
    const task = await invoke<Task>('create_task', { task: partial });
    set(state => ({ tasks: [...state.tasks, task] }));
    return task;
  },

  updateTask: async (id, updates) => {
    await invoke('update_task', { id, updates });
    set(state => ({
      tasks: state.tasks.map(t => t.id === id ? { ...t, ...updates } : t)
    }));
  },

  markDone: async (id) => {
    await invoke('update_task', { id, updates: { status: 'done', completedAt: new Date().toISOString() }});
    set(state => ({
      tasks: state.tasks.map(t => t.id === id ? { ...t, status: 'done' } : t)
    }));
  },

  markSkipped: async (id) => {
    await invoke('update_task', { id, updates: { status: 'skipped' }});
    set(state => ({
      tasks: state.tasks.map(t => t.id === id ? { ...t, status: 'skipped' } : t)
    }));
  },

  carryForward: async (id) => {
    await invoke('carry_task_forward', { id });
    set(state => ({
      tasks: state.tasks.map(t => t.id === id ? { ...t, status: 'carried_over' } : t)
    }));
  },

  startFocus: async (id) => {
    set({ selectedTaskId: id });
    // Navigation to focus mode handled by router
  },

  setSelected: (id) => set({ selectedTaskId: id }),
}));
```

### 8.3 `src/hooks/useSessionTimer.ts`

```typescript
import { useState, useEffect, useCallback } from 'react';
import { getCurrentSession, getSecondsUntilNextEvent, getSessionProgress, SessionWindow } from '../lib/session';
import { listen } from '@tauri-apps/api/event';

export function useSessionTimer() {
  const [currentSession, setCurrentSession] = useState<SessionWindow | null>(getCurrentSession());
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [progress, setProgress] = useState(getSessionProgress());
  const [isWarning, setIsWarning] = useState(false);

  const tick = useCallback(() => {
    const session = getCurrentSession();
    const { seconds } = getSecondsUntilNextEvent();
    const prog = getSessionProgress();
    const warn = session !== null && seconds <= 900; // 15 minutes

    setCurrentSession(session);
    setSecondsRemaining(seconds);
    setProgress(prog);
    setIsWarning(warn);
  }, []);

  useEffect(() => {
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [tick]);

  // Listen for Tauri backend events
  useEffect(() => {
    const unlisteners = [
      listen('session-started', (e) => {
        tick();
        // Show in-app toast
      }),
      listen('session-warning', (e) => {
        setIsWarning(true);
      }),
      listen('day-ended', () => {
        // Navigate to reports page
      }),
    ];

    return () => {
      unlisteners.forEach(p => p.then(fn => fn()));
    };
  }, []);

  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return {
    currentSession,
    secondsRemaining,
    formattedTime: formatTime(secondsRemaining),
    progress,
    isWarning,
    isWorkHour: currentSession !== null,
  };
}
```

---

## 9. UI/UX Specifications

### Design System

- **Font**: Inter (system-ui fallback)
- **Base font size**: 14px
- **Colors**: Neutral gray base with amber accent for session timers, green for completed tasks, amber for warnings, red for critical alerts
- **Border radius**: 6px (inputs, badges), 8px (cards), 12px (modals)
- **Shadows**: Minimal — only for modals (box-shadow: 0 4px 24px rgba(0,0,0,0.12))

### Color Tokens

```css
/* Light theme */
--color-bg-primary: #ffffff;
--color-bg-secondary: #f8f8f7;
--color-bg-tertiary: #f0f0ee;
--color-text-primary: #1a1a18;
--color-text-secondary: #6b6b65;
--color-text-muted: #9b9b93;
--color-border: #e4e4e0;
--color-accent-amber: #d97706;
--color-accent-green: #059669;
--color-accent-blue: #2563eb;
--color-accent-red: #dc2626;
--color-session-1: #92400e;  /* Morning amber */
--color-session-2: #1e40af;  /* Afternoon blue */
```

### Layout

```
┌────────────────────────────────────────────────────────┐
│ SIDEBAR (220px)  │  MAIN CONTENT AREA                 │
│                  │  ┌────────────────────────────────┐ │
│  Logo            │  │ TOP BAR: Session Timer         │ │
│                  │  └────────────────────────────────┘ │
│  Dashboard       │                                    │
│  Focus Mode      │  [Page Content]                    │
│  Reports         │                                    │
│  Settings        │                                    │
│                  │                                    │
│  ──────────      │                                    │
│  Session badge   │                                    │
│  Quick Claude    │                                    │
└────────────────────────────────────────────────────────┘
```

### Window Configuration (`tauri.conf.json`)

```json
{
  "app": {
    "windows": [{
      "title": "Dev Daily Planner",
      "width": 1100,
      "height": 720,
      "minWidth": 800,
      "minHeight": 600,
      "titleBarStyle": "overlay",
      "hiddenTitle": true
    }]
  }
}
```

---

## 10. Build & Release

### `package.json` scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build",
    "tauri:build:mac": "tauri build --target universal-apple-darwin",
    "tauri:build:win": "tauri build --target x86_64-pc-windows-msvc",
    "tauri:build:linux": "tauri build --target x86_64-unknown-linux-gnu"
  }
}
```

### `src-tauri/Cargo.toml` key dependencies

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-notification = "2"
tauri-plugin-store = "2"
tauri-plugin-autostart = "2"
tauri-plugin-shell = "2"
tauri-plugin-window-state = "2"
rusqlite = { version = "0.31", features = ["bundled"] }
tokio = { version = "1", features = ["full"] }
tokio-cron-scheduler = "0.10"
reqwest = { version = "0.12", features = ["json", "stream"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
aes-gcm = "0.10"
base64 = "0.22"
chrono = { version = "0.4", features = ["serde"] }
chrono-tz = "0.9"
dirs = "5"
whoami = "1"
hostname = "0.3"
futures-util = "0.3"
```

---

## 11. Implementation Phases

### Phase 1 — Foundation (Week 1)
**Goal**: Working Tauri app with database, basic task list, session timer

- [ ] Initialize Tauri v2 project with React + TypeScript + Tailwind
- [ ] Set up SQLite with rusqlite + migration system
- [ ] Implement all 5 database tables
- [ ] Build Settings page with Claude token input, encrypt/save token
- [ ] Build SessionTimer component (UTC+7 calculations)
- [ ] Build basic TaskList and TaskItem components
- [ ] Implement task CRUD (create, read, update, delete) Rust commands + Tauri invoke
- [ ] Wire up Zustand stores
- [ ] System tray icon with Show/Hide and Quit menu items

**Deliverable**: Open app, add tasks, see session timer counting down

---

### Phase 2 — Core Workflow (Week 2)
**Goal**: Full task workflow + notifications + prompt builder

- [ ] Implement Tauri notification scheduler (all 5 cron jobs)
- [ ] Morning Planning modal (auto-opens at 9 AM on first focus)
- [ ] Task status actions: done, skip, carry forward
- [ ] Task notes panel (expandable inline editor)
- [ ] Drag-to-reorder tasks within session groups
- [ ] Quick-add task input (Enter to add, Tab for another)
- [ ] Prompt Builder page with template system
- [ ] Claude API integration: `send_prompt` command with streaming
- [ ] `useClaude` hook with stream event listener
- [ ] Built-in prompt templates (all 6 from spec)
- [ ] "Send to Claude" → render streaming response

**Deliverable**: Full task + Claude workflow. Plan day, work tasks, send prompts, get responses.

---

### Phase 3 — Focus & Reports (Week 3)
**Goal**: Focus Mode, Pomodoro, daily reports, auto-detect token

- [ ] Focus Mode page (full task view + Pomodoro timer)
- [ ] Focus session tracking in DB (start/stop/compute duration)
- [ ] `detect_claude_token` Rust command (scan credential files)
- [ ] Daily Report page (summary stats + task breakdown)
- [ ] `generate_report` Rust command (aggregate DB data)
- [ ] AI Reflection feature (send summary to Claude)
- [ ] Export report as Markdown
- [ ] Streak calendar component (last 30 days)
- [ ] Weekly bar chart (Recharts)
- [ ] Global keyboard shortcuts

**Deliverable**: Focus with Pomodoro, complete daily reports with optional AI reflection.

---

### Phase 4 — Polish & Release (Week 4)
**Goal**: Stable, distributable app

- [ ] Session reset animation at 2 PM
- [ ] Session warning banner (in-app, 15 min before reset)
- [ ] `tauri-plugin-autostart` integration
- [ ] Minimize to tray on close
- [ ] `tauri-plugin-window-state` (remember window position/size)
- [ ] Light/Dark/System theme toggle
- [ ] Settings: Pomodoro configuration
- [ ] Settings: Work days configuration
- [ ] Settings: Custom notification times
- [ ] Quick Claude floating window (Cmd+Shift+C hotkey)
- [ ] Error handling: network errors, API failures, DB errors
- [ ] Loading states and empty states for all views
- [ ] App icon and branding
- [ ] Build for macOS (universal), Windows, Linux
- [ ] README with installation and setup guide

**Deliverable**: Distributable `.dmg`, `.exe`, `.AppImage`

---

## 12. File-by-File Implementation Guide

This section provides the agent with the exact order and content to implement each file. Follow this order to avoid dependency issues.

### Order of Implementation

```
Step 1:  src-tauri/Cargo.toml
Step 2:  src-tauri/tauri.conf.json
Step 3:  src-tauri/capabilities/default.json
Step 4:  src-tauri/src/crypto/mod.rs
Step 5:  src-tauri/src/db/connection.rs
Step 6:  src-tauri/src/db/migrations.rs
Step 7:  src-tauri/src/db/queries.rs       (all SQL, typed return structs)
Step 8:  src-tauri/src/db/mod.rs
Step 9:  src-tauri/src/commands/settings.rs
Step 10: src-tauri/src/commands/tasks.rs
Step 11: src-tauri/src/commands/sessions.rs
Step 12: src-tauri/src/commands/claude.rs
Step 13: src-tauri/src/commands/reports.rs
Step 14: src-tauri/src/commands/mod.rs
Step 15: src-tauri/src/scheduler/jobs.rs
Step 16: src-tauri/src/scheduler/mod.rs
Step 17: src-tauri/src/tray/mod.rs
Step 18: src-tauri/src/lib.rs
Step 19: src-tauri/src/main.rs
Step 20: package.json
Step 21: vite.config.ts
Step 22: tsconfig.json
Step 23: tailwind.config.ts
Step 24: src/index.css
Step 25: src/types/task.ts
Step 26: src/types/session.ts
Step 27: src/types/report.ts
Step 28: src/types/settings.ts
Step 29: src/lib/time.ts
Step 30: src/lib/session.ts
Step 31: src/lib/tauri.ts               (typed invoke wrappers for all commands)
Step 32: src/lib/markdown.ts
Step 33: src/stores/settingsStore.ts
Step 34: src/stores/taskStore.ts
Step 35: src/stores/sessionStore.ts
Step 36: src/stores/reportStore.ts
Step 37: src/hooks/useSessionTimer.ts
Step 38: src/hooks/useClaude.ts
Step 39: src/hooks/useNotifications.ts
Step 40: src/hooks/useKeyboardShortcuts.ts
Step 41: src/components/ui/*.tsx         (Button, Input, Modal, Badge, Toast)
Step 42: src/components/layout/Sidebar.tsx
Step 43: src/components/layout/TopBar.tsx
Step 44: src/components/session/SessionTimer.tsx
Step 45: src/components/session/SessionBadge.tsx
Step 46: src/components/session/SessionWarning.tsx
Step 47: src/components/tasks/TaskForm.tsx
Step 48: src/components/tasks/TaskNotes.tsx
Step 49: src/components/tasks/TaskItem.tsx
Step 50: src/components/tasks/TaskList.tsx
Step 51: src/components/tasks/TaskFilters.tsx
Step 52: src/components/claude/PromptTemplates.tsx
Step 53: src/components/claude/PromptBuilder.tsx
Step 54: src/components/claude/ClaudeResponse.tsx
Step 55: src/components/claude/QuickPrompt.tsx
Step 56: src/components/reports/DailyReport.tsx
Step 57: src/components/reports/WeeklyChart.tsx
Step 58: src/components/reports/StreakCalendar.tsx
Step 59: src/components/reports/ReportExport.tsx
Step 60: src/pages/Settings.tsx
Step 61: src/pages/Dashboard.tsx
Step 62: src/pages/MorningPlanning.tsx
Step 63: src/pages/FocusMode.tsx
Step 64: src/pages/Reports.tsx
Step 65: src/App.tsx
Step 66: src/main.tsx
```

### Critical Notes for Agent

1. **Never hardcode UTC times** — always compute UTC equivalent from the UTC+7 config. If the user changes `session1_start`, all cron jobs must recompute.

2. **OAuth token vs API key** — the Claude Code OAuth token is used as `Authorization: Bearer <token>`. Do NOT use `x-api-key` header. Do NOT ask the user for an Anthropic API key.

3. **Streaming responses** — use Tauri's `app.emit()` from Rust and `listen()` in React to stream Claude responses. Do not await the full response before rendering.

4. **Local date, not UTC** — all task dates, report dates, and session dates use the UTC+7 local date string (`YYYY-MM-DD`). Never store UTC date for user-facing data.

5. **SQLite connection** — use a `Mutex<Connection>` wrapped in Tauri's `State`. Do not create multiple connections. Enable WAL mode: `PRAGMA journal_mode=WAL`.

6. **Session slot assignment** — when creating a task, auto-assign `session_slot` based on current time: if before 14:00 (UTC+7), slot=1; otherwise slot=2. User can override.

7. **Carry forward logic** — `carry_task_forward` creates a NEW task for tomorrow's date with `carried_from = original.id`, then updates original task `status = 'carried_over'`. The new task starts as `pending`.

8. **Report generation** — `generate_report` aggregates from `tasks` and `focus_sessions` for the given date. If a report already exists for that date, it updates (upsert).

9. **Token detection** — the credential file format may vary. Try parsing as JSON first; if that fails, try reading as plain text (some versions just store the raw token). Log what was found without exposing the token value.

10. **Tauri capabilities** — make sure `default.json` in capabilities includes permissions for: `notification:allow-*`, `store:allow-*`, `autostart:allow-*`, `shell:allow-open`, `window-state:allow-*`.

---

*End of plan. This document contains all information needed to build the Developer Daily Planner from scratch. Start with Phase 1 and work through the file implementation order in Section 12.*
