const path = require("node:path");
const { default: Image } = require("@11ty/eleventy-img");

// Responsive <picture>: AVIF + WebP with a fallback in the source format
// ("auto"), so transparent PNG logos stay transparent.
// Usage: {% image "images/home/featured.jpg", "Describe the image", "(min-width: 1024px) 50vw, 100vw" %}
// `src` is relative to the src/ folder. Pass alt="" only for purely decorative images.
// Pass "eager" as the 4th argument for above-the-fold images such as the header logo.
async function imageShortcode(src, alt, sizes = "100vw", loading = "lazy") {
  if (alt === undefined || alt === null) {
    throw new Error(`Missing alt text for image: ${src}`);
  }

  const metadata = await Image(path.join("src", src), {
    widths: [640, 1280, 1920, 2880],
    formats: ["avif", "webp", "auto"],
    outputDir: "_site/img/",
    urlPath: "/img/",
  });

  return Image.generateHTML(metadata, {
    alt,
    sizes,
    loading,
    decoding: "async",
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

  eleventyConfig.addShortcode("image", imageShortcode);

  return {
    dir: {
      input: "src",
      output: "_site",
    },
  };
};
