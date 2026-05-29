const db = require('../../config/database');

exports.getIndex = async (req, res) => {
  // Defaults
  let totals = { appOpens: 0, gamePlayEvents: 0, todayOpens: 0, todayPlays: 0 };
  let deviceData  = { android: 0, ios: 0, other: 0 };
  let dailyOpens  = [];  // [{ date, count }]  last 14 days
  let dailyPlays  = [];  // [{ date, count }]  last 14 days
  let topGames    = [];  // [{ title, plays }]

  try {
    const today = new Date().toISOString().split('T')[0];

    const [
      [allOpens], [allPlays],
      [todayOp],  [todayPl],
      [devRows],
      [dailyOpRows],
      [dailyPlRows],
      [topGamesRows],
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
    ]);

    totals.appOpens      = allOpens[0].c;
    totals.gamePlayEvents = allPlays[0].c;
    totals.todayOpens    = todayOp[0].c;
    totals.todayPlays    = todayPl[0].c;

    devRows.forEach(r => { if (r.device in deviceData) deviceData[r.device] = r.c; });
    dailyOpens  = dailyOpRows;
    dailyPlays  = dailyPlRows;
    topGames    = topGamesRows;
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

  res.render('sitehandler/analytics/index', {
    title: 'Analytics', activePage: 'analytics',
    totals, deviceData, topGames,
    chartData: JSON.stringify({ labels, openCounts, playCounts }),
    topGamesData: JSON.stringify({
      labels: topGames.map(g => g.title),
      data:   topGames.map(g => g.plays),
    }),
  });
};
