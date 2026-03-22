use tauri::{State, AppHandle, Emitter};
use serde::{Deserialize, Serialize};
use crate::db::{DbConnection, queries};
use crate::crypto;

#[derive(Deserialize)]
pub struct SendPromptInput {
    pub prompt: String,
    pub model: Option<String>,
    pub stream_event: String,
}

#[derive(Serialize, Clone)]
pub struct StreamChunk {
    pub text: String,
    pub done: bool,
}

#[tauri::command]
pub async fn send_prompt(
    input: SendPromptInput,
    app: AppHandle,
    db: State<'_, DbConnection>,
) -> Result<String, String> {
    let token = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let encrypted = queries::get_setting(&conn, "claude_token_enc").map_err(|e| e.to_string())?;
        if encrypted.is_empty() {
            return Err("No Claude token configured. Please add your token in Settings.".to_string());
        }
        crypto::decrypt(&encrypted).map_err(|e| e.to_string())?
    };

    let model = input.model.unwrap_or_else(|| "claude-sonnet-4-6".to_string());
    let stream_event = input.stream_event.clone();
    let app_clone = app.clone();

    tokio::spawn(async move {
        let client = reqwest::Client::new();
        let body = serde_json::json!({
            "model": model,
            "max_tokens": 4096,
            "stream": true,
            "messages": [{ "role": "user", "content": input.prompt }]
        });

        let response = client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &token)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await;

        match response {
            Ok(resp) => {
                use futures_util::StreamExt;
                let mut stream = resp.bytes_stream();
                let mut _full_text = String::new();

                while let Some(chunk) = stream.next().await {
                    match chunk {
                        Ok(bytes) => {
                            let text = String::from_utf8_lossy(&bytes);
                            for line in text.lines() {
                                if let Some(data) = line.strip_prefix("data: ") {
                                    if data == "[DONE]" {
                                        continue;
                                    }
                                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                                        if let Some(t) = json
                                            .get("delta")
                                            .and_then(|d| d.get("text"))
                                            .and_then(|t| t.as_str())
                                        {
                                            _full_text.push_str(t);
                                            let _ = app_clone.emit(&stream_event, StreamChunk {
                                                text: t.to_string(),
                                                done: false,
                                            });
                                        }
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            let _ = app_clone.emit(&stream_event, serde_json::json!({
                                "error": e.to_string(), "done": true
                            }));
                            return;
                        }
                    }
                }
                let _ = app_clone.emit(&stream_event, StreamChunk {
                    text: String::new(),
                    done: true,
                });
            }
            Err(e) => {
                let _ = app_clone.emit(&stream_event, serde_json::json!({
                    "error": e.to_string(), "done": true
                }));
            }
        }
    });

    Ok("streaming".to_string())
}
