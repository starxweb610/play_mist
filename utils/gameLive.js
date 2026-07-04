const db        = require('../config/database');
const fcm       = require('./fcm');
const mailer    = require('./mailer');
const templates = require('./emailTemplates');

// Everything that should happen when a game transitions inactive → active:
//  1. Push notification to all app users (secondary thumbnail as image).
//  2. "Your game is live" email to the submitting developer, with a shareable
//     link to the public game page. Admin-uploaded games have no linked
//     developer submission, so they get the push only.
// Fire-and-forget safe: never throws.
exports.announceGameLive = async (gameId, adminId = null) => {
  fcm.sendGameLiveNotification(gameId, adminId)
    .catch(e => console.error('FCM push error:', e));

  try {
    const [rows] = await db.query(
      `SELECT g.title, g.slug, d.name AS developer_name, d.email AS developer_email
       FROM games g
       JOIN developer_submissions s ON s.game_id = g.id
       JOIN developers d ON d.id = s.developer_id
       WHERE g.id = ?
       LIMIT 1`,
      [gameId]
    );
    if (!rows.length) return;

    const { title, slug, developer_name, developer_email } = rows[0];
    const base    = (process.env.BASE_URL || 'https://playmist.com').replace(/\/+$/, '');
    const gameUrl = `${base}/games/${slug}`;

    await mailer.sendMail({
      to:      developer_email,
      subject: `🎉 "${title}" is now live on ${process.env.APP_NAME || 'PlayMist'}!`,
      html:    templates.gameLive({
        name:      developer_name,
        gameTitle: title,
        gameUrl,
      }),
    });
  } catch (err) {
    console.error('game live developer email failed:', err.message);
  }
};
