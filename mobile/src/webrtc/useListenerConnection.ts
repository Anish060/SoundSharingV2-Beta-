import { useEffect, useRef, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
} from "react-native-webrtc";
import type { QrPayload } from "@sshare/shared";
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
 * Establishes a Convex Cloud HTTP signaling channel + WebRTC audio-receive connection to the host.
 */
export function useListenerConnection(opts: Options): Result {
  const [state, setState] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const clientRef = useRef<ConvexHttpClient | null>(null);

  useEffect(() => {
    let cancelled = false;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    (async () => {
      setState("connecting");
      if (cancelled) return;

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
          console.error(`[useListenerConnection] Join session failed: ${res.error}`);
          setError(`Join failed: ${res.error}`);
          setState("error");
          return;
        }

        const listenerId = res.listenerId;
        console.log(`[useListenerConnection] Joined session approved. Listener ID: ${listenerId}`);
        setState("negotiating");

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
            console.log(`[useListenerConnection] Sending trickled ICE candidate to Convex Cloud`);
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
          console.log(`[useListenerConnection] WebRTC connectionState changed: ${cs}`);
          if (cs === "connected") setState("streaming");
          if (cs === "failed") {
            setError("WebRTC connection failed. Check network firewalls.");
            setState("error");
          }
          if (cs === "closed") setState("ended");
        });

        (peer as any).addEventListener("track", (event: any) => {
          console.log(`[useListenerConnection] Received remote WebRTC audio track:`, event.track?.id);
          if (event.track) {
            event.track.enabled = true;
          }
        });

        // Poll incoming signals via Convex HTTP API
        pollInterval = setInterval(async () => {
          if (cancelled) return;
          try {
            const signals = await client.query(api.signaling.getIncomingSignals, { target: listenerId });
            for (const sig of signals) {
              if (sig.type === "offer") {
                console.log(`[useListenerConnection] Received WebRTC offer from host`);
                try {
                  const sdp = JSON.parse(sig.payload);
                  await peer.setRemoteDescription(new RTCSessionDescription(sdp));
                  const answer = await peer.createAnswer();
                  await peer.setLocalDescription(answer);

                  console.log(`[useListenerConnection] Sending WebRTC answer to host over Convex Cloud`);
                  await client.mutation(api.signaling.sendSignal, {
                    sessionCode: opts.qr.code,
                    target: sig.from,
                    from: listenerId,
                    type: "answer",
                    payload: JSON.stringify(answer),
                  });
                } catch (err) {
                  console.error("[useListenerConnection] Failed handling offer:", err);
                }
              } else if (sig.type === "ice") {
                try {
                  const candidate = JSON.parse(sig.payload);
                  await peer.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (err) {
                  console.warn("[useListenerConnection] Failed adding ICE candidate:", err);
                }
              }

              await client.mutation(api.signaling.clearSignal, { id: sig._id });
            }
          } catch (pollErr) {
            console.warn("[useListenerConnection] Signal poll error:", pollErr);
          }
        }, 1000);

      } catch (err) {
        if (!cancelled) {
          console.error(`[useListenerConnection] Setup error:`, err);
          setError(String(err));
          setState("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      if (pollInterval) clearInterval(pollInterval);
      peerRef.current?.close();
      peerRef.current = null;
    };
  }, [opts.qr, opts.passcode, opts.listenerName]);

  const close = (): void => {
    peerRef.current?.close();
  };

  return { state, error, close };
}
