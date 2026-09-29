# Automatic geography

New posters choose geography from their final, cropped schematic frame. Editor
zoom, device pixel ratio, and export resolution do not change content. The shared
policy uses a logical 1,024-pixel short side and the same aspect fit and 3% margin
as schematic rendering; parity tests cover every aspect and high latitudes.

## Policy version 1

- Below 10 ground meters per logical pixel: local roads, streets, paths, water,
  parks, forest, and other useful ground cover.
- 10–50 m/px: through roads, rivers/canals, larger water and green spaces.
- 50–250 m/px: generalized regional scenery.
- Above 250 m/px: generalized continental scenery.

Local and district retrieval uses class-specific Overpass selectors. Regional and
wide retrieval uses the bundled `scenic-ne-1` Natural Earth provider. A local frame
requiring more than eight query tiles also uses the generalized provider. Budget
exhaustion or source failures produce an explicit fallback warning.

Geometry is clipped to the aspect-fitted frame, then filtered by visible polygon
area. Ordinary areas need 12 pixels² locally or 24 pixels² at other scales. Areas
near the route can survive down to 3 pixels². Dense minor streets/paths away from
the route are suppressed. Lines use 0.65-pixel simplification with shared junction
vertices protected. Major roads and rivers are not discarded based on the length
of individual OSM ways. Polygon rings and holes are retained; the bundled data is
topologically simplified during preprocessing.

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

Advanced geography allows manual layers and Reset to automatic. Manual mode preserves
all fetched features, while retaining retrieval safety limits. At wide scales its
available categories are still those in the generalized provider.

## Resource limits

Automatic Overpass queries permit at most eight tiles, 48 MiB of cumulative response
data, and a 90-second response deadline, with 25-second server query timeouts. Individual
responses are capped at 32 MiB. One shared queue limits actual network requests to two
across all query groups. Broad annotation searches are skipped beyond a 100 km route
diagonal; specific place search and custom annotations remain available. Generic legacy
queries have a 256-tile allocation guard. They do not use the automatic scene budget.

The bundled scene provider is finite and offline, but loads approximately 29 MiB of
compressed assets into server memory on first use. Cache its decoded geometry for the
life of the process. Asset licenses and provenance are in the asset directory.

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
