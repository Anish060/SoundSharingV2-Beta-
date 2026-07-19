import { createSocket } from "node:dgram";
import { createServer, type Server as HttpServer } from "node:http";
import { networkInterfaces } from "node:os";
import express from "express";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketData,
} from "@sshare/shared";
import { loadConfig, type Config } from "./config.js";
import { createLogger, type Logger } from "./logger.js";
import { TokenBucket } from "./rateLimit.js";
import { SessionStore } from "./sessionStore.js";
import { attachSignaling } from "./signaling.js";

export interface StartedServer {
  http: HttpServer;
  io: Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
  address: { host: string; port: number };
  close: () => Promise<void>;
}

export async function startServer(overrides: Partial<Config> = {}): Promise<StartedServer> {
  const config: Config = { ...loadConfig(), ...overrides };
  const log = createLogger(config.logLevel);
  return startServerWith(config, log);
}

async function startServerWith(config: Config, log: Logger): Promise<StartedServer> {
  const app = express();
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  const http = createServer(app);
  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >(http, {
    cors: { origin: true, credentials: false },
    pingInterval: 10_000,
    pingTimeout: 20_000,
  });

  // Detect the routable LAN IP once at startup so signaling can advertise it
  // ahead of any Docker/WSL/Hyper-V virtual interfaces.
  const primaryIp = await pickPrimaryIp();
  if (primaryIp) log.info("primary routable interface", { ip: primaryIp });

  const sessions = new SessionStore();
  const joinLimiter = new TokenBucket(config.joinRateLimitPerMinute);
  attachSignaling({
    io,
    sessions,
    joinLimiter,
    maxListenersPerSession: config.maxListenersPerSession,
    log,
    discoverLocalIps: () => discoverLocalIps(primaryIp),
  });

  const gcTimer = setInterval(() => joinLimiter.gc(), 60_000);
  gcTimer.unref?.();

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(config.port, config.host, () => {
      http.off("error", reject);
      resolve();
    });
  });

  const addr = http.address();
  const boundPort =
    typeof addr === "object" && addr && "port" in addr ? addr.port : config.port;

  const ifaceIps = discoverLocalIps(primaryIp);
  log.info(`SShare signaling listening`, {
    host: config.host,
    port: boundPort,
    interfaces: ifaceIps,
  });

  const close = async (): Promise<void> => {
    clearInterval(gcTimer);
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await new Promise<void>((resolve) => http.close(() => resolve()));
  };

  return { http, io, address: { host: config.host, port: boundPort }, close };
}

export function discoverLocalIps(primaryIp: string | null = null): string[] {
  const results: string[] = [];
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] ?? []) {
      if (info.family !== "IPv4" || info.internal) continue;
      results.push(info.address);
    }
  }
  if (primaryIp && results.includes(primaryIp)) {
    return [primaryIp, ...results.filter((ip) => ip !== primaryIp)];
  }
  return results.sort(compareByRoutability);
}

// Prefer 192.168.x.x, then 10.x.x.x, deprioritise 172.16-31.x.x (Docker/WSL/Hyper-V default).
function compareByRoutability(a: string, b: string): number {
  return scoreIp(b) - scoreIp(a);
}

function scoreIp(ip: string): number {
  if (ip.startsWith("192.168.")) return 100;
  if (ip.startsWith("10.")) return 80;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 20;
  return 50;
}

// Ask the OS which interface it would use to reach the public internet.
// dgram.connect on UDP doesn't send anything; it just fixes the local address.
export function pickPrimaryIp(): Promise<string | null> {
  return new Promise((resolve) => {
    const sock = createSocket("udp4");
    let settled = false;
    const done = (value: string | null): void => {
      if (settled) return;
      settled = true;
      try {
        sock.close();
      } catch {
        // ignore
      }
      resolve(value);
    };
    sock.once("error", () => done(null));
    try {
      sock.connect(80, "8.8.8.8", () => {
        try {
          const addr = sock.address();
          done(addr?.address ?? null);
        } catch {
          done(null);
        }
      });
    } catch {
      done(null);
    }
  });
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isDirectRun) {
  startServer().catch((err) => {
    console.error("Failed to start SShare signaling server", err);
    process.exit(1);
  });
}
