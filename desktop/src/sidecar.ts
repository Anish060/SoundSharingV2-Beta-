import { ConvexClient } from "convex/browser";
import { api, PRODUCTION_CONVEX_URL } from "./convexSignaling";

export interface SidecarInfo {
  ip: string;
  port: number;
  sessionCode: string;
  hostSocketId: string;
  socket: any;
  ips?: string[];
  convexClient?: ConvexClient;
}

export interface StartSidecarOptions {
  hostName: string;
  passcode: string;
}

/**
 * Tries local Socket.IO server first (fastest local Wi-Fi streaming),
 * falling back to Convex Cloud.
 */
export async function startSignalingSidecar(opts: StartSidecarOptions): Promise<SidecarInfo> {
  const devPort = 3000;
  const devIp = "127.0.0.1";

  // 1. Try connecting to local Socket.IO backend on port 3000 first
  try {
    const { socket, ...result } = await createSessionOnServer(devIp, devPort, opts);
    const ip = result.ips?.[0] ?? devIp;
    return {
      ip,
      port: devPort,
      sessionCode: result.sessionCode,
      hostSocketId: result.hostSocketId,
      socket,
      ips: result.ips ?? [devIp],
    };
  } catch {
    console.log("Local backend port 3000 not found; using Convex Cloud fallback...");
  }

  // 2. Fallback to Convex Cloud
  const client = new ConvexClient(PRODUCTION_CONVEX_URL);
  const hostSocketId = "host_" + Math.random().toString(36).substring(2, 9);
  const result = await client.mutation(api.signaling.createSession, {
    hostName: opts.hostName,
    passcode: opts.passcode,
  });

  return {
    ip: devIp,
    port: devPort,
    sessionCode: result.code,
    hostSocketId,
    socket: null,
    ips: [devIp],
    convexClient: client,
  };
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
