'use strict';

const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const config = require('../config');
const { db } = require('../db');

const router = express.Router();

const VIDEO_COLS = `
  v.id, v.title, v.slug, v.description, v.filename, v.thumb, v.duration,
  v.views, v.likes, v.published, v.created_at,
  c.name AS category, c.slug AS category_slug
`;

function tagsFor(videoId) {
  return db
    .prepare(
      `SELECT t.name, t.slug FROM tags t
       JOIN video_tags vt ON vt.tag_id = t.id
       WHERE vt.video_id = ? ORDER BY t.name`,
    )
    .all(videoId);
}

function shape(row, withTags = true) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    duration: row.duration,
    views: row.views,
    likes: row.likes,
    createdAt: row.created_at,
    category: row.category ? { name: row.category, slug: row.category_slug } : null,
    tags: withTags ? tagsFor(row.id).map((t) => t.name) : [],
    videoUrl: `/media/${encodeURIComponent(row.filename)}`,
    thumbUrl: row.thumb ? `/thumbs/${encodeURIComponent(row.thumb)}` : null,
  };
}

// GET /api/videos?page=&limit=&q=&category=&tag=&sort=
router.get('/videos', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 24));
  const offset = (page - 1) * limit;
  const q = (req.query.q || '').trim();
  const category = (req.query.category || '').trim();
  const tag = (req.query.tag || '').trim();
  const sort = ['new', 'top', 'views'].includes(req.query.sort) ? req.query.sort : 'new';

  const where = ['v.published = 1'];
  const params = [];

  if (q) {
    where.push('(v.title LIKE ? OR v.description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (category) {
    where.push('c.slug = ?');
    params.push(category);
  }
  if (tag) {
    where.push(
      'v.id IN (SELECT vt.video_id FROM video_tags vt JOIN tags t ON t.id = vt.tag_id WHERE t.slug = ?)',
    );
    params.push(tag);
  }

  const orderBy =
    sort === 'top' ? 'v.likes DESC, v.views DESC' : sort === 'views' ? 'v.views DESC' : 'v.created_at DESC';

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = db
    .prepare(
      `SELECT COUNT(*) AS n FROM videos v
       LEFT JOIN categories c ON c.id = v.category_id
       ${whereSql}`,
    )
    .get(...params).n;

  const rows = db
    .prepare(
      `SELECT ${VIDEO_COLS} FROM videos v
       LEFT JOIN categories c ON c.id = v.category_id
       ${whereSql}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);

  res.json({
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
    items: rows.map((r) => shape(r)),
  });
});

// GET /api/videos/:slug
router.get('/videos/:slug', (req, res) => {
  const row = db
    .prepare(
      `SELECT ${VIDEO_COLS} FROM videos v
       LEFT JOIN categories c ON c.id = v.category_id
       WHERE v.slug = ? AND v.published = 1`,
    )
    .get(req.params.slug);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(shape(row));
});

// GET /api/videos/:slug/related
router.get('/videos/:slug/related', (req, res) => {
  const current = db
    .prepare('SELECT id, category_id FROM videos WHERE slug = ?')
    .get(req.params.slug);
  if (!current) return res.status(404).json({ error: 'not found' });
  const rows = db
    .prepare(
      `SELECT ${VIDEO_COLS} FROM videos v
       LEFT JOIN categories c ON c.id = v.category_id
       WHERE v.published = 1 AND v.id != ?
       ORDER BY (v.category_id = ?) DESC, RANDOM()
       LIMIT 12`,
    )
    .all(current.id, current.category_id);
  res.json({ items: rows.map((r) => shape(r, false)) });
});

// POST /api/videos/:slug/view
router.post('/videos/:slug/view', (req, res) => {
  const info = db
    .prepare('UPDATE videos SET views = views + 1 WHERE slug = ? AND published = 1')
    .run(req.params.slug);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// POST /api/videos/:slug/like
router.post('/videos/:slug/like', (req, res) => {
  const info = db
    .prepare('UPDATE videos SET likes = likes + 1 WHERE slug = ? AND published = 1')
    .run(req.params.slug);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  const row = db.prepare('SELECT likes FROM videos WHERE slug = ?').get(req.params.slug);
  res.json({ ok: true, likes: row.likes });
});

// GET /api/categories
router.get('/categories', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT c.name, c.slug, COUNT(v.id) AS count
       FROM categories c
       LEFT JOIN videos v ON v.category_id = c.id AND v.published = 1
       GROUP BY c.id
       HAVING count > 0
       ORDER BY count DESC, c.name`,
    )
    .all();
  res.json({ items: rows });
});

// GET /api/tags
router.get('/tags', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT t.name, t.slug, COUNT(vt.video_id) AS count
       FROM tags t
       JOIN video_tags vt ON vt.tag_id = t.id
       JOIN videos v ON v.id = vt.video_id AND v.published = 1
       GROUP BY t.id
       ORDER BY count DESC, t.name
       LIMIT 100`,
    )
    .all();
  res.json({ items: rows });
});

// GET /api/comments/:slug
router.get('/comments/:slug', (req, res) => {
  const video = db.prepare('SELECT id FROM videos WHERE slug = ?').get(req.params.slug);
  if (!video) return res.status(404).json({ error: 'not found' });
  const rows = db
    .prepare(
      'SELECT id, author, body, created_at FROM comments WHERE video_id = ? ORDER BY created_at DESC LIMIT 200',
    )
    .all(video.id);
  res.json({ items: rows });
});

// POST /api/comments/:slug
router.post('/comments/:slug', (req, res) => {
  const video = db.prepare('SELECT id FROM videos WHERE slug = ? AND published = 1').get(req.params.slug);
  if (!video) return res.status(404).json({ error: 'not found' });

  const author = String(req.body.author || 'anon').trim().slice(0, 40) || 'anon';
  const body = String(req.body.body || '').trim().slice(0, 2000);
  if (!body) return res.status(400).json({ error: 'body required' });

  const info = db
    .prepare('INSERT INTO comments (video_id, author, body) VALUES (?, ?, ?)')
    .run(video.id, author, body);
  const row = db
    .prepare('SELECT id, author, body, created_at FROM comments WHERE id = ?')
    .get(info.lastInsertRowid);
  res.status(201).json(row);
});

// GET /api/stats
router.get('/stats', (_req, res) => {
  const videos = db.prepare('SELECT COUNT(*) AS n FROM videos WHERE published = 1').get().n;
  const views = db.prepare('SELECT COALESCE(SUM(views),0) AS n FROM videos').get().n;
  const cats = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
  res.json({ videos, views, categories: cats });
});

// GET /api/health
router.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), site: config.siteName });
});

module.exports = router;
