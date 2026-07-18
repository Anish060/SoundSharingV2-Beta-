import { describe, expect, it } from "vitest";
import { TokenBucket } from "../src/rateLimit.js";

describe("TokenBucket", () => {
  it("allows up to the limit within one window", () => {
    const bucket = new TokenBucket(3);
    const now = 1_000_000;
    expect(bucket.consume("a", now)).toBe(true);
    expect(bucket.consume("a", now)).toBe(true);
    expect(bucket.consume("a", now)).toBe(true);
    expect(bucket.consume("a", now)).toBe(false);
  });

  it("resets after the window elapses", () => {
    const bucket = new TokenBucket(2);
    const t0 = 1_000_000;
    expect(bucket.consume("a", t0)).toBe(true);
    expect(bucket.consume("a", t0)).toBe(true);
    expect(bucket.consume("a", t0)).toBe(false);
    expect(bucket.consume("a", t0 + 60_001)).toBe(true);
  });

  it("tracks buckets independently per key", () => {
    const bucket = new TokenBucket(1);
    expect(bucket.consume("a")).toBe(true);
    expect(bucket.consume("b")).toBe(true);
    expect(bucket.consume("a")).toBe(false);
    expect(bucket.consume("b")).toBe(false);
  });
});
