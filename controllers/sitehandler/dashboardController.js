const db = require('../../config/database');

exports.getIndex = async (req, res) => {
  let overview = { totalGames: 0, totalUsers: 0, openTickets: 0, totalFeedbacks: 0 };
  let recentGames = [], recentTickets = [];

  try {
    const [r] = await Promise.all([
      Promise.allSettled([
        db.query('SELECT COUNT(*) AS c FROM games'),
        db.query('SELECT COUNT(*) AS c FROM users'),
        db.query("SELECT COUNT(*) AS c FROM tickets WHERE status = 'open'"),
        db.query('SELECT COUNT(*) AS c FROM feedbacks'),
      ]),
    ]);
    const results = r[0];
    if (results[0].status === 'fulfilled') overview.totalGames     = results[0].value[0][0].c;
    if (results[1].status === 'fulfilled') overview.totalUsers     = results[1].value[0][0].c;
    if (results[2].status === 'fulfilled') overview.openTickets    = results[2].value[0][0].c;
    if (results[3].status === 'fulfilled') overview.totalFeedbacks = results[3].value[0][0].c;
  } catch (_) {}

  try {
    [recentGames] = await db.query(
      'SELECT id, title, type, genre, is_active, created_at FROM games ORDER BY created_at DESC LIMIT 6'
    );
  } catch (_) {}

  try {
    [recentTickets] = await db.query(
      `SELECT t.id, t.subject, t.status, t.priority, t.created_at,
              u.username AS player
       FROM tickets t
       LEFT JOIN users u ON t.user_id = u.id
       ORDER BY t.created_at DESC LIMIT 6`
    );
  } catch (_) {}

  res.render('sitehandler/dashboard/index', {
    title: 'Dashboard', activePage: 'dashboard',
    overview, recentGames, recentTickets,
  });
};
