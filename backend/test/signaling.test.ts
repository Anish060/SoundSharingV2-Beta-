import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import type {
  ClientToServerEvents,
  CreateSessionResult,
  JoinSessionError,
  JoinSessionResult,
  ListenerJoinedEvent,
  ListenerLeftEvent,
  ServerToClientEvents,
  SessionEndedEvent,
  WebRtcOfferPayload,
} from "@sshare/shared";
import { startServer, type StartedServer } from "../src/server.js";

type Client = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

function connectClient(port: number): Promise<Client> {
  return new Promise((resolve, reject) => {
    const sock: Client = ioc(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
    });
    sock.once("connect", () => resolve(sock));
    sock.once("connect_error", reject);
  });
}

function once<T>(sock: Client, event: string): Promise<T> {
  return new Promise((resolve) => {
    sock.once(event as never, (payload: T) => resolve(payload));
  });
}

async function createSession(sock: Client, opts: { hostName: string; passcode: string }): Promise<CreateSessionResult> {
  return new Promise((resolve) => {
    sock.emit("create-session", opts, (result: CreateSessionResult) => resolve(result));
  });
}

async function joinSession(
  sock: Client,
  opts: { sessionCode: string; passcode: string; listenerName: string }
): Promise<JoinSessionResult | JoinSessionError> {
  return new Promise((resolve) => {
    sock.emit("join-session", opts, (result: JoinSessionResult | JoinSessionError) => resolve(result));
  });
}

describe("signaling server", () => {
  let server: StartedServer;
  let port: number;

  beforeEach(async () => {
    server = await startServer({ port: 0, logLevel: "silent", joinRateLimitPerMinute: 100 });
    port = server.address.port;
  });

  afterEach(async () => {
    await server.close();
  });

  it("host creates a session and gets a well-formed code", async () => {
    const host = await connectClient(port);
    const result = await createSession(host, { hostName: "Alice", passcode: "abc123" });
    expect(result.sessionCode).toMatch(/^SS-[0-9A-F]{4}$/);
    expect(result.hostSocketId).toBe(host.id);
    host.disconnect();
  });

  it("listener joins with correct passcode and host receives listener-joined", async () => {
    const host = await connectClient(port);
    const { sessionCode } = await createSession(host, { hostName: "Alice", passcode: "abc123" });

    const joinedEvent = once<ListenerJoinedEvent>(host, "listener-joined");
    const listener = await connectClient(port);
    const joinResult = await joinSession(listener, {
      sessionCode,
      passcode: "abc123",
      listenerName: "Bob",
    });
    const joined = await joinedEvent;

    expect(joinResult.ok).toBe(true);
    if (joinResult.ok) {
      expect(joinResult.session.sessionCode).toBe(sessionCode);
      expect(joinResult.session.hostName).toBe("Alice");
      expect(joinResult.hostSocketId).toBe(host.id);
    }
    expect(joined.listenerName).toBe("Bob");
    expect(joined.socketId).toBe(listener.id);

    host.disconnect();
    listener.disconnect();
  });

  it("rejects bad passcode", async () => {
    const host = await connectClient(port);
    const { sessionCode } = await createSession(host, { hostName: "A", passcode: "correct" });

    const listener = await connectClient(port);
    const result = await joinSession(listener, {
      sessionCode,
      passcode: "wrong",
      listenerName: "Bob",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("bad-passcode");

    host.disconnect();
    listener.disconnect();
  });

  it("rejects unknown session", async () => {
    const listener = await connectClient(port);
    const result = await joinSession(listener, {
      sessionCode: "SS-DEAD",
      passcode: "x",
      listenerName: "Bob",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("unknown-session");
    listener.disconnect();
  });

  it("rate-limits repeated join attempts from same client", async () => {
    await server.close();
    server = await startServer({ port: 0, logLevel: "silent", joinRateLimitPerMinute: 2 });
    port = server.address.port;

    const host = await connectClient(port);
    const { sessionCode } = await createSession(host, { hostName: "A", passcode: "p" });

    const listener = await connectClient(port);
    const r1 = await joinSession(listener, { sessionCode, passcode: "wrong", listenerName: "B" });
    const r2 = await joinSession(listener, { sessionCode, passcode: "wrong", listenerName: "B" });
    const r3 = await joinSession(listener, { sessionCode, passcode: "wrong", listenerName: "B" });

    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.error).toBe("rate-limited");

    host.disconnect();
    listener.disconnect();
  });

  it("relays SDP offer from host to targeted listener", async () => {
    const host = await connectClient(port);
    const { sessionCode } = await createSession(host, { hostName: "A", passcode: "p" });

    const listener = await connectClient(port);
    const joinedEvent = once<ListenerJoinedEvent>(host, "listener-joined");
    await joinSession(listener, { sessionCode, passcode: "p", listenerName: "B" });
    const joined = await joinedEvent;

    const offerEvent = once<WebRtcOfferPayload & { from: string }>(listener, "webrtc-offer");
    host.emit("webrtc-offer", {
      target: joined.socketId,
      sdp: { type: "offer", sdp: "v=0\r\n" },
    });
    const offer = await offerEvent;
    expect(offer.from).toBe(host.id);
    expect(offer.sdp.type).toBe("offer");

    host.disconnect();
    listener.disconnect();
  });

  it("notifies host when listener disconnects", async () => {
    const host = await connectClient(port);
    const { sessionCode } = await createSession(host, { hostName: "A", passcode: "p" });

    const listener = await connectClient(port);
    const joinedEvent = once<ListenerJoinedEvent>(host, "listener-joined");
    await joinSession(listener, { sessionCode, passcode: "p", listenerName: "B" });
    await joinedEvent;

    const leftEvent = once<ListenerLeftEvent>(host, "listener-left");
    listener.disconnect();
    const left = await leftEvent;
    expect(left.reason).toBe("disconnect");

    host.disconnect();
  });

  it("emits session-ended to listeners when host disconnects", async () => {
    const host = await connectClient(port);
    const { sessionCode } = await createSession(host, { hostName: "A", passcode: "p" });

    const listener = await connectClient(port);
    const joinedEvent = once<ListenerJoinedEvent>(host, "listener-joined");
    await joinSession(listener, { sessionCode, passcode: "p", listenerName: "B" });
    await joinedEvent;

    const endedEvent = once<SessionEndedEvent>(listener, "session-ended");
    host.disconnect();
    const ended = await endedEvent;
    expect(["host-quit", "host-disconnect"]).toContain(ended.reason);

    listener.disconnect();
  });

  it("does not relay offers across sessions", async () => {
    const hostA = await connectClient(port);
    const { sessionCode: codeA } = await createSession(hostA, { hostName: "A", passcode: "p" });

    const hostB = await connectClient(port);
    await createSession(hostB, { hostName: "B", passcode: "p" });

    const listenerA = await connectClient(port);
    const joinedA = once<ListenerJoinedEvent>(hostA, "listener-joined");
    await joinSession(listenerA, { sessionCode: codeA, passcode: "p", listenerName: "L" });
    const joined = await joinedA;

    let leaked = false;
    hostB.on("webrtc-offer", () => {
      leaked = true;
    });

    // hostB tries to target listenerA — should be dropped
    hostB.emit("webrtc-offer", {
      target: joined.socketId,
      sdp: { type: "offer", sdp: "v=0" },
    });

    await new Promise((r) => setTimeout(r, 100));
    expect(leaked).toBe(false);

    hostA.disconnect();
    hostB.disconnect();
    listenerA.disconnect();
  });
});
