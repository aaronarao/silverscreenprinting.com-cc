// Step 2: build gap-free 3-digit ZIP areas for the lower 48.
//
// Census ZCTAs only cover populated land, so large parts of the West have no ZIP shape.
// To get a map with no holes: project to Albers, rasterize the ZIP3 shapes at ~1.2 km/pixel,
// grow every area outward into the empty land around it, then trace the pixels back into
// polygons (neighbors share identical edges) and let mapshaper simplify them with topology.
//
// Writes (all in raw/, gitignored):
//   zip3-svg.json        simplified ZIP3 polygons in SVG coordinates
//   states-inner-svg.json  state borders (inner lines only) in SVG coordinates
//   states-svg.json       state polygons in SVG coordinates (for the check image)
//   zip3-samples.json    per ZIP3: state, plus interior sample points in lon/lat
// Run: node scripts/shipping-map/build-zip3.mjs
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { RAW, ROOT, MAP_W, MAP_H, usProjection, isLower48Zip3, NON_LOWER48_FIPS } from "./lib.mjs";

const MAPSHAPER = path.join(ROOT, "node_modules/.bin/mapshaper");
const K = 4; // raster pixels per SVG unit (960 SVG units ≈ 4,600 km → ~1.2 km per pixel)
const GW = MAP_W * K;
const GH = MAP_H * K;
const SIMPLIFY_INTERVAL = process.env.SIMPLIFY || "1.1"; // SVG units

const ms = (...args) => execFileSync(MAPSHAPER, args, { cwd: RAW, stdio: ["ignore", "inherit", "inherit"] });

// --- 1. mapshaper prep: lower-48 states, ZCTAs dissolved to ZIP3 (lon/lat) ---
const fipsList = JSON.stringify([...NON_LOWER48_FIPS]);
ms("cb_2020_us_state_500k.shp", "-filter", `!${fipsList}.includes(STATEFP)`, "-filter-fields", "STATEFP,STUSPS,NAME",
  "-o", "states-l48.json", "format=geojson", "precision=0.00001");
ms("cb_2020_us_zcta520_500k.shp", "-each", "zip3=ZCTA5CE20.slice(0,3)", "-simplify", "30%", "keep-shapes",
  "-dissolve", "zip3", "-o", "zip3-raw.json", "format=geojson", "precision=0.0001");

const states = JSON.parse(await readFile(path.join(RAW, "states-l48.json"), "utf8"));
const zips = JSON.parse(await readFile(path.join(RAW, "zip3-raw.json"), "utf8"));
zips.features = zips.features.filter((f) => isLower48Zip3(f.properties.zip3));
zips.features.sort((a, b) => a.properties.zip3.localeCompare(b.properties.zip3));
console.log("ZIP3 areas in the lower 48:", zips.features.length);

const projection = usProjection(states);

// --- 2. rasterize ---
// Even-odd scanline fill of every ring of a feature, sampling at pixel centers.
function rasterize(feature, grid, value) {
  const crossings = new Map(); // row -> x crossings
  const polys = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  for (const poly of polys) {
    for (const ring of poly) {
      const pts = ring.map((c) => {
        const p = projection(c);
        return [p[0] * K, p[1] * K];
      });
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [x0, y0] = pts[j];
        const [x1, y1] = pts[i];
        if (y0 === y1) continue;
        const yMin = Math.min(y0, y1);
        const yMax = Math.max(y0, y1);
        for (let row = Math.max(0, Math.ceil(yMin - 0.5)); row < GH && row + 0.5 < yMax; row++) {
          const yc = row + 0.5;
          if (yc < yMin) continue;
          const x = x0 + ((yc - y0) / (y1 - y0)) * (x1 - x0);
          let list = crossings.get(row);
          if (!list) crossings.set(row, (list = []));
          list.push(x);
        }
      }
    }
  }
  for (const [row, xs] of crossings) {
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5));
      const to = Math.min(GW - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = from; x <= to; x++) grid[row * GW + x] = value;
    }
  }
}

const land = new Int16Array(GW * GH).fill(-1); // state index
states.features.forEach((f, i) => rasterize(f, land, i));
const label = new Int16Array(GW * GH).fill(-1); // zip3 index
zips.features.forEach((f, i) => rasterize(f, label, i));
for (let p = 0; p < label.length; p++) if (land[p] < 0) label[p] = -1; // land only

// --- 3. grow areas into unassigned land (breadth-first = nearest area by grid distance) ---
function grow(throughWater) {
  const queue = new Int32Array(GW * GH);
  const seen = new Uint8Array(GW * GH);
  let head = 0;
  let tail = 0;
  for (let p = 0; p < label.length; p++) if (label[p] >= 0) { queue[tail++] = p; seen[p] = 1; }
  const owner = Int16Array.from(label);
  while (head < tail) {
    const p = queue[head++];
    const x = p % GW;
    const neighbors = [x > 0 ? p - 1 : -1, x < GW - 1 ? p + 1 : -1, p - GW, p + GW];
    for (const q of neighbors) {
      if (q < 0 || q >= owner.length || seen[q]) continue;
      if (land[q] < 0 && !throughWater) continue;
      seen[q] = 1;
      owner[q] = owner[p];
      queue[tail++] = q;
    }
  }
  let filled = 0;
  for (let p = 0; p < label.length; p++) if (land[p] >= 0 && label[p] < 0 && owner[p] >= 0) { label[p] = owner[p]; filled++; }
  return filled;
}
console.log("land pixels filled over land:", grow(false));
console.log("land pixels filled across water (islands):", grow(true));

// --- 4. trace pixel regions into polygons ---
// Each boundary edge is directed clockwise around its own pixel (y down), so outer rings
// come out clockwise and holes counter-clockwise. At a pinch vertex take the left turn,
// which splits diagonal-only contacts into separate rings.
function trace() {
  const out = new Map(); // zip3 index -> { outers: [], holes: [] }
  const edges = new Map(); // `${lab}|${x},${y}` -> [[x2,y2], ...]
  const add = (lab, x0, y0, x1, y1) => {
    const key = `${lab}|${x0},${y0}`;
    const list = edges.get(key);
    if (list) list.push([x1, y1]);
    else edges.set(key, [[x1, y1]]);
  };
  const at = (x, y) => (x < 0 || y < 0 || x >= GW || y >= GH ? -1 : label[y * GW + x]);
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const a = label[y * GW + x];
      if (a < 0) continue;
      if (at(x, y - 1) !== a) add(a, x, y, x + 1, y);
      if (at(x + 1, y) !== a) add(a, x + 1, y, x + 1, y + 1);
      if (at(x, y + 1) !== a) add(a, x + 1, y + 1, x, y + 1);
      if (at(x - 1, y) !== a) add(a, x, y + 1, x, y);
    }
  }
  for (const startKey of edges.keys()) {
    while (edges.get(startKey)?.length) {
      const [lab, xy] = startKey.split("|");
      const [sx, sy] = xy.split(",").map(Number);
      const ring = [[sx, sy]];
      let [cx, cy] = [sx, sy];
      let dir = null;
      for (;;) {
        const key = `${lab}|${cx},${cy}`;
        const options = edges.get(key);
        let pick = 0;
        if (options.length > 1 && dir) {
          const left = [dir[1], -dir[0]];
          const i = options.findIndex(([nx, ny]) => nx - cx === left[0] && ny - cy === left[1]);
          if (i >= 0) pick = i;
        }
        const [nx, ny] = options.splice(pick, 1)[0];
        if (!options.length) edges.delete(key);
        dir = [nx - cx, ny - cy];
        if (nx === sx && ny === sy) break;
        ring.push([nx, ny]);
        [cx, cy] = [nx, ny];
      }
      // Drop collinear points.
      const slim = ring.filter((p, i) => {
        const a = ring[(i - 1 + ring.length) % ring.length];
        const b = ring[(i + 1) % ring.length];
        return (p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0]);
      });
      let area = 0;
      for (let i = 0, j = slim.length - 1; i < slim.length; j = i++) area += (slim[j][0] * slim[i][1] - slim[i][0] * slim[j][1]);
      const entry = out.get(+lab) || out.set(+lab, { outers: [], holes: [] }).get(+lab);
      (area > 0 ? entry.outers : entry.holes).push({ ring: slim, area: Math.abs(area / 2) });
    }
  }
  return out;
}

function inside([px, py], ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const traced = trace();
const toSvg = (ring) => {
  const r = ring.map(([x, y]) => [x / K, y / K]);
  r.push(r[0]);
  return r;
};
const zipFeatures = [];
for (const [idx, { outers, holes }] of traced) {
  outers.sort((a, b) => a.area - b.area);
  const polys = outers.map((o) => [o.ring]);
  for (const h of holes) {
    const [a, b] = h.ring;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const i = outers.findIndex((o) => inside(mid, o.ring));
    if (i >= 0) polys[i].push(h.ring);
  }
  zipFeatures.push({
    type: "Feature",
    properties: { zip3: zips.features[idx].properties.zip3 },
    geometry: { type: "MultiPolygon", coordinates: polys.map((p) => p.map(toSvg)) },
  });
}
await writeFile(path.join(RAW, "zip3-traced.json"), JSON.stringify({ type: "FeatureCollection", features: zipFeatures }));

// --- 5. simplify with shared topology; state borders in the same coordinates ---
ms("zip3-traced.json", "-simplify", "visvalingam", "weighted", `interval=${SIMPLIFY_INTERVAL}`, "keep-shapes",
  "-o", "zip3-svg.json", "format=geojson", "precision=0.1");

const statesSvg = {
  type: "FeatureCollection",
  features: states.features.map((f) => ({
    type: "Feature",
    properties: f.properties,
    geometry: projectGeometry(f.geometry),
  })),
};
function projectGeometry(g) {
  const ring = (r) => r.map((c) => projection(c).map((v) => Math.round(v * 100) / 100));
  if (g.type === "Polygon") return { type: "Polygon", coordinates: g.coordinates.map(ring) };
  return { type: "MultiPolygon", coordinates: g.coordinates.map((p) => p.map(ring)) };
}
await writeFile(path.join(RAW, "states-projected.json"), JSON.stringify(statesSvg));
ms("states-projected.json", "-simplify", "visvalingam", "weighted", `interval=${SIMPLIFY_INTERVAL}`, "keep-shapes",
  "-o", "states-svg.json", "format=geojson", "precision=0.1",
  "-innerlines", "-o", "states-inner-svg.json", "format=geojson", "precision=0.1");

// --- 6. interior sample points per ZIP3 (lon/lat), plus the state each mostly sits in ---
// Distance from each pixel to its area's edge, so samples avoid the band edges.
const dist = new Int32Array(GW * GH).fill(-1);
{
  const queue = new Int32Array(GW * GH);
  let head = 0;
  let tail = 0;
  for (let p = 0; p < label.length; p++) {
    const a = label[p];
    if (a < 0) continue;
    const x = p % GW;
    const edge = x === 0 || x === GW - 1 || label[p - 1] !== a || label[p + 1] !== a || label[p - GW] !== a || label[p + GW] !== a;
    if (edge) { dist[p] = 0; queue[tail++] = p; }
  }
  while (head < tail) {
    const p = queue[head++];
    for (const q of [p - 1, p + 1, p - GW, p + GW]) {
      if (q < 0 || q >= dist.length || dist[q] >= 0 || label[q] !== label[p]) continue;
      dist[q] = dist[p] + 1;
      queue[tail++] = q;
    }
  }
}
const pixels = zips.features.map(() => []);
const stateVotes = zips.features.map(() => new Map());
for (let p = 0; p < label.length; p++) {
  const a = label[p];
  if (a < 0) continue;
  pixels[a].push(p);
  const s = states.features[land[p]].properties.STUSPS;
  stateVotes[a].set(s, (stateVotes[a].get(s) || 0) + 1);
}
const samples = {};
zips.features.forEach((f, i) => {
  const list = pixels[i];
  if (!list.length) return;
  const maxD = Math.max(...list.map((p) => dist[p]));
  // Prefer the inner part of the area, then spread picks evenly through it.
  const core = list.filter((p) => dist[p] >= maxD * 0.4);
  const n = Math.min(60, core.length);
  const pts = [];
  for (let k = 0; k < n; k++) {
    const p = core[Math.floor(((k + 0.5) / n) * core.length)];
    const x = (p % GW) + 0.5;
    const y = Math.floor(p / GW) + 0.5;
    const [lon, lat] = projection.invert([x / K, y / K]);
    pts.push([+lon.toFixed(4), +lat.toFixed(4), dist[p]]);
  }
  const state = [...stateVotes[i]].sort((a, b) => b[1] - a[1])[0][0];
  samples[f.properties.zip3] = { state, pixels: list.length, maxDist: maxD, points: pts };
});
await writeFile(path.join(RAW, "zip3-samples.json"), JSON.stringify(samples));
console.log("wrote", Object.keys(samples).length, "ZIP3 sample sets");
