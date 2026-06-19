/**
 * Returns today's date as YYYY-MM-DD using the local (server) timezone.
 *
 * mysql2 returns DATE columns as Date objects at local-timezone midnight.
 * Calling .toISOString() on those shifts to UTC and produces the wrong
 * date string in non-UTC environments — use this helper everywhere instead.
 */
const toLocalDateStr = (d = new Date()) => {
  const dt = d instanceof Date ? d : new Date(d);
  const y  = dt.getFullYear();
  const m  = String(dt.getMonth() + 1).padStart(2, '0');
  const dy = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${dy}`;
};

module.exports = { toLocalDateStr };
