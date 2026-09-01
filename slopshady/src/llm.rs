use axum::body::Body;
use axum::extract::State;
use axum::response::Response;
use bytes::Bytes;
use futures::StreamExt;
use serde_json::{json, Value};
use std::sync::Arc;

use crate::state::AppState;

/// Validate that an LLM endpoint URL uses an acceptable scheme.
/// Scheme allowlist (http/https only) — blocks non-web schemes like file://;
/// NOT SSRF protection. Internal/LAN hosts remain reachable by design under
/// the single-user LAN trust model (no auth, binds 0.0.0.0).
pub fn validate_lm_url(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|e| format!("Invalid URL: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(()),
        scheme => Err(format!(
            "Unsupported URL scheme '{scheme}' — only http/https allowed"
        )),
    }
}

pub async fn get_models(
    State(_state): State<Arc<AppState>>,
    body: axum::Json<Value>,
) -> axum::Json<Value> {
    let lm_url = match body.get("lm_studio_url").and_then(|v| v.as_str()) {
        Some(url) => url.trim().to_string(),
        None => return axum::Json(json!({"error": "Missing lm_studio_url"})),
    };

    if let Err(e) = validate_lm_url(&lm_url) {
        return axum::Json(json!({"error": e}));
    }

    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        "application/json".parse().unwrap(),
    );
    if let Some(key) = body.get("bearer_key").and_then(|v| v.as_str()) {
        if !key.is_empty() {
            if let Ok(auth) = format!("Bearer {}", key).parse() {
                headers.insert(reqwest::header::AUTHORIZATION, auth);
            }
        }
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap();
    let url = format!("{}/models", lm_url.trim_end_matches('/'));

    match client.get(&url).headers(headers).send().await {
        Ok(resp) => match resp.json::<Value>().await {
            Ok(data) => axum::Json(data),
            Err(_) => axum::Json(json!({"error": "Failed to parse response"})),
        },
        Err(e) => {
            if e.is_connect() {
                axum::Json(json!({"error": "Cannot connect to LM Studio", "detail": e.to_string()}))
            } else {
                axum::Json(json!({"error": "LM Studio request failed", "detail": e.to_string()}))
            }
        }
    }
}

pub async fn chat_completions(
    State(_state): State<Arc<AppState>>,
    body: axum::Json<Value>,
) -> Response {
    let lm_url = match body.get("lm_studio_url").and_then(|v| v.as_str()) {
        Some(url) => url.trim().to_string(),
        None => {
            return Response::builder()
                .status(400)
                .body(Body::from("Missing lm_studio_url"))
                .unwrap();
        }
    };

    if let Err(e) = validate_lm_url(&lm_url) {
        return Response::builder().status(400).body(Body::from(e)).unwrap();
    }

    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        "application/json".parse().unwrap(),
    );
    if let Some(key) = body.get("bearer_key").and_then(|v| v.as_str()) {
        if !key.is_empty() {
            if let Ok(auth) = format!("Bearer {}", key).parse() {
                headers.insert(reqwest::header::AUTHORIZATION, auth);
            }
        }
    }

    let mut payload = body.0;
    if let Some(m) = payload.as_object_mut() {
        m.remove("lm_studio_url");
        m.remove("bearer_key");
    }

    let url = format!("{}/chat/completions", lm_url.trim_end_matches('/'));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .unwrap();

    let resp = match client.post(&url).headers(headers).json(&payload).send().await {
        Ok(resp) => resp,
        Err(e) => {
            let error = if e.is_connect() {
                "Cannot connect to LM Studio".to_string()
            } else {
                format!("Connection error: {e}")
            };
            return Response::builder()
                .status(502)
                .header("content-type", "application/json")
                .body(Body::from(json!({"error": error}).to_string()))
                .unwrap();
        }
    };

    if !resp.status().is_success() {
        let status = resp.status();
        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "application/json".to_string());
        let mut body = resp.text().await.unwrap_or_default();
        if body.len() > 4096 {
            let mut cut = 4096;
            while !body.is_char_boundary(cut) {
                cut -= 1;
            }
            body.truncate(cut);
        }
        return Response::builder()
            .status(status)
            .header("content-type", content_type)
            .body(Body::from(body))
            .unwrap();
    }

    let stream = async_stream::stream! {
        let mut buffer: Vec<u8> = Vec::new();
        let mut consumed = 0usize;
        let mut byte_stream = resp.bytes_stream();

        while let Some(chunk) = byte_stream.next().await {
            match chunk {
                Ok(bytes) => {
                    buffer.extend_from_slice(&bytes);
                    while let Some(pos) = buffer[consumed..].iter().position(|&b| b == b'\n') {
                        let line = String::from_utf8_lossy(&buffer[consumed..consumed + pos]).trim_end().to_string();
                        consumed += pos + 1;
                        if line.is_empty() {
                            continue;
                        }
                        if line.starts_with(':') {
                            continue;
                        }
                        if line.starts_with("data: ") {
                            yield Ok::<_, std::io::Error>(Bytes::from(format!("{line}\n\n")));
                        } else {
                            yield Ok::<_, std::io::Error>(Bytes::from(format!("data: {line}\n\n")));
                        }
                    }
                    buffer.drain(..consumed);
                    consumed = 0;
                }
                Err(e) => {
                    let msg = format!("event: status\ndata: {}\n\n", json!({"message": format!("Stream error: {e}"), "type": "error"}));
                    yield Ok(Bytes::from(msg));
                    break;
                }
            }
        }
    };

    Response::builder()
        .header("content-type", "text/event-stream")
        .header("cache-control", "no-cache")
        .body(Body::from_stream(stream))
        .unwrap()
}
