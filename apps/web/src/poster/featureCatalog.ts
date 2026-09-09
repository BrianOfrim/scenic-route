export type FeatureOption = {
  id: string;
  label: string;
  group: "geography" | "landmarks";
  defaultOn: boolean;
};

export const FEATURE_CATALOG: FeatureOption[] = [
  { id: "major-roads", label: "Major roads", group: "geography", defaultOn: true },
  { id: "streets", label: "Residential streets", group: "geography", defaultOn: true },
  { id: "paths", label: "Paths & trails", group: "geography", defaultOn: true },
  { id: "rail", label: "Railways", group: "geography", defaultOn: true },
  { id: "lakes", label: "Lakes & ponds", group: "geography", defaultOn: true },
  { id: "rivers", label: "Rivers & streams", group: "geography", defaultOn: true },
  { id: "forest", label: "Forest", group: "geography", defaultOn: true },
  { id: "parks", label: "Parks & green space", group: "geography", defaultOn: true },
  { id: "farmland", label: "Farmland", group: "geography", defaultOn: true },
  { id: "peaks", label: "Peaks", group: "landmarks", defaultOn: true },
  { id: "towns", label: "Towns & villages", group: "landmarks", defaultOn: true },
  { id: "neighbourhoods", label: "Neighbourhoods", group: "landmarks", defaultOn: true },
  { id: "named-water", label: "Named water", group: "landmarks", defaultOn: true },
  { id: "strava-segments", label: "Named trails", group: "landmarks", defaultOn: true },
  { id: "viewpoints", label: "Viewpoints & attractions", group: "landmarks", defaultOn: true },
  { id: "historic", label: "Historic places", group: "landmarks", defaultOn: false },
  { id: "named-parks", label: "Named parks & reserves", group: "landmarks", defaultOn: true },
  { id: "structures", label: "Bridges, towers, lighthouses", group: "landmarks", defaultOn: true },
  { id: "food", label: "Cafes, pubs & restaurants", group: "landmarks", defaultOn: false },
  { id: "worship", label: "Places of worship", group: "landmarks", defaultOn: false },
  { id: "lodging", label: "Campsites & huts", group: "landmarks", defaultOn: false },
  { id: "playgrounds", label: "Playgrounds", group: "landmarks", defaultOn: false },
  { id: "schools", label: "Schools", group: "landmarks", defaultOn: false },
  { id: "colleges", label: "Colleges & universities", group: "landmarks", defaultOn: true },
  { id: "cemeteries", label: "Cemeteries", group: "landmarks", defaultOn: false },
];

export const DEFAULT_FEATURE_IDS = FEATURE_CATALOG.filter((item) => item.defaultOn).map((item) => item.id);
