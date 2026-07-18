const db = require('../../config/database');

/**
 * POST /api/v1/games/:gameId/purchase   { itemKey }
 *
 * The game only ever sends the item key — never a price. game_shop_items
 * (admin-configured per game) is the sole authority on cost, same reasoning
 * as gameXpApi.reportEvent: a buggy or malicious game can't set its own price
 * or drain a player's wallet with an arbitrary amount.
 */
exports.purchase = async (req, res) => {
  try {
    const userId = req.user.id;
    const { gameId } = req.params;
    const { itemKey } = req.body;

    if (!itemKey) return res.status(400).json({ error: 'itemKey is required' });

    const [itemRows] = await db.query(
      'SELECT id, price_credits FROM game_shop_items WHERE game_id = ? AND item_key = ? AND is_active = 1',
      [gameId, itemKey]
    );
    if (!itemRows.length) return res.status(404).json({ error: 'Unknown item' });

    const price = itemRows[0].price_credits;

    // Atomic conditional deduction — same pattern as authApi.deductCredits,
    // prevents double-spend under concurrent requests.
    const [result] = await db.query(
      `UPDATE users
       SET credits = COALESCE(credits, 1000) - ?
       WHERE id = ? AND COALESCE(credits, 1000) >= ?`,
      [price, userId, price]
    );

    if (result.affectedRows === 0) {
      const [users] = await db.query('SELECT credits FROM users WHERE id = ?', [userId]);
      if (!users.length) return res.status(404).json({ error: 'User not found' });
      const balance = users[0].credits !== null ? users[0].credits : 1000;
      return res.status(400).json({ error: 'Insufficient credits', balance });
    }

    const [[userRow]] = await db.query('SELECT credits FROM users WHERE id = ?', [userId]);

    try {
      await db.query(
        `INSERT INTO credit_transactions (user_id, game_id, credits_used, source)
         VALUES (?, ?, ?, 'shop')`,
        [userId, gameId, price]
      );
    } catch (txErr) {
      console.error('Failed to log shop transaction:', txErr.message);
    }

    return res.json({ success: true, balance: userRow.credits, itemKey });
  } catch (err) {
    console.error('purchase error:', err);
    return res.status(500).json({ error: err.message });
  }
};
