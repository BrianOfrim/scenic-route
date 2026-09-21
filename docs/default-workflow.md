# Default poster workflow

**Decision: Proposal A — One-tap generate** (locked 2026-09-17)

**Intent:** Fewest steps to a good poster. Crop, geography, annotations, and other controls stay available but off the default path.

## Default path

1. Sign in
2. Import GPX, FIT, TCX, or a complete account-export ZIP
3. Pick an activity
4. **Make poster** (smart defaults; optional last-used theme)
5. Gallery → download / refine

## Smart defaults (on Make poster)

- Full track (no crop UI on default path)
- Annotations off (`routeOnly: true`)
- Geography: **all layers on**, with controls collapsed by default on desktop and available in the Geography tab in mobile Customize.
- One theme: **Risograph** (auto-selected); last-used later if we add memory
- 1 variant, default aspect
- Hide planner refs / schematic on default path

## Advanced (Customize / Edit setup)

Crop, themes, geography layers + distances, annotations, multi-theme, N variants, palettes, planner refs.

Preserve: Edit Setup restores generation-time state; desktop ≥900px three-column; route accuracy first; landmarks stay off unless user enables annotations.

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
