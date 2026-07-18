export interface Config {
  port: number;
  host: string;
  joinRateLimitPerMinute: number;
  maxListenersPerSession: number;
  logLevel: "silent" | "info" | "debug";
}

export function loadConfig(): Config {
  return {
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? "0.0.0.0",
    joinRateLimitPerMinute: Number(process.env.JOIN_RATE_LIMIT ?? 5),
    maxListenersPerSession: Number(process.env.MAX_LISTENERS ?? 30),
    logLevel: (process.env.LOG_LEVEL as Config["logLevel"]) ?? "info",
  };
}
