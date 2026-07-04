/**
 * seed-transactions.js
 * Seeds the local `credit_transactions` table with dummy rows so the
 * Player Accounts transaction filters/sorting have realistic spread.
 *
 * Usage:
 *   node scripts/seed-transactions.js [maxPerUser]   (default 40)
 *
 * Each user gets a random 0..maxPerUser transactions, spread over the last
 * 90 days, with varied sources and (where available) real game_ids.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../config/database');

const MAX = parseInt(process.argv[2], 10) || 40;
const SOURCES = ['game', 'ad', 'streak', 'achievement', 'challenge', 'welcome', 'other'];

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[rand(0, arr.length - 1)];

async function main() {
  const [users] = await db.query('SELECT id FROM users');
  const [games] = await db.query('SELECT id FROM games');
  const gameIds = games.map((g) => g.id);

  if (!users.length) {
    console.error('❌ No users found. Run `node scripts/seed-users.js` first.');
    process.exit(1);
  }

  console.log(`\n🎮 Seeding transactions for ${users.length} users (0–${MAX} each)…\n`);

  let total = 0;
  for (const u of users) {
    const n = rand(0, MAX);
    for (let i = 0; i < n; i++) {
      const source = pick(SOURCES);
      // Only 'game' rows reference a game; others leave game_id NULL.
      const gameId = source === 'game' && gameIds.length ? pick(gameIds) : null;
      const credits = rand(1, 50) * 10;
      const daysAgo = rand(0, 90);
      const createdAt = new Date(Date.now() - daysAgo * 86400000 - rand(0, 86400000));
      await db.query(
        `INSERT INTO credit_transactions (user_id, game_id, credits_used, source, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [u.id, gameId, credits, source, createdAt]
      );
      total++;
    }
  }

  console.log(`✅ Done. Inserted ${total} transaction(s) across ${users.length} users.\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
