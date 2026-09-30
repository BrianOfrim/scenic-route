# Default poster workflow

**Decision: Proposal A — One-tap generate** (locked 2026-09-17)

**Intent:** Fewest steps to a good poster. Crop, geography, and other controls stay available but off the default path. Annotations are temporarily paused.

## Default path

1. Sign in
2. Import GPX, FIT, TCX, or a complete account-export ZIP
3. Pick an activity
4. **Make poster** (smart defaults; optional last-used theme)
5. Gallery → download / refine

## Smart defaults (on Make poster)

- Full track (no crop UI on default path)
- Annotations off (`routeOnly: true`)
- Geography: **automatic detail for the final poster frame**. Local views use filtered OpenStreetMap detail; regional and continental views use bundled generalized roads, water, coastline, and urban footprints. Manual layer overrides live in Advanced geography, with Reset to automatic. Existing saved setups retain manual mode.
- One theme: **Swiss** (auto-selected); last-used later if we add memory
- 1 variant, default aspect
- Hide planner refs / schematic on default path

## Advanced (Customize / Edit setup)

Crop, themes, geography layers + distances, multi-theme, N variants, palettes, planner refs. The planner receives the reference images as well as their metadata.

References share the same north-up map frame and scale: a red route on white, the schematic with that same red track, and satellite context with the same track plus a white contrast halo. Exported PNG references retain every GPS vertex and segment break without JPEG artifacts around the route. With two reference slots, send route-only and schematic; with one, send the schematic. Keep these images at full resolution rather than packing them into contact sheets.

Preserve: Edit Setup restores generation-time state; desktop ≥900px three-column; route accuracy first; new setups keep landmarks, coloured trail annotations and named regions off. Saved setups replan using current rules; existing gallery artwork and annotation records are retained.

## Build order (mobile-first)

Ship ≤899px first; keep desktop ≥900px three-column unless shared defaults require a tiny change.

1. Codify default `PosterSetup` in code + this doc.
2. Mobile default surface: activity + **Make poster** (+ secondary **Customize**); no crop on half-sheet.
3. **Customize** opens full controls (current sheet).
4. Remember last theme per user.
5. Optional: regenerate with same settings from gallery.
6. Desktop parity later if needed.

## Rejected for now

- **B** Theme-first grid as required step
- **C** Auto-generate with no CTA
