const db = require('../../config/database');
const { formatImagePath } = require('../../utils/images');
const { normalizeHandle, isHandleShape } = require('../../utils/handles');
const {
  COMMENT_MAX_CHARS, COMMENT_SELECT, cleanCommentBody, commentLength, shapeComment,
} = require('../../utils/gameComments');

const TABS = ['feed', 'discover', 'following', 'followers'];

async function findActiveDeveloper(rawHandle) {
  const handle = normalizeHandle(rawHandle);
  if (!isHandleShape(handle)) return null;
  const [rows] = await db.query('SELECT id, handle FROM developers WHERE handle = ? AND is_active = 1', [handle]);
  return rows[0] || null;
}

async function followerCount(devId) {
  const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM developer_follows WHERE following_id = ?', [devId]);
  return Number(n);
}

const likePattern = (q) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

// ── Community page ──────────────────────────────────────────────────────────

exports.getCommunity = async (req, res) => {
  const me  = req.session.developer.id;
  const tab = TABS.includes(req.query.tab) ? req.query.tab : 'feed';
  const q   = String(req.query.q || '').trim().slice(0, 60);

  try {
    const [[profile]] = await db.query(
      `SELECT d.id, d.name, d.handle, d.avatar_url, d.header_url, d.headline, d.studio_name,
         (SELECT COUNT(*) FROM developer_follows WHERE following_id = d.id) AS followers,
         (SELECT COUNT(*) FROM developer_follows WHERE follower_id  = d.id) AS following,
         (SELECT COUNT(*) FROM games WHERE developer_id = d.id AND is_active = 1) AS games
       FROM developers d WHERE d.id = ?`,
      [me]
    );

    let newGames = [], newProjects = [], commentsOnMyGames = [], people = [];

    if (tab === 'feed') {
      [newGames] = await db.query(
        `SELECT g.title, g.slug, g.genre, g.short_description, g.thumbnail_url, g.promotional_thumbnail, g.created_at,
                d.name AS dev_name, d.handle AS dev_handle, d.avatar_url AS dev_avatar
         FROM developer_follows f
         JOIN games g      ON g.developer_id = f.following_id AND g.is_active = 1
         JOIN developers d ON d.id = g.developer_id AND d.is_active = 1
         WHERE f.follower_id = ?
         ORDER BY g.created_at DESC LIMIT 30`,
        [me]
      );
      newGames = newGames.map((g) => ({ ...g, thumbnail: formatImagePath(g.promotional_thumbnail || g.thumbnail_url) }));

      [newProjects] = await db.query(
        `SELECT p.id, p.name, p.description, p.status, p.updated_at,
                d.name AS dev_name, d.handle AS dev_handle, d.avatar_url AS dev_avatar
         FROM developer_follows f
         JOIN developer_projects p ON p.developer_id = f.following_id AND p.is_public = 1
         JOIN developers d         ON d.id = p.developer_id AND d.is_active = 1
         WHERE f.follower_id = ?
         ORDER BY p.updated_at DESC LIMIT 12`,
        [me]
      );

      [commentsOnMyGames] = await db.query(
        `SELECT c.id, c.body, c.created_at, g.title AS game_title, g.slug AS game_slug,
                d.name, d.handle, d.avatar_url
         FROM game_comments c
         JOIN games g      ON g.id = c.game_id AND g.developer_id = ?
         JOIN developers d ON d.id = c.developer_id AND d.is_active = 1
         WHERE c.developer_id <> ?
         ORDER BY c.created_at DESC LIMIT 15`,
        [me, me]
      );
    } else {
      const select = `
        SELECT d.name, d.handle, d.avatar_url, d.headline, d.studio_name, d.country,
          (SELECT COUNT(*) FROM games gg WHERE gg.developer_id = d.id AND gg.is_active = 1) AS games,
          (SELECT COUNT(*) FROM developer_follows ff WHERE ff.following_id = d.id) AS followers,
          EXISTS (SELECT 1 FROM developer_follows mf WHERE mf.follower_id = ? AND mf.following_id = d.id) AS is_following
        FROM developers d`;

      if (tab === 'discover') {
        const params = [me, me];
        let where = 'd.is_active = 1 AND d.handle IS NOT NULL AND d.id <> ?';
        if (q) {
          const like = likePattern(q);
          where += ' AND (d.name LIKE ? OR d.handle LIKE ? OR d.studio_name LIKE ?)';
          params.push(like, like, like);
        }
        [people] = await db.query(
          `${select} WHERE ${where} ORDER BY games DESC, followers DESC, d.created_at DESC LIMIT 40`,
          params
        );
      } else {
        const join = tab === 'following'
          ? 'JOIN developer_follows f ON f.following_id = d.id AND f.follower_id = ?'
          : 'JOIN developer_follows f ON f.follower_id = d.id AND f.following_id = ?';
        [people] = await db.query(
          `${select} ${join} WHERE d.is_active = 1 ORDER BY f.created_at DESC LIMIT 200`,
          [me, me]
        );
      }
    }

    res.render('developer/community', {
      title: 'Community',
      tab, q, profile, newGames, newProjects, commentsOnMyGames, people,
    });
  } catch (err) {
    console.error('getCommunity error:', err);
    req.flash('error_msg', 'Failed to load the community page.');
    res.redirect('/developer/dashboard');
  }
};

// ── Follows ─────────────────────────────────────────────────────────────────

exports.follow = async (req, res) => {
  const me = req.session.developer.id;
  try {
    const target = await findActiveDeveloper(req.params.handle);
    if (!target) return res.status(404).json({ error: 'Developer not found.' });
    if (target.id === me) return res.status(400).json({ error: 'You can’t follow yourself.' });
    await db.query('INSERT IGNORE INTO developer_follows (follower_id, following_id) VALUES (?, ?)', [me, target.id]);
    res.json({ following: true, followers: await followerCount(target.id) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to follow.' });
  }
};

exports.unfollow = async (req, res) => {
  const me = req.session.developer.id;
  try {
    const target = await findActiveDeveloper(req.params.handle);
    if (!target) return res.status(404).json({ error: 'Developer not found.' });
    await db.query('DELETE FROM developer_follows WHERE follower_id = ? AND following_id = ?', [me, target.id]);
    res.json({ following: false, followers: await followerCount(target.id) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unfollow.' });
  }
};

// ── Game comments ───────────────────────────────────────────────────────────

exports.postComment = async (req, res) => {
  const me = req.session.developer.id;
  if (!/^\d{1,10}$/.test(req.params.gameId)) return res.status(404).json({ error: 'Game not found.' });
  const gameId = Number(req.params.gameId);

  const body = cleanCommentBody(req.body?.body);
  if (!body) return res.status(400).json({ error: 'Write something before posting.' });
  if (commentLength(body) > COMMENT_MAX_CHARS) {
    return res.status(400).json({ error: `Comments can be up to ${COMMENT_MAX_CHARS} characters.` });
  }

  try {
    const [[game]] = await db.query('SELECT id, developer_id FROM games WHERE id = ? AND is_active = 1', [gameId]);
    if (!game) return res.status(404).json({ error: 'Game not found.' });

    const [dupe] = await db.query(
      `SELECT id FROM game_comments
       WHERE game_id = ? AND developer_id = ? AND body = ? AND created_at > NOW() - INTERVAL 2 MINUTE`,
      [gameId, me, body]
    );
    if (dupe.length) return res.status(409).json({ error: 'You just posted that comment.' });

    const [result] = await db.query(
      'INSERT INTO game_comments (game_id, developer_id, body) VALUES (?, ?, ?)',
      [gameId, me, body]
    );
    const [[row]] = await db.query(`${COMMENT_SELECT} WHERE c.id = ?`, [result.insertId]);
    res.json({ comment: shapeComment(row, me, game.developer_id) });
  } catch (err) {
    console.error('postComment error:', err);
    res.status(500).json({ error: 'Failed to post comment.' });
  }
};

exports.deleteComment = async (req, res) => {
  const me = req.session.developer.id;
  if (!/^\d{1,10}$/.test(req.params.commentId)) return res.status(404).json({ error: 'Comment not found.' });
  try {
    const [result] = await db.query(
      `DELETE c FROM game_comments c
       JOIN games g ON g.id = c.game_id
       WHERE c.id = ? AND (c.developer_id = ? OR g.developer_id = ?)`,
      [Number(req.params.commentId), me, me]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Comment not found.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete comment.' });
  }
};
