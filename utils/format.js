/**
 * utils/format.js
 * Shared display formatters for auto-captured game stats.
 */

/** 1536 → "1.5 KB", 25165824 → "24.0 MB" */
exports.formatBytes = (bytes) => {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

/** 950 → "950", 1234 → "1.2K", 2500000 → "2.5M" */
exports.formatCount = (count) => {
  const n = Number(count) || 0;
  if (n < 1000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
};

/** AVG() result (string|number|null) → "4.6" or '' when no ratings yet */
exports.formatRating = (avg) => {
  const n = Number(avg);
  if (!Number.isFinite(n) || n <= 0) return '';
  return n.toFixed(1);
};
