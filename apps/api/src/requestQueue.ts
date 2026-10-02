export class RequestQueueError extends Error {
  readonly status = 503;
}

/** Small, process-local FIFO queue. A slot covers response-body reading too. */
export class RequestQueue {
  private active = 0;
  private waiting: Array<{ start: () => void; timer: ReturnType<typeof setTimeout> }> = [];
  constructor(private limit: number, private maxWaiting = 100, private waitMs = 240_000) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("request concurrency must be a positive integer");
  }
  async run<T>(work: () => Promise<T>, waitMs = this.waitMs): Promise<T> {
    await new Promise<void>((resolve, reject) => {
      if (this.active < this.limit) { this.active++; resolve(); return; }
      if (this.waiting.length >= this.maxWaiting) { reject(new RequestQueueError("Request queue is full; try again later")); return; }
      const entry = {
        start: resolve,
        timer: setTimeout(() => {
          this.waiting.splice(this.waiting.indexOf(entry), 1);
          reject(new RequestQueueError("Request queue wait timed out; try again later"));
        }, waitMs),
      };
      this.waiting.push(entry);
    });
    try { return await work(); }
    finally {
      const next = this.waiting.shift();
      if (next) { clearTimeout(next.timer); next.start(); }
      else this.active--;
    }
  }
}
const queues = new Map<string, RequestQueue>();
export function providerQueue(kind: "chat" | "image") {
  let queue = queues.get(kind);
  if (!queue) {
    const name = kind === "chat" ? "OPENROUTER_PLAN_CONCURRENCY" : "OPENROUTER_IMAGE_CONCURRENCY";
    queue = new RequestQueue(Number(process.env[name] || 4));
    queues.set(kind, queue);
  }
  return queue;
}
