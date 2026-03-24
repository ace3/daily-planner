# Synq

**Plan. Prompt. Ship — from anywhere.**

Synq is a project-centric coding workflow manager built with Tauri v2, React 19, and Rust. It lets you plan coding tasks, write and improve prompts with AI, run them on your desktop via CLI tools (Claude Code, Codex, OpenCode, Copilot), review output and diffs, then commit and push — all from your phone or desktop.

The core idea: separate **thinking** (mobile, anytime, anywhere) from **executing** (desktop, automated). Write prompts on the train, fire them off to run on your machine, get notified when done, review and ship.

## Features

### Project-Centric Task Management
- **Project organization** — Create projects linked to git repos, each with its own task list
- **Standalone tasks** — Quick tasks not linked to any project
- **Task lifecycle** — pending → in_progress → done/skipped/carried_over
- **Priority & type** — Organize by priority (high/medium/low) and type (prompt/research/review/meeting/other)
- **Carry forward** — Move incomplete tasks to keep momentum

### AI-Powered Prompt Workflow
- **Write raw prompts** — Describe what you want to build, fix, or change
- **Improve with AI** — One-click prompt improvement using Claude, Codex, OpenCode, or Copilot
- **Run prompts** — Execute via CLI tools directly from the app
- **Live output** — Stream real-time CLI output on desktop
- **Fire-and-forget** — Run from mobile, get Telegram notification when done
- **Prompt templates** — Save and reuse common prompt patterns

### Job Execution & Monitoring
- **Job queue** — Track all running, queued, and completed jobs across projects
- **Parallel execution** — Run tasks on different projects simultaneously
- **Git worktree support** — Run parallel tasks on the same project using isolated worktrees
- **Job cancellation** — Cancel running jobs with graceful SIGTERM
- **Telegram notifications** — Get notified on job completion/failure with task and project context

### Git Integration
- **Git status & diff** — View changes directly in the app
- **Commit & push** — Stage, commit, and push from the UI (including mobile)
- **Worktree pipeline** — Isolated branches per job, merge or discard after review
- **Per-project git panel** — Branch info, dirty status, file-by-file diff viewer

### Remote Access (Mobile on the Go)
- **Built-in HTTP server** — Access from any browser on your network
- **Cloudflare Tunnel** — Access from anywhere over the internet
- **Token authentication** — Secure access with bearer tokens
- **Real-time sync** — Server-Sent Events keep mobile UI in sync
- **Touch-optimized** — 44px+ touch targets, mobile-first layout

### Reports & History
- **Daily reports** — Track tasks completed, skipped, carried over
- **AI reflection** — Generate daily summaries with AI
- **Prompt history** — Browse past prompts and their results
- **Task history** — View work across all projects over time

### System
- **Auto backup** — SQLite database backed up automatically
- **Versioned migrations** — Schema upgrades apply on startup (currently v12)
- **System tray** — Minimal tray integration
- **Autostart** — Optional launch on login
- **Encrypted storage** — API keys stored with AES-256-GCM

## Prerequisites

### Required

- [Node.js](https://nodejs.org/) v18+
- [Rust](https://rustup.rs/) (stable toolchain)
- [Tauri CLI prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform
  - **macOS:** Xcode Command Line Tools
  - **Linux:** `libwebkit2gtk`, `libssl-dev`, etc.
  - **Windows:** Microsoft C++ Build Tools, WebView2

### AI CLI Tools (install at least one)

Synq runs prompts through these CLI tools. Install the ones you want to use:

#### Claude Code (Anthropic)
```bash
# Install via npm
npm install -g @anthropic-ai/claude-code

# Authenticate
claude login

# Verify
claude --version
```
Requires an [Anthropic API key](https://console.anthropic.com/) or Claude Pro/Max subscription.

#### Codex (OpenAI)
```bash
# Install via npm
npm install -g @openai/codex

# Set your API key
export OPENAI_API_KEY="your-key-here"

# Verify
codex --version
```
Requires an [OpenAI API key](https://platform.openai.com/api-keys).

#### OpenCode
```bash
# Install via npm
npm install -g opencode

# Configure (follows OpenAI-compatible API)
export OPENAI_API_KEY="your-key-here"

# Verify
opencode --version
```

#### GitHub Copilot CLI
```bash
# Install GitHub CLI first
brew install gh          # macOS
# or: sudo apt install gh  # Linux

# Install Copilot extension
gh extension install github/gh-copilot

# Authenticate
gh auth login

# Verify
gh copilot --version
```
Requires a [GitHub Copilot](https://github.com/features/copilot) subscription.

### Cloudflare Tunnel (for remote/mobile access)

To access Synq from your phone over the internet:

```bash
# Install cloudflared
brew install cloudflare/cloudflare/cloudflared    # macOS
# or: sudo apt install cloudflared                 # Linux
# or: winget install Cloudflare.cloudflared        # Windows

# Option 1: Quick tunnel (no account needed, temporary URL)
# Synq handles this automatically — just click "Start Tunnel" in Remote Access settings

# Option 2: Named tunnel (persistent URL, requires Cloudflare account)
cloudflared tunnel login
cloudflared tunnel create synq
cloudflared tunnel route dns synq your-subdomain.yourdomain.com

# Create config at ~/.cloudflared/config.yml:
cat > ~/.cloudflared/config.yml << 'EOF'
tunnel: synq
credentials-file: /Users/YOUR_USER/.cloudflared/TUNNEL_ID.json

ingress:
  - hostname: your-subdomain.yourdomain.com
    service: http://localhost:7734
  - service: http_status:404
EOF

# Then in Synq Settings → Remote Access, set:
#   Tunnel Name: synq
#   Tunnel Hostname: your-subdomain.yourdomain.com
```

### Telegram Notifications (optional)

To get notified when jobs complete:

1. Create a bot via [@BotFather](https://t.me/BotFather) on Telegram
2. Copy the bot token
3. Create a channel/group and add your bot
4. Get the channel ID (use [@userinfobot](https://t.me/userinfobot) or the API)
5. In Synq Settings, enter the bot token and channel ID
6. Click "Send Test Message" to verify

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

Frontend changes hot-reload; Rust changes trigger a recompile.

## Testing

```bash
# Frontend tests (Vitest)
npm test

# Rust unit tests
cd src-tauri && cargo test --lib
```

## Build

```bash
# Production build (creates native app bundle)
npm run tauri build
```

Output locations:
- **macOS:** `src-tauri/target/release/bundle/macos/Synq.app`
- **macOS DMG:** `src-tauri/target/release/bundle/dmg/`
- **Windows:** `src-tauri/target/release/bundle/msi/` or `nsis/`

## Usage

### First Launch

1. Open Synq
2. Go to **Settings** and check which CLI tools are detected (green = installed)
3. Configure your preferred AI provider
4. (Optional) Set up Telegram notifications for remote job monitoring
5. (Optional) Set up Cloudflare Tunnel for mobile access

### Workflow

1. **Create a project** — Link it to a git repo on your machine
2. **Add tasks** — Describe what you want to build or fix
3. **Write a prompt** — Open the task, write what the AI should do
4. **Improve the prompt** — Use "Improve with AI" for better results
5. **Run it** — Click "Run Prompt" to execute via your chosen CLI tool
6. **Monitor** — Watch live output on desktop, or get a Telegram notification on mobile
7. **Review** — Check the output and git diff in the app
8. **Ship** — Commit and push directly from Synq

### Pages

| Page | Purpose |
|---|---|
| **Dashboard** | Active jobs monitor, project overview, quick standalone tasks |
| **Projects** | Manage git projects, navigate to project details |
| **Project Detail** | Task list, filters, inline add, git panel with diff/commit/push |
| **Task Detail** | Prompt editor, AI improve, run, output viewer, git operations |
| **Templates** | Save and manage reusable prompt templates |
| **History** | Browse past tasks and prompts |
| **Reports** | Daily metrics and AI-generated reflections |
| **Remote Access** | Cloudflare tunnel and HTTP server configuration |
| **Settings** | CLI tools status, AI providers, Telegram, theme, backup |

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop framework | Tauri v2 |
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS v3 |
| State management | Zustand v5 |
| Charts | Recharts |
| Backend | Rust (async, tokio) |
| Database | SQLite (rusqlite, bundled, WAL mode) |
| HTTP server | Axum 0.7 (embedded, for remote access) |
| Real-time | Server-Sent Events (SSE) |
| AI CLI tools | Claude Code, Codex, OpenCode, Copilot |
| Remote access | Cloudflare Tunnel (cloudflared) |
| Notifications | Telegram Bot API |
| Encryption | AES-256-GCM |
| Testing | Vitest (frontend), cargo test (Rust) |
