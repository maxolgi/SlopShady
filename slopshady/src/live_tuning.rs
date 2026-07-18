use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

pub struct ShaderResult {
    pub success: bool,
    pub error: Option<String>,
    pub transformed_source: Option<String>,
}

pub struct TuningState {
    pub active: AtomicBool,
    pub stop_requested: AtomicBool,
    screenshot_tx: mpsc::Sender<String>,
    screenshot_rx: Mutex<mpsc::Receiver<String>>,
    result_tx: mpsc::Sender<ShaderResult>,
    result_rx: Mutex<mpsc::Receiver<ShaderResult>>,
}

impl TuningState {
    pub fn new() -> Self {
        let (screenshot_tx, screenshot_rx) = mpsc::channel(16);
        let (result_tx, result_rx) = mpsc::channel(16);
        Self {
            active: AtomicBool::new(false),
            stop_requested: AtomicBool::new(false),
            screenshot_tx,
            screenshot_rx: Mutex::new(screenshot_rx),
            result_tx,
            result_rx: Mutex::new(result_rx),
        }
    }

    pub fn reset(&self) {
        self.active.store(true, Ordering::SeqCst);
        self.stop_requested.store(false, Ordering::SeqCst);
    }

    pub fn send_screenshot(&self, screenshot: String) -> bool {
        self.screenshot_tx.try_send(screenshot).is_ok()
    }

    pub async fn recv_screenshot(&self) -> Option<String> {
        self.screenshot_rx.lock().await.recv().await
    }

    pub fn send_shader_result(&self, result: ShaderResult) -> bool {
        self.result_tx.try_send(result).is_ok()
    }

    pub async fn recv_shader_result(&self) -> Option<ShaderResult> {
        self.result_rx.lock().await.recv().await
    }
}

fn format_sse(event: &str, data: &serde_json::Value) -> String {
    format!(
        "event: {}\ndata: {}\n\n",
        event,
        serde_json::to_string(data).unwrap_or_default()
    )
}

pub static LIVE_TUNING_TOOLS: &str = r#"[
    {
        "type": "function",
        "function": {
            "name": "load_shader",
            "description": "Load a complete modified shader into the editor.",
            "parameters": {
                "type": "object",
                "properties": {
                    "shader_code": {
                        "type": "string",
                        "description": "The complete GLSL fragment shader code to load."
                    }
                },
                "required": ["shader_code"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_screenshot",
            "description": "Capture a screenshot of the current shader state.",
            "parameters": {"type": "object", "properties": {}, "required": []}
        }
    }
]"#;

#[derive(Debug, Clone)]
struct ToolCall {
    id: String,
    function_name: String,
    function_arguments: String,
}

async fn stream_llm_call(
    client: &reqwest::Client,
    url: &str,
    headers: reqwest::header::HeaderMap,
    payload: &serde_json::Value,
) -> Result<(String, Vec<ToolCall>), String> {
    let resp = client
        .post(url)
        .headers(headers)
        .json(payload)
        .send()
        .await
        .map_err(|e| format!("Connection error: {}", e))?;

    let mut accumulated_content = String::new();
    let mut tool_calls: Vec<ToolCall> = Vec::new();

    let mut buffer = String::new();
    let mut stream = resp.bytes_stream();
    use futures::StreamExt;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim_end().to_string();
            buffer = buffer[pos + 1..].to_string();

            if !line.starts_with("data: ") {
                continue;
            }
            let json_str = &line[6..];
            if json_str == "[DONE]" {
                continue;
            }
            if let Ok(data) = serde_json::from_str::<Value>(json_str) {
                if let Some(delta) = data
                    .get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("delta"))
                {
                    if let Some(content) = delta.get("content").and_then(|c| c.as_str()) {
                        accumulated_content.push_str(content);
                    }
                    if let Some(tcs) = delta.get("tool_calls").and_then(|c| c.as_array()) {
                        for tc in tcs {
                            let idx = tc
                                .get("index")
                                .and_then(|i| i.as_u64())
                                .unwrap_or(0) as usize;
                            while idx >= tool_calls.len() {
                                tool_calls.push(ToolCall {
                                    id: String::new(),
                                    function_name: String::new(),
                                    function_arguments: String::new(),
                                });
                            }
                            if let Some(id) = tc.get("id").and_then(|i| i.as_str()) {
                                tool_calls[idx].id = id.to_string();
                            }
                            if let Some(fn_obj) = tc.get("function") {
                                if let Some(name) = fn_obj.get("name").and_then(|n| n.as_str()) {
                                    tool_calls[idx].function_name.push_str(name);
                                }
                                if let Some(args) =
                                    fn_obj.get("arguments").and_then(|a| a.as_str())
                                {
                                    tool_calls[idx].function_arguments.push_str(args);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok((accumulated_content, tool_calls))
}

pub async fn live_tuning_start(
    state: Arc<crate::state::AppState>,
    body: serde_json::Value,
) -> axum::response::Response {
    let lm_url = body
        .get("lm_studio_url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    if let Err(e) = crate::llm::validate_lm_url(&lm_url) {
        return axum::response::Response::builder()
            .status(400)
            .body(axum::body::Body::from(e))
            .unwrap();
    }

    let bearer_key = body
        .get("bearer_key")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let model = body
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let max_iterations = body
        .get("max_iterations")
        .and_then(|v| v.as_u64())
        .unwrap_or(20) as usize;
    let goal = body
        .get("goal")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let initial_screenshot = body
        .get("initial_screenshot")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let shader_code = body
        .get("shader_code")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let base_prompt = body
        .get("base_prompt")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    state.tuning.reset();

    let tools: Vec<Value> = serde_json::from_str(LIVE_TUNING_TOOLS).unwrap_or_default();

    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        "application/json".parse().unwrap(),
    );
    if !bearer_key.is_empty() {
        if let Ok(auth) = format!("Bearer {}", bearer_key).parse() {
            headers.insert(reqwest::header::AUTHORIZATION, auth);
        }
    }

    let system_content = format!(
        "You are a shader tuning assistant for SlopShady, a WebGL2 GLSL shader editor with voices, audio reactivity, and modulation. You have access to tools.\n\n\
        {base_prompt}\n\n\
        When generating shaders, fill in this template:\n\
        ```glsl\n\
        // Helper functions (optional — define hash, noise, etc. here)\n\n\
        void main() {{\n\
            vec2 uv = gl_FragCoord.xy / iResolution.xy;\n\
            vec3 col = vec3(0.0);\n\n\
            // Shader code here\n\n\
            fragColor = vec4(col, 1.0);\n\
        }}\n\
        ```\n\n\
        (For transparency/overlays/lower-thirds, vary the 4th component of fragColor as coverage. See ALPHA & LAYER COMPOSITING in the reference above.)\n\
        CURRENT SHADER CODE:\n\
        ```glsl\n\
        {shader_code}\n\
        ```\n\n\
        === TOOLS AVAILABLE ===\n\
        - load_shader(shader_code): Load a new shader. ALWAYS use this after compilation errors to fix the code.\n\
        - get_screenshot(): Capture the current visual state.\n\n\
        === ERROR HANDLING ===\n\
        If load_shader returns a compilation error, you MUST call load_shader again with the corrected code. Do not respond with text - fix the error and call the tool.\n\n\
        Goal: {goal}"
    );

    let messages = vec![
        json!({
            "role": "system",
            "content": system_content,
        }),
        json!({
            "role": "user",
            "content": [
                {"type": "text", "text": goal},
                {"type": "image_url", "image_url": {"url": format!("data:image/png;base64,{initial_screenshot}")}},
            ],
        }),
    ];

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .unwrap();

    let chat_url = format!("{}/chat/completions", lm_url.trim_end_matches('/'));

    let stream = async_stream::stream! {
        let mut messages = messages;
        let mut iteration = 1;
        let mut force_tool_call = false;

        yield Ok::<_, std::io::Error>(bytes::Bytes::from(format_sse("status", &json!({"message": "Starting live tuning...", "type": "info"}))));

        while iteration <= max_iterations {
            if !state.tuning.active.load(std::sync::atomic::Ordering::SeqCst)
                || state.tuning.stop_requested.load(std::sync::atomic::Ordering::SeqCst)
            {
                yield Ok::<_, std::io::Error>(bytes::Bytes::from(format_sse("finish", &json!({"summary": "Tuning stopped by user."}))));
                return;
            }

            yield Ok::<_, std::io::Error>(bytes::Bytes::from(format_sse(
                "status",
                &json!({"message": format!("Iteration {iteration}/{max_iterations}..."), "type": "info"}),
            )));

            let tool_choice = if force_tool_call {
                json!({"type": "function", "function": {"name": "load_shader"}})
            } else {
                json!("auto")
            };

            let payload = json!({
                "model": model,
                "messages": messages,
                "tools": tools,
                "tool_choice": tool_choice,
                "temperature": 0.7,
                "max_tokens": 4000,
                "stream": true,
            });

            force_tool_call = false;

            let result = stream_llm_call(&client, &chat_url, headers.clone(), &payload).await;
            let (accumulated_content, tool_calls) = match result {
                Ok(r) => r,
                Err(e) => {
                    yield Ok::<_, std::io::Error>(bytes::Bytes::from(format_sse("status", &json!({"message": e, "type": "error"}))));
                    state.tuning.active.store(false, std::sync::atomic::Ordering::SeqCst);
                    return;
                }
            };

            let mut assistant_msg = json!({
                "role": "assistant",
                "content": if accumulated_content.is_empty() { Value::Null } else { json!(accumulated_content) },
            });
            if !tool_calls.is_empty() {
                let tc_json: Vec<Value> = tool_calls.iter().map(|tc| {
                    json!({
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function_name,
                            "arguments": tc.function_arguments,
                        }
                    })
                }).collect();
                assistant_msg["tool_calls"] = Value::Array(tc_json);
            } else {
                assistant_msg["tool_calls"] = Value::Null;
            }
            messages.push(assistant_msg);

            if !accumulated_content.is_empty() {
                yield Ok::<_, std::io::Error>(bytes::Bytes::from(format_sse("reply", &json!({"content": accumulated_content}))));
            }

            if tool_calls.is_empty() {
                yield Ok::<_, std::io::Error>(bytes::Bytes::from(format_sse("status", &json!({"message": "No tool calls. Asking to continue...", "type": "info"}))));
                messages.push(json!({
                    "role": "user",
                    "content": "Please continue tuning by calling load_shader() with improvements or get_screenshot() to see the current state."
                }));
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                iteration += 1;
                continue;
            }

            yield Ok::<_, std::io::Error>(bytes::Bytes::from(format_sse(
                "status",
                &json!({"message": format!("Model requested {} tool call(s)", tool_calls.len()), "type": "tool"}),
            )));

            let max_tc = 10;
            let tool_calls: Vec<ToolCall> = if tool_calls.len() > max_tc {
                yield Ok::<_, std::io::Error>(bytes::Bytes::from(format_sse(
                    "status",
                    &json!({"message": format!("Too many tool calls ({}), limiting to {}", tool_calls.len(), max_tc), "type": "error"}),
                )));
                tool_calls.into_iter().take(max_tc).collect()
            } else {
                tool_calls
            };

            let mut last_compile_error: Option<String> = None;

            for tc in &tool_calls {
                let fn_args: Value = serde_json::from_str(&tc.function_arguments).unwrap_or(json!({}));

                if tc.function_name == "load_shader" {
                    let shader = fn_args.get("shader_code").and_then(|v| v.as_str()).unwrap_or("");
                    yield Ok::<_, std::io::Error>(bytes::Bytes::from(format_sse("load_shader", &json!({"shader_code": shader}))));

                    match tokio::time::timeout(
                        std::time::Duration::from_secs(30),
                        state.tuning.recv_shader_result(),
                    ).await {
                        Ok(Some(result)) => {
                            if !result.success {
                                let err = result.error.as_deref().unwrap_or("Unknown compilation error");
                                last_compile_error = Some(err.to_string());
                                let transformed = result.transformed_source.as_deref().unwrap_or("");
                                let error_msg = format!(
                                    "Compilation failed with error:\n{err}\n\n\
                                    The engine transforms your shader before compilation:\n\
                                    1. Numeric literals are extracted and replaced with u_param_cdN uniform parameters (code dials)\n\
                                    2. #version, precision, uniform, and out declarations are stripped (engine auto-provides them)\n\
                                    3. Voice wrapper code is appended\n\n\
                                    Here is the ACTUAL compiled source (with your numeric literals replaced by code dial uniforms):\n\
                                    ```glsl\n{transformed}\n```\n\n\
                                    Fix the error and call load_shader() again. Do NOT use u_param_cdN directly — write normal numeric values and the engine will extract them."
                                );
                                force_tool_call = true;
                                messages.push(json!({
                                    "role": "tool",
                                    "tool_call_id": tc.id,
                                    "content": json!({"success": false, "error": error_msg}).to_string(),
                                }));
                            } else {
                                let transformed = result.transformed_source.as_deref().unwrap_or("");
                                let mut success_msg = "Shader compiled and loaded successfully.".to_string();
                                if !transformed.is_empty() {
                                    success_msg.push_str(&format!(
                                        "\n\nHere is the compiled shader (your numeric literals replaced with code dial uniforms):\n```glsl\n{transformed}\n```"
                                    ));
                                }
                                messages.push(json!({
                                    "role": "tool",
                                    "tool_call_id": tc.id,
                                    "content": json!({"success": true, "message": success_msg}).to_string(),
                                }));
                            }
                        }
                        _ => {
                            messages.push(json!({
                                "role": "tool",
                                "tool_call_id": tc.id,
                                "content": json!({"success": true, "message": "Shader processed"}).to_string(),
                            }));
                        }
                    }
                } else if tc.function_name == "get_screenshot" {
                    yield Ok::<_, std::io::Error>(bytes::Bytes::from(format_sse("request_screenshot", &json!({}))));

                    match tokio::time::timeout(
                        std::time::Duration::from_secs(30),
                        state.tuning.recv_screenshot(),
                    ).await {
                        Ok(Some(screenshot)) => {
                            messages.push(json!({
                                "role": "tool",
                                "tool_call_id": tc.id,
                                "content": json!({"success": true, "screenshot_data": screenshot, "format": "png"}).to_string(),
                            }));

                            let mut screenshot_text = "Screenshot captured. Here's the current state:".to_string();
                            if let Some(ref err) = last_compile_error {
                                screenshot_text.push_str(&format!(
                                    "\n\nNote: The last shader failed to compile with this error:\n{err}\n\nPlease fix this error and call load_shader() with corrected code."
                                ));
                                last_compile_error = None;
                            }

                            messages.push(json!({
                                "role": "user",
                                "content": [
                                    {"type": "text", "text": screenshot_text},
                                    {"type": "image_url", "image_url": {"url": format!("data:image/png;base64,{screenshot}")}},
                                ],
                            }));
                            yield Ok::<_, std::io::Error>(bytes::Bytes::from(format_sse("status", &json!({"message": "Screenshot sent to model", "type": "result"}))));
                        }
                        _ => {
                            messages.push(json!({
                                "role": "tool",
                                "tool_call_id": tc.id,
                                "content": json!({"success": false, "error": "Screenshot timeout"}).to_string(),
                            }));
                            yield Ok::<_, std::io::Error>(bytes::Bytes::from(format_sse("status", &json!({"message": "Screenshot capture timed out", "type": "error"}))));
                        }
                    }
                }
            }

            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            iteration += 1;
        }

        yield Ok::<_, std::io::Error>(bytes::Bytes::from(format_sse("finish", &json!({"summary": format!("Stopped after {max_iterations} iterations.")}))));
        state.tuning.active.store(false, std::sync::atomic::Ordering::SeqCst);
    };

    use axum::body::Body;
    axum::response::Response::builder()
        .header("content-type", "text/event-stream")
        .header("cache-control", "no-cache")
        .body(Body::from_stream(stream))
        .unwrap()
}

pub async fn live_tuning_screenshot(
    state: Arc<crate::state::AppState>,
    body: serde_json::Value,
) -> axum::Json<serde_json::Value> {
    let screenshot = body.get("screenshot").and_then(|v| v.as_str()).unwrap_or("");
    state.tuning.send_screenshot(screenshot.to_string());
    axum::Json(json!({"ok": true}))
}

pub async fn live_tuning_shader_result(
    state: Arc<crate::state::AppState>,
    body: serde_json::Value,
) -> axum::Json<serde_json::Value> {
    let result = ShaderResult {
        success: body.get("success").and_then(|v| v.as_bool()).unwrap_or(false),
        error: body.get("error").and_then(|v| v.as_str()).map(String::from),
        transformed_source: body
            .get("transformedSource")
            .and_then(|v| v.as_str())
            .map(String::from),
    };
    state.tuning.send_shader_result(result);
    axum::Json(json!({"ok": true}))
}

pub async fn live_tuning_stop(
    state: Arc<crate::state::AppState>,
) -> axum::Json<serde_json::Value> {
    state
        .tuning
        .stop_requested
        .store(true, std::sync::atomic::Ordering::SeqCst);
    state
        .tuning
        .active
        .store(false, std::sync::atomic::Ordering::SeqCst);
    axum::Json(json!({"ok": true}))
}
