/**
 * utils/migrate.js
 * Idempotent DB migrations — safe to call on every server start.
 * Uses information_schema checks so re-runs are no-ops.
 */
const db = require('../config/database');

const migrateColumn = async (table, column, definition) => {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (rows[0].c === 0) {
    await db.query(`ALTER TABLE \`${table}\` ADD COLUMN ${column} ${definition}`);
    return true;
  }
  return false;
};

exports.runMigrations = async () => {
  try {
    // ── analytics_games ───────────────────────────────────────────────────────
    const [agCols] = await db.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'analytics_games' AND COLUMN_NAME = 'user_id'`
    );
    if (agCols[0].c === 0) {
      await db.query('ALTER TABLE analytics_games ADD COLUMN user_id INT DEFAULT NULL AFTER game_id');
      try { await db.query('ALTER TABLE analytics_games ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL'); } catch (_) {}
    }

    // ── analytics_app ─────────────────────────────────────────────────────────
    const [aaCols] = await db.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'analytics_app' AND COLUMN_NAME = 'user_id'`
    );
    if (aaCols[0].c === 0) {
      await db.query('ALTER TABLE analytics_app ADD COLUMN user_id INT DEFAULT NULL AFTER device');
      try { await db.query('ALTER TABLE analytics_app ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL'); } catch (_) {}
    }

    // ── games columns ─────────────────────────────────────────────────────────
    await migrateColumn('games', 'zip_url',               'VARCHAR(500) DEFAULT NULL AFTER play_url');
    await migrateColumn('games', 'secondary_thumbnail',   'VARCHAR(500) DEFAULT NULL AFTER thumbnail_url');
    await migrateColumn('games', 'promotional_thumbnail', 'VARCHAR(500) DEFAULT NULL AFTER secondary_thumbnail');
    await migrateColumn('games', 'is_featured',           'TINYINT(1) DEFAULT 0 AFTER is_active');

    // ── users columns ─────────────────────────────────────────────────────────
    await migrateColumn('users', 'credits',         'INT DEFAULT 1000 AFTER avatar');
    await db.query('UPDATE users SET credits = 1000 WHERE credits IS NULL');
    await migrateColumn('users', 'xp',              'INT DEFAULT 0 AFTER credits');
    await migrateColumn('users', 'level',           'INT DEFAULT 1 AFTER xp');
    await migrateColumn('users', 'current_streak',  'INT DEFAULT 0 AFTER level');
    await migrateColumn('users', 'longest_streak',  'INT DEFAULT 0 AFTER current_streak');
    await migrateColumn('users', 'last_streak_date','DATE DEFAULT NULL AFTER longest_streak');

    // ── credit_transactions ───────────────────────────────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS credit_transactions (
        id                INT PRIMARY KEY AUTO_INCREMENT,
        user_id           INT NOT NULL,
        game_id           INT DEFAULT NULL,
        credits_used      INT NOT NULL,
        ad_transaction_id VARCHAR(255) DEFAULT NULL UNIQUE,
        source            ENUM('game','ad','streak','achievement','challenge','welcome','other') DEFAULT 'game',
        created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL
      )
    `);

    // Make game_id nullable if an older schema made it NOT NULL
    const [txCol] = await db.query(
      `SELECT IS_NULLABLE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_transactions' AND COLUMN_NAME = 'game_id'`
    );
    if (txCol.length && txCol[0].IS_NULLABLE === 'NO') {
      await db.query('ALTER TABLE credit_transactions MODIFY game_id INT NULL');
    }

    await migrateColumn('credit_transactions', 'source',
      "ENUM('game','ad','streak','achievement','challenge','welcome','other') DEFAULT 'game'");

    // ── daily_picks ───────────────────────────────────────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS daily_picks (
        id         INT PRIMARY KEY AUTO_INCREMENT,
        game_id    INT NOT NULL,
        pick_date  DATE NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
      )
    `);

    // ── achievements ──────────────────────────────────────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS achievements (
        id             INT PRIMARY KEY AUTO_INCREMENT,
        key_name       VARCHAR(80)  NOT NULL UNIQUE,
        name           VARCHAR(120) NOT NULL,
        description    TEXT,
        xp_reward      INT DEFAULT 0,
        credits_reward INT DEFAULT 0,
        created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      INSERT IGNORE INTO achievements (key_name, name, description, xp_reward, credits_reward) VALUES
      ('first_game',      'Into the Mist',      'Play your first game',                   100, 50),
      ('games_5',         'Getting Warm',        'Play 5 different games',                 150, 75),
      ('games_25',        'Mist Walker',         'Play 25 games',                          300, 150),
      ('streak_3',        'On a Roll',           'Maintain a 3-day login streak',          100, 50),
      ('streak_7',        'Week of Mist',        'Maintain a 7-day login streak',          250, 150),
      ('streak_30',       'Mist Devotee',        'Maintain a 30-day login streak',         500, 500),
      ('first_premium',   'Premium Taste',       'Play a premium game for the first time', 200, 100),
      ('daily_pick',      'Today''s Pick',       'Play the daily free game',               50,  25),
      ('challenge_first', 'Challenge Accepted',  'Complete your first daily challenge',    100, 50),
      ('challenge_7',     'Challenger',          'Complete 7 daily challenges',            300, 200)
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS user_achievements (
        user_id        INT NOT NULL,
        achievement_id INT NOT NULL,
        earned_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, achievement_id),
        FOREIGN KEY (user_id)        REFERENCES users(id)        ON DELETE CASCADE,
        FOREIGN KEY (achievement_id) REFERENCES achievements(id) ON DELETE CASCADE
      )
    `);

    // ── daily_challenges ──────────────────────────────────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS daily_challenges (
        id                INT PRIMARY KEY AUTO_INCREMENT,
        challenge_date    DATE         NOT NULL UNIQUE,
        description       VARCHAR(255) NOT NULL,
        requirement_type  ENUM('play_count','play_mini','play_premium') NOT NULL,
        requirement_value INT          DEFAULT 1,
        credits_reward    INT          DEFAULT 150,
        xp_reward         INT          DEFAULT 75,
        created_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS user_challenge_completions (
        user_id      INT NOT NULL,
        challenge_id INT NOT NULL,
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, challenge_id),
        FOREIGN KEY (user_id)      REFERENCES users(id)            ON DELETE CASCADE,
        FOREIGN KEY (challenge_id) REFERENCES daily_challenges(id) ON DELETE CASCADE
      )
    `);

    // ── developers ────────────────────────────────────────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS developers (
        id            INT PRIMARY KEY AUTO_INCREMENT,
        name          VARCHAR(120) NOT NULL,
        email         VARCHAR(255) NOT NULL UNIQUE,
        phone         VARCHAR(30)  DEFAULT NULL,
        country       VARCHAR(100) NOT NULL,
        studio_name   VARCHAR(150) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        is_active     TINYINT(1)   DEFAULT 1,
        ban_reason    TEXT         DEFAULT NULL,
        banned_at     DATETIME     DEFAULT NULL,
        banned_by     INT          DEFAULT NULL,
        last_login    DATETIME     DEFAULT NULL,
        created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (banned_by) REFERENCES admins(id) ON DELETE SET NULL
      )
    `);

    // ── developer_submissions ─────────────────────────────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS developer_submissions (
        id               INT PRIMARY KEY AUTO_INCREMENT,
        developer_id     INT NOT NULL,
        title            VARCHAR(200) NOT NULL,
        slug             VARCHAR(200) NOT NULL UNIQUE,
        description      TEXT NOT NULL,
        genre            VARCHAR(80)  NOT NULL,
        orientation      ENUM('portrait','landscape') DEFAULT 'landscape',
        version          VARCHAR(20)  DEFAULT '1.0',
        zip_r2_key       VARCHAR(600) NOT NULL,
        zip_size         BIGINT       NOT NULL,
        thumbnail_url    VARCHAR(600) DEFAULT NULL,
        status           ENUM('pending','under_review','approved','rejected') DEFAULT 'pending',
        rejection_reason TEXT         DEFAULT NULL,
        reviewed_by      INT          DEFAULT NULL,
        reviewed_at      DATETIME     DEFAULT NULL,
        game_id          INT          DEFAULT NULL,
        created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        updated_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (developer_id) REFERENCES developers(id) ON DELETE CASCADE,
        FOREIGN KEY (reviewed_by)  REFERENCES admins(id)     ON DELETE SET NULL,
        FOREIGN KEY (game_id)      REFERENCES games(id)      ON DELETE SET NULL
      )
    `);

    // ── developer_submissions: add preview_play_url column ───────────────────
    await migrateColumn('developer_submissions', 'preview_play_url', 'VARCHAR(600) DEFAULT NULL AFTER zip_size');

    // ── developer_submissions: expand status ENUM to include 'draft' ─────────
    const [subStatusCol] = await db.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_submissions' AND COLUMN_NAME = 'status'`
    );
    if (subStatusCol.length && !subStatusCol[0].COLUMN_TYPE.includes('draft')) {
      await db.query(
        `ALTER TABLE developer_submissions
         MODIFY COLUMN status ENUM('draft','pending','under_review','approved','rejected') DEFAULT 'draft'`
      );
    }

    // ── developers.bio / avatar_url ───────────────────────────────────────────
    await migrateColumn('developers', 'bio',        'TEXT DEFAULT NULL');
    await migrateColumn('developers', 'avatar_url', 'VARCHAR(500) DEFAULT NULL');

    // ── developer_notes ───────────────────────────────────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS developer_notes (
        id           INT PRIMARY KEY AUTO_INCREMENT,
        developer_id INT NOT NULL,
        title        VARCHAR(255) NOT NULL,
        description  VARCHAR(500) DEFAULT NULL,
        content      MEDIUMTEXT   DEFAULT NULL,
        is_shared    TINYINT(1)   DEFAULT 0,
        created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (developer_id) REFERENCES developers(id) ON DELETE CASCADE
      )
    `);

    // ── developer_projects ────────────────────────────────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS developer_projects (
        id           INT PRIMARY KEY AUTO_INCREMENT,
        developer_id INT NOT NULL,
        name         VARCHAR(200) NOT NULL,
        description  TEXT         DEFAULT NULL,
        status       ENUM('active','on_track','at_risk','completed') DEFAULT 'active',
        deadline     DATE         DEFAULT NULL,
        created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (developer_id) REFERENCES developers(id) ON DELETE CASCADE
      )
    `);

    // ── developer_project_tasks ───────────────────────────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS developer_project_tasks (
        id         INT PRIMARY KEY AUTO_INCREMENT,
        project_id INT NOT NULL,
        title      VARCHAR(300) NOT NULL,
        is_done    TINYINT(1)   DEFAULT 0,
        created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES developer_projects(id) ON DELETE CASCADE
      )
    `);

    // ── Expand developer_project_tasks with Kanban fields ─────────────────────
    await migrateColumn('developer_project_tasks', 'description', 'TEXT DEFAULT NULL');
    await migrateColumn('developer_project_tasks', 'status',
      "ENUM('todo','in_progress','in_review','done') DEFAULT 'todo'");
    await migrateColumn('developer_project_tasks', 'priority',
      "ENUM('low','medium','high','critical') DEFAULT 'medium'");
    await migrateColumn('developer_project_tasks', 'due_date', 'DATE DEFAULT NULL');
    await migrateColumn('developer_project_tasks', 'labels',   'VARCHAR(500) DEFAULT NULL');
    await migrateColumn('developer_project_tasks', 'position', 'INT DEFAULT 0');
    await migrateColumn('developer_project_tasks', 'updated_at',
      'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
    // Carry forward legacy done tasks
    await db.query(
      `UPDATE developer_project_tasks SET status = 'done' WHERE is_done = 1 AND status = 'todo'`
    );

    // ── developer_task_comments ───────────────────────────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS developer_task_comments (
        id           INT PRIMARY KEY AUTO_INCREMENT,
        task_id      INT NOT NULL,
        developer_id INT NOT NULL,
        content      TEXT      NOT NULL,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id)      REFERENCES developer_project_tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (developer_id) REFERENCES developers(id)              ON DELETE CASCADE
      )
    `);

    // ── developer_project_docs ────────────────────────────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS developer_project_docs (
        id           INT PRIMARY KEY AUTO_INCREMENT,
        project_id   INT          NOT NULL,
        developer_id INT          NOT NULL,
        title        VARCHAR(300) NOT NULL,
        doc_type     ENUM('rich_text','html','upload') NOT NULL,
        content      LONGTEXT     DEFAULT NULL,
        file_url     VARCHAR(500) DEFAULT NULL,
        file_name    VARCHAR(300) DEFAULT NULL,
        file_size    INT          DEFAULT NULL,
        mime_type    VARCHAR(100) DEFAULT NULL,
        is_pinned    TINYINT(1)   DEFAULT 0,
        created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id)   REFERENCES developer_projects(id) ON DELETE CASCADE,
        FOREIGN KEY (developer_id) REFERENCES developers(id)         ON DELETE CASCADE
      )
    `);

    // ── developer_storyboards ─────────────────────────────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS developer_storyboards (
        id           INT PRIMARY KEY AUTO_INCREMENT,
        project_id   INT          NOT NULL,
        developer_id INT          NOT NULL,
        title        VARCHAR(300) NOT NULL,
        position     INT          DEFAULT 0,
        created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id)   REFERENCES developer_projects(id) ON DELETE CASCADE,
        FOREIGN KEY (developer_id) REFERENCES developers(id)         ON DELETE CASCADE
      )
    `);

    // ── developer_storyboard_frames ───────────────────────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS developer_storyboard_frames (
        id            INT PRIMARY KEY AUTO_INCREMENT,
        storyboard_id INT          NOT NULL,
        title         VARCHAR(300) DEFAULT NULL,
        description   TEXT         DEFAULT NULL,
        image_url     VARCHAR(500) DEFAULT NULL,
        thumb_url     VARCHAR(500) DEFAULT NULL,
        bg_color      VARCHAR(20)  DEFAULT '#ffffff',
        position      INT          DEFAULT 0,
        created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (storyboard_id) REFERENCES developer_storyboards(id) ON DELETE CASCADE
      )
    `);

    // ── push_tokens ───────────────────────────────────────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS push_tokens (
        id         INT PRIMARY KEY AUTO_INCREMENT,
        user_id    INT NOT NULL,
        fcm_token  VARCHAR(500) NOT NULL,
        device_id  VARCHAR(200) DEFAULT NULL,
        platform   VARCHAR(20)  DEFAULT NULL,
        created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_token (user_id, fcm_token),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // ── notifications ─────────────────────────────────────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id               INT PRIMARY KEY AUTO_INCREMENT,
        type             ENUM('new_game','custom') DEFAULT 'custom',
        title            VARCHAR(255) NOT NULL,
        body             TEXT         NOT NULL,
        image_url        VARCHAR(500) DEFAULT NULL,
        data_json        TEXT         DEFAULT NULL,
        game_id          INT          DEFAULT NULL,
        sent_by          INT          DEFAULT NULL,
        total_recipients INT          DEFAULT 0,
        sent_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL,
        FOREIGN KEY (sent_by) REFERENCES admins(id) ON DELETE SET NULL
      )
    `);

    // ── user_notification_reads ───────────────────────────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_notification_reads (
        user_id         INT NOT NULL,
        notification_id INT NOT NULL,
        read_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, notification_id),
        FOREIGN KEY (user_id)         REFERENCES users(id)         ON DELETE CASCADE,
        FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE
      )
    `);

    // ── developer_email_verifications ─────────────────────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS developer_email_verifications (
        id          INT PRIMARY KEY AUTO_INCREMENT,
        email       VARCHAR(255) NOT NULL,
        code        VARCHAR(6)   NOT NULL,
        form_data   TEXT         NOT NULL,
        expires_at  DATETIME     NOT NULL,
        created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_email (email)
      )
    `);

    // ── developer_notes: share_status ─────────────────────────────────────────
    await migrateColumn(
      'developer_notes', 'share_status',
      "ENUM('private','pending_review','approved','rejected') DEFAULT 'private'"
    );
    await migrateColumn('developer_notes', 'share_reviewed_by',      'INT DEFAULT NULL');
    await migrateColumn('developer_notes', 'share_reviewed_at',      'DATETIME DEFAULT NULL');
    await migrateColumn('developer_notes', 'share_rejection_reason', 'TEXT DEFAULT NULL');

    // Sync existing is_shared=1 rows that predate share_status
    await db.query(
      `UPDATE developer_notes SET share_status = 'approved'
       WHERE is_shared = 1 AND share_status = 'private'`
    );

    console.log('✅ DB migrations complete');
  } catch (err) {
    console.error('❌ Migration error:', err.message);
  }
};
