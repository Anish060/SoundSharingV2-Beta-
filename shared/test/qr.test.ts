import { describe, expect, it } from "vitest";
import { decodeQr, encodeQr, QR_SCHEMA_VERSION, type QrPayload } from "../src/qr.js";

describe("qr schema", () => {
  const sample: QrPayload = {
    v: 1,
    ip: "192.168.1.45",
    port: 3000,
    code: "SS-8742",
    protocol: "ws",
    requiresPasscode: true,
  };

  it("round-trips a valid payload", () => {
    expect(decodeQr(encodeQr(sample))).toEqual(sample);
  });

  it("rejects unknown schema version", () => {
    const bad = JSON.stringify({ ...sample, v: 99 });
    expect(() => decodeQr(bad)).toThrow(/Unsupported QR schema version/);
  });

  it("rejects malformed JSON", () => {
    expect(() => decodeQr("{not json")).toThrow(/not valid JSON/);
  });

  it("rejects payload missing fields", () => {
    const bad = JSON.stringify({ v: QR_SCHEMA_VERSION, ip: "x" });
    expect(() => decodeQr(bad)).toThrow(/missing required fields/);
  });

  it("rejects wrong protocol", () => {
    const bad = JSON.stringify({ ...sample, protocol: "http" });
    expect(() => decodeQr(bad)).toThrow(/missing required fields/);
  });
});
