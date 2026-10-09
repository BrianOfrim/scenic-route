# OSM Standard tile proxy validation

Implemented 2026-10-09 against the current [OSMF Standard Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/). Production rollout is pending; no volume was created/attached and no deployment or production tile request was made.

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
