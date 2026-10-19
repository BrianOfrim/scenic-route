# Theme examples

The Themes step and mobile quick-create screen have a **Browse examples** modal.
Desktop selections apply immediately and preserve multiple themes; mobile **Use this
theme** selects one theme. Viewing images never changes a selection. Desktop palette checkboxes select multiple
palettes per theme and immediately sync with the composer; selecting a palette also
selects its theme. Deselecting the final palette deselects the theme. On mobile, **Use theme + palette** selects the theme and its single palette.
Desktop checkbox changes preserve other themes and their palettes.

Both the theme selection UI and the example gallery use the same four groups:
Modern (Minimal, Modernist, Bauhaus, Risograph), Classic (WPA park, Linen postcard,
Art deco, Art nouveau), Technical (Vintage topo, Blueprint), and Whimsical
(Watercolor, Middle-earth, 16-bit RPG). Custom is outside these preset groups.

Samples are stable WebP files, separate from account-scoped poster storage. The
manifest contains only theme IDs, palette IDs, and static image paths. No user IDs,
private storage keys, prompts, or generation metadata are included.

The collection contains 29 Martin Goodman Trail samples covering all 13 themes
and every available palette. Themes with fixed presets default to their first named
palette: Minimal Red, Modernist Studio, Risograph Fluorescent pink + teal,
WPA park Park, Art deco Black and gold, Linen postcard Chrome, Art nouveau Mucha spring,
Bauhaus Primary, and 16-bit RPG Overworld. Risograph no longer offers Auto;
legacy Auto selections resolve to Fluorescent pink + teal. Watercolor chooses washes
from the map; the fixed-color themes retain their signature colors.
The selected samples use Meta Muse Image and a 2:3 poster ratio. To replace the set, prepare a reviewed folder with `manifest.json` and its
WebP files, then run:

```sh
node --import tsx scripts/install-theme-examples.mts <reviewed-sample-folder> --check
node --import tsx scripts/install-theme-examples.mts <reviewed-sample-folder>
npm run build
```

The installer validates complete theme and palette coverage and copies only the
reviewed WebP images and public manifest. The current collection lives under `/theme-examples/martin-goodman/` and keeps the
same manifest shape and theme/palette filenames. Thumbnails have a maximum dimension of 400px; expanded
images have a maximum dimension of 1400px. Both preserve the whole poster. Expanded WebPs use quality 82; thumbnails use quality
80. The landing explorer loads only the current expanded image and reads its accent
color from the manifest, avoiding eager downloads of the entire collection.

Generate both versions directly from the original PNG, preserving its aspect ratio
and without upscaling or cropping. Recompute manifest accents with the installer.

## Local theme example studio

With `npm run dev` running, sign in and open
[Theme studio](http://localhost:5174/dev/theme-examples/review). The entry point is
also in the map header during development. These controls are unavailable in a
production build.

1. Choose **Configure poster**, select an activity, and use the normal composer
   to set the crop, map, landmarks, text, aspect ratio, and image model.
2. In the composer footer, set **Variants per combination** (1–100) and choose
   **Run all themes × N variants**. The configured theme selection is ignored;
   all preset theme/palette combinations are enumerated from `POSTER_STYLES`.
   Custom is excluded. There are currently 29 combinations, so four variants
   produce 116 images. Exactly one image model must be selected.
3. Leave the app tab open. The studio keeps up to eight single-image jobs in flight at once
   through the normal API and worker, refilling slots as images finish. This supports models with only one output
   and respects existing account selection, queue, and credit limits. A failed
   submission pauses new work after the current requests settle and displays its error. Use **Retry variant N** on an incomplete or failed variant card to retry
   that image, or manage accepted jobs in Gallery.
4. Enlarge candidates and pick one winner per combination. Use **Unpicked only**
   to work through the remainder. Selections save immediately.
5. **Export winners (.zip)** creates `manifest.json`, expanded WebPs (1400px,
   quality 82), thumbnails (400px, quality 80), and `selections.json`. Extract the
   archive, run the installer with `--check`, and install the reviewed set using
   the commands above. Export does not replace the public examples.

Runs, reference images, completed candidate metadata, and selections are saved in
IndexedDB in this browser, scoped to the signed-in account. Reopening the studio
lets you choose a saved run and resume. Keep the same browser and origin; clearing
site data removes local runs. Each image has a stable submission ID and exact
saved request, so retrying after a lost response reuses the accepted server job.
Only one studio runner can hold the account's browser lock at a time. Closing or
leaving the studio stops future submissions; an accepted server job continues.

The export uses the installer's existing `martin-goodman` asset namespace. For the
current public collection, configure the Martin Goodman Trail activity. If using
a different route for a replacement collection, update `THEME_EXAMPLE_ROUTE` and
the collection description to match before publishing.

Studio thumbnails load near the viewport with at most two downloads in parallel.
They are cached locally by account and image URL, independently of the image API's
`no-store` responses. Full-size previews use a separate request slot, display the
thumbnail while the original loads, and expose loading, failure, and retry states.
The normal Gallery is unmounted while the studio is open to avoid background
catalog requests competing with review images.

Each theme/palette section has **Generate another variant** (or **Queue another
variant** while running). This adds exactly one candidate using that run's saved setup,
without resuming unfinished work for other combinations. Existing candidates and
winner selections are preserved. Section counts include any additional variants;
the extra request is saved before submission and can be resumed after interruption.

Incomplete variants appear as individual cards with **Retry variant N**. The
studio rechecks the saved submission and requeues its existing server job if it
failed, respecting server retry cooldowns. It generates only that variant and
preserves its submission ID, prior candidates, and winner selections. Failure
messages and retry times are saved locally; a failed retry requires another
explicit click rather than automatically repeating paid attempts.

You can click additional-variant and retry buttons across multiple sections while
work is running. Requests join one shared queue with at most eight images in
flight. A variant already queued has its retry button disabled to prevent duplicate
retry requests. Individual server failures are saved without blocking other queued
variants; ambiguous network failures pause new submissions until you resume.
