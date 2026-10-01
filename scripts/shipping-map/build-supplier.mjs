// Step 5: the Reno/Sparks supplier map.
// - Major roads from the Overpass API (OpenStreetMap; overpass-api.de, no key).
// - Driving routes from the OSRM demo server (router.project-osrm.org, no key), with one
//   waypoint each so the line follows the route in the Google reference screenshots.
// Responses are cached in raw/, so rerunning doesn't hit the services again.
// Writes src/_includes/shipping-map/supplier-map.svg (geometry only) and
// src/_data/supplierMap.json (marker, label and callout positions in % of the map).
// Run: node scripts/shipping-map/build-supplier.mjs
import { readFile, writeFile, access, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { geoMercator } from "d3-geo";
import { RAW, ROOT, MAP_W, MAP_H } from "./lib.mjs";

const UA = "silverscreenprinting.com map build (one-time)";
const MAPSHAPER = path.join(ROOT, "node_modules/.bin/mapshaper");

// Locations: OSM building footprints (Washoe County GIS) for Silverscreen and SanMar.
// 9550 N Virginia St isn't in OSM; this sits between 9530 and 9560 on the same frontage.
const PLACES = {
  silverscreen: { name: "Silverscreen", lonlat: [-119.7503, 39.4944] },
  sanmar: { name: "SanMar", lonlat: [-119.7087, 39.6805] },
  ss: { name: "S&S Activewear", lonlat: [-119.869, 39.6115] },
};
const ROUTES = {
  // Greg St → Vista Blvd → Disc Dr/Sparks Blvd → NV-445 Pyramid Way
  sanmar: { via: [[-119.7003, 39.53]], label: "33 min · 17.7 mi" },
  // Longley → Airway → Moana → I-580/US-395 N → Lemmon Dr → N Virginia St
  ss: { via: [[-119.7759, 39.486]], label: "23 min · 14.8 mi" },
};
// Frame: Silverscreen and both suppliers with margin, at the US map's 1.6:1 aspect.
const FRAME = { south: 39.448, north: 39.722, west: -120.07, east: -119.51 };

async function cached(file, url, init) {
  const full = path.join(RAW, file);
  try {
    await access(full);
  } catch {
    console.log("fetching", url.slice(0, 90));
    const res = await fetch(url, { ...init, headers: { "User-Agent": UA, ...(init?.headers || {}) } });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    await writeFile(full, await res.text());
    await new Promise((r) => setTimeout(r, 1500)); // be polite
  }
  return JSON.parse(await readFile(full, "utf8"));
}

const query = `[out:json][timeout:90];
way["highway"~"^(motorway|trunk|primary|secondary)$"](${FRAME.south - 0.01},${FRAME.west - 0.01},${FRAME.north + 0.01},${FRAME.east + 0.01});
out geom tags;`;
const roads = await cached("roads.json", "https://overpass-api.de/api/interpreter", {
  method: "POST",
  body: new URLSearchParams({ data: query }),
});

const routes = {};
for (const [id, r] of Object.entries(ROUTES)) {
  const stops = [PLACES.silverscreen.lonlat, ...r.via, PLACES[id].lonlat].map((c) => c.join(",")).join(";");
  const json = await cached(`route-${id}.json`, `https://router.project-osrm.org/route/v1/driving/${stops}?overview=full&geometries=geojson`);
  routes[id] = json.routes[0].geometry.coordinates;
  console.log(id, "OSRM", (json.routes[0].distance / 1609.34).toFixed(1), "mi (the page shows Google's numbers)");
}

const projection = geoMercator().fitSize([MAP_W, MAP_H], {
  type: "MultiPoint",
  coordinates: [[FRAME.west, FRAME.south], [FRAME.east, FRAME.north]],
});
const xy = (c) => projection(c);

// Road classes drawn on the map: freeways; highways and main arterials (OSM "primary",
// e.g. McCarran, Pyramid Way, Virginia St); and a short list of named secondary arterials,
// mostly the ones the two routes use, so each route line sits on a drawn road.
const MINOR = /^(Vista Boulevard|(East )?Greg Street|Longley Lane|Airway Drive|East Peckham Lane|(East |West )?Moana Lane|Lemmon Drive|Disc Drive|Kietzke Lane|(East )?Prater Way|Sky Vista Parkway|Los Altos Parkway)$/;
function roadClass(tags) {
  if (tags.highway === "motorway" || tags.highway === "trunk") return "freeway";
  if (tags.highway === "primary") return "arterial";
  if (MINOR.test(tags.name || "")) return "minor";
  return null;
}
const features = [];
for (const way of roads.elements) {
  const cls = roadClass(way.tags);
  if (!cls) continue;
  features.push({
    type: "Feature",
    properties: { cls },
    geometry: { type: "LineString", coordinates: way.geometry.map((g) => xy([g.lon, g.lat])) },
  });
}
for (const [id, line] of Object.entries(routes)) {
  features.push({ type: "Feature", properties: { cls: `route-${id}` }, geometry: { type: "LineString", coordinates: line.map(xy) } });
}
await writeFile(path.join(RAW, "supplier-lines.json"), JSON.stringify({ type: "FeatureCollection", features }));
// Merge each class into one line set, clip to the frame and simplify.
execFileSync(MAPSHAPER, ["supplier-lines.json", "-dissolve", "cls", "-clip", `bbox=0,0,${MAP_W},${MAP_H}`,
  "-simplify", "interval=0.6", "-o", "supplier-lines-out.json", "format=geojson", "precision=0.1", "force"],
{ cwd: RAW, stdio: ["ignore", "inherit", "inherit"] });
const merged = JSON.parse(await readFile(path.join(RAW, "supplier-lines-out.json"), "utf8"));

const d = (g) => (g.type === "LineString" ? [g.coordinates] : g.coordinates)
  .map((line) => "M" + line.map(([x, y]) => `${+x.toFixed(1)} ${+y.toFixed(1)}`).join("L")).join("");
const byClass = Object.fromEntries(merged.features.map((f) => [f.properties.cls, d(f.geometry)]));

// Route lines must be single continuous paths (for the draw-in animation), so use the
// unclipped, unsimplified OSRM geometry, lightly thinned.
const routePath = (line) => {
  const pts = line.map(xy);
  const kept = [pts[0]];
  for (const p of pts.slice(1)) {
    const last = kept[kept.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 1.2) kept.push(p);
  }
  kept.push(pts[pts.length - 1]);
  return "M" + kept.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L");
};

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_W} ${MAP_H}" class="reach-local__svg" aria-hidden="true" focusable="false">` +
  `<path class="reach-local__road reach-local__road--minor" d="${byClass.minor}"/>` +
  `<path class="reach-local__road reach-local__road--arterial" d="${byClass.arterial}"/>` +
  `<path class="reach-local__road reach-local__road--freeway-casing" d="${byClass.freeway}"/>` +
  `<path class="reach-local__road reach-local__road--freeway" d="${byClass.freeway}"/>` +
  Object.keys(routes).map((id) => `<path class="reach-local__route" data-route="${id}" pathLength="1" d="${routePath(routes[id])}"/>`).join("") +
  `</svg>\n`;
await mkdir(path.join(ROOT, "src/_includes/shipping-map"), { recursive: true });
await writeFile(path.join(ROOT, "src/_includes/shipping-map/supplier-map.svg"), svg);

const pct = (lonlat) => {
  const [x, y] = xy(lonlat);
  return { x: +((x / MAP_W) * 100).toFixed(2), y: +((y / MAP_H) * 100).toFixed(2) };
};
// Callout: anchored at the point along the route farthest from both ends (roughly mid-route).
const mid = (line) => line[Math.floor(line.length * 0.55)];
const data = {
  _source: "Built by scripts/shipping-map/build-supplier.mjs from OpenStreetMap data; do not edit by hand. Drive times and miles are Google Maps figures.",
  places: Object.fromEntries(Object.entries(PLACES).map(([id, p]) => [id, { name: p.name, ...pct(p.lonlat) }])),
  routes: Object.fromEntries(Object.entries(ROUTES).map(([id, r]) => [id, { label: r.label, callout: pct(mid(routes[id])) }])),
  labels: [
    { text: "Reno", ...pct([-119.8138, 39.5296]), kind: "city" },
    { text: "Sparks", ...pct([-119.752, 39.5575]), kind: "city" },
    { text: "I-80", ...pct([-119.975, 39.5115]), kind: "road" },
    { text: "US-395", ...pct([-119.948, 39.6655]), kind: "road" },
  ],
};
await writeFile(path.join(ROOT, "src/_data/supplierMap.json"), JSON.stringify(data, null, 1) + "\n");
console.log(`supplier SVG ${(svg.length / 1024).toFixed(1)} KB`, data.places, data.routes);
