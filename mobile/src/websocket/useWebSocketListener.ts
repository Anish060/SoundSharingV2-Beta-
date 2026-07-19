import { useEffect, useRef, useState } from "react";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";
import { io, type Socket } from "socket.io-client";
import type {
  AudioChunkPayload,
  ClientToServerEvents,
  JoinSessionError,
  JoinSessionResult,
  QrPayload,
  ServerToClientEvents,
  SessionEndedEvent,
} from "@sshare/shared";

export type WebSocketConnectionState =
  | "idle"
  | "connecting"
  | "buffering"
  | "streaming"
  | "ended"
  | "error";

interface Options {
  qr: QrPayload;
  passcode: string;
  listenerName: string;
}

interface Result {
  state: WebSocketConnectionState;
  error: string | null;
  close: () => void;
}

/**
 * WebSocket-transport listener. Connects to the signaling server, joins the
 * session, receives audio-chunk events, and plays them sequentially with
 * expo-av.
 *
 * MVP quality: each chunk is decoded and played as a separate Sound. There's
 * a small gap between chunks (~20-40ms) that will be audible. A proper fix
 * would use a streaming buffer via react-native-track-player or a native
 * bridge to AudioTrack.
 */
export function useWebSocketListener(opts: Options): Result {
  const [state, setState] = useState<WebSocketConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const chunkCounterRef = useRef(0);
  const activeSoundsRef = useRef<Audio.Sound[]>([]);
  const cleanupIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setState("connecting");
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
        });
      } catch (err) {
        console.warn("[useWebSocketListener] setAudioModeAsync failed", err);
      }

      if (cancelled) return;

      const scheme = opts.qr.protocol === "wss" ? "https" : "http";
      const url = `${scheme}://${opts.qr.ip}:${opts.qr.port}`;
      console.log(`[useWebSocketListener] Connecting to ${url}`);
      const sock: Socket<ServerToClientEvents, ClientToServerEvents> = io(url, {
        transports: ["polling", "websocket"],
        upgrade: true,
        reconnection: false,
        timeout: 15_000,
        forceNew: true,
      });
      socketRef.current = sock;

      sock.on("connect_error", (err) => {
        console.error(`[useWebSocketListener] Socket connect_error: ${err.message}`);
        setError(err.message);
        setState("error");
      });

      sock.on("connect", () => {
        console.log(`[useWebSocketListener] Socket connected. Joining session ${opts.qr.code}`);
        sock.emit(
          "join-session",
          {
            sessionCode: opts.qr.code,
            passcode: opts.passcode,
            listenerName: opts.listenerName,
          },
          (result: JoinSessionResult | JoinSessionError) => {
            if (!result.ok) {
              console.error(`[useWebSocketListener] Join rejected: ${result.error}`);
              setError(`join failed: ${result.error}`);
              setState("error");
              return;
            }
            console.log("[useWebSocketListener] Join approved. Waiting for audio-chunk events.");
            setState("buffering");
          }
        );
      });

      sock.on("audio-chunk", (payload: AudioChunkPayload) => {
        void playChunk(payload).catch((err) => {
          console.error(`[useWebSocketListener] playChunk failed for seq=${payload.seq}:`, err);
        });
      });

      sock.on("session-ended", (ev: SessionEndedEvent) => {
        console.warn(`[useWebSocketListener] Session ended: ${ev.reason}`);
        setState("ended");
      });
    })().catch((err) => {
      if (!cancelled) {
        console.error("[useWebSocketListener] Fatal setup error:", err);
        setError(String(err));
        setState("error");
      }
    });

    async function playChunk(payload: AudioChunkPayload): Promise<void> {
      chunkCounterRef.current += 1;
      const localId = chunkCounterRef.current;
      const ext = payload.mimeType === "audio/webm;codecs=opus" ? "webm" : "pcm";
      const path = `${FileSystem.cacheDirectory}sshare-chunk-${localId}.${ext}`;
      try {
        await FileSystem.writeAsStringAsync(path, payload.data, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const { sound } = await Audio.Sound.createAsync(
          { uri: path },
          { shouldPlay: true, volume: 1.0 }
        );
        activeSoundsRef.current.push(sound);
        setState((prev) => (prev === "streaming" ? prev : "streaming"));

        sound.setOnPlaybackStatusUpdate(async (status) => {
          if (!status.isLoaded) return;
          if (status.didJustFinish) {
            try {
              await sound.unloadAsync();
            } catch {
              // ignore
            }
            try {
              await FileSystem.deleteAsync(path, { idempotent: true });
            } catch {
              // ignore
            }
          }
        });
      } catch (err) {
        console.warn(`[useWebSocketListener] chunk ${localId} play failed:`, err);
        try {
          await FileSystem.deleteAsync(path, { idempotent: true });
        } catch {
          // ignore
        }
      }
    }

    // Safety: unload any stuck sounds every few seconds
    cleanupIntervalRef.current = setInterval(() => {
      const sounds = activeSoundsRef.current;
      if (sounds.length > 40) {
        const toDrop = sounds.splice(0, sounds.length - 20);
        toDrop.forEach((s) => {
          void s.unloadAsync().catch(() => undefined);
        });
      }
    }, 5_000);

    return () => {
      cancelled = true;
      if (cleanupIntervalRef.current) {
        clearInterval(cleanupIntervalRef.current);
        cleanupIntervalRef.current = null;
      }
      socketRef.current?.disconnect();
      socketRef.current = null;
      const sounds = activeSoundsRef.current;
      activeSoundsRef.current = [];
      sounds.forEach((s) => {
        void s.unloadAsync().catch(() => undefined);
      });
    };
  }, [opts.qr, opts.passcode, opts.listenerName]);

  const close = (): void => {
    socketRef.current?.emit("leave-session");
    socketRef.current?.disconnect();
    const sounds = activeSoundsRef.current;
    activeSoundsRef.current = [];
    sounds.forEach((s) => {
      void s.unloadAsync().catch(() => undefined);
    });
  };

  return { state, error, close };
}
