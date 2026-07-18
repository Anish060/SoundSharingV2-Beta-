# 🎧 SShare (Sound Share)

> **Ultra-low latency, local-network audio broadcasting platform.** Stream host PC system audio (music, games, media) or microphone input directly to mobile devices over local Wi-Fi or Hotspots via WebRTC.

---

## 🚀 Features

* **🔊 System Audio & Loopback Capture**: Stream any sound playing on your computer (Spotify, YouTube, games, system alerts) directly to mobile phones using native Rust WASAPI audio capture (`cpal`).
* **🎤 Microphone Streaming**: Toggle seamlessly between desktop microphone capture and system speaker loopback.
* **⚡ Ultra-Low Latency (<200ms)**: Direct peer-to-peer audio transport using WebRTC data and media tracks over local networks.
* **📷 Instant QR Code Session Joining**: Built-in mobile camera QR code scanner (`expo-camera`) for one-tap listener connection.
* **🌐 Dynamic Multi-Adapter IP Routing**: Automatic discovery and dropdown selection for multi-homed hosts (Wi-Fi, Ethernet, Mobile Hotspots).
* **🔒 Session Security**: Passcode-protected session joining and room management.
* **🎛️ Real-Time Audio Engine**: Automated stereo-to-mono channel downmixing and high-performance ring-buffer queue management.

---

## 🛠️ Architecture & Tech Stack

```
+-------------------------------------------------------------------------+
|                              SShare Host                                |
|  +------------------------+             +----------------------------+  |
|  | Native Rust Backend    |--Tauri IPC->| React Desktop Frontend     |  |
|  | (cpal WASAPI Capture)  |             | (Web Audio & Ring Buffer)  |  |
|  +------------------------+             +-------------+--------------+  |
+-------------------------------------------------------|-----------------+
                                                        |
                                            WebRTC Audio Stream (P2P)
                                                        |
                                                        v
+------------------------+                +----------------------------+
| Node.js Signaling      |<-WebSockets--->| Mobile Listener App        |
| (Express + Socket.io)  |                | (Expo + React Native WebRTC) |
+------------------------+                +----------------------------+
```

| Component | Stack / Library | Description |
| :--- | :--- | :--- |
| **Desktop Host** | Tauri v2, Rust (`cpal`), React, Vite | WASAPI system loopback capture, Web Audio pipeline, WebRTC peer orchestration |
| **Mobile App** | Expo (React Native), `react-native-webrtc`, `expo-camera` | Camera QR scanner, native WebRTC audio receiver & playback engine |
| **Signaling Server** | Node.js, Express, Socket.io, TypeScript | Local network discovery, session registration, ICE candidate signaling |
| **Shared Core** | TypeScript monorepo package | Unified QR payload schema, validation rules, Socket event definitions |

---

## 📦 Monorepo Workspace Structure

```
SShare/
├── packages/
│   ├── shared/     # Shared types, QR encoders/decoders, Socket.IO contracts
│   ├── backend/    # Node.js signaling & session coordination server
│   ├── desktop/    # Tauri v2 + React host app with WASAPI Rust audio engine
│   └── mobile/     # Expo React Native listener app with QR scanner
├── pnpm-workspace.yaml
└── package.json
```

---

## ⚡ Quick Start Guide

### Prerequisites
* **Node.js** `>=20.0.0`
* **pnpm** `>=9.0.0`
* **Rust** `stable` (with `x86_64-pc-windows-msvc` target for Windows WASAPI loopback)

### Installation & Setup

```bash
# 1. Install workspace dependencies
pnpm install

# 2. Start the Signaling Backend
pnpm dev:backend

# 3. Launch the Native Desktop App (Host)
pnpm dev:desktop

# 4. Launch the Mobile Listener App
pnpm dev:mobile
```
