# Scenic Route

Route-image studio. Import a GPS activity, choose how much of the surrounding map to show, and generate a stylized image of the route to share.

A chat model on OpenRouter turns the ride, geography, theme, and stats into a structured prompt. Meta Muse Image renders that prompt from grounding images: a schematic of the route, plus a satellite snapshot when the image model accepts a second reference. Finished images live in a gallery.

Production: [https://scenic-route.ca](https://scenic-route.ca)

## Flow

1. Sign in with an emailed magic link.
2. Import one or more tracks, then select an activity. The map can show streets, satellite, or the schematic.
3. **Create image** uses the defaults: the full track, annotations off, every geography layer on, the Risograph theme, one variant, and a 4:5 frame. On a phone this is the launch sheet; **Customize** opens the rest of the editor. On a wider screen the composer is the full editor, and the button reads **Generate image**.
4. While an image is generating it appears in **Gallery** as a pending card. Open a finished image to download it, share it, favourite it, read its details, **Refine image** with a follow-up prompt, or **Edit setup** and generate again from the same crop, geography, and theme.

## Customize

These controls stay off the default path. **Edit setup** restores them from the image that was generated.

- **Crop** trims the track and snaps to recorded pauses. Start and finish markers can be shown or hidden.
- **Geography** draws OpenStreetMap context: major roads, residential streets, paths and trails, railways, lakes, rivers, forest, parks, farmland, wetlands, grassland, beaches, coastline, rock, cliffs, and glaciers. Visibility is local; changing a checkbox does not refetch the map. The extent can be the whole map box, a corridor along the route, a tighter band with wider ends, whole areas the route touches, a rotated box, a convex hull, the inside of a loop, or a rectangle or polygon drawn on the map.
- **Annotations** are off until turned on. They add landmarks near the route (peaks, towns, neighbourhoods, named water, trails, viewpoints, historic places, parks, structures, food, worship, lodging, playgrounds, schools, colleges, cemeteries), each with its own search distance. Named trails can be renamed and their start and end re-marked on the GPS track. Landmarks can be searched, placed, moved, and renamed. Large areas are lettered washes; trails and pins are a private index for the model, and the finished image is asked to show the names.
- **Stats** default to title, date, distance, and moving time. Sport, elapsed time, elevation gain, and average speed can be added when the activity has them. An optional people list prints the names of who did the activity in the title block.
- **Themes** are Middle-earth, Vintage topo, Swiss minimal, Blueprint, WPA park, Watercolour journal, Star chart, Transit diagram, Art deco, 16-bit RPG, Risograph, Linen postcard, Art nouveau, and a custom prompt. Several themes offer palettes, including Auto. The desktop composer can plan more than one theme at once; the phone editor keeps a single theme.

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

## Production

The Fly.io app is `scenic-route` (`scenic-route.fly.dev` is the fallback host). Production Postgres is Neon, and images are stored in R2. Hostname-sensitive config is env-only (`WEB_ORIGIN`, `BETTER_AUTH_URL`, `RESEND_FROM`, `DATABASE_URL`). Local defaults in `.env.example` stay on `localhost`.
