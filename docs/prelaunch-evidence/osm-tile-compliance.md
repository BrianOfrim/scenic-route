# OSM Standard tile proxy validation

Implemented 2026-10-09 against the current [OSMF Standard Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/). Production rollout and a limited interactive smoke test subsequently completed; see the production evidence below.

## Changes

The authenticated Streets tile route uses a bounded persistent disk cache with serialized HTTP-cache policy, conditional upstream requests, atomic writes, seven-day fallback only for absent freshness, origin-only approved Referer, contactable application identity, request coalescing, bounded upstream concurrency/queue/body sizes, and failure cooldowns. Expired entries require validation; storage failures stop misses while readable fresh hits continue. Browser expiry cannot exceed upstream freshness. OSM Standard cannot be selected by the off-screen reference helper.

Local cache: `data/tile-cache`. Production: dedicated mounted `/tile-cache`; the updated Fly configuration requires provisioning the volume first. Toggle `OSM_TILES_ENABLED=false` and restart to disable OSM fetching without deleting cache files. This changes Streets tiles, not the separate Overpass/schematic geography cache. Esri/OpenTopoMap fetching and image-generation licensing remain separate.

## Automated verification

- Node 22.23.3: API type-check and production web build passed. Existing Vite warning about large chunks remains.
- Full suite passed: 416 API tests and 207 web tests. API tests ran against an isolated local PostgreSQL database, removed after verification.
- 41 focused tile-cache/route tests cover persistence, freshness precedence, Date/Age, malformed/restrictive directives, conditional 304/200, missing-body recovery, Vary, coalescing/caller cancellation, queue limits, upstream cooldown, malformed/oversized responses, retention/eviction/capacity, corruption/interrupted writes, disk-full injection, missing mounts, identity, coordinate bounds, auth, origin validation, credentials exclusion, and downstream conditionals/errors.
- An initial full-suite invocation with `NODE_ENV=test` failed an existing auth redirect test because Better Auth changes security behavior in that environment; the normal environment rerun passed. No auth implementation was modified.

## Browser verification (local mock tiles only)

A temporary Vite fixture rendered the real MapView and snapshot helper. Desktop and a 390px viewport showed readable linked OSM credit and the map-issue link. Credit remained expanded after dragging and appeared above a 220px mock mobile poster sheet. Injected 503 responses showed the Streets-unavailable message; restoring mock tiles removed it. Selecting OSM reference capture raised the guard before rendering/fetching. Mock-server requests all carried `http://127.0.0.1:5175/` as Referer, without a page path/query. No OSM production requests occurred. Temporary fixture files/server were removed.

The local mock fixture verifies browser/UI mechanics, not production authentication, actual volume attachment, OSM response headers, provider availability, or capacity under beta traffic. Post-deployment acceptance must use a single small viewport and confirm cache persistence after a drained restart, following the operations runbook. Current uncommitted privacy-policy/checklist work was preserved.

## Production deployment and smoke evidence — October 9–10, 2026 UTC

- Deployed `main` SHA `197065ca8ad6f47d272df0dbef4a01af5d324e43` using image `registry.fly.io/scenic-route:deployment-01M4HB2H4FVHWQP79KZDKWTKCK`, initially Fly release 38, with the immediate single-machine procedure. Deployment completed approximately October 9, 22:17 UTC. One serving machine remained in `dfw`; Node version was 22.23.3.
- Provisioned encrypted 3 GB volume `osm_tile_cache`, mounted at `/tile-cache`. Mount detection and a temporary writable-storage probe succeeded. The 2 GiB/50,000-entry cache limits, enabled switch and both production origin allowances were active. Scheduled Fly volume backups were enabled; restore has not been tested.
- Homepage and `/api/health` returned 200; unauthenticated `/api/activities` returned 401. Production responses included `Referrer-Policy: origin`; Fly health checks passed.
- Created and email-verified the requested production test account. The policy gate initially blocked protected use because its four settings were absent. At Brian's explicit request, staged and activated draft versions `draft-2026-10-09-v1` and `draft-ai-2026-10-09-v1`, with `/terms` and `/privacy` routes, using another immediate restart. Both policy pages returned 200. The combined agreement was submitted only after Brian explicitly authorized acceptance. Draft activation is temporary and does not establish reviewed policies or public-launch readiness.
- The authenticated Streets viewport rendered real OSM tiles on desktop and 390px mobile. Expanded copyright and map-issue links remained readable above bottom navigation and after a small drag. No GPX was needed for the empty-account viewport; no AI generation was triggered.
- Before the persistence restart, the cache held 16 files totaling 170,482 bytes including metadata. A separate read using the deployed cache class, with upstream transport disabled, served a stored tile and recorded one hit with zero upstream calls. After the authorized machine restart, the same read succeeded, file count/bytes were unchanged, and the aggregate SHA-256 manifest matched (`ac021d5b06c05a762b88e812de95030f3dca8f520e1853e6c7f7c40d617a178d`). Post-restart browser requests also produced application HTTP cache-hit events. Health checks passed afterward.
- This was a small interactive acceptance check, not a capacity/load test. Expiry/revalidation, injected failures, off-screen OSM rejection and poster-sheet overlays were covered by local automated/mock-browser checks, not induced against production. Full import/generation/gallery/download/refinement acceptance, recovery rehearsal and separate provider/data licensing gates remain open.
