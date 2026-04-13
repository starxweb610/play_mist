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
  is_active         TINYINT(1)   DEFAULT 0,
  is_featured       TINYINT(1)   DEFAULT 0,
  created_by        INT,
  created_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES admins(id) ON DELETE SET NULL
);

-- ─── Users (Players) ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  username      VARCHAR(80)  NOT NULL UNIQUE,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255),
  avatar        VARCHAR(500),
  is_active     TINYINT(1)   DEFAULT 1,
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
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
  device     ENUM('android','ios','other') NOT NULL DEFAULT 'other',
  session_id VARCHAR(120),
  event_date DATE        NOT NULL,
  event_time TIME        NOT NULL,
  created_at TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL
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
