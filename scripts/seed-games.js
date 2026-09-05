/**
 * seed-games.js
 * Seeds the local `games` table with dummy free/instant (WebGL) titles so the
 * homepage grid and game library can be viewed with a realistic number of cards.
 *
 * Usage:
 *   node scripts/seed-games.js [count]    (default 24)
 *   node scripts/seed-games.js --remove   (delete every dummy game + its art)
 *
 * Everything it creates is namespaced so it can never be confused with a real
 * game and can always be removed cleanly:
 *   - slugs are prefixed `dummy-`
 *   - studio is always "Dummy Studio"
 *   - thumbnails are generated SVGs under public/images/dummy/
 *
 * These are placeholders for layout work only — they are not playable games.
 * Intended for local/dev databases; it refuses to touch a database named like
 * production unless --force is passed.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs   = require('fs');
const path = require('path');
const db   = require('../config/database');

const SLUG_PREFIX = 'dummy-';
const STUDIO      = 'Dummy Studio';
const ART_DIR     = path.join(__dirname, '..', 'public', 'images', 'dummy');
const PLAY_DIR    = path.join(__dirname, '..', 'public', 'games', 'dummy');
const PLAY_URL    = '/games/dummy/index.html';

const REMOVE = process.argv.includes('--remove');
const FORCE  = process.argv.includes('--force');
const COUNT  = parseInt(process.argv.find(a => /^\d+$/.test(a)), 10) || 24;

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[rand(0, arr.length - 1)];

// Genre names that already exist in the `genres` table, so the library page's
// genre chips pick these games up instead of silently dropping them.
const GENRES = ['Action', 'Adventure', 'Arcade', 'Casual', 'Puzzle', 'Racing',
  'Shooter', 'Simulation', 'Sports', 'Strategy', 'Tower Defense'];

const TITLES = [
  'Neon Drift', 'Cube Rush', 'Sky Breaker', 'Pixel Fury', 'Loop Quest',
  'Orbit Dash', 'Mist Runner', 'Bolt Arena', 'Tile Storm', 'Vector Kart',
  'Echo Blade', 'Prism Fall', 'Turbo Stack', 'Hex Panic', 'Glow Sprint',
  'Zen Blocks', 'Rift Racer', 'Nova Punch', 'Byte Climb', 'Solar Duel',
  'Frost Jump', 'Lumen Maze', 'Quantum Tap', 'Aero Strike', 'Chroma Shift',
  'Pulse Rider', 'Delta Siege', 'Cinder Loop', 'Vault Breaker', 'Astro Bounce',
];

// Two-tone card art, one hue per card so the grid is easy to scan while
// checking spacing and alignment.
const PALETTE = ['#B5FF6B', '#9B7DFF', '#5CE3E8', '#FF6BA8', '#E8C25C',
  '#7EE64A', '#6BA8FF', '#FF9B6B', '#8FE3C4', '#C58FFF'];

function thumbSvg(title, color) {
  const safe = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${color}"/>
      <stop offset="1" stop-color="#1C1830"/>
    </linearGradient>
  </defs>
  <rect width="640" height="400" fill="url(#g)"/>
  <text x="320" y="196" text-anchor="middle" font-family="Verdana,DejaVu Sans,sans-serif"
        font-size="44" font-weight="bold" fill="#0B0911">${safe}</text>
  <text x="320" y="240" text-anchor="middle" font-family="Verdana,DejaVu Sans,sans-serif"
        font-size="20" fill="#0B0911" opacity="0.6">DUMMY GAME</text>
</svg>`;
}

const PLAY_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Dummy Game</title>
<style>
  html,body{height:100%;margin:0}
  body{display:flex;align-items:center;justify-content:center;
       background:#0B0911;color:#F2EEFF;
       font-family:system-ui,-apple-system,'Segoe UI',sans-serif;text-align:center}
  .box{padding:32px}
  h1{font-size:1.4rem;margin:0 0 10px}
  p{margin:0;color:rgba(242,238,255,0.55);font-size:0.95rem;line-height:1.6}
</style>
</head>
<body>
  <div class="box">
    <h1>🎮 Dummy game</h1>
    <p>This is placeholder content for layout testing.<br />No real game is loaded here.</p>
  </div>
</body>
</html>
`;

async function guardDatabase() {
  const name = process.env.DB_NAME || 'playmist';
  // Production runs on `playmist_db`; refuse to seed dummy data into it.
  if (/_db$|prod/i.test(name) && !FORCE) {
    console.error(`\n❌ Refusing to seed dummy data into database "${name}".`);
    console.error('   That looks like production. Re-run with --force only if you are certain.\n');
    process.exit(1);
  }
  return name;
}

async function remove(dbName) {
  console.log(`\n🧹 Playmist – Removing dummy games from "${dbName}"\n`);

  const [res] = await db.query('DELETE FROM games WHERE slug LIKE ?', [`${SLUG_PREFIX}%`]);
  console.log(`  ✅ Deleted ${res.affectedRows} dummy game row(s)`);

  for (const dir of [ART_DIR, PLAY_DIR]) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`  ✅ Removed ${path.relative(path.join(__dirname, '..'), dir)}/`);
    }
  }

  const [left] = await db.query('SELECT COUNT(*) AS n FROM games');
  console.log(`\n✅ Done. ${left[0].n} game(s) remain (your real games are untouched).\n`);
  process.exit(0);
}

async function main() {
  const dbName = await guardDatabase();
  if (REMOVE) return remove(dbName);

  const count = Math.min(COUNT, TITLES.length);
  console.log(`\n🎮 Playmist – Seeding ${count} dummy instant games into "${dbName}"\n`);

  fs.mkdirSync(ART_DIR, { recursive: true });
  fs.mkdirSync(PLAY_DIR, { recursive: true });
  fs.writeFileSync(path.join(PLAY_DIR, 'index.html'), PLAY_PAGE);

  let inserted = 0;
  let skipped  = 0;

  for (let i = 0; i < count; i++) {
    const title = TITLES[i];
    const slug  = SLUG_PREFIX + title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const color = PALETTE[i % PALETTE.length];

    // Art is written per-slug so --remove and re-seeding stay in sync.
    fs.writeFileSync(path.join(ART_DIR, `${slug}.svg`), thumbSvg(title, color));
    const art = `/images/dummy/${slug}.svg`;

    try {
      await db.query(
        `INSERT INTO games
           (title, slug, short_description, long_description, genre, type, orientation,
            version, play_url, thumbnail_url, secondary_thumbnail, promotional_thumbnail,
            studio, size, plays, rating, credits_cost, flag,
            is_active, is_featured, release_stage, created_at)
         VALUES (?,?,?,?,?, 'webgl', ?, '1.0.0', ?, ?,?,?, ?, ?,?,?, 0, ?, 1, ?, 'live',
                 NOW() - INTERVAL ? HOUR)`,
        [
          title,
          slug,
          'Placeholder entry used for layout testing.',
          'This is a dummy game record created by scripts/seed-games.js so the site '
            + 'layout can be reviewed with a realistic number of cards. It is not a real game.',
          pick(GENRES),
          pick(['landscape', 'landscape', 'portrait']),
          PLAY_URL,
          art, art, art,
          STUDIO,
          `${rand(4, 60)}MB`,
          `${rand(1, 900)}K`,
          (rand(35, 50) / 10).toFixed(1),
          // A few carry a badge so the flag styling is visible in the library.
          i % 7 === 0 ? pick(['NEW', 'HOT', 'TRENDING']) : null,
          i % 9 === 0 ? 1 : 0,
          i * 3, // stagger created_at so "recent first" ordering is meaningful
        ]
      );
      inserted++;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') skipped++;
      else console.error(`  ❌ Failed on ${slug}:`, err.message);
    }
  }

  const [active] = await db.query(
    "SELECT COUNT(*) AS n FROM games WHERE is_active = 1 AND type = 'webgl'"
  );

  console.log(`✅ Inserted ${inserted} dummy game(s)${skipped ? `, skipped ${skipped} existing` : ''}.`);
  console.log(`   Active instant (webgl) games now: ${active[0].n}`);
  console.log(`\n   Remove them anytime with:  node scripts/seed-games.js --remove\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
