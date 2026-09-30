/** A concise display caption, rather than a street address. */
export function locationCaption(address: Record<string, unknown>): string {
  const name = (...keys: string[]) => keys.map(key => address[key]).find(value => typeof value === "string" && value.trim()) as string | undefined;
  return [...new Set([
    name("city", "town", "village", "municipality", "hamlet", "county"),
    name("state", "region"),
    name("country"),
  ].filter((value): value is string => Boolean(value)).map(value => value.trim()))].join(" · ");
}

const cache = new Map<string, { value: Promise<string>; expires: number }>();
let queue = Promise.resolve();
let lastRequest = 0;

/** Cache and serialize lookups so crop changes do not flood the geocoder. */
export function reverseLocation(lat: number, lng: number): Promise<string> {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = queue.then(async () => {
    const wait = 1100 - (Date.now() - lastRequest);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    lastRequest = Date.now();
    const params = new URLSearchParams({ lat: String(lat), lon: String(lng), format: "jsonv2", zoom: "10", addressdetails: "1", "accept-language": "en" });
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
        headers: { "User-Agent": "scenic-route/lookup (local-first poster generator)", Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return "";
      const body = await response.json() as { address?: Record<string, unknown> };
      return body.address ? locationCaption(body.address) : "";
    } catch { return ""; }
  });
  queue = value.then(() => {});
  if (cache.size >= 500) cache.delete(cache.keys().next().value!);
  const entry = { value, expires: Date.now() + 24 * 60 * 60 * 1000 };
  cache.set(key, entry);
  void value.then(result => { if (!result) entry.expires = Date.now() + 60_000; });
  return value;
}
