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
            (
                [(header::CONTENT_TYPE, mime.as_ref())],
                content.data.to_vec(),
            )
                .into_response()
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
        .route(
            "/api/live-tuning/screenshot",
            post(api_live_tuning_screenshot),
        )
        .route(
            "/api/live-tuning/shader-result",
            post(api_live_tuning_shader_result),
        )
        .route("/api/live-tuning/stop", post(api_live_tuning_stop))
        .route("/api/shaders/download", get(download_shaders))
        .route("/api/stream/cert-hash", get(api_stream_cert_hash));

    router.fallback(serve_static_file).with_state(state)
}

async fn api_models(state: State<Arc<AppState>>, body: axum::Json<Value>) -> axum::Json<Value> {
    crate::llm::get_models(state, body).await
}

async fn api_chat_completions(state: State<Arc<AppState>>, body: axum::Json<Value>) -> Response {
    crate::llm::chat_completions(state, body).await
}

async fn api_live_tuning_start(state: State<Arc<AppState>>, body: axum::Json<Value>) -> Response {
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

async fn api_live_tuning_stop(state: State<Arc<AppState>>) -> axum::Json<Value> {
    crate::live_tuning::live_tuning_stop(state.0).await
}

/// Proxy the WebSRT gateway's `cert-hash.js`. The caller passes the gateway's
/// WEB URL (the page the user browses to); `cert-hash.js` is served same-origin
/// on that host:port. The body advertises both `CERT_HASH` (hex for self-signed
/// pinning, null for PKI/mkcert) and `WT_PORT` (the WebTransport port), so one
/// fetch tells the caller everything needed to build the WT URL and pin the
/// cert. See vendor/WebSRT/docs/embedding.md.
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

async fn api_stream_cert_hash(Query(params): Query<CertHashParams>) -> axum::Json<Value> {
    let parsed = match url::Url::parse(&params.url) {
        Ok(u) => u,
        Err(_) => {
            return axum::Json(serde_json::json!({ "hash": null, "wtPort": null, "error": "invalid gateway url" }))
        }
    };
    // cert-hash.js is served same-origin on the gateway's web server. The
    // input side passes a web URL (port in the URL itself); the legacy
    // `web_port` param (publish side, which still passes a WT URL) overrides.
    let host = parsed.host_str().unwrap_or("127.0.0.1");
    let port = match params.web_port {
        Some(p) => p,
        None => parsed.port_or_known_default().unwrap_or(443),
    };
    let cert_url = format!("https://{}:{}/cert-hash.js", host, port);
    let client = match reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(4))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return axum::Json(
                serde_json::json!({ "hash": null, "wtPort": null, "error": format!("client build: {e}") }),
            )
        }
    };

    match client.get(&cert_url).send().await {
        Ok(r) if r.status().is_success() => {
            let text = r.text().await.unwrap_or_default();
            axum::Json(serde_json::json!({
                "hash": extract_cert_hash(&text),
                "wtPort": extract_wt_port(&text),
            }))
        }
        Ok(r) => axum::Json(
            serde_json::json!({ "hash": null, "wtPort": null, "error": format!("upstream status {} for {}", r.status(), cert_url) }),
        ),
        Err(e) => axum::Json(
            serde_json::json!({ "hash": null, "wtPort": null, "error": format!("fetch failed for {cert_url}: {e}") }),
        ),
    }
}

/// Parse `CERT_HASH = "…" | null` from the cert-hash.js body. Returns the hex
/// hash string, or None for null/missing.
fn extract_cert_hash(text: &str) -> Option<String> {
    let idx = text.find("CERT_HASH")?;
    let after = text[idx + "CERT_HASH".len()..].trim_start();
    let after = after.strip_prefix('=')?.trim_start();
    if let Some(rest) = after.strip_prefix('"') {
        let end = rest.find('"')?;
        Some(rest[..end].to_string())
    } else {
        None
    }
}

/// Parse `WT_PORT = <number>;` from the cert-hash.js body. None when absent
/// (older gateways that don't advertise it — caller falls back to 4433).
fn extract_wt_port(text: &str) -> Option<u16> {
    let idx = text.find("WT_PORT")?;
    let after = text[idx + "WT_PORT".len()..].trim_start();
    let after = after.strip_prefix('=')?.trim_start();
    let end = after.find(|c: char| !c.is_ascii_digit())?;
    after[..end].parse().ok()
}
