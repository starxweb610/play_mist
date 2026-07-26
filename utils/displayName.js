/**
 * utils/displayName.js
 * Validation for the user-editable `users.display_name` field.
 *
 * Two layers:
 *  1. Character allow-list — letters, digits, spaces only. This alone rules
 *     out -, #, %, & (explicitly banned) and every SQL/XSS special character
 *     in the blocklist CSV, by construction rather than by enumeration.
 *  2. Word blocklist — profanity/abusive terms loaded from
 *     config/display-name-blocklist.csv, matched as a case-insensitive
 *     substring. Short entries (e.g. "ass") can false-positive on innocent
 *     names ("Cassandra") — the CSV is meant to be hand-tuned over time to
 *     manage that tradeoff, not treated as exhaustive or evasion-proof.
 *
 * The CSV is auto-reloaded whenever its mtime changes (see loadBlockedTerms
 * below) — edits take effect on the next validation call, no restart needed.
 */
const fs = require('fs');
const path = require('path');

const MIN_LENGTH = 3;
const MAX_LENGTH = 20;
const ALLOWED_PATTERN = /^[A-Za-z0-9 ]+$/;
const BLOCKLIST_PATH = path.join(__dirname, '..', 'config', 'display-name-blocklist.csv');

let blockedTerms = null;
let loadedMtimeMs = 0;

// Re-stats the CSV on every call (one cheap syscall) and only re-reads/
// re-parses it when the file's mtime has moved — so editing the CSV takes
// effect on the very next validation, no server restart required. nodemon
// doesn't watch .csv by default, which is exactly the gap this closes.
const loadBlockedTerms = () => {
  let stat;
  try {
    stat = fs.statSync(BLOCKLIST_PATH);
  } catch (err) {
    console.error('displayName blocklist stat failed (failing open):', err.message);
    return blockedTerms || new Set();
  }

  if (blockedTerms && stat.mtimeMs === loadedMtimeMs) return blockedTerms;

  const terms = new Set();
  try {
    const raw = fs.readFileSync(BLOCKLIST_PATH, 'utf8');
    // Only the first (unquoted) column is read — every profanity/abusive/
    // sql_special_char term in this CSV is a single unquoted token, so a
    // plain split on the first comma is enough without a full CSV parser.
    for (const line of raw.split(/\r?\n/).slice(1)) {
      if (!line.trim()) continue;
      const term = line.split(',')[0].trim().toLowerCase();
      if (term) terms.add(term);
    }
    blockedTerms = terms;
    loadedMtimeMs = stat.mtimeMs;
  } catch (err) {
    console.error('displayName blocklist load failed (failing open):', err.message);
    if (!blockedTerms) blockedTerms = new Set();
  }
  return blockedTerms;
};

const containsBlockedTerm = (lowerName) => {
  for (const term of loadBlockedTerms()) {
    if (term.length > 0 && lowerName.includes(term)) return true;
  }
  return false;
};

/**
 * Validates a user-supplied display name.
 * An empty/whitespace-only input is treated as "clear the display name" and
 * is always valid (falls back to the immutable handle elsewhere).
 * Returns { valid: true, value } or { valid: false, error }.
 */
exports.validateDisplayName = (rawName) => {
  const name = String(rawName ?? '').trim();

  if (!name) return { valid: true, value: null };

  if (name.length < MIN_LENGTH) {
    return { valid: false, error: `Display name must be at least ${MIN_LENGTH} characters` };
  }
  if (name.length > MAX_LENGTH) {
    return { valid: false, error: `Display name must be ${MAX_LENGTH} characters or fewer` };
  }
  if (!ALLOWED_PATTERN.test(name)) {
    return { valid: false, error: 'Display name can only contain letters, numbers, and spaces' };
  }
  if (containsBlockedTerm(name.toLowerCase())) {
    return { valid: false, error: 'Display name contains a word that isn’t allowed' };
  }

  return { valid: true, value: name };
};

exports.MIN_DISPLAY_NAME_LENGTH = MIN_LENGTH;
exports.MAX_DISPLAY_NAME_LENGTH = MAX_LENGTH;

// Test-only hook: forces the next call to reload the CSV from disk.
exports._resetCacheForTests = () => { blockedTerms = null; loadedMtimeMs = 0; };
