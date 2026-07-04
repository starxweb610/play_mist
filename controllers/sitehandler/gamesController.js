const db     = require('../../config/database');
const AdmZip = require('adm-zip');
const fse    = require('fs-extra');
const fs     = require('fs');
const path   = require('path');
const PATHS  = require('../../config/paths');
const r2     = require('../../config/r2');
const { formatBytes } = require('../../utils/format');

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
  const { type, genre, status, q } = req.query;
  let sql = `SELECT g.*, a.name AS creator
             FROM games g LEFT JOIN admins a ON g.created_by = a.id WHERE 1=1`;
  const params = [];
  if (type)   { sql += ' AND g.type = ?';  params.push(type); }
  if (genre)  { sql += ' AND g.genre = ?'; params.push(genre); }
  if (status === 'active')   { sql += ' AND g.is_active = 1'; }
  if (status === 'inactive') { sql += ' AND g.is_active = 0'; }
  if (q)      { sql += ' AND g.title LIKE ?'; params.push(`%${q}%`); }
  sql += ' ORDER BY g.created_at DESC';

  let games = [];
  let genres = [];
  try {
    const [gamesRows] = await db.query(sql, params);
    const [genresRows] = await db.query('SELECT * FROM genres ORDER BY name ASC');
    games = gamesRows;
    genres = genresRows;
  } catch (_) {}

  res.render('sitehandler/games/index', {
    title: 'Manage Games', activePage: 'games',
    games, filters: { type, genre, status, q }, genres,
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

    const mappedScreenshots = screenshots.map(s => ({
      ...s,
      image_url: formatAdminImagePath(s.image_url)
    }));

    res.render('sitehandler/games/detail', {
      title: game.title, activePage: 'games',
      game, genres, tags, selectedTagIds, screenshots: mappedScreenshots,
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
    short_description, long_description, trailer_url,
    version, is_active, is_featured,
    studio, credits_cost, flag,
    tags
  } = req.body;
  try {
    const base = slugify(title);
    const slug = await uniqueSlug(base, parseInt(id));
    await db.query(
      `UPDATE games SET title=?, slug=?, genre=?, orientation=?, type=?,
       short_description=?, long_description=?, trailer_url=?,
       version=?, is_active=?, is_featured=?,
       studio=?, credits_cost=?, flag=? WHERE id=?`,
      [
        title, slug, genre, orientation, type,
        short_description, long_description || null, trailer_url?.trim() || null,
        version || '1.0.0',
        is_active === 'on' ? 1 : 0,
        is_featured === 'on' ? 1 : 0,
        studio || null,
        credits_cost ? parseInt(credits_cost) : null,
        flag || null,
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

// ── POST /sitehandler/games/:id/upload-image ─────────────────────────────────
exports.postUploadImage = async (req, res) => {
  const { id } = req.params;
  const imgFile = req.file;

  if (!imgFile) {
    req.flash('error_msg', 'No image uploaded. Please select a JPG, PNG, or WebP file.');
    return res.redirect(`/sitehandler/games/${id}`);
  }

  try {
    const key = `images/games/game-${id}${path.extname(imgFile.originalname).toLowerCase()}`;
    const publicUrl = await r2.uploadBuffer(key, imgFile.buffer, imgFile.mimetype);

    // Delete old thumbnail from R2 if it had a different key (different extension)
    const [rows] = await db.query('SELECT thumbnail_url FROM games WHERE id = ?', [id]);
    const oldKey = rows.length ? r2.keyFromUrl(rows[0].thumbnail_url) : null;
    if (oldKey && oldKey !== key) await r2.deleteObject(oldKey).catch(() => {});

    await db.query('UPDATE games SET thumbnail_url = ? WHERE id = ?', [publicUrl, id]);
    req.flash('success_msg', '✅ Game thumbnail updated.');
    res.redirect(`/sitehandler/games/${id}`);
  } catch (err) {
    req.flash('error_msg', 'Image upload failed: ' + err.message);
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
    const key = `images/games/game-${id}-secondary${path.extname(imgFile.originalname).toLowerCase()}`;
    const publicUrl = await r2.uploadBuffer(key, imgFile.buffer, imgFile.mimetype);

    const [rows] = await db.query('SELECT secondary_thumbnail FROM games WHERE id = ?', [id]);
    const oldKey = rows.length ? r2.keyFromUrl(rows[0].secondary_thumbnail) : null;
    if (oldKey && oldKey !== key) await r2.deleteObject(oldKey).catch(() => {});

    await db.query('UPDATE games SET secondary_thumbnail = ? WHERE id = ?', [publicUrl, id]);
    req.flash('success_msg', '✅ Secondary thumbnail updated.');
    res.redirect(`/sitehandler/games/${id}`);
  } catch (err) {
    req.flash('error_msg', 'Secondary image upload failed: ' + err.message);
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
    const key = `images/games/game-${id}-promo${path.extname(imgFile.originalname).toLowerCase()}`;
    const publicUrl = await r2.uploadBuffer(key, imgFile.buffer, imgFile.mimetype);

    const [rows] = await db.query('SELECT promotional_thumbnail FROM games WHERE id = ?', [id]);
    const oldKey = rows.length ? r2.keyFromUrl(rows[0].promotional_thumbnail) : null;
    if (oldKey && oldKey !== key) await r2.deleteObject(oldKey).catch(() => {});

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
    const [rows] = await db.query('SELECT title, thumbnail_url, is_active FROM games WHERE id = ?', [req.params.id]);
    if (!rows.length) { req.flash('error_msg', 'Game not found.'); return res.redirect('/sitehandler/games'); }

    await db.query('UPDATE games SET is_active = NOT is_active WHERE id = ?', [req.params.id]);

    // When a game goes from inactive → active (published), send a push to all users
    if (!rows[0].is_active) {
      const { sendAndSaveNotification } = require('../../utils/fcm');
      const gameTitle = rows[0].title;
      sendAndSaveNotification({
        type:     'new_game',
        title:    '🎮 New game on Play Mist!',
        body:     `"${gameTitle}" is now available. Tap to play!`,
        imageUrl: rows[0].thumbnail_url || null,
        gameId:   parseInt(req.params.id),
        sentBy:   req.session.admin?.id || null,
        data:     { type: 'new_game', game_id: req.params.id },
      }).catch(e => console.error('FCM push error:', e));
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
      const key = `images/screenshots/screenshot-${id}-${uid}${path.extname(file.originalname).toLowerCase()}`;
      const publicUrl = await r2.uploadBuffer(key, file.buffer, file.mimetype);
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
