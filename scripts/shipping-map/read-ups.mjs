// Step 3: read ground transit days per ZIP3 from the UPS "Outbound View" screenshot.
//
// 1. Fit a projection to the screenshot: project the state outlines with each candidate
//    projection, then search for the affine transform that lands them on the screenshot's
//    black border pixels (mean distance, "chamfer" matching). Keep the best candidate.
// 2. For each ZIP3, project its interior sample points into the screenshot and read the
//    pixel. Only exact legend colors count, so black borders, labels, text and blended edge
//    pixels are ignored. The most common day wins.
// 3. ZIP3 areas with no readable sample take the most common day of their neighbors.
//
// Writes src/_data/shippingMap.json and out/overlay-check.png.
// Run after build-zip3.mjs: node scripts/shipping-map/read-ups.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { geoEquirectangular, geoMercator, geoAlbers, geoConicConformal, geoConicEqualArea } from "d3-geo";
import { RAW, OUT, ROOT, usProjection } from "./lib.mjs";

const sharp = createRequire(path.join(ROOT, "package.json"))("sharp");
const SCREENSHOT = path.join(ROOT, "context/shipping-map/ups-ground-89502-2024-10-01.png");

// Legend colors (exact palette values in the screenshot). UPS's grey "6 Days" appears in a few
// tiny lower-48 patches; it is capped to 5 (the map's promise is "5 days or less") and reported.
const LEGEND = new Map([
  ["255,214,33", 1],
  ["206,132,0", 2],
  ["148,165,8", 3],
  ["132,0,0", 4],
  ["255,123,0", 5],
  ["181,165,148", 6],
]);

// Screenshot regions that are not the lower-48 map: insets, legend, title, source-date text.
const MASKS = [
  [10, 255, 150, 345], // Alaska inset
  [150, 288, 220, 345], // Hawaii inset
  [355, 312, 422, 345], // Puerto Rico inset
  [468, 225, 546, 353], // legend
  [240, 4, 430, 34], // "Outbound View"
  [288, 296, 414, 310], // "Source Date"
];
const masked = (x, y) => MASKS.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);

const { data: img, info } = await sharp(SCREENSHOT).flatten({ background: "#ffffff" }).raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const H = info.height;
const rgb = (x, y) => {
  const i = (y * W + x) * 3;
  return `${img[i]},${img[i + 1]},${img[i + 2]}`;
};

// --- 1. distance field to the screenshot's black pixels (state borders and coastline) ---
const dist = new Float32Array(W * H).fill(1e6);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    if (img[i] < 40 && img[i + 1] < 40 && img[i + 2] < 40 && !masked(x, y)) dist[y * W + x] = 0;
  }
}
// Two-pass 3-4 chamfer distance transform (in pixels).
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const p = y * W + x;
  if (x > 0) dist[p] = Math.min(dist[p], dist[p - 1] + 1);
  if (y > 0) dist[p] = Math.min(dist[p], dist[p - W] + 1);
  if (x > 0 && y > 0) dist[p] = Math.min(dist[p], dist[p - W - 1] + 1.414);
  if (x < W - 1 && y > 0) dist[p] = Math.min(dist[p], dist[p - W + 1] + 1.414);
}
for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
  const p = y * W + x;
  if (x < W - 1) dist[p] = Math.min(dist[p], dist[p + 1] + 1);
  if (y < H - 1) dist[p] = Math.min(dist[p], dist[p + W] + 1);
  if (x < W - 1 && y < H - 1) dist[p] = Math.min(dist[p], dist[p + W + 1] + 1.414);
  if (x > 0 && y < H - 1) dist[p] = Math.min(dist[p], dist[p + W - 1] + 1.414);
}
const distAt = (x, y) => {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= W || yi >= H) return 25;
  return Math.min(dist[yi * W + xi], 25); // cap so outliers (labels, islands) don't dominate
};

// State outline points in lon/lat, thinned to ~0.08° spacing.
const states = JSON.parse(await readFile(path.join(RAW, "states-l48.json"), "utf8"));
const outline = [];
for (const f of states.features) {
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) {
    let last = null;
    for (const c of poly[0]) {
      if (last && Math.hypot(c[0] - last[0], c[1] - last[1]) < 0.08) continue;
      outline.push(c);
      last = c;
    }
  }
}

// Nelder–Mead minimizer.
function minimize(f, x0, step, iterations = 3000) {
  const n = x0.length;
  let simplex = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step[i] : v)))].map((x) => ({ x, v: f(x) }));
  for (let it = 0; it < iterations; it++) {
    simplex.sort((a, b) => a.v - b.v);
    const centroid = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) centroid[j] += simplex[i].x[j] / n;
    const worst = simplex[n];
    const at = (t) => centroid.map((c, j) => c + t * (worst.x[j] - c));
    const r = { x: at(-1) };
    r.v = f(r.x);
    if (r.v < simplex[0].v) {
      const e = { x: at(-2) };
      e.v = f(e.x);
      simplex[n] = e.v < r.v ? e : r;
    } else if (r.v < simplex[n - 1].v) {
      simplex[n] = r;
    } else {
      const c = { x: at(0.5) };
      c.v = f(c.x);
      if (c.v < worst.v) simplex[n] = c;
      else simplex = simplex.map((s, i) => (i === 0 ? s : { x: s.x.map((v, j) => simplex[0].x[j] + 0.5 * (v - simplex[0].x[j])), v: 0 })).map((s, i) => (i === 0 ? s : { x: s.x, v: f(s.x) }));
    }
  }
  simplex.sort((a, b) => a.v - b.v);
  return simplex[0];
}

const CANDIDATES = {
  equirectangular: () => geoEquirectangular(),
  mercator: () => geoMercator(),
  "albers 29.5/45.5": () => geoAlbers(),
  "lambert conformal 33/45": () => geoConicConformal().parallels([33, 45]).rotate([96, 0]),
  "equal-area conic 37/65": () => geoConicEqualArea().parallels([37, 65]).rotate([96, 0]),
};

// Bounding box of the colored land in the screenshot, for a starting guess.
let bx0 = W, by0 = H, bx1 = 0, by1 = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (masked(x, y) || !LEGEND.has(rgb(x, y))) continue;
  bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y);
}

let best = null;
for (const [name, make] of Object.entries(CANDIDATES)) {
  const proj = make().scale(1).translate([0, 0]);
  const pts = outline.map((c) => proj(c));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [px0, px1, py0, py1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // Affine: X = a*x + b*y + c, Y = d*x + e*y + f, starting from a bounding-box match.
  const sx = (bx1 - bx0) / (px1 - px0);
  const sy = (by1 - by0) / (py1 - py0);
  const start = [sx, 0, bx0 - sx * px0, 0, sy, by0 - sy * py0];
  const cost = ([a, b, c, d, e, f]) => {
    let sum = 0;
    for (const [x, y] of pts) sum += distAt(a * x + b * y + c, d * x + e * y + f);
    return sum / pts.length;
  };
  let fit = minimize(cost, start, [sx * 0.03, sx * 0.03, 5, sy * 0.03, sy * 0.03, 5]);
  fit = minimize(cost, fit.x, [sx * 0.005, sx * 0.005, 1, sy * 0.005, sy * 0.005, 1]);
  console.log(`${name.padEnd(26)} mean border distance ${fit.v.toFixed(3)} px`);
  if (!best || fit.v < best.v) best = { name, make, v: fit.v, m: fit.x };
}
console.log("best:", best.name);

const proj = best.make().scale(1).translate([0, 0]);
const toShot = (lonlat) => {
  const [x, y] = proj(lonlat);
  const [a, b, c, d, e, f] = best.m;
  return [a * x + b * y + c, d * x + e * y + f];
};

// --- 2. sample colors per ZIP3 ---
const samples = JSON.parse(await readFile(path.join(RAW, "zip3-samples.json"), "utf8"));
const days = {};
const votesBy = {};
const unreadable = [];
const sixDay = [];
for (const [zip3, s] of Object.entries(samples)) {
  const votes = new Map();
  for (const [lon, lat] of s.points) {
    const [x, y] = toShot([lon, lat]).map(Math.round);
    if (x < 0 || y < 0 || x >= W || y >= H || masked(x, y)) continue;
    const day = LEGEND.get(rgb(x, y));
    if (day) votes.set(day, (votes.get(day) || 0) + 1);
  }
  votesBy[zip3] = Object.fromEntries(votes);
  if (!votes.size) {
    unreadable.push(zip3);
    continue;
  }
  let day = [...votes].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  if (day === 6) { sixDay.push(zip3); day = 5; }
  days[zip3] = day;
}

// --- 3. fill unreadable areas from their neighbors (shared edges in the simplified map) ---
const zipShapes = JSON.parse(await readFile(path.join(RAW, "zip3-svg.json"), "utf8"));
const vertexOwners = new Map();
for (const f of zipShapes.features) {
  if (!f.geometry) continue;
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) for (const ring of poly) for (const c of ring) {
    const k = c.join(",");
    const set = vertexOwners.get(k) || vertexOwners.set(k, new Set()).get(k);
    set.add(f.properties.zip3);
  }
}
const neighbors = new Map();
for (const owners of vertexOwners.values()) {
  for (const a of owners) for (const b of owners) if (a !== b) {
    (neighbors.get(a) || neighbors.set(a, new Set()).get(a)).add(b);
  }
}
const filled = {};
let pending = [...unreadable];
for (let pass = 0; pending.length && pass < 10; pass++) {
  pending = pending.filter((zip3) => {
    const counts = new Map();
    for (const n of neighbors.get(zip3) || []) if (days[n]) counts.set(days[n], (counts.get(days[n]) || 0) + 1);
    if (!counts.size) return true;
    days[zip3] = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    filled[zip3] = days[zip3];
    return false;
  });
}
if (pending.length) throw new Error(`no neighbors to fill: ${pending.join(", ")}`);

// --- output data ---
const byState = {};
for (const [zip3, day] of Object.entries(days)) {
  const st = samples[zip3].state;
  byState[st] = Math.min(byState[st] ?? 9, day);
}
const firstReached = {};
// Each state is listed once, under the first day any part of it is reached (full names, for the page summary).
const stateName = Object.fromEntries(states.features.map((f) => [f.properties.STUSPS, f.properties.NAME]));
for (let d = 1; d <= 5; d++) {
  firstReached[d] = Object.keys(byState).filter((s) => byState[s] === d && s !== "DC").map((s) => stateName[s]).sort();
}
const counts = {};
for (const d of Object.values(days)) counts[d] = (counts[d] || 0) + 1;

const sorted = Object.fromEntries(Object.entries(days).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(path.join(ROOT, "src/_data/shippingMap.json"), JSON.stringify({
  _source: "Ground transit days from Reno, NV 89502, read from the carrier's Outbound View map dated 2024-10-01. Built by scripts/shipping-map/read-ups.mjs; do not edit by hand.",
  origin: "Reno, NV 89502",
  sourceDate: "2024-10-01",
  statesFirstReached: firstReached,
  zip3: sorted,
}, null, 1) + "\n");
await writeFile(path.join(RAW, "read-report.json"), JSON.stringify({ projection: best.name, fit: best.v, counts, unreadable, filled, sixDay, votesBy }, null, 1));

console.log("days per ZIP3 band:", counts);
console.log("unreadable, filled from neighbors:", filled);
console.log("UPS 6-day patches capped to 5:", sixDay);
console.log("states first reached:", firstReached);

// --- check image: [UPS screenshot | our result drawn in UPS colors | outline overlay] ---
const DAY_RGB = { 1: "#ffd621", 2: "#ce8400", 3: "#94a508", 4: "#840000", 5: "#ff7b00" };
const S = 3; // upscale
// Draw our final (gap-free, simplified) ZIP3 shapes in screenshot space: SVG coords -> lon/lat -> screenshot.
const usProj = usProjection(states);
const zipFinal = JSON.parse(await readFile(path.join(RAW, "zip3-svg.json"), "utf8"));
const ringPath = (ring) => "M" + ring.map((ll) => toShot(ll).map((v) => (v * S).toFixed(1)).join(",")).join("L") + "Z";
const featPath = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates).map((p) => p.map(ringPath).join("")).join("");
const svgRingPath = (ring) => ringPath(ring.map((xy) => usProj.invert(xy)));
let zipSvg = "";
for (const feat of zipFinal.features) {
  const day = days[feat.properties.zip3];
  if (!day || !feat.geometry) continue;
  const polys = feat.geometry.type === "Polygon" ? [feat.geometry.coordinates] : feat.geometry.coordinates;
  zipSvg += `<path d="${polys.map((p) => p.map(svgRingPath).join("")).join("")}" fill="${DAY_RGB[day]}" fill-rule="evenodd"/>`;
}
const stateSvg = states.features.map((feat) => `<path d="${featPath(feat.geometry)}" fill="none" stroke="#000" stroke-width="1" fill-rule="evenodd"/>`).join("");
const overlaySvg = states.features.map((feat) => `<path d="${featPath(feat.geometry)}" fill="none" stroke="#00e5ff" stroke-width="1.4"/>`).join("");
const panelW = W * S;
const panelH = H * S;
const label = (t) => `<text x="12" y="${panelH - 12}" font-family="Arial" font-size="26" font-weight="bold" fill="#000">${t}</text>`;
const ours = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${panelW}" height="${panelH}"><rect width="100%" height="100%" fill="#fff"/>${zipSvg}${stateSvg}${label("Ours (ZIP3 areas)")}</svg>`);
const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${panelW}" height="${panelH}">${overlaySvg}</svg>`);
const shot = await sharp(SCREENSHOT).flatten({ background: "#ffffff" }).resize(panelW, panelH, { kernel: "nearest" }).png().toBuffer();
const shotWithOverlay = await sharp(shot).composite([{ input: overlay }]).png().toBuffer();
await mkdir(OUT, { recursive: true });
await sharp({ create: { width: panelW * 3 + 40, height: panelH, channels: 3, background: "#fff" } })
  .composite([
    { input: shot, left: 0, top: 0 },
    { input: await sharp(ours).png().toBuffer(), left: panelW + 20, top: 0 },
    { input: shotWithOverlay, left: panelW * 2 + 40, top: 0 },
  ])
  .png()
  .toFile(path.join(OUT, "overlay-check.png"));
console.log("wrote out/overlay-check.png");
