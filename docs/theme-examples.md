# Theme examples

The Themes step and mobile quick-create screen have a **Browse examples** modal.
Desktop selections apply immediately and preserve multiple themes; mobile **Use this
theme** selects one theme. Viewing images never changes a selection. In a theme's
detail view, **Use theme + palette** selects that theme and replaces only its palette
selection. Other desktop theme selections remain selected.

Samples are stable WebP files, separate from account-scoped poster storage. The
manifest contains only theme IDs, palette IDs, and static image paths. No user IDs,
private storage keys, prompts, or generation metadata are included.

The initial collection contains 42 Beltline Trail samples covering all 13 themes
and every available palette. Themes with fixed presets default to their first named
palette; Risograph retains Auto to choose inks dynamically. The samples use Meta Muse Image and a 3:4 poster
ratio. To replace the set, prepare a reviewed folder with `manifest.json` and its
WebP files, then run:

```sh
node --import tsx scripts/install-theme-examples.mts <reviewed-sample-folder> --check
node --import tsx scripts/install-theme-examples.mts <reviewed-sample-folder>
npm run build
```

The installer validates complete theme and palette coverage and copies only the
reviewed WebP images and public manifest. A replacement collection uses the same
manifest shape and filenames. Thumbnails have a maximum dimension of 400px; expanded
images have a maximum dimension of 1400px. Both preserve the whole poster.
