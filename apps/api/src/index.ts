import path from "node:path";
import { config } from "dotenv";
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { REPO_ROOT, isSafePosterId } from "./paths";

config({ path: path.join(REPO_ROOT, ".env.local") });
config({ path: path.join(REPO_ROOT, ".env") });

import { activityToFeatureCollection, getActivity, listActivities, listSportTypes } from "./activities";
import { catalogPublic } from "./osm/catalog";
import { loadRouteFeatures } from "./osm/features";
import { lookupLandmark } from "./osm/landmark";
import { OpenRouterError, maxImageReferences } from "./openrouter";
import { planPoster } from "./planner";
import {
  PosterError,
  deletePoster,
  generatePoster,
  listPosters,
  readPosterPng,
  readPosterRecord,
  readPosterRef,
} from "./poster";
import {
  StravaConfigError,
  StravaRateLimitError,
  disconnectStrava,
  exchangeCode,
  getAuthorizeUrl,
  getTokens,
  isStravaConfigured,
} from "./strava";
import { getSyncProgress, runSync } from "./sync";
import { fetchTile, isTileSource } from "./tiles";

const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5174";
const PORT = Number(process.env.PORT ?? 8790);

const app = new Hono();

app.use(
  "*",
  cors({
    origin: WEB_ORIGIN,
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  }),
);

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/status", (c) => {
  const tokens = getTokens();
  return c.json({
    strava: {
      configured: isStravaConfigured(),
      connected: Boolean(tokens),
      athlete: tokens?.athlete ?? null,
      sync: getSyncProgress(),
    },
    openrouter: {
      configured: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
    },
  });
});

app.get("/api/strava/auth", (c) => {
  try {
    return c.redirect(getAuthorizeUrl());
  } catch (error) {
    if (error instanceof StravaConfigError) return c.json({ error: error.message }, 400);
    throw error;
  }
});

app.get("/api/strava/callback", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.redirect(`${WEB_ORIGIN}/?strava=error`);
  try {
    await exchangeCode(code);
    return c.redirect(`${WEB_ORIGIN}/?strava=connected`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "callback failed";
    return c.redirect(`${WEB_ORIGIN}/?strava=error&message=${encodeURIComponent(message)}`);
  }
});

app.post("/api/strava/disconnect", (c) => {
  disconnectStrava();
  return c.json({ ok: true });
});

app.post("/api/strava/sync", async (c) => {
  if (!getTokens()) return c.json({ error: "Strava is not connected" }, 401);
  try {
    return c.json(await runSync());
  } catch (error) {
    if (error instanceof StravaRateLimitError) {
      return c.json(
        {
          ...getSyncProgress(),
          connected: true,
          done: false,
          rateLimited: true,
          retryAfter: error.retryAfter,
        },
        429,
      );
    }
    return c.json({ error: error instanceof Error ? error.message : "sync failed" }, 500);
  }
});

app.get("/api/activities", (c) => c.json({ activities: listActivities() }));

app.get("/api/activities/:id", (c) => {
  const id = Number(c.req.param("id"));
  const row = getActivity(id);
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({
    activity: {
      id: row.id,
      name: row.name,
      type: row.type,
      sportType: row.sport_type,
      startDate: row.start_date,
      distance: row.distance,
      movingTime: row.moving_time,
      elapsedTime: row.elapsed_time,
      elevationGain: row.total_elevation_gain,
      averageSpeed: row.average_speed,
      hasGps: row.has_gps === 1,
      streamsSynced: row.streams_synced === 1,
    },
    track: activityToFeatureCollection(row),
    latlng: row.latlng ? JSON.parse(row.latlng) : [],
  });
});

app.get("/api/sports", (c) => c.json({ sports: listSportTypes() }));
app.get("/api/features", (c) => c.json({ features: catalogPublic() }));

app.get("/api/poster/context/:activityId", async (c) => {
  try {
    const activityId = Number(c.req.param("activityId"));
    const raw = c.req.query("features");
    const featureIds = raw ? raw.split(",").map((item) => item.trim()).filter(Boolean) : undefined;
    return c.json(await loadRouteFeatures(activityId, featureIds));
  } catch (error) {
    return fail(c, error);
  }
});

app.post("/api/poster/landmark", async (c) => {
  try {
    return c.json(await lookupLandmark(await c.req.json()));
  } catch (error) {
    return fail(c, error);
  }
});

app.post("/api/poster/plan", async (c) => {
  try {
    const body = await c.req.json();
    return c.json(await planPoster(body));
  } catch (error) {
    return fail(c, error);
  }
});

app.post("/api/poster/generate", async (c) => {
  try {
    return c.json(await generatePoster(await c.req.json()));
  } catch (error) {
    return fail(c, error);
  }
});

app.get("/api/poster/capabilities", async (c) => {
  try {
    return c.json({ maxReferences: await maxImageReferences() });
  } catch {
    return c.json({ maxReferences: 3 });
  }
});

app.get("/api/posters", (c) => {
  const raw = c.req.query("activityId");
  const activityId = raw != null && raw !== "" ? Number(raw) : undefined;
  if (activityId != null && !Number.isFinite(activityId)) {
    return c.json({ error: "activityId must be a number" }, 400);
  }
  return c.json({ posters: listPosters(activityId) });
});

app.get("/api/posters/:id", (c) => {
  const record = readPosterRecord(c.req.param("id"));
  if (!record) return c.json({ error: "not found" }, 404);
  return c.json(record);
});

app.get("/api/posters/:id/image.png", (c) => {
  try {
    return png(readPosterPng(c.req.param("id")));
  } catch (error) {
    return fail(c, error);
  }
});

app.get("/api/posters/:id/ref-:n.png", (c) => {
  try {
    return png(readPosterRef(c.req.param("id"), Number(c.req.param("n"))));
  } catch (error) {
    return fail(c, error);
  }
});

app.delete("/api/posters/:id", (c) => {
  try {
    const id = c.req.param("id");
    if (!isSafePosterId(id)) return c.json({ error: "not found" }, 404);
    deletePoster(id);
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

function png(bytes: Buffer) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "image/png",
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

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`scenic-route api http://127.0.0.1:${info.port}`);
  console.log(`strava configured: ${isStravaConfigured() ? "yes" : "no"}`);
});
