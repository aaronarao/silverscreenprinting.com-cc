// Shared settings for the shipping-map build scripts.
import path from "node:path";
import { geoAlbers } from "d3-geo";

export const DIR = import.meta.dirname;
export const RAW = path.join(DIR, "raw");
export const OUT = path.join(DIR, "out");
export const ROOT = path.resolve(DIR, "../..");

// Final SVG canvas for the US map (CSS scales it; keep the aspect ratio in sync with .reach CSS).
export const MAP_W = 960;
export const MAP_H = 600;
export const MAP_PAD = 8;

// Lower-48 Albers equal-area (the US-standard Albers USA projection, minus the AK/HI insets).
// Fit to the state vertices, not the polygons: d3 reads a ring wound the "wrong" way as the whole
// globe, and mapshaper's output winding doesn't match d3's convention.
export function usProjection(states) {
  const coordinates = [];
  for (const f of states.features) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const c of poly[0]) coordinates.push(c);
  }
  return geoAlbers().fitExtent(
    [[MAP_PAD, MAP_PAD], [MAP_W - MAP_PAD, MAP_H - MAP_PAD]],
    { type: "MultiPoint", coordinates },
  );
}

// 3-digit prefixes outside the contiguous 48: PR/VI (006-009), HI (967-968), Pacific (969), AK (995-999).
export function isLower48Zip3(z) {
  const n = Number(z);
  return !(n >= 6 && n <= 9) && n !== 967 && n !== 968 && n !== 969 && !(n >= 995 && n <= 999);
}
// State FIPS outside the contiguous 48: AK 02, HI 15, PR 72, territories 60/66/69/78.
export const NON_LOWER48_FIPS = new Set(["02", "15", "60", "66", "69", "72", "78"]);
