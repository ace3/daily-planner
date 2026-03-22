mod commands;
mod db;
mod scheduler;
mod tray;

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
            // Init DB
            let (db, db_path) = init_db(app.handle())?;
            {
                let mut conn = db.0.lock().expect("DB lock");
                run_migrations(&mut *conn, Some(&db_path)).expect("Migrations failed");
            }

            // Load settings for scheduler
            let (tz_offset, kickstart, planning_end, session2_start, warn_min, work_days) = {
                let conn = db.0.lock().expect("DB lock");
                let tz: i64 = db::queries::get_setting(&conn, "timezone_offset")
                    .unwrap_or_else(|_| "7".to_string())
                    .parse()
                    .unwrap_or(7);
                let k = db::queries::get_setting(&conn, "session1_kickstart")
                    .unwrap_or_else(|_| "09:00".to_string());
                let p = db::queries::get_setting(&conn, "planning_end")
                    .unwrap_or_else(|_| "11:00".to_string());
                let s2 = db::queries::get_setting(&conn, "session2_start")
                    .unwrap_or_else(|_| "14:00".to_string());
                let w: i64 = db::queries::get_setting(&conn, "warn_before_min")
                    .unwrap_or_else(|_| "15".to_string())
                    .parse()
                    .unwrap_or(15);
                let wd: Vec<i64> = serde_json::from_str(
                    &db::queries::get_setting(&conn, "work_days")
                        .unwrap_or_else(|_| "[1,2,3,4,5]".to_string()),
                )
                .unwrap_or_else(|_| vec![1, 2, 3, 4, 5]);
                (tz, k, p, s2, w, wd)
            };

            app.manage(db);
            app.manage(commands::claude::JobRegistry(std::sync::Arc::new(
                std::sync::Mutex::new(std::collections::HashMap::new()),
            )));

            // Setup tray
            tray::setup_tray(app.handle())?;

            // Setup scheduler
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match scheduler::setup_scheduler(
                    app_handle,
                    tz_offset,
                    &kickstart,
                    &planning_end,
                    &session2_start,
                    warn_min,
                    &work_days,
                )
                .await
                {
                    Ok(sched) => {
                        if let Err(e) = sched.start().await {
                            eprintln!("Scheduler start error: {}", e);
                        }
                        // Keep scheduler alive
                        loop {
                            tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
                        }
                    }
                    Err(e) => eprintln!("Scheduler setup error: {}", e),
                }
            });

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
            commands::tasks::create_task,
            commands::tasks::update_task,
            commands::tasks::update_task_status,
            commands::tasks::delete_task,
            commands::tasks::carry_task_forward,
            commands::tasks::reorder_tasks,
            commands::tasks::save_prompt_result,
            commands::tasks::run_task_as_worktree,
            commands::tasks::cleanup_task_worktree,
            commands::tasks::start_focus_session,
            commands::tasks::end_focus_session,
            commands::tasks::get_prompt_templates,
            commands::tasks::create_prompt_template,
            commands::tasks::update_prompt_template,
            commands::tasks::delete_prompt_template,
            commands::settings::get_settings,
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::claude::improve_prompt_with_claude,
            commands::claude::run_prompt,
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
            commands::settings::get_global_prompt,
            commands::settings::set_global_prompt,
            commands::worktree::create_prompt_worktree,
            commands::worktree::run_tests_in_worktree,
            commands::worktree::merge_worktree_branch,
            commands::worktree::cleanup_prompt_worktree,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
