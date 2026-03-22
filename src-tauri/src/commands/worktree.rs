use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug)]
pub struct CreatePromptWorktreeResult {
    pub worktree_path: String,
    pub branch_name: String,
}

#[derive(Serialize, Debug)]
pub struct WorktreeTestResult {
    pub passed: bool,
    pub frontend_passed: u32,
    pub frontend_failed: u32,
    pub rust_passed: u32,
    pub rust_failed: u32,
}

#[derive(Serialize, Debug)]
pub struct MergeWorktreeResult {
    pub success: bool,
    pub message: String,
}

#[derive(Serialize, Debug)]
pub struct CleanupWorktreeResult {
    pub success: bool,
    pub message: String,
}

#[derive(Serialize, Clone)]
pub struct WorktreeTestLogPayload {
    pub job_id: String,
    pub line: String,
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable)
// ---------------------------------------------------------------------------

pub fn make_prompt_branch_name(prompt_id: &str) -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let short_id: String = prompt_id.chars().take(8).collect();
    format!("prompt/{short_id}-{ts}")
}

pub fn prompt_worktree_path(prompt_id: &str) -> PathBuf {
    std::env::temp_dir()
        .join("daily-planner-prompt-worktrees")
        .join(prompt_id)
}

/// Parse vitest summary output. Looks for the `Tests  N passed` / `| N failed` line.
pub fn parse_vitest_results(output: &str) -> (u32, u32) {
    let mut passed = 0u32;
    let mut failed = 0u32;
    for line in output.lines() {
        let trimmed = line.trim();
        // Match lines like: "Tests   84 passed (84)" or "Tests   80 passed | 4 failed (84)"
        if trimmed.starts_with("Tests") {
            let tokens: Vec<&str> = trimmed.split_whitespace().collect();
            let mut i = 0;
            while i < tokens.len() {
                if tokens[i] == "passed" && i > 0 {
                    passed = tokens[i - 1].parse().unwrap_or(0);
                } else if tokens[i] == "failed" && i > 0 {
                    let num_token = if tokens[i - 1] == "|" && i > 1 {
                        tokens[i - 2]
                    } else {
                        tokens[i - 1]
                    };
                    failed = num_token.parse().unwrap_or(0);
                }
                i += 1;
            }
        }
    }
    (passed, failed)
}

/// Parse `cargo test` summary output. Looks for `test result:` lines.
/// Format: "test result: ok. 7 passed; 0 failed; 0 ignored; ..."
/// The number precedes the keyword in each `;`-separated segment.
pub fn parse_cargo_test_results(output: &str) -> (u32, u32) {
    let mut passed = 0u32;
    let mut failed = 0u32;
    for line in output.lines() {
        if line.contains("test result:") {
            for segment in line.split(';') {
                let s = segment.trim();
                // Second-to-last whitespace token is the number before the keyword.
                let tokens: Vec<&str> = s.split_whitespace().collect();
                if tokens.len() >= 2 {
                    let keyword = *tokens.last().unwrap();
                    let num_token = tokens[tokens.len() - 2];
                    match keyword {
                        "passed" => passed = num_token.parse().unwrap_or(passed),
                        "failed" => failed = num_token.parse().unwrap_or(failed),
                        _ => {}
                    }
                }
            }
        }
    }
    (passed, failed)
}

/// Discover the main (primary) worktree path by parsing `git worktree list --porcelain`.
/// The first `worktree /path` entry is always the main checkout.
pub fn find_main_worktree(worktree_path: &Path) -> Option<PathBuf> {
    let output = Command::new("git")
        .current_dir(worktree_path)
        .args(["worktree", "list", "--porcelain"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            return Some(PathBuf::from(path.trim()));
        }
    }
    None
}

/// Ensure node_modules are available in the worktree by symlinking from the main checkout.
#[cfg(unix)]
fn ensure_node_modules(worktree_path: &Path) {
    let wt_nm = worktree_path.join("node_modules");
    if wt_nm.exists() {
        return;
    }
    if let Some(main_repo) = find_main_worktree(worktree_path) {
        let main_nm = main_repo.join("node_modules");
        if main_nm.exists() {
            let _ = std::os::unix::fs::symlink(&main_nm, &wt_nm);
        }
    }
}

#[cfg(not(unix))]
fn ensure_node_modules(_worktree_path: &Path) {
    // Windows: skip symlink; tests may fail without node_modules
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Create a git worktree on a new branch for a given prompt job.
/// `project_path` must be a git repository root (not already a worktree).
/// Returns the worktree path and branch name.
#[tauri::command]
pub fn create_prompt_worktree(
    prompt_id: String,
    project_path: String,
    base_branch: Option<String>,
) -> Result<CreatePromptWorktreeResult, String> {
    let repo_path = Path::new(&project_path);
    if !repo_path.exists() {
        return Err(format!("Project path does not exist: {project_path}"));
    }

    // Confirm it is a git repository
    let inside = Command::new("git")
        .current_dir(repo_path)
        .args(["rev-parse", "--is-inside-work-tree"])
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;
    if !inside.status.success() {
        return Err(format!("Not a git repository: {project_path}"));
    }

    let branch_name = make_prompt_branch_name(&prompt_id);
    let worktree_path = prompt_worktree_path(&prompt_id);

    // Ensure parent directory exists
    if let Some(parent) = worktree_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create worktree parent: {e}"))?;
    }

    // Resolve the base commit/branch to branch from
    let base = base_branch.as_deref().unwrap_or("HEAD");

    let add_out = Command::new("git")
        .current_dir(repo_path)
        .args(["worktree", "add", "-b", &branch_name])
        .arg(&worktree_path)
        .arg(base)
        .output()
        .map_err(|e| format!("Failed to run git worktree add: {e}"))?;

    if !add_out.status.success() {
        let stderr = String::from_utf8_lossy(&add_out.stderr);
        return Err(format!("git worktree add failed: {}", stderr.trim()));
    }

    Ok(CreatePromptWorktreeResult {
        worktree_path: worktree_path.to_string_lossy().into_owned(),
        branch_name,
    })
}

/// Run the project test suite (npm test + cargo test) inside a worktree.
/// Streams log lines as `worktree_test_log` events and returns aggregate results.
#[tauri::command]
pub async fn run_tests_in_worktree(
    worktree_path: String,
    job_id: String,
    app_handle: tauri::AppHandle,
) -> Result<WorktreeTestResult, String> {
    let wt_path = PathBuf::from(&worktree_path);
    if !wt_path.exists() {
        return Err(format!("Worktree path does not exist: {worktree_path}"));
    }

    let emit = |line: &str| {
        let _ = app_handle.emit(
            "worktree_test_log",
            WorktreeTestLogPayload {
                job_id: job_id.clone(),
                line: line.to_string(),
            },
        );
    };

    // Ensure node_modules are available
    ensure_node_modules(&wt_path);

    // --- Frontend tests (npm run test) ---
    emit("--- Running frontend tests (vitest) ---");
    let npm_out = Command::new("npm")
        .current_dir(&wt_path)
        .args(["run", "test"])
        .env("CI", "true")
        .output()
        .map_err(|e| format!("Failed to run npm test: {e}"))?;

    let npm_stdout = String::from_utf8_lossy(&npm_out.stdout).into_owned();
    let npm_stderr = String::from_utf8_lossy(&npm_out.stderr).into_owned();
    let npm_combined = format!("{npm_stdout}{npm_stderr}");

    for line in npm_combined.lines() {
        if !line.trim().is_empty() {
            emit(line);
        }
    }

    let (fe_passed, fe_failed) = parse_vitest_results(&npm_combined);
    let frontend_ok = npm_out.status.success();
    emit(&format!(
        "Frontend: {fe_passed} passed, {fe_failed} failed{}",
        if frontend_ok { "" } else { " [FAILED]" }
    ));

    // --- Rust tests (cargo test) ---
    emit("--- Running Rust tests (cargo test) ---");
    let tauri_dir = wt_path.join("src-tauri");
    let cargo_out = if tauri_dir.exists() {
        Command::new("cargo")
            .current_dir(&tauri_dir)
            .args(["test", "--", "--test-output", "immediate"])
            .output()
            .map_err(|e| format!("Failed to run cargo test: {e}"))?
    } else {
        emit("(no src-tauri directory found, skipping Rust tests)");
        // Return fake all-passed result
        return Ok(WorktreeTestResult {
            passed: frontend_ok,
            frontend_passed: fe_passed,
            frontend_failed: fe_failed,
            rust_passed: 0,
            rust_failed: 0,
        });
    };

    let cargo_stdout = String::from_utf8_lossy(&cargo_out.stdout).into_owned();
    let cargo_stderr = String::from_utf8_lossy(&cargo_out.stderr).into_owned();
    let cargo_combined = format!("{cargo_stdout}{cargo_stderr}");

    for line in cargo_combined.lines() {
        if !line.trim().is_empty() {
            emit(line);
        }
    }

    let (rust_passed, rust_failed) = parse_cargo_test_results(&cargo_combined);
    let rust_ok = cargo_out.status.success();
    emit(&format!(
        "Rust: {rust_passed} passed, {rust_failed} failed{}",
        if rust_ok { "" } else { " [FAILED]" }
    ));

    let all_passed = frontend_ok && rust_ok;
    emit(if all_passed {
        "✅ All tests passed!"
    } else {
        "❌ Tests failed."
    });

    Ok(WorktreeTestResult {
        passed: all_passed,
        frontend_passed: fe_passed,
        frontend_failed: fe_failed,
        rust_passed,
        rust_failed,
    })
}

/// Merge a worktree branch back into the target branch in the main repository.
#[tauri::command]
pub fn merge_worktree_branch(
    project_path: String,
    branch_name: String,
    target_branch: String,
) -> Result<MergeWorktreeResult, String> {
    let repo_path = Path::new(&project_path);
    if !repo_path.exists() {
        return Err(format!("Project path does not exist: {project_path}"));
    }

    // Checkout the target branch first
    let checkout = Command::new("git")
        .current_dir(repo_path)
        .args(["checkout", &target_branch])
        .output()
        .map_err(|e| format!("Failed to run git checkout: {e}"))?;

    if !checkout.status.success() {
        let stderr = String::from_utf8_lossy(&checkout.stderr);
        return Ok(MergeWorktreeResult {
            success: false,
            message: format!("Failed to checkout {target_branch}: {}", stderr.trim()),
        });
    }

    // Merge the worktree branch
    let commit_msg = format!("Merge {branch_name} results");
    let merge = Command::new("git")
        .current_dir(repo_path)
        .args(["merge", "--no-ff", &branch_name, "-m", &commit_msg])
        .output()
        .map_err(|e| format!("Failed to run git merge: {e}"))?;

    if merge.status.success() {
        Ok(MergeWorktreeResult {
            success: true,
            message: format!("Successfully merged {branch_name} into {target_branch}"),
        })
    } else {
        let stderr = String::from_utf8_lossy(&merge.stderr);
        Ok(MergeWorktreeResult {
            success: false,
            message: format!("Merge failed: {}", stderr.trim()),
        })
    }
}

/// Remove the worktree directory and delete its branch.
#[tauri::command]
pub fn cleanup_prompt_worktree(
    project_path: String,
    worktree_path: String,
    branch_name: String,
) -> Result<CleanupWorktreeResult, String> {
    let repo_path = Path::new(&project_path);
    let wt_path = Path::new(&worktree_path);

    let mut messages: Vec<String> = Vec::new();

    // Remove worktree
    if wt_path.exists() {
        let rm = Command::new("git")
            .current_dir(repo_path)
            .args(["worktree", "remove", "--force", &worktree_path])
            .output()
            .map_err(|e| format!("Failed to run git worktree remove: {e}"))?;
        if rm.status.success() {
            messages.push("Worktree removed.".to_string());
        } else {
            let stderr = String::from_utf8_lossy(&rm.stderr);
            messages.push(format!("Worktree remove warning: {}", stderr.trim()));
        }
    } else {
        messages.push("Worktree directory already gone.".to_string());
    }

    // Delete branch
    let del = Command::new("git")
        .current_dir(repo_path)
        .args(["branch", "-d", &branch_name])
        .output()
        .map_err(|e| format!("Failed to run git branch -d: {e}"))?;

    if del.status.success() {
        messages.push(format!("Branch '{branch_name}' deleted."));
    } else {
        // Try force delete in case it's unmerged but user explicitly asked to clean up
        let del_force = Command::new("git")
            .current_dir(repo_path)
            .args(["branch", "-D", &branch_name])
            .output()
            .map_err(|e| format!("Failed to run git branch -D: {e}"))?;
        if del_force.status.success() {
            messages.push(format!("Branch '{branch_name}' force-deleted."));
        } else {
            let stderr = String::from_utf8_lossy(&del_force.stderr);
            messages.push(format!("Branch delete warning: {}", stderr.trim()));
        }
    }

    Ok(CleanupWorktreeResult {
        success: true,
        message: messages.join(" "),
    })
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_make_prompt_branch_name_has_prefix_and_id() {
        let id = "abc123-def456";
        let name = make_prompt_branch_name(id);
        assert!(name.starts_with("prompt/abc123-d-"), "got: {name}");
    }

    #[test]
    fn test_prompt_worktree_path_uses_tmp() {
        let path = prompt_worktree_path("my-job-id");
        let s = path.to_string_lossy();
        assert!(s.contains("daily-planner-prompt-worktrees"));
        assert!(s.contains("my-job-id"));
    }

    #[test]
    fn test_parse_vitest_results_all_passing() {
        let output = r#"
 RUN  v4.1.0

 Test Files  9 passed (9)
      Tests  84 passed (84)
   Start at  22:33:26
   Duration  3.73s
"#;
        let (passed, failed) = parse_vitest_results(output);
        assert_eq!(passed, 84);
        assert_eq!(failed, 0);
    }

    #[test]
    fn test_parse_vitest_results_with_failures() {
        let output = r#"
 Test Files  8 passed | 1 failed (9)
      Tests  80 passed | 4 failed (84)
"#;
        let (passed, failed) = parse_vitest_results(output);
        assert_eq!(passed, 80);
        assert_eq!(failed, 4);
    }

    #[test]
    fn test_parse_vitest_results_empty() {
        let (passed, failed) = parse_vitest_results("");
        assert_eq!(passed, 0);
        assert_eq!(failed, 0);
    }

    #[test]
    fn test_parse_cargo_results_all_passing() {
        let output = r#"
running 7 tests
test commands::tasks::tests::test_slugify_branch_component ... ok
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.19s
"#;
        let (passed, failed) = parse_cargo_test_results(output);
        assert_eq!(passed, 7);
        assert_eq!(failed, 0);
    }

    #[test]
    fn test_parse_cargo_results_with_failures() {
        let output = r#"
test result: FAILED. 5 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
"#;
        let (passed, failed) = parse_cargo_test_results(output);
        assert_eq!(passed, 5);
        assert_eq!(failed, 2);
    }

    #[test]
    fn test_parse_cargo_results_empty() {
        let (passed, failed) = parse_cargo_test_results("");
        assert_eq!(passed, 0);
        assert_eq!(failed, 0);
    }

    #[test]
    fn test_parse_cargo_results_multiple_binaries() {
        // cargo test runs multiple test binaries, each has its own "test result:" line.
        // The parser returns the LAST matching line's values (overwrite on each match).
        let output = r#"
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.14s
"#;
        let (passed, failed) = parse_cargo_test_results(output);
        assert_eq!(passed, 4);
        assert_eq!(failed, 0);
    }
}
