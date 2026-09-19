# Scenic Route

Local-first Strava poster studio. Sync your activities, pick a ride, choose OSM geography and landmarks, then generate a stylized route poster.

An LLM turns the ride, selected features, style, and stats into a structured JSON prompt. That spec plus grounding images (schematic map, terrain tiles, streets or satellite, route silhouette) go to an OpenRouter image model. Saved posters live in a gallery.

## Setup

```bash
cd ~/Projects/scenic-route
npm install
cp .env.example .env.local
docker compose up -d --wait
```

Create a Strava API app at [https://www.strava.com/settings/api](https://www.strava.com/settings/api):

- **Authorization Callback Domain:** `localhost`
- Redirect URI: `http://localhost:5174/api/strava/callback`
- Put the client id and secret in `.env.local`

Create an OpenRouter key at [https://openrouter.ai/keys](https://openrouter.ai/keys):

```
OPENROUTER_API_KEY=
OPENROUTER_MODEL=meta/muse-spark-1.3-contributor
OPENROUTER_IMAGE_MODEL=meta/muse-image
```

```bash
npm run dev
```

Open [http://localhost:5174](http://localhost:5174). Connect Strava and click **Sync Strava**. GPS streams land in Postgres (`DATABASE_URL`, default `scenic_route`). An existing `data/scenic-route.sqlite` is imported once if the database is empty.

## Flow

1. Select an activity on the map.
2. **Make poster** — crop the track, choose Map or Route only, tick geography and landmark layers (or skip them in Route only), pick a style or write a custom prompt, choose which stats appear.
3. Toggle grounding images. The schematic preview is immediate; terrain/streets/satellite snapshots are taken from a hidden MapLibre map (tiles proxied so the canvas is not tainted).
4. **Generate poster** — plans a structured prompt and runs the OpenRouter image model in one step, then saves to `data/posters/`.
5. Browse results in **Gallery** (lightbox, details, download, delete, refine).

## Layout

| Path | Role |
|------|------|
| `apps/web` | Vite + React + MapLibre UI (port 5174) |
| `apps/api` | Hono: Strava, Postgres, OSM/Overpass, planner, image gen (port 8790) |
| `data/` | OSM cache, posters (legacy SQLite is imported on first Postgres boot) |

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

- In browser DevTools, inspect `/api/poster/context/...` and its `Server-Timing` header: `prepare` covers activity loading and track preparation, `sources` covers OSM/Strava loading and geometry conversion, `process` covers layer splitting and annotation calculations, and `serialize` covers response serialization. The Network panel also reports response size and transfer time.
- Browser User Timing entries retain the latest `schematic.context.fetch`, `schematic.context.body-and-parse`, and `schematic.render-and-png` measurements. Inspect them with `performance.getEntriesByType("measure").filter(entry => entry.name.startsWith("schematic."))` in DevTools.
- Start the API with `OSM_TIMING=1` for cache hit/miss/in-flight events, successful request durations and bytes, and per-query fetch/conversion durations. These logs omit coordinates, query strings, and activity IDs. Fetch time includes disk-cache access or endpoint retries; query groups can overlap, so their durations should not be summed as total request latency.

## Production

Production app: [https://scenic-route.ca](https://scenic-route.ca) (Fly.io app `scenic-route`; fallback host `scenic-route.fly.dev`).

Hostname-sensitive config is env-only (`WEB_ORIGIN`, `BETTER_AUTH_URL`, `STRAVA_REDIRECT_URI`, `RESEND_FROM`). After DNS/certs are live, set Fly secrets to the `.ca` values (see deploy notes below). Local defaults in `.env.example` stay on `localhost`.
