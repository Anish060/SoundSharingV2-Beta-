export interface SidecarInfo {
  ip: string;
  port: number;
  sessionCode: string;
  hostSocketId: string;
  socket: any;
  ips?: string[];
}

export interface StartSidecarOptions {
  hostName: string;
  passcode: string;
}

/**
 * Spawns the bundled Node signaling sidecar via Tauri, then calls `create-session`
 * on it and returns the session details. Falls back to a local dev server on port
 * 3000 when running under `vite` without Tauri (developer flow).
 */
export async function startSignalingSidecar(opts: StartSidecarOptions): Promise<SidecarInfo> {
  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const started = (await invoke("spawn_signaling_sidecar")) as { ip: string; port: number };
      const { socket, ...result } = await createSessionOnServer(started.ip, started.port, opts);
      const ip = result.ips?.[0] ?? started.ip;
      return { ip, port: started.port, sessionCode: result.sessionCode, hostSocketId: result.hostSocketId, socket, ips: result.ips };
    } catch (err) {
      console.warn("Tauri sidecar spawn failed; falling back to standalone backend on port 3000:", err);
    }
  }

  const devPort = 3000;
  const devIp = "127.0.0.1";
  const { socket, ...result } = await createSessionOnServer(devIp, devPort, opts);
  const ip = result.ips?.[0] ?? devIp;
  return { ip, port: devPort, sessionCode: result.sessionCode, hostSocketId: result.hostSocketId, socket, ips: result.ips };
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function createSessionOnServer(
  ip: string,
  port: number,
  opts: StartSidecarOptions
): Promise<{ sessionCode: string; hostSocketId: string; ips?: string[]; socket: any }> {
  const { io } = await import("socket.io-client");
  return new Promise((resolve, reject) => {
    const sock = io(`http://${ip}:${port}`, {
      transports: ["websocket"],
      reconnection: false,
    });
    const cleanup = (): void => {
      sock.off("connect_error", onErr);
    };
    const onErr = (err: Error): void => {
      cleanup();
      reject(err);
    };
    sock.once("connect_error", onErr);
    sock.once("connect", () => {
      sock.emit(
        "create-session",
        { hostName: opts.hostName, passcode: opts.passcode },
        (result: { sessionCode: string; hostSocketId: string; ips?: string[] }) => {
          cleanup();
          resolve({ ...result, socket: sock });
        }
      );
    });
  });
}
