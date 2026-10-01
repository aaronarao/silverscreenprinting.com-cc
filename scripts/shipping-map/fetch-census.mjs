// Step 1: download the US Census 2020 cartographic boundary files (public domain)
// for ZIP Code Tabulation Areas and states into ./raw (gitignored).
// Run once: node scripts/shipping-map/fetch-census.mjs
import { mkdir, writeFile, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const RAW = path.join(import.meta.dirname, "raw");
const FILES = [
  "https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip",
  "https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_state_500k.zip",
];

await mkdir(RAW, { recursive: true });
for (const url of FILES) {
  const zip = path.join(RAW, path.basename(url));
  try {
    await access(zip);
    console.log("have", path.basename(zip));
  } catch {
    console.log("downloading", url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    await writeFile(zip, Buffer.from(await res.arrayBuffer()));
  }
  execFileSync("unzip", ["-o", "-q", zip, "-d", RAW]);
}
console.log("done");
