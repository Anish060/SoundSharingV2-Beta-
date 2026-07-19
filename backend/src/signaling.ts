import type { Server, Socket } from "socket.io";
import {
  DEFAULT_TRANSPORT_MODE,
  type AudioChunkPayload,
  type ClientToServerEvents,
  type CreateSessionPayload,
  type CreateSessionResult,
  type HostIpChangedEvent,
  type IceCandidatePayload,
  type JoinSessionError,
  type JoinSessionPayload,
  type JoinSessionResult,
  type ServerToClientEvents,
  type SessionEndedEvent,
  type SocketData,
  type TransportMode,
  type WebRtcAnswerPayload,
  type WebRtcOfferPayload,
} from "@sshare/shared";
import type { Logger } from "./logger.js";
import type { TokenBucket } from "./rateLimit.js";
import type { SessionStore } from "./sessionStore.js";

type SIOServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type SIOSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export interface SignalingDeps {
  io: SIOServer;
  sessions: SessionStore;
  joinLimiter: TokenBucket;
  maxListenersPerSession: number;
  log: Logger;
  discoverLocalIps: () => string[];
}

export function attachSignaling(deps: SignalingDeps): void {
  deps.io.on("connection", (socket) => bindSocket(socket, deps));
}

function bindSocket(socket: SIOSocket, deps: SignalingDeps): void {
  const { sessions, joinLimiter, maxListenersPerSession, log } = deps;
  socket.data.role = "unassigned";

  log.debug("socket connected", { id: socket.id });

  socket.on("create-session", (payload, ack) => {
    handleCreateSession(socket, payload, ack, deps);
  });

  socket.on("join-session", (payload, ack) => {
    handleJoinSession(socket, payload, ack, deps);
  });

  socket.on("webrtc-offer", (payload) => {
    relayOffer(socket, payload, deps);
  });

  socket.on("webrtc-answer", (payload) => {
    relayAnswer(socket, payload, deps);
  });

  socket.on("ice-candidate", (payload) => {
    relayIce(socket, payload, deps);
  });

  socket.on("session-ended", (payload) => {
    handleSessionEnded(socket, payload, deps);
  });

  socket.on("host-ip-changed", (payload) => {
    handleHostIpChanged(socket, payload, deps);
  });

  socket.on("audio-chunk", (payload) => {
    relayAudioChunk(socket, payload, deps);
  });

  socket.on("leave-session", () => {
    handleDisconnect(socket, "explicit", deps);
    socket.disconnect(true);
  });

  socket.on("disconnect", () => {
    handleDisconnect(socket, "disconnect", deps);
  });

  // Suppress unused-var warnings for shadowed deps
  void sessions;
  void joinLimiter;
  void maxListenersPerSession;
}

function handleCreateSession(
  socket: SIOSocket,
  payload: CreateSessionPayload,
  ack: (result: CreateSessionResult) => void,
  deps: SignalingDeps
): void {
  if (typeof payload?.hostName !== "string" || typeof payload?.passcode !== "string") {
    deps.log.warn("create-session rejected: malformed payload", { id: socket.id });
    return;
  }
  const transportMode: TransportMode =
    payload.transportMode === "websocket" || payload.transportMode === "webrtc"
      ? payload.transportMode
      : DEFAULT_TRANSPORT_MODE;
  const session = deps.sessions.create({
    hostSocketId: socket.id,
    hostName: payload.hostName.slice(0, 64),
    passcode: payload.passcode,
    transportMode,
  });
  socket.data.role = "host";
  socket.data.sessionCode = session.sessionCode;
  socket.data.hostName = session.hostName;
  void socket.join(session.sessionCode);
  deps.log.info("session created", {
    code: session.sessionCode,
    host: socket.id,
    transportMode,
  });
  const ips = deps.discoverLocalIps();
  ack({
    sessionCode: session.sessionCode,
    hostSocketId: socket.id,
    ips,
    transportMode,
  });
}

function handleJoinSession(
  socket: SIOSocket,
  payload: JoinSessionPayload,
  ack: (result: JoinSessionResult | JoinSessionError) => void,
  deps: SignalingDeps
): void {
  const clientKey = clientIp(socket);
  if (!deps.joinLimiter.consume(clientKey)) {
    deps.log.warn("join rate-limited", { ip: clientKey });
    ack({ ok: false, error: "rate-limited" });
    return;
  }

  if (
    typeof payload?.sessionCode !== "string" ||
    typeof payload?.passcode !== "string" ||
    typeof payload?.listenerName !== "string"
  ) {
    ack({ ok: false, error: "unknown-session" });
    return;
  }

  const session = deps.sessions.get(payload.sessionCode);
  if (!session) {
    ack({ ok: false, error: "unknown-session" });
    return;
  }
  if (session.passcode !== payload.passcode) {
    deps.log.warn("bad passcode", { code: payload.sessionCode, ip: clientKey });
    ack({ ok: false, error: "bad-passcode" });
    return;
  }
  if (session.listeners.size >= deps.maxListenersPerSession) {
    ack({ ok: false, error: "session-full" });
    return;
  }

  const listener = {
    socketId: socket.id,
    listenerName: payload.listenerName.slice(0, 64),
    joinedAt: Date.now(),
  };
  deps.sessions.addListener(session.sessionCode, listener);
  socket.data.role = "listener";
  socket.data.sessionCode = session.sessionCode;
  socket.data.listenerName = listener.listenerName;
  void socket.join(session.sessionCode);

  deps.io
    .to(session.hostSocketId)
    .emit("listener-joined", { socketId: socket.id, listenerName: listener.listenerName });

  deps.log.info("listener joined", { code: session.sessionCode, socket: socket.id });
  ack({
    ok: true,
    session: {
      sessionCode: session.sessionCode,
      hostName: session.hostName,
      transportMode: session.transportMode,
    },
    hostSocketId: session.hostSocketId,
  });
}

function relayAudioChunk(
  socket: SIOSocket,
  payload: AudioChunkPayload,
  deps: SignalingDeps
): void {
  if (!deps.sessions.isHostSocket(socket.id)) return;
  const code = socket.data.sessionCode;
  if (!code) return;
  const session = deps.sessions.get(code);
  if (!session || session.transportMode !== "websocket") return;
  // Emit to every listener in the room, but not back to the host.
  deps.io.to(code).except(socket.id).emit("audio-chunk", payload);
}

function relayOffer(socket: SIOSocket, payload: WebRtcOfferPayload, deps: SignalingDeps): void {
  if (!isSameSessionPeer(socket, payload.target, deps)) return;
  deps.io.to(payload.target).emit("webrtc-offer", { ...payload, from: socket.id });
}

function relayAnswer(socket: SIOSocket, payload: WebRtcAnswerPayload, deps: SignalingDeps): void {
  if (!isSameSessionPeer(socket, payload.target, deps)) return;
  deps.io.to(payload.target).emit("webrtc-answer", { ...payload, from: socket.id });
}

function relayIce(socket: SIOSocket, payload: IceCandidatePayload, deps: SignalingDeps): void {
  if (!isSameSessionPeer(socket, payload.target, deps)) return;
  deps.io.to(payload.target).emit("ice-candidate", { ...payload, from: socket.id });
}

function handleSessionEnded(
  socket: SIOSocket,
  payload: SessionEndedEvent,
  deps: SignalingDeps
): void {
  if (!deps.sessions.isHostSocket(socket.id)) return;
  const code = socket.data.sessionCode;
  if (!code) return;
  deps.io.to(code).emit("session-ended", payload);
  deps.log.info("session ended by host", { code, reason: payload.reason });
  // Actual cleanup happens on host disconnect
}

function handleHostIpChanged(
  socket: SIOSocket,
  payload: HostIpChangedEvent,
  deps: SignalingDeps
): void {
  if (!deps.sessions.isHostSocket(socket.id)) return;
  const code = socket.data.sessionCode;
  if (!code) return;
  deps.io.to(code).except(socket.id).emit("host-ip-changed", payload);
}

function handleDisconnect(
  socket: SIOSocket,
  reason: "disconnect" | "explicit",
  deps: SignalingDeps
): void {
  const removed = deps.sessions.removeSocket(socket.id);
  if (!removed) return;
  const { session, wasHost } = removed;

  if (wasHost) {
    deps.io
      .to(session.sessionCode)
      .emit("session-ended", { reason: reason === "explicit" ? "host-quit" : "host-disconnect" });
    // Force listeners off the room
    void deps.io.in(session.sessionCode).disconnectSockets(true);
    deps.log.info("host disconnected, session cleaned", { code: session.sessionCode });
  } else {
    deps.io
      .to(session.hostSocketId)
      .emit("listener-left", { socketId: socket.id, reason });
    deps.log.debug("listener left", { code: session.sessionCode, socket: socket.id });
  }
}

function isSameSessionPeer(socket: SIOSocket, target: string, deps: SignalingDeps): boolean {
  const senderSession = socket.data.sessionCode;
  if (!senderSession) return false;
  const stored = deps.sessions.get(senderSession);
  if (!stored) return false;
  if (target === stored.hostSocketId) return true;
  return stored.listeners.has(target);
}

function clientIp(socket: SIOSocket): string {
  const forwarded = socket.handshake.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]!.trim();
  }
  return socket.handshake.address || socket.id;
}
