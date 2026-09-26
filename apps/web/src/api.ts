import { noteArrivedPosters } from "./gallery/arrivedPosters";
import { trackGeneration, type GenerationTask } from "./gallery/generationState";
import type { FeatureCollection, LineString } from "geojson";
import { coalesceRequests } from "./inFlight";

export type ActivityOrigin = "upload" | "archive";
export type ActivityFormat = "gpx" | "fit" | "tcx";

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
  origin: ActivityOrigin;
  format: ActivityFormat;
  imported: boolean;
};

export type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
};

export class AuthRequiredError extends Error {
  constructor() {
    super("sign in required");
    this.name = "AuthRequiredError";
  }
}

export type FeatureOption = {
  id: string;
  label: string;
  group: "geography" | "landmarks";
  defaultOn: boolean;
  nearRouteM?: number;
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
  source?: "osm" | "user";
  colorName?: string;
  color?: string;
  /** Inclusive GPS-stream indexes for user-defined route sections. */
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
  corridor?: {
    meters: number;
    minM: number;
    maxM: number;
  };
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
  userId?: string;
  activityId: number;
  title: string;
  subtitle: string;
  spec?: PosterSpec;
  prompt?: string;
  model: string;
  modelName?: string;
  batchId?: string;
  aspectRatio: string;
  /** Image quality setting when the model supports it. */
  quality?: string;
  cost: number | null;
  promptCost?: number | null;
  /** Chat model that wrote the image prompt (planner / refine). */
  promptModel?: string;
  durationMs?: number;
  createdAt: string;
  previousPosterId?: string;
  refineNotes?: string;
  featureIds?: string[];
  labels?: string[];
  stats?: Array<{ label: string; value: string }>;
  styleId: string;
  styleName?: string;
  stylePrompt?: string;
  paletteId?: string;
  referenceCount: number;
  variant?: number;
  url: string;
  thumbUrl?: string;
  /** Inline WebP from the generate response. Session-only; the list endpoint does not send it. */
  thumbDataUrl?: string;
  favorited?: boolean;
  editor?: PosterEditorSnapshot;
};

export type PosterEditorSnapshot = {
  featureIds: string[];
  labels: string[];
  trailNames: string[];
  trailAliases: Record<string, string>;
  areaNames: string[];
  customPois: PosterPoi[];
  customWays: NamedWay[];
  cropStart: number;
  cropEnd: number;
  showRouteMarkers: boolean;
  routeOnly: boolean;
  title: string;
  startPlace: string;
  finishPlace: string;
  placesEdited: boolean;
  statIds: string[];
  aspectRatio: string;
  styleIds: string[];
  stylePrompt: string;
  vibes?: string;
  paletteId: string;
  paletteIdsByStyle: Record<string, string[]>;
  imageModelIds: string[];
  variants: number;
  qualities?: string[];
  specs?: Partial<Record<string, PosterSpec>>;
  planCosts?: Partial<Record<string, number | null>>;
  landmarkNearM?: Record<string, number>;
};

function apiFetch(input: string, init?: RequestInit) {
  return fetch(input, { ...init, credentials: "include" });
}

async function readJson<T>(response: Response): Promise<T> {
  if (response.status === 401) throw new AuthRequiredError();
  const text = await response.text();
  let body: T & { error?: string; message?: string };
  try {
    body = JSON.parse(text) as T & { error?: string; message?: string };
  } catch {
    throw new Error(
      response.ok ? "Server returned an invalid response" : `Request failed (${response.status})`,
    );
  }
  if (!response.ok) {
    throw new Error(body.error ?? body.message ?? `Request failed (${response.status})`);
  }
  return body;
}

export async function fetchSession(): Promise<SessionUser | null> {
  const response = await apiFetch("/api/auth/get-session");
  if (!response.ok) return null;
  const body = (await response.json()) as { user?: SessionUser } | null;
  if (!body?.user?.id || !body.user.email) return null;
  return { id: body.user.id, email: body.user.email, name: body.user.name };
}

export async function requestMagicLink(email: string) {
  return readJson<{ status: boolean }>(
    await apiFetch("/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, callbackURL: "/" }),
    }),
  );
}

export async function signOut() {
  await apiFetch("/api/auth/sign-out", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export async function fetchActivities(): Promise<ActivitySummary[]> {
  const body = await readJson<{ activities: ActivitySummary[] }>(await apiFetch("/api/activities"));
  return body.activities;
}

export type ImportFailure = { filename: string; error: string };

export class ImportRequestError extends Error {
  readonly failures: ImportFailure[];
  readonly skipped: number;

  constructor(message: string, failures: ImportFailure[] = [], skipped = 0) {
    super(message);
    this.name = "ImportRequestError";
    this.failures = failures;
    this.skipped = skipped;
  }
}

export async function importActivityFiles(files: File[] | FileList): Promise<{
  activities: ActivitySummary[];
  errors: ImportFailure[];
  skipped: number;
}> {
  const form = new FormData();
  for (const file of Array.from(files)) form.append("file", file);
  const response = await apiFetch("/api/activities/import", { method: "POST", body: form });
  if (response.status === 401) throw new AuthRequiredError();
  const text = await response.text();
  let body: {
    activities?: ActivitySummary[];
    errors?: ImportFailure[];
    skipped?: number;
    error?: string;
    message?: string;
  };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    throw new Error(
      response.ok ? "Server returned an invalid response" : `Request failed (${response.status})`,
    );
  }
  const errors = body.errors ?? [];
  const skipped = body.skipped ?? 0;
  if (!response.ok) {
    throw new ImportRequestError(body.error ?? body.message ?? `Request failed (${response.status})`, errors, skipped);
  }
  return {
    activities: body.activities ?? [],
    errors,
    skipped,
  };
}

export async function removeActivities(ids: number[]): Promise<{
  deleted: ActivitySummary[];
  skipped: number;
}> {
  return readJson(
    await apiFetch("/api/activities/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }),
  );
}

export async function fetchActivityTrack(id: number): Promise<{
  activity: ActivitySummary;
  latlng: [number, number][];
  track: FeatureCollection<LineString>;
}> {
  return readJson(await apiFetch(`/api/activities/${id}`));
}

export async function fetchFeatures(): Promise<FeatureOption[]> {
  const body = await readJson<{ features: FeatureOption[] }>(await apiFetch("/api/features"));
  return body.features;
}

const loadPosterContext = coalesceRequests(async (url: string): Promise<PosterContext> => {
  const start = performance.now();
  const response = await apiFetch(url);
  const received = performance.now();
  const context = await readJson<PosterContext>(response);
  performance.clearMeasures("schematic.context.fetch");
  performance.clearMeasures("schematic.context.body-and-parse");
  performance.measure("schematic.context.fetch", { start, end: received });
  performance.measure("schematic.context.body-and-parse", { start: received, end: performance.now() });
  return context;
});

export async function fetchPosterContext(
  activityId: number,
  featureIds: string[],
  featureQuery?: string,
): Promise<PosterContext> {
  const encoded = featureQuery ?? featureIds.join(",");
  const qs = encoded ? `?features=${encodeURIComponent(encoded)}` : "";
  return loadPosterContext(`/api/poster/context/${activityId}${qs}`);
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
    await apiFetch("/api/poster/landmark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function planPoster(body: unknown): Promise<{ spec: PosterSpec; cost: number | null; model: string }> {
  return readJson(
    await apiFetch("/api/poster/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function generatePoster(
  body: unknown,
  pendingCount?: number,
  prepareReferences?: () => Promise<string[]>,
  task?: GenerationTask,
): Promise<PosterRecord[]> {
  const details = body as { spec?: PosterSpec; model?: string; styleId?: string; variants?: number };
  return trackGeneration({ ...details, variants: pendingCount ?? details.variants, title: details.spec?.text.title || "New image" }, async () => {
    // Register placeholders before preparing references; preparation also runs in the background.
    const requestBody = prepareReferences
      ? { ...details, references: await prepareReferences() }
      : body;
    const payload = await readJson<{ posters?: PosterRecord[] } & Partial<PosterRecord>>(
      await apiFetch("/api/poster/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      }),
    );
    const records = Array.isArray(payload.posters) && payload.posters.length
      ? payload.posters
      : payload.posterId
        ? [payload as PosterRecord]
        : [];
    if (!records.length) throw new Error("Image generation returned no images");
    noteArrivedPosters(records);
    return records;
  }, task);
}

export async function modifyPoster(body: {
  posterId: string;
  request: string;
  variants?: number;
  model?: string;
}): Promise<PosterRecord[]> {
  return trackGeneration({ ...body, title: "Refining image" }, async () => {
    const payload = await readJson<{ posters?: PosterRecord[] }>(
      await apiFetch("/api/poster/modify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    const records = payload.posters ?? [];
    noteArrivedPosters(records);
    return records;
  });
}

export async function fetchPosters(activityId?: number): Promise<PosterRecord[]> {
  const qs = activityId != null ? `?activityId=${activityId}` : "";
  const body = await readJson<{ posters: PosterRecord[] }>(await apiFetch(`/api/posters${qs}`));
  return body.posters ?? [];
}

export async function fetchPoster(id: string): Promise<PosterRecord> {
  return readJson(await apiFetch(`/api/posters/${id}`));
}

export async function deletePoster(id: string): Promise<void> {
  await readJson(await apiFetch(`/api/posters/${id}`, { method: "DELETE" }));
}

export async function setPosterFavorite(id: string, favorited: boolean): Promise<PosterRecord> {
  return readJson(
    await apiFetch(`/api/posters/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorited }),
    }),
  );
}

export type ImageModelOption = {
  id: string;
  name: string;
  maxReferences: number;
  maxImages?: number;
  qualities?: string[];
};

export type PosterCapabilities = {
  defaultModel: string;
  maxReferences: number;
  models: ImageModelOption[];
};

export async function fetchPosterCapabilities(): Promise<PosterCapabilities> {
  try {
    const body = await readJson<Partial<PosterCapabilities>>(await apiFetch("/api/poster/capabilities"));
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
    const body = await readJson<{ maxReferences: number }>(await apiFetch(`/api/poster/capabilities${qs}`));
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
