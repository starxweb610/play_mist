/**
 * scripts/sync-db.js
 * Safe migration script — adds new columns/tables to an existing Playmist DB.
 * Run: node scripts/sync-db.js  (or npm run sync-db)
 * Compatible with MySQL 5.7+
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../config/database');

async function columnExists(table, column) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0].c > 0;
}

async function addColumn(table, column, definition) {
  if (await columnExists(table, column)) {
    console.log(`  ⏭  ${table}.${column} already exists — skipped`);
    return;
  }
  await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`  ✅ Added ${table}.${column}`);
}

const createTables = [
  {
    name: 'ticket_replies',
    sql: `CREATE TABLE IF NOT EXISTS ticket_replies (
      id         INT PRIMARY KEY AUTO_INCREMENT,
      ticket_id  INT NOT NULL,
      admin_id   INT,
      message    TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (admin_id)  REFERENCES admins(id)  ON DELETE SET NULL
    )`,
  },
  {
    name: 'analytics_app',
    sql: `CREATE TABLE IF NOT EXISTS analytics_app (
      id         INT PRIMARY KEY AUTO_INCREMENT,
      device     ENUM('android','ios','other') NOT NULL DEFAULT 'other',
      session_id VARCHAR(120),
      event_date DATE      NOT NULL,
      event_time TIME      NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'analytics_games',
    sql: `CREATE TABLE IF NOT EXISTS analytics_games (
      id         INT PRIMARY KEY AUTO_INCREMENT,
      game_id    INT,
      device     ENUM('android','ios','other') NOT NULL DEFAULT 'other',
      session_id VARCHAR(120),
      event_date DATE      NOT NULL,
      event_time TIME      NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL
    )`,
  },
  {
    name: 'feedbacks',
    sql: `CREATE TABLE IF NOT EXISTS feedbacks (
      id         INT PRIMARY KEY AUTO_INCREMENT,
      user_id    INT,
      rating     TINYINT UNSIGNED,
      message    TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )`,
  },
];

async function syncDb() {
  console.log('\n🔄 Playmist — DB Sync\n');

  // Column migrations
  try {
    await addColumn('admins', 'email', 'VARCHAR(255) AFTER name');
    await addColumn('games', 'short_description', 'VARCHAR(200) AFTER slug');
    await addColumn('games', 'orientation', "ENUM('portrait','landscape') DEFAULT 'landscape' AFTER type");
    await addColumn('games', 'version', "VARCHAR(20) DEFAULT '1.0.0' AFTER orientation");
    await addColumn('games', 'file_path', 'VARCHAR(500) AFTER version');
    await addColumn('games', 'play_url', 'VARCHAR(500) AFTER file_path');
    await addColumn('games', 'long_description', 'TEXT AFTER play_url');
    await addColumn('games', 'trailer_url', 'VARCHAR(500) AFTER long_description');
    await addColumn('games', 'thumbnail_url', 'VARCHAR(500) AFTER trailer_url');
    await addColumn('games', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at');

    // Modify default
    await db.query('ALTER TABLE games MODIFY COLUMN is_active TINYINT(1) DEFAULT 0');
    console.log(`  ✅ games.is_active default set to 0`);
  } catch (err) {
    console.error('  ❌ Column migration error:', err.message);
  }

  // Table creations
  for (const t of createTables) {
    try {
      await db.query(t.sql);
      console.log(`  ✅ Table ${t.name} ready`);
    } catch (err) {
      console.error(`  ❌ Table ${t.name}:`, err.message);
    }
  }

  console.log('\n✔ Sync complete!\n');
  process.exit(0);
}

syncDb().catch(err => { console.error(err); process.exit(1); });
