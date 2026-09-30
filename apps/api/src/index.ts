import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { getAuth, requireUser, type AuthUser } from "./auth";
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
import { databaseUrlSource, initDb } from "./db";
import { sealImportedIdFloors } from "./importedIds";
import { purgeLegacyApiData } from "./fileFirstMigration";
import { ImportError } from "./gpx";
import { sniffImageMime } from "./imageMime";
import { importTrackFiles } from "./importActivity";
import { filesFromRequest } from "./importRequest";
import { catalogPublic, parseFeatureSelection } from "./osm/catalog";
import { loadGeography, parseGeographyBbox } from "./osm/geography";
import { loadRouteFeatures } from "./osm/features";
import { reverseLocation } from "./osm/location";
import { lookupLandmark } from "./osm/landmark";
import { OpenRouterError, imageModel, listImageModels, maxImageReferences } from "./openrouter";
import { planPoster } from "./planner";
import {
  PosterError,
  deletePoster,
  generatePoster,
  listPosters,
  modifyPoster,
  variantPoster,
  readPosterPng,
  readPosterRecord,
  readPosterRef,
  readPosterThumb,
  setPosterFavorite,
} from "./poster";
import { fetchTile, isTileSource } from "./tiles";

const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5174";
const PORT = Number(process.env.PORT ?? 8790);

type AppEnv = {
  Variables: {
    user: AuthUser;
  };
};

const app = new Hono<AppEnv>();

app.use(
  "*",
  cors({
    origin: WEB_ORIGIN,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  }),
);

app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const auth = await getAuth();
  return auth.handler(c.req.raw);
});

app.use("/api/*", requireUser);

function currentUserId(c: Context<AppEnv>) {
  return c.get("user").id;
}

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

app.post("/api/activities/import", async (c) => {
  try {
    const parsed = await filesFromRequest(c.req.raw);
    if (!parsed.files.length && !parsed.errors.length) {
      return c.json({ error: "Choose a GPX, FIT, TCX, or account export zip" }, 400);
    }
    const imported = parsed.files.length
      ? await importTrackFiles(currentUserId(c), parsed.files)
      : { activities: [], errors: [], skipped: 0 };
    const errors = [...parsed.errors, ...imported.errors];
    const result = { activities: imported.activities, errors, skipped: imported.skipped };
    if (!result.activities.length && !result.skipped) {
      const first = errors[0];
      return c.json(
        {
          error: first ? `${first.filename}: ${first.error}` : "Could not import file",
          errors,
          skipped: result.skipped,
        },
        400,
      );
    }
    return c.json(result);
  } catch (error) {
    if (error instanceof ImportError) return c.json({ error: error.message }, 400);
    return c.json({ error: error instanceof Error ? error.message : "import failed" }, 400);
  }
});

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
    return c.json(await loadGeography(
      bbox, c.req.query("aspect") ?? "3:4",
      c.req.query("mode") === "manual" ? "manual" : "auto", c.req.query("scene"),
      { detailScope: "none" },
    ));
  } catch (error) { return fail(c, error); }
});

app.post("/api/poster/landmark", async (c) => {
  try {
    return c.json(await lookupLandmark(currentUserId(c), await c.req.json()));
  } catch (error) {
    return fail(c, error);
  }
});

app.post("/api/poster/plan", async (c) => {
  try {
    const body = await c.req.json();
    return c.json(await planPoster(currentUserId(c), body));
  } catch (error) {
    return fail(c, error);
  }
});

app.post("/api/poster/generate", async (c) => {
  try {
    return c.json({ posters: await generatePoster(currentUserId(c), await c.req.json()) });
  } catch (error) {
    return fail(c, error);
  }
});

app.post("/api/poster/modify", async (c) => {
  try {
    return c.json({ posters: await modifyPoster(currentUserId(c), await c.req.json()) });
  } catch (error) {
    return fail(c, error);
  }
});

app.post("/api/poster/variant", async (c) => {
  try {
    return c.json({ posters: await variantPoster(currentUserId(c), await c.req.json()) });
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

app.get("/api/posters/:id/ref-:n", async (c) => {
  try {
    const index = Number(String(c.req.param("n")).replace(/\.png$/i, ""));
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

app.get("/api/tiles/:source/:z/:x/:y", async (c) => {
  const { source, z, x, y } = c.req.param();
  if (!isTileSource(source)) return c.json({ error: "unknown tile source" }, 404);
  try {
    const tile = await fetchTile(source, z, x, y.replace(/\.png$/, ""));
    return new Response(new Uint8Array(tile.bytes), {
      headers: {
        "content-type": tile.contentType,
        "cache-control": "public, max-age=86400",
      },
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "tile failed" }, 502);
  }
});

const WEB_DIST = path.join(REPO_ROOT, "apps/web/dist");
if (fs.existsSync(path.join(WEB_DIST, "index.html"))) {
  app.use("/*", serveStatic({ root: WEB_DIST }));
  app.get("*", (c) => c.html(fs.readFileSync(path.join(WEB_DIST, "index.html"), "utf8")));
}

function png(bytes: Buffer) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": sniffImageMime(bytes) || "image/png",
      "cache-control": "public, max-age=31536000",
    },
  });
}

function webp(bytes: Buffer) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "image/webp",
      "cache-control": "public, max-age=31536000",
    },
  });
}

function fail(c: Context, error: unknown) {
  if (error instanceof PosterError || error instanceof OpenRouterError) {
    return c.json({ error: error.message }, error.status);
  }
  const message = error instanceof Error ? error.message : "request failed";
  const status = /not found|required|must be/i.test(message) ? 400 : 500;
  return c.json({ error: message }, status);
}

try {
  await initDb();
  await sealImportedIdFloors();
  const purge = await purgeLegacyApiData();
  if (purge.activities || purge.posters || purge.traces) {
    console.log(
      `file-first migration purged ${purge.activities} activities, ${purge.posters} posters, and ${purge.traces} traces`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, (info) => {
  console.log(`scenic-route api http://${info.address}:${info.port}`);
  console.log(`postgres: ${databaseUrlSource()}`);
  console.log(`posters: ${posterStore().kind}`);
  console.log(`llm traces: ${LLM_TRACES_DIR}`);
});
