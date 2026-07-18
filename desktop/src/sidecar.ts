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
 * Creates an audio sharing session on Convex Cloud.
 */
export async function startSignalingSidecar(opts: StartSidecarOptions): Promise<SidecarInfo> {
  const convexUrl = PRODUCTION_CONVEX_URL;
  const client = new ConvexClient(convexUrl);
  
  try {
    const hostSocketId = "host_" + Math.random().toString(36).substring(2, 9);
    const result = await client.mutation(api.signaling.createSession, {
      hostName: opts.hostName,
      passcode: opts.passcode,
    });

    const devPort = 3000;
    const devIp = "127.0.0.1";
    const ips = [devIp];

    return {
      ip: devIp,
      port: devPort,
      sessionCode: result.code,
      hostSocketId,
      socket: null,
      ips,
      convexClient: client,
    };
  } catch (err) {
    console.error("Failed to create session on Convex Cloud:", err);
    throw new Error("Convex Cloud connection failed: " + String(err));
  }
}
