#![cfg_attr(
    all(feature = "gui", target_os = "windows"),
    windows_subsystem = "windows"
)]

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
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc, RwLock};

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

    #[arg(
        long,
        default_value = "0.0.0.0",
        help = "Bind address for HTTPS server"
    )]
    pub(crate) bind: String,

    #[arg(
        long,
        help = "Disable the server-side LLM relay routes (browser talks to the LLM API directly)"
    )]
    pub(crate) no_llm_relay: bool,
}

pub(crate) fn create_app_state(data_dir: &std::path::Path) -> Arc<state::AppState> {
    let persist_path = data_dir.join("shaders.json");
    let shared_state = state::load_state(&persist_path);
    let (broadcast_tx, _) = broadcast::channel(256);
    let (persist_tx, persist_rx) = mpsc::channel(1);

    Arc::new(state::AppState {
        data: Arc::new(RwLock::new(shared_state)),
        persist_path,
        broadcast_tx,
        next_client_id: AtomicU64::new(1),
        persist_tx,
        persist_rx: std::sync::Mutex::new(Some(persist_rx)),
        tuning: live_tuning::TuningState::new(),
        llm_relay_disabled: std::sync::atomic::AtomicBool::new(false),
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
    bind: String,
    port: u16,
    cert_path: PathBuf,
    key_path: PathBuf,
    handle: axum_server::Handle,
) -> Result<(), String> {
    state::spawn_persist_worker(app_state.clone());
    let app = server::build_router(app_state);
    let bind_addr: std::net::IpAddr = bind
        .parse()
        .unwrap_or(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED));
    let addr = SocketAddr::new(bind_addr, port);

    let tls_config = axum_server::tls_rustls::RustlsConfig::from_pem_file(&cert_path, &key_path)
        .await
        .map_err(|e| format!("failed to load TLS certificate: {e}"))?;

    axum_server::bind_rustls(addr, tls_config)
        .handle(handle)
        .serve(app.into_make_service())
        .await
        .map_err(|e| {
            format!(
                "could not bind to {addr}: {e}\n       Another SlopShady instance may already be running.\n       Use --port <port> to use a different port."
            )
        })
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
    if cli.no_llm_relay {
        app_state
            .llm_relay_disabled
            .store(true, std::sync::atomic::Ordering::SeqCst);
        println!("LLM relay routes disabled (--no-llm-relay)");
    }
    ensure_cert(&cert_path, &key_path);

    println!("Starting HTTPS server on https://localhost:{}", cli.port);

    app_state
        .osc
        .lock()
        .unwrap()
        .spawn(app_state.clone(), cli.osc_bind.clone(), cli.osc_port);

    tokio::select! {
        res = run_https_server(
            app_state.clone(),
            cli.bind,
            cli.port,
            cert_path,
            key_path,
            axum_server::Handle::new(),
        ) => match res {
            Ok(()) => {},
            Err(e) => { eprintln!("{e}"); std::process::exit(1); }
        },
        _ = shutdown_signal() => {
            println!("Shutting down — flushing state...");
            state::flush_persist(&app_state).await;
        }
    }
}

/// Resolves on Ctrl-C (all platforms) or SIGTERM (unix).
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
