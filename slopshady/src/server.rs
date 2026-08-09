use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::header;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use mime_guess::from_path;
use rust_embed::Embed;
use serde_json::Value;
use std::sync::Arc;

use crate::state::AppState;

#[derive(Embed)]
#[folder = "../static/"]
struct Asset;

async fn serve_index() -> Response {
    match Asset::get("slopshady.html") {
        Some(content) => (
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            content.data.to_vec(),
        )
            .into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn serve_static_file(uri: axum::http::Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = path.strip_prefix("static/").unwrap_or(path);

    match Asset::get(path) {
        Some(content) => {
            let mime = from_path(path).first_or_octet_stream();
            ([(header::CONTENT_TYPE, mime.as_ref())], content.data.to_vec()).into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn download_shaders(State(state): State<Arc<AppState>>) -> Response {
    match tokio::fs::read_to_string(&state.persist_path).await {
        Ok(content) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/json")
            .header(
                header::CONTENT_DISPOSITION,
                "attachment; filename=shaders.json",
            )
            .body(Body::from(content))
            .unwrap(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

pub fn build_router(state: Arc<AppState>) -> Router {
    let router = Router::new()
        .route("/", get(serve_index))
        .route("/ws", get(crate::ws::ws_handler))
        .route("/api/models", post(api_models))
        .route("/api/chat/completions", post(api_chat_completions))
        .route("/api/live-tuning/start", post(api_live_tuning_start))
        .route("/api/live-tuning/screenshot", post(api_live_tuning_screenshot))
        .route("/api/live-tuning/shader-result", post(api_live_tuning_shader_result))
        .route("/api/live-tuning/stop", post(api_live_tuning_stop))
        .route("/api/shaders/download", get(download_shaders))
        .route("/api/stream/cert-hash", get(api_stream_cert_hash));

    router
        .fallback(serve_static_file)
        .with_state(state)
}

async fn api_models(
    state: State<Arc<AppState>>,
    body: axum::Json<Value>,
) -> axum::Json<Value> {
    crate::llm::get_models(state, body).await
}

async fn api_chat_completions(
    state: State<Arc<AppState>>,
    body: axum::Json<Value>,
) -> Response {
    crate::llm::chat_completions(state, body).await
}

async fn api_live_tuning_start(
    state: State<Arc<AppState>>,
    body: axum::Json<Value>,
) -> Response {
    crate::live_tuning::live_tuning_start(state.0, body.0).await
}

async fn api_live_tuning_screenshot(
    state: State<Arc<AppState>>,
    body: axum::Json<Value>,
) -> axum::Json<Value> {
    crate::live_tuning::live_tuning_screenshot(state.0, body.0).await
}

async fn api_live_tuning_shader_result(
    state: State<Arc<AppState>>,
    body: axum::Json<Value>,
) -> axum::Json<Value> {
    crate::live_tuning::live_tuning_shader_result(state.0, body.0).await
}

async fn api_live_tuning_stop(
    state: State<Arc<AppState>>,
) -> axum::Json<Value> {
    crate::live_tuning::live_tuning_stop(state.0).await
}

/// Proxy the WebSRT gateway's cert hash so the browser fetches same-origin
/// (avoids cross-origin/CORS + self-signed-cert trust issues on LAN). The user
/// enters the WebTransport URL, but `cert-hash.js` is served by the gateway's
/// built-in HTTPS web server on a SEPARATE port (default 5173, not the WT
/// port 4433) — see vendor/WebSRT/docs/embedding.md. We derive the host from
/// the entered URL; the browser sends the gateway's web port (default 5173).
///
/// `danger_accept_invalid_certs(true)` is acceptable here because the real
/// trust anchor is the WebTransport `serverCertificateHashes` pinning done
/// client-side from the hash this proxy returns — TLS is just a transport for
/// the hash bytes, not the trust root.
#[derive(serde::Deserialize)]
struct CertHashParams {
    url: String,
    #[serde(default)]
    web_port: Option<u16>,
}

async fn api_stream_cert_hash(
    Query(params): Query<CertHashParams>,
) -> axum::Json<Value> {
    let parsed = match url::Url::parse(&params.url) {
        Ok(u) => u,
        Err(_) => {
            return axum::Json(
                serde_json::json!({ "hash": null, "error": "invalid gateway url" }),
            )
        }
    };
    // cert-hash.js lives on the gateway's web port (configurable; default
    // 5173), not the WT port the user typed. The browser sends the web port;
    // the host is derived from the entered WT URL.
    let host = parsed.host_str().unwrap_or("127.0.0.1");
    let web_port = params.web_port.unwrap_or(5173);
    let cert_url = format!("https://{}:{}/cert-hash.js", host, web_port);
    let client = match reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(4))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return axum::Json(
                serde_json::json!({ "hash": null, "error": format!("client build: {e}") }),
            )
        }
    };

    match client.get(&cert_url).send().await {
        Ok(r) if r.status().is_success() => {
            let text = r.text().await.unwrap_or_default();
            axum::Json(serde_json::json!({ "hash": extract_cert_hash(&text) }))
        }
        Ok(r) => axum::Json(
            serde_json::json!({ "hash": null, "error": format!("upstream status {} for {}", r.status(), cert_url) }),
        ),
        Err(e) => axum::Json(
            serde_json::json!({ "hash": null, "error": format!("fetch failed for {cert_url}: {e}") }),
        ),
    }
}

/// Parse `CERT_HASH = "…" | null` from the cert-hash.js body. Returns the hex
/// hash string, or None for null/missing.
fn extract_cert_hash(text: &str) -> Option<String> {
    let idx = text.find("CERT_HASH")?;
    let after = text[idx + "CERT_HASH".len()..].trim_start();
    let after = after.strip_prefix('=')?.trim_start();
    if after.starts_with('"') {
        let rest = &after[1..];
        let end = rest.find('"')?;
        Some(rest[..end].to_string())
    } else {
        None
    }
}
