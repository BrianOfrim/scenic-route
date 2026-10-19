/** Keep thumbnail traffic bounded so previews and generation requests have room. */
export function createImageQueue(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  function pump() {
    while (active < limit && waiting.length) waiting.shift()!();
  }
  return <T>(work: () => Promise<T>) => new Promise<T>((resolve, reject) => {
    waiting.push(() => {
      active++;
      void work().then(resolve, reject).finally(() => { active--; pump(); });
    });
    pump();
  });
}
const thumbnails = createImageQueue(2);
const previews = createImageQueue(1);
const cache = new Map<string, Promise<string>>();

async function imageDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("scenic-route-studio-images", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("thumbnails");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function cachedThumbnail(key: string, blob?: Blob): Promise<Blob | undefined> {
  const db = await imageDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("thumbnails", blob ? "readwrite" : "readonly");
      const req = blob ? tx.objectStore("thumbnails").put(blob, key) : tx.objectStore("thumbnails").get(key);
      let result: Blob | undefined;
      req.onsuccess = () => { result = blob || req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export function studioImage(userId: string, url: string, preview = false) {
  const key = `${userId}:${url}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = (preview ? previews : thumbnails)(async () => {
    const cached = preview ? undefined : await cachedThumbnail(key).catch(() => undefined);
    if (cached) return URL.createObjectURL(cached);
    const response = await fetch(url, { credentials: "include", signal: AbortSignal.timeout(45000), priority: preview ? "high" : "low" });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error ? `${body.error} (${response.status}). Try again.` : `Image request failed (${response.status}). Try again.`);
    }
    if (!response.headers.get("content-type")?.startsWith("image/")) throw new Error("The server did not return an image. Check that you are signed in.");
    const blob = await response.blob();
    if (!preview) void cachedThumbnail(key, blob).catch(() => {});
    return URL.createObjectURL(blob);
  }).catch(error => { cache.delete(key); throw error; });
  cache.set(key, pending);
  return pending;
}
