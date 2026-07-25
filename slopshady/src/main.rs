#![cfg_attr(all(feature = "webview", target_os = "windows"), windows_subsystem = "windows")]

mod cert;
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

#[derive(Parser)]
#[command(name = "slopshady", about = "SlopShady — Real-time GLSL shader editor")]
struct Cli {
    #[arg(short, long, default_value = "8100")]
    port: u16,

    #[arg(short, long, default_value = ".")]
    data_dir: PathBuf,

    #[arg(long, help = "Run without a GUI window (server-only; opens no browser/webview)")]
    no_browser: bool,

    #[arg(long, default_value = "8101", help = "UDP port for OSC input")]
    osc_port: u16,

    #[arg(long, default_value = "0.0.0.0", help = "Bind address for OSC input")]
    osc_bind: String,

    #[arg(long, default_value = "5173", help = "Port for WebSRT gateway cert-hash.js fetch")]
    cert_hash_port: u16,
}

fn create_app_state(data_dir: &std::path::Path, cert_hash_port: u16) -> Arc<state::AppState> {
    let persist_path = data_dir.join("shaders.json");
    let shared_state = state::load_state(&persist_path);
    let (broadcast_tx, _) = broadcast::channel(256);

    Arc::new(state::AppState {
        data: Arc::new(RwLock::new(shared_state)),
        persist_path,
        broadcast_tx,
        tuning: live_tuning::TuningState::new(),
        osc: std::sync::Mutex::new(osc::OscBridge::default()),
        cert_hash_port,
    })
}

fn ensure_cert(cert_path: &std::path::Path, key_path: &std::path::Path) {
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

#[allow(dead_code)]
async fn run_https_server(app_state: Arc<state::AppState>, port: u16, cert_path: PathBuf, key_path: PathBuf) {
    let app = server::build_router(app_state);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    let tls_config = axum_server::tls_rustls::RustlsConfig::from_pem_file(&cert_path, &key_path)
        .await
        .expect("Failed to load TLS config");

    axum_server::bind_rustls(addr, tls_config)
        .serve(app.into_make_service())
        .await
        .expect("Server error");
}

// ── Phase 1: system browser mode ──────────────────────────────────────

#[cfg(not(feature = "webview"))]
#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let cli = Cli::parse();
    let cert_path = cli.data_dir.join("cert.pem");
    let key_path = cli.data_dir.join("key.pem");

    let app_state = create_app_state(&cli.data_dir, cli.cert_hash_port);
    ensure_cert(&cert_path, &key_path);

    println!("Starting HTTPS server on https://localhost:{}", cli.port);

    app_state
        .osc
        .lock()
        .unwrap()
        .spawn(app_state.clone(), cli.osc_bind.clone(), cli.osc_port);

    if !cli.no_browser {
        let url = format!("https://localhost:{}", cli.port);
        if let Err(e) = open::that(&url) {
            eprintln!("Could not open browser: {e} (open {url} manually)");
        }
    }

    run_https_server(app_state, cli.port, cert_path, key_path).await;
}

// ── Phase 2: native webview mode (Linux / GTK) ─────────────────────────

#[cfg(all(feature = "webview", target_os = "linux"))]
fn main() {
    tracing_subscriber::fmt::init();

    let cli = Cli::parse();
    let cert_path = cli.data_dir.join("cert.pem");
    let key_path = cli.data_dir.join("key.pem");

    let app_state = create_app_state(&cli.data_dir, cli.cert_hash_port);
    ensure_cert(&cert_path, &key_path);

    let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");

    let server_state = app_state.clone();
    let server_cert = cert_path.clone();
    let server_key = key_path.clone();
    let port = cli.port;

    let server_handle = rt.spawn(async move {
        run_https_server(server_state, port, server_cert, server_key).await;
    });

    app_state
        .osc
        .lock()
        .unwrap()
        .spawn(app_state.clone(), cli.osc_bind.clone(), cli.osc_port);

    if cli.no_browser {
        println!("SlopShady running headless (no GUI): https://localhost:{}", cli.port);
        rt.block_on(std::future::pending::<()>());
        return;
    }

    std::thread::sleep(std::time::Duration::from_millis(500));

    gtk::init().expect("Failed to initialize GTK");

    use gtk::prelude::*;
    use wry::WebViewBuilderExtUnix;

    let window = gtk::Window::new(gtk::WindowType::Toplevel);
    window.set_title("SlopShady");
    window.set_default_size(1600, 1000);
    window.set_size_request(1024, 768);

    let icon_bytes = include_bytes!("../../icon.png");

    if let Ok(home) = std::env::var("HOME") {
        let icon_dir = format!("{}/.local/share/icons/hicolor/256x256/apps", home);
        let _ = std::fs::create_dir_all(&icon_dir);
        let _ = std::fs::write(format!("{}/slopshady.png", icon_dir), icon_bytes);
    }

    window.set_icon_name(Some("slopshady"));

    let loader = gtk::gdk_pixbuf::PixbufLoader::new();
    if loader.write(icon_bytes).is_ok() {
        let _ = loader.close();
        if let Some(pixbuf) = loader.pixbuf() {
            if let Some(scaled) = pixbuf.scale_simple(128, 128, gtk::gdk_pixbuf::InterpType::Bilinear) {
                gtk::Window::set_default_icon(&scaled);
            }
        }
    }

    let url = format!("https://localhost:{}", cli.port);

    let mut web_context = wry::WebContext::new(None::<std::path::PathBuf>);
    web_context.set_ignore_tls_errors();

    let _webview = wry::WebViewBuilder::new_with_web_context(&mut web_context)
        .with_url(&url)
        .with_devtools(true)
        .build_gtk(&window)
        .expect("Failed to create webview");

    window.show_all();

    let rt = std::sync::Mutex::new(Some(rt));
    let osc_state = app_state.clone();
    window.connect_delete_event(move |_, _| {
        server_handle.abort();
        osc_state.osc.lock().unwrap().stop();
        if let Some(rt) = rt.lock().unwrap().take() {
            rt.shutdown_background();
        }
        gtk::main_quit();
        gtk::glib::Propagation::Proceed
    });

    println!("SlopShady running in native window ({})", url);
    gtk::main();
}

// ── native webview mode (Windows / WebView2) ──────────────────────────
//
// A Windows Job Object (KILL_ON_JOB_CLOSE) ensures all child processes
// (msedgewebview2.exe renderer processes) are killed instantly when this
// process exits — whether by graceful close, force-kill, or crash.
// This replaces the previous 3-phase timed shutdown.

#[cfg(all(feature = "webview", target_os = "windows"))]
fn setup_job_object() {
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
        JobObjectExtendedLimitInformation, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    };
    use windows::Win32::System::Threading::GetCurrentProcess;

    unsafe {
        let job = CreateJobObjectW(None, None).expect("CreateJobObject failed");

        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ).expect("SetInformationJobObject failed");

        AssignProcessToJobObject(job, GetCurrentProcess())
            .expect("AssignProcessToJobObject failed");

        let _ = job;
    }
}

#[cfg(all(feature = "webview", target_os = "windows"))]
fn kill_process_tree() {
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
    use windows::Win32::Foundation::CloseHandle;

    let current_pid = std::process::id();
    unsafe {
        let snapshot = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            Ok(s) => s,
            Err(_) => return,
        };
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        let mut parent_map: Vec<(u32, u32)> = Vec::new();
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                parent_map.push((entry.th32ProcessID, entry.th32ParentProcessID));
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);

        let mut to_kill: Vec<u32> = Vec::new();
        let mut queue: Vec<u32> = vec![current_pid];
        while let Some(parent) = queue.pop() {
            for &(pid, ppid) in &parent_map {
                if ppid == parent && pid != current_pid {
                    to_kill.push(pid);
                    queue.push(pid);
                }
            }
        }

        for pid in to_kill {
            if let Ok(handle) = OpenProcess(PROCESS_TERMINATE, false, pid) {
                let _ = TerminateProcess(handle, 1);
                let _ = CloseHandle(handle);
            }
        }
    }
}

#[cfg(all(feature = "webview", target_os = "windows"))]
#[derive(Clone)]
enum UserMsg {
    ToggleFullscreen,
}

#[cfg(all(feature = "webview", target_os = "windows"))]
fn main() {
    tracing_subscriber::fmt::init();

    setup_job_object();

    let cli = Cli::parse();
    let cert_path = cli.data_dir.join("cert.pem");
    let key_path = cli.data_dir.join("key.pem");

    let app_state = create_app_state(&cli.data_dir, cli.cert_hash_port);
    ensure_cert(&cert_path, &key_path);

    let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");

    let server_state = app_state.clone();
    let server_cert = cert_path.clone();
    let server_key = key_path.clone();
    let port = cli.port;

    rt.spawn(async move {
        run_https_server(server_state, port, server_cert, server_key).await;
    });

    app_state
        .osc
        .lock()
        .unwrap()
        .spawn(app_state.clone(), cli.osc_bind.clone(), cli.osc_port);

    std::thread::sleep(std::time::Duration::from_millis(500));

    let event_loop = tao::event_loop::EventLoopBuilder::<UserMsg>::with_user_event().build();
    let fullscreen_proxy = event_loop.create_proxy();

    let icon_bytes = include_bytes!("../../icon.png");
    let window_icon = image::load_from_memory(icon_bytes)
        .ok()
        .map(|img| {
            let rgba = img.to_rgba8();
            let (w, h) = rgba.dimensions();
            tao::window::Icon::from_rgba(rgba.into_raw(), w, h).ok()
        })
        .flatten();

    let mut builder = tao::window::WindowBuilder::new()
        .with_title("SlopShady")
        .with_inner_size(tao::dpi::LogicalSize::new(1600.0, 1000.0))
        .with_min_inner_size(tao::dpi::LogicalSize::new(1024.0, 768.0));
    if let Some(icon) = window_icon {
        builder = builder.with_window_icon(Some(icon));
    }
    let window = builder
        .build(&event_loop)
        .expect("Failed to create window");

    let url = format!("https://localhost:{}", cli.port);

    let webview = wry::WebViewBuilder::new()
        .with_url(&url)
        .with_devtools(true)
        .with_ignore_tls_errors(true)
        .with_ipc_handler(move |req| {
            if req.body().as_str() == "toggle-fullscreen" {
                let _ = fullscreen_proxy.send_event(UserMsg::ToggleFullscreen);
            }
        })
        .build(&window)
        .expect("Failed to create webview");

    let _webview = std::cell::RefCell::new(Some(webview));

    println!("SlopShady running in native window ({})", url);

    event_loop.run(move |event, _, control_flow| {
        if let tao::event::Event::UserEvent(UserMsg::ToggleFullscreen) = &event {
            let new_fs = if window.fullscreen().is_some() {
                None
            } else {
                Some(tao::window::Fullscreen::Borderless(None))
            };
            window.set_fullscreen(new_fs);
        }
        if let tao::event::Event::WindowEvent {
            event: tao::event::WindowEvent::CloseRequested,
            ..
        } = event
        {
            drop(_webview.borrow_mut().take());
            kill_process_tree();
            std::process::exit(0);
        }
        *control_flow = tao::event_loop::ControlFlow::Wait;
    });
}
