/**
 * controllers/developer/listingController.js
 * Store Listing — the second gate of a submission.
 *
 * Review decides whether a build ships; the listing decides how it looks in the
 * store. They are deliberately separate: a developer is never asked to produce
 * artwork for a game that might be rejected, and an approved game no longer
 * waits on an admin to draw four images before it can be published.
 *
 * A submission enters 'listing_pending' when an admin approves the build, and
 * reaches 'approved' when the developer submits a complete listing. Only then
 * is anything copied onto the public `games` row — a half-filled listing must
 * never leak onto a game page.
 */
const db     = require('../../config/database');
const crypto = require('crypto');
const r2     = require('../../config/r2');
const { toWebp, presetSize, ImageTooSmallError, IMMUTABLE_CACHE } = require('../../utils/images');
const { parseVideo, watchUrl }    = require('../../utils/portfolio');
const { matchClause, shouldRedirectToSlug } = require('../../utils/slugs');

const MIN_SCREENSHOTS = 3;
const MAX_SCREENSHOTS = 8;
const MAX_TAGS        = 5;
const SHORT_DESC_MAX  = 200;

// States in which the listing form is open. 'approved' stays editable so a
// developer can fix a typo or swap a screenshot after the game is published.
const EDITABLE = new Set(['listing_pending', 'approved']);

// The two pieces of art a listing carries, and the exact size each is stored
// at. The views read these so the copy can never drift from what we enforce.
const ART_SLOTS = {
  thumbnail: { column: 'thumbnail_url', preset: 'gameThumb',  label: 'Game thumbnail', field: 'thumb' },
  banner:    { column: 'banner_url',    preset: 'gameBanner', label: 'Banner',         field: 'banner' },
};
const ART_SIZES = {
  thumbnail: presetSize('gameThumb'),
  banner:    presetSize('gameBanner'),
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Loads a submission the signed-in developer actually owns, or null.
 * Addressed by slug so no database id appears in a portal URL; a bare numeric
 * id still resolves, because approval emails sent before this carry one.
 */
async function loadOwned(developerId, idOrSlug) {
  // Aliased: the games join brings its own id/slug columns into scope.
  const match = matchClause(idOrSlug, 's');
  if (!match) return null;
  const [rows] = await db.query(
    `SELECT s.*, g.is_active AS game_is_active, g.slug AS game_slug
     FROM developer_submissions s
     LEFT JOIN games g ON s.game_id = g.id
     WHERE ${match.sql} AND s.developer_id = ?`,
    [...match.params, developerId]
  );
  return rows[0] || null;
}

async function loadScreenshots(submissionId) {
  const [rows] = await db.query(
    `SELECT id, public_id, image_url, position FROM developer_submission_screenshots
     WHERE submission_id = ? ORDER BY position ASC, id ASC`,
    [submissionId]
  );
  return rows;
}

/** What the developer still owes us, in the order the form presents it. */
function checklist(sub, screenshots) {
  return [
    { key: 'short_description', label: 'Short description',                      done: !!sub.short_description },
    { key: 'thumbnail',         label: `Game thumbnail (${ART_SIZES.thumbnail.width}×${ART_SIZES.thumbnail.height})`, done: !!sub.thumbnail_url },
    { key: 'screenshots',       label: `${MIN_SCREENSHOTS} or more screenshots`, done: screenshots.length >= MIN_SCREENSHOTS },
    { key: 'tags',              label: 'At least one tag',                       done: !!(sub.listing_tags || '').trim() },
  ];
}

const isComplete = (sub, screenshots) => checklist(sub, screenshots).every(i => i.done);

// Game-owned keys are derived from the listing object's content hash, so a
// re-sync of unchanged art lands on the same key and costs nothing.
const GAME_OWNED_PREFIXES = ['images/games/', 'images/screenshots/'];
const isGameOwnedKey = (key) => !!key && GAME_OWNED_PREFIXES.some(p => key.startsWith(p));

/**
 * Gives the game its own copy of one listing image and returns its URL.
 *
 * The game row must never point at an object under images/listings/: the admin
 * image handlers delete whatever the game currently references when they
 * replace it, which would destroy the developer's listing artwork and leave
 * the listing showing a dead image. Two owners, two objects.
 */
async function copyToGame(listingUrl, destKey) {
  const srcKey = r2.keyFromUrl(listingUrl);
  if (!srcKey) return null;
  if (isGameOwnedKey(srcKey)) return listingUrl; // already a game-owned copy
  return r2.copyObject(srcKey, destKey, { contentType: 'image/webp', cacheControl: IMMUTABLE_CACHE });
}

/** The content-hash tail of a listing key, for naming its game-owned copy. */
const hashTail = (url) => {
  const key = r2.keyFromUrl(url) || '';
  const name = key.split('/').pop().replace(/\.webp$/, '');
  return name.split('-').pop();
};

/**
 * Copies a finished listing onto the public `games` row. Runs only once the
 * listing is complete, and is safe to re-run — screenshots and tags are
 * replaced wholesale so a removed image really disappears from the game page.
 *
 * `promotional_thumbnail` is never written here: the featured-rail artwork
 * stays editorial, so dev-supplied images can't land on the homepage.
 */
async function syncToGame(sub, screenshots) {
  if (!sub.game_id) return;

  const [[game]] = await db.query(
    'SELECT thumbnail_url, secondary_thumbnail FROM games WHERE id = ?', [sub.game_id]
  );

  // Artwork: the game gets its own copies, named the way the admin handlers
  // name theirs so replacing one from the Games panel behaves normally.
  const thumbnailUrl = await copyToGame(
    sub.thumbnail_url, `images/games/game-${sub.game_id}-${hashTail(sub.thumbnail_url)}.webp`);
  const bannerUrl = sub.banner_url
    ? await copyToGame(sub.banner_url, `images/games/game-${sub.game_id}-secondary-${hashTail(sub.banner_url)}.webp`)
    : null;

  await db.query(
    `UPDATE games
     SET short_description = ?, long_description = ?, controls = ?,
         thumbnail_url = ?, secondary_thumbnail = COALESCE(?, secondary_thumbnail)
     WHERE id = ?`,
    [
      sub.short_description,
      sub.description,
      sub.controls || null,
      thumbnailUrl,
      bannerUrl,
      sub.game_id,
    ]
  );

  // Retire the game's previous copies once they are no longer referenced.
  for (const [oldUrl, newUrl] of [[game?.thumbnail_url, thumbnailUrl], [game?.secondary_thumbnail, bannerUrl]]) {
    const oldKey = r2.keyFromUrl(oldUrl);
    if (oldKey && isGameOwnedKey(oldKey) && oldKey !== r2.keyFromUrl(newUrl)) {
      await r2.deleteObject(oldKey).catch(() => {});
    }
  }

  // Screenshots: mirror the submission's set onto the game, again as the
  // game's own objects. Superseded copies are removed so nothing is orphaned.
  const [oldShots] = await db.query('SELECT image_url FROM game_screenshots WHERE game_id = ?', [sub.game_id]);
  const copied = [];
  for (const shot of screenshots) {
    const url = await copyToGame(shot.image_url, `images/screenshots/screenshot-${sub.game_id}-${shot.public_id}.webp`);
    if (url) copied.push(url);
  }

  await db.query('DELETE FROM game_screenshots WHERE game_id = ?', [sub.game_id]);
  if (copied.length) {
    await db.query(
      'INSERT INTO game_screenshots (game_id, image_url) VALUES ?',
      [copied.map(url => [sub.game_id, url])]
    );
  }
  const kept = new Set(copied.map(u => r2.keyFromUrl(u)));
  for (const row of oldShots) {
    const oldKey = r2.keyFromUrl(row.image_url);
    if (oldKey && isGameOwnedKey(oldKey) && !kept.has(oldKey)) {
      await r2.deleteObject(oldKey).catch(() => {});
    }
  }

  // Tags resolve against the curated `tags` vocabulary — a developer picks from
  // it and can never invent new entries, so the taxonomy stays ours.
  const names = (sub.listing_tags || '').split(',').map(t => t.trim()).filter(Boolean);
  await db.query('DELETE FROM game_tags WHERE game_id = ?', [sub.game_id]);
  if (names.length) {
    const [tagRows] = await db.query('SELECT id, name FROM tags WHERE name IN (?)', [names]);
    if (tagRows.length) {
      await db.query(
        'INSERT IGNORE INTO game_tags (game_id, tag_id) VALUES ?',
        [tagRows.map(t => [sub.game_id, t.id])]
      );
    }
  }
}

/** Replaces one image on the submission, deleting the object it supersedes. */
async function replaceImage(sub, { column, preset, field }, file) {
  const { buffer, hash } = await toWebp(file.buffer, preset);
  const key = `images/listings/sub-${sub.id}-${field}-${hash}.webp`;
  const publicUrl = await r2.uploadBuffer(key, buffer, 'image/webp', IMMUTABLE_CACHE);

  const oldKey = r2.keyFromUrl(sub[column]);
  if (oldKey && oldKey !== key) await r2.deleteObject(oldKey).catch(() => {});

  await db.query(`UPDATE developer_submissions SET ${column} = ? WHERE id = ?`, [publicUrl, sub.id]);
  return publicUrl;
}

/**
 * Re-syncs an already-approved listing after an edit. While a submission is
 * still 'listing_pending' nothing is published yet, so edits stay local.
 */
async function resyncIfApproved(submissionRef, developerId) {
  const fresh = await loadOwned(developerId, submissionRef);
  if (!fresh || fresh.status !== 'approved') return;
  const shots = await loadScreenshots(fresh.id);
  if (isComplete(fresh, shots)) {
    await syncToGame(fresh, shots);
  } else {
    // Nothing should be able to make a submitted listing incomplete — the edit
    // paths all refuse it. Leave the published game untouched and flag it.
    console.warn(`[listing] submission ${fresh.id} is approved but incomplete; skipped game sync`);
  }
}

// ── GET /developer/listings ──────────────────────────────────────────────────
exports.getListings = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT s.id, s.slug, s.title, s.status, s.thumbnail_url, s.short_description,
              s.listing_tags, s.listing_submitted_at, s.reviewed_at,
              g.is_active AS game_is_active, g.slug AS game_slug,
              (SELECT COUNT(*) FROM developer_submission_screenshots ss
                WHERE ss.submission_id = s.id) AS screenshot_count
       FROM developer_submissions s
       LEFT JOIN games g ON s.game_id = g.id
       WHERE s.developer_id = ? AND s.status IN ('listing_pending','approved')
       ORDER BY FIELD(s.status,'listing_pending','approved'), s.reviewed_at DESC`,
      [req.session.developer.id]
    );

    const listings = rows.map(r => {
      const items = checklist(r, new Array(r.screenshot_count));
      return {
        ...r,
        checklist: items,
        remaining: items.filter(i => !i.done).length,
      };
    });

    res.render('developer/listings', {
      title: 'Store Listings',
      developer: req.session.developer,
      listings,
      MIN_SCREENSHOTS,
    });
  } catch (err) {
    req.flash('error_msg', 'Failed to load your listings.');
    res.redirect('/developer/dashboard');
  }
};

// ── GET /developer/submissions/:id/listing ───────────────────────────────────
exports.getListing = async (req, res) => {
  try {
    const sub = await loadOwned(req.session.developer.id, req.params.slug);
    if (!sub) {
      req.flash('error_msg', 'Submission not found.');
      return res.redirect('/developer/listings');
    }
    // A link from an approval email sent before slugs carries the numeric id;
    // send it to the canonical URL rather than serving two addresses.
    if (shouldRedirectToSlug(req.params.slug, sub)) {
      return res.redirect(`/developer/submissions/${sub.slug}/listing`);
    }
    if (!EDITABLE.has(sub.status)) {
      req.flash('error_msg', 'The store listing opens once your game has passed review.');
      return res.redirect(`/developer/submissions/${sub.slug}`);
    }

    const screenshots = await loadScreenshots(sub.id);
    const [allTags] = await db.query('SELECT id, name FROM tags ORDER BY name ASC');
    const selectedTags = (sub.listing_tags || '').split(',').map(t => t.trim()).filter(Boolean);

    res.render('developer/listing', {
      title: `Store Listing — ${sub.title}`,
      developer: req.session.developer,
      submission: sub,
      screenshots,
      allTags,
      selectedTags,
      checklist: checklist(sub, screenshots),
      complete: isComplete(sub, screenshots),
      errors: req.flash('listing_errors'),
      ART_SIZES,
      MIN_SCREENSHOTS,
      MAX_SCREENSHOTS,
      MAX_TAGS,
      SHORT_DESC_MAX,
    });
  } catch (err) {
    req.flash('error_msg', 'Failed to load the store listing.');
    res.redirect('/developer/listings');
  }
};

// ── POST /developer/submissions/:id/listing ──────────────────────────────────
// Saves the text half of the listing. `action=submit` additionally promotes a
// complete listing to 'approved' and publishes it onto the game row.
exports.postListing = async (req, res) => {
  const ref = req.params.slug;
  let back = '/developer/listings';

  try {
    const sub = await loadOwned(req.session.developer.id, ref);
    if (!sub) {
      req.flash('error_msg', 'Submission not found.');
      return res.redirect('/developer/listings');
    }
    // The URL carries a slug now; every write below must use the resolved row.
    back = `/developer/submissions/${sub.slug}/listing`;
    if (!EDITABLE.has(sub.status)) {
      req.flash('error_msg', 'This listing is not open for editing.');
      return res.redirect(`/developer/submissions/${sub.slug}`);
    }

    const errors = [];
    const shortDesc = String(req.body.short_description ?? '').trim();
    const longDesc  = String(req.body.description ?? '').trim();
    const controls  = String(req.body.controls ?? '').trim();

    if (!shortDesc) errors.push('Short description is required.');
    else if (shortDesc.length > SHORT_DESC_MAX) errors.push(`Short description must be ${SHORT_DESC_MAX} characters or fewer.`);
    if (!longDesc)  errors.push('Description is required.');
    if (!controls)  errors.push('Controls / how to play is required.');

    // Tags come from the curated vocabulary only — anything else is dropped
    // rather than silently created.
    const picked = [].concat(req.body.tags || []).map(t => String(t).trim()).filter(Boolean);
    let tags = [];
    if (picked.length) {
      const [valid] = await db.query('SELECT name FROM tags WHERE name IN (?)', [picked]);
      tags = valid.map(t => t.name);
    }
    if (tags.length > MAX_TAGS) errors.push(`Pick at most ${MAX_TAGS} tags.`);
    // Same reasoning as the screenshot delete guard: a submitted listing must
    // never be edited into an incomplete one, or the live game page keeps
    // whatever was synced last.
    if (!tags.length && (sub.status === 'approved' || req.body.action === 'submit')) {
      errors.push('Pick at least one tag.');
    }

    // The trailer link is reference material for our team. It is intentionally
    // NOT written to games.trailer_url — the app plays that column as a direct
    // video file, and a YouTube page URL there would break the player.
    let trailer = null;
    const video = parseVideo(req.body.trailer_url);
    if (video.error) errors.push(video.error);
    else if (video.value) trailer = watchUrl(video.value.provider, video.value.id);

    if (errors.length) {
      req.flash('listing_errors', errors);
      return res.redirect(back);
    }

    await db.query(
      `UPDATE developer_submissions
       SET short_description = ?, description = ?, controls = ?, listing_tags = ?, trailer_url = ?
       WHERE id = ?`,
      [shortDesc, longDesc, controls, tags.join(', ') || null, trailer, sub.id]
    );

    const fresh = await loadOwned(req.session.developer.id, sub.id);
    const screenshots = await loadScreenshots(sub.id);

    if (req.body.action === 'submit') {
      if (!isComplete(fresh, screenshots)) {
        req.flash('listing_errors', ['Your listing is not complete yet — finish every item in the checklist before submitting.']);
        return res.redirect(back);
      }
      await syncToGame(fresh, screenshots);
      if (fresh.status === 'listing_pending') {
        await db.query(
          `UPDATE developer_submissions
           SET status = 'approved', listing_submitted_at = NOW() WHERE id = ?`,
          [sub.id]
        );
        req.flash('success_msg', 'Store listing submitted! Your game is queued for publishing — we’ll email you the moment it goes live.');
      } else {
        req.flash('success_msg', 'Store listing updated.');
      }
      return res.redirect(`/developer/submissions/${sub.slug}`);
    }

    if (fresh.status === 'approved' && isComplete(fresh, screenshots)) {
      await syncToGame(fresh, screenshots);
    }
    req.flash('success_msg', 'Listing saved.');
    res.redirect(back);
  } catch (err) {
    req.flash('error_msg', 'Failed to save the listing. Please try again.');
    res.redirect(back);
  }
};

// ── POST /developer/submissions/:slug/listing/thumbnail | /banner ────────────
const imageUploader = (slotKey) => async (req, res) => {
  const slot = ART_SLOTS[slotKey];
  const size = ART_SIZES[slotKey];
  let back = '/developer/listings';

  try {
    const sub = await loadOwned(req.session.developer.id, req.params.slug);
    if (!sub || !EDITABLE.has(sub.status)) {
      req.flash('error_msg', 'This listing is not open for editing.');
      return res.redirect('/developer/listings');
    }
    back = `/developer/submissions/${sub.slug}/listing`;
    if (req.uploadError) { req.flash('error_msg', req.uploadError); return res.redirect(back); }
    if (!req.file)       { req.flash('error_msg', `Choose a ${slot.label.toLowerCase()} image to upload.`); return res.redirect(back); }

    await replaceImage(sub, slot, req.file);
    await resyncIfApproved(sub.id, req.session.developer.id);
    req.flash('success_msg', `${slot.label} updated — stored at ${size.width}×${size.height}.`);
  } catch (err) {
    // An undersized image is the developer's to fix, so say exactly what's
    // wrong rather than burying it in a generic upload failure.
    req.flash('error_msg', err instanceof ImageTooSmallError
      ? `${slot.label}: ${err.message}`
      : `${slot.label} upload failed: ${err.message}`);
  }
  res.redirect(back);
};

exports.postThumbnail = imageUploader('thumbnail');
exports.postBanner    = imageUploader('banner');

// ── POST /developer/submissions/:id/listing/screenshots ──────────────────────
exports.postScreenshots = async (req, res) => {
  let back = '/developer/listings';

  try {
    const sub = await loadOwned(req.session.developer.id, req.params.slug);
    if (!sub || !EDITABLE.has(sub.status)) {
      req.flash('error_msg', 'This listing is not open for editing.');
      return res.redirect('/developer/listings');
    }
    back = `/developer/submissions/${sub.slug}/listing`;
    if (req.uploadError) { req.flash('error_msg', req.uploadError); return res.redirect(back); }

    const files = req.files || [];
    if (!files.length) { req.flash('error_msg', 'Choose at least one screenshot to upload.'); return res.redirect(back); }

    const existing = await loadScreenshots(sub.id);
    const room = MAX_SCREENSHOTS - existing.length;
    if (room <= 0) {
      req.flash('error_msg', `You already have the maximum of ${MAX_SCREENSHOTS} screenshots. Remove one first.`);
      return res.redirect(back);
    }

    const accepted = files.slice(0, room);
    let position = existing.length ? Math.max(...existing.map(s => s.position)) + 1 : 0;
    const values = [];
    for (const file of accepted) {
      const uid = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      const { buffer } = await toWebp(file.buffer);
      const key = `images/listings/sub-${sub.id}-shot-${uid}.webp`;
      const publicUrl = await r2.uploadBuffer(key, buffer, 'image/webp', IMMUTABLE_CACHE);
      // public_id addresses the row in the delete URL, so no database id is
      // ever put in a form action.
      values.push([sub.id, crypto.randomBytes(8).toString('hex'), publicUrl, position++]);
    }
    await db.query(
      'INSERT INTO developer_submission_screenshots (submission_id, public_id, image_url, position) VALUES ?',
      [values]
    );
    await resyncIfApproved(sub.id, req.session.developer.id);

    req.flash('success_msg', files.length > accepted.length
      ? `${accepted.length} screenshot(s) added — the rest exceeded the ${MAX_SCREENSHOTS}-image limit.`
      : `${accepted.length} screenshot(s) added.`);
  } catch (err) {
    req.flash('error_msg', 'Screenshot upload failed: ' + err.message);
  }
  res.redirect(back);
};

// ── POST /developer/submissions/:slug/listing/screenshots/:shotId/delete ─────
exports.postDeleteScreenshot = async (req, res) => {
  const { shotId } = req.params;
  let back = '/developer/listings';

  try {
    const sub = await loadOwned(req.session.developer.id, req.params.slug);
    if (!sub || !EDITABLE.has(sub.status)) {
      req.flash('error_msg', 'This listing is not open for editing.');
      return res.redirect('/developer/listings');
    }
    back = `/developer/submissions/${sub.slug}/listing`;

    // Once a listing is submitted its images are what the public game page
    // shows. Deleting below the minimum there would strip a live listing and
    // leave the game page holding whatever was synced last, so refuse instead.
    if (sub.status === 'approved') {
      const current = await loadScreenshots(sub.id);
      if (current.length <= MIN_SCREENSHOTS) {
        req.flash('error_msg', `A published listing needs at least ${MIN_SCREENSHOTS} screenshots. Upload a replacement first, then remove this one.`);
        return res.redirect(back);
      }
    }

    // Addressed by public_id: opaque, and still scoped to this submission so
    // one developer's id can never reach another's row.
    const [rows] = await db.query(
      'SELECT id, image_url FROM developer_submission_screenshots WHERE public_id = ? AND submission_id = ?',
      [shotId, sub.id]
    );
    if (rows.length) {
      await db.query('DELETE FROM developer_submission_screenshots WHERE id = ?', [rows[0].id]);
      const key = r2.keyFromUrl(rows[0].image_url);
      if (key) await r2.deleteObject(key).catch(() => {});
      await resyncIfApproved(sub.id, req.session.developer.id);
    }
    req.flash('success_msg', 'Screenshot removed.');
  } catch (err) {
    req.flash('error_msg', 'Failed to remove the screenshot.');
  }
  res.redirect(back);
};

module.exports.checklist  = checklist;
module.exports.isComplete = isComplete;
