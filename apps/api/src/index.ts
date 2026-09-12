import path from "node:path";
import { config } from "dotenv";
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { LLM_TRACES_DIR, REPO_ROOT, isSafePosterId } from "./paths";

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
import { ImportError } from "./gpx";
import { importTrackFiles } from "./importActivity";
import { catalogPublic } from "./osm/catalog";
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
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
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

app.post("/api/activities/remove", async (c) => {
  try {
    const body = (await c.req.json()) as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.map((id) => Number(id)) : [];
    return c.json(deleteImportedByIds(ids));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "remove failed" }, 400);
  }
});

app.post("/api/activities/import", async (c) => {
  try {
    const files = await readImportFiles(c);
    if (!files.length) return c.json({ error: "Choose a GPX, FIT, TCX, or Strava export zip" }, 400);
    const result = importTrackFiles(files);
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

app.get("/api/activities/:id", (c) => {
  const id = Number(c.req.param("id"));
  const row = getActivity(id);
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({
    activity: toActivitySummary(row),
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
    return c.json({ posters: await generatePoster(await c.req.json()) });
  } catch (error) {
    return fail(c, error);
  }
});

app.post("/api/poster/modify", async (c) => {
  try {
    return c.json({ posters: await modifyPoster(await c.req.json()) });
  } catch (error) {
    return fail(c, error);
  }
});

app.get("/api/poster/capabilities", async (c) => {
  const requested = c.req.query("model") || undefined;
  const fallback = imageModel();
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
      models: [{ id: fallback, name: fallback, maxReferences: 3, maxImages: 1 }],
    });
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

app.get("/api/posters/:id/ref-:n", (c) => {
  try {
    const index = Number(String(c.req.param("n")).replace(/\.png$/i, ""));
    return png(readPosterRef(c.req.param("id"), index));
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
    return c.json(setPosterFavorite(id, body.favorited));
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

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`scenic-route api http://127.0.0.1:${info.port}`);
  console.log(`strava configured: ${isStravaConfigured() ? "yes" : "no"}`);
  console.log(`llm traces: ${LLM_TRACES_DIR}`);
});
