import { useState } from "react";
import { HostSessionView } from "./views/HostSessionView.js";

export function App(): JSX.Element {
  const [started, setStarted] = useState(false);
  const [hostName, setHostName] = useState("");

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

  return <HostSessionView hostName={hostName.trim()} />;
}
