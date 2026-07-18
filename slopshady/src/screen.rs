use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;
use std::sync::Arc;

use crate::state::AppState;

pub async fn screen_capture(
    State(_state): State<Arc<AppState>>,
) -> Response {
    let monitors = match xcap::Monitor::all() {
        Ok(m) => m,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": format!("Failed to enumerate monitors: {e}")})),
            )
                .into_response();
        }
    };

    let monitor = match monitors.first() {
        Some(m) => m,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "No monitors found"})),
            )
                .into_response();
        }
    };

    let image = match monitor.capture_image() {
        Ok(img) => img,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": format!("Failed to capture screen: {e}")})),
            )
                .into_response();
        }
    };

    let mut png_buf = Vec::new();
    let mut encoder = std::io::Cursor::new(&mut png_buf);
    match image.write_to(&mut encoder, image::ImageFormat::Png) {
        Ok(()) => {}
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": format!("Failed to encode PNG: {e}")})),
            )
                .into_response();
        }
    }

    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &png_buf);

    Json(json!({"image": format!("data:image/png;base64,{}", b64)})).into_response()
}
