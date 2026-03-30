use std::io::{self, BufRead, Read, Write};
use rusqlite::Connection;
use serde_json::{json, Value};

/// A wrapper that implements both BufRead (for line reading) and Read (for exact-byte reads).
struct StdinReader {
    inner: io::BufReader<io::Stdin>,
}

impl StdinReader {
    fn new() -> Self {
        StdinReader {
            inner: io::BufReader::new(io::stdin()),
        }
    }
}

impl BufRead for StdinReader {
    fn fill_buf(&mut self) -> io::Result<&[u8]> {
        self.inner.fill_buf()
    }
    fn consume(&mut self, amt: usize) {
        self.inner.consume(amt)
    }
}

impl Read for StdinReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.inner.read(buf)
    }
}

use crate::db::queries;

/// Get the default DB path based on platform, using HOME env var.
fn default_db_path() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    #[cfg(target_os = "macos")]
    {
        std::path::PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("com.synq.app")
            .join("planner.db")
    }
    #[cfg(not(target_os = "macos"))]
    {
        std::path::PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("com.synq.app")
            .join("planner.db")
    }
}

/// Write a JSON-RPC response with Content-Length framing to stdout.
fn write_response(stdout: &mut io::StdoutLock, value: &Value) {
    let body = value.to_string();
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    let _ = stdout.write_all(header.as_bytes());
    let _ = stdout.write_all(body.as_bytes());
    let _ = stdout.flush();
}

/// Build a standard JSON-RPC success response.
fn ok_response(id: &Value, result: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    })
}

/// Build a standard JSON-RPC error response.
fn err_response(id: &Value, code: i64, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message
        }
    })
}

/// Tool definitions returned by tools/list.
fn tools_list() -> Value {
    json!([
        {
            "name": "list_tasks",
            "description": "List tasks, optionally filtered by date (YYYY-MM-DD), status, or project_id.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "date": { "type": "string", "description": "Filter tasks created on this date (YYYY-MM-DD)" },
                    "status": { "type": "string", "description": "Filter by status" },
                    "project_id": { "type": "string", "description": "Filter by project ID" }
                }
            }
        },
        {
            "name": "get_task",
            "description": "Get a single task by ID.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" }
                },
                "required": ["id"]
            }
        },
        {
            "name": "create_task",
            "description": "Create a new task.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "description": { "type": "string" },
                    "priority": { "type": "number", "description": "1 (low), 2 (medium), 3 (high)" },
                    "project_id": { "type": "string" },
                    "deadline": { "type": "string", "description": "ISO date string" },
                    "agent": { "type": "string" },
                    "git_workflow": { "type": "boolean" }
                },
                "required": ["title"]
            }
        },
        {
            "name": "update_task",
            "description": "Update fields of an existing task.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "title": { "type": "string" },
                    "description": { "type": "string" },
                    "priority": { "type": "number" },
                    "deadline": { "type": ["string", "null"] },
                    "agent": { "type": ["string", "null"] }
                },
                "required": ["id"]
            }
        },
        {
            "name": "update_task_status",
            "description": "Update the status of a task. Valid statuses: todo, improved, planned, in_progress, review, skipped, carried_over.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "status": { "type": "string" }
                },
                "required": ["id", "status"]
            }
        },
        {
            "name": "list_projects",
            "description": "List all active projects.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        },
        {
            "name": "get_project",
            "description": "Get a single project by ID.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" }
                },
                "required": ["id"]
            }
        }
    ])
}

/// Dispatch a tools/call request and return the result Value.
fn handle_tool_call(conn: &Connection, tool_name: &str, args: &Value) -> Result<Value, (i64, String)> {
    match tool_name {
        "list_tasks" => {
            let project_id = args.get("project_id").and_then(|v| v.as_str());
            let date = args.get("date").and_then(|v| v.as_str());
            let status_filter = args.get("status").and_then(|v| v.as_str());

            let tasks = if let Some(pid) = project_id {
                queries::get_tasks_by_project(conn, pid)
                    .map_err(|e| (-32603i64, e.to_string()))?
            } else if let Some(d) = date {
                queries::get_tasks_by_date_range(conn, d, d)
                    .map_err(|e| (-32603i64, e.to_string()))?
            } else {
                queries::get_all_tasks(conn)
                    .map_err(|e| (-32603i64, e.to_string()))?
            };

            let filtered: Vec<_> = if let Some(st) = status_filter {
                tasks.into_iter().filter(|t| t.status == st).collect()
            } else {
                tasks
            };

            let json_tasks = serde_json::to_value(filtered)
                .map_err(|e| (-32603i64, e.to_string()))?;
            Ok(json_tasks)
        }

        "get_task" => {
            let id = args.get("id").and_then(|v| v.as_str())
                .ok_or((-32602i64, "Missing required argument: id".to_string()))?;
            match queries::get_task_by_id(conn, id)
                .map_err(|e| (-32603i64, e.to_string()))?
            {
                Some(task) => serde_json::to_value(task).map_err(|e| (-32603i64, e.to_string())),
                None => Err((-32603i64, format!("Task not found: {}", id))),
            }
        }

        "create_task" => {
            let title = args.get("title").and_then(|v| v.as_str())
                .ok_or((-32602i64, "Missing required argument: title".to_string()))?;
            let description = args.get("description").and_then(|v| v.as_str());
            let priority = args.get("priority").and_then(|v| v.as_i64()).unwrap_or(2);
            let project_id = args.get("project_id").and_then(|v| v.as_str());
            let deadline = args.get("deadline").and_then(|v| v.as_str());
            let agent = args.get("agent").and_then(|v| v.as_str());
            let git_workflow = args.get("git_workflow").and_then(|v| v.as_bool()).unwrap_or(false);

            let id = queries::create_task(
                conn,
                title,
                description,
                "task",
                priority,
                None,
                project_id,
                deadline,
                agent,
                git_workflow,
            ).map_err(|e| (-32603i64, e.to_string()))?;

            match queries::get_task_by_id(conn, &id)
                .map_err(|e| (-32603i64, e.to_string()))?
            {
                Some(task) => serde_json::to_value(task).map_err(|e| (-32603i64, e.to_string())),
                None => Err((-32603i64, "Task created but could not be retrieved".to_string())),
            }
        }

        "update_task" => {
            let id = args.get("id").and_then(|v| v.as_str())
                .ok_or((-32602i64, "Missing required argument: id".to_string()))?;

            let title = args.get("title").and_then(|v| v.as_str());
            let description = args.get("description").and_then(|v| v.as_str());
            let priority = args.get("priority").and_then(|v| v.as_i64());

            // deadline: if key present and null → Some(None), if string → Some(Some(s)), absent → None
            let deadline: Option<Option<&str>> = if args.get("deadline").is_some() {
                Some(args["deadline"].as_str())
            } else {
                None
            };

            let agent: Option<Option<&str>> = if args.get("agent").is_some() {
                Some(args["agent"].as_str())
            } else {
                None
            };

            queries::update_task(
                conn,
                id,
                title,
                description,
                None,  // notes
                None,  // task_type
                priority,
                None,  // estimated_min
                None,  // project_id
                false, // clear_project
                deadline,
                agent,
                None,  // git_workflow
            ).map_err(|e| (-32603i64, e.to_string()))?;

            match queries::get_task_by_id(conn, id)
                .map_err(|e| (-32603i64, e.to_string()))?
            {
                Some(task) => serde_json::to_value(task).map_err(|e| (-32603i64, e.to_string())),
                None => Err((-32603i64, format!("Task not found after update: {}", id))),
            }
        }

        "update_task_status" => {
            let id = args.get("id").and_then(|v| v.as_str())
                .ok_or((-32602i64, "Missing required argument: id".to_string()))?;
            let status = args.get("status").and_then(|v| v.as_str())
                .ok_or((-32602i64, "Missing required argument: status".to_string()))?;

            const VALID_STATUSES: &[&str] = &[
                "todo", "improved", "planned", "in_progress", "review", "skipped", "carried_over",
            ];
            if !VALID_STATUSES.contains(&status) {
                return Err((-32602i64, format!(
                    "Invalid status '{}'. Valid values: {}",
                    status,
                    VALID_STATUSES.join(", ")
                )));
            }

            queries::update_task_status(conn, id, status)
                .map_err(|e| (-32603i64, e.to_string()))?;

            match queries::get_task_by_id(conn, id)
                .map_err(|e| (-32603i64, e.to_string()))?
            {
                Some(task) => serde_json::to_value(task).map_err(|e| (-32603i64, e.to_string())),
                None => Err((-32603i64, format!("Task not found after status update: {}", id))),
            }
        }

        "list_projects" => {
            let projects = queries::get_projects(conn)
                .map_err(|e| (-32603i64, e.to_string()))?;
            serde_json::to_value(projects).map_err(|e| (-32603i64, e.to_string()))
        }

        "get_project" => {
            let id = args.get("id").and_then(|v| v.as_str())
                .ok_or((-32602i64, "Missing required argument: id".to_string()))?;
            let projects = queries::get_projects(conn)
                .map_err(|e| (-32603i64, e.to_string()))?;
            match projects.into_iter().find(|p| p.id == id) {
                Some(project) => serde_json::to_value(project).map_err(|e| (-32603i64, e.to_string())),
                None => Err((-32603i64, format!("Project not found: {}", id))),
            }
        }

        _ => Err((-32601i64, format!("Unknown tool: {}", tool_name))),
    }
}

/// Read one MCP message from stdin using Content-Length framing.
/// Returns None on EOF.
fn read_message(stdin: &mut StdinReader) -> Option<String> {
    // Read headers line-by-line until blank line (marks end of headers).
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = String::new();
        match stdin.read_line(&mut line) {
            Ok(0) => return None, // EOF
            Ok(_) => {}
            Err(_) => return None,
        }
        // Strip CRLF / LF
        let trimmed = line.trim_end_matches('\n').trim_end_matches('\r');
        if trimmed.is_empty() {
            // End of headers
            break;
        }
        if let Some(rest) = trimmed.to_ascii_lowercase().strip_prefix("content-length:") {
            if let Ok(n) = rest.trim().parse::<usize>() {
                content_length = Some(n);
            }
        }
    }

    let n = content_length?;
    let mut body = vec![0u8; n];
    stdin.read_exact(&mut body).ok()?;
    String::from_utf8(body).ok()
}

pub fn run_mcp_server() {
    let db_path = std::env::var("SYNQ_DB_PATH")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| default_db_path());

    let conn = Connection::open(&db_path).expect("Failed to open DB");

    let mut stdin_reader = StdinReader::new();
    let stdout = io::stdout();
    let mut stdout_lock = stdout.lock();

    loop {
        let raw = match read_message(&mut stdin_reader) {
            Some(s) => s,
            None => break, // EOF — client disconnected
        };

        let msg: Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(e) => {
                // Parse error — send error with null id
                let resp = json!({
                    "jsonrpc": "2.0",
                    "id": null,
                    "error": { "code": -32700, "message": format!("Parse error: {}", e) }
                });
                write_response(&mut stdout_lock, &resp);
                continue;
            }
        };

        let id = msg.get("id").cloned().unwrap_or(Value::Null);
        let method = msg.get("method").and_then(|v| v.as_str()).unwrap_or("");

        // Notifications (no "id") must not receive a response.
        let is_notification = msg.get("id").is_none();

        match method {
            "initialize" => {
                let resp = ok_response(&id, json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "synq", "version": "0.1.2" }
                }));
                write_response(&mut stdout_lock, &resp);
            }

            "initialized" => {
                // Notification — no response required.
            }

            "ping" => {
                if !is_notification {
                    let resp = ok_response(&id, json!({}));
                    write_response(&mut stdout_lock, &resp);
                }
            }

            "tools/list" => {
                let resp = ok_response(&id, json!({ "tools": tools_list() }));
                write_response(&mut stdout_lock, &resp);
            }

            "tools/call" => {
                let params = msg.get("params").cloned().unwrap_or(json!({}));
                let tool_name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or(json!({}));

                let resp = match handle_tool_call(&conn, tool_name, &args) {
                    Ok(result) => ok_response(&id, json!({
                        "content": [{
                            "type": "text",
                            "text": serde_json::to_string_pretty(&result)
                                .unwrap_or_else(|_| result.to_string())
                        }]
                    })),
                    Err((code, message)) => err_response(&id, code, &message),
                };
                write_response(&mut stdout_lock, &resp);
            }

            _ => {
                if !is_notification {
                    let resp = err_response(&id, -32601, &format!("Method not found: {}", method));
                    write_response(&mut stdout_lock, &resp);
                }
            }
        }
    }
}
