import { useEffect, useRef } from "react";
import type { FeatureCollection } from "geojson";
import { Map, NavigationControl } from "./maplibre";
import type { PosterPoi } from "./api";

type Basemap = "osm" | "topo";

type Props = {
  selectedLatLng: [number, number][] | null;
  cropLatLng?: [number, number][] | null;
  pois?: PosterPoi[];
  basemap: Basemap;
  viewNonce?: number;
};

const DEFAULT_CENTER: [number, number] = [-112.83, 53.02];
const TILES: Record<Basemap, string> = {
  osm: "/api/tiles/osm/{z}/{x}/{y}.png",
  topo: "/api/tiles/topo/{z}/{x}/{y}.png",
};

export function MapView({ selectedLatLng, cropLatLng, pois, basemap, viewNonce = 0 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const trackRef = useRef(selectedLatLng);
  const cropRef = useRef(cropLatLng);
  const poisRef = useRef(pois);
  trackRef.current = selectedLatLng;
  cropRef.current = cropLatLng;
  poisRef.current = pois;

  const basemapRef = useRef(basemap);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new Map({
      container: containerRef.current,
      style: styleFor(basemap),
      center: DEFAULT_CENTER,
      zoom: 10,
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    const paint = () => {
      map.resize();
      if (!drawOverlays(map, trackRef.current, cropRef.current, poisRef.current)) return;
      fit(map, cropRef.current ?? trackRef.current, 0);
    };
    map.on("load", paint);
    map.on("style.load", paint);
    return () => {
      map.off("load", paint);
      map.off("style.load", paint);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || basemapRef.current === basemap) return;
    basemapRef.current = basemap;
    map.setStyle(styleFor(basemap));
  }, [basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (!drawOverlays(map, selectedLatLng, cropLatLng, pois)) {
        map.once("style.load", apply);
        return;
      }
      fit(map, cropLatLng ?? selectedLatLng, 600);
    };
    apply();
    return () => {
      map.off("style.load", apply);
    };
  }, [selectedLatLng, cropLatLng, pois, viewNonce]);

  return <div ref={containerRef} className="map" />;
}

function styleFor(basemap: Basemap) {
  return {
    version: 8 as const,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      tiles: {
        type: "raster" as const,
        tiles: [TILES[basemap]],
        tileSize: 256,
        attribution: basemap === "topo" ? "© OpenTopoMap" : "© OpenStreetMap",
      },
    },
    layers: [
      { id: "background", type: "background" as const, paint: { "background-color": "#1b1d16" } },
      { id: "tiles", type: "raster" as const, source: "tiles", paint: { "raster-opacity": 0.92 } },
    ],
  };
}

function lineCollection(latlng: [number, number][] | null | undefined): FeatureCollection {
  if (!latlng || latlng.length < 2) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: latlng.map(([lat, lng]) => [lng, lat]) },
      },
    ],
  };
}

function pointCollection(pois: PosterPoi[] | undefined): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: (pois ?? []).map((poi) => ({
      type: "Feature" as const,
      properties: { name: poi.name },
      geometry: { type: "Point" as const, coordinates: [poi.lng, poi.lat] },
    })),
  };
}

function ensureSource(map: Map, id: string, data: FeatureCollection) {
  const source = map.getSource(id);
  if (source && "setData" in source) {
    (source as { setData: (data: FeatureCollection) => void }).setData(data);
    return;
  }
  if (!map.getSource(id)) {
    map.addSource(id, { type: "geojson", data });
  }
}

function drawOverlays(
  map: Map,
  selectedLatLng: [number, number][] | null,
  cropLatLng: [number, number][] | null | undefined,
  pois: PosterPoi[] | undefined,
) {
  if (!map.getStyle()) return false;
  try {
    ensureSource(map, "full-track", lineCollection(selectedLatLng));
    ensureSource(map, "crop-track", lineCollection(cropLatLng ?? selectedLatLng));
    ensureSource(map, "pois", pointCollection(pois));
    addLine(map, "full-track-line", "full-track", "#52525b", 3, 0.4);
    addLine(map, "crop-track-casing", "crop-track", "#111111", 8, 0.9);
    addLine(map, "crop-track-line", "crop-track", "#e11d48", 4.5, 1);
    if ((pois?.length ?? 0) > 0) addPoiLayers(map);
    return Boolean(map.getLayer("crop-track-line"));
  } catch {
    return false;
  }
}

function addPoiLayers(map: Map) {
  if (map.getLayer("poi-dots")) return;
  map.addLayer({
    id: "poi-dots",
    type: "circle",
    source: "pois",
    paint: { "circle-radius": 4, "circle-color": "#f4efe4", "circle-stroke-width": 1.5, "circle-stroke-color": "#111" },
  });
  map.addLayer({
    id: "poi-labels",
    type: "symbol",
    source: "pois",
    layout: {
      "text-field": ["get", "name"],
      "text-size": 11,
      "text-offset": [0, 1],
      "text-anchor": "top",
    },
    paint: { "text-color": "#f4efe4", "text-halo-color": "#111", "text-halo-width": 1 },
  });
}

function addLine(map: Map, id: string, source: string, color: string, width: number, opacity: number) {
  if (map.getLayer(id)) return;
  map.addLayer({
    id,
    type: "line",
    source,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": color, "line-width": width, "line-opacity": opacity },
  });
}

function fit(map: Map, latlng: [number, number][] | null | undefined, duration: number) {
  if (!latlng || latlng.length < 2) return;
  let minLng = latlng[0][1];
  let minLat = latlng[0][0];
  let maxLng = latlng[0][1];
  let maxLat = latlng[0][0];
  for (const [lat, lng] of latlng) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  map.fitBounds(
    [
      [minLng, minLat],
      [maxLng, maxLat],
    ],
    { padding: 72, maxZoom: 14, duration },
  );
}
