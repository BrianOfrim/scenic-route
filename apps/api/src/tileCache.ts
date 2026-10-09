import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import CachePolicy from "http-cache-semantics";
import sharp from "sharp";

const DAY = 86_400_000;
const MAX_TILE = 1024 * 1024;
const MAX_FILE = 2 * MAX_TILE;
const OPTIONS = { shared: true, cacheHeuristic: 0, immutableMinTimeToLive: 0, ignoreCargoCult: false };
export const OSM_USER_AGENT = "ScenicRoute/1.0 (+https://scenic-route.ca; contact: info@scenic-route.ca)";
export class TileError extends Error {
  constructor(message: string, public status: 400 | 403 | 404 | 502 | 503 = 503, public retryAfter?: number) { super(message); }
}
export type Tile = { bytes: Buffer; contentType: string; headers?: Record<string, string> };
type Entry = { version: 1; url: string; body: string; digest: string; headers: Record<string, string>; policy: CachePolicy.CachePolicyObject; protectedUntil: number; expiresAt: number };
type Index = { size: number; accessed: number; expiresAt: number; protectedUntil: number };
export type TileCacheOptions = {
  dir: string; maxBytes?: number; maxEntries?: number; concurrency?: number; maxQueued?: number;
  production?: boolean; enabled?: boolean; now?: () => number; fetch?: typeof fetch;
  log?: (event: string, metrics: Record<string, number>) => void;
};

/** A disk-backed, process-local OSM cache. Only tile data and sanitized upstream request metadata are stored. */
export class TileCache {
  private now: () => number;
  private transport: typeof fetch;
  private index = new Map<string, Index>();
  private pending = new Map<string, Promise<Tile>>();
  private failures = new Map<string, number>();
  private initialized?: Promise<void>;
  private writable = false;
  private mounted = true;
  private total = 0;
  private active = 0;
  private waiters: Array<() => void> = [];
  private writeTail = Promise.resolve();
  private maxBytes: number;
  private maxEntries: number;
  private concurrency: number;
  private maxQueued: number;
  private counters: Record<string, number> = {};
  constructor(private options: TileCacheOptions) {
    this.now = options.now ?? Date.now;
    this.transport = options.fetch ?? fetch;
    this.maxBytes = options.maxBytes ?? 2 * 1024 ** 3;
    this.maxEntries = options.maxEntries ?? 50_000;
    this.concurrency = options.concurrency ?? 4;
    this.maxQueued = options.maxQueued ?? 64;
    for (const limit of [this.maxBytes, this.maxEntries, this.concurrency, this.maxQueued]) {
      if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("invalid OSM tile cache limit");
    }
  }
  stats(): Record<string, number> { return { ...this.counters, bytes: this.total, entries: this.index.size, active: this.active, queued: this.waiters.length, storageWritable: Number(this.writable) }; }
  private event(name: string) {
    this.counters[name] = (this.counters[name] ?? 0) + 1;
    // Sample routine traffic; failures always produce sanitized aggregate metrics.
    if (this.counters[name] === 1 || this.counters[name] % 100 === 0 || /failure|saturated/.test(name)) this.options.log?.(name, this.stats());
  }
  private id(url: string) { return createHash("sha256").update(`osm-standard-v1:${url}`).digest("hex"); }
  private file(id: string) { return path.join(this.options.dir, `${id}.tile`); }
  private policy(entry: Entry) {
    const policy = CachePolicy.fromObject(entry.policy);
    Object.defineProperty(policy, "now", { value: this.now });
    return policy;
  }
  private async checkMount() {
    if (!this.options.production) return;
    let mounts: string;
    try { mounts = await fs.readFile("/proc/self/mountinfo", "utf8"); }
    catch (error) { this.mounted = false; throw error; }
    const root = path.resolve(this.options.dir);
    const attached = mounts.split("\n").some(line => {
      const mount = line.split(" ")[4]?.replace(/\\040/g, " ");
      return mount && mount !== "/" && (root === mount || root.startsWith(`${mount}/`));
    });
    if (!attached) { this.mounted = false; throw new Error("OSM cache volume is not mounted"); }
  }
  private async initialize() {
    if (!this.initialized) this.initialized = (async () => {
      try {
        await this.checkMount();
        await fs.mkdir(this.options.dir, { recursive: true, mode: 0o700 });
        const files = await fs.readdir(this.options.dir);
        for (const name of files) {
          if (/^[a-f0-9]{64}\.[a-f0-9-]+\.tmp$/.test(name)) { await fs.rm(path.join(this.options.dir, name), { force: true }); continue; }
          if (!/^[a-f0-9]{64}\.tile$/.test(name)) continue;
          if (this.index.size >= this.maxEntries) throw new Error("OSM cache index limit exceeded");
          const id = name.slice(0, -5);
          const entry = await this.read(id);
          if (!entry) continue;
          const stat = await fs.stat(this.file(id));
          this.index.set(id, { size: stat.size, accessed: stat.mtimeMs, expiresAt: entry.expiresAt, protectedUntil: entry.protectedUntil });
          this.total += stat.size;
        }
        const probe = path.join(this.options.dir, `${randomUUID()}.probe`);
        await fs.writeFile(probe, "", { flag: "wx" });
        await fs.unlink(probe);
        this.writable = true;
      } catch { this.event("storage_failure"); }
    })();
    await this.initialized;
  }
  private async read(id: string): Promise<Entry | null> {
    try {
      const stat = await fs.stat(this.file(id));
      if (!stat.isFile() || stat.size > MAX_FILE) throw new Error("invalid cache file");
      const entry: Entry = JSON.parse(await fs.readFile(this.file(id), "utf8"));
      if (entry.version !== 1 || typeof entry.url !== "string" || this.id(entry.url) !== id || typeof entry.body !== "string" || !entry.headers || !Number.isFinite(entry.expiresAt) || !Number.isFinite(entry.protectedUntil)) throw new Error("invalid cache record");
      const bytes = Buffer.from(entry.body, "base64");
      if (bytes.length > MAX_TILE || createHash("sha256").update(bytes).digest("hex") !== entry.digest) throw new Error("corrupt cache body");
      const policy = this.policy(entry);
      if (!Number.isFinite(policy.maxAge()) || !Number.isFinite(policy.age())) throw new Error("invalid cache policy");
      if (entry.expiresAt + 7 * DAY < this.now() && entry.protectedUntil <= this.now()) {
        await this.remove(id); return null;
      }
      return entry;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.event("corrupt_entry");
        try { await fs.unlink(this.file(id)); } catch { this.writable = false; this.event("storage_failure"); }
      }
      const indexed = this.index.get(id);
      if (indexed) { this.total -= indexed.size; this.index.delete(id); }
      return null;
    }
  }
  async get(url: string, referer: string): Promise<Tile> {
    if (this.options.enabled === false) throw new TileError("OpenStreetMap tiles are disabled");
    await this.initialize();
    if (!this.mounted) throw new TileError("OpenStreetMap tile storage is unavailable");
    const request: CachePolicy.HttpRequest = { url, method: "GET", headers: { "user-agent": OSM_USER_AGENT, accept: "image/png", "accept-encoding": "identity", referer } };
    const id = this.id(url);
    const entry = await this.read(id);
    if (entry) {
      const policy = this.policy(entry);
      if (!policy.stale() && policy.satisfiesWithoutRevalidation(request)) {
        const indexed = this.index.get(id); if (indexed) indexed.accessed = this.now();
        this.event("hit"); return this.tile(entry, policy);
      }
    }
    if (!this.writable) throw new TileError("OpenStreetMap tile storage is unavailable");
    // Referer is part of in-flight identity so Vary: Referer cannot mix requests.
    const flight = `${id}:${referer}`;
    const until = Math.max(this.failures.get(flight) ?? 0, this.failures.get("upstream") ?? 0, this.failures.get("capacity") ?? 0);
    if (until > this.now()) throw new TileError("OpenStreetMap tiles are temporarily unavailable", 503, Math.ceil((until - this.now()) / 1000));
    const shared = this.pending.get(flight);
    if (shared) { this.event("coalesced"); return shared; }
    const work = this.schedule(async () => {
      // A write may have failed while this request was waiting.
      if (!this.writable) throw new TileError("OpenStreetMap tile storage is unavailable");
      const blockedUntil = Math.max(this.failures.get("upstream") ?? 0, this.failures.get("capacity") ?? 0);
      if (blockedUntil > this.now()) throw new TileError("OpenStreetMap tiles are temporarily unavailable", 503, Math.ceil((blockedUntil - this.now()) / 1000));
      if (!this.index.has(id) && this.index.size >= this.maxEntries && [...this.index.values()].every(info => info.protectedUntil > this.now())) {
        this.event("cache_saturated");
        throw new TileError("OpenStreetMap tile cache is full", 503, 30);
      }
      this.event(entry ? "revalidation" : "miss");
      try { return await this.download(id, request, entry); }
      catch (error) {
        this.event("upstream_failure");
        const failure = error instanceof TileError ? error : new TileError("OpenStreetMap tile request failed", 502);
        if (this.failures.size >= 1024) this.failures.delete(this.failures.keys().next().value!);
        this.failures.set(flight, this.now() + Math.max(30, failure.retryAfter ?? 0) * 1000);
        throw failure;
      }
    }).finally(() => this.pending.delete(flight));
    this.pending.set(flight, work);
    return work;
  }
  private async schedule<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      if (this.waiters.length >= this.maxQueued) { this.event("queue_saturated"); throw new TileError("OpenStreetMap tile queue is full", 503, 30); }
      await new Promise<void>(resolve => this.waiters.push(resolve));
    } else this.active++;
    try { return await work(); }
    finally { const next = this.waiters.shift(); if (next) next(); else this.active--; }
  }
  private async fetchResponse(request: CachePolicy.HttpRequest, headers: Record<string, string>) {
    const started = this.now();
    const response = await this.transport(request.url!, { headers, redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (response.status !== 200 && response.status !== 304) {
      const raw = response.headers.get("retry-after");
      const retryAfter = raw && /^\d+$/.test(raw) ? Number(raw) : raw ? Math.ceil((Date.parse(raw) - this.now()) / 1000) : 0;
      const wait = Number.isFinite(retryAfter) ? Math.min(86_400, Math.max(30, retryAfter)) : 30;
      if (response.status === 429 || response.status === 503) this.failures.set("upstream", this.now() + wait * 1000);
      await response.body?.cancel();
      throw new TileError("OpenStreetMap tile service is unavailable", 502, wait);
    }
    const responseHeaders = Object.fromEntries(response.headers.entries());
    const apparent = Math.max(0, (this.now() - Date.parse(responseHeaders.date ?? "")) / 1000) || 0;
    const age = /^\d+$/.test(responseHeaders.age ?? "0") ? Math.min(2147483648, Number(responseHeaders.age ?? 0)) : 0;
    responseHeaders.age = String(Math.ceil(Math.max(apparent, age + (this.now() - started) / 1000)));
    responseHeaders.date ||= new Date(this.now()).toUTCString();
    return { response, headers: responseHeaders };
  }
  private createPolicy(request: CachePolicy.HttpRequest, original: Record<string, string>) {
    const headers = { ...original };
    const cc = headers["cache-control"] ?? "";
    const freshness = cc.split(",").filter(part => /^\s*(s-maxage|max-age)\s*(=|$)/i.test(part));
    const invalid = freshness.some(part => !/^\s*(s-maxage|max-age)\s*=\s*(?:\d+|"\d+")\s*$/i.test(part)) ||
      new Set(freshness.map(part => part.trim().split(/[=\s]/)[0].toLowerCase())).size !== freshness.length ||
      (!freshness.length && "expires" in headers && !Number.isFinite(Date.parse(headers.expires)));
    // Delta-seconds can exceed JavaScript's range; saturate rather than wrap/lose freshness.
    if (!invalid && freshness.length) headers["cache-control"] = cc.replace(/((?:s-maxage|max-age)\s*=\s*)(?:"(\d+)"|(\d+))/gi,
      (_match, prefix, quoted, digits) => `${prefix}${Math.min(2147483648, Number(quoted ?? digits))}`);
    const restricted = /(?:^|,)\s*(no-cache|no-store|private)\s*(?:=|,|$)/i.test(cc);
    const fallback = !freshness.length && !("expires" in headers) && !restricted;
    if (invalid) headers["cache-control"] = `${cc}, no-cache`;
    else if (fallback) headers["cache-control"] = `${cc ? `${cc}, ` : ""}max-age=604800`;
    const initial = new CachePolicy(request, { status: 200, headers }, OPTIONS).toObject();
    initial.t = this.now();
    const policy = CachePolicy.fromObject(initial); Object.defineProperty(policy, "now", { value: this.now });
    return { policy, fallback };
  }
  private async download(id: string, request: CachePolicy.HttpRequest, old: Entry | null): Promise<Tile> {
    const policy = old ? this.policy(old) : null;
    const headers = policy ? policy.revalidationHeaders(request) as Record<string, string> : request.headers as Record<string, string>;
    let result = await this.fetchResponse(request, headers);
    let bytes: Buffer;
    if (result.response.status === 304) {
      const conditional = headers["if-none-match"] || headers["if-modified-since"];
      const checkHeaders = { ...result.headers };
      // A 304 may omit validators; the conditional request still identifies this entry.
      if (old && conditional) {
        checkHeaders.etag ??= old.headers.etag;
        checkHeaders["last-modified"] ??= old.headers["last-modified"];
      }
      const match = old && conditional && policy?.revalidatedPolicy(request, { status: 304, headers: checkHeaders }).matches;
      const readable = match ? await this.read(id) : null;
      if (readable && readable.digest === old!.digest) {
        bytes = Buffer.from(readable.body, "base64");
        result.headers = { ...old!.headers, ...result.headers };
        this.event("not_modified");
      } else {
        result = await this.fetchResponse(request, request.headers as Record<string, string>);
        if (result.response.status !== 200) throw new TileError("Invalid OpenStreetMap validation response", 502);
        bytes = await readPng(result.response);
      }
    } else bytes = await readPng(result.response);
    const { policy: updated, fallback } = this.createPolicy(request, result.headers);
    const expiresAt = this.now() + Math.max(0, updated.maxAge() - updated.age()) * 1000;
    const entry: Entry = { version: 1, url: request.url!, body: bytes.toString("base64"), digest: createHash("sha256").update(bytes).digest("hex"), headers: result.headers, policy: updated.toObject(), expiresAt, protectedUntil: fallback ? expiresAt : 0 };
    if (updated.storable()) await this.save(id, entry);
    else await this.remove(id);
    return this.tile(entry, updated);
  }
  private tile(entry: Entry, policy: CachePolicy): Tile {
    const responseHeaders = policy.responseHeaders();
    const result: Record<string, string> = { "cache-control": "no-store" };
    if (policy.storable()) {
      const browser = CachePolicy.fromObject({ ...policy.toObject(), sh: false });
      Object.defineProperty(browser, "now", { value: this.now });
      const remaining = Math.max(0, Math.floor(Math.min(policy.maxAge() - policy.age(), browser.maxAge() - browser.age())));
      result["cache-control"] = `private, max-age=${remaining}, must-revalidate`;
      result.date = new Date(this.now()).toUTCString();
      // max-age has already been reduced by the upstream age; do not subtract twice.
      result.age = "0";
    }
    for (const name of ["etag", "last-modified"]) if (typeof responseHeaders[name] === "string") result[name] = responseHeaders[name];
    return { bytes: Buffer.from(entry.body, "base64"), contentType: "image/png", headers: result };
  }
  private async remove(id: string) {
    try { await fs.rm(this.file(id), { force: true }); }
    catch { this.writable = false; this.event("storage_failure"); throw new TileError("OpenStreetMap tile storage is unavailable"); }
    const old = this.index.get(id); if (old) this.total -= old.size;
    this.index.delete(id);
  }
  private async save(id: string, entry: Entry) {
    const write = this.writeTail.then(async () => {
      if (!this.writable) throw new TileError("OpenStreetMap tile storage is unavailable");
      const body = JSON.stringify(entry);
      const size = Buffer.byteLength(body);
      if (size > MAX_FILE || size > this.maxBytes) throw new TileError("OpenStreetMap tile cache is full");
      const previous = this.index.get(id);
      const needsSpace = this.total - (previous?.size ?? 0) + size > this.maxBytes || this.index.size + Number(!previous) > this.maxEntries;
      const candidates = needsSpace ? [...this.index].filter(([key, info]) => key !== id && info.protectedUntil <= this.now())
        .sort((a, b) => Number(a[1].expiresAt > this.now()) - Number(b[1].expiresAt > this.now()) || a[1].accessed - b[1].accessed) : [];
      while (this.total - (previous?.size ?? 0) + size > this.maxBytes || this.index.size + Number(!previous) > this.maxEntries) {
        const candidate = candidates.shift();
        if (!candidate) { this.failures.set("capacity", this.now() + 30_000); this.event("cache_saturated"); throw new TileError("OpenStreetMap tile cache is full", 503, 30); }
        await this.remove(candidate[0]); this.event("eviction");
      }
      const tmp = path.join(this.options.dir, `${id}.${randomUUID()}.tmp`);
      try {
        const file = await fs.open(tmp, "wx", 0o600);
        try { await file.writeFile(body); await file.sync(); } finally { await file.close(); }
        await fs.rename(tmp, this.file(id));
        const directory = await fs.open(this.options.dir, "r");
        try { await directory.sync(); } finally { await directory.close(); }
        this.total += size - (previous?.size ?? 0);
        this.index.set(id, { size, accessed: this.now(), expiresAt: entry.expiresAt, protectedUntil: entry.protectedUntil });
      } finally { await fs.rm(tmp, { force: true }); }
    });
    this.writeTail = write.catch(() => {});
    try { await write; }
    catch (error) { if (!(error instanceof TileError)) { this.writable = false; this.event("storage_failure"); throw new TileError("OpenStreetMap tile storage is unavailable"); } throw error; }
  }
}

async function readPng(response: Response): Promise<Buffer> {
  if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "image/png") {
    await response.body?.cancel(); throw new TileError("Unexpected OpenStreetMap tile format", 502);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new TileError("Empty OpenStreetMap tile", 502);
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > MAX_TILE) throw new TileError("OpenStreetMap tile is too large", 502); chunks.push(value); }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || !bytes.subarray(-12).equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]))) throw new TileError("Incomplete OpenStreetMap tile", 502);
  try { await sharp(bytes, { limitInputPixels: 256 * 256, failOn: "warning" }).raw().toBuffer(); }
  catch { throw new TileError("Invalid OpenStreetMap tile", 502); }
  return bytes;
}
