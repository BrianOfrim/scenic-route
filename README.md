# Scenic Route

Route-image studio. Import a GPS activity, choose how much of the surrounding map to show, and generate a stylized image of the route to share.

A chat model on OpenRouter receives the schematic and available satellite reference, then chooses aesthetic treatments. The application assembles a compact prompt with fixed route-fidelity rules and deduplicated text. Meta Muse Image renders that prompt from grounding images: a schematic of the route, plus a satellite snapshot when the image model accepts a second reference. Finished images live in a gallery.

Production: [https://scenic-route.ca](https://scenic-route.ca)

## Flow

1. Create an account with email and password, or continue with Google.
2. Import one or more tracks, then select an activity. The map can show streets, satellite, or the schematic.
3. **Create image** uses the defaults: the full track, annotations off, every geography layer on, the Minimal theme, one variant, and a 4:5 frame. On a phone this is the launch sheet; **Customize** opens the rest of the editor. On a wider screen the composer is the full editor, and the button reads **Generate image**.
4. While an image is generating it appears in **Gallery** as a pending card. Open a finished image to download it, share it, favourite it, read its details, **Refine image** with a follow-up prompt, or **Edit setup** and generate again from the same crop, geography, and theme.

## Customize

These controls stay off the default path. **Edit setup** restores them from the image that was generated.

- **Crop** trims the track and snaps to recorded pauses. Start and finish markers can be shown or hidden.
- **Geography** draws OpenStreetMap context: major roads, residential streets, paths and trails, railways, lakes, rivers, forest, parks, farmland, wetlands, grassland, beaches, coastline, rock, cliffs, and glaciers. Visibility is local; changing a checkbox does not refetch the map. The extent can be the whole map box, a corridor along the route, a tighter band with wider ends, whole areas the route touches, a rotated box, a convex hull, the inside of a loop, or a rectangle or polygon drawn on the map.
- **Annotations** are temporarily paused. New setups use a single red GPS track without landmark discs, coloured trail stretches or lettered regions. Existing gallery images and their saved annotation data remain available.
- **Stats** default to title, date, distance, and moving time. Sport, elapsed time, elevation gain, and average speed can be added when the activity has them. An optional people list prints the names of who did the activity in the title block.
- **Themes** are Middle-earth, Vintage topo, Minimal, Blueprint, WPA park, Watercolour journal, Art deco, 16-bit RPG, Risograph, Linen postcard, Art nouveau, Bauhaus, and Modernist. Themes with palette choices default to a signature named palette; Watercolor chooses washes from the map. The desktop composer can plan more than one theme at once; the phone editor keeps a single theme.

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

Open [http://localhost:5174](http://localhost:5174). Email/password signup requires email verification. Without `RESEND_API_KEY` and `RESEND_FROM`, the development API prints verification and password-reset links in its log. Production requires working Resend configuration. Google sign-in is enabled when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. After signing in, choose **Import activities**. You can upload GPX, FIT, or TCX files individually or in batches, including gzip-compressed tracks. A full Strava account-export ZIP can be uploaded directly; the importer reads `activities.csv` and matching files without retaining the original archive.

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


OpenRouter calls use separate process-local FIFO queues for planning and images (four active calls each, configurable with `OPENROUTER_PLAN_CONCURRENCY` and `OPENROUTER_IMAGE_CONCURRENCY`). Each queue allows up to 100 waiting calls. Planning can wait up to four minutes for its first slot, then starts a separate four-minute budget when the first outbound attempt begins. Subsequent queue waits and backoff share that planning budget, with up to three outbound calls shared across transient retries, schema fallback, and inline-reference fallback. Each active planning call has at most three minutes. Known network interruptions and HTTP 429/500/502/503/504 receive jittered backoff; `Retry-After` is honored when it fits the remaining budget. Deadline aborts, malformed responses, and other HTTP failures stop immediately. Slots are released before backoff. Image calls wait at most their generation deadline plus one minute for a slot. Backend batch jobs retry explicit upstream HTTP 502/503/504 responses at most twice, after 5 and 15 seconds plus up to 2 seconds of jitter. Backoff releases the job slot; retries re-enter the image concurrency limit, reuse the saved plan, and refresh signed URLs for the same reference objects. Connection interruptions, local deadlines, malformed responses, and other failures require manual retry. Gallery shows the retry attempt; manual retry starts a fresh three-attempt allowance. Direct image/refinement requests are not automatically retried. The local Vite proxy has no independent timeout; the API enforces the deadlines.

Batch creation uploads its reference sheets, then submits all jobs in one request (`POST /api/poster/jobs`, client-generated `submissionId`). An in-memory backend queue retains inputs, plans, and states, with four planning jobs and four image jobs per API process (the same concurrency environment variables). Duplicate submissions are coalesced within the running process. Gallery polls user-scoped job status, showing Queued → Planning → Generating, and restores pending/failed cards after browser reload. Once submission succeeds, closing the browser does not interrupt the batch. Preparing/uploading references still needs the browser.

Job state is intentionally discarded on API restart; completed images remain in storage. Failed image jobs require explicit Regenerate and reuse their existing plan. Image requests are never automatically resent because the provider may have completed and charged for a failed request. Failures can be dismissed. Finished/failed job state and submission IDs are retained for up to 24 hours. Direct refinement/variant requests still use synchronous endpoints. Each style/model job plans independently. There is no cancellation or completion notification.

Run one API process/machine for this in-memory queue: job status and concurrency are not shared across replicas. Fly auto-stop is disabled and at least one machine stays running so background work continues without active HTTP traffic. Configuration changes take effect on deployment. Local laptop sleep still pauses local workers.

### Sign-in configuration

Email/password authentication includes signup, email verification, and password reset. Regular sign-in uses the password. Verification links sign users in after confirming their email; password resets revoke existing sessions.

For Google sign-in, create a **Web application** OAuth client in Google Cloud, configure the consent screen, and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the API. Register the appropriate authorized redirect URI for each environment:

- Local: `http://localhost:5174/api/auth/callback/google`
- Production: `https://scenic-route.ca/api/auth/callback/google`

Use separate Google Cloud projects and OAuth clients for development and public production use. For temporary live-site testing, the development client can include both callback URLs; keep local credentials in `.env.local` and configure live credentials through Fly secrets. If the consent screen is in testing mode, add the Google accounts that will test sign-in. Restart the API after changing credentials. The Google button is unavailable until both credentials are configured. Keep the client secret on the server.

The reset-password page is `/reset-password`. Verification and Google callbacks return to `/`. Magic-link sign-in has been removed; existing users can use password reset to set a password. No account or content migration is performed.

Google profile photos are shown in the account menu and refreshed when Google accounts are linked or used to sign in. Accounts without a working photo display an initial instead.
