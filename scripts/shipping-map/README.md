# Shipping-map build scripts

One-time scripts that build the data for the homepage "Close partners, far reach." section
(`src/_includes/shipping-map/reach.njk`). They run locally; only their outputs are committed.
The website never calls any of these services.

Run from the repo root, in order:

```bash
node scripts/shipping-map/fetch-census.mjs    # 1. Census 2020 ZCTA + state shapes → raw/ (~170 MB, gitignored)
node scripts/shipping-map/build-zip3.mjs      # 2. gap-free 3-digit ZIP areas for the lower 48 → raw/
node scripts/shipping-map/read-ups.mjs        # 3. transit days from the carrier screenshot → src/_data/shippingMap.json + out/overlay-check.png
node scripts/shipping-map/make-svg.mjs        # 4. → src/maps/us-zip3.svg (lazy-loaded by the page)
node scripts/shipping-map/build-supplier.mjs  # 5. Reno/Sparks roads + routes → src/_includes/shipping-map/supplier-map.svg + src/_data/supplierMap.json
```

## Updating the transit map

Save the new carrier "Outbound View" screenshot over
`context/shipping-map/ups-ground-89502-2024-10-01.png` (or change `SCREENSHOT` in `read-ups.mjs`),
then rerun steps 3 and 4. Check `out/overlay-check.png`: left is the screenshot, middle is our ZIP
areas in the same colors, right is our state outlines over the screenshot.

How step 3 works: it fits a projection to the screenshot by matching our state outlines to its
black borders (the carrier map turns out to be Albers 29.5°/45.5°, like ours, so it lines up to
within a tenth of a pixel). It then samples up to 60 points inside each ZIP area and takes the most
common exact legend color. Areas with no readable sample (tiny urban areas under labels) take the
most common day of their neighbors; they are listed in `raw/read-report.json`. The legend's grey
"6 Days" is capped to 5.

Customer-facing copy never names the carrier; say "ground shipping".

## Supplier map

Step 5 caches the Overpass and OSRM responses in `raw/`; delete `raw/roads.json` or
`raw/route-*.json` to fetch again. Each route has one waypoint (in `ROUTES`) so it follows the
road in the Google Maps reference screenshots. The callouts show Google's drive times and miles,
not OSRM's. The map must credit "© OpenStreetMap contributors".
