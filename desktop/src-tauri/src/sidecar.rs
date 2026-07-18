use crate::SidecarStarted;
use tauri::AppHandle;
use thiserror::Error;

#[allow(dead_code)]
#[derive(Debug, Error)]
pub enum SidecarError {
    #[error("failed to spawn sidecar: {0}")]
    Spawn(String),
    #[error("failed to enumerate network interfaces: {0}")]
    Network(String),
}

pub async fn spawn(_app: &AppHandle) -> Result<SidecarStarted, SidecarError> {
    let port = 3000u16;
    let ip = pick_local_ip().unwrap_or_else(|| "127.0.0.1".to_string());
    Ok(SidecarStarted { ip, port })
}

fn pick_local_ip() -> Option<String> {
    // Prefer the first RFC1918 IPv4 address on a non-loopback interface.
    // Uses `std::net` via a UDP connect trick to avoid a heavy dep.
    use std::net::UdpSocket;
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("8.8.8.8:80").ok()?;
    Some(sock.local_addr().ok()?.ip().to_string())
}
