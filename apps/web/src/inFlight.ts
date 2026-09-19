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
