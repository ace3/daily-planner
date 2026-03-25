# Synq — API & Testing Reference

## Headless Launch

The HTTP server starts unconditionally on `0.0.0.0:7734` — no GUI window is required.

**macOS:**
```bash
./src-tauri/target/release/daily-planner &
```

**Linux:**
```bash
DISPLAY= WAYLAND_DISPLAY= ./src-tauri/target/release/daily-planner &
```

> `cargo tauri dev` always opens a window — use the release binary for headless operation.

## Auth Token

### Retrieve the token

```bash
# macOS
sqlite3 ~/Library/Application\ Support/com.synq.app/planner.db \
  "SELECT value FROM settings WHERE key='http_auth_token';"

# Linux
sqlite3 ~/.local/share/com.synq.app/planner.db \
  "SELECT value FROM settings WHERE key='http_auth_token';"
```

### Override with a known test token

```bash
# macOS
sqlite3 ~/Library/Application\ Support/com.synq.app/planner.db \
  "INSERT OR REPLACE INTO settings(key, value) VALUES('http_auth_token', 'test-token-1234');"

# Linux
sqlite3 ~/.local/share/com.synq.app/planner.db \
  "INSERT OR REPLACE INTO settings(key, value) VALUES('http_auth_token', 'test-token-1234');"
```

## Verify Server Is Up

```bash
curl -s http://localhost:7734/api/health
# Returns HTTP 200 (no auth required)
```

## Authenticated API Usage

**Header auth (preferred):**
```bash
curl -H "Authorization: Bearer <token>" http://localhost:7734/api/tasks
```

**Query param auth (required for SSE):**
```bash
curl "http://localhost:7734/api/events?token=<token>"
```

## Frontend Web UI

```
http://localhost:7734/?token=<token>
```

## API Surface

All endpoints are under `/api/` prefix. Auth required unless noted.

### Health
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | No | Health check |

### Tasks
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tasks` | List tasks (supports query params) |
| POST | `/api/tasks` | Create task |
| GET | `/api/tasks/range` | Get tasks in date range |
| GET | `/api/tasks/standalone` | Get standalone tasks |
| POST | `/api/tasks/brainstorm` | Brainstorm tasks |
| PATCH | `/api/tasks/reorder` | Reorder tasks |
| GET | `/api/tasks/:id` | Get task by ID |
| PATCH | `/api/tasks/:id` | Update task |
| DELETE | `/api/tasks/:id` | Delete task |
| PATCH | `/api/tasks/:id/status` | Update task status |
| POST | `/api/tasks/:id/carry-forward` | Carry task forward |
| POST | `/api/tasks/:id/prompt-result` | Submit prompt result |
| POST | `/api/tasks/:id/run` | Run task |
| PATCH | `/api/tasks/:id/prompt` | Update task prompt |

### Projects
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List projects |
| POST | `/api/projects` | Create project |
| GET | `/api/projects/trash` | List trashed projects |
| DELETE | `/api/projects/:id` | Soft-delete project |
| POST | `/api/projects/:id/restore` | Restore project |
| DELETE | `/api/projects/:id/hard` | Permanently delete project |
| GET | `/api/projects/:id/prompt` | Get project prompt |
| PUT | `/api/projects/:id/prompt` | Set project prompt |
| GET | `/api/projects/:id/tasks` | List project tasks |
| GET | `/api/projects/:id/git/status` | Git status |
| GET | `/api/projects/:id/git/diff` | Git diff |
| POST | `/api/projects/:id/git/commit` | Git commit |
| POST | `/api/projects/:id/git/push` | Git push |

### Reports
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/reports` | List reports |
| GET | `/api/reports/:date` | Get report by date |
| POST | `/api/reports/:date/generate` | Generate report |
| POST | `/api/reports/:date/reflection` | Add reflection |

### Settings & Session
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings` | Get all settings |
| GET | `/api/settings/:key` | Get setting by key |
| PUT | `/api/settings/:key` | Update setting |
| GET | `/api/session` | Get current session |

### Jobs
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/jobs` | List jobs |
| GET | `/api/jobs/:id` | Get job by ID |

### Devices
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/devices` | List devices |
| POST | `/api/devices` | Register device |
| DELETE | `/api/devices/:id` | Remove device |

### Prompts
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/prompt/global` | Get global prompt |
| PUT | `/api/prompt/global` | Set global prompt |
| GET | `/api/prompt/templates` | List prompt templates |
| POST | `/api/prompt/templates` | Create template |
| PATCH | `/api/prompt/templates/:id` | Update template |
| DELETE | `/api/prompt/templates/:id` | Delete template |
| POST | `/api/prompt/improve` | Improve a prompt |
| POST | `/api/prompt/run` | Run a prompt |

### Events (SSE)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/events?token=<token>` | Server-Sent Events stream |

Event types: `TaskChanged`, `SettingsChanged`, `ReportChanged`, `ProjectsChanged`, `TemplatesChanged`, `DevicesChanged`, `JobStatusChanged`, `JobOutput`

## Recommended AI Test Workflow

```bash
# 1. Build
npm run build && cd src-tauri && cargo build --release && cd ..

# 2. Set a known test token
sqlite3 ~/Library/Application\ Support/com.synq.app/planner.db \
  "INSERT OR REPLACE INTO settings(key, value) VALUES('http_auth_token', 'test-token-1234');"

# 3. Launch in background
./src-tauri/target/release/daily-planner &
APP_PID=$!

# 4. Poll until server is ready
for i in $(seq 1 30); do
  curl -sf http://localhost:7734/api/health && break
  sleep 1
done

# 5. Run API assertions
curl -sf -H "Authorization: Bearer test-token-1234" \
  http://localhost:7734/api/settings

# 6. Cleanup
kill $APP_PID
```
