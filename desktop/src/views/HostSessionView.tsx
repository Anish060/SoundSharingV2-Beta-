import { useEffect, useMemo, useState, useRef } from "react";
import QRCode from "qrcode";
import { encodeQr, type QrPayload } from "@sshare/shared";
import { startSignalingSidecar, type SidecarInfo } from "../sidecar.js";
import { useHostAudio } from "../useHostAudio.js";

interface Props {
  hostName: string;
}

export function HostSessionView({ hostName }: Props): JSX.Element {
  const [sidecar, setSidecar] = useState<SidecarInfo | null>(null);
  const [passcode] = useState(() => generatePasscode());
  const [error, setError] = useState<string | null>(null);
  const [sessionCode, setSessionCode] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const [listeners, setListeners] = useState<Map<string, string>>(new Map());
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());

  const {
    audioTrack,
    isCapturing,
    startCapture,
    stopCapture,
    error: audioError,
    inputDevices,
    outputDevices,
  } = useHostAudio();

  const [selectedDevice, setSelectedDevice] = useState("");
  const [isLoopback, setIsLoopback] = useState(false);

  const audioTrackRef = useRef<MediaStreamTrack | null>(null);
  useEffect(() => {
    audioTrackRef.current = audioTrack;
  }, [audioTrack]);

  const [activeIp, setActiveIp] = useState("");
  const activeIpRef = useRef("");

  useEffect(() => {
    activeIpRef.current = activeIp;
  }, [activeIp]);

  useEffect(() => {
    if (sidecar) {
      setActiveIp(sidecar.ip);
    }
  }, [sidecar]);

  // Set default device selection when lists load
  useEffect(() => {
    const devices = isLoopback ? outputDevices : inputDevices;
    if (devices.length > 0 && !selectedDevice) {
      const firstDevice = devices[0];
      if (firstDevice) {
        setSelectedDevice(firstDevice);
      }
    }
  }, [inputDevices, outputDevices, isLoopback, selectedDevice]);

  // Start sidecar and session
  useEffect(() => {
    let cancelled = false;
    startSignalingSidecar({ hostName, passcode })
      .then((info) => {
        if (cancelled) return;
        setSidecar(info);
        setSessionCode(info.sessionCode);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [hostName, passcode]);

  // Setup Socket.IO listeners once sidecar socket is available
  useEffect(() => {
    if (!sidecar || !sidecar.socket) return;

    const sock = sidecar.socket;

    sock.on("listener-joined", async (payload: { socketId: string; listenerName: string }) => {
      console.log(`[HostSessionView] Listener joined: ${payload.listenerName} (${payload.socketId})`);
      setListeners((prev) => {
        const next = new Map(prev);
        next.set(payload.socketId, payload.listenerName);
        return next;
      });

      // 1. Create peer connection
      console.log(`[HostSessionView] Creating RTCPeerConnection for listener ${payload.socketId}`);
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
        ],
      });
      peerConnectionsRef.current.set(payload.socketId, pc);

      pc.onconnectionstatechange = () => {
        console.log(`[HostSessionView] WebRTC connectionState for ${payload.socketId} (${payload.listenerName}) changed to: ${pc.connectionState}`);
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`[HostSessionView] WebRTC iceConnectionState for ${payload.socketId} (${payload.listenerName}) changed to: ${pc.iceConnectionState}`);
      };

      pc.onicegatheringstatechange = () => {
        console.log(`[HostSessionView] WebRTC iceGatheringState for ${payload.socketId} (${payload.listenerName}) changed to: ${pc.iceGatheringState}`);
      };

      // 2. Reserve an audio transceiver so the offer always has an m=audio
      // section, even when capture hasn't started yet. The hot-swap effect
      // below will attach the real track via sender.replaceTrack when it
      // becomes available.
      const transceiver = pc.addTransceiver("audio", { direction: "sendonly" });
      const currentTrack = audioTrackRef.current;
      if (currentTrack) {
        console.log(`[HostSessionView] Attaching active audio track to transceiver for listener ${payload.socketId}`);
        await transceiver.sender.replaceTrack(currentTrack);
      } else {
        console.log(`[HostSessionView] Listener ${payload.socketId} joined before capture started; sending offer with muted transceiver`);
      }

      // 3. ICE Candidate callback
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const candidateJson = event.candidate.toJSON();
          const currentIp = activeIpRef.current;
          if (currentIp && candidateJson.candidate) {
            const original = candidateJson.candidate;
            candidateJson.candidate = rewriteCandidate(candidateJson.candidate, currentIp);
            console.log(`[HostSessionView] Trickled candidate for listener ${payload.socketId}. Original: "${original}", Rewritten: "${candidateJson.candidate}"`);
          } else {
            console.log(`[HostSessionView] Trickled candidate for listener ${payload.socketId}:`, candidateJson.candidate);
          }
          sock.emit("ice-candidate", {
            target: payload.socketId,
            candidate: candidateJson,
          });
        }
      };

      // 4. Create offer
      try {
        console.log(`[HostSessionView] Creating SDP offer for listener ${payload.socketId}...`);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const currentIp = activeIpRef.current;
        const sdp = currentIp ? rewriteSdp(offer.sdp || "", currentIp) : offer.sdp;
        console.log(`[HostSessionView] Sending WebRTC offer to listener ${payload.socketId}. Custom SDP:\n${sdp}`);
        sock.emit("webrtc-offer", {
          target: payload.socketId,
          sdp: { type: offer.type, sdp },
        });
      } catch (err) {
        console.error(`[HostSessionView] Failed to create WebRTC offer for ${payload.socketId}:`, err);
      }
    });

    sock.on("webrtc-answer", async (payload: { from: string; sdp: any }) => {
      console.log(`[HostSessionView] Received WebRTC answer from listener ${payload.from}`);
      const pc = peerConnectionsRef.current.get(payload.from);
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          console.log(`[HostSessionView] Remote description set for listener ${payload.from}`);
        } catch (err) {
          console.error(`[HostSessionView] Failed to set remote description for ${payload.from}:`, err);
        }
      } else {
        console.warn(`[HostSessionView] No PeerConnection found for answering listener ${payload.from}`);
      }
    });

    sock.on("ice-candidate", async (payload: { from: string; candidate: any }) => {
      console.log(`[HostSessionView] Received trickled ICE candidate from listener ${payload.from}:`, payload.candidate);
      const pc = peerConnectionsRef.current.get(payload.from);
      if (pc) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
          console.log(`[HostSessionView] Added ICE candidate for listener ${payload.from}`);
        } catch (err) {
          console.warn(`[HostSessionView] Failed to add ICE candidate from listener ${payload.from}:`, err);
        }
      } else {
        console.warn(`[HostSessionView] No PeerConnection found for candidate from listener ${payload.from}`);
      }
    });

    sock.on("listener-left", (payload: { socketId: string }) => {
      console.log(`[HostSessionView] Listener left: ${payload.socketId}`);
      setListeners((prev) => {
        const next = new Map(prev);
        next.delete(payload.socketId);
        return next;
      });

      const pc = peerConnectionsRef.current.get(payload.socketId);
      if (pc) {
        pc.close();
        peerConnectionsRef.current.delete(payload.socketId);
      }
    });

    return () => {
      sock.off("listener-joined");
      sock.off("webrtc-answer");
      sock.off("ice-candidate");
      sock.off("listener-left");
      peerConnectionsRef.current.forEach((pc) => pc.close());
      peerConnectionsRef.current.clear();
      sock.disconnect();
    };
  }, [sidecar]);

  // Handle hot-swapping or toggling of audio tracks across all active listeners
  useEffect(() => {
    peerConnectionsRef.current.forEach(async (pc) => {
      const senders = pc.getSenders();
      const audioSender = senders.find((s) => s.track?.kind === "audio" || !s.track);

      if (audioTrack) {
        if (audioSender) {
          try {
            await audioSender.replaceTrack(audioTrack);
          } catch (e) {
            console.error("Failed to replace audio track:", e);
          }
        } else {
          pc.addTrack(audioTrack, new MediaStream([audioTrack]));
        }
      } else {
        if (audioSender) {
          try {
            pc.removeTrack(audioSender);
          } catch (e) {
            console.error("Failed to remove audio track:", e);
          }
        }
      }
    });
  }, [audioTrack]);

  const qrPayload: QrPayload | null = useMemo(() => {
    if (!sidecar || !sessionCode || !activeIp) return null;
    return {
      v: 1,
      ip: activeIp,
      port: sidecar.port,
      code: sessionCode,
      protocol: "ws",
      requiresPasscode: true,
      convexUrl: "https://elated-scorpion-697.convex.cloud",
    };
  }, [sidecar, sessionCode, activeIp]);

  useEffect(() => {
    if (!qrPayload) return;
    let cancelled = false;
    QRCode.toDataURL(encodeQr(qrPayload), { width: 320, margin: 1 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [qrPayload]);

  const handleToggleCapture = async () => {
    if (isCapturing) {
      await stopCapture();
    } else {
      await startCapture(selectedDevice || undefined, isLoopback);
    }
  };

  const handleToggleLoopback = (checked: boolean) => {
    setIsLoopback(checked);
    setSelectedDevice("");
  };

  if (error) {
    return (
      <main className="app">
        <h1>Could not start host</h1>
        <pre className="error">{error}</pre>
      </main>
    );
  }

  const activeDeviceList = isLoopback ? outputDevices : inputDevices;

  return (
    <main className="app">
      <h1>Session live</h1>
      <p>Listeners on your Wi-Fi can scan this code or enter the details below.</p>

      <div className="qr">
        {qrDataUrl ? <img src={qrDataUrl} alt="Session QR code" /> : <div className="qr-placeholder">Generating…</div>}
      </div>

      <dl className="session-info">
        <dt>Session code</dt>
        <dd>{sessionCode ?? "…"}</dd>
        <dt>Passcode</dt>
        <dd>{passcode}</dd>
        <dt>Server IP</dt>
        <dd style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
          {sidecar && sidecar.ips && sidecar.ips.length > 1 ? (
            <select
              value={activeIp}
              onChange={(e) => setActiveIp(e.target.value)}
              style={{
                background: "#1e293b",
                border: "1px solid #334155",
                color: "#e2e8f0",
                borderRadius: "4px",
                padding: "2px 6px",
                fontSize: "0.95rem",
              }}
            >
              {sidecar.ips.map((ip) => (
                <option key={ip} value={ip}>
                  {ip}
                </option>
              ))}
            </select>
          ) : (
            activeIp || "…"
          )}
          {sidecar ? ` : ${sidecar.port}` : ""}
        </dd>
      </dl>

      <hr style={{ border: "0", borderTop: "1px solid #334155", margin: "1rem 0" }} />

      <section style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h2>Audio Sharing</h2>
        
        {audioError && <div className="error">{audioError}</div>}

        <label style={{ flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={isLoopback}
            onChange={(e) => handleToggleLoopback(e.target.checked)}
            disabled={isCapturing}
          />
          <span>Capture System Audio (Loopback)</span>
        </label>

        <label>
          Select Device
          <select
            value={selectedDevice}
            onChange={(e) => setSelectedDevice(e.target.value)}
            disabled={isCapturing}
            style={{
              padding: "0.65rem 0.85rem",
              background: "#1e293b",
              border: "1px solid #334155",
              color: "#e2e8f0",
              borderRadius: "6px",
              fontSize: "1rem",
            }}
          >
            {activeDeviceList.map((dev) => (
              <option key={dev} value={dev}>
                {dev}
              </option>
            ))}
            {activeDeviceList.length === 0 && (
              <option value="">No devices detected</option>
            )}
          </select>
        </label>

        <button
          className="primary"
          onClick={handleToggleCapture}
          style={{
            backgroundColor: isCapturing ? "#f87171" : "#38bdf8",
            color: "#0f172a",
          }}
        >
          {isCapturing ? "Stop Streaming" : "Start Streaming"}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.9rem" }}>
          <span
            style={{
              height: "10px",
              width: "10px",
              borderRadius: "50%",
              backgroundColor: isCapturing ? "#4ade80" : "#64748b",
              display: "inline-block",
            }}
          />
          <span>{isCapturing ? "Broadcasting live" : "Broadcasting paused"}</span>
        </div>
      </section>

      <hr style={{ border: "0", borderTop: "1px solid #334155", margin: "1rem 0" }} />

      <section>
        <h2>Connected Listeners ({listeners.size})</h2>
        {listeners.size === 0 ? (
          <p style={{ color: "#64748b", fontStyle: "italic", fontSize: "0.95rem" }}>
            Waiting for listeners to join...
          </p>
        ) : (
          <ul style={{ paddingLeft: "1.2rem", margin: "0.5rem 0", color: "#cbd5e1" }}>
            {Array.from(listeners.entries()).map(([id, name]) => (
              <li key={id} style={{ marginBottom: "0.25rem" }}>
                {name} <span style={{ color: "#64748b", fontSize: "0.8rem" }}>({id.slice(0, 6)})</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function generatePasscode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function rewriteCandidate(candidateStr: string, actualIp: string): string {
  const parts = candidateStr.split(" ");
  if (parts.length > 4 && parts[7] === "host") {
    const ipOrDomain = parts[4];
    if (ipOrDomain && (ipOrDomain.endsWith(".local") || ipOrDomain === "127.0.0.1" || ipOrDomain === "localhost")) {
      parts[4] = actualIp;
      return parts.join(" ");
    }
  }
  return candidateStr;
}

function rewriteSdp(sdp: string, actualIp: string): string {
  return sdp.replace(
    /a=candidate:(.*?) (udp|tcp) (.*?) ([^ ]+?) ([0-9]+?) typ host/g,
    (match, p1, protocol, p2, ipOrDomain, port) => {
      if (ipOrDomain.endsWith(".local") || ipOrDomain === "127.0.0.1" || ipOrDomain === "localhost") {
        return `a=candidate:${p1} ${protocol} ${p2} ${actualIp} ${port} typ host`;
      }
      return match;
    }
  );
}
