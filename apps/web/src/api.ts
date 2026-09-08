import type { FeatureCollection, LineString } from "geojson";

export type ActivitySummary = {
  id: number;
  name: string;
  type: string;
  sportType: string;
  startDate: string;
  distance: number;
  movingTime: number | null;
  elapsedTime: number | null;
  elevationGain: number | null;
  averageSpeed: number | null;
  hasGps: boolean;
  streamsSynced: boolean;
};

export type SyncProgress = {
  listComplete: boolean;
  listed: number;
  streamsSynced: number;
  streamsPending: number;
  skipped: number;
  done?: boolean;
  rateLimited?: boolean;
  retryAfter?: number;
};

export type StatusPayload = {
  strava: {
    configured: boolean;
    connected: boolean;
    athlete: { firstname: string; lastname: string } | null;
    sync: SyncProgress;
  };
  openrouter: { configured: boolean };
};

export type FeatureOption = {
  id: string;
  label: string;
  group: "geography" | "landmarks";
  defaultOn: boolean;
};

export type PosterPoi = {
  name: string;
  kind: string;
  lat: number;
  lng: number;
  distToRouteM: number;
  routeFrac: number;
  bearing: string;
  xy: { x: number; y: number; region: string };
  source?: string;
  inside?: string;
};

export type AreaGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export type NamedArea = {
  name: string;
  kind: string;
  geometry: AreaGeometry;
  lat: number;
  lng: number;
  distToRouteM: number;
  routeFrac: number;
  bearing: string;
  xy: { x: number; y: number; region: string };
  /** Schematic wash letter (A, B, C…). Names live in the prompt. */
  letter?: string;
};

export type FormattedStat = { id: string; label: string; value: string };

export type PosterWays = Record<string, FeatureCollection>;

export type NamedWay = {
  name: string;
  kind: string;
  geometry: { type: "MultiLineString"; coordinates: number[][][] };
  lat: number;
  lng: number;
  distToRouteM: number;
  routeFrac: number;
  bearing: string;
  xy: { x: number; y: number; region: string };
  source?: "osm" | "strava";
  colorName?: string;
  color?: string;
  /** Inclusive GPS-stream indexes from Strava efforts. Prefer these over distance. */
  routeSpans?: Array<{ start: number; end: number }>;
};

export type PosterContext = {
  activity: {
    id: number;
    name: string;
    sportType: string;
    startDate: string;
    distance: number;
    movingTime: number | null;
    elapsedTime: number | null;
    elevationGain: number | null;
    averageSpeed: number | null;
    isLoop: boolean;
    start: { lat: number; lng: number };
    finish: { lat: number; lng: number };
  };
  bbox: [[number, number], [number, number]];
  latlng: [number, number][];
  stops: number[];
  ways: PosterWays;
  namedWays: NamedWay[];
  namedAreas: NamedArea[];
  pois: PosterPoi[];
  stats: FormattedStat[];
  warnings: string[];
  featureIds: string[];
};

export type PosterSpec = {
  style: {
    name: string;
    medium: string;
    palette: string[];
    typography: string;
    texture: string;
    references: string;
  };
  composition: {
    aspectRatio: string;
    routePlacement: string;
    titleBlock: string;
    border: string;
    decorations: string[];
  };
  route: {
    treatment: string;
    color: string;
    startMarker: string;
    finishMarker: string;
    startName?: string;
    finishName?: string;
    shapeNotes: string;
  };
  geography: Array<{ kind: string; name: string; placement: string; treatment: string; color?: string; letter?: string }>;
  landmarks: Array<{ name: string; kind: string; placement: string; icon: string; pin?: number }>;
  text: {
    title: string;
    subtitle: string;
    stats: Array<{ label: string; value: string }>;
    rules: string;
  };
  grounding: {
    images: Array<{ index: number; role: string; legend: string }>;
    rules: string[];
  };
  negative: string[];
  finalPrompt: string;
};

export type PosterRecord = {
  posterId: string;
  activityId: number;
  title: string;
  subtitle: string;
  spec: PosterSpec;
  prompt: string;
  model: string;
  modelName?: string;
  batchId?: string;
  aspectRatio: string;
  cost: number | null;
  durationMs?: number;
  createdAt: string;
  previousPosterId?: string;
  refineNotes?: string;
  featureIds: string[];
  labels: string[];
  stats: Array<{ label: string; value: string }>;
  styleId: string;
  stylePrompt: string;
  referenceCount: number;
  url: string;
};

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: T & { error?: string };
  try {
    body = JSON.parse(text) as T & { error?: string };
  } catch {
    throw new Error(
      response.ok ? "Server returned an invalid response" : `Request failed (${response.status})`,
    );
  }
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

export async function fetchStatus(): Promise<StatusPayload> {
  return readJson(await fetch("/api/status"));
}

export async function fetchActivities(): Promise<ActivitySummary[]> {
  const body = await readJson<{ activities: ActivitySummary[] }>(await fetch("/api/activities"));
  return body.activities;
}

export async function fetchActivityTrack(id: number): Promise<{
  activity: ActivitySummary;
  latlng: [number, number][];
  track: FeatureCollection<LineString>;
}> {
  return readJson(await fetch(`/api/activities/${id}`));
}

export async function syncStrava(): Promise<SyncProgress> {
  const response = await fetch("/api/strava/sync", { method: "POST" });
  const body = (await response.json()) as SyncProgress & { error?: string };
  if (!response.ok && !body.rateLimited) throw new Error(body.error ?? "Sync failed");
  return body;
}

export async function fetchFeatures(): Promise<FeatureOption[]> {
  const body = await readJson<{ features: FeatureOption[] }>(await fetch("/api/features"));
  return body.features;
}

export async function fetchPosterContext(activityId: number, featureIds: string[]): Promise<PosterContext> {
  const qs = featureIds.length ? `?features=${encodeURIComponent(featureIds.join(","))}` : "";
  return readJson(await fetch(`/api/poster/context/${activityId}${qs}`));
}

export async function lookupPosterLandmark(body: {
  query: string;
  activityId: number;
  bbox?: [[number, number], [number, number]];
  latlng?: [number, number][];
}) {
  return readJson<{
    query: string;
    candidates: PosterPoi[];
    picked: PosterPoi | null;
    warnings: string[];
  }>(
    await fetch("/api/poster/landmark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function planPoster(body: unknown): Promise<{ spec: PosterSpec; cost: number | null }> {
  return readJson(
    await fetch("/api/poster/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function generatePoster(body: unknown): Promise<PosterRecord> {
  return readJson(
    await fetch("/api/poster/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function fetchPosters(activityId?: number): Promise<PosterRecord[]> {
  const qs = activityId != null ? `?activityId=${activityId}` : "";
  const body = await readJson<{ posters: PosterRecord[] }>(await fetch(`/api/posters${qs}`));
  return body.posters ?? [];
}

export async function fetchPoster(id: string): Promise<PosterRecord> {
  return readJson(await fetch(`/api/posters/${id}`));
}

export async function deletePoster(id: string): Promise<void> {
  await readJson(await fetch(`/api/posters/${id}`, { method: "DELETE" }));
}

export type ImageModelOption = {
  id: string;
  name: string;
  maxReferences: number;
};

export type PosterCapabilities = {
  defaultModel: string;
  maxReferences: number;
  models: ImageModelOption[];
};

export async function fetchPosterCapabilities(): Promise<PosterCapabilities> {
  try {
    const body = await readJson<Partial<PosterCapabilities>>(await fetch("/api/poster/capabilities"));
    return {
      defaultModel: body.defaultModel || "",
      maxReferences: body.maxReferences || 3,
      models: Array.isArray(body.models) ? body.models : [],
    };
  } catch {
    return { defaultModel: "", maxReferences: 3, models: [] };
  }
}

export async function fetchMaxReferences(model?: string): Promise<number> {
  try {
    const qs = model ? `?model=${encodeURIComponent(model)}` : "";
    const body = await readJson<{ maxReferences: number }>(await fetch(`/api/poster/capabilities${qs}`));
    return body.maxReferences || 3;
  } catch {
    return 3;
  }
}

export function formatKm(meters: number) {
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  return `${m} min`;
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
