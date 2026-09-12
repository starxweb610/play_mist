/**
 * utils/slugs.js
 * URL slugs for developer-owned records (portfolio items, projects, docs).
 *
 * Public pages address these by slug rather than by primary key, so no
 * database id is ever visible in a shareable URL. Every resolver still
 * accepts a bare numeric id as a *fallback*, because links and sitemap
 * entries issued before this change are already out in the world.
 *
 * Slug first, id second — never the reverse. A title like "2048" slugifies
 * to "2048", and trying the id first would hand that URL to whichever row
 * happens to have id 2048 instead of the row the developer named.
 *
 * Slugs are generated once, on create, and are NOT regenerated when a title
 * changes: these URLs are public and indexed, and there is no slug-history
 * table to redirect from an abandoned one.
 */
const db = require('../config/database');

const MAX_LEN = 180;

/** Lowercase, alphanumeric + single dashes. Mirrors the games slug format. */
function slugify(str) {
  return String(str ?? '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_LEN)
    .replace(/-$/, '');
}

/** A slug we can always put in a URL, even for an emoji-only title. */
function slugBase(str, fallback = 'item') {
  return slugify(str) || fallback;
}

/** True for the shape we accept in a :param — the routing guard. */
const isSlugShape = (s) => /^[a-z0-9][a-z0-9-]{0,199}$/.test(String(s ?? ''));
const isIdShape   = (s) => /^\d{1,10}$/.test(String(s ?? ''));

/**
 * First free slug in `table` within one scope (a developer's items, a
 * project's docs). Appends -2, -3, … the way game slugs do.
 */
async function uniqueSlug(table, scopeColumn, scopeValue, base, excludeId = null) {
  const root = slugBase(base);
  let slug = root;
  let n = 1;
  // Table and column names are module constants, never request input.
  const sql = `SELECT id FROM ${table} WHERE ${scopeColumn} = ? AND slug = ?`
            + (excludeId ? ' AND id <> ?' : '');
  while (n < 500) {
    const params = excludeId ? [scopeValue, slug, excludeId] : [scopeValue, slug];
    const [rows] = await db.query(sql, params);
    if (!rows.length) return slug;
    slug = `${root}-${++n}`;
  }
  return `${root}-${Date.now()}`;
}

/**
 * Builds the `WHERE` fragment that resolves a :param which may be a slug or
 * a legacy numeric id. Returns null when the param is neither shape, so the
 * caller can 404 without touching the database.
 *
 * Pass `alias` when the query joins another table that also has `id`/`slug`
 * columns, so the fragment reads `s.slug = ?` instead of an ambiguous `slug`.
 */
function matchClause(param, alias = '') {
  const value = String(param ?? '');
  const col = (name) => (alias ? `${alias}.${name}` : name);
  if (isSlugShape(value)) return { sql: `(${col('slug')} = ?` + (isIdShape(value) ? ` OR ${col('id')} = ?)` : ')'),
                                   params: isIdShape(value) ? [value, Number(value)] : [value] };
  if (isIdShape(value))   return { sql: `${col('id')} = ?`, params: [Number(value)] };
  return null;
}

/** True when the request used the legacy numeric URL for a row that has a slug. */
const shouldRedirectToSlug = (param, row) => !!row?.slug && String(param) !== row.slug;

module.exports = { slugify, slugBase, uniqueSlug, matchClause, isSlugShape, isIdShape, shouldRedirectToSlug, MAX_LEN };
