export const SESSION_CODE_PREFIX = "SS";
export const SESSION_CODE_LENGTH = 4;
export const PASSCODE_LENGTH = 6;

export interface SessionInfo {
  sessionCode: string;
  hostSocketId: string;
  hostName: string;
  createdAt: number;
}

export interface Listener {
  socketId: string;
  listenerName: string;
  joinedAt: number;
}

export type LeaveReason = "disconnect" | "explicit" | "kicked" | "session-ended";
