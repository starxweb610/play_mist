/**
 * utils/images.js
 * Shared helpers for resolving stored image/asset paths to public URLs and for
 * converting uploaded images to optimized WebP before they are pushed to R2.
 */
const crypto = require('crypto');
const sharp  = require('sharp');

/**
 * Two kinds of preset:
 *
 *   fit: 'inside'  — a bounding box. The image is shrunk to fit and never
 *                    enlarged, so its aspect ratio is whatever was uploaded.
 *   fit: 'cover'   — an exact size. The store's thumbnail and banner slots are
 *                    laid out to a fixed ratio, so these are cropped (centred)
 *                    to precisely those dimensions rather than letterboxed.
 *                    `exact` presets refuse an upload smaller than the target:
 *                    upscaling to fill the slot just ships a blurry card.
 */
const WEBP_PRESETS = {
  art:    { width: 1920, height: 1920 }, // screenshots, inline content, references
  avatar: { width: 512,  height: 512 },
  header: { width: 2400, height: 1200 }, // developer profile cover, shown object-fit: cover
  // The game's primary portrait thumbnail — every card and rail.
  gameThumb:  { width: 1024, height: 1536, exact: true },
  // The wide companion art (games.secondary_thumbnail).
  gameBanner: { width: 1536, height: 1024, exact: true },
};

/** Target dimensions for a preset, for UI copy and validation messages. */
const presetSize = (preset) => {
  const p = WEBP_PRESETS[preset];
  return p ? { width: p.width, height: p.height, exact: !!p.exact } : null;
};

/** Thrown when an exact-size preset is handed an image too small to crop. */
class ImageTooSmallError extends Error {
  constructor(required, actual) {
    super(`This image is ${actual.width}×${actual.height}. It needs to be at least ${required.width}×${required.height}.`);
    this.name = 'ImageTooSmallError';
    this.required = required;
    this.actual = actual;
  }
}

// Converted images are stored under unique keys (content hash / random id), so
// their bytes never change and browsers + the app may cache them for a year.
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

// Every upload is stored at this quality — the size win over the old 82 is
// large and the difference is not visible at the sizes we display.
const WEBP_QUALITY = 70;

/**
 * Converts any JPG / PNG / WebP upload to an optimized WebP: applies EXIF
 * orientation, strips metadata, keeps transparency, and either fits the
 * preset's bounding box or crops to its exact dimensions.
 * Returns { buffer, hash } — hash is a short content digest for cache-safe keys.
 * Throws ImageTooSmallError when an exact preset is given an undersized image.
 */
async function toWebp(input, preset = 'art') {
  const { width, height, exact } = WEBP_PRESETS[preset];
  const image = sharp(input, { failOn: 'error' }).rotate();

  if (exact) {
    // After .rotate() the EXIF orientation is applied, so metadata() here
    // reports the dimensions the viewer will actually see.
    const meta = await image.metadata();
    const swapped = meta.orientation >= 5; // 5-8 transpose width/height
    const actual = {
      width:  swapped ? meta.height : meta.width,
      height: swapped ? meta.width  : meta.height,
    };
    if (actual.width < width || actual.height < height) {
      throw new ImageTooSmallError({ width, height }, actual);
    }
  }

  const buffer = await image
    .resize(exact
      ? { width, height, fit: 'cover', position: 'centre' }
      : { width, height, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY, effort: 5, smartSubsample: true })
    .toBuffer();
  const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 10);
  return { buffer, hash };
}

// Routes local '/images/...' paths through the image proxy to bypass Nginx
// regex interception; full URLs (e.g. R2 public URLs) pass through unchanged.
function formatImagePath(pathStr) {
  if (!pathStr) return '';
  if (pathStr.startsWith('/images/')) {
    return `/api/v1/image-proxy?file=${encodeURIComponent(pathStr)}`;
  }
  return pathStr;
}

module.exports = { formatImagePath, toWebp, presetSize, ImageTooSmallError, WEBP_QUALITY, IMMUTABLE_CACHE };
