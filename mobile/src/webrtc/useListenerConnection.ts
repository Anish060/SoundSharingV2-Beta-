import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
} from "react-native-webrtc";
import type {
  ClientToServerEvents,
  IceCandidatePayload,
  JoinSessionError,
  JoinSessionResult,
  QrPayload,
  ServerToClientEvents,
  SessionEndedEvent,
  WebRtcOfferPayload,
} from "@sshare/shared";

export type ConnectionState =
  | "idle"
  | "connecting"
  | "negotiating"
  | "streaming"
  | "ended"
  | "error";

interface Options {
  qr: QrPayload;
  passcode: string;
  listenerName: string;
}

interface Result {
  state: ConnectionState;
  error: string | null;
  close: () => void;
}

/**
 * Establishes a signaling channel + WebRTC audio-receive connection to the host.
 */
export function useListenerConnection(opts: Options): Result {
  const [state, setState] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setState("connecting");
      if (cancelled) return;

      // Normalise ws/wss to http/https because Socket.IO's polling handshake
      // uses HTTP. Use the Socket.IO default transport order (polling first,
      // upgrade to WebSocket on success). On cellular networks that block
      // the Upgrade handshake this stays on polling and still works.
      const scheme = opts.qr.protocol ?? "ws";
      const url = `${scheme}://${opts.qr.ip}:${opts.qr.port}`;
      console.log(`[useListenerConnection] Connecting to ${url}`);
      const sock: Socket<ServerToClientEvents, ClientToServerEvents> = io(url, {
        transports: ["websocket"],
        upgrade: false,
        reconnection: false,
        timeout: 15_000,
        forceNew: true,
      });
      socketRef.current = sock;

      sock.on("connect_error", (err) => {
        const anyErr = err as Error & {
          type?: string;
          description?: unknown;
          context?: unknown;
        };
        const details = [
          `message: ${anyErr.message}`,
          anyErr.type ? `type: ${anyErr.type}` : null,
          anyErr.description ? `description: ${JSON.stringify(anyErr.description)}` : null,
          anyErr.context ? `context: ${JSON.stringify(anyErr.context)}` : null,
        ]
          .filter(Boolean)
          .join(" | ");
        console.error(`[useListenerConnection] Socket connect_error: ${details}`);
        setError(details || anyErr.message);
        setState("error");
      });

      sock.on("connect", () => {
        console.log(`[useListenerConnection] Socket connected. Joining session: ${opts.qr.code}`);
        sock.emit(
          "join-session",
          {
            sessionCode: opts.qr.code,
            passcode: opts.passcode,
            listenerName: opts.listenerName,
          },
          (result: JoinSessionResult | JoinSessionError) => {
            if (!result.ok) {
              console.error(`[useListenerConnection] Join session rejected: ${result.error}`);
              setError(`join failed: ${result.error}`);
              setState("error");
              return;
            }
            console.log(`[useListenerConnection] Join session approved. Negotiating WebRTC...`);
            setState("negotiating");
          }
        );
      });

      sock.on("disconnect", (reason) => {
        console.warn(`[useListenerConnection] Socket disconnected: ${reason}`);
      });

      // STUN first for NAT discovery; TURN as a relay fallback when direct
      // UDP fails (mobile hotspots with client isolation, CGNAT, symmetric
      // NATs). Open Relay Project is free/public — fine for testing, swap
      // to a paid provider or self-hosted coturn for production.
      const peer = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun.cloudflare.com:3478" },
          {
            urls: [
              "turn:openrelay.metered.ca:80",
              "turn:openrelay.metered.ca:443",
              "turn:openrelay.metered.ca:443?transport=tcp",
            ],
            username: "openrelayproject",
            credential: "openrelayproject",
          },
        ],
        iceTransportPolicy: "all",
      });
      peerRef.current = peer;

      type IceCandidateEvent = {
        candidate: { toJSON: () => IceCandidatePayload["candidate"] } | null;
      };
      (peer as any).addEventListener("icecandidate", (event: IceCandidateEvent) => {
        const hostSocketId = (sock as unknown as { _hostId?: string })._hostId;
        if (event.candidate && hostSocketId) {
          console.log(`[useListenerConnection] Sending trickled local ICE candidate to host:`, event.candidate.toJSON());
          sock.emit("ice-candidate", {
            target: hostSocketId,
            candidate: event.candidate.toJSON(),
          });
        }
      });

      (peer as any).addEventListener("connectionstatechange", () => {
        const cs = peer.connectionState;
        console.log(`[useListenerConnection] WebRTC connectionState changed: ${cs}`);
        if (cs === "connected") setState("streaming");
        if (cs === "failed") {
          setError(
            "WebRTC ICE failed — host is unreachable. Check Wi-Fi is the same network, disable AP Isolation on the router, and allow Node/browser through the Windows firewall."
          );
          setState("error");
        }
        if (cs === "closed") setState("ended");
      });

      (peer as any).addEventListener("iceconnectionstatechange", () => {
        console.log(`[useListenerConnection] WebRTC iceConnectionState changed: ${peer.iceConnectionState}`);
      });

      (peer as any).addEventListener("icegatheringstatechange", () => {
        console.log(`[useListenerConnection] WebRTC iceGatheringState changed: ${peer.iceGatheringState}`);
      });

      (peer as any).addEventListener("track", (event: any) => {
        console.log(
          `[useListenerConnection] Received remote WebRTC track: kind=${event.track?.kind}, id=${event.track?.id}, readyState=${event.track?.readyState}`
        );
        if (event.track) {
          event.track.enabled = true;
        }
      });

      sock.on("webrtc-offer", async (payload: WebRtcOfferPayload & { from: string }) => {
        console.log(`[useListenerConnection] Received WebRTC offer from host ${payload.from}`);
        (sock as unknown as { _hostId?: string })._hostId = payload.from;
        
        try {
          await peer.setRemoteDescription(
            new RTCSessionDescription({
              type: payload.sdp.type,
              sdp: payload.sdp.sdp ?? "",
            })
          );
          console.log(`[useListenerConnection] Remote description set successfully.`);
          
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          console.log(`[useListenerConnection] Local answer created and set. Sending answer to host...`);
          sock.emit("webrtc-answer", { target: payload.from, sdp: answer });
        } catch (err) {
          console.error(`[useListenerConnection] Failed handling offer:`, err);
          setError(`WebRTC negotiation failed: ${err}`);
          setState("error");
        }
      });

      sock.on("ice-candidate", async (payload) => {
        console.log(`[useListenerConnection] Received trickled ICE candidate from host:`, payload.candidate);
        try {
          await peer.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch (err) {
          console.warn("[useListenerConnection] Failed to add ICE candidate", err);
        }
      });

      sock.on("session-ended", (ev: SessionEndedEvent) => {
        console.warn(`[useListenerConnection] Session ended by server. Reason: ${ev.reason}`);
        setState("ended");
      });
    })().catch((err) => {
      if (!cancelled) {
        console.error(`[useListenerConnection] Fatal setup error:`, err);
        setError(String(err));
        setState("error");
      }
    });

    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
      peerRef.current?.close();
      peerRef.current = null;
    };
  }, [opts.qr, opts.passcode, opts.listenerName]);

  const close = (): void => {
    socketRef.current?.emit("leave-session");
    socketRef.current?.disconnect();
    peerRef.current?.close();
  };

  return { state, error, close };
}

