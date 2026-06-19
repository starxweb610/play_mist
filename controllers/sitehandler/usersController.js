const db = require('../../config/database');

exports.getIndex = async (req, res) => {
  let users = [];
  try {
    [users] = await db.query('SELECT id, username, email, credits, is_active, created_at FROM users ORDER BY created_at DESC');
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
