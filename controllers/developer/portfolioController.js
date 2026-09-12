const crypto = require('crypto');
const db     = require('../../config/database');
const r2     = require('../../config/r2');
const { toWebp, IMMUTABLE_CACHE } = require('../../utils/images');
const portfolio = require('../../utils/portfolio');
const { uniqueSlug, matchClause } = require('../../utils/slugs');

const ITEM_FIELDS = `id, slug, developer_id, title, description, image_url, video_provider, video_id,
  play_store_url, app_store_url, steam_url, itch_url, drive_url, position, created_at, updated_at`;

// Fixed column list (never derived from the request) for INSERT / UPDATE.
const VALUE_COLUMNS = ['title', 'description', 'video_provider', 'video_id', ...portfolio.LINKS.map((l) => l.field)];

const IMAGE_PREFIX = 'developers/portfolio/';

// Accepts the slug used in portal URLs, or a bare id from a link made before
// slugs existed. Ownership is still enforced by developer_id in the query.
async function ownedItem(idOrSlug, devId) {
  const match = matchClause(idOrSlug);
  if (!match) return null;
  const [rows] = await db.query(
    `SELECT ${ITEM_FIELDS} FROM developer_portfolio_items WHERE ${match.sql} AND developer_id = ?`,
    [...match.params, devId]
  );
  return rows[0] || null;
}

async function itemCount(devId) {
  const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM developer_portfolio_items WHERE developer_id = ?', [devId]);
  return Number(n);
}

function renderForm(res, { item = null, form, errors = [] }) {
  res.render('developer/portfolio-form', {
    title: item ? `Edit ${item.title}` : 'Add to Portfolio',
    item, form, errors,
    links: portfolio.LINKS,
    limits: portfolio.LIMITS,
  });
}

// Converts to WebP and stores under a random key, so two items can never
// share (and later delete) the same object.
async function storeImage(devId, file) {
  let converted;
  try {
    converted = await toWebp(file.buffer, 'art');
  } catch (_) {
    const err = new Error('That file isn’t a readable image. Please choose a JPG, PNG or WebP.');
    err.userFacing = true;
    throw err;
  }
  const key = `${IMAGE_PREFIX}${devId}/${crypto.randomBytes(6).toString('hex')}-${converted.hash}.webp`;
  return r2.uploadBuffer(key, converted.buffer, 'image/webp', IMMUTABLE_CACHE);
}

function deleteImage(url) {
  const key = r2.keyFromUrl(url);
  if (key && key.startsWith(IMAGE_PREFIX)) r2.deleteObject(key).catch(() => {});
}

// ── List ────────────────────────────────────────────────────────────────────

exports.getPortfolio = async (req, res) => {
  try {
    const [items] = await db.query(
      `SELECT ${ITEM_FIELDS} FROM developer_portfolio_items
       WHERE developer_id = ? ORDER BY position ASC, created_at DESC`,
      [req.session.developer.id]
    );
    res.render('developer/portfolio', {
      title: 'Portfolio',
      items: items.map(portfolio.itemView),
      maxItems: portfolio.MAX_ITEMS,
    });
  } catch (err) {
    console.error('getPortfolio error:', err);
    req.flash('error_msg', 'Failed to load your portfolio.');
    res.redirect('/developer/dashboard');
  }
};

// ── Create ──────────────────────────────────────────────────────────────────

exports.getNew = async (req, res) => {
  try {
    if (await itemCount(req.session.developer.id) >= portfolio.MAX_ITEMS) {
      req.flash('error_msg', `You can add up to ${portfolio.MAX_ITEMS} portfolio items. Remove one to add another.`);
      return res.redirect('/developer/portfolio');
    }
    renderForm(res, { form: portfolio.formFromBody({}) });
  } catch (err) {
    req.flash('error_msg', 'Failed to open the portfolio form.');
    res.redirect('/developer/portfolio');
  }
};

exports.postCreate = async (req, res) => {
  const devId = req.session.developer.id;
  const { errors, values } = portfolio.validatePortfolioInput(req.body);
  if (req.uploadError) errors.unshift(req.uploadError);
  else if (!req.file) errors.unshift('A primary portfolio image is required.');

  try {
    if (await itemCount(devId) >= portfolio.MAX_ITEMS) {
      errors.unshift(`You can add up to ${portfolio.MAX_ITEMS} portfolio items. Remove one to add another.`);
    }
    if (errors.length) {
      return renderForm(res.status(400), { form: portfolio.formFromBody(req.body), errors });
    }

    let imageUrl;
    try {
      imageUrl = await storeImage(devId, req.file);
    } catch (err) {
      if (!err.userFacing) throw err;
      return renderForm(res.status(400), { form: portfolio.formFromBody(req.body), errors: [err.message] });
    }

    // New items go to the top of the list.
    const [[{ pos }]] = await db.query(
      'SELECT COALESCE(MIN(position), 1) - 1 AS pos FROM developer_portfolio_items WHERE developer_id = ?',
      [devId]
    );
    // The slug is set once, here. Renaming the item later keeps the URL it
    // was shared and indexed under (utils/slugs.js).
    const slug = await uniqueSlug('developer_portfolio_items', 'developer_id', devId, values.title);
    await db.query(
      `INSERT INTO developer_portfolio_items (developer_id, slug, image_url, position, ${VALUE_COLUMNS.join(', ')})
       VALUES (?, ?, ?, ?, ${VALUE_COLUMNS.map(() => '?').join(', ')})`,
      [devId, slug, imageUrl, pos, ...VALUE_COLUMNS.map((c) => values[c])]
    );

    req.flash('success_msg', `“${values.title}” was added to your portfolio.`);
    res.redirect('/developer/portfolio');
  } catch (err) {
    console.error('postCreate portfolio error:', err);
    req.flash('error_msg', 'Failed to save the portfolio item. Please try again.');
    res.redirect('/developer/portfolio');
  }
};

// ── Edit ────────────────────────────────────────────────────────────────────

exports.getEdit = async (req, res) => {
  try {
    const item = await ownedItem(req.params.id, req.session.developer.id);
    if (!item) {
      req.flash('error_msg', 'Portfolio item not found.');
      return res.redirect('/developer/portfolio');
    }
    renderForm(res, { item, form: portfolio.formFromItem(item) });
  } catch (err) {
    req.flash('error_msg', 'Failed to load the portfolio item.');
    res.redirect('/developer/portfolio');
  }
};

exports.postUpdate = async (req, res) => {
  const devId = req.session.developer.id;
  try {
    const item = await ownedItem(req.params.id, devId);
    if (!item) {
      req.flash('error_msg', 'Portfolio item not found.');
      return res.redirect('/developer/portfolio');
    }

    const { errors, values } = portfolio.validatePortfolioInput(req.body);
    if (req.uploadError) errors.unshift(req.uploadError);
    if (errors.length) {
      return renderForm(res.status(400), { item, form: portfolio.formFromBody(req.body), errors });
    }

    let imageUrl = item.image_url;
    if (req.file) {
      try {
        imageUrl = await storeImage(devId, req.file);
      } catch (err) {
        if (!err.userFacing) throw err;
        return renderForm(res.status(400), { item, form: portfolio.formFromBody(req.body), errors: [err.message] });
      }
    }

    await db.query(
      `UPDATE developer_portfolio_items
       SET image_url = ?, ${VALUE_COLUMNS.map((c) => `${c} = ?`).join(', ')}
       WHERE id = ? AND developer_id = ?`,
      [imageUrl, ...VALUE_COLUMNS.map((c) => values[c]), item.id, devId]
    );
    // Old image goes only after the new one is stored and saved.
    if (imageUrl !== item.image_url) deleteImage(item.image_url);

    req.flash('success_msg', `“${values.title}” was updated.`);
    res.redirect('/developer/portfolio');
  } catch (err) {
    console.error('postUpdate portfolio error:', err);
    req.flash('error_msg', 'Failed to update the portfolio item. Please try again.');
    res.redirect('/developer/portfolio');
  }
};

// ── Delete / reorder ────────────────────────────────────────────────────────

exports.postDelete = async (req, res) => {
  const devId = req.session.developer.id;
  try {
    const item = await ownedItem(req.params.id, devId);
    if (!item) {
      req.flash('error_msg', 'Portfolio item not found.');
      return res.redirect('/developer/portfolio');
    }
    await db.query('DELETE FROM developer_portfolio_items WHERE id = ? AND developer_id = ?', [item.id, devId]);
    deleteImage(item.image_url);
    req.flash('success_msg', `“${item.title}” was removed from your portfolio.`);
    res.redirect('/developer/portfolio');
  } catch (err) {
    req.flash('error_msg', 'Failed to delete the portfolio item.');
    res.redirect('/developer/portfolio');
  }
};

// body = { order: [itemId, ...] } — top of the list first
exports.putReorder = async (req, res) => {
  const devId = req.session.developer.id;
  const order = Array.isArray(req.body?.order) ? req.body.order : null;
  if (!order || order.length > portfolio.MAX_ITEMS * 2 || !order.every((id) => /^\d{1,10}$/.test(String(id)))) {
    return res.status(400).json({ error: 'Invalid order.' });
  }
  try {
    await Promise.all(order.map((id, idx) =>
      db.query(
        'UPDATE developer_portfolio_items SET position = ? WHERE id = ? AND developer_id = ?',
        [idx, Number(id), devId]
      )
    ));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reorder portfolio.' });
  }
};
