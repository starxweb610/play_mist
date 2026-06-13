const mysql2 = require('mysql2/promise');

const pool = mysql2.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'playmist',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

pool.on('error', (err) => {
  console.error('❌ Unexpected database pool error:', err.message || err);
});

pool.getConnection()
  .then(async (conn) => {
    console.log('✅ MySQL connected successfully');
    
    // Auto-migrate missing columns
    try {
      const migrateColumn = async (table, column, definition) => {
        const [columnCheck] = await conn.query(
          `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
          [table, column]
        );
        if (columnCheck[0].c === 0) {
          await conn.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
          console.log(`  ✅ Database Migrator: Added ${column} to ${table}`);
        }
      };

      await migrateColumn('games', 'zip_url', 'VARCHAR(500) DEFAULT NULL AFTER play_url');
      await migrateColumn('games', 'secondary_thumbnail', 'VARCHAR(500) DEFAULT NULL AFTER thumbnail_url');
      await migrateColumn('games', 'promotional_thumbnail', 'VARCHAR(500) DEFAULT NULL AFTER secondary_thumbnail');
      await migrateColumn('games', 'is_featured', 'TINYINT(1) DEFAULT 0 AFTER is_active');
      
      // Also user_id columns for analytics
      await migrateColumn('analytics_games', 'user_id', 'INT DEFAULT NULL AFTER game_id');
      await migrateColumn('analytics_app', 'user_id', 'INT DEFAULT NULL AFTER device');

      // Users table credits column
      await migrateColumn('users', 'credits', 'INT DEFAULT 1000 AFTER avatar');
      await conn.query('UPDATE users SET credits = 1000 WHERE credits IS NULL');

      // Idempotency key for AdMob SSV-credited rewards
      await migrateColumn('credit_transactions', 'ad_transaction_id', 'VARCHAR(64) NULL UNIQUE AFTER credits_used');

      // SSV-credited rewards have no associated game, so game_id must be nullable
      const [gameIdCol] = await conn.query(
        `SELECT IS_NULLABLE FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_transactions' AND COLUMN_NAME = 'game_id'`
      );
      if (gameIdCol.length > 0 && gameIdCol[0].IS_NULLABLE === 'NO') {
        await conn.query('ALTER TABLE credit_transactions MODIFY COLUMN game_id INT NULL');
        console.log('  ✅ Database Migrator: Made credit_transactions.game_id nullable');
      }

      // Create credit_transactions table if not exists
      try {
        await conn.query(`
          CREATE TABLE IF NOT EXISTS credit_transactions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            game_id INT NOT NULL,
            credits_used INT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        console.log('  ✅ Database Migrator: Ensured credit_transactions table exists');
      } catch (tblErr) {
        console.warn('⚠️  Database Migrator: Failed to create credit_transactions with foreign keys, trying fallback:', tblErr.message);
        await conn.query(`
          CREATE TABLE IF NOT EXISTS credit_transactions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            game_id INT NOT NULL,
            credits_used INT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
      }

    } catch (migErr) {
      console.warn('⚠️  Database auto-migration failed:', migErr.message);
    }

    conn.release();
  })
  .catch(err => {
    console.warn('⚠️  MySQL connection failed (site will still work with defaults):', err.message);
  });

module.exports = pool;
