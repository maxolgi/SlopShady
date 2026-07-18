use base64::Engine;
use rosc::OscPacket;
use serde_json::{json, Value};
use std::net::UdpSocket;
use std::sync::{mpsc::{channel, Receiver, Sender}, Arc};
use std::thread::JoinHandle;
use std::time::Duration;

use crate::state::AppState;

/// Native OSC bridge — UDP listener that mirrors the MIDI bridge's shape.
/// Receives OSC packets, decodes them with `rosc`, and forwards each message
/// as a JSON object on the broadcast channel:
///   {"type":"osc","address":"/noteon","args":[0,60,100]}
///
/// Bundles are unpacked recursively; each contained message is forwarded.
///
/// `OscBridge` owns the listener thread and can be hot-swapped to a new
/// bind/port via `restart()` (used when the UI changes oscPort/oscBind).
pub struct OscBridge {
    handle: Option<JoinHandle<()>>,
    shutdown: Option<Sender<()>>,
    bind: String,
    port: u16,
}

impl Default for OscBridge {
    fn default() -> Self {
        Self {
            handle: None,
            shutdown: None,
            bind: String::new(),
            port: 0,
        }
    }
}

impl OscBridge {
    /// Whether a listener thread is currently running.
    pub fn is_running(&self) -> bool {
        self.handle.is_some()
    }

    /// Stop the current listener (if any), then spawn a new one bound to
    /// `bind`:`port`. The old thread is joined (it exits within ~100ms via the
    /// socket read timeout) so the port is released before the new bind.
    pub fn spawn(&mut self, app_state: Arc<AppState>, bind: String, port: u16) {
        self.stop();

        let (shutdown_tx, shutdown_rx) = channel::<()>();
        let state = app_state;
        let b = bind.clone();
        let handle = std::thread::spawn(move || {
            run_loop(state, shutdown_rx, b, port);
        });

        self.handle = Some(handle);
        self.shutdown = Some(shutdown_tx);
        self.bind = bind;
        self.port = port;
    }

    /// Restart on `bind`:`port` only if it differs from the current config.
    /// Returns true if a restart was performed.
    pub fn restart(&mut self, app_state: Arc<AppState>, bind: String, port: u16) -> bool {
        if self.is_running() && self.bind == bind && self.port == port {
            return false;
        }
        self.spawn(app_state, bind, port);
        true
    }

    /// Signal shutdown and join the listener thread.
    pub fn stop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for OscBridge {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Inner blocking loop run on a dedicated OS thread.
fn run_loop(app_state: Arc<AppState>, shutdown: Receiver<()>, bind: String, port: u16) {
    let addr = format!("{bind}:{port}");
    let socket = match UdpSocket::bind(&addr) {
        Ok(s) => {
            let _ = s.set_read_timeout(Some(Duration::from_millis(100)));
            tracing::info!("OSC listening on udp {}", addr);
            s
        }
        Err(e) => {
            tracing::warn!("OSC: failed to bind {} — bridge disabled ({})", addr, e);
            return;
        }
    };

    let mut buf = [0u8; 65535];

    loop {
        // Non-blocking shutdown check
        if shutdown.try_recv().is_ok() {
            tracing::info!("OSC bridge shutting down ({}:{})", bind, port);
            return;
        }

        match socket.recv_from(&mut buf) {
            Ok((len, src)) => {
                if len == 0 {
                    continue;
                }
                match rosc::decoder::decode_udp(&buf[..len]) {
                    Ok((_rest, packet)) => forward_packet(&app_state, &packet),
                    Err(e) => {
                        tracing::warn!("OSC decode error from {} ({} bytes): {}", src, len, e);
                    }
                }
            }
            Err(ref e)
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                // Normal idle — keep looping
            }
            Err(e) => {
                tracing::warn!("OSC recv error: {}", e);
            }
        }
    }
}

fn forward_packet(app_state: &Arc<AppState>, packet: &OscPacket) {
    match packet {
        OscPacket::Message(msg) => {
            let args: Vec<Value> = msg.args.iter().map(osc_arg_to_json).collect();
            let payload = json!({
                "type": "osc",
                "address": msg.addr,
                "args": args,
            });
            let _ = app_state.broadcast_tx.send(payload.to_string());
        }
        OscPacket::Bundle(bundle) => {
            tracing::info!("OSC bundle unpacked ({} elements)", bundle.content.len());
            for inner in &bundle.content {
                forward_packet(app_state, inner);
            }
        }
    }
}

fn osc_arg_to_json(arg: &rosc::OscType) -> Value {
    use rosc::OscType;
    match arg {
        OscType::Int(i) => json!(i),
        OscType::Float(f) => json!(f),
        OscType::Double(d) => json!(d),
        OscType::String(s) => json!(s),
        OscType::Bool(b) => json!(b),
        OscType::Long(l) => json!(l),
        OscType::Char(c) => json!(*c as u32),
        // Base64-encode binary blobs so they don't bloat the WS broadcast as
        // huge integer arrays.
        OscType::Blob(b) => json!(base64::engine::general_purpose::STANDARD.encode(b)),
        OscType::Array(arr) => Value::Array(arr.content.iter().map(osc_arg_to_json).collect()),
        OscType::Midi(m) => json!([m.port, m.status, m.data1, m.data2]),
        OscType::Color(rgba) => json!([rgba.red, rgba.green, rgba.blue, rgba.alpha]),
        OscType::Nil | OscType::Inf => Value::Null,
        OscType::Time(t) => json!([t.seconds, t.fractional]),
    }
}
