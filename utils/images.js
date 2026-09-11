/**
 * utils/images.js
 * Shared helpers for resolving stored image/asset paths to public URLs and for
 * converting uploaded images to optimized WebP before they are pushed to R2.
 */
const crypto = require('crypto');
const sharp  = require('sharp');

// Bounding boxes per image kind; images are shrunk to fit, never enlarged.
const WEBP_PRESETS = {
  art:    { width: 1920, height: 1920 }, // game thumbnails, banners, screenshots, inline content
  avatar: { width: 512,  height: 512 },
};

// Converted images are stored under unique keys (content hash / random id), so
// their bytes never change and browsers + the app may cache them for a year.
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

/**
 * Converts any JPG / PNG / WebP upload to an optimized WebP: applies EXIF
 * orientation, strips metadata, keeps transparency, and fits the preset box.
 * Returns { buffer, hash } — hash is a short content digest for cache-safe keys.
 */
async function toWebp(input, preset = 'art') {
  const { width, height } = WEBP_PRESETS[preset];
  const buffer = await sharp(input, { failOn: 'error' })
    .rotate()
    .resize({ width, height, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 5, smartSubsample: true })
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

module.exports = { formatImagePath, toWebp, IMMUTABLE_CACHE };
