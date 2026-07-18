use std::sync::Mutex;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use tauri::Emitter;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AudioError {
    #[error("cpal error: {0}")]
    Cpal(String),
}

pub struct SendStream(pub cpal::Stream);
unsafe impl Send for SendStream {}
unsafe impl Sync for SendStream {}

pub struct AudioCaptureState {
    pub stream: Mutex<Option<SendStream>>,
}

pub fn list_input_devices() -> Result<Vec<String>, AudioError> {
    let host = cpal::default_host();
    let devices = host
        .input_devices()
        .map_err(|e| AudioError::Cpal(e.to_string()))?;
    let mut names = Vec::new();
    for d in devices {
        if let Ok(name) = d.name() {
            names.push(name);
        }
    }
    Ok(names)
}

pub fn list_output_devices() -> Result<Vec<String>, AudioError> {
    let host = cpal::default_host();
    let devices = host
        .output_devices()
        .map_err(|e| AudioError::Cpal(e.to_string()))?;
    let mut names = Vec::new();
    for d in devices {
        if let Ok(name) = d.name() {
            names.push(name);
        }
    }
    Ok(names)
}

#[tauri::command]
pub async fn start_audio_capture(
    device_name: Option<String>,
    is_loopback: bool,
    app: tauri::AppHandle,
    state: tauri::State<'_, AudioCaptureState>,
) -> Result<(), String> {
    // 1. Stop any existing stream
    {
        let mut stream_guard = state.stream.lock().map_err(|e| e.to_string())?;
        if let Some(s) = stream_guard.take() {
            let _ = s.0.pause();
        }
    }

    // 2. Select host and device
    let host = cpal::default_host();
    let device = if let Some(name) = device_name {
        let mut found = None;
        if is_loopback {
            for d in host.output_devices().map_err(|e| e.to_string())? {
                if let Ok(n) = d.name() {
                    if n == name {
                        found = Some(d);
                        break;
                    }
                }
            }
        } else {
            for d in host.input_devices().map_err(|e| e.to_string())? {
                if let Ok(n) = d.name() {
                    if n == name {
                        found = Some(d);
                        break;
                    }
                }
            }
        }
        found.ok_or_else(|| "Selected audio device not found".to_string())?
    } else {
        if is_loopback {
            host.default_output_device()
                .ok_or_else(|| "No default output device for loopback capture".to_string())?
        } else {
            host.default_input_device()
                .ok_or_else(|| "No default input device".to_string())?
        }
    };

    // 3. Resolve configuration
    let config = device
        .default_input_config()
        .or_else(|_| device.default_output_config())
        .map_err(|e| format!("Failed to get audio device config: {}", e))?;

    let sample_format = config.sample_format();
    let stream_config = config.config();
    let channels = stream_config.channels;

    // 4. Emit the configuration to the frontend
    let _ = app.emit(
        "audio-config",
        serde_json::json!({
            "sampleRate": stream_config.sample_rate.0,
            "channels": channels,
        }),
    );

    // 5. Build input stream with appropriate sample conversion
    let app_clone = app.clone();
    let err_fn = |err| eprintln!("Audio stream error: {}", err);

    let stream = match sample_format {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &stream_config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                let mono_data = to_mono_f32(data, channels);
                let _ = app_clone.emit("audio-frame", mono_data);
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            &stream_config,
            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                let f32_data: Vec<f32> = data.iter().map(|&s| s as f32 / 32768.0).collect();
                let mono_data = to_mono_f32(&f32_data, channels);
                let _ = app_clone.emit("audio-frame", mono_data);
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::U16 => device.build_input_stream(
            &stream_config,
            move |data: &[u16], _: &cpal::InputCallbackInfo| {
                let f32_data: Vec<f32> = data.iter().map(|&s| (s as f32 - 32768.0) / 32768.0).collect();
                let mono_data = to_mono_f32(&f32_data, channels);
                let _ = app_clone.emit("audio-frame", mono_data);
            },
            err_fn,
            None,
        ),
        _ => return Err("Unsupported audio sample format".to_string()),
    }
    .map_err(|e| format!("Failed to build input stream: {}", e))?;

    // 6. Start the stream and store it in state
    stream.play().map_err(|e| format!("Failed to start audio stream: {}", e))?;
    
    let mut stream_guard = state.stream.lock().map_err(|e| e.to_string())?;
    *stream_guard = Some(SendStream(stream));

    Ok(())
}

#[tauri::command]
pub async fn stop_audio_capture(
    state: tauri::State<'_, AudioCaptureState>,
) -> Result<(), String> {
    let mut stream_guard = state.stream.lock().map_err(|e| e.to_string())?;
    if let Some(s) = stream_guard.take() {
        let _ = s.0.pause();
    }
    Ok(())
}

fn to_mono_f32(data: &[f32], channels: u16) -> Vec<f32> {
    if channels <= 1 {
        data.to_vec()
    } else {
        let ch = channels as usize;
        data.chunks(ch)
            .map(|chunk| {
                let sum: f32 = chunk.iter().sum();
                sum / (chunk.len() as f32)
            })
            .collect()
    }
}
