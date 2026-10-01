// Step 4: write the site's ZIP3 map, src/maps/us-zip3.svg, from the simplified shapes
// (build-zip3.mjs) and the transit days (read-ups.mjs). No colors in the file: the page CSS
// colors each area from its data-day. Also stores Reno's position on the map in shippingMap.json.
// Run: node scripts/shipping-map/make-svg.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { RAW, ROOT, MAP_W, MAP_H, usProjection } from "./lib.mjs";

const Q = 10; // coordinates are stored as integers in tenths of a map unit
const RENO_89502 = [-119.7504, 39.4943]; // Silverscreen, 1135 S. Rock Blvd

const zips = JSON.parse(await readFile(path.join(RAW, "zip3-svg.json"), "utf8"));
const inner = JSON.parse(await readFile(path.join(RAW, "states-inner-svg.json"), "utf8"));
const states = JSON.parse(await readFile(path.join(RAW, "states-l48.json"), "utf8"));
const dataFile = path.join(ROOT, "src/_data/shippingMap.json");
const data = JSON.parse(await readFile(dataFile, "utf8"));

// Compact path data: absolute first point, then integer relative steps.
function pathData(lines, close) {
  let d = "";
  for (const line of lines) {
    let px = null;
    let py = null;
    const pts = close ? line.slice(0, -1) : line;
    for (const [x, y] of pts) {
      const ix = Math.round(x * Q);
      const iy = Math.round(y * Q);
      if (px === null) d += `M${ix} ${iy}`;
      else if (ix !== px || iy !== py) d += `l${ix - px}${iy - py < 0 ? "" : " "}${iy - py}`;
      px = ix;
      py = iy;
    }
    if (close) d += "z";
  }
  return d.replace(/l(-?\d+) /g, (m, a) => `l${a} `);
}

const rings = (g) => (g.type === "Polygon" ? g.coordinates : g.coordinates.flat());
const zipPaths = zips.features
  .filter((f) => f.geometry && data.zip3[f.properties.zip3])
  .sort((a, b) => a.properties.zip3.localeCompare(b.properties.zip3))
  .map((f) => `<path data-zip3="${f.properties.zip3}" data-day="${data.zip3[f.properties.zip3]}" d="${pathData(rings(f.geometry), true)}"/>`);
const borderLines = (inner.geometries || inner.features.map((f) => f.geometry)).flatMap((g) =>
  g.type === "LineString" ? [g.coordinates] : g.coordinates,
);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_W * Q} ${MAP_H * Q}" class="reach-us__svg" aria-hidden="true" focusable="false">` +
  `<g class="reach-us__zips">${zipPaths.join("")}</g>` +
  `<path class="reach-us__states" d="${pathData(borderLines, false)}"/>` +
  `</svg>\n`;

await mkdir(path.join(ROOT, "src/maps"), { recursive: true });
const out = path.join(ROOT, "src/maps/us-zip3.svg");
await writeFile(out, svg);

const [rx, ry] = usProjection(states)(RENO_89502);
data.reno = { x: +((rx / MAP_W) * 100).toFixed(2), y: +((ry / MAP_H) * 100).toFixed(2) };
await writeFile(dataFile, JSON.stringify(data, null, 1) + "\n");

console.log(`${zipPaths.length} areas; ${(svg.length / 1024).toFixed(1)} KB raw, ${(gzipSync(svg).length / 1024).toFixed(1)} KB gzipped`);
console.log("Reno at", data.reno);
