//! Cloudflare Tunnel management — spawns/monitors `cloudflared` as a child process.
//!
//! Uses a quick tunnel (no config file needed):
//!   cloudflared tunnel --url http://localhost:<port>
//!
//! The public HTTPS URL is parsed from cloudflared's stdout/stderr output.
//! A background watchdog task auto-respawns the process if it dies unexpectedly.

use anyhow::{bail, Context};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

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
}

impl TunnelInner {
    fn new() -> Self {
        TunnelInner {
            child: None,
            status: TunnelStatus::default(),
            enabled: false,
            port: 7734,
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
    pub fn new() -> Self {
        TunnelManager {
            inner: Arc::new(Mutex::new(TunnelInner::new())),
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
        let mut inner = self.inner.lock().await;
        inner.enabled = false;
        if let Some(mut child) = inner.child.take() {
            let _ = child.kill().await;
        }
        inner.status = TunnelStatus { running: false, url: None, error: None };
        Ok(inner.status.clone())
    }

    async fn spawn_cloudflared(&self, port: u16) -> anyhow::Result<()> {
        // Verify cloudflared is available
        let check = Command::new("cloudflared")
            .arg("--version")
            .output()
            .await;
        if check.is_err() {
            let mut inner = self.inner.lock().await;
            inner.status = TunnelStatus {
                running: false,
                url: None,
                error: Some("cloudflared not found. Install with: brew install cloudflared".to_string()),
            };
            bail!("cloudflared not found");
        }

        let url_arg = format!("http://localhost:{}", port);
        let mut child = Command::new("cloudflared")
            .args(["tunnel", "--url", &url_arg])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .context("Failed to spawn cloudflared")?;

        // Capture stderr (where cloudflared prints the URL) in a background task
        let inner_arc = Arc::clone(&self.inner);
        let stderr = child.stderr.take();
        let stdout = child.stdout.take();

        tokio::spawn(async move {
            // Parse URL from combined output (cloudflared uses stderr)
            let url_found2 = Arc::new(tokio::sync::Notify::new());
            let inner2 = Arc::clone(&inner_arc);

            let stderr_task = tokio::spawn(async move {
                if let Some(err) = stderr {
                    let mut lines = BufReader::new(err).lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        eprintln!("[tunnel] {}", line);
                        if let Some(url) = extract_tunnel_url(&line) {
                            let mut s = inner2.lock().await;
                            s.status.url = Some(url);
                            s.status.running = true;
                            s.status.error = None;
                            url_found2.notify_waiters();
                        }
                    }
                }
            });

            // Drain stdout too
            let stdout_task = tokio::spawn(async move {
                if let Some(out) = stdout {
                    let mut lines = BufReader::new(out).lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        eprintln!("[tunnel] {}", line);
                    }
                }
            });

            let _ = tokio::join!(stderr_task, stdout_task);

            // Process exited — update status
            let mut s = inner_arc.lock().await;
            if s.enabled {
                // Unexpected exit — mark error and schedule respawn
                s.status.running = false;
                s.status.error = Some("cloudflared exited unexpectedly. Will retry in 10s.".to_string());
                let port = s.port;
                drop(s);

                sleep(Duration::from_secs(10)).await;

                // Check if still enabled before respawning
                let still_enabled = inner_arc.lock().await.enabled;
                if still_enabled {
                    eprintln!("[tunnel] Respawning cloudflared...");
                    // Re-run spawn by rebuilding the command
                    let url_arg2 = format!("http://localhost:{}", port);
                    if let Ok(new_child) = Command::new("cloudflared")
                        .args(["tunnel", "--url", &url_arg2])
                        .stdout(std::process::Stdio::piped())
                        .stderr(std::process::Stdio::piped())
                        .kill_on_drop(true)
                        .spawn()
                    {
                        inner_arc.lock().await.child = Some(new_child);
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

/// Extract `https://...trycloudflare.com` or any `https://` URL from a log line.
fn extract_tunnel_url(line: &str) -> Option<String> {
    // cloudflared prints lines like:
    //   INF |  https://example.trycloudflare.com  |
    // or just the URL on its own line
    if let Some(start) = line.find("https://") {
        let rest = &line[start..];
        let end = rest
            .find(|c: char| c.is_whitespace() || c == '|' || c == '"' || c == '\'')
            .unwrap_or(rest.len());
        let url = &rest[..end];
        if !url.is_empty() && url.contains('.') {
            return Some(url.to_string());
        }
    }
    None
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
