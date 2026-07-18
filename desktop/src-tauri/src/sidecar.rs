use crate::SidecarStarted;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SidecarError {
    #[error("failed to spawn sidecar: {0}")]
    Spawn(String),
    #[error("failed to enumerate network interfaces: {0}")]
    Network(String),
}

pub async fn spawn(app: &AppHandle) -> Result<SidecarStarted, SidecarError> {
    let port = 3000u16;

    // Sidecar binary lives under `binaries/sshare-signaling(-<triple>)` and is
    // registered as an externalBin in tauri.conf.json. If it hasn't been built
    // yet, `sidecar()` will return an error at runtime.
    let cmd = app
        .shell()
        .sidecar("sshare-signaling")
        .map_err(|e| SidecarError::Spawn(e.to_string()))?;

    let (_rx, _child) = cmd
        .env("PORT", port.to_string())
        .env("HOST", "0.0.0.0")
        .spawn()
        .map_err(|e| SidecarError::Spawn(e.to_string()))?;

    let ip = pick_local_ip().ok_or_else(|| SidecarError::Network("no LAN interface found".into()))?;
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
