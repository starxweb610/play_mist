const db = require('../../config/database');

exports.getIndex = async (req, res) => {
  let users = [];
  try {
    [users] = await db.query(
      `SELECT u.id, u.username, u.email, u.credits, u.is_active, u.created_at,
              COUNT(t.id) AS tx_count
       FROM users u
       LEFT JOIN credit_transactions t ON t.user_id = u.id
       GROUP BY u.id, u.username, u.email, u.credits, u.is_active, u.created_at
       ORDER BY u.created_at DESC`
    );
  } catch (err) {
    console.error('Failed to query users:', err.message);
  }
  res.render('sitehandler/users/index', {
    title: 'Manage Players',
    activePage: 'users',
    users,
  });
};

exports.getTransactions = async (req, res) => {
  const userId = req.params.id;
  let user = null;
  let transactions = [];
  try {
    const [userRows] = await db.query('SELECT id, username, email, credits FROM users WHERE id = ?', [userId]);
    if (!userRows.length) {
      req.flash('error_msg', 'User not found.');
      return res.redirect('/sitehandler/users');
    }
    user = userRows[0];

    [transactions] = await db.query(
      `SELECT t.id, t.credits_used, t.created_at, t.source, g.title AS gamename
       FROM credit_transactions t
       LEFT JOIN games g ON t.game_id = g.id
       WHERE t.user_id = ?
       ORDER BY t.created_at DESC`,
      [userId]
    );
  } catch (err) {
    console.error('Failed to query transactions:', err.message);
    req.flash('error_msg', 'Failed to retrieve transactions.');
  }

  res.render('sitehandler/users/transactions', {
    title: `Transactions - @${user ? user.username : ''}`,
    activePage: 'users',
    user,
    transactions,
  });
};

exports.postToggle = async (req, res) => {
  try {
    await db.query('UPDATE users SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
    req.flash('success_msg', 'Player status updated.');
    res.redirect('/sitehandler/users');
  } catch (err) {
    req.flash('error_msg', err.message);
    res.redirect('/sitehandler/users');
  }
};

exports.postDelete = async (req, res) => {
  try {
    await db.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    req.flash('success_msg', 'Player removed.');
    res.redirect('/sitehandler/users');
  } catch (err) {
    req.flash('error_msg', err.message);
    res.redirect('/sitehandler/users');
  }
};

exports.postBulk = async (req, res) => {
  const { action, ids } = req.body;
  const idList = Array.isArray(ids) ? ids : ids ? [ids] : [];
  if (!idList.length) {
    req.flash('error_msg', 'No players selected.');
    return res.redirect('/sitehandler/users');
  }
  const placeholders = idList.map(() => '?').join(',');
  try {
    if (action === 'ban') {
      await db.query(`UPDATE users SET is_active = 0 WHERE id IN (${placeholders})`, idList);
      req.flash('success_msg', `${idList.length} player(s) banned.`);
    } else if (action === 'delete') {
      await db.query(`DELETE FROM users WHERE id IN (${placeholders})`, idList);
      req.flash('success_msg', `${idList.length} player(s) deleted.`);
    } else {
      req.flash('error_msg', 'Unknown action.');
    }
  } catch (err) {
    req.flash('error_msg', err.message);
  }
  res.redirect('/sitehandler/users');
};
