export class RateLimiter {
  private queue: (() => Promise<void>)[] = [];
  private active = 0;
  constructor(
    private concurrency = 2,
    private delayMs = 200,
  ) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job = async () => {
        this.active++;
        try {
          const res = await fn();
          setTimeout(() => {
            this.active--;
            this.next();
          }, this.delayMs);
          resolve(res);
        } catch (e) {
          setTimeout(() => {
            this.active--;
            this.next();
          }, this.delayMs);
          reject(e);
        }
      };
      this.queue.push(job);
      this.next();
    });
  }
  private next() {
    while (this.active < this.concurrency && this.queue.length) {
      const j = this.queue.shift()!;
      void j();
    }
  }
}

export async function withRetry<T>(fn: () => Promise<T>, tries = 3, baseDelay = 500): Promise<T> {
  let attempt = 0;
  let lastErr: any;
  while (attempt < tries) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const status = (e && e.message && String(e.message).match(/ (\d{3}) /))?.[1];
      const backoff = baseDelay * Math.pow(2, attempt);
      if (status && ['429', '500', '502', '503', '504'].includes(status)) {
        await new Promise((r) => setTimeout(r, backoff));
        attempt++;
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}
