use std::sync::Arc;
use std::time::Duration;

use eframe::egui;

use crate::Cli;

pub fn run(cli: Cli) {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([450.0, 400.0])
            .with_min_inner_size([400.0, 350.0])
            .with_resizable(false)
            .with_title("SlopShady"),
        ..Default::default()
    };

    let result = eframe::run_native(
        "SlopShady",
        options,
        Box::new(move |cc| Ok(Box::new(ControlPanel::new(cli, cc)))),
    );

    if let Err(e) = result {
        eprintln!("GUI error: {e:?}");
    }
}

struct ControlPanel {
    rt: Option<tokio::runtime::Runtime>,
    port: String,
    data_dir: String,
    osc_port: String,
    osc_bind: String,
    running: bool,
    app_state: Option<Arc<crate::state::AppState>>,
    handle: Option<axum_server::Handle>,
    url: String,
    error: Option<String>,
}

impl ControlPanel {
    fn new(cli: Cli, _cc: &eframe::CreationContext<'_>) -> Self {
        Self {
            rt: Some(tokio::runtime::Runtime::new().expect("Failed to create tokio runtime")),
            port: cli.port.to_string(),
            data_dir: cli.data_dir.to_string_lossy().into_owned(),
            osc_port: cli.osc_port.to_string(),
            osc_bind: cli.osc_bind,
            running: false,
            app_state: None,
            handle: None,
            url: String::new(),
            error: None,
        }
    }

    fn start_server(&mut self) {
        let port: u16 = match self.port.parse() {
            Ok(p) => p,
            Err(_) => {
                self.error = Some(format!("Invalid port: {}", self.port));
                return;
            }
        };
        let osc_port: u16 = match self.osc_port.parse() {
            Ok(p) => p,
            Err(_) => {
                self.error = Some(format!("Invalid OSC port: {}", self.osc_port));
                return;
            }
        };

        let data_dir = std::path::PathBuf::from(&self.data_dir);
        let cert_path = data_dir.join("cert.pem");
        let key_path = data_dir.join("key.pem");

        let app_state = crate::create_app_state(&data_dir);
        crate::ensure_cert(&cert_path, &key_path);

        app_state
            .osc
            .lock()
            .unwrap()
            .spawn(app_state.clone(), self.osc_bind.clone(), osc_port);

        let handle = axum_server::Handle::new();
        let server_handle = handle.clone();
        let server_state = app_state.clone();
        let server_cert = cert_path.clone();
        let server_key = key_path.clone();
        self.rt
            .as_ref()
            .expect("runtime")
            .spawn(async move {
                crate::run_https_server(server_state, port, server_cert, server_key, server_handle)
                    .await;
            });

        self.url = format!("https://localhost:{port}");
        self.app_state = Some(app_state);
        self.handle = Some(handle);
        self.running = true;
        self.error = None;
        println!("SlopShady server started on {}", self.url);
    }

    fn stop_server(&mut self) {
        if let Some(handle) = self.handle.take() {
            handle.shutdown();
        }
        if let Some(app_state) = self.app_state.take() {
            app_state.osc.lock().unwrap().stop();
        }
        if self.running {
            println!("SlopShady server stopped");
        }
        self.running = false;
        self.url.clear();
    }
}

impl Drop for ControlPanel {
    fn drop(&mut self) {
        self.stop_server();
        if let Some(rt) = self.rt.take() {
            rt.shutdown_timeout(Duration::from_secs(1));
        }
    }
}

impl eframe::App for ControlPanel {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        egui::CentralPanel::default().show(ctx, |ui| {
            ui.heading("SlopShady");
            ui.separator();

            if self.running {
                ui.label(format!("Running at {}", self.url));
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    if ui.button("Open Browser").clicked() {
                        if let Err(e) = open::that(&self.url) {
                            self.error = Some(format!("Could not open browser: {e}"));
                        }
                    }
                    if ui.button("Stop").clicked() {
                        self.stop_server();
                    }
                });
            } else {
                egui::Grid::new("config_grid")
                    .num_columns(2)
                    .spacing([10.0, 8.0])
                    .show(ui, |ui| {
                        ui.label("Port");
                        ui.text_edit_singleline(&mut self.port);
                        ui.end_row();

                        ui.label("Data dir");
                        ui.text_edit_singleline(&mut self.data_dir);
                        ui.end_row();

                        ui.label("OSC port");
                        ui.text_edit_singleline(&mut self.osc_port);
                        ui.end_row();

                        ui.label("OSC bind");
                        ui.text_edit_singleline(&mut self.osc_bind);
                        ui.end_row();
                    });

                ui.add_space(12.0);
                if ui.button("Start").clicked() {
                    self.start_server();
                }
            }

            if let Some(err) = &self.error {
                ui.add_space(8.0);
                ui.colored_label(egui::Color32::from_rgb(220, 80, 80), err);
            }
        });
    }
}
