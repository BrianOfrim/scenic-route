# Scenic Route

Route-image studio. Import a GPS activity, choose how much of the surrounding map to show, and generate a stylized image of the route to share.

A chat model on OpenRouter receives the schematic and available satellite reference, then chooses aesthetic treatments. The application assembles a compact prompt with fixed route-fidelity rules and deduplicated text. Meta Muse Image renders that prompt from grounding images: a schematic of the route, plus a satellite snapshot when the image model accepts a second reference. Finished images live in a gallery.

Production: [https://scenic-route.ca](https://scenic-route.ca)

## Flow

1. Sign in with an emailed magic link.
2. Import one or more tracks, then select an activity. The map can show streets, satellite, or the schematic.
3. **Create image** uses the defaults: the full track, annotations off, every geography layer on, the Swiss theme, one variant, and a 4:5 frame. On a phone this is the launch sheet; **Customize** opens the rest of the editor. On a wider screen the composer is the full editor, and the button reads **Generate image**.
4. While an image is generating it appears in **Gallery** as a pending card. Open a finished image to download it, share it, favourite it, read its details, **Refine image** with a follow-up prompt, or **Edit setup** and generate again from the same crop, geography, and theme.

## Customize

These controls stay off the default path. **Edit setup** restores them from the image that was generated.

- **Crop** trims the track and snaps to recorded pauses. Start and finish markers can be shown or hidden.
- **Geography** draws OpenStreetMap context: major roads, residential streets, paths and trails, railways, lakes, rivers, forest, parks, farmland, wetlands, grassland, beaches, coastline, rock, cliffs, and glaciers. Visibility is local; changing a checkbox does not refetch the map. The extent can be the whole map box, a corridor along the route, a tighter band with wider ends, whole areas the route touches, a rotated box, a convex hull, the inside of a loop, or a rectangle or polygon drawn on the map.
- **Annotations** are temporarily paused. New setups use a single red GPS track without landmark discs, coloured trail stretches or lettered regions. Existing gallery images and their saved annotation data remain available.
- **Stats** default to title, date, distance, and moving time. Sport, elapsed time, elevation gain, and average speed can be added when the activity has them. An optional people list prints the names of who did the activity in the title block.
- **Themes** are Middle-earth, Vintage topo, Swiss, Blueprint, WPA park, Watercolour journal, Art deco, 16-bit RPG, Risograph, Linen postcard, Art nouveau, Bauhaus, Modernist, and Minimalist. Several themes offer palettes, including Auto. The desktop composer can plan more than one theme at once; the phone editor keeps a single theme.

Named trails come from named OpenStreetMap paths and trail-route relations, or from stretches named in the editor. A Strava account export supplies activity names and stats, not trail geometry.

## Setup

```bash
cd ~/Projects/scenic-route
npm install
cp .env.example .env.local
docker compose up -d --wait
```

Create an OpenRouter key at [https://openrouter.ai/keys](https://openrouter.ai/keys):

```
OPENROUTER_API_KEY=
OPENROUTER_MODEL=meta/muse-spark-1.3-contributor
# Chat model for the poster spec. Image model for generation.
OPENROUTER_IMAGE_MODEL=meta/muse-image
```

```bash
npm run dev
```

Open [http://localhost:5174](http://localhost:5174). Sign-in emails a magic link. Without `RESEND_API_KEY` and `RESEND_FROM`, the API prints that link in its log. After signing in, choose **Import activities**. You can upload GPX, FIT, or TCX files individually or in batches, including gzip-compressed tracks. A full Strava account-export ZIP can be uploaded directly; the importer reads `activities.csv` and matching files without retaining the original archive.

Imported tracks are stored per account in Postgres (`DATABASE_URL`, default `scenic_route`). An existing `data/scenic-route.sqlite` is imported once if the database is empty. Images are written under `data/` unless R2 is configured (`R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`).

Planning and generation require R2 for new reference batches. The browser uploads the packed reference images once via `/api/poster/references`; plans, models, variants, and retries reuse the returned account-scoped batch ID. The API normally sends private, signed HTTPS GET URLs to OpenRouter. If planning receives `media_url_not_fetchable`, it reads the stored references through R2 and retries with inline images. Links are renewed for each request and last 24 hours; upload IDs last seven days. Saved poster references remain available for later edits and variants. Signed URL credentials are redacted from LLM traces.

Configure an R2 lifecycle rule to delete objects under `references/` after seven days (leave `posters/` intact). Batch expiry is enforced by the API, but physical cleanup requires this bucket rule. R2 credentials need object read and write access; the bucket does not need public access or browser CORS because uploads pass through the API.

## Layout

| Path | Role |
|------|------|
| `apps/web` | Vite + React + MapLibre UI (port 5174) |
| `apps/api` | Hono: auth, imports, Postgres, OSM/Overpass, planner, image gen (port 8790) |
| `data/` | OSM cache and local images (legacy SQLite is imported on first Postgres boot) |

## Commands

```bash
npm run db:up
npm run dev
npm test
npm run build
```

## Schematic performance diagnostics

The editor retains all geography layers for its current activity. Geography visibility changes redraw locally; landmark selections and distance changes still request updated context. Identical pending context requests in the browser and OSM requests in the API share their work. Successful OSM responses, including empty results, use the existing seven-day disk cache; incomplete/error responses are rejected.

To inspect performance:

- In browser DevTools, inspect `/api/poster/context/...` and its `Server-Timing` header: `prepare` covers activity loading and track preparation, `sources` covers OpenStreetMap loading and geometry conversion, `process` covers layer splitting and annotation calculations, and `serialize` covers response serialization. The Network panel also reports response size and transfer time.
- Browser User Timing entries retain the latest `schematic.context.fetch`, `schematic.context.body-and-parse`, and `schematic.render-and-png` measurements. Inspect them with `performance.getEntriesByType("measure").filter(entry => entry.name.startsWith("schematic."))` in DevTools.
- Start the API with `OSM_TIMING=1` for cache hit/miss/in-flight events, successful request durations and bytes, and per-query fetch/conversion durations. These logs omit coordinates, query strings, and activity IDs. Fetch time includes disk-cache access or endpoint retries; query groups can overlap, so their durations should not be summed as total request latency.

Image generation allows ten minutes per image by default. Set `OPENROUTER_IMAGE_TIMEOUT_MS` to a positive integer in milliseconds to change the per-image deadline; multi-image requests multiply it by the requested image count. Restart the API after changing the environment setting.

Image and planner requests automatically write JSON traces to `data/llm-traces/`. Each request logs its trace ID at start and completion. A trace left with `lifecycle: "running"` indicates no completion was recorded (for example, an API restart); it does not prove the provider failed. Finished traces include each HTTP attempt's phase, status, response headers, request/response byte counts, provider error metadata, nested network error causes, concurrent request counts in this API process, deadline timing, and heartbeat delays. Header logging uses an allowlist for request IDs, `Retry-After`, `X-RateLimit-*`, and timing/content metadata; it excludes authentication and cookies. Image bytes are summarized in traces as before.

For a failure, inspect `diagnostics.attempts`: `waiting-for-headers` means no HTTP response was received; `reading-body` means headers arrived but the body failed or stalled. `providerError.metadata` and rate-limit headers can distinguish OpenRouter limits from upstream provider errors. `timeoutTimerDelayMs` and `maxHeartbeatDelayMs` show delayed local execution, which can result from event-loop blocking or machine sleep; they cannot distinguish those causes by themselves. These traces describe what the app observed, and cannot determine a provider's internal cause when no response arrives. Failed gallery cards and their Regenerate callbacks currently live only in browser memory and disappear on reload.

## Production

The Fly.io app is `scenic-route` (`scenic-route.fly.dev` is the fallback host). Production Postgres is Neon, and images are stored in R2. Hostname-sensitive config is env-only (`WEB_ORIGIN`, `BETTER_AUTH_URL`, `RESEND_FROM`, `DATABASE_URL`). Local defaults in `.env.example` stay on `localhost`.


OpenRouter calls use separate process-local FIFO queues for planning and images (three active calls each, configurable with `OPENROUTER_PLAN_CONCURRENCY` and `OPENROUTER_IMAGE_CONCURRENCY`). Each queue allows up to 100 waiting calls. Planning has a four-minute total budget including queue waiting and backoff, with up to three outbound calls shared across transient retries, schema fallback, and inline-reference fallback. Each active planning call has at most three minutes. Known network interruptions and HTTP 429/500/502/503/504 receive jittered backoff; `Retry-After` is honored when it fits the remaining budget. Deadline aborts, malformed responses, and other HTTP failures stop immediately. Slots are released before backoff. Image calls wait at most their generation deadline plus one minute for a slot and are never automatically retried. The local Vite proxy has no independent timeout; the API enforces the deadlines.

This initial queue is in memory, runs independently in each API process, and retains long-lived browser requests. It does not provide durable jobs, cancellation, global limits across replicas, or recovery after reload/restart. Gallery phase labels describe the browser's current stage; backend queue waiting and retry attempts are available in traces rather than live gallery status. Ambiguous image failures still require care with manual Regenerate because the provider may already have completed and charged for the generation.
