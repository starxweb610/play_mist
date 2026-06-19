const db = require('../../config/database');

/**
 * GET /api/v1/user/achievements
 * Returns all achievement definitions with earned_at for the current user.
 */
exports.getUserAchievements = async (req, res) => {
  try {
    const userId = req.user.id;

    const [rows] = await db.query(
      `SELECT a.key_name, a.name, a.description, a.xp_reward, a.credits_reward,
              ua.earned_at
       FROM achievements a
       LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = ?
       ORDER BY ua.earned_at DESC, a.id ASC`,
      [userId]
    );

    return res.json(
      rows.map(r => ({
        keyName:       r.key_name,
        name:          r.name,
        description:   r.description,
        xpReward:      r.xp_reward,
        creditsReward: r.credits_reward,
        earned:        !!r.earned_at,
        earnedAt:      r.earned_at || null,
      }))
    );
  } catch (err) {
    console.error('getUserAchievements error:', err);
    return res.status(500).json({ error: err.message });
  }
};
