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

  const sessions = new SessionStore();
  const joinLimiter = new TokenBucket(config.joinRateLimitPerMinute);
  attachSignaling({
    io,
    sessions,
    joinLimiter,
    maxListenersPerSession: config.maxListenersPerSession,
    log,
    discoverLocalIps,
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

  const ifaceIps = discoverLocalIps();
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

export function discoverLocalIps(): string[] {
  const results: string[] = [];
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] ?? []) {
      if (info.family !== "IPv4" || info.internal) continue;
      results.push(info.address);
    }
  }
  return results;
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
