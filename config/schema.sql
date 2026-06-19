-- Playmist Database Schema (Complete)
-- Fresh install: mysql -u root -p < config/schema.sql
-- Existing DB:   node scripts/sync-db.js

CREATE DATABASE IF NOT EXISTS playmist;
USE playmist;

-- ─── Site Stats (Public Landing Page) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS site_stats (
  id           INT PRIMARY KEY AUTO_INCREMENT,
  total_games  INT          DEFAULT 0,
  total_users  VARCHAR(20)  DEFAULT '0',
  rating       VARCHAR(5)   DEFAULT '5.0',
  updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
INSERT IGNORE INTO site_stats (id, total_games, total_users, rating)
VALUES (1, 0, '0', '5.0');

-- ─── Admin Accounts ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  username      VARCHAR(80)  NOT NULL UNIQUE,
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(255),
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('superadmin','manager','support') DEFAULT 'support',
  is_active     TINYINT(1)   DEFAULT 1,
  last_login    DATETIME     DEFAULT NULL,
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- ─── Games Library ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS games (
  id                INT PRIMARY KEY AUTO_INCREMENT,
  title             VARCHAR(200)  NOT NULL,
  slug              VARCHAR(200)  NOT NULL UNIQUE,
  short_description VARCHAR(200),
  genre             VARCHAR(80),
  type              ENUM('webgl','premium') DEFAULT 'webgl',
  orientation       ENUM('portrait','landscape') DEFAULT 'landscape',
  version           VARCHAR(20)  DEFAULT '1.0.0',
  file_path         VARCHAR(500),
  play_url          VARCHAR(500),
  zip_url           VARCHAR(500),
  long_description  TEXT,
  trailer_url       VARCHAR(500),
  thumbnail_url     VARCHAR(500),
  secondary_thumbnail   VARCHAR(500) DEFAULT NULL,
  promotional_thumbnail VARCHAR(500) DEFAULT NULL,
  studio            VARCHAR(200)  DEFAULT 'Tiny Bear',
  size              VARCHAR(20)   DEFAULT '24MB',
  plays             VARCHAR(20)   DEFAULT '1.2M',
  rating            VARCHAR(10)   DEFAULT '4.8',
  credits_cost      INT           DEFAULT 10,
  flag              VARCHAR(50)   DEFAULT NULL,
  is_active         TINYINT(1)   DEFAULT 0,
  is_featured       TINYINT(1)   DEFAULT 0,
  created_by        INT,
  created_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES admins(id) ON DELETE SET NULL
);

-- ─── Users (Players) ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                INT PRIMARY KEY AUTO_INCREMENT,
  username          VARCHAR(80)  NOT NULL UNIQUE,
  email             VARCHAR(255) NOT NULL UNIQUE,
  password_hash     VARCHAR(255),
  avatar            VARCHAR(500),
  credits           INT          DEFAULT 1000,
  xp                INT          DEFAULT 0,
  level             INT          DEFAULT 1,
  current_streak    INT          DEFAULT 0,
  longest_streak    INT          DEFAULT 0,
  last_streak_date  DATE         DEFAULT NULL,
  is_active         TINYINT(1)   DEFAULT 1,
  created_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- ─── Support Tickets ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  user_id     INT,
  subject     VARCHAR(255) NOT NULL,
  message     TEXT         NOT NULL,
  status      ENUM('open','in_progress','resolved','closed') DEFAULT 'open',
  priority    ENUM('low','medium','high','urgent')           DEFAULT 'medium',
  assigned_to INT,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)     REFERENCES users(id)  ON DELETE SET NULL,
  FOREIGN KEY (assigned_to) REFERENCES admins(id) ON DELETE SET NULL
);

-- ─── Ticket Replies ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_replies (
  id         INT PRIMARY KEY AUTO_INCREMENT,
  ticket_id  INT NOT NULL,
  admin_id   INT,
  message    TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_id)  REFERENCES admins(id)  ON DELETE SET NULL
);

-- ─── App Analytics (Mobile → Server) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics_app (
  id         INT PRIMARY KEY AUTO_INCREMENT,
  device     ENUM('android','ios','other') NOT NULL DEFAULT 'other',
  session_id VARCHAR(120),
  event_date DATE        NOT NULL,
  event_time TIME        NOT NULL,
  created_at TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
);

-- ─── Game Analytics (Mobile → Server) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics_games (
  id         INT PRIMARY KEY AUTO_INCREMENT,
  game_id    INT,
  user_id    INT DEFAULT NULL,
  device     ENUM('android','ios','other') NOT NULL DEFAULT 'other',
  session_id VARCHAR(120),
  event_date DATE        NOT NULL,
  event_time TIME        NOT NULL,
  created_at TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ─── Feedbacks (In-App Feedback System) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS feedbacks (
  id         INT PRIMARY KEY AUTO_INCREMENT,
  user_id    INT,
  rating     TINYINT UNSIGNED,
  message    TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ─── Newsletter Signups ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS newsletter_signups (
  id           INT PRIMARY KEY AUTO_INCREMENT,
  email        VARCHAR(255) NOT NULL UNIQUE,
  signed_up_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- ─── Genres ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS genres (
  id   INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(80) NOT NULL UNIQUE
);

INSERT IGNORE INTO genres (name) VALUES
('Action'), ('Adventure'), ('Arcade'), ('Casual'), ('Puzzle'),
('Racing'), ('RPG'), ('Shooter'), ('Simulation'), ('Sports'),
('Strategy'), ('Tower Defense'), ('Other');

-- ─── Tags ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tags (
  id   INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(80) NOT NULL UNIQUE
);

-- ─── Game Tags Junction ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_tags (
  game_id INT NOT NULL,
  tag_id  INT NOT NULL,
  PRIMARY KEY (game_id, tag_id),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id)  REFERENCES tags(id) ON DELETE CASCADE
);

-- ─── Game Screenshots ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_screenshots (
  id        INT PRIMARY KEY AUTO_INCREMENT,
  game_id   INT NOT NULL,
  image_url VARCHAR(500) NOT NULL,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

-- ─── Credit Transactions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_transactions (
  id                 INT PRIMARY KEY AUTO_INCREMENT,
  user_id            INT NOT NULL,
  game_id            INT DEFAULT NULL,
  credits_used       INT NOT NULL,
  ad_transaction_id  VARCHAR(255) DEFAULT NULL UNIQUE,
  source             ENUM('game','ad','streak','achievement','challenge','welcome','other') DEFAULT 'game',
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL
);

-- ─── Daily Picks (Free Game of the Day) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_picks (
  id         INT PRIMARY KEY AUTO_INCREMENT,
  game_id    INT NOT NULL,
  pick_date  DATE NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

-- ─── Achievements (Definitions) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS achievements (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  key_name       VARCHAR(80)  NOT NULL UNIQUE,
  name           VARCHAR(120) NOT NULL,
  description    TEXT,
  xp_reward      INT          DEFAULT 0,
  credits_reward INT          DEFAULT 0,
  created_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO achievements (key_name, name, description, xp_reward, credits_reward) VALUES
('first_game',      'Into the Mist',        'Play your first game',                        100, 50),
('games_5',         'Getting Warm',          'Play 5 different games',                      150, 75),
('games_25',        'Mist Walker',           'Play 25 games',                               300, 150),
('streak_3',        'On a Roll',             'Maintain a 3-day login streak',               100, 50),
('streak_7',        'Week of Mist',          'Maintain a 7-day login streak',               250, 150),
('streak_30',       'Mist Devotee',          'Maintain a 30-day login streak',              500, 500),
('first_premium',   'Premium Taste',         'Play a premium game for the first time',      200, 100),
('daily_pick',      'Today\'s Pick',         'Play the daily free game',                    50,  25),
('challenge_first', 'Challenge Accepted',    'Complete your first daily challenge',         100, 50),
('challenge_7',     'Challenger',            'Complete 7 daily challenges',                 300, 200);

-- ─── User Achievements ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_achievements (
  user_id        INT NOT NULL,
  achievement_id INT NOT NULL,
  earned_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, achievement_id),
  FOREIGN KEY (user_id)        REFERENCES users(id)        ON DELETE CASCADE,
  FOREIGN KEY (achievement_id) REFERENCES achievements(id) ON DELETE CASCADE
);

-- ─── Daily Challenges ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_challenges (
  id                INT PRIMARY KEY AUTO_INCREMENT,
  challenge_date    DATE         NOT NULL UNIQUE,
  description       VARCHAR(255) NOT NULL,
  requirement_type  ENUM('play_count','play_mini','play_premium') NOT NULL,
  requirement_value INT          DEFAULT 1,
  credits_reward    INT          DEFAULT 150,
  xp_reward         INT          DEFAULT 75,
  created_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- ─── User Challenge Completions ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_challenge_completions (
  user_id      INT NOT NULL,
  challenge_id INT NOT NULL,
  completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, challenge_id),
  FOREIGN KEY (user_id)      REFERENCES users(id)             ON DELETE CASCADE,
  FOREIGN KEY (challenge_id) REFERENCES daily_challenges(id)  ON DELETE CASCADE
);

-- ─── Developers (External Game Developers) ───────────────────────────────────
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
);

-- ─── Developer Submissions ────────────────────────────────────────────────────
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
  preview_play_url VARCHAR(600) DEFAULT NULL,
  status           ENUM('draft','pending','under_review','approved','rejected') DEFAULT 'draft',
  rejection_reason TEXT         DEFAULT NULL,
  reviewed_by      INT          DEFAULT NULL,
  reviewed_at      DATETIME     DEFAULT NULL,
  game_id          INT          DEFAULT NULL,
  created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (developer_id) REFERENCES developers(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by)  REFERENCES admins(id)     ON DELETE SET NULL,
  FOREIGN KEY (game_id)      REFERENCES games(id)      ON DELETE SET NULL
);

-- ─── Site Content (Rich Text Pages) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS site_content (
  key_name   VARCHAR(100) PRIMARY KEY,
  content    LONGTEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
INSERT IGNORE INTO site_content (key_name, content) VALUES
('submission_guidelines', '<h2>Submission Guidelines</h2><p>Welcome to the PlayMist Developer Portal. Please read the guidelines below before submitting your game.</p>');
