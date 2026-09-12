/**
 * utils/gameCards.js
 * Shared shape for game cards on the public website — the library, game detail
 * pages and developer profiles all render games from the same fields.
 */
const { formatImagePath } = require('./images');

const GAME_FIELDS = `
  id, title, slug, short_description, long_description, controls, genre, type, orientation,
  version, play_url, trailer_url, thumbnail_url, secondary_thumbnail, promotional_thumbnail,
  studio, size, plays, rating, credits_cost, flag, is_featured, developer_id, created_at
`;

/** Shape a DB game row into the fields the public templates need. */
function toCardView(g) {
  return {
    id:          g.id,
    title:       g.title,
    slug:        g.slug,
    genre:       g.genre || 'Game',
    type:        g.type,
    orientation: g.orientation || 'landscape',
    shortDesc:   g.short_description || '',
    thumbnail:   formatImagePath(g.promotional_thumbnail || g.thumbnail_url),
    rating:      g.rating || null,
    plays:       g.plays || null,
    flag:        g.flag || null,
    isFeatured:  !!g.is_featured,
    playable:    g.type === 'webgl' && !!g.play_url,
  };
}

module.exports = { GAME_FIELDS, toCardView };
