export class FloatRingBuffer {
  private buffer: Float32Array;
  private writePos = 0;
  private readPos = 0;
  private size = 0;
  private capacity: number;

  constructor(capacity = 48000 * 2) {
    this.capacity = capacity;
    this.buffer = new Float32Array(capacity);
  }

  public push(samples: number[] | Float32Array): void {
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      if (sample === undefined) continue;

      if (this.size < this.capacity) {
        this.buffer[this.writePos] = sample;
        this.writePos = (this.writePos + 1) % this.capacity;
        this.size++;
      } else {
        // Buffer overflow: drop oldest samples to keep latency low
        this.pop();
        this.buffer[this.writePos] = sample;
        this.writePos = (this.writePos + 1) % this.capacity;
        this.size++;
      }
    }
  }

  public pop(): number {
    if (this.size === 0) return 0;
    const val = this.buffer[this.readPos] ?? 0;
    this.readPos = (this.readPos + 1) % this.capacity;
    this.size--;
    return val;
  }

  public available(): number {
    return this.size;
  }

  public clear(): void {
    this.writePos = 0;
    this.readPos = 0;
    this.size = 0;
    this.buffer.fill(0);
  }
}
