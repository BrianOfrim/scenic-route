/** Share pending work only. Completed responses and failures are never retained. */
export function coalesceRequests<T>(load: (key: string) => Promise<T>) {
  const pending = new Map<string, Promise<T>>();
  return (key: string): Promise<T> => {
    const existing = pending.get(key);
    if (existing) return existing;
    const request = Promise.resolve().then(() => load(key)).finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };
}

/**
 * Share a call only when an identical one started inside `windowMs`.
 * A request that has already been running longer stays independent, so a newer
 * caller cannot adopt a snapshot from before its own start.
 */
export function shareRecentRequests<T>(windowMs: number, load: (key: string, publish: (value: T) => void) => Promise<T>) {
  const pending = new Map<string, { started: number; promise: Promise<T>; listeners: Set<(value: T) => void>; latest?: T }>();
  return (key: string, onProgress?: (value: T) => void): Promise<T> => {
    const existing = pending.get(key);
    if (existing && Date.now() - existing.started < windowMs) {
      if (onProgress) {
        existing.listeners.add(onProgress);
        if (existing.latest !== undefined) onProgress(existing.latest);
      }
      return existing.promise;
    }
    const started = Date.now();
    const listeners = new Set<(value: T) => void>(onProgress ? [onProgress] : []);
    const promise = Promise.resolve()
      .then(() => load(key, value => {
        request.latest = value;
        for (const listener of listeners) listener(value);
      }))
      .finally(() => {
        if (pending.get(key)?.promise === promise) pending.delete(key);
        listeners.clear();
      });
    const request: { started: number; promise: Promise<T>; listeners: typeof listeners; latest?: T } = { started, promise, listeners };
    pending.set(key, request);
    return promise;
  };
}
