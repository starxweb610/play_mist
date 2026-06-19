const db = require('../../config/database');
const { grantAchievement, grantXp } = require('../../utils/achievements');
const { toLocalDateStr } = require('../../utils/dates');

/**
 * Auto-generates a daily challenge for today if none exists yet.
 * Rotates through 3 types each day of the week.
 */
const ensureTodayChallenge = async () => {
  const today = toLocalDateStr();

  const [existing] = await db.query(
    'SELECT id FROM daily_challenges WHERE challenge_date = ?',
    [today]
  );
  if (existing.length) return existing[0].id;

  const day = new Date().getDay(); // 0=Sun … 6=Sat
  const templates = [
    { description: 'Play 2 games today',         requirement_type: 'play_count',   requirement_value: 2, credits_reward: 100, xp_reward: 50  },
    { description: 'Play 3 mini games',           requirement_type: 'play_mini',    requirement_value: 3, credits_reward: 150, xp_reward: 75  },
    { description: 'Play 1 premium game',         requirement_type: 'play_premium', requirement_value: 1, credits_reward: 200, xp_reward: 100 },
    { description: 'Play 3 games today',          requirement_type: 'play_count',   requirement_value: 3, credits_reward: 200, xp_reward: 100 },
    { description: 'Play 2 mini games',           requirement_type: 'play_mini',    requirement_value: 2, credits_reward: 100, xp_reward: 50  },
    { description: 'Play any 4 games',            requirement_type: 'play_count',   requirement_value: 4, credits_reward: 250, xp_reward: 125 },
    { description: 'Play 1 premium + 1 mini',     requirement_type: 'play_count',   requirement_value: 2, credits_reward: 175, xp_reward: 85  },
  ];
  const t = templates[day];

  const [ins] = await db.query(
    `INSERT INTO daily_challenges (challenge_date, description, requirement_type, requirement_value, credits_reward, xp_reward)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [today, t.description, t.requirement_type, t.requirement_value, t.credits_reward, t.xp_reward]
  );
  return ins.insertId;
};

/**
 * Computes how much progress the user has made toward today's challenge.
 */
const getProgress = async (userId, challenge) => {
  const today = toLocalDateStr();

  if (challenge.requirement_type === 'play_mini') {
    const [rows] = await db.query(
      `SELECT COUNT(DISTINCT ct.game_id) AS c
       FROM credit_transactions ct
       JOIN games g ON ct.game_id = g.id
       WHERE ct.user_id = ? AND ct.source = 'game'
         AND DATE(ct.created_at) = ? AND g.type = 'webgl'`,
      [userId, today]
    );
    return rows[0].c;
  }

  if (challenge.requirement_type === 'play_premium') {
    const [rows] = await db.query(
      `SELECT COUNT(DISTINCT ct.game_id) AS c
       FROM credit_transactions ct
       JOIN games g ON ct.game_id = g.id
       WHERE ct.user_id = ? AND ct.source = 'game'
         AND DATE(ct.created_at) = ? AND g.type = 'premium'`,
      [userId, today]
    );
    return rows[0].c;
  }

  // play_count — any game type
  const [rows] = await db.query(
    `SELECT COUNT(DISTINCT game_id) AS c
     FROM credit_transactions
     WHERE user_id = ? AND source = 'game' AND DATE(created_at) = ?`,
    [userId, today]
  );
  return rows[0].c;
};

/**
 * GET /api/v1/daily-challenge
 * Returns today's challenge, user's progress, and whether it's been claimed.
 */
exports.getChallenge = async (req, res) => {
  try {
    const userId = req.user.id;
    await ensureTodayChallenge();

    const today = toLocalDateStr();
    const [rows] = await db.query(
      'SELECT * FROM daily_challenges WHERE challenge_date = ?',
      [today]
    );
    if (!rows.length) return res.json({ challenge: null });

    const challenge = rows[0];

    const [claimed] = await db.query(
      'SELECT 1 FROM user_challenge_completions WHERE user_id = ? AND challenge_id = ?',
      [userId, challenge.id]
    );

    const progress  = await getProgress(userId, challenge);
    const completed = progress >= challenge.requirement_value;

    return res.json({
      challenge: {
        id:               challenge.id,
        description:      challenge.description,
        requirementType:  challenge.requirement_type,
        requirementValue: challenge.requirement_value,
        creditsReward:    challenge.credits_reward,
        xpReward:         challenge.xp_reward,
      },
      progress,
      completed,
      claimed: claimed.length > 0,
    });
  } catch (err) {
    console.error('getChallenge error:', err);
    return res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/v1/daily-challenge/claim
 * Verifies the challenge is complete and credits the user.
 */
exports.claimChallenge = async (req, res) => {
  const userId = req.user.id;
  const today  = toLocalDateStr();

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      'SELECT * FROM daily_challenges WHERE challenge_date = ?',
      [today]
    );
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'No challenge today' });
    }
    const challenge = rows[0];

    // Already claimed?
    const [claimed] = await conn.query(
      'SELECT 1 FROM user_challenge_completions WHERE user_id = ? AND challenge_id = ?',
      [userId, challenge.id]
    );
    if (claimed.length) {
      await conn.rollback();
      return res.json({ alreadyClaimed: true });
    }

    // Verify completion
    const progress = await getProgress(userId, challenge);
    if (progress < challenge.requirement_value) {
      await conn.rollback();
      return res.status(400).json({
        error:            'Challenge not complete',
        progress,
        requirementValue: challenge.requirement_value,
      });
    }

    // Record completion + grant credits + XP
    await conn.query(
      'INSERT INTO user_challenge_completions (user_id, challenge_id) VALUES (?, ?)',
      [userId, challenge.id]
    );
    await conn.query(
      `UPDATE users
       SET credits = credits + ?,
           xp      = xp + ?,
           level   = FLOOR((xp + ?) / 500) + 1
       WHERE id = ?`,
      [challenge.credits_reward, challenge.xp_reward, challenge.xp_reward, userId]
    );
    await conn.query(
      `INSERT INTO credit_transactions (user_id, credits_used, source)
       VALUES (?, ?, 'challenge')`,
      [userId, -challenge.credits_reward]
    );

    await conn.commit();

    // Achievement checks outside transaction
    const newAchievements = [];
    const [totalCompleted] = await db.query(
      'SELECT COUNT(*) AS c FROM user_challenge_completions WHERE user_id = ?',
      [userId]
    );
    const total = totalCompleted[0].c;
    if (total === 1) {
      const r = await grantAchievement(userId, 'challenge_first'); if (r.granted) newAchievements.push(r.achievement);
    }
    if (total >= 7) {
      const r = await grantAchievement(userId, 'challenge_7');     if (r.granted) newAchievements.push(r.achievement);
    }

    const [final] = await db.query('SELECT credits, xp, level FROM users WHERE id = ?', [userId]);

    return res.json({
      alreadyClaimed:  false,
      creditsEarned:   challenge.credits_reward,
      xpEarned:        challenge.xp_reward,
      balance:         final[0].credits,
      xp:              final[0].xp,
      level:           final[0].level,
      newAchievements,
    });
  } catch (err) {
    await conn.rollback();
    console.error('claimChallenge error:', err);
    return res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
};
