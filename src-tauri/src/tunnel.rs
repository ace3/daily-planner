//! Cloudflare Tunnel management — spawns/monitors `cloudflared` as a child process.
//!
//! Uses a quick tunnel (no config file needed):
//!   cloudflared tunnel --url http://localhost:<port>
//!
//! The public HTTPS URL is parsed from cloudflared's stdout/stderr output.
//! A background watchdog task auto-respawns the process if it dies unexpectedly.
//!
//! Shutdown is coordinated via a `CancellationToken`: calling `stop()` cancels the
//! token before killing the child, which causes all spawned reader tasks and any
//! in-progress respawn sleep to exit cleanly.  A fresh token is installed after
//! cleanup so that a subsequent `start()` works correctly.

use anyhow::{bail, Context};
use rusqlite::Connection;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};
use tokio_util::sync::CancellationToken;

// ---------------------------------------------------------------------------
// Resolve cloudflared binary path
// ---------------------------------------------------------------------------

/// Find the `cloudflared` binary.  When launched from a macOS `.app` bundle the
/// PATH is minimal (`/usr/bin:/bin:…`), so Homebrew paths are missing.  We
/// probe well-known locations before falling back to a bare name (which relies
/// on PATH).
fn resolve_cloudflared() -> String {
    let candidates: &[&str] = &[
        "/opt/homebrew/bin/cloudflared",   // ARM macOS Homebrew
        "/usr/local/bin/cloudflared",      // Intel macOS Homebrew / manual install
        "/usr/bin/cloudflared",            // system-wide
    ];
    for path in candidates {
        if std::path::Path::new(path).exists() {
            return path.to_string();
        }
    }
    // Fallback: hope it's on PATH (works when run from terminal)
    "cloudflared".to_string()
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TunnelStatus {
    pub running: bool,
    pub url: Option<String>,
    pub error: Option<String>,
}

impl Default for TunnelStatus {
    fn default() -> Self {
        TunnelStatus { running: false, url: None, error: None }
    }
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

struct TunnelInner {
    child: Option<Child>,
    status: TunnelStatus,
    enabled: bool,
    port: u16,
    last_notified_url: Option<String>,
    db_path: std::path::PathBuf,
    /// Cancelled on `stop()` to unblock all spawned reader/watchdog tasks.
    cancel_token: CancellationToken,
}

impl TunnelInner {
    fn new(db_path: std::path::PathBuf) -> Self {
        TunnelInner {
            child: None,
            status: TunnelStatus::default(),
            enabled: false,
            port: 7734,
            last_notified_url: None,
            db_path,
            cancel_token: CancellationToken::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// TunnelManager (managed Tauri state)
// ---------------------------------------------------------------------------

pub struct TunnelManager {
    inner: Arc<Mutex<TunnelInner>>,
}

impl TunnelManager {
    pub fn new(db_path: std::path::PathBuf) -> Self {
        TunnelManager {
            inner: Arc::new(Mutex::new(TunnelInner::new(db_path))),
        }
    }

    pub async fn status(&self) -> TunnelStatus {
        self.inner.lock().await.status.clone()
    }

    pub async fn start(&self, port: u16) -> anyhow::Result<TunnelStatus> {
        let mut inner = self.inner.lock().await;
        if inner.enabled && inner.child.is_some() {
            return Ok(inner.status.clone());
        }
        inner.port = port;
        inner.enabled = true;
        drop(inner);

        self.spawn_cloudflared(port).await?;

        let inner = self.inner.lock().await;
        Ok(inner.status.clone())
    }

    pub async fn stop(&self) -> anyhow::Result<TunnelStatus> {
        // Clone the token BEFORE locking to avoid holding the lock across an await.
        let token = self.inner.lock().await.cancel_token.clone();

        // Signal all background tasks (reader loops, respawn sleep) to exit.
        token.cancel();

        let mut inner = self.inner.lock().await;
        inner.enabled = false;
        if let Some(mut child) = inner.child.take() {
            let _ = child.kill().await;
        }
        inner.status = TunnelStatus { running: false, url: None, error: None };

        // Install a fresh token so a subsequent start() gets a clean slate.
        inner.cancel_token = CancellationToken::new();

        Ok(inner.status.clone())
    }

    async fn spawn_cloudflared(&self, port: u16) -> anyhow::Result<()> {
        // Verify cloudflared is available
        let check = Command::new(resolve_cloudflared())
            .arg("--version")
            .output()
            .await;
        if check.is_err() {
            let mut inner = self.inner.lock().await;
            inner.status = TunnelStatus {
                running: false,
                url: None,
                error: Some("cloudflared not found. Install with: brew install cloudflared (then restart the app)".to_string()),
            };
            bail!("cloudflared not found");
        }

        // Read named-tunnel settings from DB
        let (tunnel_name, tunnel_hostname) = {
            let inner = self.inner.lock().await;
            let conn = Connection::open(&inner.db_path)?;
            let name = read_setting(&conn, "tunnel_name")?;
            let hostname = read_setting(&conn, "tunnel_hostname")?;
            (name, hostname)
        };

        let named_mode = tunnel_name.is_some() && tunnel_hostname.is_some();

        let mut child = if named_mode {
            let name = tunnel_name.as_deref().unwrap();
            let home = std::env::var("HOME").unwrap_or_else(|_| std::env::var("USERPROFILE").unwrap_or_default());
            let config_path = format!("{}/.cloudflared/config.yml", home);
            eprintln!("[tunnel] Starting named tunnel: {} (config: {})", name, config_path);
            Command::new(resolve_cloudflared())
                .args(["tunnel", "--config", &config_path, "run", name])
                .env("HOME", &home)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .kill_on_drop(true)
                .spawn()
                .context("Failed to spawn cloudflared named tunnel")?
        } else {
            let url_arg = format!("http://localhost:{}", port);
            eprintln!("[tunnel] Starting quick tunnel on {}", url_arg);
            Command::new(resolve_cloudflared())
                .args(["tunnel", "--url", &url_arg])
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .kill_on_drop(true)
                .spawn()
                .context("Failed to spawn cloudflared quick tunnel")?
        };

        // For named tunnels, set the static URL immediately and notify Telegram
        if named_mode {
            let hostname = tunnel_hostname.as_deref().unwrap();
            let static_url = if hostname.starts_with("https://") {
                hostname.to_string()
            } else {
                format!("https://{}", hostname)
            };
            let mut inner = self.inner.lock().await;
            let changed = inner.last_notified_url.as_deref() != Some(static_url.as_str());
            inner.status.url = Some(static_url.clone());
            inner.status.running = true;
            inner.status.error = None;
            if changed {
                inner.last_notified_url = Some(static_url.clone());
                let db_path = inner.db_path.clone();
                drop(inner);
                let db_path2 = db_path.clone();
                let url2 = static_url.clone();
                tokio::spawn(async move {
                    if let Err(e) = notify_telegram_if_configured(&db_path, &static_url).await {
                        eprintln!("[tunnel] Telegram notify error: {}", e);
                    }
                });
                tokio::spawn(async move {
                    notify_ntfy_tunnel_start(&db_path2, &url2).await;
                });
            }
        }

        // Clone the token BEFORE locking inner to avoid holding the lock across awaits.
        let token = self.inner.lock().await.cancel_token.clone();

        // Capture stderr/stdout in a background task
        let inner_arc = Arc::clone(&self.inner);
        let stderr = child.stderr.take();
        let stdout = child.stdout.take();

        tokio::spawn(async move {
            let inner2 = Arc::clone(&inner_arc);
            let is_named = named_mode;

            // --- stderr reader ---
            let token_stderr = token.clone();
            let stderr_task = tokio::spawn(async move {
                if let Some(err) = stderr {
                    let mut lines = BufReader::new(err).lines();
                    loop {
                        tokio::select! {
                            _ = token_stderr.cancelled() => break,
                            result = lines.next_line() => {
                                match result {
                                    Ok(Some(line)) => {
                                        eprintln!("[tunnel] {}", line);
                                        // For quick tunnels, parse the URL from output
                                        if !is_named {
                                            if let Some(url) = extract_tunnel_url(&line) {
                                                let mut s = inner2.lock().await;
                                                let changed = s.last_notified_url.as_deref() != Some(url.as_str());
                                                s.status.url = Some(url.clone());
                                                s.status.running = true;
                                                s.status.error = None;
                                                if changed {
                                                    s.last_notified_url = Some(url.clone());
                                                    let db_path = s.db_path.clone();
                                                    let db_path2 = db_path.clone();
                                                    let url2 = url.clone();
                                                    drop(s);
                                                    tokio::spawn(async move {
                                                        if let Err(e) = notify_telegram_if_configured(&db_path, &url).await {
                                                            eprintln!("[tunnel] Telegram notify error: {}", e);
                                                        }
                                                    });
                                                    tokio::spawn(async move {
                                                        notify_ntfy_tunnel_start(&db_path2, &url2).await;
                                                    });
                                                }
                                            }
                                        }
                                    }
                                    _ => break,
                                }
                            }
                        }
                    }
                }
            });

            // --- stdout reader ---
            let token_stdout = token.clone();
            let stdout_task = tokio::spawn(async move {
                if let Some(out) = stdout {
                    let mut lines = BufReader::new(out).lines();
                    loop {
                        tokio::select! {
                            _ = token_stdout.cancelled() => break,
                            result = lines.next_line() => {
                                match result {
                                    Ok(Some(line)) => eprintln!("[tunnel] {}", line),
                                    _ => break,
                                }
                            }
                        }
                    }
                }
            });

            let _ = tokio::join!(stderr_task, stdout_task);

            // Process exited — update status and schedule respawn if still enabled
            // and not cancelled.
            let mut s = inner_arc.lock().await;
            if s.enabled && !token.is_cancelled() {
                s.status.running = false;
                s.status.error = Some("cloudflared exited unexpectedly. Will retry in 10s.".to_string());
                let port = s.port;
                drop(s);

                // Wait 10 s, but bail immediately if stop() is called.
                tokio::select! {
                    _ = token.cancelled() => {
                        eprintln!("[tunnel] Respawn sleep cancelled — tunnel was stopped.");
                        return;
                    }
                    _ = sleep(Duration::from_secs(10)) => {}
                }

                let still_enabled = {
                    let g = inner_arc.lock().await;
                    g.enabled && !token.is_cancelled()
                };
                if still_enabled {
                    eprintln!("[tunnel] Respawning cloudflared...");
                    // Re-read settings in case they changed
                    let (rname, rhostname) = {
                        let g = inner_arc.lock().await;
                        let conn = Connection::open(&g.db_path);
                        match conn {
                            Ok(c) => (read_setting(&c, "tunnel_name").ok().flatten(),
                                      read_setting(&c, "tunnel_hostname").ok().flatten()),
                            Err(_) => (None, None),
                        }
                    };
                    let respawn_named = rname.is_some() && rhostname.is_some();
                    let new_child = if respawn_named {
                        let home2 = std::env::var("HOME").unwrap_or_else(|_| std::env::var("USERPROFILE").unwrap_or_default());
                        let config_path2 = format!("{}/.cloudflared/config.yml", home2);
                        Command::new(resolve_cloudflared())
                            .args(["tunnel", "--config", &config_path2, "run", rname.as_deref().unwrap()])
                            .env("HOME", &home2)
                            .stdout(std::process::Stdio::piped())
                            .stderr(std::process::Stdio::piped())
                            .kill_on_drop(true)
                            .spawn()
                    } else {
                        let url_arg2 = format!("http://localhost:{}", port);
                        Command::new(resolve_cloudflared())
                            .args(["tunnel", "--url", &url_arg2])
                            .stdout(std::process::Stdio::piped())
                            .stderr(std::process::Stdio::piped())
                            .kill_on_drop(true)
                            .spawn()
                    };
                    if let Ok(c) = new_child {
                        inner_arc.lock().await.child = Some(c);
                        if respawn_named {
                            let hostname = rhostname.as_deref().unwrap();
                            let static_url = if hostname.starts_with("https://") {
                                hostname.to_string()
                            } else {
                                format!("https://{}", hostname)
                            };
                            inner_arc.lock().await.status.url = Some(static_url);
                            inner_arc.lock().await.status.running = true;
                        }
                    }
                }
            } else {
                s.status.running = false;
            }
        });

        let mut inner = self.inner.lock().await;
        inner.child = Some(child);
        inner.status.running = true;
        inner.status.error = None;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Telegram notification
// ---------------------------------------------------------------------------

async fn notify_telegram_if_configured(db_path: &std::path::Path, url: &str) -> anyhow::Result<()> {
    let conn = Connection::open(db_path)?;
    let bot_token = read_setting(&conn, "telegram_bot_token")?;
    let channel_id = read_setting(&conn, "telegram_channel_id")?;
    let (Some(token), Some(chat_id)) = (bot_token, channel_id) else {
        return Ok(());
    };
    let auth_token = read_setting(&conn, "http_auth_token")?;
    let link = match auth_token {
        Some(t) => format!("{}?token={}", url, t),
        None => url.to_string(),
    };
    let text = format!("Daily Planner tunnel is live:\n{}", link);
    send_telegram_message(&token, &chat_id, &text).await?;
    eprintln!("[tunnel] Telegram notification sent");
    Ok(())
}

async fn send_telegram_message(bot_token: &str, chat_id: &str, text: &str) -> anyhow::Result<()> {
    let api_url = format!("https://api.telegram.org/bot{}/sendMessage", bot_token);
    let resp = reqwest::Client::new()
        .post(&api_url)
        .json(&serde_json::json!({ "chat_id": chat_id, "text": text }))
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        // Extract Telegram's "description" field if present
        let description = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| v["description"].as_str().map(|s| s.to_string()))
            .unwrap_or(body);
        anyhow::bail!("Telegram error {}: {}", status.as_u16(), description);
    }
    Ok(())
}

fn read_setting(conn: &Connection, key: &str) -> anyhow::Result<Option<String>> {
    match conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get::<_, String>(0),
    ) {
        Ok(v) if !v.trim().is_empty() => Ok(Some(v)),
        Ok(_) | Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Extract the tunnel URL from a cloudflared log line.
/// Only matches `trycloudflare.com` hostnames to avoid picking up incidental URLs
/// (e.g. terms-of-service links) that cloudflared prints during startup.
fn extract_tunnel_url(line: &str) -> Option<String> {
    // cloudflared prints lines like:
    //   INF |  https://example.trycloudflare.com  |
    if let Some(start) = line.find("https://") {
        let rest = &line[start..];
        let end = rest
            .find(|c: char| c.is_whitespace() || c == '|' || c == '"' || c == '\'')
            .unwrap_or(rest.len());
        let url = &rest[..end];
        if url.contains(".trycloudflare.com") {
            return Some(url.to_string());
        }
    }
    None
}

// ---------------------------------------------------------------------------
// ntfy.sh notification for tunnel start
// ---------------------------------------------------------------------------

async fn notify_ntfy_tunnel_start(db_path: &std::path::Path, url: &str) {
    let conn = match Connection::open(db_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[tunnel] Failed to open DB for ntfy notify: {}", e);
            return;
        }
    };
    let enabled = read_setting(&conn, "ntfy_on_tunnel_start")
        .ok()
        .flatten();
    if enabled.as_deref() != Some("true") {
        return;
    }
    let topic = match read_setting(&conn, "ntfy_topic").ok().flatten() {
        Some(t) => t,
        None => return,
    };
    let server = read_setting(&conn, "ntfy_server")
        .ok()
        .flatten()
        .unwrap_or_else(|| "https://ntfy.sh".to_string());

    let msg = format!("Daily Planner tunnel is live:\n{}", url);
    if let Err(e) = crate::commands::claude::send_ntfy_message(
        &server, &topic, "Synq: Tunnel Started", &msg, "link",
    ).await {
        eprintln!("[tunnel] ntfy notify error: {}", e);
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn start_tunnel_cmd(
    state: tauri::State<'_, TunnelManager>,
    port: u16,
) -> Result<TunnelStatus, String> {
    state.start(port).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_tunnel_cmd(
    state: tauri::State<'_, TunnelManager>,
) -> Result<TunnelStatus, String> {
    state.stop().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_tunnel_status(
    state: tauri::State<'_, TunnelManager>,
) -> Result<TunnelStatus, String> {
    Ok(state.status().await)
}

#[tauri::command]
pub async fn test_telegram_notification(
    db: tauri::State<'_, crate::db::DbConnection>,
) -> Result<(), String> {
    let (bot_token, channel_id) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let token = read_setting(&conn, "telegram_bot_token").map_err(|e| e.to_string())?;
        let chat = read_setting(&conn, "telegram_channel_id").map_err(|e| e.to_string())?;
        (token, chat)
    };
    let (Some(token), Some(chat_id)) = (bot_token, channel_id) else {
        return Err("Telegram Bot Token and Channel ID must be set first.".to_string());
    };
    send_telegram_message(&token, &chat_id, "Daily Planner: Telegram notification is working!")
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_ntfy_notification(
    db: tauri::State<'_, crate::db::DbConnection>,
) -> Result<(), String> {
    let (server, topic) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let topic = read_setting(&conn, "ntfy_topic")
            .map_err(|e| e.to_string())?
            .filter(|s| !s.is_empty());
        let server = read_setting(&conn, "ntfy_server")
            .map_err(|e| e.to_string())?
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "https://ntfy.sh".to_string());
        (server, topic)
    };
    let Some(topic) = topic else {
        return Err("ntfy Topic must be set first.".to_string());
    };
    crate::commands::claude::send_ntfy_message(
        &server,
        &topic,
        "Synq: Test",
        "Daily Planner: ntfy notification is working!",
        "white_check_mark",
    )
    .await
    .map_err(|e| e.to_string())
}
