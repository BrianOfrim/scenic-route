import { JobConflictError } from "./durableJobs";
import { backfillPosterIndex } from "./publication";
import { getImageLimits } from "./imageLimits";
import { participationStatus, recordParticipation, ParticipationError, assertParticipation, authRecoveryPath } from "./participation";
import { startGenerationWorker, submitGenerationJobs, submitSavedGenerationJob, listGenerationJobs, retryGenerationJob, dismissGenerationJob } from "./generationJobs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "dotenv";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { createFeedbackHandler } from "./feedback";
import { purgeAccount, validateAccountDeletion } from "./accountDeletion";
import { AccountUnavailableError, withAccountAccess } from "./accountLifecycle";
import { authBaseUrl, getSessionUser, getAuth, googleSignInEnabled, createRequireUser, type SessionLookup, type AuthUser } from "./auth";
import { LLM_TRACES_DIR, REPO_ROOT, isSafePosterId } from "./paths";
import { posterStore } from "./storage";

config({ path: path.join(REPO_ROOT, ".env.local") });
config({ path: path.join(REPO_ROOT, ".env") });

import {
  activityToFeatureCollection,
  deleteImportedByIds,
  getActivity,
  listActivities,
  listSportTypes,
  toActivitySummary,
  parseNumberArray,
  parseLatLng,
} from "./activities";
import { databaseUrlSource, initDb, queryOne } from "./db";
import { sealImportedIdFloors } from "./importedIds";
import { purgeLegacyApiData } from "./fileFirstMigration";
import { sniffImageMime } from "./imageMime";
import { createImportHandler } from "./importEndpoint";
import { catalogPublic, parseFeatureSelection } from "./osm/catalog";
import { extendGeography, loadGeography, parseGeographyBbox } from "./osm/geography";
import { GEOGRAPHY_BUCKETS } from "./osm/geographyPolicy";
import { loadRouteFeatures } from "./osm/features";
import { reverseLocation } from "./osm/location";
import { lookupLandmark } from "./osm/landmark";
import { OpenRouterError, imageModel, listImageModels, maxImageReferences } from "./openrouter";
import { planPoster } from "./planner";
import { RequestQueueError } from "./requestQueue";
import { ReferenceUploadError, uploadReferences } from "./referenceUploads";
import { getPosterQuota, PosterQuotaError } from "./posterQuota";
import {
  PosterError,
  deletePoster,
  listPosters,
  listPosterPage,
  readPosterPng,
  readPosterRecord,
  readPosterRef,
  readPosterAnnotation,
  readPosterThumb,
  setPosterFavorite,
} from "./poster";
import { tileHandler } from "./tileRoute";

const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5174";
const PORT = Number(process.env.PORT ?? 8790);

type AppEnv = {
  Variables: {
    user: AuthUser;
  };
};

export function createApiApp(lookup?: SessionLookup) {
const app = new Hono<AppEnv>();
app.use("*", async (c, next) => {
  c.header("Referrer-Policy", "origin");
  if (c.req.path.startsWith("/api/tiles/")) c.header("Cache-Control", "no-store");
  await next();
});

app.use(
  "*",
  cors({
    origin: WEB_ORIGIN,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  }),
);

app.get("/api/auth/config", (c) => c.json({ google: googleSignInEnabled() }));

app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const auth = await getAuth();
  let user = await getSessionUser(c.req.raw.headers);
  // Password-reset tokens are stored without a user foreign key. Hold account
  // access even for anonymous reset requests so they cannot outlive a purge.
  if (!user && c.req.path === "/api/auth/request-password-reset" && c.req.method === "POST") {
    const body = await c.req.raw.clone().json().catch(() => null);
    if (typeof body?.email === "string") {
      user = await queryOne<AuthUser>('SELECT id, email FROM "user" WHERE lower(email) = lower($1)', [body.email]) ?? null;
    }
  }
  if (!user) return auth.handler(c.req.raw);
  try {
    return await withAccountAccess(user.id, false, async () => {
      if (!authRecoveryPath(c.req.path)) assertParticipation(await participationStatus(user!.id));
      return auth.handler(c.req.raw);
    }, true);
  } catch (error) {
    if (error instanceof AccountUnavailableError) return c.json({ error: error.message }, error.status);
    if (error instanceof ParticipationError) return c.json({ error: error.message, code: error.code }, 403);
    throw error;
  }
});

app.use("/api/*", createRequireUser(lookup));

app.post("/api/feedback", bodyLimit({ maxSize: 32 * 1024,
  onError: c => c.json({ error: "Your feedback message is too large." }, 413),
}), createFeedbackHandler());

function currentUserId(c: Context<AppEnv>) {
  return c.get("user").id;
}

app.get("/api/participation", async c => c.json(await participationStatus(currentUserId(c))));
app.post("/api/participation", async c => {
  if (c.req.header("Origin") !== WEB_ORIGIN) return c.json({ error: "Invalid origin" }, 403);
  try { return c.json(await recordParticipation(currentUserId(c), await c.req.json())); }
  catch (error) { return fail(c, error); }
});

app.delete("/api/account", async c => {
  const user = c.get("user");
  let body: { email?: unknown };
  try { body = await c.req.json(); }
  catch { return c.json({ error: "Enter your account email to confirm deletion." }, 400); }
  const validation = validateAccountDeletion(c.req.header("Origin"), [WEB_ORIGIN, new URL(authBaseUrl()).origin], body?.email, user.email);
  if (validation) return c.json({ error: validation }, validation.includes("origin") ? 403 : 400);
  try {
    await purgeAccount(user);
  } catch (error) {
    if (error instanceof AccountUnavailableError) return c.json({ error: error.message }, error.status);
    console.error("account deletion failed", error instanceof Error ? error.message : "unknown error");
    return c.json({ error: "Could not finish deleting your account. Please retry to complete the purge." }, 503);
  }
  // Sign-out expires Better Auth's session cookies even after the session row is removed.
  const auth = await getAuth();
  const response = await auth.handler(new Request(new URL("/api/auth/sign-out", c.req.url), {
    method: "POST", headers: c.req.raw.headers, body: "{}",
  }));
  for (const cookie of response.headers.getSetCookie()) c.header("Set-Cookie", cookie, { append: true });
  return c.json({ ok: true });
});

app.get("/api/health", async (c) => {
  await initDb();
  return c.json({ ok: true });
});

app.get("/api/status", async (c) => {
  const user = c.get("user");
  return c.json({
    user: { id: user.id, email: user.email },
    openrouter: {
      configured: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
      chatModel: process.env.OPENROUTER_MODEL?.trim() || null,
      imageModel: process.env.OPENROUTER_IMAGE_MODEL?.trim() || null,
    },
  });
});

app.get("/api/poster/quota", async c => {
  try { return c.json({ ...await getPosterQuota(currentUserId(c)), imageLimits: await getImageLimits(currentUserId(c)) }); }
  catch (error) { return fail(c, error); }
});

app.get("/api/activities", async (c) => c.json({ activities: await listActivities(currentUserId(c)) }));

app.post("/api/activities/remove", async (c) => {
  try {
    const body = (await c.req.json()) as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.map((id) => Number(id)) : [];
    return c.json(await deleteImportedByIds(currentUserId(c), ids));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "remove failed" }, 400);
  }
});

app.post("/api/activities/import", createImportHandler());

app.get("/api/activities/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await getActivity(currentUserId(c), id);
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({
    activity: toActivitySummary(row),
    track: activityToFeatureCollection(row),
    latlng: row.latlng ? JSON.parse(row.latlng) : [],
    routeBreaks: parseNumberArray(row.route_breaks ?? null),
  });
});

app.get("/api/sports", async (c) => c.json({ sports: await listSportTypes(currentUserId(c)) }));
app.get("/api/features", (c) => c.json({ features: catalogPublic() }));

app.get("/api/poster/context/:activityId", async (c) => {
  try {
    const activityId = Number(c.req.param("activityId"));
    const parsed = parseFeatureSelection(c.req.query("features"));
    const timings: Record<string, number> = {};
    const context = await loadRouteFeatures(currentUserId(c), activityId, parsed.ids, parsed.nearRouteM, timings, c.req.query("geography") === "auto");
    const serializeStart = performance.now();
    const response = c.json(context);
    timings.serialize = performance.now() - serializeStart;
    response.headers.set("Server-Timing", Object.entries(timings).map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`).join(", "));
    return response;
  } catch (error) {
    return fail(c, error);
  }
});

app.get("/api/poster/location/:activityId", async (c) => {
  try {
    const activity = await getActivity(currentUserId(c), Number(c.req.param("activityId")));
    if (!activity) return c.json({ error: "not found" }, 404);
    const track = parseLatLng(activity.latlng);
    const start = Number(c.req.query("start") ?? 0);
    const end = Number(c.req.query("end") ?? track.length - 1);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= track.length) {
      return c.json({ error: "Invalid route crop" }, 400);
    }
    const [lat, lng] = track[Math.floor((start + end) / 2)];
    const location = await reverseLocation(lat, lng);
    return c.json({ location: location || `${lat.toFixed(3)}°, ${lng.toFixed(3)}°`, resolved: Boolean(location) });
  } catch (error) { return fail(c, error); }
});

app.get("/api/poster/geography/:activityId", async (c) => {
  try {
    const activityId = Number(c.req.param("activityId"));
    if (!Number.isFinite(activityId) || activityId <= 0) return c.json({ error: "Invalid activity" }, 400);
    const activity = await getActivity(currentUserId(c), activityId);
    if (!activity) return c.json({ error: "not found" }, 404);
    let bbox;
    try { bbox = parseGeographyBbox(JSON.parse(c.req.query("bbox") ?? "null")); }
    catch { return c.json({ error: "Invalid geography frame" }, 400); }
    const features = c.req.query("layers");
    let scene;
    if (features !== undefined) {
      const ids = [...new Set(features.split(",").filter(Boolean))];
      if (ids.length > 18 || ids.some(id => !Object.hasOwn(GEOGRAPHY_BUCKETS, id) || id === "cemeteries")) return c.json({ error: "Invalid geography layers" }, 400);
      scene = await extendGeography(bbox, c.req.query("aspect") ?? "3:4", c.req.query("base"), ids);
    } else scene = await loadGeography(
      bbox, c.req.query("aspect") ?? "3:4",
      c.req.query("mode") === "manual" ? "manual" : "auto", c.req.query("scene"),
      { detailScope: "none" },
    );
    return c.json(scene);
  } catch (error) { return fail(c, error); }
});

app.post("/api/poster/landmark", async (c) => {
  try {
    return c.json(await lookupLandmark(currentUserId(c), await c.req.json()));
  } catch (error) {
    return fail(c, error);
  }
});

app.post("/api/poster/references", async (c) => {
  try {
    const body = await c.req.json();
    return c.json(await uploadReferences(currentUserId(c), body.references));
  } catch (error) {
    return fail(c, error);
  }
});

app.post("/api/poster/jobs", async c => {
  try { return c.json({ jobs: await submitGenerationJobs(currentUserId(c), await c.req.json()) }); }
  catch (error) { return fail(c,error); }
});
app.get("/api/poster/jobs", async c => {
  try { return c.json({ jobs: await listGenerationJobs(currentUserId(c)) }); }
  catch (error) { return fail(c,error); }
});
app.post("/api/poster/jobs/:id/retry", async c => {
  try { return c.json({ jobs: await retryGenerationJob(currentUserId(c),c.req.param("id")) }); }
  catch (error) { return fail(c,error); }
});
app.delete("/api/poster/jobs/:id", async c => {
  try { await dismissGenerationJob(currentUserId(c),c.req.param("id")); return c.json({ ok: true }); }
  catch (error) { return fail(c,error); }
});

app.post("/api/poster/plan", async (c) => {
  try {
    const body = await c.req.json();
    return c.json(await planPoster(currentUserId(c), body));
  } catch (error) {
    return fail(c, error);
  }
});

app.post("/api/poster/modify", async (c) => {
  try {
    return c.json({ jobs: await submitSavedGenerationJob(currentUserId(c), "modify", await c.req.json()) }, 202);
  } catch (error) {
    return fail(c, error);
  }
});

app.post("/api/poster/variant", async (c) => {
  try {
    return c.json({ jobs: await submitSavedGenerationJob(currentUserId(c), "variant", await c.req.json()) }, 202);
  } catch (error) {
    return fail(c, error);
  }
});

app.get("/api/poster/capabilities", async (c) => {
  const requested = c.req.query("model") || undefined;
  let fallback = "";
  try {
    fallback = imageModel();
  } catch (error) {
    if (error instanceof OpenRouterError) return c.json({ error: error.message }, error.status);
    throw error;
  }
  try {
    if (requested) {
      return c.json({
        defaultModel: fallback,
        maxReferences: await maxImageReferences(requested),
      });
    }
    const models = await listImageModels();
    const selected = models.find((item) => item.id === fallback);
    return c.json({
      defaultModel: fallback,
      maxReferences: selected?.maxReferences ?? (await maxImageReferences(fallback)),
      models,
    });
  } catch {
    return c.json({
      defaultModel: fallback,
      maxReferences: 3,
      models: [{ id: fallback, name: fallback, maxReferences: 3, maxImages: 1, qualities: [] }],
    });
  }
});

app.get("/api/posters", async (c) => {
  const raw = c.req.query("activityId");
  const activityId = raw != null && raw !== "" ? Number(raw) : undefined;
  if (activityId != null && !Number.isFinite(activityId)) {
    return c.json({ error: "activityId must be a number" }, 400);
  }
  return c.json({ posters: await listPosters(currentUserId(c), activityId) });
});

app.get("/api/posters/page", async (c) => {
  const before = c.req.query("before");
  if (before != null && !isSafePosterId(before)) return c.json({ error: "Invalid poster cursor" }, 400);
  c.header("Cache-Control", "private, no-store");
  return c.json(await listPosterPage(currentUserId(c), before));
});

app.get("/api/posters/:id", async (c) => {
  const record = await readPosterRecord(currentUserId(c), c.req.param("id"));
  if (!record) return c.json({ error: "not found" }, 404);
  return c.json(record);
});

app.get("/api/posters/:id/image.png", async (c) => {
  try {
    return png(await readPosterPng(currentUserId(c), c.req.param("id")));
  } catch (error) {
    return fail(c, error);
  }
});

app.get("/api/posters/:id/thumb.webp", async (c) => {
  try {
    return webp(await readPosterThumb(currentUserId(c), c.req.param("id")));
  } catch (error) {
    return fail(c, error);
  }
});

app.get("/api/posters/:id/annotation.png", async (c) => {
  try {
    return png(await readPosterAnnotation(currentUserId(c), c.req.param("id")));
  } catch (error) {
    return fail(c, error);
  }
});

app.get("/api/posters/:id/:reference{ref-[0-9]+(?:[.]png)?}", async (c) => {
  try {
    const index = Number(c.req.param("reference").replace(/^ref-/, "").replace(/\.png$/i, ""));
    return png(await readPosterRef(currentUserId(c), c.req.param("id"), index));
  } catch (error) {
    return fail(c, error);
  }
});

app.patch("/api/posters/:id", async (c) => {
  try {
    const id = c.req.param("id");
    if (!isSafePosterId(id)) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json()) as { favorited?: unknown };
    if (typeof body.favorited !== "boolean") {
      return c.json({ error: "favorited must be a boolean" }, 400);
    }
    return c.json(await setPosterFavorite(currentUserId(c), id, body.favorited));
  } catch (error) {
    return fail(c, error);
  }
});

app.delete("/api/posters/:id", async (c) => {
  try {
    const id = c.req.param("id");
    if (!isSafePosterId(id)) return c.json({ error: "not found" }, 404);
    await deletePoster(currentUserId(c), id);
    return c.json({ ok: true });
  } catch (error) {
    return fail(c, error);
  }
});

app.get("/api/tiles/:source/:z/:x/:y", tileHandler());

const WEB_DIST = path.join(REPO_ROOT, "apps/web/dist");
if (fs.existsSync(path.join(WEB_DIST, "index.html"))) {
  app.use("/*", serveStatic({ root: WEB_DIST }));
  app.get("*", (c) => c.html(fs.readFileSync(path.join(WEB_DIST, "index.html"), "utf8")));
}

function png(bytes: Buffer) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": sniffImageMime(bytes) || "image/png",
      "cache-control": "private, no-store",
    },
  });
}

function webp(bytes: Buffer) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "image/webp",
      "cache-control": "private, no-store",
    },
  });
}

function fail(c: Context, error: unknown) {
  if (error instanceof ParticipationError) return c.json({ error: error.message, code: error.code }, 403);
  if (error instanceof JobConflictError || error instanceof PosterError || error instanceof OpenRouterError || error instanceof ReferenceUploadError || error instanceof RequestQueueError || error instanceof PosterQuotaError) {
    return c.json({ error: error.message }, (error as { status: 400 | 401 | 403 | 404 | 409 | 429 | 502 | 503 | 504 }).status);
  }
  const message = error instanceof Error ? error.message : "request failed";
  const status = /not found|required|must be/i.test(message) ? 400 : 500;
  return c.json({ error: message }, status);
}

return app;
}

export async function startApi() {
const app = createApiApp();
try {
  await initDb();
  if (process.env.DB_MIGRATIONS !== "off") {
  await sealImportedIdFloors();
  const purge = await purgeLegacyApiData();
  if (purge.activities || purge.posters || purge.traces) {
    console.log(
      `file-first migration purged ${purge.activities} activities, ${purge.posters} posters, and ${purge.traces} traces`,
    );
  }
  }
  await backfillPosterIndex();
  process.env.POSTER_INDEX_ENABLED = "true";
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

if ((process.env.APP_ROLE || "combined") === "combined") startGenerationWorker();

serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, (info) => {
  console.log(`scenic-route api http://${info.address}:${info.port}`);
  console.log(`postgres: ${databaseUrlSource()}`);
  console.log(`posters: ${posterStore().kind}`);
  console.log(`llm traces: ${LLM_TRACES_DIR}`);
});

}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await startApi();
}
