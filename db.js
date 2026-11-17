'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const config = require('./config');

for (const dir of [config.dataDir, config.mediaDir, config.thumbDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new DatabaseSync(path.join(config.dataDir, 'tubeflux.db'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS videos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  description  TEXT NOT NULL DEFAULT '',
  filename     TEXT NOT NULL,
  thumb        TEXT,
  duration     REAL NOT NULL DEFAULT 0,
  views        INTEGER NOT NULL DEFAULT 0,
  likes        INTEGER NOT NULL DEFAULT 0,
  category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  published    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS video_tags (
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (video_id, tag_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id   INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  author     TEXT NOT NULL DEFAULT 'anon',
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_videos_cat    ON videos(category_id);
CREATE INDEX IF NOT EXISTS idx_videos_pub    ON videos(published, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_tags_t  ON video_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_comments_vid  ON comments(video_id, created_at DESC);
`);

function ensureAdmin() {
  const row = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (row.n > 0) return false;
  const hash = bcrypt.hashSync(config.admin.pass, 12);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(
    config.admin.user,
    hash,
  );
  return true;
}

const DEFAULT_CATEGORIES = [
  'Amateur', 'Anal', 'Asian', 'BBW', 'BDSM', 'Big Tits', 'Blonde', 'Brunette',
  'Cosplay', 'Creampie', 'Ebony', 'Fetish', 'Gangbang', 'Group', 'Hardcore',
  'Latina', 'Lesbian', 'MILF', 'Massage', 'Oral', 'POV', 'Redhead', 'Squirt',
  'Teen (18+)', 'Threesome', 'Vintage', 'Webcam',
];

function seedCategories() {
  const ins = db.prepare('INSERT OR IGNORE INTO categories (name, slug) VALUES (?, ?)');
  for (const name of DEFAULT_CATEGORIES) ins.run(name, slugify(name));
}

function slugify(input) {
  return String(input)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

function uniqueSlug(base, table = 'videos') {
  let slug = slugify(base);
  const check = db.prepare(`SELECT 1 FROM ${table} WHERE slug = ?`);
  if (!check.get(slug)) return slug;
  for (let i = 2; i < 10000; i++) {
    const candidate = `${slug}-${i}`;
    if (!check.get(candidate)) return candidate;
  }
  return `${slug}-${Date.now()}`;
}

const created = ensureAdmin();
seedCategories();

module.exports = { db, slugify, uniqueSlug, adminCreated: created };
