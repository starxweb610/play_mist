/**
 * utils/handles.js
 * Public profile handles — the `shubham4x` in https://playmist.app/@shubham4x.
 *
 * Safety comes from three layers, in order:
 *  1. A strict allow-list regex (a–z, 0–9, underscore; must start with a
 *     letter). Nothing outside it ever reaches a query or a URL, so there is
 *     no quoting, encoding, Unicode look-alike or path trick to get wrong.
 *  2. Every query is parameterised (mysql2 `?` placeholders) regardless.
 *  3. Uniqueness is enforced by a UNIQUE index on developers.handle — the
 *     availability check is only for friendly feedback; the index is what
 *     makes two simultaneous claims of the same handle impossible.
 *
 * Handles are stored lowercase. Old handles are kept in
 * developer_handle_history so shared links keep redirecting and nobody else
 * can pick up a handle someone just left (impersonation).
 */
const db = require('../config/database');
const { getBlockedTerms } = require('./displayName');

const MIN_LENGTH = 3;
const MAX_LENGTH = 30;
const HANDLE_RE  = /^[a-z][a-z0-9_]*$/;
const CHANGE_COOLDOWN_DAYS = 14;

// Route words, brand terms and roles someone could use to look official.
const RESERVED = new Set([
  'about', 'account', 'accounts', 'admin', 'administrator', 'api', 'app', 'apps', 'auth',
  'billing', 'blog', 'careers', 'community', 'contact', 'css', 'dashboard', 'developer',
  'developers', 'docs', 'download', 'explore', 'faq', 'feed', 'follow', 'followers',
  'following', 'game', 'games', 'help', 'home', 'images', 'info', 'js', 'legal', 'login',
  'logout', 'mail', 'me', 'mod', 'moderator', 'news', 'notifications', 'null', 'official',
  'play', 'press', 'privacy', 'profile', 'projects', 'register', 'root', 'search',
  'security', 'settings', 'signin', 'signup', 'sitehandler', 'sitemap', 'staff', 'static',
  'status', 'store', 'studio', 'support', 'system', 'team', 'terms', 'undefined', 'user',
  'users', 'verify', 'www', 'you',
]);
const RESERVED_PREFIX = /^(playmist|play_mist|admin|official|support|staff|moderator)/;

const isHandleShape = (handle) => HANDLE_RE.test(handle) && handle.length >= MIN_LENGTH && handle.length <= MAX_LENGTH;

const normalizeHandle = (raw) => String(raw ?? '').trim().replace(/^@+/, '').toLowerCase();

// The blocklist is written for display names. Its punctuation entries don't
// apply (the regex already rules those characters out), and short words are
// matched as whole tokens only, so "shellgames" or "classic" aren't rejected.
function containsBlockedWord(handle) {
  const tokens = handle.split(/[_0-9]+/).filter(Boolean);
  for (const term of getBlockedTerms()) {
    if (!/^[a-z0-9]+$/.test(term)) continue;
    if (term.length >= 5 ? handle.includes(term) : tokens.includes(term)) return true;
  }
  return false;
}

/** Returns { valid: true, value } or { valid: false, error }. */
function validateHandle(raw) {
  const handle = normalizeHandle(raw);
  if (!handle) return { valid: false, error: 'Choose a handle for your profile URL.' };
  if (handle.length < MIN_LENGTH) return { valid: false, error: `Handle must be at least ${MIN_LENGTH} characters.` };
  if (handle.length > MAX_LENGTH) return { valid: false, error: `Handle must be ${MAX_LENGTH} characters or fewer.` };
  if (!HANDLE_RE.test(handle)) {
    return { valid: false, error: 'Use lowercase letters, numbers and underscores only, starting with a letter.' };
  }
  if (handle.endsWith('_') || handle.includes('__')) {
    return { valid: false, error: 'Underscores can’t be doubled or end the handle.' };
  }
  if (RESERVED.has(handle) || RESERVED_PREFIX.test(handle)) {
    return { valid: false, error: 'That handle is reserved.' };
  }
  if (containsBlockedWord(handle)) {
    return { valid: false, error: 'That handle contains a word that isn’t allowed.' };
  }
  return { valid: true, value: handle };
}

/** True when no other developer holds (or recently held) this handle. */
async function isHandleAvailable(handle, devId = 0) {
  const [[row]] = await db.query(
    `SELECT (SELECT COUNT(*) FROM developers WHERE handle = ? AND id <> ?)
          + (SELECT COUNT(*) FROM developer_handle_history WHERE handle = ? AND developer_id <> ?) AS taken`,
    [handle, devId, handle, devId]
  );
  return Number(row.taken) === 0;
}

function handleBase(name, studio) {
  for (const source of [name, studio]) {
    let base = String(source || '')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!base) continue;
    if (!/^[a-z]/.test(base)) base = `dev${base}`;
    base = base.slice(0, 20);
    if (validateHandle(base).valid) return base;
  }
  return 'dev';
}

/** Picks a free, valid handle derived from the developer's name or studio. */
async function generateUniqueHandle(name, studio) {
  const base = handleBase(name, studio);
  if (await isHandleAvailable(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}${n}`;
    if (validateHandle(candidate).valid && await isHandleAvailable(candidate)) return candidate;
  }
  for (;;) {
    const candidate = `${base}${Math.floor(10000 + Math.random() * 90000)}`;
    if (await isHandleAvailable(candidate)) return candidate;
  }
}

/** Date the handle may next be changed, or null if it can change now. */
function nextHandleChangeAt(handleChangedAt) {
  if (!handleChangedAt) return null;
  const next = new Date(new Date(handleChangedAt).getTime() + CHANGE_COOLDOWN_DAYS * 86400000);
  return next > new Date() ? next : null;
}

module.exports = {
  MIN_LENGTH,
  MAX_LENGTH,
  CHANGE_COOLDOWN_DAYS,
  isHandleShape,
  normalizeHandle,
  validateHandle,
  isHandleAvailable,
  generateUniqueHandle,
  nextHandleChangeAt,
};
