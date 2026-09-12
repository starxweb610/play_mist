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
const r2     = require('../../config/r2');
const { toWebp, IMMUTABLE_CACHE } = require('../../utils/images');
const { parseVideo, watchUrl }    = require('../../utils/portfolio');

const MIN_SCREENSHOTS = 3;
const MAX_SCREENSHOTS = 8;
const MAX_TAGS        = 5;
const SHORT_DESC_MAX  = 200;

// States in which the listing form is open. 'approved' stays editable so a
// developer can fix a typo or swap a screenshot after the game is published.
const EDITABLE = new Set(['listing_pending', 'approved']);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Loads a submission the signed-in developer actually owns, or null. */
async function loadOwned(developerId, id) {
  const [rows] = await db.query(
    `SELECT s.*, g.is_active AS game_is_active, g.slug AS game_slug
     FROM developer_submissions s
     LEFT JOIN games g ON s.game_id = g.id
     WHERE s.id = ? AND s.developer_id = ?`,
    [id, developerId]
  );
  return rows[0] || null;
}

async function loadScreenshots(submissionId) {
  const [rows] = await db.query(
    `SELECT id, image_url, position FROM developer_submission_screenshots
     WHERE submission_id = ? ORDER BY position ASC, id ASC`,
    [submissionId]
  );
  return rows;
}

/** What the developer still owes us, in the order the form presents it. */
function checklist(sub, screenshots) {
  return [
    { key: 'short_description', label: 'Short description',                      done: !!sub.short_description },
    { key: 'icon',              label: 'Square icon',                            done: !!sub.thumbnail_url },
    { key: 'screenshots',       label: `${MIN_SCREENSHOTS} or more screenshots`, done: screenshots.length >= MIN_SCREENSHOTS },
    { key: 'tags',              label: 'At least one tag',                       done: !!(sub.listing_tags || '').trim() },
  ];
}

const isComplete = (sub, screenshots) => checklist(sub, screenshots).every(i => i.done);

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

  await db.query(
    `UPDATE games
     SET short_description = ?, long_description = ?, controls = ?,
         thumbnail_url = ?, secondary_thumbnail = COALESCE(?, secondary_thumbnail)
     WHERE id = ?`,
    [
      sub.short_description,
      sub.description,
      sub.controls || null,
      sub.thumbnail_url,
      sub.banner_url || null,
      sub.game_id,
    ]
  );

  // Screenshots: mirror the submission's set onto the game. The R2 objects are
  // shared, so this copies URLs only — nothing is re-uploaded or orphaned.
  await db.query('DELETE FROM game_screenshots WHERE game_id = ?', [sub.game_id]);
  if (screenshots.length) {
    await db.query(
      'INSERT INTO game_screenshots (game_id, image_url) VALUES ?',
      [screenshots.map(s => [sub.game_id, s.image_url])]
    );
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
async function replaceImage(sub, column, file, slot) {
  const { buffer, hash } = await toWebp(file.buffer);
  const key = `images/listings/sub-${sub.id}-${slot}-${hash}.webp`;
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
async function resyncIfApproved(submissionId, developerId) {
  const fresh = await loadOwned(developerId, submissionId);
  if (!fresh || fresh.status !== 'approved') return;
  const shots = await loadScreenshots(submissionId);
  if (isComplete(fresh, shots)) {
    await syncToGame(fresh, shots);
  } else {
    // Nothing should be able to make a submitted listing incomplete — the edit
    // paths all refuse it. Leave the published game untouched and flag it.
    console.warn(`[listing] submission ${submissionId} is approved but incomplete; skipped game sync`);
  }
}

// ── GET /developer/listings ──────────────────────────────────────────────────
exports.getListings = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT s.id, s.title, s.status, s.thumbnail_url, s.short_description,
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
    const sub = await loadOwned(req.session.developer.id, req.params.id);
    if (!sub) {
      req.flash('error_msg', 'Submission not found.');
      return res.redirect('/developer/listings');
    }
    if (!EDITABLE.has(sub.status)) {
      req.flash('error_msg', 'The store listing opens once your game has passed review.');
      return res.redirect(`/developer/submissions/${sub.id}`);
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
  const { id } = req.params;
  const back = `/developer/submissions/${id}/listing`;

  try {
    const sub = await loadOwned(req.session.developer.id, id);
    if (!sub) {
      req.flash('error_msg', 'Submission not found.');
      return res.redirect('/developer/listings');
    }
    if (!EDITABLE.has(sub.status)) {
      req.flash('error_msg', 'This listing is not open for editing.');
      return res.redirect(`/developer/submissions/${id}`);
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
      [shortDesc, longDesc, controls, tags.join(', ') || null, trailer, id]
    );

    const fresh = await loadOwned(req.session.developer.id, id);
    const screenshots = await loadScreenshots(id);

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
          [id]
        );
        req.flash('success_msg', 'Store listing submitted! Your game is queued for publishing — we’ll email you the moment it goes live.');
      } else {
        req.flash('success_msg', 'Store listing updated.');
      }
      return res.redirect(`/developer/submissions/${id}`);
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

// ── POST /developer/submissions/:id/listing/icon | /banner ───────────────────
const imageUploader = (column, slot, label) => async (req, res) => {
  const { id } = req.params;
  const back = `/developer/submissions/${id}/listing`;

  try {
    const sub = await loadOwned(req.session.developer.id, id);
    if (!sub || !EDITABLE.has(sub.status)) {
      req.flash('error_msg', 'This listing is not open for editing.');
      return res.redirect('/developer/listings');
    }
    if (req.uploadError) { req.flash('error_msg', req.uploadError); return res.redirect(back); }
    if (!req.file)       { req.flash('error_msg', `Choose a ${label} image to upload.`); return res.redirect(back); }

    await replaceImage(sub, column, req.file, slot);
    await resyncIfApproved(id, req.session.developer.id);
    req.flash('success_msg', `${label} updated.`);
  } catch (err) {
    req.flash('error_msg', `${label} upload failed: ${err.message}`);
  }
  res.redirect(back);
};

exports.postIcon   = imageUploader('thumbnail_url', 'icon',   'Icon');
exports.postBanner = imageUploader('banner_url',    'banner', 'Banner');

// ── POST /developer/submissions/:id/listing/screenshots ──────────────────────
exports.postScreenshots = async (req, res) => {
  const { id } = req.params;
  const back = `/developer/submissions/${id}/listing`;

  try {
    const sub = await loadOwned(req.session.developer.id, id);
    if (!sub || !EDITABLE.has(sub.status)) {
      req.flash('error_msg', 'This listing is not open for editing.');
      return res.redirect('/developer/listings');
    }
    if (req.uploadError) { req.flash('error_msg', req.uploadError); return res.redirect(back); }

    const files = req.files || [];
    if (!files.length) { req.flash('error_msg', 'Choose at least one screenshot to upload.'); return res.redirect(back); }

    const existing = await loadScreenshots(id);
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
      const key = `images/listings/sub-${id}-shot-${uid}.webp`;
      const publicUrl = await r2.uploadBuffer(key, buffer, 'image/webp', IMMUTABLE_CACHE);
      values.push([id, publicUrl, position++]);
    }
    await db.query(
      'INSERT INTO developer_submission_screenshots (submission_id, image_url, position) VALUES ?',
      [values]
    );
    await resyncIfApproved(id, req.session.developer.id);

    req.flash('success_msg', files.length > accepted.length
      ? `${accepted.length} screenshot(s) added — the rest exceeded the ${MAX_SCREENSHOTS}-image limit.`
      : `${accepted.length} screenshot(s) added.`);
  } catch (err) {
    req.flash('error_msg', 'Screenshot upload failed: ' + err.message);
  }
  res.redirect(back);
};

// ── POST /developer/submissions/:id/listing/screenshots/:shotId/delete ───────
exports.postDeleteScreenshot = async (req, res) => {
  const { id, shotId } = req.params;
  const back = `/developer/submissions/${id}/listing`;

  try {
    const sub = await loadOwned(req.session.developer.id, id);
    if (!sub || !EDITABLE.has(sub.status)) {
      req.flash('error_msg', 'This listing is not open for editing.');
      return res.redirect('/developer/listings');
    }

    // Once a listing is submitted its images are what the public game page
    // shows. Deleting below the minimum there would strip a live listing and
    // leave the game page holding whatever was synced last, so refuse instead.
    if (sub.status === 'approved') {
      const current = await loadScreenshots(id);
      if (current.length <= MIN_SCREENSHOTS) {
        req.flash('error_msg', `A published listing needs at least ${MIN_SCREENSHOTS} screenshots. Upload a replacement first, then remove this one.`);
        return res.redirect(back);
      }
    }

    const [rows] = await db.query(
      'SELECT image_url FROM developer_submission_screenshots WHERE id = ? AND submission_id = ?',
      [shotId, id]
    );
    if (rows.length) {
      await db.query('DELETE FROM developer_submission_screenshots WHERE id = ?', [shotId]);
      const key = r2.keyFromUrl(rows[0].image_url);
      if (key) await r2.deleteObject(key).catch(() => {});
      await resyncIfApproved(id, req.session.developer.id);
    }
    req.flash('success_msg', 'Screenshot removed.');
  } catch (err) {
    req.flash('error_msg', 'Failed to remove the screenshot.');
  }
  res.redirect(back);
};

module.exports.checklist  = checklist;
module.exports.isComplete = isComplete;
