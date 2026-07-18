import type { Config } from "./config.js";

export interface Logger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

export function createLogger(level: Config["logLevel"]): Logger {
  const shouldLog = (l: "info" | "debug" | "warn" | "error"): boolean => {
    if (level === "silent") return l === "error" || l === "warn";
    if (level === "info") return l !== "debug";
    return true;
  };

  const emit = (l: string, msg: string, meta?: Record<string, unknown>): void => {
    if (!shouldLog(l as "info")) return;
    const line = meta ? `${msg} ${JSON.stringify(meta)}` : msg;
    const prefix = `[${new Date().toISOString()}] [${l}]`;
    if (l === "error") console.error(prefix, line);
    else if (l === "warn") console.warn(prefix, line);
    else console.log(prefix, line);
  };

  return {
    info: (m, meta) => emit("info", m, meta),
    debug: (m, meta) => emit("debug", m, meta),
    warn: (m, meta) => emit("warn", m, meta),
    error: (m, meta) => emit("error", m, meta),
  };
}
