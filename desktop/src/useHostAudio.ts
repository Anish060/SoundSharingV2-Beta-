import { useEffect, useRef, useState } from "react";
import { FloatRingBuffer } from "./ringBuffer.js";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface HostAudio {
  audioTrack: MediaStreamTrack | null;
  isCapturing: boolean;
  startCapture: (deviceName?: string, isLoopback?: boolean) => Promise<void>;
  stopCapture: () => Promise<void>;
  error: string | null;
  inputDevices: string[];
  outputDevices: string[];
}

export function useHostAudio(): HostAudio {
  const [audioTrack, setAudioTrack] = useState<MediaStreamTrack | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputDevices, setInputDevices] = useState<string[]>([]);
  const [outputDevices, setOutputDevices] = useState<string[]>([]);

  const ringBufferRef = useRef<FloatRingBuffer>(new FloatRingBuffer());
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const destNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // Load device lists on mount
  useEffect(() => {
    if (isTauri()) {
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke<string[]>("list_audio_inputs").then(setInputDevices).catch(console.error);
        invoke<string[]>("list_audio_outputs").then(setOutputDevices).catch(console.error);
      });
    } else {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          const inputs = devices
            .filter((d) => d.kind === "audioinput")
            .map((d) => d.label || `Microphone ${d.deviceId.slice(0, 5)}`);
          setInputDevices(inputs.length > 0 ? inputs : ["Default Microphone"]);
          setOutputDevices(["Default Loopback (Not supported on Web)"]);
        })
        .catch(console.error);
    }
  }, []);

  const startCapture = async (deviceName?: string, isLoopback = false) => {
    try {
      setError(null);
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        const { listen } = await import("@tauri-apps/api/event");

        // 1. Initialize Web Audio Context
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: 48000,
          latencyHint: "interactive",
        });
        audioContextRef.current = audioContext;

        ringBufferRef.current.clear();

        // 2. Set up ScriptProcessorNode for writing samples
        const bufferSize = 1024;
        const scriptNode = audioContext.createScriptProcessor(bufferSize, 0, 1);
        scriptNodeRef.current = scriptNode;

        const ringBuffer = ringBufferRef.current;
        scriptNode.onaudioprocess = (e) => {
          const outputBuffer = e.outputBuffer;
          const channelData = outputBuffer.getChannelData(0);
          for (let i = 0; i < outputBuffer.length; i++) {
            channelData[i] = ringBuffer.pop();
          }
        };

        const destNode = audioContext.createMediaStreamDestination();
        destNodeRef.current = destNode;

        scriptNode.connect(destNode);

        // 3. Start Tauri Rust Audio Capture
        await invoke("start_audio_capture", { deviceName, isLoopback });

        // 4. Listen for audio frames from Rust
        const unlisten = await listen<number[]>("audio-frame", (event) => {
          ringBufferRef.current.push(event.payload);
        });

        (window as any)._audioUnlisten = unlisten;

        setAudioTrack(destNode.stream.getAudioTracks()[0] ?? null);
      } else {
        // Browser fallback: Use getUserMedia directly
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        localStreamRef.current = stream;
        setAudioTrack(stream.getAudioTracks()[0] ?? null);
      }
      setIsCapturing(true);
    } catch (err: any) {
      setError(String(err));
      console.error(err);
    }
  };

  const stopCapture = async () => {
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("stop_audio_capture");

        const unlisten = (window as any)._audioUnlisten;
        if (unlisten) {
          unlisten();
          (window as any)._audioUnlisten = null;
        }

        if (scriptNodeRef.current) {
          scriptNodeRef.current.disconnect();
          scriptNodeRef.current = null;
        }
        if (audioContextRef.current) {
          await audioContextRef.current.close();
          audioContextRef.current = null;
        }
        destNodeRef.current = null;
      } else {
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((t) => t.stop());
          localStreamRef.current = null;
        }
      }
      setAudioTrack(null);
      setIsCapturing(false);
    } catch (err: any) {
      setError(String(err));
      console.error(err);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCapture();
    };
  }, []);

  return {
    audioTrack,
    isCapturing,
    startCapture,
    stopCapture,
    error,
    inputDevices,
    outputDevices,
  };
}
