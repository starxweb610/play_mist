/**
 * seed-users.js
 * Seeds the local `users` table with dummy players for testing.
 *
 * Usage:
 *   node scripts/seed-users.js [count]   (default 50)
 *
 * Each user gets username `player_NN`, a hashed password (`password123`),
 * randomized credits/xp/level/streaks, and a spread of created_at dates.
 * A few are marked inactive (banned) so the moderation UI has variety.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const db = require('../config/database');

const COUNT = parseInt(process.argv[2], 10) || 50;

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[rand(0, arr.length - 1)];

const FIRST = ['alex', 'sam', 'jordan', 'casey', 'riley', 'taylor', 'morgan', 'jamie',
  'drew', 'quinn', 'avery', 'skyler', 'reese', 'rowan', 'blake', 'nova', 'kai',
  'luca', 'mila', 'zane', 'ivy', 'leo', 'remy', 'sage', 'wren'];
const LAST = ['fox', 'wolf', 'storm', 'blaze', 'frost', 'nova', 'shadow', 'viper',
  'ace', 'ghost', 'pixel', 'byte', 'flux', 'raven', 'ember', 'onyx', 'echo', 'dash'];

async function main() {
  console.log(`\n🎮 Playmist – Seeding ${COUNT} dummy users into "${process.env.DB_NAME || 'playmist'}"\n`);

  const hash = await bcrypt.hash('password123', 12);
  let inserted = 0;
  let skipped = 0;

  for (let i = 1; i <= COUNT; i++) {
    const suffix = String(i).padStart(2, '0');
    const username = `${pick(FIRST)}_${pick(LAST)}_${suffix}`;
    const email = `player${suffix}@example.com`;
    const credits = rand(0, 25) * 100;          // 0 – 2500
    const xp = rand(0, 50000);
    const level = Math.max(1, Math.floor(xp / 1000) + 1);
    const longest = rand(0, 60);
    const current = rand(0, longest);
    const isActive = i % 8 === 0 ? 0 : 1;         // ~1 in 8 banned
    const daysAgo = rand(0, 180);
    const createdAt = new Date(Date.now() - daysAgo * 86400000);

    try {
      await db.query(
        `INSERT INTO users
           (username, email, password_hash, credits, xp, level,
            current_streak, longest_streak, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [username, email, hash, credits, xp, level, current, longest, isActive, createdAt]
      );
      inserted++;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        skipped++;
      } else {
        console.error(`  ❌ Failed on ${username}:`, err.message);
      }
    }
  }

  console.log(`\n✅ Done. Inserted ${inserted} user(s)${skipped ? `, skipped ${skipped} duplicate(s)` : ''}.`);
  console.log('   Default password for all seeded users: password123\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
