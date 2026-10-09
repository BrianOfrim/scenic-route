# Dependency advisories — 2026-10-08

Production and development dependency upgrades split out of the generation-log redaction work. No application source changes.

## Advisory review and fixes

npm registry audit and GitHub reviewed advisory sources were checked on October 8, 2026.

- Production audit reported MapLibre GL JS critical attribution sanitizer bypass, [GHSA-jrc7-96c5-q579](https://github.com/advisories/GHSA-jrc7-96c5-q579), affecting versions through 6.4.0. Locked 5.24.0 is upgraded to 6.13.0. The web manifest now requires ^6.13.0. Transitive MapLibre packages move with that upgrade, including maplibre-gl-style-spec 26.4.4.
- Production audit reported Sharp high-severity librsvg issue, [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w), affecting versions below 0.35.5. Sharp and its platform binaries are upgraded to 0.35.5. Bundled libvips packages are upgraded to 1.3.4.
- Full audit also reported development-tool advisories: [shell-quote command injection](https://github.com/advisories/GHSA-pqg4-j6r4-53mv) and [source-map-js denial of service](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). Compatible lockfile fixes update concurrently to 9.2.5, shell-quote to 1.12.0, and source-map-js to 1.2.2.

Audit results reflect known advisories at review time, not a comprehensive security assessment.

## Pending checks

MapLibre is a major-version upgrade. Compile and map/poster tests were run on the combined branch before this split. An interactive browser smoke test of live maps, custom styles, attribution, and schematic exports remains pending. No deploy or merge was performed.
