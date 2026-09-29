"""Build pinned public-domain scenery assets from Natural Earth source ZIPs.

Usage: python3 scripts/prepare-geography.py /tmp/scenic-ne-
Requires pyshp and shapely. ZIP suffixes: roads, lakes, rivers, urban, coast, ocean.
Source URLs, archive hashes and source versions are written into manifest.json.
"""
import gzip
import hashlib
import io
import json
from pathlib import Path
import sys
import zipfile

import shapefile
from shapely.geometry import shape, mapping
from shapely import make_valid

root = Path(__file__).resolve().parents[1] / "apps/api/assets/geography"
sources = {
    "roads": ("roads", "10m_cultural/ne_10m_roads.zip"),
    "lakes": ("water", "10m_physical/ne_10m_lakes.zip"),
    "rivers": ("waterways", "10m_physical/ne_10m_rivers_lake_centerlines.zip"),
    "urban": ("urban", "10m_cultural/ne_10m_urban_areas.zip"),
    "ocean": ("ocean", "10m_physical/ne_10m_ocean.zip"),
    "coast": ("coastline", "10m_physical/ne_10m_coastline.zip"),
}
manifest = {"provider": "natural-earth", "version": "scenic-ne-1", "license": "Public domain",
            "licenseUrl": "https://www.naturalearthdata.com/about/terms-of-use/", "layers": {}}
for key, (bucket, source) in sources.items():
    data = Path(sys.argv[1] + key + ".zip").read_bytes()
    archive = zipfile.ZipFile(io.BytesIO(data))
    base = next(n[:-4] for n in archive.namelist() if n.endswith(".shp"))
    reader = shapefile.Reader(**{ext: io.BytesIO(archive.read(base + "." + ext)) for ext in ["shp", "shx", "dbf"]})
    features = []
    for i, record in enumerate(reader.iterShapeRecords()):
        props = record.record.as_dict()
        geom = shape(record.shape.__geo_interface__)
        if not geom.is_valid:
            geom = make_valid(geom)
        # < 23 m latitude error, below half a pixel at the provider's normal entry scale.
        geom = geom.simplify(.0002, preserve_topology=True)
        if geom.is_empty or geom.geom_type == "GeometryCollection":
            continue
        features.append({"type": "Feature", "bbox": list(geom.bounds), "properties": {
            "id": f"ne/{key}/{i}", "name": props.get("name_en") or props.get("name") or None,
            "minZoom": props.get("min_zoom", 0), "rank": props.get("scalerank", 0),
            "class": "primary" if key == "roads" else bucket,
        }, "geometry": mapping(geom)})
    encoded = json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")).encode()
    packed = gzip.compress(encoded, mtime=0)
    (root / (bucket + ".geojson.gz")).write_bytes(packed)
    versions = [archive.read(n).decode().strip() for n in archive.namelist() if "VERSION" in n.upper()]
    manifest["layers"][bucket] = {"url": "https://naturalearth.s3.amazonaws.com/" + source,
        "sourceVersion": versions, "sha256": hashlib.sha256(data).hexdigest(),
        "assetSha256": hashlib.sha256(packed).hexdigest(), "features": len(features)}
    print(bucket, len(features), len(packed))
(root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
