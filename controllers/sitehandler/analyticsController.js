const db = require('../../config/database');

exports.getIndex = async (req, res) => {
  // Defaults
  let totals = { appOpens: 0, gamePlayEvents: 0, todayOpens: 0, todayPlays: 0 };
  let deviceData  = { android: 0, ios: 0, other: 0 };
  let dailyOpens  = [];  // [{ date, count }]  last 14 days
  let dailyPlays  = [];  // [{ date, count }]  last 14 days
  let topGames    = [];  // [{ title, plays }]
  let dailyDau    = [];  // [{ date, count }]  last 30 days, unique users
  let engagement  = {
    totalUsers: 0,
    playedUsers: 0, playedPct: 0,
    returningUsers: 0, returningPct: 0,
    engagedToday: 0, engagementPct: 0,
  };

  try {
    const today = new Date().toISOString().split('T')[0];

    const [
      [allOpens], [allPlays],
      [todayOp],  [todayPl],
      [devRows],
      [dailyOpRows],
      [dailyPlRows],
      [topGamesRows],
      [dauRows],
      [totalUsersRows],
      [playedUsersRows],
      [returningUsersRows],
      [engagedTodayRows],
    ] = await Promise.all([
      db.query('SELECT COUNT(*) AS c FROM analytics_app'),
      db.query('SELECT COUNT(*) AS c FROM analytics_games'),
      db.query('SELECT COUNT(*) AS c FROM analytics_app WHERE event_date = ?',   [today]),
      db.query('SELECT COUNT(*) AS c FROM analytics_games WHERE event_date = ?', [today]),
      db.query('SELECT device, COUNT(*) AS c FROM analytics_app GROUP BY device'),
      db.query(`SELECT event_date AS date, COUNT(*) AS count FROM analytics_app
                WHERE event_date >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
                GROUP BY event_date ORDER BY event_date`),
      db.query(`SELECT event_date AS date, COUNT(*) AS count FROM analytics_games
                WHERE event_date >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
                GROUP BY event_date ORDER BY event_date`),
      db.query(`SELECT g.title, COUNT(ag.id) AS plays
                FROM analytics_games ag
                JOIN games g ON ag.game_id = g.id
                GROUP BY ag.game_id
                ORDER BY plays DESC LIMIT 10`),
      // DAU: one distinct user (or anonymous session) per day; id is the
      // fallback key so rows with neither user_id nor session_id still count
      db.query(`SELECT event_date AS date,
                       COUNT(DISTINCT COALESCE(CONCAT('u:', user_id),
                                               CONCAT('s:', session_id),
                                               CONCAT('r:', id))) AS count
                FROM analytics_app
                WHERE event_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                GROUP BY event_date ORDER BY event_date`),
      // User Engagement modal — total registered users
      db.query('SELECT COUNT(*) AS c FROM users'),
      // Users who have played at least one game (any logged play event)
      db.query('SELECT COUNT(DISTINCT user_id) AS c FROM analytics_games WHERE user_id IS NOT NULL'),
      // Returning users: have a transaction on a day other than their registration day
      db.query(`SELECT COUNT(DISTINCT ct.user_id) AS c
                FROM credit_transactions ct
                JOIN users u ON u.id = ct.user_id
                WHERE DATE(ct.created_at) <> DATE(u.created_at)`),
      // Engagement ratio: distinct users with a transaction today
      db.query('SELECT COUNT(DISTINCT user_id) AS c FROM credit_transactions WHERE DATE(created_at) = CURDATE()'),
    ]);

    totals.appOpens      = allOpens[0].c;
    totals.gamePlayEvents = allPlays[0].c;
    totals.todayOpens    = todayOp[0].c;
    totals.todayPlays    = todayPl[0].c;

    devRows.forEach(r => { if (r.device in deviceData) deviceData[r.device] = r.c; });
    dailyOpens  = dailyOpRows;
    dailyPlays  = dailyPlRows;
    topGames    = topGamesRows;
    dailyDau    = dauRows;

    const totalUsers = totalUsersRows[0].c;
    const pct = (count) => totalUsers > 0 ? Math.round((count / totalUsers) * 1000) / 10 : 0;

    engagement.totalUsers     = totalUsers;
    engagement.playedUsers    = playedUsersRows[0].c;
    engagement.playedPct      = pct(playedUsersRows[0].c);
    engagement.returningUsers = returningUsersRows[0].c;
    engagement.returningPct   = pct(returningUsersRows[0].c);
    engagement.engagedToday   = engagedTodayRows[0].c;
    engagement.engagementPct  = pct(engagedTodayRows[0].c);
  } catch (_) {
    // Tables not yet created or empty — show zeros
  }

  const getYYYYMMDD = (val) => {
    if (!val) return '';
    const dObj = val instanceof Date ? val : new Date(val);
    if (isNaN(dObj.getTime())) return '';
    const year = dObj.getFullYear();
    const month = String(dObj.getMonth() + 1).padStart(2, '0');
    const day = String(dObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Build 14-day date labels for charts (fill missing days with 0)
  const labels  = [];
  const openCounts = [];
  const playCounts = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    
    labels.push(dateStr.slice(5)); // MM-DD
    const op = dailyOpens.find(r => getYYYYMMDD(r.date) === dateStr);
    const pl = dailyPlays.find(r => getYYYYMMDD(r.date) === dateStr);
    openCounts.push(op ? op.count : 0);
    playCounts.push(pl ? pl.count : 0);
  }

  // Build 30-day DAU series (fill missing days with 0)
  const dauLabels = [];
  const dauCounts = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    dauLabels.push(dateStr.slice(5)); // MM-DD
    const row = dailyDau.find(r => getYYYYMMDD(r.date) === dateStr);
    dauCounts.push(row ? row.count : 0);
  }

  const todayDau     = dauCounts[dauCounts.length - 1] || 0;
  const yesterdayDau = dauCounts[dauCounts.length - 2] || 0;
  const dauDelta     = todayDau - yesterdayDau;

  res.render('sitehandler/analytics/index', {
    title: 'Analytics', activePage: 'analytics',
    totals, deviceData, topGames, engagement,
    todayDau, yesterdayDau, dauDelta,
    chartData: JSON.stringify({ labels, openCounts, playCounts }),
    dauData: JSON.stringify({ labels: dauLabels, counts: dauCounts }),
    topGamesData: JSON.stringify({
      labels: topGames.map(g => g.title),
      data:   topGames.map(g => g.plays),
    }),
  });
};
