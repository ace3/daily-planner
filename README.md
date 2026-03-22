# Daily Planner

A developer-focused daily planning desktop app built with Tauri v2, React 19, and Rust. Structures your workday into timed sessions, tracks tasks, provides focus mode with a Pomodoro-style timer, and generates AI-powered daily reflection reports via the Anthropic Claude API.

## Features

- **Session-based workday** — Two structured work sessions per day with configurable start/end times (default UTC+7: 09:00–14:00 and 14:00–19:00)
- **Morning planning phase** — Dedicated planning mode at session start (09:00–11:00) with Claude AI prompt templates
- **Task management** — Create, reorder, carry-forward tasks across days
- **Focus mode** — Pomodoro-style timer with session tracking
- **Notifications** — Desktop notifications 15 minutes before session resets and end of day
- **Daily reports** — AI-generated reflection reports streamed from Claude API
- **Encrypted API key storage** — Claude API token stored with AES-256-GCM encryption in local SQLite
- **System tray** — Minimal system tray integration
- **Autostart** — Optional launch on login

## Requirements

- [Node.js](https://nodejs.org/) v18+
- [Rust](https://rustup.rs/) (stable toolchain)
- [Tauri CLI prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform
  - **macOS:** Xcode Command Line Tools
  - **Linux:** `libwebkit2gtk`, `libssl-dev`, etc.
  - **Windows:** Microsoft C++ Build Tools, WebView2

## Setup

```bash
# 1. Clone the repo
git clone <repo-url>
cd daily-planner

# 2. Install frontend dependencies
npm install

# 3. Rust dependencies are fetched automatically on first build
```

## Development

```bash
# Run in development mode (hot-reload frontend + Rust backend)
npm run tauri dev
```

This starts the Vite dev server and the Tauri app simultaneously. Frontend changes hot-reload; Rust changes trigger a recompile.

## Testing

```bash
# Run frontend tests (Vitest)
npm test

# Watch mode
npm run test:watch

# Vitest UI (browser-based test runner)
npm run test:ui
```

Rust unit tests:
```bash
cd src-tauri
cargo test
```

## Build

```bash
# Production build (creates native app bundle)
npm run tauri build
```

Output locations:
- **macOS app:** `src-tauri/target/release/bundle/macos/Daily Planner.app`
- **macOS DMG:** `src-tauri/target/release/bundle/dmg/` (requires Xcode code signing setup)
- **Windows:** `src-tauri/target/release/bundle/msi/` or `nsis/`

## Usage

### First Launch

1. Open the app.
2. Go to **Settings** and enter your [Anthropic API key](https://console.anthropic.com/). It is encrypted and stored locally.
3. Configure your timezone and session times if needed (defaults to UTC+7, sessions at 09:00 and 14:00).

### Daily Workflow

| Time (default) | Phase |
|---|---|
| 09:00 | Session 1 starts — Morning Planning with Claude |
| 11:00 | Switch to development work |
| 13:45 | 15-min warning notification |
| 14:00 | Session 2 resets |
| 18:45 | 15-min warning notification |
| 19:00 | End of day — generate AI reflection report |

- **Dashboard** — Overview of current session, tasks, and progress
- **Focus Mode** — Start a focus timer for a specific task
- **Morning Planning** — AI-assisted planning prompts (available during planning phase)
- **Reports** — View and generate AI daily reflection reports
- **Settings** — API key, timezone, session times, autostart

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop framework | Tauri v2 |
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS v3 |
| State management | Zustand v5 |
| Charts | Recharts |
| Backend | Rust |
| Database | SQLite (rusqlite, bundled) |
| Scheduling | tokio-cron-scheduler |
| HTTP/AI streaming | reqwest + Anthropic Claude API |
| Encryption | AES-256-GCM (aes-gcm crate) |
| Testing | Vitest + Testing Library (frontend), cargo test (Rust) |
