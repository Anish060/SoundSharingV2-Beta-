import { useEffect, useRef } from "react";
import type { AudioChunkPayload } from "@sshare/shared";

interface SocketLike {
  emit: (event: "audio-chunk", payload: AudioChunkPayload) => void;
  connected?: boolean;
}

interface Options {
  socket: SocketLike | null;
  audioTrack: MediaStreamTrack | null;
  enabled: boolean;
  /** Chunk length in ms. Larger = fewer socket events, more latency. */
  chunkMs?: number;
  /** Downsample rate — 24 kHz is speech-quality and halves bandwidth vs 48. */
  sampleRate?: number;
}

/**
 * WebSocket-transport audio sender. Taps the host's MediaStreamTrack, buffers
 * PCM samples, wraps each buffer in a self-contained WAV file, and emits it
 * over Socket.IO. Each chunk is fully decodable in isolation — no shared
 * stream state required on the listener side.
 */
export function useWebSocketAudioSender(opts: Options): void {
  const seqRef = useRef(0);

  useEffect(() => {
    if (!opts.enabled || !opts.socket || !opts.audioTrack) return;

    const track = opts.audioTrack;
    const socket = opts.socket;
    const targetRate = opts.sampleRate ?? 24_000;
    const chunkMs = opts.chunkMs ?? 200;

    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      console.error("[useWebSocketAudioSender] AudioContext unavailable");
      return;
    }

    const audioContext = new AudioCtx({ sampleRate: targetRate });
    const source = audioContext.createMediaStreamSource(new MediaStream([track]));
    // ScriptProcessorNode is deprecated but universally available. AudioWorklet
    // would be cleaner; keeping this simple for MVP.
    const processorBufferSize = 4096;
    const processor = audioContext.createScriptProcessor(processorBufferSize, 1, 1);
    // A silent gain node so the source→processor chain runs without echoing
    // audio back through the host's speakers.
    const silentSink = audioContext.createGain();
    silentSink.gain.value = 0;

    const samplesPerChunk = Math.max(1, Math.floor((audioContext.sampleRate * chunkMs) / 1000));
    let buffer: Float32Array = new Float32Array(samplesPerChunk);
    let filled = 0;

    processor.onaudioprocess = (event: AudioProcessingEvent) => {
      const input = event.inputBuffer.getChannelData(0);
      let readOffset = 0;
      while (readOffset < input.length) {
        const remainingInChunk = samplesPerChunk - filled;
        const available = input.length - readOffset;
        const copyCount = Math.min(remainingInChunk, available);
        buffer.set(input.subarray(readOffset, readOffset + copyCount), filled);
        filled += copyCount;
        readOffset += copyCount;
        if (filled === samplesPerChunk) {
          const wav = encodeWav(buffer, audioContext.sampleRate, 1);
          const base64 = arrayBufferToBase64(wav);
          seqRef.current += 1;
          socket.emit("audio-chunk", {
            data: base64,
            mimeType: "audio/wav",
            sampleRate: audioContext.sampleRate,
            channels: 1,
            seq: seqRef.current,
            ts: Date.now(),
          });
          buffer = new Float32Array(samplesPerChunk);
          filled = 0;
        }
      }
    };

    source.connect(processor);
    processor.connect(silentSink);
    silentSink.connect(audioContext.destination);

    console.log(
      `[useWebSocketAudioSender] started: ${audioContext.sampleRate} Hz, ${chunkMs}ms/chunk, ${samplesPerChunk} samples`
    );

    return () => {
      try {
        source.disconnect();
        processor.disconnect();
        silentSink.disconnect();
      } catch {
        // ignore
      }
      void audioContext.close().catch(() => undefined);
      console.log("[useWebSocketAudioSender] stopped");
    };
  }, [opts.socket, opts.audioTrack, opts.enabled, opts.chunkMs, opts.sampleRate]);
}

/**
 * Encode Float32 mono PCM samples as a complete 16-bit PCM WAV file.
 * Output is a self-contained ArrayBuffer that any audio decoder can play.
 */
function encodeWav(samples: Float32Array, sampleRate: number, channels: number): ArrayBuffer {
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true); // byte rate
  view.setUint16(32, channels * bytesPerSample, true); // block align
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Convert float32 [-1, 1] to int16 [-32768, 32767]
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const clamped = sample === undefined ? 0 : Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunkSize))
    );
  }
  return btoa(binary);
}
