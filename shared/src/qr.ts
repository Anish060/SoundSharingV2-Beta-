export const QR_SCHEMA_VERSION = 1;

export interface QrPayloadV1 {
  v: 1;
  ip: string;
  port: number;
  code: string;
  protocol: "ws" | "wss";
  requiresPasscode: boolean;
  convexUrl?: string;
}

export type QrPayload = QrPayloadV1;

export function encodeQr(payload: QrPayload): string {
  return JSON.stringify(payload);
}

export function decodeQr(raw: string): QrPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("QR payload is not valid JSON");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("QR payload is not an object");
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.v !== QR_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported QR schema version ${String(obj.v)} (expected ${QR_SCHEMA_VERSION})`
    );
  }

  if (
    typeof obj.ip !== "string" ||
    typeof obj.port !== "number" ||
    typeof obj.code !== "string" ||
    (obj.protocol !== "ws" && obj.protocol !== "wss") ||
    typeof obj.requiresPasscode !== "boolean"
  ) {
    throw new Error("QR payload is missing required fields");
  }

  return {
    v: 1,
    ip: obj.ip,
    port: obj.port,
    code: obj.code,
    protocol: obj.protocol,
    requiresPasscode: obj.requiresPasscode,
    convexUrl: typeof obj.convexUrl === "string" ? obj.convexUrl : undefined,
  };
}
