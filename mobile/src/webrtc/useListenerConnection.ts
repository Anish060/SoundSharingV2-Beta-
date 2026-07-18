import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { ConvexHttpClient } from "convex/browser";
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
  WebRtcOfferPayload,
} from "@sshare/shared";
import { api } from "../../../convex/_generated/api";

const PRODUCTION_CONVEX_URL = "https://elated-scorpion-697.convex.cloud";

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
 * Tries direct local Socket.IO connection (fastest on Wi-Fi/Hotspot) first,
 * falling back to Convex Cloud.
 */
export function useListenerConnection(opts: Options): Result {
  const [state, setState] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const clientRef = useRef<ConvexHttpClient | null>(null);

  useEffect(() => {
    let cancelled = false;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    (async () => {
      setState("connecting");
      if (cancelled) return;

      const isLocalIp =
        opts.qr.ip &&
        opts.qr.ip !== "127.0.0.1" &&
        opts.qr.ip !== "localhost" &&
        opts.qr.ip.length > 0;

      // 1. Try Local Socket.IO Connection if QR contains a LAN IP
      if (isLocalIp) {
        try {
          const url = `${opts.qr.protocol}://${opts.qr.ip}:${opts.qr.port}`;
          console.log(`[useListenerConnection] Attempting direct LAN connection to ${url}...`);

          const sock: Socket<ServerToClientEvents, ClientToServerEvents> = io(url, {
            transports: ["websocket"],
            reconnection: false,
            timeout: 3000,
          });
          socketRef.current = sock;

          const connectedLocally = await new Promise<boolean>((resolve) => {
            sock.once("connect", () => resolve(true));
            sock.once("connect_error", () => resolve(false));
            setTimeout(() => resolve(false), 3000);
          });

          if (connectedLocally && !cancelled) {
            console.log(`[useListenerConnection] Direct LAN Socket.IO connected! Joining session...`);
            sock.emit(
              "join-session",
              {
                sessionCode: opts.qr.code,
                passcode: opts.passcode,
                listenerName: opts.listenerName,
              },
              (result: JoinSessionResult | JoinSessionError) => {
                if (!result.ok) {
                  setError(`Join failed: ${result.error}`);
                  setState("error");
                  return;
                }
                setState("negotiating");
              }
            );

            const peer = new RTCPeerConnection({
              iceServers: [
                { urls: "stun:stun.l.google.com:19302" },
                { urls: "stun:stun1.l.google.com:19302" },
                { urls: "stun:stun2.l.google.com:19302" },
              ],
            });
            peerRef.current = peer;

            type IceCandidateEvent = {
              candidate: { toJSON: () => IceCandidatePayload["candidate"] } | null;
            };
            (peer as any).addEventListener("icecandidate", (event: IceCandidateEvent) => {
              const hostSocketId = (sock as unknown as { _hostId?: string })._hostId;
              if (event.candidate && hostSocketId) {
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
                setError("WebRTC connection failed.");
                setState("error");
              }
              if (cs === "closed") setState("ended");
            });

            (peer as any).addEventListener("track", (event: any) => {
              if (event.track) event.track.enabled = true;
            });

            sock.on("webrtc-offer", async (payload: WebRtcOfferPayload & { from: string }) => {
              (sock as unknown as { _hostId?: string })._hostId = payload.from;
              try {
                await peer.setRemoteDescription(
                  new RTCSessionDescription({
                    type: payload.sdp.type,
                    sdp: payload.sdp.sdp ?? "",
                  })
                );
                const answer = await peer.createAnswer();
                await peer.setLocalDescription(answer);
                sock.emit("webrtc-answer", { target: payload.from, sdp: answer });
              } catch (err) {
                setError(`WebRTC error: ${err}`);
                setState("error");
              }
            });

            sock.on("ice-candidate", async (payload) => {
              try {
                await peer.addIceCandidate(new RTCIceCandidate(payload.candidate));
              } catch (err) {
                console.warn("ICE candidate error:", err);
              }
            });

            return; // Successfully set up local Wi-Fi connection
          }
        } catch {
          console.log("[useListenerConnection] Direct LAN failed; switching to Convex Cloud fallback...");
        }
      }

      // 2. Fallback to Convex Cloud
      const convexUrl = opts.qr.convexUrl || PRODUCTION_CONVEX_URL;
      const client = new ConvexHttpClient(convexUrl);
      clientRef.current = client;

      try {
        console.log(`[useListenerConnection] Joining session ${opts.qr.code} on Convex Cloud...`);
        const res = await client.mutation(api.signaling.joinSession, {
          code: opts.qr.code,
          passcode: opts.passcode,
          listenerName: opts.listenerName,
        });

        if (!res.ok) {
          setError(`Join failed: ${res.error}`);
          setState("error");
          return;
        }

        const listenerId = res.listenerId;
        setState("negotiating");

        await client.mutation(api.signaling.sendSignal, {
          sessionCode: opts.qr.code,
          target: "host_" + opts.qr.code,
          from: listenerId,
          type: "join",
          payload: JSON.stringify({ name: opts.listenerName }),
        });

        const peer = new RTCPeerConnection({
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
            { urls: "stun:stun2.l.google.com:19302" },
          ],
        });
        peerRef.current = peer;

        (peer as any).addEventListener("icecandidate", async (event: any) => {
          if (event.candidate) {
            await client.mutation(api.signaling.sendSignal, {
              sessionCode: opts.qr.code,
              target: "host_" + opts.qr.code,
              from: listenerId,
              type: "ice",
              payload: JSON.stringify(event.candidate.toJSON()),
            });
          }
        });

        (peer as any).addEventListener("connectionstatechange", () => {
          const cs = peer.connectionState;
          if (cs === "connected") setState("streaming");
          if (cs === "failed") {
            setError("WebRTC connection failed.");
            setState("error");
          }
          if (cs === "closed") setState("ended");
        });

        (peer as any).addEventListener("track", (event: any) => {
          if (event.track) event.track.enabled = true;
        });

        pollInterval = setInterval(async () => {
          if (cancelled) return;
          try {
            const signals = await client.query(api.signaling.getIncomingSignals, { target: listenerId });
            for (const sig of signals) {
              if (sig.type === "offer") {
                try {
                  const sdp = JSON.parse(sig.payload);
                  await peer.setRemoteDescription(new RTCSessionDescription(sdp));
                  const answer = await peer.createAnswer();
                  await peer.setLocalDescription(answer);
                  await client.mutation(api.signaling.sendSignal, {
                    sessionCode: opts.qr.code,
                    target: sig.from,
                    from: listenerId,
                    type: "answer",
                    payload: JSON.stringify(answer),
                  });
                } catch (err) {
                  console.error("Offer error:", err);
                }
              } else if (sig.type === "ice") {
                try {
                  const candidate = JSON.parse(sig.payload);
                  await peer.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (err) {
                  console.warn("ICE error:", err);
                }
              }
              await client.mutation(api.signaling.clearSignal, { id: sig._id });
            }
          } catch (pollErr) {
            console.warn("Poll error:", pollErr);
          }
        }, 1000);

      } catch (err) {
        if (!cancelled) {
          setError(String(err));
          setState("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      if (pollInterval) clearInterval(pollInterval);
      socketRef.current?.disconnect();
      socketRef.current = null;
      peerRef.current?.close();
      peerRef.current = null;
    };
  }, [opts.qr, opts.passcode, opts.listenerName]);

  const close = (): void => {
    socketRef.current?.disconnect();
    peerRef.current?.close();
  };

  return { state, error, close };
}
