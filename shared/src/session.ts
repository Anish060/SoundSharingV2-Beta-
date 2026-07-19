export const SESSION_CODE_PREFIX = "SS";
export const SESSION_CODE_LENGTH = 4;
export const PASSCODE_LENGTH = 6;

/**
 * Which transport carries the audio media.
 *
 * - "webrtc": direct P2P via RTCPeerConnection. Lowest latency (~50-150ms) on
 *   a friendly network; fails on symmetric CGNAT without a TURN server.
 * - "websocket": Opus-encoded chunks relayed through the signaling server via
 *   Socket.IO. Higher latency (~300-500ms) but works anywhere signaling
 *   works. No STUN/TURN required.
 */
export type TransportMode = "webrtc" | "websocket";

export const DEFAULT_TRANSPORT_MODE: TransportMode = "webrtc";

export interface SessionInfo {
  sessionCode: string;
  hostSocketId: string;
  hostName: string;
  createdAt: number;
  transportMode: TransportMode;
}

export interface Listener {
  socketId: string;
  listenerName: string;
  joinedAt: number;
}

export type LeaveReason = "disconnect" | "explicit" | "kicked" | "session-ended";
