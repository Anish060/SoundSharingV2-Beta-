import { randomBytes } from "node:crypto";
import {
  SESSION_CODE_PREFIX,
  type Listener,
  type SessionInfo,
} from "@sshare/shared";

export interface StoredSession extends SessionInfo {
  passcode: string;
  listeners: Map<string, Listener>;
}

export class SessionStore {
  private readonly byCode = new Map<string, StoredSession>();
  private readonly byHostSocket = new Map<string, string>();
  private readonly bySocket = new Map<string, string>();

  create(params: { hostSocketId: string; hostName: string; passcode: string }): StoredSession {
    const sessionCode = this.generateCode();
    const session: StoredSession = {
      sessionCode,
      hostSocketId: params.hostSocketId,
      hostName: params.hostName,
      passcode: params.passcode,
      createdAt: Date.now(),
      listeners: new Map(),
    };
    this.byCode.set(sessionCode, session);
    this.byHostSocket.set(params.hostSocketId, sessionCode);
    this.bySocket.set(params.hostSocketId, sessionCode);
    return session;
  }

  get(sessionCode: string): StoredSession | undefined {
    return this.byCode.get(sessionCode.toUpperCase());
  }

  getBySocketId(socketId: string): StoredSession | undefined {
    const code = this.bySocket.get(socketId);
    return code ? this.byCode.get(code) : undefined;
  }

  isHostSocket(socketId: string): boolean {
    return this.byHostSocket.has(socketId);
  }

  addListener(sessionCode: string, listener: Listener): void {
    const session = this.byCode.get(sessionCode);
    if (!session) return;
    session.listeners.set(listener.socketId, listener);
    this.bySocket.set(listener.socketId, sessionCode);
  }

  removeSocket(socketId: string): { session: StoredSession; wasHost: boolean } | undefined {
    const code = this.bySocket.get(socketId);
    if (!code) return undefined;
    const session = this.byCode.get(code);
    if (!session) return undefined;

    this.bySocket.delete(socketId);
    const wasHost = session.hostSocketId === socketId;
    if (wasHost) {
      this.byHostSocket.delete(socketId);
      this.byCode.delete(code);
      for (const listenerId of session.listeners.keys()) {
        this.bySocket.delete(listenerId);
      }
    } else {
      session.listeners.delete(socketId);
    }
    return { session, wasHost };
  }

  private generateCode(): string {
    // 4-hex-char suffix — 65,536 possible codes. Collision-check just in case.
    for (let attempt = 0; attempt < 8; attempt++) {
      const suffix = randomBytes(2).toString("hex").toUpperCase();
      const code = `${SESSION_CODE_PREFIX}-${suffix}`;
      if (!this.byCode.has(code)) return code;
    }
    throw new Error("Failed to allocate session code after 8 attempts");
  }
}
