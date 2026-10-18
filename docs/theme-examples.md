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
