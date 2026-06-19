const db = require('../../config/database');
const { grantAchievement, grantXp } = require('../../utils/achievements');
const { toLocalDateStr } = require('../../utils/dates');

const STREAK_XP       = 30;   // base XP per daily check-in
const STREAK_CREDITS  = 50;   // base credits per daily check-in

// Bonus multipliers at milestone days
const milestoneBonus = (streak) => {
  if (streak >= 30) return 4;
  if (streak >= 7)  return 2;
  if (streak >= 3)  return 1.5;
  return 1;
};

/**
 * POST /api/v1/user/daily-checkin
 * Called on every app open (idempotent — safe to call multiple times per day).
 *
 * Response:
 *   { alreadyClaimed, streak, longestStreak, creditsEarned, xpEarned,
 *     newAchievements, level, xp }
 */
exports.dailyCheckin = async (req, res) => {
  const userId = req.user.id;
  const today  = toLocalDateStr();

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      'SELECT current_streak, longest_streak, last_streak_date, credits, xp, level FROM users WHERE id = ? FOR UPDATE',
      [userId]
    );
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'User not found' });
    }

    const user = rows[0];
    const lastDate = user.last_streak_date ? toLocalDateStr(user.last_streak_date) : null;

    // Already claimed today
    if (lastDate === today) {
      await conn.rollback();
      return res.json({
        alreadyClaimed:  true,
        streak:          user.current_streak,
        longestStreak:   user.longest_streak,
        creditsEarned:   0,
        xpEarned:        0,
        newAchievements: [],
        level:           user.level,
        xp:              user.xp,
      });
    }

    // Determine new streak value
    const yest = new Date();
    yest.setDate(yest.getDate() - 1);
    const yesterdayStr = toLocalDateStr(yest);

    const newStreak = lastDate === yesterdayStr ? user.current_streak + 1 : 1;
    const newLongest = Math.max(newStreak, user.longest_streak);

    // Calculate reward
    const mult         = milestoneBonus(newStreak);
    const creditsEarned = Math.round(STREAK_CREDITS * mult);
    const xpEarned      = Math.round(STREAK_XP * mult);

    // Update user row
    await conn.query(
      `UPDATE users
       SET current_streak   = ?,
           longest_streak   = ?,
           last_streak_date = ?,
           credits          = credits + ?,
           xp               = xp + ?,
           level            = FLOOR((xp + ?) / 500) + 1
       WHERE id = ?`,
      [newStreak, newLongest, today, creditsEarned, xpEarned, xpEarned, userId]
    );

    // Log credit transaction
    await conn.query(
      `INSERT INTO credit_transactions (user_id, credits_used, source)
       VALUES (?, ?, 'streak')`,
      [userId, -creditsEarned]
    );

    await conn.commit();

    // Check streak achievements (outside transaction — INSERT IGNORE is safe)
    const newAchievements = [];
    for (const [key, threshold] of [['streak_3', 3], ['streak_7', 7], ['streak_30', 30]]) {
      if (newStreak >= threshold) {
        const result = await grantAchievement(userId, key);
        if (result.granted) newAchievements.push(result.achievement);
      }
    }

    // Fetch updated user state
    const [updated] = await db.query('SELECT credits, xp, level FROM users WHERE id = ?', [userId]);

    return res.json({
      alreadyClaimed:  false,
      streak:          newStreak,
      longestStreak:   newLongest,
      creditsEarned,
      xpEarned,
      newAchievements,
      level:           updated[0].level,
      xp:              updated[0].xp,
      balance:         updated[0].credits,
    });
  } catch (err) {
    await conn.rollback();
    console.error('dailyCheckin error:', err);
    return res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
};

/**
 * GET /api/v1/user/streak
 * Returns current streak info without triggering a check-in.
 */
exports.getStreak = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT current_streak, longest_streak, last_streak_date FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    const today    = toLocalDateStr();
    const lastDate = rows[0].last_streak_date ? toLocalDateStr(rows[0].last_streak_date) : null;

    return res.json({
      streak:        rows[0].current_streak,
      longestStreak: rows[0].longest_streak,
      claimedToday:  lastDate === today,
    });
  } catch (err) {
    console.error('getStreak error:', err);
    return res.status(500).json({ error: err.message });
  }
};
