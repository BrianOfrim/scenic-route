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
} from "./activities";
import { databaseUrlSource, initDb } from "./db";
import { ImportError } from "./gpx";
import { importTrackFiles } from "./importActivity";
import { catalogPublic, parseFeatureSelection } from "./osm/catalog";
import { loadRouteFeatures } from "./osm/features";
import { lookupLandmark } from "./osm/landmark";
import { OpenRouterError, imageModel, listImageModels, maxImageReferences } from "./openrouter";
import { planPoster } from "./planner";
import {
  PosterError,
  deletePoster,
  generatePoster,
  listPosters,
  modifyPoster,
  readPosterPng,
  readPosterRecord,
  readPosterRef,
  setPosterFavorite,
} from "./poster";
import {
  StravaConfigError,
  StravaRateLimitError,
  disconnectStrava,
  exchangeCode,
  getAuthorizeUrl,
  getTokens,
  isStravaConfigured,
  stravaConnectInterstitialHtml,
  verifyStravaState,
} from "./strava";
import { getSyncProgress, runSync } from "./sync";
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
  const tokens = await getTokens(user.id);
  return c.json({
    user: { id: user.id, email: user.email },
    strava: {
      configured: isStravaConfigured(),
      connected: Boolean(tokens),
      athlete: tokens?.athlete ?? null,
      sync: await getSyncProgress(user.id),
    },
    openrouter: {
      configured: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
      chatModel: process.env.OPENROUTER_MODEL?.trim() || null,
      imageModel: process.env.OPENROUTER_IMAGE_MODEL?.trim() || null,
    },
  });
});

app.get("/api/strava/auth", (c) => {
  try {
    // Strava cannot force a fresh login when a browser session already exists.
    // Show an interstitial so the user can log out of Strava before authorizing
    // a different athlete. ?go=1 continues straight to OAuth.
    if (c.req.query("go") === "1") {
      return c.redirect(getAuthorizeUrl(currentUserId(c)));
    }
    return c.html(
      stravaConnectInterstitialHtml({
        continuePath: "/api/strava/auth?go=1",
        cancelUrl: WEB_ORIGIN,
      }),
    );
  } catch (error) {
    if (error instanceof StravaConfigError) return c.json({ error: error.message }, 400);
    throw error;
  }
});

app.get("/api/strava/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) return c.redirect(`${WEB_ORIGIN}/?strava=error`);
  try {
    const userId = verifyStravaState(state);
    await exchangeCode(userId, code);
    return c.redirect(`${WEB_ORIGIN}/?strava=connected`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "callback failed";
    return c.redirect(`${WEB_ORIGIN}/?strava=error&message=${encodeURIComponent(message)}`);
  }
});

app.post("/api/strava/disconnect", async (c) => {
  const { removedActivities } = await disconnectStrava(currentUserId(c));
  return c.json({ ok: true, removedActivities });
});

app.post("/api/strava/sync", async (c) => {
  const userId = currentUserId(c);
  if (!(await getTokens(userId))) return c.json({ error: "Strava is not connected" }, 401);
  try {
    return c.json(await runSync(userId));
  } catch (error) {
    if (error instanceof StravaRateLimitError) {
      return c.json(
        {
          ...(await getSyncProgress(userId)),
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
    const files = await readImportFiles(c);
    if (!files.length) return c.json({ error: "Choose a GPX, FIT, TCX, or Strava export zip" }, 400);
    const result = await importTrackFiles(currentUserId(c), files);
    if (!result.activities.length && !result.skipped) {
      return c.json(
        { error: result.errors[0]?.error ?? "Could not import file", errors: result.errors, skipped: result.skipped },
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
  });
});

app.get("/api/sports", async (c) => c.json({ sports: await listSportTypes(currentUserId(c)) }));
app.get("/api/features", (c) => c.json({ features: catalogPublic() }));

app.get("/api/poster/context/:activityId", async (c) => {
  try {
    const activityId = Number(c.req.param("activityId"));
    const parsed = parseFeatureSelection(c.req.query("features"));
    const timings: Record<string, number> = {};
    const context = await loadRouteFeatures(currentUserId(c), activityId, parsed.ids, parsed.nearRouteM, timings);
    const serializeStart = performance.now();
    const response = c.json(context);
    timings.serialize = performance.now() - serializeStart;
    response.headers.set("Server-Timing", Object.entries(timings).map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`).join(", "));
    return response;
  } catch (error) {
    return fail(c, error);
  }
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

const MAX_IMPORT_FILES = 25;
const MAX_TRACK_BYTES = 15 * 1024 * 1024;
const MAX_ZIP_BYTES = 250 * 1024 * 1024;

async function readImportFiles(c: Context): Promise<Array<{ filename: string; bytes: Uint8Array }>> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await c.req.json();
    const items = Array.isArray(body) ? body : [body];
    return items.slice(0, MAX_IMPORT_FILES).map((item, index) => bytesFromJson(item, index));
  }

  const body = await c.req.parseBody({ all: true });
  const raw = body.file ?? body.files ?? body.gpx ?? body.fit ?? body.zip;
  const list = (Array.isArray(raw) ? raw : raw != null ? [raw] : []).slice(0, MAX_IMPORT_FILES);
  const files: Array<{ filename: string; bytes: Uint8Array }> = [];
  for (const item of list) {
    if (typeof item === "string") {
      const bytes = new TextEncoder().encode(item);
      if (bytes.byteLength > MAX_TRACK_BYTES) throw new ImportError("File is too large");
      files.push({ filename: "upload.gpx", bytes });
      continue;
    }
    if (item && typeof item === "object" && typeof (item as File).arrayBuffer === "function") {
      const file = item as File;
      const limit = maxBytesForName(file.name);
      if (file.size > limit) throw new ImportError(`${file.name || "File"} is too large`);
      files.push({
        filename: file.name || "upload",
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
    }
  }
  return files;
}

function bytesFromJson(item: unknown, index: number): { filename: string; bytes: Uint8Array } {
  const row = (item ?? {}) as {
    filename?: string;
    gpx?: string;
    xml?: string;
    content?: string;
    fit?: string;
    zip?: string;
    base64?: string;
  };
  const filename = String(row.filename ?? `upload-${index + 1}`);
  const binary = row.fit ?? row.zip ?? row.base64;
  if (typeof binary === "string" && binary.length && !binary.includes("<")) {
    const bytes = Uint8Array.from(Buffer.from(binary, "base64"));
    if (bytes.byteLength > maxBytesForName(filename)) throw new ImportError("File is too large");
    return { filename, bytes };
  }
  const text = String(row.gpx ?? row.xml ?? row.content ?? "");
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > MAX_TRACK_BYTES) throw new ImportError("File is too large");
  return { filename, bytes };
}

function maxBytesForName(filename: string): number {
  return filename.toLowerCase().endsWith(".zip") ? MAX_ZIP_BYTES : MAX_TRACK_BYTES;
}

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

try {
  await initDb();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, (info) => {
  console.log(`scenic-route api http://${info.address}:${info.port}`);
  console.log(`postgres: ${databaseUrlSource()}`);
  console.log(`posters: ${posterStore().kind}`);
  console.log(`strava configured: ${isStravaConfigured() ? "yes" : "no"}`);
  console.log(`llm traces: ${LLM_TRACES_DIR}`);
});
