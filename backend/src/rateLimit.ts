export class TokenBucket {
  private readonly buckets = new Map<string, { count: number; windowStart: number }>();
  private readonly windowMs = 60_000;

  constructor(private readonly limitPerMinute: number) {}

  consume(key: string, now: number = Date.now()): boolean {
    const existing = this.buckets.get(key);
    if (!existing || now - existing.windowStart >= this.windowMs) {
      this.buckets.set(key, { count: 1, windowStart: now });
      return true;
    }
    if (existing.count >= this.limitPerMinute) return false;
    existing.count += 1;
    return true;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  gc(now: number = Date.now()): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStart >= this.windowMs) this.buckets.delete(key);
    }
  }
}
