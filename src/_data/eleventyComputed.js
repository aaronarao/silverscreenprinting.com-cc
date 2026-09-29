// Per-page values computed at build time, for the SEO tags in _includes/seo.njk.
const path = require("node:path");
const { default: Image } = require("@11ty/eleventy-img");
const site = require("./site.json");

const DEFAULT_OG_IMAGE = "images/shared/SSDF-Logo-Blue-Mirror.png";
const LOGO = "images/shared/SSDF-Logo-Blue-Mirror.png";

// "/screen-print/" -> "/screen-print". The live site's URLs have no trailing
// slash (Cloudflare's drop-trailing-slash does the same); the homepage stays "/".
function canonicalPath(url) {
  return url && url !== "/" ? url.replace(/\/$/, "") : url;
}

async function absoluteImage(src, options) {
  const metadata = await Image(path.join("src", src), {
    outputDir: ".cache/img/", // copied to _site/img/ by .eleventy.js
    urlPath: "/img/",
    ...options,
  });
  const [format] = Object.keys(metadata);
  return site.url + metadata[format][0].url;
}

module.exports = {
  // The page's own path in the live site's form, e.g. "/screen-print". The nav
  // compares against this to mark the current page.
  pagePath: (data) => canonicalPath(data.page.url),
  canonicalUrl: (data) => (data.page.url ? site.url + canonicalPath(data.page.url) : undefined),

  // Share image: the page's `ogImage` (path under src/), or the logo.
  // One 1200px JPEG; transparent PNGs are flattened onto white.
  ogImageUrl: (data) =>
    absoluteImage(data.ogImage || DEFAULT_OG_IMAGE, {
      widths: [1200],
      formats: ["jpeg"],
      transform: (sharp) => sharp.flatten({ background: "#ffffff" }),
    }),

  logoUrl: () => absoluteImage(LOGO, { widths: [600], formats: ["png"] }),
};
