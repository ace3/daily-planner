use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

pub fn setup_tray(app: &AppHandle) -> anyhow::Result<()> {
    let open_i = MenuItem::with_id(app, "open_browser", "Open in Browser", true, None::<&str>)?;
    let sep = tauri::menu::PredefinedMenuItem::separator(app)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&open_i, &sep, &quit_i])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open_browser" => {
                launch_browser(app);
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { .. } = event {
                launch_browser(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

pub fn launch_browser(app: &AppHandle) {
    let port = get_port(app);
    let url = format!("http://localhost:{}", port);
    if let Err(e) = open::that(&url) {
        eprintln!("[tray] Failed to open browser: {}", e);
    }
}

fn get_port(app: &AppHandle) -> u16 {
    if let Some(db) = app.try_state::<crate::db::DbConnection>() {
        if let Ok(conn) = db.0.lock() {
            return crate::db::queries::get_setting(&*conn, "http_server_port")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(7734u16);
        }
    }
    7734u16
}
