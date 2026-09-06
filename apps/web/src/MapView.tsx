import { useEffect, useRef } from "react";
import type { FeatureCollection } from "geojson";
import { Map, Marker, NavigationControl } from "./maplibre";
import type { PosterPoi } from "./api";

type Basemap = "osm" | "topo";

type Props = {
  selectedLatLng: [number, number][] | null;
  cropLatLng?: [number, number][] | null;
  cropStops?: [number, number][];
  pois?: PosterPoi[];
  basemap: Basemap;
  viewNonce?: number;
  onRemovePoi?: (name: string) => void;
};

const DEFAULT_CENTER: [number, number] = [-112.83, 53.02];
const TILES: Record<Basemap, string> = {
  osm: "/api/tiles/osm/{z}/{x}/{y}.png",
  topo: "/api/tiles/topo/{z}/{x}/{y}.png",
};

export function MapView({
  selectedLatLng,
  cropLatLng,
  cropStops,
  pois,
  basemap,
  viewNonce = 0,
  onRemovePoi,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const trackRef = useRef(selectedLatLng);
  const cropRef = useRef(cropLatLng);
  const stopsRef = useRef(cropStops);
  const poisRef = useRef(pois);
  const onRemovePoiRef = useRef(onRemovePoi);
  trackRef.current = selectedLatLng;
  cropRef.current = cropLatLng;
  stopsRef.current = cropStops;
  poisRef.current = pois;
  onRemovePoiRef.current = onRemovePoi;

  const basemapRef = useRef(basemap);

  useEffect(() => {
    if (!containerRef.current) return;
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
      if (!drawOverlays(map, trackRef.current, cropRef.current, stopsRef.current)) return;
      syncPoiMarkers(map, markersRef, poisRef.current, onRemovePoiRef);
      fit(map, cropRef.current ?? trackRef.current, 0);
    };
    map.on("load", paint);
    map.on("style.load", paint);
    return () => {
      map.off("load", paint);
      map.off("style.load", paint);
      clearMarkers(markersRef);
      map.remove();
      if (mapRef.current === map) mapRef.current = null;
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
      if (!drawOverlays(map, selectedLatLng, cropLatLng, cropStops)) {
        map.once("style.load", apply);
        return;
      }
      fit(map, cropLatLng ?? selectedLatLng, 600);
    };
    apply();
    return () => {
      map.off("style.load", apply);
    };
  }, [selectedLatLng, cropLatLng, cropStops, viewNonce]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => syncPoiMarkers(map, markersRef, pois, onRemovePoiRef);
    apply();
    if (!map.loaded()) map.once("load", apply);
    return () => {
      map.off("load", apply);
    };
  }, [pois]);

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

function stopsCollection(stops: [number, number][] | undefined): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: (stops ?? []).map(([lat, lng]) => ({
      type: "Feature" as const,
      properties: {},
      geometry: { type: "Point" as const, coordinates: [lng, lat] },
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
  cropStops: [number, number][] | undefined,
) {
  if (!map.getStyle()) return false;
  try {
    ensureSource(map, "full-track", lineCollection(selectedLatLng));
    ensureSource(map, "crop-track", lineCollection(cropLatLng ?? selectedLatLng));
    ensureSource(map, "crop-stops", stopsCollection(cropStops));
    addLine(map, "full-track-line", "full-track", "#52525b", 3, 0.4);
    addLine(map, "crop-track-casing", "crop-track", "#111111", 8, 0.9);
    addLine(map, "crop-track-line", "crop-track", "#e11d48", 4.5, 1);
    addStopLayer(map);
    return Boolean(map.getLayer("crop-track-line"));
  } catch {
    return false;
  }
}

function addStopLayer(map: Map) {
  if (map.getLayer("crop-stop-dots")) return;
  map.addLayer({
    id: "crop-stop-dots",
    type: "circle",
    source: "crop-stops",
    paint: {
      "circle-radius": 5,
      "circle-color": "#e8c36a",
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#111111",
    },
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

function clearMarkers(markersRef: { current: Marker[] }) {
  for (const marker of markersRef.current) marker.remove();
  markersRef.current = [];
}

function syncPoiMarkers(
  map: Map,
  markersRef: { current: Marker[] },
  pois: PosterPoi[] | undefined,
  onRemovePoiRef: { current?: (name: string) => void },
) {
  clearMarkers(markersRef);
  const items = Array.isArray(pois) ? pois : [];
  markersRef.current = items.map((poi) => {
    const root = document.createElement("div");
    root.className = "map-poi";
    const dot = document.createElement("span");
    dot.className = "map-poi-dot";
    const label = document.createElement("span");
    label.className = "map-poi-label";
    const name = document.createElement("span");
    name.className = "map-poi-name";
    name.textContent = poi.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "map-poi-remove";
    remove.setAttribute("aria-label", `Remove ${poi.name}`);
    remove.title = `Remove ${poi.name}`;
    remove.textContent = "×";
    remove.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onRemovePoiRef.current?.(poi.name);
    });
    label.append(name, remove);
    root.append(dot, label);
    return new Marker({ element: root, anchor: "top" }).setLngLat([poi.lng, poi.lat]).addTo(map);
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
