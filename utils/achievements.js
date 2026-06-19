/**
 * Shared helper: grant an achievement + XP/credits to a user.
 * Safe to call multiple times — INSERT IGNORE is a no-op for already-earned
 * achievements, and credits/XP are only updated when the row is new.
 *
 * Returns { granted: bool, achievement } so callers can surface the unlock to the client.
 */
const db = require('../config/database');

const XP_PER_LEVEL = 500; // every 500 XP = 1 level

exports.levelFromXp = (xp) => Math.floor(xp / XP_PER_LEVEL) + 1;

/**
 * Tries to grant `keyName` achievement to `userId`.
 * If already earned → returns { granted: false }.
 * If newly earned  → credits user with xp + credits, returns { granted: true, achievement }.
 */
exports.grantAchievement = async (userId, keyName, connection = null) => {
  const q = connection ? connection.query.bind(connection) : db.query.bind(db);

  const [achRows] = await q('SELECT id, xp_reward, credits_reward, name, description FROM achievements WHERE key_name = ?', [keyName]);
  if (!achRows.length) return { granted: false };

  const ach = achRows[0];

  // Try to insert — if already earned, INSERT IGNORE silently skips
  const [ins] = await q(
    'INSERT IGNORE INTO user_achievements (user_id, achievement_id) VALUES (?, ?)',
    [userId, ach.id]
  );

  if (ins.affectedRows === 0) return { granted: false };

  // Apply XP + credits
  await q(
    `UPDATE users
     SET xp      = xp + ?,
         credits = credits + ?,
         level   = FLOOR((xp + ?) / ${XP_PER_LEVEL}) + 1
     WHERE id = ?`,
    [ach.xp_reward, ach.credits_reward, ach.xp_reward, userId]
  );

  if (ach.credits_reward > 0) {
    await q(
      `INSERT INTO credit_transactions (user_id, credits_used, source)
       VALUES (?, ?, 'achievement')`,
      [userId, -ach.credits_reward]
    );
  }

  return {
    granted: true,
    achievement: {
      keyName,
      name:        ach.name,
      description: ach.description,
      xpReward:    ach.xp_reward,
      creditsReward: ach.credits_reward,
    },
  };
};

/**
 * Grant XP directly (for streak rewards etc.) and recalculate level.
 */
exports.grantXp = async (userId, amount, connection = null) => {
  const q = connection ? connection.query.bind(connection) : db.query.bind(db);
  await q(
    `UPDATE users
     SET xp    = xp + ?,
         level = FLOOR((xp + ?) / ${XP_PER_LEVEL}) + 1
     WHERE id = ?`,
    [amount, amount, userId]
  );
};
