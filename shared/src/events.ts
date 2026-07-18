import type { LeaveReason, Listener, SessionInfo } from "./session";

export interface CreateSessionPayload {
  hostName: string;
  passcode: string;
}

export interface CreateSessionResult {
  sessionCode: string;
  hostSocketId: string;
  ips?: string[];
}

export interface JoinSessionPayload {
  sessionCode: string;
  passcode: string;
  listenerName: string;
}

export interface JoinSessionResult {
  ok: true;
  session: Pick<SessionInfo, "sessionCode" | "hostName">;
  hostSocketId: string;
}

export interface JoinSessionError {
  ok: false;
  error: "bad-passcode" | "unknown-session" | "rate-limited" | "session-full";
}

export interface ListenerJoinedEvent {
  socketId: string;
  listenerName: string;
}

export interface ListenerLeftEvent {
  socketId: string;
  reason: LeaveReason;
}

export interface WebRtcOfferPayload {
  target: string;
  sdp: RTCSessionDescriptionInitLike;
}

export interface WebRtcAnswerPayload {
  target: string;
  sdp: RTCSessionDescriptionInitLike;
}

export interface IceCandidatePayload {
  target: string;
  candidate: RTCIceCandidateInitLike;
}

export interface SessionEndedEvent {
  reason: "host-quit" | "host-disconnect" | "error";
}

export interface HostIpChangedEvent {
  newIp: string;
  port: number;
}

export interface RTCSessionDescriptionInitLike {
  type: "offer" | "answer" | "pranswer" | "rollback";
  sdp?: string;
}

export interface RTCIceCandidateInitLike {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface ClientToServerEvents {
  "create-session": (
    payload: CreateSessionPayload,
    ack: (result: CreateSessionResult) => void
  ) => void;
  "join-session": (
    payload: JoinSessionPayload,
    ack: (result: JoinSessionResult | JoinSessionError) => void
  ) => void;
  "webrtc-offer": (payload: WebRtcOfferPayload) => void;
  "webrtc-answer": (payload: WebRtcAnswerPayload) => void;
  "ice-candidate": (payload: IceCandidatePayload) => void;
  "session-ended": (payload: SessionEndedEvent) => void;
  "host-ip-changed": (payload: HostIpChangedEvent) => void;
  "leave-session": () => void;
}

export interface ServerToClientEvents {
  "listener-joined": (payload: ListenerJoinedEvent) => void;
  "listener-left": (payload: ListenerLeftEvent) => void;
  "webrtc-offer": (payload: WebRtcOfferPayload & { from: string }) => void;
  "webrtc-answer": (payload: WebRtcAnswerPayload & { from: string }) => void;
  "ice-candidate": (payload: IceCandidatePayload & { from: string }) => void;
  "session-ended": (payload: SessionEndedEvent) => void;
  "host-ip-changed": (payload: HostIpChangedEvent) => void;
}

export interface SocketData {
  role: "host" | "listener" | "unassigned";
  sessionCode?: string;
  listenerName?: string;
  hostName?: string;
}

export type ListenerSnapshot = Listener;
