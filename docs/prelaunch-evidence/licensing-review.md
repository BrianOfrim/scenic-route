# Licensing review evidence — 2026-10-08

Base: `6283736df5be9a4d92a08bef0e84a427e915f89f`.
Managed isolated worktree: `/Users/brian/.codex/worktrees/a4c3/scenic-route`.
Attached by successful `create_worktree`; branch `codex/licensing-review` was created there before edits. No applicable nonempty AGENTS.md was found; `/Users/brian/.codex/AGENTS.md` is empty.

## Prepared changes

- `docs/licensing-review.md`: reviewed pipeline, primary-source citations/date, conditional permissions, concrete unresolved issues/vendor questions, public asset provenance gaps and queue integration dependency.
- `docs/prelaunch-evidence/licensing-dependencies.json`: all 277 registry entries from the pinned package lock; metadata is not a deployed-binary or license-notice audit.
- `apps/web/src/MapView.tsx`: clickable OSM copyright attribution and current Esri service-wide contributor credit linked to the World Imagery item. No provider or product feature change.

## Validation

Final validation ran in the managed isolated worktree after applying the patch. It used existing workspace dependency installations through symlinks; the earlier pinned-base validation found no installed version mismatch among available packages. No fresh npm install was performed.

- `npm run build`: passed (`tsc -b` and Vite). Existing large-chunk warning remains.
- `./node_modules/.bin/tsc -p apps/api/tsconfig.json --noEmit`: passed.
- `npm test -w @scenic-route/web`: **200 passed / 200 total** with the normal tsx launcher, outside sandbox restrictions.
- Earlier temporary-archive validation passed 199/200 tests, with the localhost dev-proxy test denied by sandbox socket permissions. The final run above resolves that validation limitation. The selected 53 grounding/theme/style/map-canvas tests also passed during preparation.
- Manual diff review confirmed attribution changes only in the map raster source metadata. Production account settings, real inference, customer emails, cloud changes and deployment were not exercised.
- No visual browser QA was completed; verify long Esri credits/collapsed MapLibre attribution at desktop/mobile widths before merge. No new mirror tests were added for the string-only change.

## Primary-source verification and limitations

Live World Imagery REST metadata was fetched on 2026-10-08 and reports `Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community`; the associated item repeats that credit and points to the Esri agreement. Current Esri credits differ from older tutorial names; the patch uses the live service-wide value. Per-extent attributions and rights remain unresolved.

OpenTopoMap's usage page direct fetch failed; review used the project repository and project-hosted indexed usage text. Current served license version/service conditions still need confirmation before enabling topo reference capture. Muse terms and designation/AUP primary pages were accessible; account/endpoint terms applicability and operational controls need follow-up. The document does not establish individual historical public asset provenance.

No export attribution compositor, OSM server cache, alternate provider, account setting, theme removal or licensing clearance claim is included. Those require the follow-up work/decisions in the review. Queue changes in the separate chat must retain provenance/references through retries and edits; this patch touches no queue files or shared checklist.

## Submission and integration

The earlier automatic-approval usage-limit blocker was resolved on continuation. The prepared patch was applied in the managed isolated worktree on branch `codex/licensing-review`; no shared-primary files were edited. Origin authentication was verified outside the sandbox. The focused PR is submitted from this branch and attached to the chat; the PR URL is recorded in the chat's completion message.

Queue PR [#146](https://cursor.com/codebase/brianofrim/scenic-route/pull/146) exists separately. This review is based on the requested pinned base, not the integrated queue branch. Validate provenance/reference persistence against the final merged queue flow; no queue work was overwritten or folded into this branch. No merge or deployment was performed.
