// Per-process backstop; replicas still need a shared/gateway limiter.
export class ImportGuardError extends Error {
  constructor(public readonly retryAfter: number) { super("Too many imports; retry later"); }
}
export function createImportGuard(options = { attempts: 6, windowMs: 60_000, concurrent: 1, keys: 10_000 }) {
  const accounts = new Map<string, { start: number; attempts: number; active: boolean }>();
  let active = 0;
  return function acquire(userId: string, now = Date.now()): () => void {
    for (const [id, entry] of accounts) {
      if (!entry.active && now - entry.start >= options.windowMs) accounts.delete(id);
    }
    let entry = accounts.get(userId);
    if (entry?.active || active >= options.concurrent) throw new ImportGuardError(5);
    if (entry && entry.attempts >= options.attempts) throw new ImportGuardError(Math.max(1, Math.ceil((entry.start + options.windowMs - now) / 1000)));
    if (!entry) {
      if (accounts.size >= options.keys) throw new ImportGuardError(60);
      entry = { start: now, attempts: 0, active: false };
      accounts.set(userId, entry);
    } else if (now - entry.start >= options.windowMs) { entry.start = now; entry.attempts = 0; }
    entry.attempts++;
    entry.active = true;
    active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.active = false;
      active--;
    };
  };
}
export const acquireImport = createImportGuard();
