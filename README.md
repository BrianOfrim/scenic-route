# Scenic Route

Route-image studio. Import a GPS activity, choose how much of the surrounding map to show, and generate a stylized image of the route to share.

The application assembles prompts locally with fixed route-fidelity rules and exact text. The image model on OpenRouter chooses aesthetic treatments and renders the poster from geographic grounding images. Refinement sends the current poster, available grounding images, and the user’s edit request directly to the image model. Finished images live in a gallery.

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
OPENROUTER_IMAGE_MODEL=meta/muse-image
```

```bash
npm run dev
```

Open [http://localhost:5174](http://localhost:5174). Email/password signup requires email verification. Without `RESEND_API_KEY` and `RESEND_FROM`, the development API prints verification and password-reset links in its log. Production requires working Resend configuration. Google sign-in is enabled when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. After signing in, choose **Import activities**. You can upload GPX, FIT, or TCX files individually or in batches, including gzip-compressed tracks. A full Strava account-export ZIP can be uploaded directly; the importer reads `activities.csv` and matching files without retaining the original archive.

Imported tracks are stored per account in Postgres (`DATABASE_URL`, default `scenic_route`). An existing `data/scenic-route.sqlite` is imported once if the database is empty. Images are written under `data/` unless R2 is configured (`R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`).

New generation batches require R2 for reference uploads. The browser uploads the packed reference images once via `/api/poster/references`; models, variants, and retries reuse the returned account-scoped batch ID. The API normally sends private, signed HTTPS GET URLs to OpenRouter. Template preparation uses reference metadata only; it never sends images to a chat model. Links are renewed for each request and last 24 hours; upload IDs last seven days. Saved poster references remain available for later edits and variants. Signed URL credentials are redacted from LLM traces.

Configure an R2 lifecycle rule to delete objects under `references/` after seven days (leave `posters/` intact). Batch expiry is enforced by the API, but physical cleanup requires this bucket rule. R2 credentials need object read and write access; the bucket does not need public access or browser CORS because uploads pass through the API.

## Monthly poster limits

Accounts can generate **50 posters per UTC calendar month** by default. Each image counts, including edits and variants. The API reserves capacity before an image request, so simultaneous requests cannot exceed the allowance. Failed requests and missing outputs release their unused capacity; deleting a poster does not restore allowance. Successful image outputs count even if saving them subsequently fails. Usage starts when this feature is deployed; previously generated posters are not counted. Interrupted reservations expire after 24 hours (longer if a custom image deadline requires it).

Account settings show usage, remaining capacity, and the reset date. Requests that exceed the remaining allowance return HTTP 429; background jobs show the same message on their failed card. Quota is checked when a queued job starts generation.

To grant unlimited access to an existing account, run against the desired database (`DATABASE_URL`, otherwise the local database):

```bash
npm run poster:limit -- user@example.com unlimited
npm run poster:limit -- user@example.com 50
```

The second command restores the default limit. Other nonnegative integer limits are also supported. Overrides take effect immediately and preserve existing usage. This is a server-side operator command; users cannot change their own allowance. The database field is `"user".poster_monthly_limit`: `50` by default, `NULL` for unlimited.

## Layout

| Path | Role |
|------|------|
| `apps/web` | Vite + React + MapLibre UI (port 5174) |
| `apps/api` | Hono: auth, imports, Postgres, OSM/Overpass, prompt templates, image gen (port 8790) |
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

Image generation and refinement requests automatically write JSON traces to `data/llm-traces/`. Each request logs its trace ID at start and completion. A trace left with `lifecycle: "running"` indicates no completion was recorded (for example, an API restart); it does not prove the provider failed. Finished traces include each HTTP attempt's phase, status, response headers, request/response byte counts, provider error metadata, nested network error causes, concurrent request counts in this API process, deadline timing, and heartbeat delays. Header logging uses an allowlist for request IDs, `Retry-After`, `X-RateLimit-*`, and timing/content metadata; it excludes authentication and cookies. Image bytes are summarized in traces as before.

For a failure, inspect `diagnostics.attempts`: `waiting-for-headers` means no HTTP response was received; `reading-body` means headers arrived but the body failed or stalled. `providerError.metadata` and rate-limit headers can distinguish OpenRouter limits from upstream provider errors. `timeoutTimerDelayMs` and `maxHeartbeatDelayMs` show delayed local execution, which can result from event-loop blocking or machine sleep; they cannot distinguish those causes by themselves. These traces describe what the app observed, and cannot determine a provider's internal cause when no response arrives. Backend job failures are restored after reload during their retention period; failed synchronous refinement/variant requests are reported in the browser and can be retried manually.

## Production

The Fly.io app is `scenic-route` (`scenic-route.fly.dev` is the fallback host). Production Postgres is Neon, and images are stored in R2. Hostname-sensitive config is env-only (`WEB_ORIGIN`, `BETTER_AUTH_URL`, `RESEND_FROM`, `DATABASE_URL`). Local defaults in `.env.example` stay on `localhost`.


Initial prompts are assembled locally from the selected style, palette, typography, atmosphere note, exact text, and reference metadata. The image model chooses title placement, route color, marker appearance, and background treatments within geometry, palette, and text constraints. Generation and refinement do not require `OPENROUTER_MODEL`. The compatibility endpoint `POST /api/poster/plan` returns a template-built spec, zero cost, and no model identifier. New specs include `promptTemplateVersion: 1` and the complete prompt in `finalPrompt`. Records save the original design brief (`basePrompt`) and ordered edit requests (`editRequests`) separately from the actual image request. Refinement uses a fixed edit template with the current poster as image 1 and grounding images numbered from 2. Variants use the original brief plus ordered edits, with grounding images numbered from 1; later edits override earlier design instructions while preserving geographic fidelity. Legacy refinement chains recover their brief and edits from saved parent records when available. Reopening setup builds a fresh prompt from current inputs.

Batch creation uploads its reference sheets, then submits all jobs in one request (`POST /api/poster/jobs`, client-generated `submissionId`). The API validates the entire batch and assembles prompts before admission. An in-memory backend queue retains prepared prompts and states, with one shared, user-owned image scheduler: by default, up to eight active requests per authenticated user (`OPENROUTER_IMAGE_USER_CONCURRENCY=8`) and 128 active requests per API process (`OPENROUTER_IMAGE_CONCURRENCY=128`). Waiting users take turns as slots open, with FIFO order within each user. Gallery jobs remain Queued until admitted; direct generation, refinement, and variants share those same slots. A slot covers generation, quota settlement, and output persistence, so the nested provider call reuses its owner's slot. The separate account-lock connection pool permits 144 connections, leaving room for 16 other account requests alongside the default 128 active image jobs. Account-lock connection acquisition times out after ten seconds; affected gallery jobs become Failed for manual retry. These connections are shared, not reserved; the general query pool can use another ten connections per API process, so database capacity must accommodate both pools and any other clients. Duplicate submissions are coalesced within the running process. Gallery polls user-scoped job status, showing Queued → Generating, and restores pending/failed cards after browser reload. Once submission succeeds, closing the browser does not interrupt the batch. Preparing/uploading references still needs the browser.

By default, batches may select at most eight distinct theme/palette combinations; multiple models and image variants for a combination do not count as extra selections. The composer and server enforce the account's effective selection limit before preparing any jobs. Older saved setups retain their selections but must fit that limit before generation. This selection cap is separate from concurrent request limits.

By default, the shared scheduler allows at most 16 unfinished jobs per user across gallery batches and direct requests. Running, waiting, and retry-backoff jobs all count. A new batch reserves its entire allowance synchronously after validation; concurrent submissions cannot partially overfill it. Manual retries reserve a new place before changing Failed to Queued. Automatic retries retain the accepted job's existing place until success or permanent failure. The eight-active-per-user limit is separate: a user can have eight running plus eight waiting, or up to 16 waiting/backing off when fewer are running. Admission overflow returns HTTP 503 asking the user to wait for existing work to finish. There is no global image waiting-job cap: reaching 128 active requests makes admitted work wait. Direct waiters time out after four minutes and release their place; backend gallery jobs have no admission timeout.

Backend jobs retry explicit upstream HTTP 502/503/504 at most twice, after 5 and 15 seconds plus up to 2 seconds of jitter. Backoff releases the active slot while retaining the job's unfinished allowance, so later submissions cannot displace an accepted retry. Ready retries rejoin the fair scheduler; they reuse the exact prepared prompt and refresh reference URLs. Connection interruptions, local deadlines, malformed responses, and other failures require manual retry because completion and charges may be ambiguous. Manual retry starts a fresh three-attempt allowance. Direct image requests are not automatically retried.

Spending is controlled by the prepaid OpenRouter account balance, with no application-level monthly spending cap. A credit rejection (HTTP or structured `error.code` 402) returns HTTP 503 with a clear insufficient-provider-credit message across queued batches, direct generation, refinements, and variants. Each queued request that receives the rejection becomes Failed; its quota reservation and scheduler slot are released. Failed jobs require manual retry and never resume after a calendar reset or balance refill. Structured `error.metadata.limit_source=openrouter_in_flight_budget` is shown as temporary provider spending capacity, rather than exhausted credit; this also requires manual retry and does not expand the approved transient retry policy. See [OpenRouter error handling](https://openrouter.ai/docs/api_reference/errors-and-debugging) and [credit limits](https://openrouter.ai/docs/api_reference/limits) for the provider contract.

Poster refinement uses the same image provider queue and deadline handling as generation, with no separate chat request. The local Vite proxy has no independent timeout; the API enforces the deadlines.

Job state is intentionally discarded on API restart; completed images remain in storage. Failures can be dismissed. Finished/failed job state and submission IDs are retained for up to 24 hours. Direct refinement/variant requests still use synchronous endpoints. Each style/model job stores its prepared template prompt. There is no cancellation or completion notification.

Run one API process/machine for this in-memory queue: job status and concurrency are not shared across replicas. Fly auto-stop is disabled and at least one machine stays running so background work continues without active HTTP traffic. Configuration changes take effect on API restart/deployment. Local laptop sleep still pauses local workers.

### Sign-in configuration

Email/password authentication includes signup, email verification, and password reset. Regular sign-in uses the password. Verification links sign users in after confirming their email; password resets revoke existing sessions.

For Google sign-in, create a **Web application** OAuth client in Google Cloud, configure the consent screen, and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the API. Register the appropriate authorized redirect URI for each environment:

- Local: `http://localhost:5174/api/auth/callback/google`
- Production: `https://scenic-route.ca/api/auth/callback/google`

Use separate Google Cloud projects and OAuth clients for development and public production use. For temporary live-site testing, the development client can include both callback URLs; keep local credentials in `.env.local` and configure live credentials through Fly secrets. If the consent screen is in testing mode, add the Google accounts that will test sign-in. Restart the API after changing credentials. The Google button is unavailable until both credentials are configured. Keep the client secret on the server.

The reset-password page is `/reset-password`. Verification and Google callbacks return to `/`. Magic-link sign-in has been removed; existing users can use password reset to set a password. No account or content migration is performed.

Google profile photos are shown in the account menu and refreshed when Google accounts are linked or used to sign in. Accounts without a working photo display an initial instead.

Account settings includes **Delete account**. Users confirm by entering their account email. Authenticated `DELETE /api/account` requires a trusted Origin and `{ "email": "account@example.com" }`. Deletion purges activities, file fingerprints, per-account settings, poster files (including orphaned files), reference uploads, generation jobs, traces, saved geography scenes, quota usage, credentials, and sessions. Active requests or generations return 409; retry after they finish. Storage errors return 503 and retain the account so the purge can be retried. Account access uses shared Postgres advisory locks; deletion uses an exclusive lock to prevent late writes across processes. Older unscoped diagnostic and scene-cache files are discarded on deletion because their ownership cannot be recovered. New traces and scenes are stored per account.


### Per-account generation limits

An operator can override active requests, unfinished jobs, and theme/palette selections for an account:

```sh
npm run image:limits -- user@example.com 32 64 32
npm run poster:limit -- user@example.com unlimited
```

Each of the three `image:limits` values accepts a positive integer, `unlimited`, or `default`. For example, `unlimited unlimited unlimited` removes individual generation limits; `default default default` restores the configured active default (normally eight), 16 unfinished jobs, and eight selections. The monthly image quota is managed separately by `poster:limit`.

The command connects to the database in `.env.local` / `.env` (or the supplied environment); use the intended database. Changes apply on the account's next poster request without restarting the API; reload an open composer to refresh its selection allowance. Lowering limits does not cancel accepted work: new submissions wait for room and subsequent starts respect the new active ceiling. The 128 global concurrency ceiling, 144 account-lock pool, and 200-job request-size validation remain in force. Overrides are stored by account ID and can only be changed by the operator command/database access, not by client request fields.
