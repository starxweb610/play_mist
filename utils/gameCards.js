/**
 * utils/gameCards.js
 * Shared shape for game cards on the public website — the library, game detail
 * pages and developer profiles all render games from the same fields.
 */
const { formatImagePath } = require('./images');
const { formatBytes, formatCount, formatRating } = require('./format');

/**
 * Every figure the site shows about a game is measured, not stored copy.
 *
 * `games.plays`, `games.rating` and `games.size` are legacy hand-entered
 * varchars whose column DEFAULTS are '1.2M', '4.8' and '24MB' — so a game
 * nobody had ever opened still advertised 1.2M plays and 4.8 stars. They are
 * deliberately not selected here. The three subqueries below are the same ones
 * the mobile API uses (controllers/api/gamesApi.js), so the site and the app
 * can never quote different numbers for the same game.
 */
const GAME_FIELDS = `
  games.id, games.title, games.slug, games.short_description, games.long_description,
  games.controls, games.genre, games.type, games.orientation, games.version,
  games.play_url, games.trailer_url, games.thumbnail_url, games.secondary_thumbnail,
  games.promotional_thumbnail, games.studio, games.size_bytes, games.credits_cost,
  games.flag, games.is_featured, games.developer_id, games.created_at,
  (SELECT COUNT(*)       FROM analytics_games ag WHERE ag.game_id = games.id) AS play_count,
  (SELECT AVG(gr.rating) FROM game_ratings    gr WHERE gr.game_id = games.id) AS avg_rating,
  (SELECT COUNT(*)       FROM game_ratings    gr WHERE gr.game_id = games.id) AS rating_count
`;

/** Shape a DB game row into the fields the public templates need. */
function toCardView(g) {
  const playCount   = Number(g.play_count)   || 0;
  const ratingCount = Number(g.rating_count) || 0;
  const rating      = formatRating(g.avg_rating);

  return {
    id:          g.id,
    title:       g.title,
    slug:        g.slug,
    genre:       g.genre || 'Game',
    type:        g.type,
    orientation: g.orientation || 'landscape',
    shortDesc:   g.short_description || '',
    thumbnail:   formatImagePath(g.promotional_thumbnail || g.thumbnail_url),

    // null, not 0 or '', so the templates can leave the figure out entirely.
    // A game nobody has played yet says nothing rather than "0 Plays", and an
    // unrated game shows no stars rather than a flattering default.
    plays:       playCount > 0 ? formatCount(playCount) : null,
    playCount,
    rating:      ratingCount > 0 && rating ? rating : null,
    ratingCount,
    // Only the byte count captured from the uploaded build is trustworthy. The
    // legacy `size` string is indistinguishable from its '24MB' default, so a
    // game without a measured size shows no size at all.
    size:        g.size_bytes ? formatBytes(g.size_bytes) : null,

    flag:        g.flag || null,
    isFeatured:  !!g.is_featured,
    playable:    g.type === 'webgl' && !!g.play_url,
  };
}

module.exports = { GAME_FIELDS, toCardView };
