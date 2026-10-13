import { readImportEvents, type ImportProgress, type ImportStatus } from "./importProgress";
import type { GeographyScene } from "../../api/src/osm/geographyPolicy";
import { noteArrivedPosters } from "./gallery/arrivedPosters";
import { beginGeneration, setServerGenerationJobs, mergeServerGenerationJobs, type ServerGenerationJob } from "./gallery/generationState";
import type { FeatureCollection, LineString } from "geojson";
import { coalesceRequests, shareRecentRequests } from "./inFlight";
import { loadPosterPages, type PosterPage } from "./gallery/posterPages";

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
  image?: string | null;
  betaStatus?: "admitted" | "waiting";
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
  routeBreaks: number[];
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
  promptTemplateVersion?: 1;
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
  basePrompt?: string;
  editRequests?: string[];
  model: string;
  modelName?: string;
  batchId?: string;
  aspectRatio: string;
  /** Image quality setting when the model supports it. */
  quality?: string;
  cost: number | null;
  promptCost?: number | null;
  /** Legacy chat model that wrote the image prompt. */
  promptModel?: string;
  durationMs?: number;
  createdAt: string;
  previousPosterId?: string;
  refineNotes?: string;
  annotationUrl?: string;
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
  geographyMode?: "auto" | "manual";
  routeDetail?: boolean;
  detailScope?: "none" | "route" | "all";
  geographyPolicyVersion?: number;
  geographySceneId?: string;
  geographyFrameKey?: string;
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
  location?: string | null;
  locationMode?: "place" | "coordinates";
  dateOverride?: string | null;
  sportOverride?: string | null;
  distanceOverrideMeters?: number | null;
  startPlace: string;
  finishPlace: string;
  placesEdited: boolean;
  sharedPlace?: boolean | null;
  statIds: string[];
  statUnits?: "metric" | "imperial";
  aspectRatio: string;
  styleIds: string[];
  stylePrompt: string;
  vibes?: string;
  /** Optional names of the people who did the activity, printed on the image. */
  people?: string;
  peopleEnabled?: boolean;
  paletteId: string;
  paletteIdsByStyle: Record<string, string[]>;
  imageModelIds: string[];
  variants: number;
  qualities?: string[];
  specs?: Partial<Record<string, PosterSpec>>;
  planCosts?: Partial<Record<string, number | null>>;
  landmarkNearM?: Record<string, number>;
};

async function apiFetch(input: string, init?: RequestInit) {
  const response = await fetch(input, { ...init, credentials: "include" });
  if (response.status === 403) {
    const body = await response.clone().json().catch(() => null);
    if (body?.code === "PARTICIPATION_REQUIRED") window.dispatchEvent(new Event("participation-required"));
  }
  return response;
}

async function readJson<T>(response: Response, onBody?: (body: string) => void): Promise<T> {
  if (response.status === 401) throw new AuthRequiredError();
  const text = await response.text();
  onBody?.(text);
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

export async function submitFeedback(message: string): Promise<void> {
  await readJson(await apiFetch("/api/feedback", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  }));
}

export async function fetchSession(): Promise<SessionUser | null> {
  const response = await apiFetch("/api/auth/get-session");
  if (!response.ok) return null;
  const body = (await response.json()) as { user?: SessionUser } | null;
  if (!body?.user?.id || !body.user.email) return null;
  const beta = await readJson<{ status: "admitted" | "waiting" }>(await apiFetch("/api/beta"));
  return { id: body.user.id, email: body.user.email, name: body.user.name, image: body.user.image, betaStatus: beta.status };
}

export class SignInError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

async function authPost(path: string, body: Record<string, unknown>) {
  const response = await apiFetch(`/api/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: { message?: string; code?: string; url?: string };
  try {
    data = await response.json();
  } catch {
    throw new SignInError("Sign-in is temporarily unavailable. Please try again.");
  }
  if (!response.ok) throw new SignInError(data.message ?? "Could not complete sign-in. Please try again.", data.code);
  return data;
}

export async function fetchAuthConfig(): Promise<{ google: boolean }> {
  return readJson(await apiFetch("/api/auth/config"));
}

export function signInEmail(email: string, password: string) {
  return authPost("sign-in/email", { email, password, callbackURL: "/", rememberMe: true });
}

export function signUpEmail(name: string, email: string, password: string) {
  return authPost("sign-up/email", { name, email, password, callbackURL: "/" });
}

export async function signInGoogle() {
  const data = await authPost("sign-in/social", { provider: "google", callbackURL: "/", errorCallbackURL: "/?error=google_sign_in" });
  if (!data.url) throw new Error("Could not start Google sign-in. Please try again.");
  window.location.assign(data.url);
}

export function requestPasswordReset(email: string) {
  return authPost("request-password-reset", { email, redirectTo: `${window.location.origin}/reset-password` });
}

export function resetPassword(token: string, newPassword: string) {
  return authPost("reset-password", { token, newPassword });
}

export function resendVerification(email: string) {
  return authPost("send-verification-email", { email, callbackURL: "/" });
}

export async function updateAccountName(name: string): Promise<string> {
  const normalized = name.replace(/\s+/g, " ").trim();
  if (normalized.length > 40) throw new Error("Name must be 40 characters or fewer.");
  await readJson<{ status: boolean }>(
    await apiFetch("/api/auth/update-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: normalized }),
    }),
  );
  return normalized;
}

export async function deleteAccount(email: string) {
  await readJson(await apiFetch("/api/account", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  }));
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

export type PosterQuota = {
  imageLimits: { active: number | null; unfinished: number | null; selections: number | null };
  limit: number | null;
  used: number;
  reserved: number;
  remaining: number | null;
  resetsAt: string;
};

export async function fetchPosterQuota(): Promise<PosterQuota> {
  return readJson(await apiFetch("/api/poster/quota"));
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

export async function importActivityFiles(
  files: File[] | FileList,
  onProgress?: (status: ImportStatus) => void,
): Promise<{
  activities: ActivitySummary[];
  errors: ImportFailure[];
  skipped: number;
}> {
  const form = new FormData();
  for (const file of Array.from(files)) form.append("file", file);
  onProgress?.({ phase: "preparing" });
  const response = await apiFetch("/api/activities/import", {
    method: "POST", body: form, headers: { Accept: "application/x-ndjson" },
  });
  if (response.status === 401) throw new AuthRequiredError();
  if (response.ok && response.headers.get("Content-Type")?.includes("application/x-ndjson")) {
    if (!response.body) throw new Error("Import response was empty");
    for await (const value of readImportEvents(response.body)) {
      const event = value as ImportProgress & {
        type: "preparing" | "progress" | "result" | "error";
        activities?: ActivitySummary[]; errors?: ImportFailure[]; error?: string;
      };
      if (event.type === "preparing") onProgress?.({ phase: "preparing" });
      if (event.type === "progress") onProgress?.({ phase: "importing", progress: event });
      if (event.type === "error") {
        throw new ImportRequestError(event.error ?? "Import failed", event.errors ?? [], event.skipped ?? 0);
      }
      if (event.type === "result") {
        return { activities: event.activities ?? [], errors: event.errors ?? [], skipped: event.skipped ?? 0 };
      }
    }
    throw new Error("Import connection ended before completion. Refresh your activities before retrying.");
  }
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
  routeBreaks: number[];
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

export async function fetchPosterLocation(activityId: number, start: number, end: number): Promise<{ location: string; resolved: boolean }> {
  return readJson(await apiFetch(`/api/poster/location/${activityId}?start=${start}&end=${end}`));
}

export async function fetchPosterContext(
  activityId: number,
  featureIds: string[],
  featureQuery?: string,
): Promise<PosterContext> {
  const encoded = featureQuery ?? featureIds.join(",");
  const qs = `?geography=auto&features=${encodeURIComponent(encoded)}`;
  return loadPosterContext(`/api/poster/context/${activityId}${qs}`);
}

const loadPosterGeography = coalesceRequests(async (url: string) =>
  readJson<GeographyScene>(await apiFetch(url)));
export function fetchPosterGeography(activityId: number, bbox: number[], aspect: string, mode: "auto" | "manual", sceneId?: string, options?: { layers?: string[]; baseSceneId?: string }) {
  const query = new URLSearchParams({ bbox: JSON.stringify(bbox), aspect, mode });
  if (sceneId) query.set("scene", sceneId);
  if (options?.layers) query.set("layers", options.layers.join(","));
  if (options?.baseSceneId) query.set("base", options.baseSceneId);
  return loadPosterGeography(`/api/poster/geography/${activityId}?${query}`);
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

export async function uploadPosterReferences(references: string[]): Promise<{ referenceBatchId: string; expiresAt: number }> {
  return readJson(await apiFetch("/api/poster/references", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ references }),
  }));
}

export async function planPoster(body: unknown): Promise<{ spec: PosterSpec; cost: number | null; model?: string }> {
  return readJson(
    await apiFetch("/api/poster/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function submitSavedPosterJob(kind: "modify" | "variant", body: {
  posterId: string; model?: string; title?: string; activityId?: number; styleId?: string; paletteId?: string; variants?: number;
  request?: string; annotation?: Array<Array<{ x: number; y: number }>>;
}): Promise<void> {
  const requestBody = structuredClone({ ...body, submissionId: crypto.randomUUID() });
  const task = beginGeneration({ ...body, previousPosterId: body.posterId, variants: kind === "variant" ? 1 : body.variants,
    title: body.title || (kind === "modify" ? "Refining image" : "New variant") });
  const submit = async () => {
    const { jobs } = await readJson<{ jobs: ServerGenerationJob[] }>(await apiFetch(`/api/poster/${kind}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody),
    }));
    mergeServerGenerationJobs(jobs, retryPosterJob, dismissPosterJob);
    task.dismiss();
  };
  task.setRetry(submit);
  try { await submit(); }
  catch (error) { task.finish(error); throw error; }
}

export async function variantPoster(body: {
  posterId: string; model?: string; title?: string; activityId?: number; styleId?: string; paletteId?: string;
}): Promise<void> {
  await submitSavedPosterJob("variant", body);
}

export async function modifyPoster(body: {
  posterId: string; request: string; activityId?: number; title?: string; styleId?: string; paletteId?: string;
  variants?: number; model?: string; annotation?: Array<Array<{ x: number; y: number }>>;
}): Promise<void> {
  await submitSavedPosterJob("modify", body);
}

async function fetchPosterList(qs: string): Promise<PosterRecord[]> {
  const body = await readJson<{ posters: PosterRecord[] }>(await apiFetch(`/api/posters${qs}`));
  return body.posters ?? [];
}

function isTransientFetchError(err: unknown) {
  return err instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(err.message);
}

/** Dev StrictMode mounts the gallery twice a few milliseconds apart and would otherwise list twice. */
const loadRecentPosterList = shareRecentRequests(100, async (qs: string) => {
  try {
    return await fetchPosterList(qs);
  } catch (err) {
    if (!isTransientFetchError(err)) throw err;
    return fetchPosterList(qs);
  }
});

export function fetchPosters(activityId?: number): Promise<PosterRecord[]> {
  const qs = activityId != null ? `?activityId=${activityId}` : "";
  return loadRecentPosterList(qs);
}

const loadRecentGalleryList = shareRecentRequests(100, async (_key: string, publish: (posters: PosterRecord[]) => void) => {
  return loadPosterPages(async before => {
    const url = `/api/posters/page${before ? `?before=${encodeURIComponent(before)}` : ""}`;
    try {
      return await readJson<PosterPage>(await apiFetch(url));
    } catch (error) {
      if (!isTransientFetchError(error)) throw error;
      return readJson<PosterPage>(await apiFetch(url));
    }
  }, publish);
});

export function fetchGalleryPosters(onProgress: (posters: PosterRecord[]) => void) {
  return loadRecentGalleryList("gallery", onProgress);
}

export async function fetchPoster(id: string): Promise<PosterRecord> {
  return readJson(await apiFetch(`/api/posters/${id}`));
}

export async function deletePoster(id: string): Promise<void> {
  await readJson(await apiFetch(`/api/posters/${id}`, { method: "DELETE" }));
}

export async function fetchPosterImage(id: string): Promise<Uint8Array> {
  const response = await apiFetch(`/api/posters/${id}/image.png`);
  if (!response.ok) await readJson(response);
  return new Uint8Array(await response.arrayBuffer());
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


async function dismissPosterJob(id: string) {
  await readJson(await apiFetch(`/api/poster/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }));
}
async function retryPosterJob(id: string) {
  const { jobs } = await readJson<{ jobs: ServerGenerationJob[] }>(await apiFetch(`/api/poster/jobs/${encodeURIComponent(id)}/retry`, { method: "POST" }));
  mergeServerGenerationJobs(jobs, retryPosterJob, dismissPosterJob);
}
export async function submitPosterBatch(body: { submissionId: string; jobs: { plan: unknown; generate: unknown }[] }) {
  const { jobs } = await readJson<{ jobs: ServerGenerationJob[] }>(await apiFetch("/api/poster/jobs", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  mergeServerGenerationJobs(jobs, retryPosterJob, dismissPosterJob);
}
export function pollPosterJobs(onError: (error: unknown) => void) {
  let stopped = false;
  let pendingJobIds = new Set<string>();
  let timer: ReturnType<typeof setTimeout>;
  const poll = async () => {
    try {
      const { jobs } = await readJson<{ jobs: ServerGenerationJob[] }>(await apiFetch("/api/poster/jobs"));
      const nextPending = new Set(jobs.filter(job => job.state === "queued" || job.state === "generating").map(job => job.id));
      // Publish completed images before removing their placeholders.
      if ([...pendingJobIds].some(id => !nextPending.has(id) && !jobs.some(job => job.id === id && job.state === "failed"))) {
        const posters = await fetchPosters();
        if (!stopped) noteArrivedPosters(posters);
      }
      if (!stopped) {
        setServerGenerationJobs(jobs, retryPosterJob, dismissPosterJob);
        pendingJobIds = nextPending;
      }
    } catch (error) { if (!stopped) onError(error); }
    finally { if (!stopped) timer = setTimeout(poll, 3000); }
  };
  void poll();
  return () => { stopped = true; clearTimeout(timer); };
}
