const path = require("node:path");
const { default: Image } = require("@11ty/eleventy-img");

const fs = require("node:fs");

const IMAGE_OPTIONS = {
  widths: [640, 1280, 1920, 2880],
  formats: ["avif", "webp", "auto"],
  outputDir: "_site/img/",
  urlPath: "/img/",
};
const RASTER = /\.(jpe?g|png|webp|gif)$/i;

// eleventy-img v7 is async-only, and async shortcodes can't run inside Nunjucks
// macros. So every raster image in src/images/ is processed once before each
// build (eleventy-img skips files it has already written), and the shortcode
// reads the results from this cache synchronously.
const imageCache = new Map();

async function processImages() {
  const files = fs
    .readdirSync("src/images", { recursive: true })
    .filter((file) => RASTER.test(file))
    .map((file) => path.join("images", file));

  await Promise.all(
    files.map(async (src) => {
      imageCache.set(src, await Image(path.join("src", src), IMAGE_OPTIONS));
    })
  );
}

// Responsive <picture>: AVIF + WebP with a fallback in the source format
// ("auto"), so transparent PNG logos stay transparent.
// Usage: {% image "images/home/featured.jpg", "Describe the image", "(min-width: 1024px) 50vw, 100vw" %}
// `src` is relative to the src/ folder and must be a raster image in src/images/.
// Pass alt="" only for purely decorative images.
// Pass "eager" as the 4th argument for above-the-fold images such as the header logo,
// and "high" as the 5th for the page's main (LCP) image, such as the first hero photo.
function imageShortcode(src, alt, sizes = "100vw", loading = "lazy", fetchpriority) {
  if (alt === undefined || alt === null) {
    throw new Error(`Missing alt text for image: ${src}`);
  }

  const metadata = imageCache.get(path.normalize(src));
  if (!metadata) {
    throw new Error(`Image not found (or not a raster image in src/images/): ${src}`);
  }

  return Image.generateHTML(metadata, {
    alt,
    sizes,
    loading,
    decoding: "async",
    ...(fetchpriority && { fetchpriority }),
  });
}

module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("src/fonts");
  eleventyConfig.addPassthroughCopy("src/css");
  eleventyConfig.addPassthroughCopy("src/js");

  // Self-hosted webfonts from @fontsource: only the weights the CSS uses.
  for (const file of [
    "pt-sans/files/pt-sans-latin-400-normal.woff2",
    "pt-sans/files/pt-sans-latin-400-italic.woff2",
    "pt-sans/files/pt-sans-latin-700-normal.woff2",
    "comfortaa/files/comfortaa-latin-400-normal.woff2",
  ]) {
    eleventyConfig.addPassthroughCopy({
      [`node_modules/@fontsource/${file}`]: `fonts/${path.basename(file)}`,
    });
  }
  eleventyConfig.addPassthroughCopy({ "src/favicon": "/" });
  eleventyConfig.addPassthroughCopy("src/files");
  eleventyConfig.addPassthroughCopy("src/video");
  // Netlify-style redirects for old Duda URLs.
  eleventyConfig.addPassthroughCopy({ "src/_redirects": "_redirects" });
  // Response headers for Cloudflare static assets. Currently noindex so the
  // preview copy isn't indexed; remove that rule when the site moves off Duda.
  eleventyConfig.addPassthroughCopy({ "src/_headers": "_headers" });

  eleventyConfig.on("eleventy.before", processImages);
  eleventyConfig.addShortcode("image", imageShortcode);

  return {
    dir: {
      input: "src",
      output: "_site",
    },
  };
};
