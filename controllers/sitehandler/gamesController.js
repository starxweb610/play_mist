const db     = require('../../config/database');
const AdmZip = require('adm-zip');
const fse    = require('fs-extra');
const fs     = require('fs');
const path   = require('path');
const PATHS  = require('../../config/paths');
const r2     = require('../../config/r2');
const { formatBytes } = require('../../utils/format');
const { toWebp, presetSize, ImageTooSmallError, IMMUTABLE_CACHE } = require('../../utils/images');

// ── Helpers ─────────────────────────────────────────────────────────────────
/**
 * Recursively collects absolute file paths under `dir`, skipping macOS zip
 * metadata (__MACOSX folders and ._* dotfiles).
 */
function walkFiles(dir) {
  const results = [];
  (function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '__MACOSX' || entry.name.startsWith('._')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else results.push(full);
    }
  })(dir);
  return results;
}

function slugify(str) {
  return str.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function uniqueSlug(base, excludeId = null) {
  let slug = base, n = 1;
  while (true) {
    const q = excludeId
      ? 'SELECT id FROM games WHERE slug = ? AND id != ?'
      : 'SELECT id FROM games WHERE slug = ?';
    const params = excludeId ? [slug, excludeId] : [slug];
    const [rows] = await db.query(q, params);
    if (rows.length === 0) return slug;
    slug = `${base}-${++n}`;
  }
}

// Genres are loaded dynamically from the 'genres' table in the database


// ── GET /sitehandler/games ───────────────────────────────────────────────────
exports.getIndex = async (req, res) => {
  const { type, genre, status, q, sort } = req.query;
  // play_count uses the same all-time analytics_games count the app API shows as `plays`
  let sql = `SELECT g.*, a.name AS creator,
               (SELECT COUNT(*) FROM analytics_games ag WHERE ag.game_id = g.id) AS play_count
             FROM games g LEFT JOIN admins a ON g.created_by = a.id WHERE 1=1`;
  const params = [];
  if (type)   { sql += ' AND g.type = ?';  params.push(type); }
  if (genre)  { sql += ' AND g.genre = ?'; params.push(genre); }
  if (status === 'active')   { sql += ' AND g.is_active = 1'; }
  if (status === 'inactive') { sql += ' AND g.is_active = 0'; }
  if (status === 'in_development') { sql += " AND g.release_stage = 'in_development'"; }
  if (q)      { sql += ' AND g.title LIKE ?'; params.push(`%${q}%`); }
  // Whitelisted sort orders — the raw query value never reaches the SQL string
  const SORT_ORDERS = {
    most_played:  'play_count DESC, g.created_at DESC',
    least_played: 'play_count ASC, g.created_at DESC',
  };
  sql += ` ORDER BY ${Object.hasOwn(SORT_ORDERS, sort) ? SORT_ORDERS[sort] : 'g.created_at DESC'}`;

  let games = [];
  let genres = [];
  // Which in-development titles actually reach the app's Coming Soon rail —
  // mirrors the LIMIT 5 in gamesApi.getComingSoonGames so the list view can
  // say plainly which ones players will and won't see.
  let comingSoonVisibleIds = [];
  try {
    const [gamesRows] = await db.query(sql, params);
    const [genresRows] = await db.query('SELECT * FROM genres ORDER BY name ASC');
    games = gamesRows;
    genres = genresRows;

    const [visibleRows] = await db.query(
      `SELECT id FROM games WHERE release_stage = 'in_development'
       ORDER BY coming_soon_rank ASC, created_at DESC LIMIT 5`
    );
    comingSoonVisibleIds = visibleRows.map(r => r.id);
  } catch (_) {}

  res.render('sitehandler/games/index', {
    title: 'Manage Games', activePage: 'games',
    games, filters: { type, genre, status, q, sort }, genres, comingSoonVisibleIds,
  });
};

// ── GET /sitehandler/games/create ────────────────────────────────────────────
exports.getCreate = async (_req, res) => {
  let genres = [];
  try {
    const [rows] = await db.query('SELECT * FROM genres ORDER BY name ASC');
    genres = rows;
  } catch (_) {}
  res.render('sitehandler/games/create', {
    title: 'Upload New Game', activePage: 'games', genres,
  });
};

// ── POST /sitehandler/games/create ──────────────────────────────────────────
exports.postCreate = async (req, res) => {
  const { title, genre, orientation, type, short_description } = req.body;
  if (!title || !genre || !orientation || !type || !short_description) {
    req.flash('error_msg', 'All fields are required.');
    return res.redirect('/sitehandler/games/create');
  }
  const base = slugify(title);
  const slug = await uniqueSlug(base);

  try {
    const [result] = await db.query(
      `INSERT INTO games (title, slug, short_description, genre, type, orientation, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [title.trim(), slug, short_description.trim(), genre, type, orientation, req.session.admin.id]
    );
    req.flash('success_msg', `Game "${title}" created. Now add the details and upload files.`);
    res.redirect(`/sitehandler/games/${result.insertId}`);
  } catch (err) {
    req.flash('error_msg', 'Failed to create game: ' + err.message);
    res.redirect('/sitehandler/games/create');
  }
};

// ── GET /sitehandler/games/:id ───────────────────────────────────────────────
exports.getDetail = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM games WHERE id = ?', [req.params.id]);
    if (!rows.length) { req.flash('error_msg', 'Game not found.'); return res.redirect('/sitehandler/games'); }
    
    const [genres] = await db.query('SELECT * FROM genres ORDER BY name ASC');
    const [tags] = await db.query('SELECT * FROM tags ORDER BY name ASC');
    const [gameTags] = await db.query('SELECT tag_id FROM game_tags WHERE game_id = ?', [req.params.id]);
    const selectedTagIds = gameTags.map(gt => gt.tag_id);
    const [screenshots] = await db.query('SELECT * FROM game_screenshots WHERE game_id = ?', [req.params.id]);
    const [developers] = await db.query(
      'SELECT id, name, studio_name, handle FROM developers WHERE is_active = 1 ORDER BY name ASC'
    );

    // Live stats replacing the old manually-entered size/plays/rating fields
    const [[playStats]] = await db.query(
      'SELECT COUNT(*) AS playCount FROM analytics_games WHERE game_id = ?', [req.params.id]
    );
    let ratingStats = { avgRating: null, ratingCount: 0 };
    try {
      const [[r]] = await db.query(
        'SELECT AVG(rating) AS avgRating, COUNT(*) AS ratingCount FROM game_ratings WHERE game_id = ?',
        [req.params.id]
      );
      ratingStats = r;
    } catch (_) {}

    const game = rows[0];
    const formatAdminImagePath = (pathStr) => {
      if (!pathStr) return '';
      if (pathStr.startsWith('/images/')) {
        return `/api/v1/image-proxy?file=${encodeURIComponent(pathStr)}`;
      }
      return pathStr;
    };

    game.thumbnail_url = formatAdminImagePath(game.thumbnail_url);
    game.secondary_thumbnail = formatAdminImagePath(game.secondary_thumbnail);
    game.promotional_thumbnail = formatAdminImagePath(game.promotional_thumbnail);
    // formatBytes isn't available inside EJS — precompute the demo size label
    game.demo_size_label = game.demo_size_bytes ? formatBytes(game.demo_size_bytes) : '';

    const mappedScreenshots = screenshots.map(s => ({
      ...s,
      image_url: formatAdminImagePath(s.image_url)
    }));

    res.render('sitehandler/games/detail', {
      title: game.title, activePage: 'games',
      game, genres, tags, selectedTagIds, screenshots: mappedScreenshots, developers,
      // So the upload hints state the exact sizes the converter enforces.
      artSizes: { thumbnail: presetSize('gameThumb'), banner: presetSize('gameBanner') },
      liveStats: {
        playCount:   playStats.playCount,
        avgRating:   ratingStats.avgRating ? Number(ratingStats.avgRating).toFixed(1) : null,
        ratingCount: ratingStats.ratingCount,
      },
    });
  } catch (err) {
    req.flash('error_msg', err.message);
    res.redirect('/sitehandler/games');
  }
};

// ── POST /sitehandler/games/:id/update ──────────────────────────────────────
exports.postUpdate = async (req, res) => {
  const { id } = req.params;
  // size, plays and rating are intentionally absent: size is captured from the
  // uploaded zip, plays comes from analytics_games, rating from game_ratings.
  const {
    title, genre, orientation, type,
    short_description, long_description, controls, trailer_url,
    version, is_active, is_featured,
    studio, credits_cost, flag,
    release_stage, expected_release, coming_soon_rank,
    tags, developer_id
  } = req.body;
  // Which developer's public profile lists this game ('' = none)
  const developerId = /^\d+$/.test(String(developer_id || '')) ? Number(developer_id) : null;
  try {
    const [prevRows] = await db.query('SELECT is_active FROM games WHERE id = ?', [id]);
    const wasActive  = prevRows.length ? !!prevRows[0].is_active : false;

    // An in-development game is forced inactive. This is what makes the
    // "Coming Soon only" containment structural rather than a habit — leaving
    // the Active toggle on can't publish an unfinished game to the catalog.
    const stage       = release_stage === 'in_development' ? 'in_development' : 'live';
    const isActiveNow = stage === 'in_development' ? 0 : (is_active === 'on' ? 1 : 0);

    const base = slugify(title);
    const slug = await uniqueSlug(base, parseInt(id));
    await db.query(
      `UPDATE games SET title=?, slug=?, genre=?, orientation=?, type=?,
       short_description=?, long_description=?, controls=?, trailer_url=?,
       version=?, is_active=?, is_featured=?,
       studio=?, developer_id=?, credits_cost=?, flag=?,
       release_stage=?, expected_release=?, coming_soon_rank=? WHERE id=?`,
      [
        title, slug, genre, orientation, type,
        short_description, long_description || null, controls?.trim() || null, trailer_url?.trim() || null,
        version || '1.0.0',
        isActiveNow,
        is_featured === 'on' ? 1 : 0,
        studio || null,
        developerId,
        credits_cost ? parseInt(credits_cost) : null,
        flag || null,
        stage,
        stage === 'in_development' ? (expected_release?.trim() || null) : null,
        stage === 'in_development' ? (parseInt(coming_soon_rank, 10) || 0) : 0,
        id,
      ]
    );

    // Update tags
    await db.query('DELETE FROM game_tags WHERE game_id = ?', [id]);
    let tagIds = [];
    if (tags) {
      tagIds = Array.isArray(tags) ? tags.map(t => parseInt(t)) : [parseInt(tags)];
    }
    if (tagIds.length > 0) {
      const values = tagIds.map(tId => [id, tId]);
      await db.query('INSERT INTO game_tags (game_id, tag_id) VALUES ?', [values]);
    }

    // Game published via the edit form (inactive → active): push to all users
    // + "your game is live" email to the submitting developer. Promoting a
    // Coming Soon title (stage → live + Active on) is exactly this transition,
    // so the launch announcement fires for it too.
    if (!wasActive && isActiveNow === 1) {
      const { announceGameLive } = require('../../utils/gameLive');
      announceGameLive(parseInt(id), req.session.admin?.id || null);
    }

    req.flash('success_msg', 'Game details updated.');
    res.redirect(`/sitehandler/games/${id}`);
  } catch (err) {
    req.flash('error_msg', 'Update failed: ' + err.message);
    res.redirect(`/sitehandler/games/${id}`);
  }
};

// ── POST /sitehandler/games/:id/upload ──────────────────────────────────────
exports.postUpload = async (req, res) => {
  const { id } = req.params;
  const zipFile = req.file;

  if (!zipFile) {
    req.flash('error_msg', 'No file uploaded. Please select a .zip file.');
    return res.redirect(`/sitehandler/games/${id}`);
  }

  let extractDir = null;
  try {
    const [rows] = await db.query('SELECT * FROM games WHERE id = ?', [id]);
    if (!rows.length) throw new Error('Game not found');
    const game = rows[0];

    const zip     = new AdmZip(zipFile.path);
    const entries = zip.getEntries().map(e => e.entryName.replace(/\\/g, '/'));

    if (game.type === 'webgl' || game.type === 'premium') {
      // Require index.html at root
      const hasRoot = entries.some(e => e === 'index.html' || e.match(/^[^/]+\/index\.html$/));
      if (!hasRoot) throw new Error('ZIP must contain index.html at root (or one folder deep).');

      extractDir = path.join(PATHS.TEMP_DIR, `extract_${Date.now()}_${id}`);
      await fse.ensureDir(extractDir);

      // If index.html is inside a subdirectory, extract the folder's content directly
      const subFolder = entries.find(e => e.match(/^[^/]+\/index\.html$/));
      if (subFolder) {
        // Extract everything and move subfolder contents to the extract root
        const tempExtract = path.join(PATHS.TEMP_DIR, `extract_raw_${Date.now()}_${id}`);
        await fse.ensureDir(tempExtract);
        zip.extractAllTo(tempExtract, true);
        const folderName = subFolder.split('/')[0];
        await fse.copy(path.join(tempExtract, folderName), extractDir);
        await fse.remove(tempExtract);
      } else {
        zip.extractAllTo(extractDir, true);
      }

      const r2Prefix = `games/webgl/${game.slug}`;

      // Clear any previous build so renamed/removed files don't linger on R2
      await r2.deletePrefix(`${r2Prefix}/`);

      // Upload every extracted file to R2, preserving relative paths and
      // setting Content-Type/Content-Encoding (handles Unity's .gz/.br builds)
      const files = walkFiles(extractDir);
      const CONCURRENCY = 5;
      for (let i = 0; i < files.length; i += CONCURRENCY) {
        await Promise.all(files.slice(i, i + CONCURRENCY).map(filePath => {
          const rel = path.relative(extractDir, filePath).replace(/\\/g, '/');
          const key = `${r2Prefix}/${rel}`;
          return r2.uploadFile(key, filePath, r2.getContentType(rel), r2.getContentEncoding(rel));
        }));
      }

      // Upload the raw zip alongside the extracted build
      await r2.uploadFile(`${r2Prefix}/game.zip`, zipFile.path, 'application/zip');

      const playUrl = r2.getPublicUrl(`${r2Prefix}/index.html`);
      const zipUrl  = r2.getPublicUrl(`${r2Prefix}/game.zip`);

      // Build size is captured from the uploaded zip — never entered manually
      const sizeBytes = fs.statSync(zipFile.path).size;

      await db.query(
        'UPDATE games SET file_path=?, play_url=?, zip_url=?, size_bytes=?, size=? WHERE id=?',
        [r2Prefix, playUrl, zipUrl, sizeBytes, formatBytes(sizeBytes), id]
      );
      req.flash('success_msg', `✅ ${game.type === 'premium' ? 'Premium' : 'WebGL'} game uploaded to R2! Test it at: ${playUrl}`);
    }

    res.redirect(`/sitehandler/games/${id}`);
  } catch (err) {
    req.flash('error_msg', 'Upload failed: ' + err.message);
    res.redirect(`/sitehandler/games/${id}`);
  } finally {
    await fse.remove(zipFile.path).catch(() => {});
    if (extractDir) await fse.remove(extractDir).catch(() => {});
  }
};

// ── POST /sitehandler/games/:id/upload-demo ──────────────────────────────────
// Publishes a playtest build for an in-development game. Deliberately writes
// only the demo_* columns and uploads to its own R2 prefix, so the eventual
// real build (file_path / play_url / zip_url / size_bytes) is never touched and
// shipping the finished game needs no cleanup here.
exports.postUploadDemo = async (req, res) => {
  const { id } = req.params;
  const zipFile = req.file;

  if (!zipFile) {
    req.flash('error_msg', 'No file uploaded. Please select a .zip file.');
    return res.redirect(`/sitehandler/games/${id}`);
  }

  let extractDir = null;
  try {
    const [rows] = await db.query('SELECT * FROM games WHERE id = ?', [id]);
    if (!rows.length) throw new Error('Game not found');
    const game = rows[0];

    if (game.release_stage !== 'in_development') {
      throw new Error('Demo builds can only be uploaded to in-development games.');
    }

    const demoVersion = (req.body.demo_version || '').trim() || '0.1.0';

    const zip     = new AdmZip(zipFile.path);
    const entries = zip.getEntries().map(e => e.entryName.replace(/\\/g, '/'));

    const hasRoot = entries.some(e => e === 'index.html' || e.match(/^[^/]+\/index\.html$/));
    if (!hasRoot) throw new Error('ZIP must contain index.html at root (or one folder deep).');

    extractDir = path.join(PATHS.TEMP_DIR, `demo_extract_${Date.now()}_${id}`);
    await fse.ensureDir(extractDir);

    const subFolder = entries.find(e => e.match(/^[^/]+\/index\.html$/));
    if (subFolder) {
      const tempExtract = path.join(PATHS.TEMP_DIR, `demo_raw_${Date.now()}_${id}`);
      await fse.ensureDir(tempExtract);
      zip.extractAllTo(tempExtract, true);
      await fse.copy(path.join(tempExtract, subFolder.split('/')[0]), extractDir);
      await fse.remove(tempExtract);
    } else {
      zip.extractAllTo(extractDir, true);
    }

    // Own prefix — never collides with the real build at games/webgl/<slug>
    const r2Prefix = `games/demo/${game.slug}`;
    await r2.deletePrefix(`${r2Prefix}/`);

    const files = walkFiles(extractDir);
    const CONCURRENCY = 5;
    for (let i = 0; i < files.length; i += CONCURRENCY) {
      await Promise.all(files.slice(i, i + CONCURRENCY).map(filePath => {
        const rel = path.relative(extractDir, filePath).replace(/\\/g, '/');
        return r2.uploadFile(`${r2Prefix}/${rel}`, filePath,
          r2.getContentType(rel), r2.getContentEncoding(rel));
      }));
    }
    await r2.uploadFile(`${r2Prefix}/game.zip`, zipFile.path, 'application/zip');

    const sizeBytes = fs.statSync(zipFile.path).size;
    await db.query(
      `UPDATE games SET demo_zip_url=?, demo_version=?, demo_size_bytes=?, demo_enabled=1
       WHERE id=?`,
      [r2.getPublicUrl(`${r2Prefix}/game.zip`), demoVersion, sizeBytes, id]
    );

    req.flash('success_msg', `✅ Demo v${demoVersion} published — players can now test it from Coming Soon.`);
    res.redirect(`/sitehandler/games/${id}`);
  } catch (err) {
    req.flash('error_msg', 'Demo upload failed: ' + err.message);
    res.redirect(`/sitehandler/games/${id}`);
  } finally {
    await fse.remove(zipFile.path).catch(() => {});
    if (extractDir) await fse.remove(extractDir).catch(() => {});
  }
};

// ── POST /sitehandler/games/:id/demo-toggle ──────────────────────────────────
// Pulls a demo without deleting it — the build and its feedback stay intact.
exports.postDemoToggle = async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('UPDATE games SET demo_enabled = ? WHERE id = ?',
      [req.body.demo_enabled === 'on' ? 1 : 0, id]);
    req.flash('success_msg', req.body.demo_enabled === 'on'
      ? 'Demo is live for players.' : 'Demo hidden from players.');
  } catch (err) {
    req.flash('error_msg', 'Failed to toggle demo: ' + err.message);
  }
  res.redirect(`/sitehandler/games/${id}`);
};

/**
 * Deletes a superseded image, unless a developer's store listing still points
 * at it. Listings that predate the copy-on-sync behaviour share their object
 * with the game; removing it here would leave that developer's listing page
 * showing a dead image for artwork they still own.
 */
async function deleteUnlessListingUses(key) {
  if (!key) return;
  const url = r2.getPublicUrl(key);
  const [[{ n }]] = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM developer_submissions
         WHERE thumbnail_url = ? OR banner_url = ? OR reference_image_url = ?)
     + (SELECT COUNT(*) FROM developer_submission_screenshots WHERE image_url = ?) AS n`,
    [url, url, url, url]
  );
  if (Number(n) > 0) return;
  await r2.deleteObject(key).catch(() => {});
}

// ── POST /sitehandler/games/:id/upload-image ─────────────────────────────────
exports.postUploadImage = async (req, res) => {
  const { id } = req.params;
  const imgFile = req.file;

  if (!imgFile) {
    req.flash('error_msg', 'No image uploaded. Please select a JPG, PNG, or WebP file.');
    return res.redirect(`/sitehandler/games/${id}`);
  }

  try {
    // Exactly 1024x1536 — the shape every card and rail is laid out for.
    const { buffer, hash } = await toWebp(imgFile.buffer, 'gameThumb');
    const key = `images/games/game-${id}-${hash}.webp`;
    const publicUrl = await r2.uploadBuffer(key, buffer, 'image/webp', IMMUTABLE_CACHE);

    // Delete old thumbnail from R2 if it had a different key (different image content)
    const [rows] = await db.query('SELECT thumbnail_url FROM games WHERE id = ?', [id]);
    const oldKey = rows.length ? r2.keyFromUrl(rows[0].thumbnail_url) : null;
    if (oldKey && oldKey !== key) await deleteUnlessListingUses(oldKey);

    await db.query('UPDATE games SET thumbnail_url = ? WHERE id = ?', [publicUrl, id]);
    req.flash('success_msg', '✅ Game thumbnail updated.');
    res.redirect(`/sitehandler/games/${id}`);
  } catch (err) {
    req.flash('error_msg', err instanceof ImageTooSmallError
      ? `Thumbnail: ${err.message}` : 'Image upload failed: ' + err.message);
    res.redirect(`/sitehandler/games/${id}`);
  }
};

// ── POST /sitehandler/games/:id/upload-secondary-image ───────────────────────
exports.postUploadSecondaryImage = async (req, res) => {
  const { id } = req.params;
  const imgFile = req.file;

  if (!imgFile) {
    req.flash('error_msg', 'No secondary image uploaded. Please select a JPG, PNG, or WebP file.');
    return res.redirect(`/sitehandler/games/${id}`);
  }

  try {
    // Exactly 1536x1024 — the wide companion to the portrait thumbnail.
    const { buffer, hash } = await toWebp(imgFile.buffer, 'gameBanner');
    const key = `images/games/game-${id}-secondary-${hash}.webp`;
    const publicUrl = await r2.uploadBuffer(key, buffer, 'image/webp', IMMUTABLE_CACHE);

    const [rows] = await db.query('SELECT secondary_thumbnail FROM games WHERE id = ?', [id]);
    const oldKey = rows.length ? r2.keyFromUrl(rows[0].secondary_thumbnail) : null;
    if (oldKey && oldKey !== key) await deleteUnlessListingUses(oldKey);

    await db.query('UPDATE games SET secondary_thumbnail = ? WHERE id = ?', [publicUrl, id]);
    req.flash('success_msg', '✅ Secondary thumbnail updated.');
    res.redirect(`/sitehandler/games/${id}`);
  } catch (err) {
    req.flash('error_msg', err instanceof ImageTooSmallError
      ? `Banner: ${err.message}` : 'Secondary image upload failed: ' + err.message);
    res.redirect(`/sitehandler/games/${id}`);
  }
};

// ── POST /sitehandler/games/:id/upload-promotional-image ─────────────────────
exports.postUploadPromotionalImage = async (req, res) => {
  const { id } = req.params;
  const imgFile = req.file;

  if (!imgFile) {
    req.flash('error_msg', 'No promotional image uploaded. Please select a JPG, PNG, or WebP file.');
    return res.redirect(`/sitehandler/games/${id}`);
  }

  try {
    const { buffer, hash } = await toWebp(imgFile.buffer);
    const key = `images/games/game-${id}-promo-${hash}.webp`;
    const publicUrl = await r2.uploadBuffer(key, buffer, 'image/webp', IMMUTABLE_CACHE);

    const [rows] = await db.query('SELECT promotional_thumbnail FROM games WHERE id = ?', [id]);
    const oldKey = rows.length ? r2.keyFromUrl(rows[0].promotional_thumbnail) : null;
    if (oldKey && oldKey !== key) await deleteUnlessListingUses(oldKey);

    await db.query('UPDATE games SET promotional_thumbnail = ? WHERE id = ?', [publicUrl, id]);
    req.flash('success_msg', '✅ Promotional thumbnail updated.');
    res.redirect(`/sitehandler/games/${id}`);
  } catch (err) {
    req.flash('error_msg', 'Promotional image upload failed: ' + err.message);
    res.redirect(`/sitehandler/games/${id}`);
  }
};

// ── POST /sitehandler/games/:id/toggle ──────────────────────────────────────
exports.postToggle = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT is_active, title, thumbnail_url FROM games WHERE id = ?', [req.params.id]);
    if (!rows.length) { req.flash('error_msg', 'Game not found.'); return res.redirect('/sitehandler/games'); }

    // A game with no thumbnail renders as an empty tile in every rail, so
    // publishing one is always a mistake. Developers supply the icon with their
    // store listing; if it hasn't arrived, upload one here first.
    if (!rows[0].is_active && !rows[0].thumbnail_url) {
      req.flash('error_msg', `"${rows[0].title}" has no thumbnail — publishing it would leave a blank card. Add one on the game's page (or wait for the developer's store listing) first.`);
      return res.redirect('/sitehandler/games');
    }

    await db.query('UPDATE games SET is_active = NOT is_active WHERE id = ?', [req.params.id]);

    // When a game goes from inactive → active (published), push to all users
    // + "your game is live" email to the submitting developer
    if (!rows[0].is_active) {
      const { announceGameLive } = require('../../utils/gameLive');
      announceGameLive(parseInt(req.params.id), req.session.admin?.id || null);
    }

    res.redirect('/sitehandler/games');
  } catch (err) {
    req.flash('error_msg', err.message);
    res.redirect('/sitehandler/games');
  }
};

// ── POST /sitehandler/games/:id/delete ──────────────────────────────────────
exports.postDelete = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM games WHERE id = ?', [req.params.id]);
    if (rows.length) {
      const game = rows[0];

      // R2: remove the extracted build + zip for this game
      await r2.deletePrefix(`games/webgl/${game.slug}/`).catch(() => {});

      // R2: remove thumbnail / secondary / promotional images and screenshots
      const [screenshots] = await db.query('SELECT image_url FROM game_screenshots WHERE game_id = ?', [req.params.id]);
      const imageUrls = [
        game.thumbnail_url, game.secondary_thumbnail, game.promotional_thumbnail,
        ...screenshots.map(s => s.image_url),
      ];
      for (const url of imageUrls) {
        const key = r2.keyFromUrl(url);
        if (key) await r2.deleteObject(key).catch(() => {});
      }

      // Legacy local cleanup for games/images uploaded before the R2 migration
      if (game.file_path && fs.existsSync(game.file_path)) {
        await fse.remove(game.file_path).catch(() => {});
      }
      const webglDir = path.join(PATHS.WEBGL_DIR, game.slug);
      const premiumDir = path.join(PATHS.PREMIUM_DIR, game.slug);
      await fse.remove(webglDir).catch(() => {});
      await fse.remove(premiumDir).catch(() => {});

      await db.query('DELETE FROM analytics_games WHERE game_id = ?', [req.params.id]);
      await db.query('DELETE FROM games WHERE id = ?', [req.params.id]);
    }
    req.flash('success_msg', 'Game deleted.');
    res.redirect('/sitehandler/games');
  } catch (err) {
    req.flash('error_msg', 'Delete failed: ' + err.message);
    res.redirect('/sitehandler/games');
  }
};

// ── POST /sitehandler/games/:id/upload-screenshots ───────────────────────────
exports.postUploadScreenshots = async (req, res) => {
  const { id } = req.params;
  const files = req.files;

  if (!files || files.length === 0) {
    req.flash('error_msg', 'No files uploaded.');
    return res.redirect(`/sitehandler/games/${id}`);
  }

  try {
    const values = [];
    for (const file of files) {
      const uid = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      const { buffer } = await toWebp(file.buffer);
      const key = `images/screenshots/screenshot-${id}-${uid}.webp`;
      const publicUrl = await r2.uploadBuffer(key, buffer, 'image/webp', IMMUTABLE_CACHE);
      values.push([id, publicUrl]);
    }
    await db.query('INSERT INTO game_screenshots (game_id, image_url) VALUES ?', [values]);
    req.flash('success_msg', `✅ ${files.length} screenshots uploaded successfully.`);
  } catch (err) {
    req.flash('error_msg', 'Failed to save screenshots: ' + err.message);
  }
  res.redirect(`/sitehandler/games/${id}`);
};

// ── POST /sitehandler/games/:id/delete-screenshot/:screenshotId ──────────────
exports.postDeleteScreenshot = async (req, res) => {
  const { id, screenshotId } = req.params;
  try {
    const [rows] = await db.query('SELECT image_url FROM game_screenshots WHERE id = ?', [screenshotId]);
    if (rows.length > 0) {
      const imageUrl = rows[0].image_url;
      await db.query('DELETE FROM game_screenshots WHERE id = ?', [screenshotId]);

      const key = r2.keyFromUrl(imageUrl);
      if (key) {
        await r2.deleteObject(key).catch(() => {});
      } else {
        // Legacy local file (pre-migration screenshot)
        const filePath = path.join(__dirname, '../../public', imageUrl);
        await fse.remove(filePath).catch(() => {});
      }

      req.flash('success_msg', '✅ Screenshot deleted.');
    } else {
      req.flash('error_msg', 'Screenshot not found.');
    }
  } catch (err) {
    req.flash('error_msg', 'Delete failed: ' + err.message);
  }
  res.redirect(`/sitehandler/games/${id}`);
};
