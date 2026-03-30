#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|a| a == "--mcp") {
        daily_planner_lib::mcp_server::run_mcp_server();
        return;
    }
    daily_planner_lib::run();
}
