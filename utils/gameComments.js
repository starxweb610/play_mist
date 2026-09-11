/**
 * utils/gameComments.js
 * Developer comments on public game pages (game_comments). Shared by the
 * public game page (read) and the developer social API (write/delete).
 *
 * Bodies are plain text. They are stored as typed (after cleanup) and must be
 * rendered escaped — EJS <%= %> on the server, textContent in the browser.
 */
const db = require('../config/database');

const COMMENT_MAX_CHARS = 1000;

const COMMENT_SELECT = `
  SELECT c.id, c.game_id, c.developer_id, c.body, c.created_at,
         d.name, d.handle, d.avatar_url, d.studio_name
  FROM game_comments c
  JOIN developers d ON d.id = c.developer_id AND d.is_active = 1`;

// C0 controls except \t and \n, DEL, zero-width marks, and bidi overrides /
// isolates (used to visually disguise or reorder text).
const INVISIBLE_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;

/** Normalises newlines, strips invisible characters, collapses blank-line runs. */
function cleanCommentBody(raw) {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE_CHARS, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Counts user-visible characters (an emoji is one, not two UTF-16 units). */
const commentLength = (body) => [...body].length;

/** Comment shape sent to templates and the browser. */
function shapeComment(row, viewerId, gameDeveloperId) {
  return {
    id:        row.id,
    body:      row.body,
    createdAt: row.created_at,
    author: {
      name:      row.name,
      handle:    row.handle,
      avatarUrl: row.avatar_url || null,
      studio:    row.studio_name || null,
    },
    // Authors can remove their own comments; developers can moderate their game.
    canDelete: !!viewerId && (viewerId === row.developer_id || viewerId === gameDeveloperId),
  };
}

async function listGameComments(gameId, { viewerId = null, gameDeveloperId = null, limit = 50 } = {}) {
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM game_comments c
     JOIN developers d ON d.id = c.developer_id AND d.is_active = 1
     WHERE c.game_id = ?`,
    [gameId]
  );
  const [rows] = await db.query(
    `${COMMENT_SELECT} WHERE c.game_id = ? ORDER BY c.created_at DESC, c.id DESC LIMIT ?`,
    [gameId, limit]
  );
  return { total: Number(total), comments: rows.map((r) => shapeComment(r, viewerId, gameDeveloperId)) };
}

module.exports = {
  COMMENT_MAX_CHARS,
  COMMENT_SELECT,
  cleanCommentBody,
  commentLength,
  shapeComment,
  listGameComments,
};
