import { useState } from "react";
import type { TransportMode } from "@sshare/shared";
import { HostSessionView } from "./views/HostSessionView.js";

export function App(): JSX.Element {
  const [started, setStarted] = useState(false);
  const [hostName, setHostName] = useState("");
  const [transportMode, setTransportMode] = useState<TransportMode>("webrtc");

  if (!started) {
    return (
      <main className="app">
        <h1>SShare Host</h1>
        <p className="tagline">Broadcast audio to devices on your local Wi-Fi.</p>
        <label>
          Your name
          <input
            value={hostName}
            onChange={(e) => setHostName(e.target.value)}
            placeholder="e.g. Alice's laptop"
          />
        </label>

        <fieldset className="transport-fieldset">
          <legend>Transport</legend>
          <label className="radio-row">
            <input
              type="radio"
              name="transport"
              value="webrtc"
              checked={transportMode === "webrtc"}
              onChange={() => setTransportMode("webrtc")}
            />
            <span>
              <strong>WebRTC</strong> — P2P, low-latency (~50-150ms). Best on
              same Wi-Fi. Fails on CGNAT / cross-network without TURN.
            </span>
          </label>
          <label className="radio-row">
            <input
              type="radio"
              name="transport"
              value="websocket"
              checked={transportMode === "websocket"}
              onChange={() => setTransportMode("websocket")}
            />
            <span>
              <strong>WebSocket relay</strong> — audio routes through signaling
              server (~300-500ms). Works anywhere HTTP works.
            </span>
          </label>
        </fieldset>

        <button
          className="primary"
          disabled={hostName.trim().length === 0}
          onClick={() => setStarted(true)}
        >
          Start hosting
        </button>
      </main>
    );
  }

  return <HostSessionView hostName={hostName.trim()} transportMode={transportMode} />;
}
