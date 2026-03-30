use serde::Serialize;
use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct AiProvider {
    pub id: String,
    pub name: String,
    pub available: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct ProviderAvailability {
    claude: bool,
    codex: bool,
    opencode: bool,
    copilot: bool,
}

/// Extra directories to search beyond the process PATH.
/// GUI apps on macOS/Linux often launch with a stripped PATH that omits
/// directories added by shell configs (.zshrc, .bashrc, nvm, homebrew, etc.).
fn extra_search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();

    // Home-relative dirs
    if let Some(home) = env::var_os("HOME").map(PathBuf::from) {
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join(".npm/bin"));
        dirs.push(home.join(".yarn/bin"));
        dirs.push(home.join(".cargo/bin"));
        dirs.push(home.join(".nvm/versions/node"));  // traversed below
        // nvm shims
        dirs.push(home.join(".nvm/shims"));
        // pnpm global
        dirs.push(home.join(".local/share/pnpm"));
    }

    // macOS homebrew (Intel + Apple Silicon)
    dirs.push(PathBuf::from("/usr/local/bin"));
    dirs.push(PathBuf::from("/opt/homebrew/bin"));
    dirs.push(PathBuf::from("/opt/homebrew/sbin"));

    // Linux common
    dirs.push(PathBuf::from("/usr/bin"));
    dirs.push(PathBuf::from("/usr/local/sbin"));

    dirs
}

fn command_exists(command: &str) -> bool {
    let mut search_dirs: Vec<PathBuf> = Vec::new();

    // Process PATH first
    if let Some(path_var) = env::var_os("PATH") {
        search_dirs.extend(env::split_paths(&path_var));
    }

    // Append extra dirs (de-duplication is fine to skip — any() short-circuits)
    search_dirs.extend(extra_search_dirs());

    if search_dirs.iter().any(|dir| command_path_exists(dir, command)) {
        return true;
    }

    // Last resort: ask the login shell. Handles exotic setups (asdf, mise, etc.)
    #[cfg(unix)]
    {
        if let Ok(shell) = env::var("SHELL") {
            let result = Command::new(&shell)
                .args(["-l", "-c", &format!("command -v {}", command)])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
            if result.map(|s| s.success()).unwrap_or(false) {
                return true;
            }
        }
    }

    false
}

fn command_path_exists(dir: &Path, command: &str) -> bool {
    #[cfg(windows)]
    {
        let has_ext = Path::new(command).extension().is_some();
        if has_ext {
            return is_file(&dir.join(command));
        }

        let pathext = env::var_os("PATHEXT")
            .and_then(|value| value.into_string().ok())
            .unwrap_or_else(|| ".EXE;.CMD;.BAT;.COM".to_string());

        for ext in pathext.split(';').filter(|e| !e.is_empty()) {
            let ext = ext.trim_start_matches('.');
            if is_file(&dir.join(format!("{}.{}", command, ext))) {
                return true;
            }
        }

        false
    }

    #[cfg(not(windows))]
    {
        is_file(&dir.join(command))
    }
}

fn is_file(path: &PathBuf) -> bool {
    path.is_file()
}

fn command_succeeds(binary: &str, args: &[&str]) -> bool {
    Command::new(binary)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn detect_provider_availability() -> ProviderAvailability {
    let path_var = std::env::var("PATH").unwrap_or_default();
    eprintln!("[ai-providers] PATH={}", path_var);
    let av = ProviderAvailability {
        claude: command_exists("claude"),
        codex: command_exists("codex"),
        opencode: command_exists("opencode"),
        copilot: command_exists("copilot") && command_succeeds("copilot", &["--version"]),
    };
    eprintln!("[ai-providers] availability={:?}", av);
    av
}

fn providers_from_availability(availability: ProviderAvailability) -> Vec<AiProvider> {
    let mut providers = Vec::new();

    if availability.claude {
        providers.push(AiProvider {
            id: "claude".to_string(),
            name: "Claude Code".to_string(),
            available: true,
        });
    }

    if availability.codex {
        providers.push(AiProvider {
            id: "codex".to_string(),
            name: "OpenAI Codex CLI".to_string(),
            available: true,
        });
    }

    if availability.opencode {
        providers.push(AiProvider {
            id: "opencode".to_string(),
            name: "OpenCode".to_string(),
            available: true,
        });
    }

    if availability.copilot {
        providers.push(AiProvider {
            id: "copilot".to_string(),
            name: "GitHub Copilot CLI".to_string(),
            available: true,
        });
    }

    providers
}

pub fn detect_available_providers() -> Vec<AiProvider> {
    providers_from_availability(detect_provider_availability())
}

#[tauri::command]
pub fn detect_ai_providers() -> Vec<AiProvider> {
    detect_available_providers()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn providers_from_availability_returns_only_installed_tools() {
        let providers = providers_from_availability(ProviderAvailability {
            claude: true,
            codex: false,
            opencode: true,
            copilot: false,
        });

        assert_eq!(providers.len(), 2);
        assert_eq!(providers[0].id, "claude");
        assert_eq!(providers[1].id, "opencode");
        assert!(providers.iter().all(|provider| provider.available));
    }

    #[test]
    fn providers_from_availability_includes_copilot_when_available() {
        let providers = providers_from_availability(ProviderAvailability {
            claude: false,
            codex: false,
            opencode: false,
            copilot: true,
        });

        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0].id, "copilot");
        assert_eq!(providers[0].name, "GitHub Copilot CLI");
    }
}
