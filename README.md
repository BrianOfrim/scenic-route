# Scenic Route

Local-first Strava poster studio. Sync your activities, pick a ride, choose OSM geography and landmarks, then generate a stylized route poster.

An LLM turns the ride, selected features, style, and stats into a structured JSON prompt. That spec plus grounding images (schematic map, terrain tiles, streets or satellite, route silhouette) go to an OpenRouter image model. Saved posters live in a gallery.

## Setup

```bash
cd ~/Projects/scenic-route
npm install
cp .env.example .env.local
```

Create a Strava API app at [https://www.strava.com/settings/api](https://www.strava.com/settings/api):

- **Authorization Callback Domain:** `localhost`
- Redirect URI: `http://localhost:5174/api/strava/callback`
- Put the client id and secret in `.env.local`

Create an OpenRouter key at [https://openrouter.ai/keys](https://openrouter.ai/keys):

```
OPENROUTER_API_KEY=
OPENROUTER_MODEL=anthropic/claude-sonnet-4
OPENROUTER_IMAGE_MODEL=google/gemini-2.5-flash-image
```

```bash
npm run dev
```

Open [http://localhost:5174](http://localhost:5174). Connect Strava and click **Sync Strava**. GPS streams land in `data/scenic-route.sqlite`.

## Flow

1. Select an activity on the map.
2. **Make poster** — crop the track, tick geography and landmark layers, pick a style or write a custom prompt, choose which stats appear.
3. Toggle grounding images. The schematic preview is immediate; terrain/streets/satellite snapshots are taken from a hidden MapLibre map (tiles proxied so the canvas is not tainted).
4. **Plan prompt** — the LLM returns a structured `PosterSpec`. Edit the JSON if you want.
5. **Generate poster** — OpenRouter image model, then save to `data/posters/`.
6. Browse results in **Gallery** (lightbox, details, download, delete, refine).

## Layout

| Path | Role |
|------|------|
| `apps/web` | Vite + React + MapLibre UI (port 5174) |
| `apps/api` | Hono: Strava, SQLite, OSM/Overpass, planner, image gen (port 8790) |
| `data/` | SQLite, OSM cache, posters |

## Commands

```bash
npm run dev
npm test
npm run build
```
