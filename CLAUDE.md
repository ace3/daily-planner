# Synq — Daily Planner

Tauri v2 desktop app with an embedded HTTP server (React frontend + Rust backend).

## Build

```bash
npm run build && cd src-tauri && cargo build --release
```

- **Release binary:** `src-tauri/target/release/daily-planner`
- **macOS app bundle:** `src-tauri/target/release/bundle/macos/Synq.app`

## Database

SQLite at the Tauri app data directory (`com.synq.app`), WAL mode, foreign keys enabled.

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/com.synq.app/planner.db` |
| Linux | `~/.local/share/com.synq.app/planner.db` |

## Auth

All `/api/*` routes (except `GET /api/health`) require a Bearer token. The token is a 32-char alphanumeric string stored in the `settings` table (`key='http_auth_token'`).

## API & Testing Reference

For the full API surface, headless launch instructions, auth token management, and test workflows, see **[API_REFERENCE.md](./API_REFERENCE.md)**.
