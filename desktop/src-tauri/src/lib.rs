mod audio;
mod sidecar;

use serde::Serialize;
use std::sync::Mutex;
use audio::{AudioCaptureState, start_audio_capture, stop_audio_capture};

#[derive(Debug, Serialize)]
pub struct SidecarStarted {
    pub ip: String,
    pub port: u16,
}

#[tauri::command]
async fn spawn_signaling_sidecar(app: tauri::AppHandle) -> Result<SidecarStarted, String> {
    sidecar::spawn(&app).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_audio_inputs() -> Result<Vec<String>, String> {
    audio::list_input_devices().map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_audio_outputs() -> Result<Vec<String>, String> {
    audio::list_output_devices().map_err(|e| e.to_string())
}

pub fn run() {
    tracing_subscriber::fmt::init();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AudioCaptureState {
            stream: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            spawn_signaling_sidecar,
            list_audio_inputs,
            list_audio_outputs,
            start_audio_capture,
            stop_audio_capture
        ])
        .run(tauri::generate_context!())
        .expect("failed to run SShare desktop");
}
