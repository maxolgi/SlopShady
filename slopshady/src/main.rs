#![cfg_attr(all(feature = "gui", target_os = "windows"), windows_subsystem = "windows")]

mod cert;
#[cfg(feature = "gui")]
mod gui;
mod live_tuning;
mod llm;
mod osc;
mod server;
mod state;
mod ws;

use clap::Parser;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

#[derive(Parser, Clone)]
#[command(name = "slopshady", about = "SlopShady — Real-time GLSL shader editor")]
pub(crate) struct Cli {
    #[arg(short, long, default_value = "8100")]
    pub(crate) port: u16,

    #[arg(short, long, default_value = ".")]
    pub(crate) data_dir: PathBuf,

    #[arg(long, help = "Run without the GUI (server-only)")]
    pub(crate) no_gui: bool,

    #[arg(long, default_value = "8101", help = "UDP port for OSC input")]
    pub(crate) osc_port: u16,

    #[arg(long, default_value = "0.0.0.0", help = "Bind address for OSC input")]
    pub(crate) osc_bind: String,
}

pub(crate) fn create_app_state(data_dir: &std::path::Path) -> Arc<state::AppState> {
    let persist_path = data_dir.join("shaders.json");
    let shared_state = state::load_state(&persist_path);
    let (broadcast_tx, _) = broadcast::channel(256);

    Arc::new(state::AppState {
        data: Arc::new(RwLock::new(shared_state)),
        persist_path,
        broadcast_tx,
        tuning: live_tuning::TuningState::new(),
        osc: std::sync::Mutex::new(osc::OscBridge::default()),
    })
}

pub(crate) fn ensure_cert(cert_path: &std::path::Path, key_path: &std::path::Path) {
    if !cert_path.exists() || !key_path.exists() {
        println!("Generating self-signed certificate for HTTPS...");
        match cert::generate_self_signed_cert(cert_path, key_path) {
            Ok(()) => {
                println!("Certificate saved to: {}", cert_path.display());
            }
            Err(e) => {
                eprintln!("Error generating certificate: {e}");
                std::process::exit(1);
            }
        }
    }
}

pub(crate) async fn run_https_server(
    app_state: Arc<state::AppState>,
    port: u16,
    cert_path: PathBuf,
    key_path: PathBuf,
    handle: axum_server::Handle,
) {
    let app = server::build_router(app_state);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    let tls_config = axum_server::tls_rustls::RustlsConfig::from_pem_file(&cert_path, &key_path)
        .await
        .expect("Failed to load TLS config");

    axum_server::bind_rustls(addr, tls_config)
        .handle(handle)
        .serve(app.into_make_service())
        .await
        .expect("Server error");
}

fn main() {
    tracing_subscriber::fmt::init();
    let cli = Cli::parse();
    #[cfg(feature = "gui")]
    {
        if !cli.no_gui {
            gui::run(cli);
            return;
        }
    }
    run_headless(cli);
}

#[tokio::main]
async fn run_headless(cli: Cli) {
    let cert_path = cli.data_dir.join("cert.pem");
    let key_path = cli.data_dir.join("key.pem");

    let app_state = create_app_state(&cli.data_dir);
    ensure_cert(&cert_path, &key_path);

    println!("Starting HTTPS server on https://localhost:{}", cli.port);

    app_state
        .osc
        .lock()
        .unwrap()
        .spawn(app_state.clone(), cli.osc_bind.clone(), cli.osc_port);

    run_https_server(app_state, cli.port, cert_path, key_path, axum_server::Handle::new()).await;
}
