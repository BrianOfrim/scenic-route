# Automatic geography

New posters choose geography from their final, cropped schematic frame. Editor
zoom, device pixel ratio, and export resolution do not change content. The shared
policy uses a logical 1,024-pixel short side and the same aspect fit and 3% margin
as schematic rendering; parity tests cover every aspect and high latitudes.

## Loading time logs

Geography loads emit `geography.timing` records at debug level. By default they
are written to `data/logs/api-YYYY-MM-DD.jsonl` (UTC date) and hidden from the
terminal. `LOG_FILE_LEVEL` defaults to `debug`; `LOG_CONSOLE_LEVEL` defaults to
`info`. Set `LOG_DIR` to change the directory. Both thresholds accept `debug`,
`info`, `warn`, `error`, or `off`. Filter by `scope: "geography.timing"` and `loadId` to
follow one load; `start` and `complete`/`failed` bracket its total server loading
time. Completion includes source, profile, completeness, warnings count, and
Overpass cache hit, miss, and shared in-flight counts. Saved-scene cache status,
source loading, processing, and scene writing are separate events.

For cache misses, `overpass-miss` reports `totalMs`, `cacheReadMs`, `cacheWriteMs`,
`queueMs`, `networkMs`, `retryMs`, attempt count, and outcome. `overpass-attempt`
records each attempt, including failures; `overpass-retry` records HTTP status and
planned backoff. `queryKey` is a hash identifying the tile query; raw queries,
coordinates, and user IDs are not logged. Network time includes reading and
parsing the response. `query` includes conversion time and response bytes;
its `fetchMs` is summed across tiles, whereas `totalMs` is wall-clock time.
Parallel tile timings should not be added to the overall load duration.
The API also records a debug `response` event with the scene ID,
`queryResponseBytes`, and `apiResponseBytes` (uncompressed UTF-8 JSON sent to the
browser). These diagnostics are omitted from the editor UI.

These are server timings through scene persistence, excluding API response
serialization, browser transfer, and rendering. Files append in event order and rotate daily; retention is managed externally.
They are separate from geography cache files. `OSM_TIMING=1` still
enables the existing optional diagnostics for other OSM queries.

Each `overpass-attempt` includes the endpoint hostname, HTTP failure status, and
error type. `overpass-endpoint-health` reports cumulative attempts, successes,
failures, `failureRate` (0–1), `averageSuccessMs` (successful response time,
excluding queueing), consecutive health failures, and remaining cooldown time.
These statistics include all OSM traffic through the default client and reset
when the API process restarts. Raw endpoint URLs and credentials are not logged.

The default order is `overpass.openstreetmap.fr`, then
`overpass-api.de`. Two consecutive rate-limit, HTTP 5xx, transport, or
request-timeout failures put an endpoint on cooldown for 60 seconds. During that
time it is skipped when another endpoint is available; skips emit
`overpass-endpoint-skip`. After expiry it becomes eligible again, and success
clears its failure streak. Query errors, Overpass remarks, and response-size
limits do not trigger cooldown. Request timeouts can fall back to another endpoint.
If every endpoint is cooling down, only the endpoint due to recover first is
probed. A configured `OVERPASS_URL` remains the sole endpoint and is still tried
during cooldown. Selection uses cooldown health rather than ranking by latency;
the logged failure rates and successful response times allow that comparison.

## Policy version 1

- Below 10 ground meters per logical pixel: local roads, streets, paths, water,
  parks, forest, and other useful ground cover.
- 10–50 m/px: through roads, rivers/canals, larger water and green spaces.
- 50–250 m/px: regional scenery.
- Above 250 m/px: generalized continental scenery.

Automatic retrieval uses class-specific Overpass selectors below 100 m/px, including
regional frames from 50–100 m/px. Those regional OSM scenes use bundled Natural
Earth land and ocean polygons as a base, because clipped OSM coastline fragments
cannot reliably define which side is water. At 100 m/px and above, the whole scene
uses the bundled `scenic-ne-2` Natural Earth provider. A frame requiring more than
32 query tiles also uses the generalized provider. Budget exhaustion or source
failures produce an explicit fallback warning.

Overpass requests try `https://overpass.openstreetmap.fr/api/interpreter` first,
with `https://overpass-api.de/api/interpreter` as the fallback. Setting
`OVERPASS_URL` overrides both defaults and uses only the configured endpoint.

Geometry is clipped to the aspect-fitted frame, then filtered by visible polygon
area. Ordinary areas need 12 pixels² locally or 24 pixels² at other scales. Areas
near the route can survive down to 3 pixels². Dense minor streets/paths away from
the route are suppressed. Lines use 0.65-pixel simplification with shared junction
vertices protected. Major roads and rivers are not discarded based on the length
of individual OSM ways. Polygon rings and holes are retained; the bundled data is
topologically simplified during preprocessing.

## Policy version 2: water detail

The Water and Rivers controls remain simple. Internally, OSM water tags distinguish
rivers, streams, canals, lakes, ponds and reservoirs. Natural Earth distinguishes
generalized land and ocean polygons, lakes, river centerlines and coastlines. Land
is tinted only inside explicit generalized land polygons; blank areas are not
assumed to be land. River polygons belong to
Rivers and remain filled. At district scale, streams are retained near the route;
distant streams and small ponds are suppressed. A pond near the route can survive
down to three logical pixels². Larger lakes, reservoirs, river areas and the ocean
remain available subject to the existing area and source-ranking rules. Missing
OSM subtype tags are treated as generic water and filtered by visible size.

Saved version 1 scenes refresh under this policy; unchanged historical posters
still use their saved image and editor settings.

The region/continent provider intentionally has fewer feature categories than
local OSM. It does not supply forests, parks, or field parcels, and its historical
urban footprints and road coverage are approximate. These are visible product
limits, not evidence that those features do not exist. A maintained generalized
OSM provider can be added behind the same scene contract later.

## Data flow and restoration

`GET /api/poster/context/:activityId?geography=auto` loads activity and annotation
context without fetching every background layer. `GET /api/poster/geography/:activityId`
loads the final frame independently. Both routes require normal authentication;
geography lookup verifies activity ownership and validates bounding coordinates.

The editor debounces frame changes, ignores stale responses, and disables generation
until the current scene is ready. The same resolved categories drive schematic
visibility and planner input. Extent masks are applied after scene resolution and
use the same outer frame for the satellite reference.

New snapshots persist automatic/manual mode, policy version, frame key and scene ID.
Existing snapshots default to manual. Resolved scenes are pinned by content hash
under `data/osm-cache/scenes/` and can be restored independently of OSM cache expiry.
Keep this directory on persistent storage if exact regeneration matters. If a saved
scene has been removed, the API refreshes it and reports that fact. Legacy snapshots
without a scene ID preserve selections but cannot reproduce historical upstream data.
Explicit Retry actions omit the saved scene ID so a reopened fallback is rebuilt
instead of being restored again. Valid raw Overpass cache entries remain reusable.

Advanced geography allows manual layers and Reset to automatic. Switching from
automatic to manual keeps the current scene and selects its visible layers;
it makes no geography request. Loaded layers can be hidden and shown locally.
Enabling an unloaded layer requests only that category, with the same polygon
thresholds and line simplification as the poster's scale. Explicitly selected
paths can be present at larger scales, while retaining scale-based simplification.
Each scene records `loadedFeatureIds`, including successfully queried empty
categories, so toggling an empty layer does not repeatedly request it.

Category additions are merged into the saved scene without replacing existing
layers. Requests use owned scene IDs and reject a base from a different frame or
policy version. Failures are shown beside the affected layer with Retry; the
existing scene remains available. Image generation waits for selected layers to
finish loading or for failed layers to be retried or deselected. Changing the
frame in manual mode loads only selected geography categories. Older full-manual
saved scenes still restore their original geometry.

New category loads reuse raw Overpass responses when available, with the normal
90-second, 64-tile, and 256 MiB budgets. Newly loaded manual layers use scale-based
processing rather than full-detail processing. Urban footprints are loaded from
the bundled overview dataset and can be enabled individually; an empty result
shows an explanation in the controls. Returning to automatic reuses the previous
automatic scene for the same frame when available.

## Resource limits

Automatic Overpass queries permit at most 32 tiles, 256 MiB of cumulative response
data, and a 90-second response deadline, with 25-second server query timeouts. Individual
responses are capped at 64 MiB. One shared queue limits actual network requests to two
across all query groups. Broad annotation searches are skipped beyond a 100 km route
diagonal; specific place search and custom annotations remain available. Generic legacy
queries have a 256-tile allocation guard. They do not use the automatic scene budget.

The bundled scene provider is finite and offline. Its compressed assets total about
33 MB; the API decodes and caches geometry in server memory on first use. Asset
licenses and provenance are in the asset directory.

## Verification and remaining calibration

Automated coverage includes scale/class selection, frame parity, route-near polygon
retention, polygon holes, shared junctions, source switching, missing-source fallback,
query budgets, saved mode/scene identity, and urban rendering visibility. Browser QA
uses the actual schematic renderer with local cached OSM and generalized regional,
continental, and Great Lakes examples; editor QA covers loading, automatic defaults,
manual overrides, and reset.

Thresholds are initial product choices, not universal cartographic standards. Further
calibration should use real activity fixtures and generated-image comparisons. No paid
image-generation run was performed for this change. Cross-dateline framing remains an
existing limitation of the route/editor projection pipeline. The current policy does
not merge adjacent OSM land-cover parcels; small separate parcels can be filtered out.
