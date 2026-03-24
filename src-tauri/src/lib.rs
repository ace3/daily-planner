mod commands;
mod db;
mod http_server;
mod tray;
mod tunnel;

use db::{init_db, run_migrations};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--flag1", "value1"]),
        ))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(target_os = "linux")]
            {
                let display = std::env::var("DISPLAY").ok();
                let wayland = std::env::var("WAYLAND_DISPLAY").ok();
                if display.as_deref().unwrap_or("").is_empty()
                    && wayland.as_deref().unwrap_or("").is_empty()
                {
                    eprintln!("[runtime] Linux headless mode detected (no DISPLAY/WAYLAND_DISPLAY). Remote web access is expected.");
                }
            }

            // Init DB
            let (db, db_path) = init_db(app.handle())?;
            {
                let mut conn = db.0.lock().expect("DB lock");
                run_migrations(&mut *conn, Some(&db_path)).expect("Migrations failed");
            }

            // Auto-generate HTTP auth token on first launch
            {
                let conn = db.0.lock().expect("DB lock");
                let existing = db::queries::get_setting(&conn, "http_auth_token")
                    .unwrap_or_default();
                if existing.trim().is_empty() {
                    let token: String = {
                        use rand::Rng;
                        rand::thread_rng()
                            .sample_iter(&rand::distributions::Alphanumeric)
                            .take(32)
                            .map(char::from)
                            .collect()
                    };
                    let _ = db::queries::set_setting(&conn, "http_auth_token", &token);
                    eprintln!("[http_server] Generated new auth token");
                }
            }

            app.manage(db);

            // Job registry shared by Tauri commands AND the HTTP server
            let job_registry_arc = std::sync::Arc::new(
                std::sync::Mutex::new(std::collections::HashMap::<String, u32>::new()),
            );
            app.manage(commands::claude::JobRegistry(job_registry_arc.clone()));
            app.manage(tunnel::TunnelManager::new(db_path.clone()));

            // Start embedded HTTP server
            {
                let http_db_path = db_path.clone();
                let http_registry = job_registry_arc.clone();
                // Determine dist/ path for static file serving.
                // 1. current_dir() works when invoked via `cargo tauri dev` from project root.
                // 2. Fallback: walk up from the exe (target/debug/bin → project root).
                let dist_path = std::env::current_dir()
                    .ok()
                    .map(|d| d.join("dist"))
                    .filter(|p| p.join("index.html").exists())
                    .or_else(|| {
                        std::env::current_exe().ok().and_then(|mut exe| {
                            for _ in 0..4 { exe.pop(); } // binary→debug→target→src-tauri→root
                            exe.push("dist");
                            if exe.join("index.html").exists() { Some(exe) } else { None }
                        })
                    });
                eprintln!("[http_server] dist path: {:?}", dist_path);
                tauri::async_runtime::spawn(async move {
                    http_server::start(http_db_path, http_registry, dist_path).await;
                });
            }

            // Start auto-backup scheduler
            {
                let backup_db_path = db_path.clone();
                tauri::async_runtime::spawn(async move {
                    commands::auto_backup::start_backup_scheduler(backup_db_path).await;
                });
            }

            // Setup tray
            tray::setup_tray(app.handle())?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::git::git_status,
            commands::git::git_diff,
            commands::git::git_stage_all,
            commands::git::git_commit,
            commands::git::git_push,
            commands::ai_providers::detect_ai_providers,
            commands::tasks::get_tasks,
            commands::tasks::get_tasks_range,
            commands::tasks::create_task,
            commands::tasks::update_task,
            commands::tasks::update_task_status,
            commands::tasks::delete_task,
            commands::tasks::carry_task_forward,
            commands::tasks::reorder_tasks,
            commands::tasks::save_task_prompt,
            commands::tasks::brainstorm_tasks_from_notes,
            commands::tasks::run_task_as_worktree,
            commands::tasks::cleanup_task_worktree,
            commands::tasks::get_prompt_templates,
            commands::tasks::create_prompt_template,
            commands::tasks::update_prompt_template,
            commands::tasks::delete_prompt_template,
            commands::settings::get_settings,
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::claude::improve_prompt_with_claude,
            commands::claude::run_prompt,
            commands::claude::create_and_run_job,
            commands::claude::cancel_prompt_run,
            commands::claude::is_git_worktree,
            commands::claude::check_cli_availability,
            commands::copilot::invoke_copilot_cli,
            commands::copilot::check_copilot_cli_availability,
            commands::reports::generate_report,
            commands::reports::get_report,
            commands::reports::get_reports_range,
            commands::reports::save_ai_reflection,
            commands::data_management::backup_data,
            commands::data_management::restore_data,
            commands::data_management::reset_app_data,
            commands::projects::get_projects,
            commands::projects::create_project,
            commands::projects::delete_project,
            commands::projects::get_project_prompt,
            commands::projects::set_project_prompt,
            commands::jobs::get_active_jobs,
            commands::jobs::get_recent_jobs,
            commands::jobs::get_job,
            commands::jobs::get_jobs_by_task,
            commands::settings::get_global_prompt,
            commands::settings::set_global_prompt,
            commands::worktree::create_prompt_worktree,
            commands::worktree::run_tests_in_worktree,
            commands::worktree::merge_worktree_branch,
            commands::worktree::cleanup_prompt_worktree,
            // HTTP server / remote access
            http_server::get_local_ip,
            http_server::get_http_server_port,
            // Tunnel
            tunnel::start_tunnel_cmd,
            tunnel::stop_tunnel_cmd,
            tunnel::get_tunnel_status,
            tunnel::test_telegram_notification,
            // Auto backup
            commands::auto_backup::trigger_backup_now,
            commands::auto_backup::list_backup_sessions,
            commands::auto_backup::verify_backup_session,
            commands::auto_backup::verify_all_backup_sessions,
            commands::auto_backup::restore_from_backup_session,
            commands::auto_backup::delete_backup_session,
            commands::auto_backup::get_backup_settings,
            commands::auto_backup::set_backup_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
