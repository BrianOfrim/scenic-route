# Open Canadian routes for examples and marketing

Tracks we can ship on the landing page and in style examples. Every line below is OpenStreetMap (ODbL) or Parks Canada open data (Open Government Licence – Canada).

Leave Strava, AllTrails, Komoot, Gaia, Wikiloc, and personal Garmin recordings out of marketing. Those files are not licensed for this.

## Attribution

- OpenStreetMap posters and any GPX we ship from OSM: **© OpenStreetMap contributors**. Shipping the GPX keeps it under ODbL.
- Parks Canada trails: **Contains information licensed under the Open Government Licence – Canada.**

## How to export

| Source | How to get a line |
|---|---|
| OSM road route | Open the relation. Export in way order (JOSM or a relation-ordered GPX). An unordered way dump draws as a scribble. |
| Waymarked hiking | [hiking.waymarkedtrails.org](https://hiking.waymarkedtrails.org). The GPX is built in the browser from the route JSON. There is no stable `/gpx` URL. |
| Waymarked cycling | `https://cycling.waymarkedtrails.org/#route?id=ID` |
| Parks Canada | Trails (Temporary) GeoJSON or KML, then `ogr2ogr -f GPX`. The importer wants GPX. |

Parks Canada dataset: [Trails APCA](https://open.canada.ca/data/en/dataset/64a90e8d-5bc0-4027-8645-b5881b4068d4) (record `64a90e8d-5bc0-4027-8645-b5881b4068d4`).

- GeoJSON: `https://opendata.arcgis.com/datasets/f7ec423fdd944451ac312925fa5d52d5_0.geojson`
- KML: `https://opendata.arcgis.com/datasets/f7ec423fdd944451ac312925fa5d52d5_0.kml`
- Feature service: `https://services2.arcgis.com/wCOMu5IS7YdSyPNx/arcgis/rest/services/Trails_Sentiers_APCA_Temporary_Temporaire_APCA_OpenOuvert/FeatureServer/0`

About 3,136 features. `Name_Official_e` and `Trail_system_reseau_de_sentiers` are often empty. Use the Trails (Temporary) layer. Skip the deprecated layer. The file does not include the West Coast Trail, Cabot Trail, either Skyline, Crypt Lake, or Gros Morne.

Lengths below are mapped length unless marked official.

## Recommended sample set

Short list for the landing page. Each one reads as a place, and the line is short enough for one poster.

| Route | Kind | Why it works |
|---|---|---|
| Cabot Trail | Drive, OSM | Closed loop, Cape Breton. Road relation below. |
| Icefields Parkway | Drive, OSM | Lake Louise–Jasper. One relation. |
| West Coast Trail | Hike, OSM | Pacific Rim. The name is the poster. |
| Skyline, Cape Breton Highlands | Hike, OSM | 6.6 km loop over the Cabot Trail. Good thumbnail. |
| Sentinel Pass + Larch Valley | Hike, Parks Canada | Banff day hikes people recognize. |
| Johnston Canyon to the Ink Pots | Hike, Parks Canada | Short, named, Rockies. |
| Banff Legacy Trail | Bike, Parks Canada | Paved valley line. |
| Juan de Fuca Marine Trail or Fundy Footpath | Hike, OSM | Coast, if the Rockies set already covers the mountains. |

City posters: Vancouver Seaside Greenway, Edmonton north and south bank together, Toronto Martin Goodman Trail, Montreal Lachine Canal.

## Scenic drives (OSM road relations)

`route=road` is not on Waymarked. Keep member ways in relation order.

| Route | Relation | Notes |
|---|---|---|
| Icefields Parkway, Lake Louise–Jasper | [15588](https://www.openstreetmap.org/relation/15588) | Single drive. |
| Cabot Trail loop | [16153464](https://www.openstreetmap.org/relation/16153464) | Unsigned Trunk 30 plus Hwy 105 exits 7–11. `roundtrip=yes`. Hiking relation [21185617](https://www.openstreetmap.org/relation/21185617) is a smaller Cabot Trail hike. Use the road relation for the drive. |
| Dempster Highway | [5386003](https://www.openstreetmap.org/relation/5386003) (YT ref 5) and [5384727](https://www.openstreetmap.org/relation/5384727) (NT ref 8) | Split on the territorial border. Join both. Very long for one poster. |

Sea-to-Sky is ordinary highway ways. No single route relation was confirmed.

## Hiking (OSM, via Waymarked)

| Route | km | Relation | Link |
|---|---|---|---|
| West Coast Trail, Pacific Rim | 76 | 6955341 | [route](https://hiking.waymarkedtrails.org/#route?id=6955341) |
| Skyline Trail, Jasper (Maligne Lake to Signal) | 45 mapped / 44.1 official | 18816093 | [route](https://hiking.waymarkedtrails.org/#route?id=18816093). Linear. Parks Canada operates it. Absent from the Parks Canada open file under this name. |
| Skyline Trail, Cape Breton Highlands | 6.6 loop | 15081831 | [route](https://hiking.waymarkedtrails.org/#route?id=15081831). Operator: Cape Breton Highlands National Park. Absent from the open file. |
| Juan de Fuca Marine Trail (China Beach–Botanical Beach) | 40 | 7518802 | [route](https://hiking.waymarkedtrails.org/#route?id=7518802). BC Parks. |
| Fundy Footpath | 38 | 4077806 | [route](https://hiking.waymarkedtrails.org/#route?id=4077806). Mostly outside Fundy National Park. |
| Berg Lake, Mount Robson | ~19 mapped | 6035635 | [route](https://hiking.waymarkedtrails.org/#route?id=6035635). BC Parks quotes ~23 km one way. Check that the line reaches the lake. |
| Chilkoot | 50 mapped / 53 official | 1225005 | [route](https://hiking.waymarkedtrails.org/#route?id=1225005). Starts at Dyea, Alaska (US NPS and Parks Canada). Say that the start is in the US. |
| East Coast Trail, Newfoundland | 316 mapped / 312 official | 2199386 | [route](https://hiking.waymarkedtrails.org/#route?id=2199386). Too long for one poster; use a section. Operator is the East Coast Trail Association. Dublin “East Coast Trail” bicycle relations are a different trail. |

Skip for a single poster: Edmonton Trans Canada Trail [7726718](https://www.openstreetmap.org/relation/7726718) (91 km) and Amisk Wacîw Mêskanaw [21082443](https://www.openstreetmap.org/relation/21082443) (85 km). Both sprawl. Montreal TCT [7625846](https://www.openstreetmap.org/relation/7625846) is 64 km and sprawls the same way.

## Parks Canada day hikes and paths (Open Government Licence)

Confirmed names in the Trails (Temporary) file:

- Plain of Six Glaciers, Lake Agnes, Big Beehive
- Larch Valley, Sentinel Pass, Eiffel Lake, Moraine Lakeshore, Wenkchemna Pass
- Johnston Canyon (lower and upper) and Ink Pots
- Parker Ridge, Peyto Lake Lookout
- Iceline, Yoho Valley, Emerald Lakeshore
- Sulphur Mountain, Tunnel Mountain Summit
- Banff Legacy Trail
- Consolation Lakes, Boom Lake, Helen Lake
- Lake O'Hara / Opabin (access-restricted; say so if we show it)
- Stanley Glacier
- Floe Lake and Rockwall Pass (Great Divide Trail pieces, not the full Rockwall)

## City cycle routes (OSM)

Coordinates are a point on the line, used to confirm the city. Lengths are mapped.

| City | Route | km | Relation | Waymarked |
|---|---|---|---|---|
| Vancouver | Seaside Greenway (Stanley Park seawall, English Bay, False Creek, Spanish Banks) | 32 | 1905671 | [route](https://cycling.waymarkedtrails.org/#route?id=1905671) · ~49.274, -123.133. The seawall itself is named footways, not its own route relation. |
| Edmonton | North Saskatchewan, central north bank (ref RvrCNb, City of Edmonton) | 15.3 | 15080344 | [route](https://cycling.waymarkedtrails.org/#route?id=15080344) · ~53.559, -113.446 |
| Edmonton | Central south bank (ref RvrCSb) | 13.0 | 15080161 | [route](https://cycling.waymarkedtrails.org/#route?id=15080161) · ~53.554, -113.400. Use both banks for a valley poster. |
| Toronto | Martin Goodman Trail (Humber to the Beaches) | 21 | 139042 | [route](https://cycling.waymarkedtrails.org/#route?id=139042) · ~43.621, -79.480 · Wikidata Q14875290 |
| Toronto | Beltline Trail (ref BT) | 10.5 | 7330793 | [route](https://cycling.waymarkedtrails.org/#route?id=7330793) · ~43.696, -79.396 · Wikidata Q14875085 |
| Montreal | Lachine Canal path (national cycle network) | 14.9 | 10029840 | [route](https://cycling.waymarkedtrails.org/#route?id=10029840) · ~45.491, -73.552 |
| Montreal | Piste Claire-Morissette (De Maisonneuve downtown path) | 12.2 | 1532120 | [route](https://cycling.waymarkedtrails.org/#route?id=1532120) · ~45.455, -73.641. This is the downtown path, not Mount Royal. |
| Calgary | Bow River Valley Pathway | 65 | 8345877 | [route](https://cycling.waymarkedtrails.org/#route?id=8345877) · ~51.047, -114.020. `linear=no`: it is the network, both banks. Preview before treating it as one line. Shorter pieces: [8345878](https://cycling.waymarkedtrails.org/#route?id=8345878) ~7.6 km, north [8345879](https://cycling.waymarkedtrails.org/#route?id=8345879) ~14.3 km. |
| Ottawa | Rideau Canal, east | 8.4 | 7206766 | [route](https://cycling.waymarkedtrails.org/#route?id=7206766) · ~45.424, -75.694. West parallel: [7206688](https://www.openstreetmap.org/relation/7206688) ~8.1 km. |
| Ottawa | Ottawa River Pathway | 42 | 9502635 | East piece [7174864](https://www.openstreetmap.org/relation/7174864) ~23 km, west [9502634](https://www.openstreetmap.org/relation/9502634) ~4.2 km. |
| Winnipeg | South Winnipeg Parkway | 26 | 6433673 | ~49.856, -97.141. `linear=no`. North piece [7209423](https://www.openstreetmap.org/relation/7209423) ~9.5 km. |
| Halifax | Chain of Lakes Trail | 6.6 | 2807083 | [route](https://cycling.waymarkedtrails.org/#route?id=2807083) · ~44.652, -63.631 |
| Victoria | Galloping Goose | 58 | 2202881 | ~48.452, -123.376. Regional bonus, long for one poster. |

Edmonton pieces that are mapped and fine as detail, not as the poster line: west valley [15083280](https://www.openstreetmap.org/relation/15083280) ~10.5 km, MacKinnon Ravine [15082637](https://www.openstreetmap.org/relation/15082637) ~2.9 km.

Halifax fragments, too short alone: Urban Greenway [2801547](https://www.openstreetmap.org/relation/2801547) 942 m, Dartmouth Harbourfront AT Greenway [2821781](https://www.openstreetmap.org/relation/2821781) ~3 km, Joseph Howe Greenway [7685004](https://www.openstreetmap.org/relation/7685004) ~866 m.

Saskatoon Meewasin Trail [9548195](https://www.openstreetmap.org/relation/9548195) is only the ~6.6 km piece near 52.142, -106.638.

## Looked up, not in the sample set

- Vancouver BC Parkway [164401](https://www.openstreetmap.org/relation/164401) (~27 km, temporary Pattullo alignment) and foot [1164853](https://www.openstreetmap.org/relation/1164853). Vancouver piece [19672106](https://www.openstreetmap.org/relation/19672106) ~5 km.
- Central Valley Greenway [164037](https://www.openstreetmap.org/relation/164037) ~26 km, Vancouver piece [17987266](https://www.openstreetmap.org/relation/17987266) ~8 km.
- Adanac Bikeway [161175](https://www.openstreetmap.org/relation/161175) ~6.5 km.
- Don Mills Trail [9481106](https://www.openstreetmap.org/relation/9481106) ~4 km.
- Waterfront Trail [11674192](https://www.openstreetmap.org/relation/11674192) was 1.8 km in OSM, not the full Great Lakes trail.
- “Tour des Plaines” [21196460](https://www.openstreetmap.org/relation/21196460) is in France (43.916, 6.091), not Quebec.
- Quebec City Promenade Samuel-De Champlain and the Plains of Abraham are individual ways, not one route relation.
- Mount Royal / Olmsted / Camillien-Houde did not resolve to one hiking or cycle route. A Mount Royal search was mostly STM buses, metro, and the REM.
- UCI 2026 worlds road-race relation [21061895](https://www.openstreetmap.org/relation/21061895) is a race course, not a sample route.
- Bow Valley Parkway, Stanley Park seawall as its own relation, Niagara River Recreation Trail, Gros Morne Mountain, Crypt Lake, and the full Rockwall and Bruce Trail were not pinned to one relation before lookup timed out. Several Rockies day-hike names are in the Parks Canada file above.
