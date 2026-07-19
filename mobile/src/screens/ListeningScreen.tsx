import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { QrPayload } from "@sshare/shared";
import { useListenerConnection, type ConnectionState } from "../webrtc/useListenerConnection";
import {
  useWebSocketListener,
  type WebSocketConnectionState,
} from "../websocket/useWebSocketListener";

interface Props {
  qr: QrPayload;
  passcode: string;
  listenerName: string;
  onLeave: () => void;
}

export function ListeningScreen(props: Props): JSX.Element {
  const mode = props.qr.transportMode ?? "webrtc";
  if (mode === "websocket") {
    return <WebSocketListeningView {...props} />;
  }
  return <WebRTCListeningView {...props} />;
}

function WebRTCListeningView({ qr, passcode, listenerName, onLeave }: Props): JSX.Element {
  const { state, error, close } = useListenerConnection({ qr, passcode, listenerName });
  const leaveTriggered = useRef(false);
  const [displayState, setDisplayState] = useState<ConnectionState>(state);

  useEffect(() => {
    setDisplayState(state);
  }, [state]);

  const handleLeave = (): void => {
    if (leaveTriggered.current) return;
    leaveTriggered.current = true;
    close();
    onLeave();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.status}>{describeWebRTCState(displayState)}</Text>
      <Text style={styles.meta}>Session {qr.code}</Text>
      <Text style={styles.meta}>Host {qr.ip}:{qr.port}</Text>
      <Text style={styles.meta}>Transport: WebRTC (direct P2P)</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <TouchableOpacity style={styles.leave} onPress={handleLeave}>
        <Text style={styles.leaveText}>Leave</Text>
      </TouchableOpacity>
    </View>
  );
}

function WebSocketListeningView({ qr, passcode, listenerName, onLeave }: Props): JSX.Element {
  const { state, error, close } = useWebSocketListener({ qr, passcode, listenerName });
  const leaveTriggered = useRef(false);
  const [displayState, setDisplayState] = useState<WebSocketConnectionState>(state);

  useEffect(() => {
    setDisplayState(state);
  }, [state]);

  const handleLeave = (): void => {
    if (leaveTriggered.current) return;
    leaveTriggered.current = true;
    close();
    onLeave();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.status}>{describeWSState(displayState)}</Text>
      <Text style={styles.meta}>Session {qr.code}</Text>
      <Text style={styles.meta}>Host {qr.ip}:{qr.port}</Text>
      <Text style={styles.meta}>Transport: WebSocket relay</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <TouchableOpacity style={styles.leave} onPress={handleLeave}>
        <Text style={styles.leaveText}>Leave</Text>
      </TouchableOpacity>
    </View>
  );
}

function describeWebRTCState(state: ConnectionState): string {
  switch (state) {
    case "idle": return "Preparing…";
    case "connecting": return "Connecting to host…";
    case "negotiating": return "Setting up audio stream…";
    case "streaming": return "Listening";
    case "ended": return "Session ended";
    case "error": return "Connection failed";
  }
}

function describeWSState(state: WebSocketConnectionState): string {
  switch (state) {
    case "idle": return "Preparing…";
    case "connecting": return "Connecting to host…";
    case "buffering": return "Waiting for audio…";
    case "streaming": return "Listening";
    case "ended": return "Session ended";
    case "error": return "Connection failed";
  }
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12, flex: 1 },
  status: { color: "#e2e8f0", fontSize: 22, fontWeight: "600" },
  meta: { color: "#94a3b8", fontSize: 14 },
  error: { color: "#fca5a5", marginTop: 12 },
  leave: {
    marginTop: "auto",
    backgroundColor: "#334155",
    padding: 14,
    borderRadius: 6,
    alignItems: "center",
  },
  leaveText: { color: "#e2e8f0", fontWeight: "600", fontSize: 15 },
});
