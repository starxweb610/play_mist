const db = require('../../config/database');

// ── GET /sitehandler/games/:id/shop-items ─────────────────────────────────────
exports.getIndex = async (req, res) => {
  const { id } = req.params;
  try {
    const [gameRows] = await db.query('SELECT id, title FROM games WHERE id = ?', [id]);
    if (!gameRows.length) {
      req.flash('error_msg', 'Game not found.');
      return res.redirect('/sitehandler/games');
    }

    const [items] = await db.query(
      'SELECT * FROM game_shop_items WHERE game_id = ? ORDER BY created_at DESC',
      [id]
    );

    res.render('sitehandler/games/shop-items', {
      title: `Shop Items – ${gameRows[0].title}`,
      activePage: 'games',
      game: gameRows[0],
      items,
    });
  } catch (err) {
    req.flash('error_msg', err.message);
    res.redirect('/sitehandler/games');
  }
};

// ── POST /sitehandler/games/:id/shop-items/create ─────────────────────────────
exports.postCreate = async (req, res) => {
  const { id } = req.params;
  const { item_key, name, price_credits } = req.body;

  if (!item_key?.trim() || !name?.trim()) {
    req.flash('error_msg', 'Item key and name are required.');
    return res.redirect(`/sitehandler/games/${id}/shop-items`);
  }

  try {
    await db.query(
      `INSERT INTO game_shop_items (game_id, item_key, name, price_credits)
       VALUES (?, ?, ?, ?)`,
      [id, item_key.trim(), name.trim(), parseInt(price_credits, 10) || 0]
    );
    req.flash('success_msg', `Item "${item_key.trim()}" added.`);
  } catch (err) {
    req.flash('error_msg', err.code === 'ER_DUP_ENTRY'
      ? `Item key "${item_key.trim()}" already exists for this game.`
      : 'Failed to add item: ' + err.message);
  }
  res.redirect(`/sitehandler/games/${id}/shop-items`);
};

// ── POST /sitehandler/games/:id/shop-items/:itemId/update ────────────────────
exports.postUpdate = async (req, res) => {
  const { id, itemId } = req.params;
  const { name, price_credits } = req.body;

  try {
    await db.query(
      `UPDATE game_shop_items SET name = ?, price_credits = ? WHERE id = ? AND game_id = ?`,
      [name?.trim(), parseInt(price_credits, 10) || 0, itemId, id]
    );
    req.flash('success_msg', 'Item updated.');
  } catch (err) {
    req.flash('error_msg', 'Failed to update: ' + err.message);
  }
  res.redirect(`/sitehandler/games/${id}/shop-items`);
};

// ── POST /sitehandler/games/:id/shop-items/:itemId/toggle ────────────────────
exports.postToggle = async (req, res) => {
  const { id, itemId } = req.params;
  try {
    await db.query(
      'UPDATE game_shop_items SET is_active = NOT is_active WHERE id = ? AND game_id = ?',
      [itemId, id]
    );
  } catch (err) {
    req.flash('error_msg', 'Failed to toggle: ' + err.message);
  }
  res.redirect(`/sitehandler/games/${id}/shop-items`);
};

// ── POST /sitehandler/games/:id/shop-items/:itemId/delete ────────────────────
exports.postDelete = async (req, res) => {
  const { id, itemId } = req.params;
  try {
    await db.query('DELETE FROM game_shop_items WHERE id = ? AND game_id = ?', [itemId, id]);
    req.flash('success_msg', 'Item deleted.');
  } catch (err) {
    req.flash('error_msg', 'Failed to delete: ' + err.message);
  }
  res.redirect(`/sitehandler/games/${id}/shop-items`);
};
