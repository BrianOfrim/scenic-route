# Generalized geography assets

Made with Natural Earth. These derived vector datasets are public domain:
https://www.naturalearthdata.com/about/terms-of-use/

`manifest.json` records the upstream ZIP URLs, upstream versions, SHA-256 archive
hashes, generated asset hashes, and feature counts. The `scenic-ne-1` provider
version pins the complete set. Assets are bundled with the API, never the browser
bundle. No runtime external service or API key is required for this provider.

The six layers contain roads, lakes, rivers, urban footprints, coastline, and
ocean polygons. Roads in the downloaded 5.0.0 archive span multiple continents;
coverage and detail are uneven. Urban areas represent older built-up footprints,
not legal municipal boundaries. This data is intended for generalized scenery,
not navigation or accurate local street/land-cover depiction.

Rebuild using Python with `pyshp` and `shapely` installed. Download each manifest
URL to a common prefix plus `roads.zip`, `lakes.zip`, `rivers.zip`, `urban.zip`,
`coast.zip`, and `ocean.zip`, then run:

```sh
python3 scripts/prepare-geography.py /tmp/scenic-ne-
```

The script preserves polygon topology during simplification and stores per-feature
bounding boxes for spatial filtering. It keeps only rendering/ranking metadata.
Verify source hashes before rebuilding a pinned release; bump the provider version
when changing the data or preprocessing. Runtime clipping and screen-space
selection provide the remaining scale adaptation.
