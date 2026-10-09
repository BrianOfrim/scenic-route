import { AsyncLocalStorage } from "node:async_hooks";

export class RequestQueueError extends Error {
  readonly status = 503;
}

type Lease = { owner: string; active: boolean; release: () => void };
export type JobReservation = { owner: string; pending: boolean };
type Waiter = { reservation: JobReservation; owner: string; autoRelease: boolean; start: (lease: Lease) => void; reject: (error: Error) => void; timer?: ReturnType<typeof setTimeout> };

/** Process-local scheduler: FIFO within an owner, round-robin between waiting owners. */
export class RequestQueue {
  private ownerLimits = new Map<string, { active: number; unfinished: number }>();
  setOwnerLimits(owner: string, active: number, unfinished: number) {
    for (const value of [active, unfinished]) {
      if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) throw new Error("Invalid account image limit");
    }
    this.ownerLimits.set(owner, { active, unfinished });
    this.drain();
  }
  private activeLimit(owner: string) { return this.ownerLimits.get(owner)?.active ?? this.perOwner; }
  private active = 0;
  private activeByOwner = new Map<string, number>();
  private waiting = new Map<string, Waiter[]>();
  private owners: string[] = [];
  private waitingCount = 0;
  private reservedByOwner = new Map<string, number>();
  private context = new AsyncLocalStorage<Lease>();

  constructor(private limit: number, private maxWaiting = 100, private waitMs = 240_000, private perOwner = limit, private maxUnfinishedPerOwner = Infinity) {
    for (const value of [limit, perOwner]) {
      if (!Number.isInteger(value) || value < 1) throw new Error("request concurrency must be a positive integer");
    }
  }

  /** Reserve unfinished capacity through active work and retry backoff; callers release terminal jobs. */
  reserveJobs(owner: string, count: number): JobReservation[] {
    const current = this.reservedByOwner.get(owner) || 0;
    const limit = this.ownerLimits.get(owner)?.unfinished ?? this.maxUnfinishedPerOwner;
    if (current + count > limit) {
      throw new RequestQueueError(`You can have at most ${limit} unfinished image-generation jobs. Please wait for existing work to finish before submitting more.`);
    }
    this.reservedByOwner.set(owner, current + count);
    return Array.from({ length: count }, () => ({ owner, pending: true }));
  }

  releaseJob(reservation: JobReservation) {
    if (!reservation.pending) return;
    reservation.pending = false;
    const remaining = this.reservedByOwner.get(reservation.owner)! - 1;
    if (remaining) this.reservedByOwner.set(reservation.owner, remaining);
    else this.reservedByOwner.delete(reservation.owner);
  }

  /** null waitMs disables admission timeout. Supplied reservations survive attempts;
   * their owner releases them after terminal completion. Direct requests release automatically. */
  async run<T>(work: () => Promise<T>, waitMs: number | null = this.waitMs, owner = "default", reservation?: JobReservation): Promise<T> {
    // A gallery job owns a slot through quota accounting and persistence. Its
    // nested provider call must reuse that slot rather than deadlock acquiring twice.
    const current = this.context.getStore();
    if (current?.active && current.owner === owner) return work();
    const lease = await new Promise<Lease>((resolve, reject) => {
      if (waitMs !== null && this.waitingCount >= this.maxWaiting
        && (this.active >= this.limit || (this.activeByOwner.get(owner) || 0) >= this.activeLimit(owner) || this.waiting.has(owner))) {
        reject(new RequestQueueError("Request queue is full; try again later"));
        return;
      }
      const reserved = reservation || this.reserveJobs(owner, 1)[0];
      if (!reserved.pending || reserved.owner !== owner) throw new Error("invalid job reservation");
      const entry: Waiter = { reservation: reserved, owner, autoRelease: !reservation, start: resolve, reject };
      const entries = this.waiting.get(owner);
      if (entries) entries.push(entry);
      else { this.waiting.set(owner, [entry]); this.owners.push(owner); }
      this.waitingCount++;
      if (waitMs !== null) entry.timer = setTimeout(() => {
        const pending = this.waiting.get(owner);
        const index = pending?.indexOf(entry) ?? -1;
        if (index < 0) return;
        pending!.splice(index, 1);
        this.waitingCount--;
        this.releaseJob(entry.reservation);
        if (!pending!.length) {
          this.waiting.delete(owner);
          this.owners.splice(this.owners.indexOf(owner), 1);
        }
        reject(new RequestQueueError("Request queue wait timed out; try again later"));
        this.drain();
      }, waitMs);
      this.drain();
    });
    try { return await this.context.run(lease, work); }
    finally { lease.release(); }
  }

  cancelWaiting(owner: string) {
    const entries = this.waiting.get(owner) ?? [];
    this.waiting.delete(owner);
    this.owners = this.owners.filter(value => value !== owner);
    for (const entry of entries) {
      if (entry.timer) clearTimeout(entry.timer);
      this.waitingCount--;
      this.releaseJob(entry.reservation);
      entry.reject(new RequestQueueError("Account jobs were cancelled."));
    }
    this.drain();
  }

  private drain() {
    let skipped = 0;
    while (this.active < this.limit && this.owners.length && skipped < this.owners.length) {
      const owner = this.owners.shift()!;
      if ((this.activeByOwner.get(owner) || 0) >= this.activeLimit(owner)) {
        this.owners.push(owner);
        skipped++;
        continue;
      }
      skipped = 0;
      const entries = this.waiting.get(owner)!;
      const entry = entries.shift()!;
      if (entries.length) this.owners.push(owner);
      else this.waiting.delete(owner);
      this.waitingCount--;
      if (entry.timer) clearTimeout(entry.timer);
      this.active++;
      this.activeByOwner.set(owner, (this.activeByOwner.get(owner) || 0) + 1);
      let released = false;
      const lease: Lease = { owner, active: true, release: () => {
        if (released) return;
        released = true;
        lease.active = false;
        if (entry.autoRelease) this.releaseJob(entry.reservation);
        this.active--;
        const remaining = this.activeByOwner.get(owner)! - 1;
        if (remaining) this.activeByOwner.set(owner, remaining);
        else this.activeByOwner.delete(owner);
        this.drain();
      } };
      entry.start(lease);
    }
  }
}

const queues = new Map<string, RequestQueue>();
export function providerQueue(kind: "chat" | "image") {
  let queue = queues.get(kind);
  if (!queue) {
    queue = kind === "chat"
      ? new RequestQueue(Number(process.env.OPENROUTER_PLAN_CONCURRENCY || 4))
      : new RequestQueue(Number(process.env.OPENROUTER_IMAGE_CONCURRENCY || 128), Infinity, 240_000,
        Number(process.env.OPENROUTER_IMAGE_USER_CONCURRENCY || 8), 16);
    queues.set(kind, queue);
  }
  return queue;
}
