import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export const Map = maplibregl.Map;
export type Map = InstanceType<typeof maplibregl.Map>;
export const NavigationControl = maplibregl.NavigationControl;
