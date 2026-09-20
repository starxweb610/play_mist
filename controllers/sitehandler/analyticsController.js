const db = require('../../config/database');

const toYMD = (val) => {
  if (!val) return '';
  const d = val instanceof Date ? val : new Date(val);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * The ranges the Daily Active Users chart offers, keyed by what the <select>
 * sends. Resolving a key through this map is the only way `days` is produced:
 * an unknown, missing or hand-crafted `?range=` falls back to the default
 * instead of reaching the query, so the interval is always one of these seven
 * integers and never request-shaped data.
 */
const DAU_RANGES = {
  '5d':  { days: 5,   label: 'Last 5 days' },
  '7d':  { days: 7,   label: 'Last 7 days' },
  '14d': { days: 14,  label: 'Last 14 days' },
  '30d': { days: 30,  label: 'Last 30 days' },
  '2m':  { days: 60,  label: 'Last 2 months' },
  '6m':  { days: 180, label: 'Last 6 months' },
  '1y':  { days: 365, label: 'Last year' },
};
const DAU_DEFAULT_RANGE = '30d';

const resolveDauRange = (key) =>
  (Object.prototype.hasOwnProperty.call(DAU_RANGES, key) ? key : DAU_DEFAULT_RANGE);

/** A zero-filled series, so a DB error renders an empty chart rather than none. */
function emptySeries(days) {
  const labels = [], dates = [], counts = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = toYMD(d);
    dates.push(dateStr);
    labels.push(dateStr.slice(5)); // MM-DD
    counts.push(0);
  }
  return { labels, dates, counts, todayDau: 0, yesterdayDau: 0, dauDelta: 0 };
}

/**
 * Turns `[{ date, count }]` rows into a zero-filled `days`-long series, so a
 * day with no activity is a zero in the line rather than a gap the chart
 * interpolates straight over.
 */
function fillSeries(days, rows) {
  // Index by day first: a linear scan per day is fine over 30 points and
  // quadratic over 365.
  const byDate = new Map(rows.map(r => [toYMD(r.date), Number(r.count) || 0]));

  const series = emptySeries(days);
  series.counts = series.dates.map(d => byDate.get(d) || 0);
  series.todayDau     = series.counts[series.counts.length - 1] || 0;
  series.yesterdayDau = series.counts[series.counts.length - 2] || 0;
  series.dauDelta     = series.todayDau - series.yesterdayDau;
  return series;
}

/**
 * Daily Active Users over the last `days` days.
 *
 * Shared by the page render and the JSON endpoint the dropdown calls, so the
 * default 30-day view and every other range are the same measure — one
 * distinct user (or anonymous session) per day — computed by the same code.
 *
 * `days` must already have come from DAU_RANGES.
 */
async function buildDauSeries(days) {
  const [rows] = await db.query(
    `SELECT event_date AS date,
            COUNT(DISTINCT COALESCE(CONCAT('u:', user_id),
                                    CONCAT('s:', session_id),
                                    CONCAT('r:', id))) AS count
     FROM analytics_app
     WHERE event_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY event_date ORDER BY event_date`,
    [days]
  );
  return fillSeries(days, rows);
}

/**
 * Game play events per day over the last `days` days.
 *
 * Deliberately COUNT(*), not distinct users: this is the volume line — how
 * much play happened — and it keeps the measure the fixed 14-day version
 * showed, so adding the range control changed the window and nothing else.
 * Anonymous plays count here, as they always did.
 *
 * `days` must already have come from DAU_RANGES.
 */
async function buildGamePlaysSeries(days) {
  const [rows] = await db.query(
    `SELECT event_date AS date, COUNT(*) AS count
     FROM analytics_games
     WHERE event_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY event_date ORDER BY event_date`,
    [days]
  );
  return fillSeries(days, rows);
}

/**
 * Returning players per day: registered users who played a game on a day
 * LATER than the first day they were ever seen. Day one — install, sign-up,
 * the first session — is excluded by construction, so this line answers
 * "how many came back", not "how many showed up".
 *
 * ⚠ The baseline is the user's first `event_date`, deliberately NOT
 * `DATE(users.created_at)`, and that is a correctness matter rather than a
 * preference. api/analyticsApi.js writes `event_date` from `toISOString()` —
 * a UTC date — while `users.created_at` is MySQL NOW() in server-local IST.
 * Between 00:00 and 05:29 IST those two clocks disagree by a day, so a
 * registration-date comparison files that user's day-one play as a return:
 * 121 of 543 players in production, every one of them off by exactly one day.
 * Comparing event_date to event_date keeps both sides on the same clock, so
 * the skew cancels instead of being counted as retention that never happened.
 *
 * first_seen spans all history on purpose: bounded by the range, a player
 * whose real first day sits just before the window would look like a new
 * arrival inside it and be dropped from the very line meant to count them.
 *
 * `days` must already have come from DAU_RANGES.
 */
async function buildReturningSeries(days) {
  const [rows] = await db.query(
    `WITH first_seen AS (
       SELECT user_id, MIN(event_date) AS first_day
       FROM (
         SELECT user_id, event_date FROM analytics_app   WHERE user_id IS NOT NULL
         UNION ALL
         SELECT user_id, event_date FROM analytics_games WHERE user_id IS NOT NULL
       ) activity
       GROUP BY user_id
     )
     SELECT ag.event_date AS date, COUNT(DISTINCT ag.user_id) AS count
     FROM analytics_games ag
     JOIN first_seen f ON f.user_id = ag.user_id
     JOIN users      u ON u.id      = ag.user_id
     WHERE ag.event_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       AND ag.event_date > f.first_day
     GROUP BY ag.event_date ORDER BY ag.event_date`,
    [days]
  );
  return fillSeries(days, rows);
}

exports.getIndex = async (req, res) => {
  // Defaults
  let totals = { appOpens: 0, gamePlayEvents: 0, todayOpens: 0, todayPlays: 0 };
  let deviceData  = { android: 0, ios: 0, other: 0 };
  let dailyOpens  = [];  // [{ date, count }]  last 14 days
  let topGames    = [];  // [{ title, plays }]
  // Filled by buildDauSeries below; the zero-filled default is what renders if
  // the analytics tables are missing or the query fails.
  let dauSeries       = emptySeries(DAU_RANGES[DAU_DEFAULT_RANGE].days);
  let returningSeries = emptySeries(DAU_RANGES[DAU_DEFAULT_RANGE].days);
  let gamePlaysSeries = emptySeries(DAU_RANGES[DAU_DEFAULT_RANGE].days);
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
      [topGamesRows],
      dauSeriesResult,
      returningSeriesResult,
      gamePlaysSeriesResult,
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
      db.query(`SELECT g.title, COUNT(ag.id) AS plays
                FROM analytics_games ag
                JOIN games g ON ag.game_id = g.id
                GROUP BY ag.game_id
                ORDER BY plays DESC LIMIT 10`),
      // DAU for the range the chart opens on. Every other range comes from
      // the same builder via getDauSeries when the dropdown changes.
      buildDauSeries(DAU_RANGES[DAU_DEFAULT_RANGE].days),
      // Returning players, same default range but its own dropdown.
      buildReturningSeries(DAU_RANGES[DAU_DEFAULT_RANGE].days),
      // Game plays, same default range but its own dropdown.
      buildGamePlaysSeries(DAU_RANGES[DAU_DEFAULT_RANGE].days),
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
    topGames    = topGamesRows;
    dauSeries       = dauSeriesResult;
    returningSeries = returningSeriesResult;
    gamePlaysSeries = gamePlaysSeriesResult;

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

  // Build 14-day date labels for the App Opens chart (fill missing days with 0).
  // Game plays no longer ride along here — it has its own range now.
  const labels  = [];
  const openCounts = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    
    labels.push(dateStr.slice(5)); // MM-DD
    const op = dailyOpens.find(r => getYYYYMMDD(r.date) === dateStr);
    openCounts.push(op ? op.count : 0);
  }

  res.render('sitehandler/analytics/index', {
    title: 'Analytics', activePage: 'analytics',
    totals, deviceData, topGames, engagement,
    todayDau: dauSeries.todayDau,
    yesterdayDau: dauSeries.yesterdayDau,
    dauDelta: dauSeries.dauDelta,
    todayReturning:     returningSeries.todayDau,
    returningDelta:     returningSeries.dauDelta,
    dauRanges: DAU_RANGES,
    dauRangeKey: DAU_DEFAULT_RANGE,
    chartData: JSON.stringify({ labels, openCounts }),
    dauData: JSON.stringify({
      labels: dauSeries.labels, dates: dauSeries.dates, counts: dauSeries.counts,
    }),
    returningData: JSON.stringify({
      labels: returningSeries.labels, dates: returningSeries.dates, counts: returningSeries.counts,
    }),
    gamePlaysData: JSON.stringify({
      labels: gamePlaysSeries.labels, dates: gamePlaysSeries.dates, counts: gamePlaysSeries.counts,
    }),
    topGamesData: JSON.stringify({
      labels: topGames.map(g => g.title),
      data:   topGames.map(g => g.plays),
    }),
  });
};

/**
 * GET /sitehandler/analytics/dau?range=30d
 *
 * The Daily Active Users chart's range dropdown. Returns the same series the
 * page renders on load, for one of the DAU_RANGES keys, so switching range
 * redraws one chart instead of reloading a page that would re-run every other
 * analytics query with it.
 *
 * Admin-only by mounting: every route below router.use(isAdmin) in
 * routes/sitehandler.js is, and this is one of them.
 */
function rangeSeriesHandler(build, logLabel) {
  return async (req, res) => {
    const key   = resolveDauRange(req.query.range);
    const range = DAU_RANGES[key];

    try {
      const series = await build(range.days);
      res.json({
        range: key,
        label: range.label,
        labels: series.labels,
        dates:  series.dates,
        counts: series.counts,
        todayDau:     series.todayDau,
        yesterdayDau: series.yesterdayDau,
        dauDelta:     series.dauDelta,
      });
    } catch (err) {
      // The chart keeps whatever it was showing and says so, rather than
      // redrawing itself flat and passing an outage off as a quiet month.
      console.error(`❌ analytics ${logLabel} range:`, err.stack || err);
      res.status(500).json({ error: 'Could not load that range.' });
    }
  };
}

exports.getDauSeries = rangeSeriesHandler(buildDauSeries, 'DAU');

/**
 * GET /sitehandler/analytics/returning-series?range=30d
 * The returning-players chart's own range dropdown.
 */
exports.getReturningSeries = rangeSeriesHandler(buildReturningSeries, 'returning players');

/**
 * GET /sitehandler/analytics/game-plays?range=30d
 * The game plays chart's own range dropdown.
 */
exports.getGamePlaysSeries = rangeSeriesHandler(buildGamePlaysSeries, 'game plays');

/**
 * GET /sitehandler/analytics/returning-users
 *
 * A "returning user" is a registered user who came back on at least one day
 * AFTER their first-seen (install) day — i.e. 2+ distinct active days — and
 * who has actually played at least one game. Users who installed, played once
 * and never came back are excluded by design.
 *
 * Activity days are the union of analytics_app (app opens) and analytics_games
 * (game plays); both tables store at most one row per user per day, so a
 * distinct event_date count is a clean "days active" measure.
 */
exports.getReturningUsers = async (req, res) => {
  let users = [];
  let summary = { returningUsers: 0, totalActiveUsers: 0, returningPct: 0, avgActiveDays: 0, repeatGamePlayers: 0 };

  try {
    const activityCte = `
      WITH activity AS (
        SELECT user_id, event_date FROM analytics_app   WHERE user_id IS NOT NULL
        UNION
        SELECT user_id, event_date FROM analytics_games WHERE user_id IS NOT NULL
      ),
      user_days AS (
        SELECT user_id,
               MIN(event_date)            AS first_day,
               MAX(event_date)            AS last_day,
               COUNT(DISTINCT event_date) AS active_days
        FROM activity
        GROUP BY user_id
      ),
      user_plays AS (
        SELECT user_id,
               COUNT(*)                   AS total_plays,
               COUNT(DISTINCT game_id)    AS games_played,
               COUNT(DISTINCT event_date) AS play_days,
               MAX(event_date)            AS last_play_date
        FROM analytics_games
        WHERE user_id IS NOT NULL
        GROUP BY user_id
      )`;

    const [rows] = await db.query(`${activityCte}
      SELECT u.id, u.username, u.email, u.is_active, u.created_at,
             d.first_day, d.last_day, d.active_days,
             p.total_plays, p.games_played, p.play_days, p.last_play_date,
             DATEDIFF(d.last_day, d.first_day)  AS span_days,
             DATEDIFF(CURDATE(), d.last_day)    AS days_since_last_seen
      FROM user_days d
      JOIN users u       ON u.id = d.user_id
      JOIN user_plays p  ON p.user_id = d.user_id
      WHERE d.active_days >= 2
        AND d.last_day > d.first_day
      ORDER BY d.active_days DESC, p.total_plays DESC`);

    users = rows;

    if (users.length) {
      const ids = users.map(u => u.id);
      const [gameRows] = await db.query(
        `SELECT ag.user_id, ag.game_id, g.title, g.thumbnail_url,
                COUNT(DISTINCT ag.event_date) AS play_days,
                MIN(ag.event_date)            AS first_played,
                MAX(ag.event_date)            AS last_played
         FROM analytics_games ag
         LEFT JOIN games g ON g.id = ag.game_id
         WHERE ag.user_id IN (?)
         GROUP BY ag.user_id, ag.game_id, g.title, g.thumbnail_url
         ORDER BY play_days DESC, last_played DESC`,
        [ids]
      );

      const byUser = new Map();
      gameRows.forEach(r => {
        if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
        byUser.get(r.user_id).push({
          gameId:      r.game_id,
          title:       r.title || `Game #${r.game_id}`,
          thumbnail:   r.thumbnail_url || null,
          playDays:    Number(r.play_days) || 0,
          firstPlayed: toYMD(r.first_played),
          lastPlayed:  toYMD(r.last_played),
        });
      });

      users = users.map(u => {
        const games = byUser.get(u.id) || [];
        const repeatGames = games.filter(g => g.playDays >= 2);
        return {
          ...u,
          games,
          repeatGames,
          topGame:      games[0] || null,
          firstDay:     toYMD(u.first_day),
          lastDay:      toYMD(u.last_day),
          lastPlayDate: toYMD(u.last_play_date),
        };
      });
    }

    const [[activeTotal]] = await db.query(`${activityCte}
      SELECT COUNT(*) AS c FROM user_days d JOIN users u ON u.id = d.user_id`);

    summary.returningUsers    = users.length;
    summary.totalActiveUsers  = activeTotal.c || 0;
    summary.returningPct      = summary.totalActiveUsers > 0
      ? Math.round((users.length / summary.totalActiveUsers) * 1000) / 10 : 0;
    summary.avgActiveDays     = users.length
      ? Math.round((users.reduce((s, u) => s + Number(u.active_days), 0) / users.length) * 10) / 10 : 0;
    summary.repeatGamePlayers = users.filter(u => u.repeatGames && u.repeatGames.length > 0).length;
  } catch (err) {
    console.error('Failed to load returning users:', err.message);
    req.flash('error_msg', 'Could not load returning users: ' + err.message);
  }

  res.render('sitehandler/analytics/returning-users', {
    title: 'Returning Users',
    activePage: 'analytics',
    users,
    summary,
  });
};
