/**
 * utils/images.js
 * Shared helper for resolving stored image/asset paths to public URLs.
 */

// Routes local '/images/...' paths through the image proxy to bypass Nginx
// regex interception; full URLs (e.g. R2 public URLs) pass through unchanged.
function formatImagePath(pathStr) {
  if (!pathStr) return '';
  if (pathStr.startsWith('/images/')) {
    return `/api/v1/image-proxy?file=${encodeURIComponent(pathStr)}`;
  }
  return pathStr;
}

module.exports = { formatImagePath };
