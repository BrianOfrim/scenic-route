# Scale-aware automatic geography

Original implementation proposal · 2026-09-28. The first implementation is now in place; see [Automatic geography](automatic-geography.md) for shipped behavior, verification, and remaining limits.

## Product decision

Make geography automatic for new posters. Remove the layer checklist from the normal workflow; keep an optional Advanced → Geography override during rollout, with Reset to automatic. Geography extent/cropping is an artistic choice separate from detail selection and should remain available in Customize. Preserve annotations-off defaults.

Do not promise literally every mapped feature on a short run. Promise all useful, legible context: a dense city still needs filtering, while a remote trail may benefit from smaller natural features. The route remains the visual priority.

Consider removing the remaining advanced layer controls only after visual fixtures and usage data show that overrides rarely improve results. Existing saved manual choices must continue to work.

## What the current implementation does

- `apps/web/src/poster/featureCatalog.ts`: `contextFeatureQuery` requests every geography category regardless of checkbox visibility; toggles affect local drawing only.
- `apps/api/src/osm/catalog.ts`: fixed selectors combine motorway through secondary in major roads, tertiary through service in streets, and rivers/streams/canals together. All geography defaults on.
- `apps/api/src/osm/features.ts`: `loadRouteFeatures` derives its query box from the full activity, fetches selected groups concurrently, converts them to buckets, and clips the result. It has no poster-scale geography policy. Named-water candidates are derived from geography, so aggressive background pruning must not accidentally remove explicitly selected annotations.
- `apps/api/src/geo.ts` and `osm/overpass.ts`: the working tree tiles boxes to a maximum 50 km diagonal (roughly 35 km square), with three concurrent tiles per query group. This is an application limit, not an Overpass service rule. There is no total tile budget in this path. Multiple concurrent groups can exceed three aggregate requests.
- `apps/api/src/osm/overpass.ts`: seven-day query cache and in-flight coalescing already exist. Results are deduplicated by OSM ID. The retained tag list excludes some useful ranking metadata, including population, width, ref, and admin_level.
- `apps/web/src/poster/grounding/mapFrame.ts`: already computes a shared fitted Web Mercator frame; `renderSchematic.ts` uses a canonical 1,024-pixel short side. These are the right foundations for scale calculations.
- `apps/web/src/poster/PosterPanel.tsx`: cropping and selected annotations influence the final schematic box after context loading. A small crop of a large activity therefore needs a new, more detailed fetch under the proposed system.
- `docs/default-workflow.md` currently specifies all layers on. Change that decision when implementation ships, not as part of this proposal.

## How this is normally handled

Overpass is a raw OSM query service. Select objects using tags and spatial filters, then apply cartographic selection and generalization downstream. There is no built-in poster scale or automatic major-feature ranking. The standard map-pipeline pattern is zoom-dependent class filtering, geometry simplification, aggregation, and sometimes changing source data.

Mapbox's vector recipe supports zoom-dependent simplification, feature limits, filtering, and unioning. OpenMapTiles explicitly uses Natural Earth for low-zoom water and OSM-derived geometry at higher zooms. These are useful precedents, not thresholds to copy blindly into a 1,024-pixel schematic.

Sources: [Overpass tag filtering](https://dev.overpass-api.de/overpass-doc/en/criteria/per_tag.html), [Mapbox vector recipe](https://docs.mapbox.com/mapbox-tiling-service/recipe-specification/vector/), [OpenMapTiles water source](https://github.com/openmaptiles/openmaptiles/blob/master/layers/water/water.yaml), [OpenMapTiles waterways](https://raw.githubusercontent.com/openmaptiles/openmaptiles/master/layers/waterway/waterway.yaml).

## Proposed pipeline

Final poster frame → scale policy → bounded source/query plan → normalized geometry → assembly and clipping → selection and simplification → one resolved geography scene → preview, schematic, and prompt.

### 1. Resolve scale from the composition

Use the cropped route, selected annotations that expand framing, final aspect ratio, padding, and actual fitted map frame. Keep a canonical logical resolution independent of browser size, device pixel ratio, or print export DPI. Panning/zooming the editor to inspect the route must not change poster content.

For a normalized Web Mercator frame, a useful diagnostic is:

`projectedMetersPerPixel = 40075016.686 × (frame.eastX - frame.westX) / logicalWidth`

Approximate ground meters/pixel at latitude φ by multiplying by `cos(φ)`. For actual feature visibility and simplification, project directly into schematic coordinates; do not rely on a center-latitude approximation across a continent. Equivalent MapLibre zoom can reuse the existing 512-pixel tile convention, but use screen-space measurements as the authoritative signal.

Route distance and sport type can be secondary hints, never the primary scale selector. Repeated laps in a small park require local detail even if the activity is long. Handle longitude wrapping before framing or querying dateline-crossing routes.

### 2. Choose a conservative retrieval profile

Start with a few internal profiles. The following thresholds are calibration hypotheses, not established cartographic standards. Express them as approximate ground meters per canonical pixel; examples assume roughly 1,000 pixels across the relevant span.

- **Local, below ~10 m/px:** streets and paths, rivers and streams, ponds, parks, woodland, relevant ground cover. Roughly a few to 10 km across.
- **District, ~10–50 m/px:** through roads, selected local connectors, rivers, meaningful lakes and green spaces; suppress service-road and minor-path clutter. Roughly 10–50 km across.
- **Regional, ~50–250 m/px:** main road network, major water, broad land cover and urban footprints. Begin using generalized sources as query budgets require. Roughly 50–250 km across.
- **Wide, above ~250 m/px:** generalized highways, ranked rivers/lakes, coastline and urban footprints. No blanket residential streets, paths, field parcels, or streams. Roughly hundreds to thousands of km across.

These describe eligibility, not all-or-nothing layer visibility. Major roads must be split into actual classes: retaining the entire current major-roads bucket would still retain secondary roads everywhere. Use regional road hierarchy and connectivity; motorway-only rules would omit important remote highways. Keep link segments needed to join retained roads, while generalizing junction complexity at wide scales.

Use coarse profiles for stable query/cache behavior and continuous screen-space thresholds for rendering. Add hysteresis near profile boundaries during interactive cropping. Background selection must not enlarge its own frame and create a feedback loop.

### 3. Filter and generalize in poster space

- Assemble relations and remove duplicate representations before measuring area. Merge connected road/river segments by compatible class and identity before pruning short chains; OSM way lengths are arbitrary editing units.
- Clip to the frame/mask for visible-footprint measurements. Retain source identity and enough surrounding geometry to preserve connections and polygon topology.
- Start experiments with ordinary polygon visibility around 12–24 px² and simplification error around 0.5–1 logical pixel. Treat these as tunable seeds. Thin rivers and coastlines require line/width rules rather than an area cutoff.
- Rank eligible features by semantic importance, visible size, route proximity/crossing, and spatial coverage. Apply category-specific density budgets, not one global top-N. A dense downtown must not consume the entire poster's feature budget.
- Protect selected annotations and recognizable route context, such as a crossed river or a lake around which the route loops. Protection should remain bounded and subject to legibility; proximity must not restore thousands of local features on a continent-wide map.
- Merge compatible adjacent land-cover polygons before size filtering where practical. Otherwise a large forest split into many OSM parcels can disappear.
- Preserve road/river junctions, polygon holes, islands, and shared boundaries. Simple independent point decimation is insufficient. Do not reuse fixed point-count thinning as the generalization algorithm.
- Keep the activity track in its own pipeline. Background simplification must never delete a route segment.

### 4. Use the right data source for each scale

**Local:** keep Overpass for targeted raw geometry. Build narrower selectors before fetching. Prefer ways/relations for polygon scenery and nodes for settlement markers. Use a finite frame-wide geography budget; only use a route corridor for fine detail or an explicitly selected corridor extent, since nearby lakes/coasts provide useful context outside the track.

**Regional/wide:** introduce a provider adapter returning the same normalized geography format from licensed generalized vector tiles or prepared spatial extracts. This should be the normal wide-scale path, not only an emergency timeout fallback. Vector tiles require boundary-fragment stitching/deduplication, buffered clipping, source metadata, and rights appropriate to generated/exported images.

Natural Earth is a useful baseline for continental water/coast/urban context, but is not a complete replacement for an OSM-derived road network. Its urban-area source is dated and its coarse shapes need visual checks against the precise activity route. For regional maps, prefer a maintained generalized OSM pipeline when possible. Prototype one regional provider and compare the same fixture renders before selecting a vendor or hosting model.

Sources: [Natural Earth lakes and intended scales](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-lakes/), [ranked rivers](https://www.naturalearthdata.com/downloads/50m-physical-vectors/50m-rivers-lake-centerlines/), [urban footprints and source age](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-urban-area/).

### 5. Treat cities and major rivers explicitly

City centers, municipal boundaries, and urban footprints are different features. For this product, default to subdued built-up footprints; use city-center markers only if outlines are unavailable, and labels only when annotations are enabled. Do not draw fabricated circles and imply they are actual city outlines. Legal boundaries can contain extensive undeveloped land and should not be silently substituted.

OSM `place=city` commonly supplies a center node, not a polygon. Add a dedicated settlement/urban bucket, provider normalization, drawing style, and prompt description. Explicitly classify it: the current generic polygon fallback in `splitWays` would otherwise risk treating unknown polygons as forest.

`waterway=river` is a useful coarse filter, not a global major-river rank. Width/name may help when available, but missing metadata must not automatically disqualify important rivers. Use generalized ranked hydrography at wide scales and connected-chain ranking locally.

Source: [OSM city mapping](https://wiki.openstreetmap.org/wiki/Tag%3Aplace%3Dcity).

## Overpass-specific implementation constraints

1. **Do not fetch everything and hide it later.** Restrict road classes and waterway types before downloading. `water=lake` alone does not guarantee a large lake, and requiring that tag loses some `natural=water` objects. Use bounded candidate retrieval locally and precomputed size/rank data at wider scales.
2. **Do not use `length()` as importance.** Overpass exposes way length and relation member-length sums. These are not river-system lengths or lake area, so thresholding raw ways creates gaps. An OSM Overpass “area” is also a spatial query object, not an automatic square-meter ranking. [QL evaluator documentation](https://wiki.openstreetmap.org/wiki/OverpassQL#Length).
3. **Output bounds are separate from selection bounds.** `out geom(bbox)` can reduce distant geometry, but produces incomplete/disconnected fragments. It is not topology-safe polygon clipping. Current OSM-ID deduplication would discard later fragments of the same object if output were cropped per tile. Retain full geometry within bounded local queries, or redesign fragment assembly before using cropped output. Also test giant polygons enclosing the frame: node-based bbox selection is not a general polygon-intersection query. [Overpass bounding-box semantics](https://dev.overpass-api.de/overpass-doc/en/full_data/bbox.html).
4. **Bound total work, not only each tile.** Put all groups through a shared per-endpoint queue. Add request-count, cumulative-byte, vertex, and elapsed-time budgets before allocating large grids. Respect rate-limit responses with backoff; do not use endpoint rotation to escape quotas. Confirm endpoint geographic coverage before treating it as a global fallback.
5. **Switch source or reduce optional detail deterministically on budget exhaustion.** Preserve route and essential context. Report degraded/incomplete data explicitly in context metadata; do not present a failed fetch as an intentionally empty landscape.
6. **Plan production capacity.** The main public service gives approximate guidance of 10,000 requests and 1 GB per day and cautions against consumer apps depending on public instances as their backend. These are shared-service guidelines, not a per-user allowance or SLA. Use managed capacity or your own infrastructure as usage grows. 180 seconds is the default timeout, not a universal maximum. [Overpass resource guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html).

## Contracts and integration

Introduce a shared, pure `resolveGeographyPolicy(frame, options)` with a policy version, query profile, logical resolution, allowed classes, screen-space thresholds, and budgets. The server validates frame size and enforces budgets; do not trust a client-requested local profile for an enormous bbox.

Separate candidate context from resolved scene. The scene should include visible feature IDs/categories, source and policy versions, completeness, and diagnostics. All preview/export/prompt paths consume this scene. The planner must describe geography actually drawn rather than every enabled catalog category. Keep annotation candidates available independently of background simplification.

Extend context requests and request coalescing keys with crop/frame coverage, query profile, provider, and policy version. Reuse cached raw data for pure visibility changes; refetch when a crop needs classes absent from the existing candidate set or the frame expands outside fetched coverage. Recompute masks and satellite alignment from the same frame. Cancel or ignore stale responses.

For saved setup, persist `geographyMode: auto | manual`, policy version, overrides, and resolved source/scene identity. Retain the existing manual feature IDs for legacy records; old snapshots cannot reliably tell whether a user deliberately chose all layers. Pin a resolved scene or persist geometry when exact re-rendering matters, since policy version alone cannot freeze changing upstream data. Provide an explicit Reset to automatic migration.

## Delivery sequence

1. **Policy and fixtures:** extract shared frame/scale helpers, introduce the pure policy and normalized metadata, and build a fixture runner. Render local dense/sparse and wide routes before choosing thresholds.
2. **Local/district automatic selection:** narrow Overpass queries, introduce shared budgets, generalize backgrounds, and pass the resolved scene consistently to rendering and prompting. Wire crop-aware reloads and snapshot persistence.
3. **Regional/wide provider:** add generalized water, road, urban, and coastline data behind the common adapter; verify seams, rank, geographic coverage, and fallback behavior. Cross-country support is not complete until this phase is validated.
4. **UI rollout:** default new posters to auto, move overrides into Advanced, preserve saved posters, and update default-workflow documentation. Compare auto versus prior renders behind a rollout flag before removing controls further.

## Acceptance checks

- Fixture set: short urban run, dense downtown run, remote hike, long ride in a compact area, regional ride, cross-country trip, Great Lakes shoreline, small crop from a huge trip, high latitude, and dateline crossing. Use existing example routes where applicable.
- Same composition produces the same geography at different browser sizes and export DPI; aspect ratio and meaningful crop changes update scale correctly.
- Finer eligible classes are not fetched at wide scale. Oversized requests fail or switch providers before creating an unbounded tile plan. Test aggregate concurrency across query groups.
- Important route context survives clutter pruning. Connected roads/rivers have no artificial gaps, land-cover parcel splitting does not erase large areas, and lake holes/coastlines remain valid.
- Saved manual setups restore unchanged; new auto setups preserve their policy/source state; route-only annotations remain off. Preview, schematic, and planner agree on visible geography.
- Visual inspection at canonical schematic resolution, plus a small fixed sample of generated posters: simplifying the schematic must actually improve final output, not just API timings.
- Record cold/warm latency, query count, payload bytes, retained feature/vertex counts, completeness/fallback rate, and override usage. Establish release performance thresholds from baseline measurements rather than inventing an SLA in this plan.

Research was documentation-based; no live Overpass load benchmark or image-model comparison was run for this planning task.
