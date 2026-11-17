'use strict';

const express = require('express');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { db, slugify, uniqueSlug } = require('../db');
const { setSession, clearSession, requireAdmin } = require('../middleware/auth');
const media = require('../lib/media');

const router = express.Router();

const VIDEO_EXT = new Set(['.mp4', '.webm', '.mkv', '.mov', '.m4v', '.avi', '.ogv']);
const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const storage = multer.diskStorage({
  destination(_req, file, cb) {
    cb(null, file.fieldname === 'thumb' ? config.thumbDir : config.mediaDir);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const ok = file.fieldname === 'thumb' ? IMG_EXT.has(ext) : VIDEO_EXT.has(ext);
    if (!ok) return cb(new Error(`unsupported extension: ${ext || '(none)'}`));
    cb(null, true);
  },
});

// ---- auth ----

router.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'invalid credentials' });
  }
  setSession(res, user);
  res.json({ ok: true, username: user.username });
});

router.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get('/me', requireAdmin, (req, res) => {
  res.json({ username: req.user.username });
});

router.post('/password', requireAdmin, (req, res) => {
  const current = String(req.body.current || '');
  const next = String(req.body.next || '');
  if (next.length < 8) return res.status(400).json({ error: 'password must be >= 8 chars' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.uid);
  if (!user || !bcrypt.compareSync(current, user.password_hash)) {
    return res.status(401).json({ error: 'current password wrong' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, 12), user.id);
  res.json({ ok: true });
});

// ---- videos ----

function syncTags(videoId, tagNames) {
  db.prepare('DELETE FROM video_tags WHERE video_id = ?').run(videoId);
  const names = [...new Set(
    String(tagNames || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 30),
  )];
  const insTag = db.prepare('INSERT OR IGNORE INTO tags (name, slug) VALUES (?, ?)');
  const getTag = db.prepare('SELECT id FROM tags WHERE slug = ?');
  const link = db.prepare('INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES (?, ?)');
  for (const name of names) {
    const slug = slugify(name);
    insTag.run(name, slug);
    const tag = getTag.get(slug);
    if (tag) link.run(videoId, tag.id);
  }
}

router.get('/videos', requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT v.id, v.title, v.slug, v.filename, v.thumb, v.duration, v.views, v.likes,
              v.published, v.created_at, c.name AS category
       FROM videos v LEFT JOIN categories c ON c.id = v.category_id
       ORDER BY v.created_at DESC LIMIT 500`,
    )
    .all();
  res.json({ items: rows });
});

router.post(
  '/videos',
  requireAdmin,
  upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]),
  async (req, res, next) => {
    try {
      const videoFile = req.files && req.files.video && req.files.video[0];
      if (!videoFile) return res.status(400).json({ error: 'video file required' });
      const thumbFile = req.files && req.files.thumb && req.files.thumb[0];

      const title = String(req.body.title || path.parse(videoFile.originalname).name).trim().slice(0, 200);
      const description = String(req.body.description || '').trim().slice(0, 5000);
      const categoryName = String(req.body.category || '').trim();

      let categoryId = null;
      if (categoryName) {
        const slug = slugify(categoryName);
        db.prepare('INSERT OR IGNORE INTO categories (name, slug) VALUES (?, ?)').run(categoryName, slug);
        categoryId = db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug).id;
      }

      let duration = await media.probeDuration(videoFile.path);
      let thumbName = thumbFile ? thumbFile.filename : null;

      if (!thumbName && media.hasFfmpeg()) {
        const out = path.join(config.thumbDir, `${path.parse(videoFile.filename).name}.jpg`);
        const at = duration > 10 ? Math.min(10, duration / 3) : 1;
        if (await media.generateThumb(videoFile.path, out, at)) {
          thumbName = path.basename(out);
        }
      }

      const slug = uniqueSlug(title, 'videos');
      const info = db
        .prepare(
          `INSERT INTO videos (title, slug, description, filename, thumb, duration, category_id, published)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(title, slug, description, videoFile.filename, thumbName, duration || 0, categoryId,
             req.body.published === '0' ? 0 : 1);

      syncTags(info.lastInsertRowid, req.body.tags);
      res.status(201).json({ ok: true, id: info.lastInsertRowid, slug });
    } catch (err) {
      next(err);
    }
  },
);

router.put('/videos/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
  if (!video) return res.status(404).json({ error: 'not found' });

  const title = req.body.title !== undefined ? String(req.body.title).trim().slice(0, 200) : video.title;
  const description =
    req.body.description !== undefined ? String(req.body.description).trim().slice(0, 5000) : video.description;
  const published = req.body.published !== undefined ? (req.body.published ? 1 : 0) : video.published;

  let categoryId = video.category_id;
  if (req.body.category !== undefined) {
    const categoryName = String(req.body.category).trim();
    if (!categoryName) {
      categoryId = null;
    } else {
      const slug = slugify(categoryName);
      db.prepare('INSERT OR IGNORE INTO categories (name, slug) VALUES (?, ?)').run(categoryName, slug);
      categoryId = db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug).id;
    }
  }

  db.prepare(
    'UPDATE videos SET title = ?, description = ?, published = ?, category_id = ? WHERE id = ?',
  ).run(title, description, published, categoryId, id);

  if (req.body.tags !== undefined) syncTags(id, req.body.tags);
  res.json({ ok: true });
});

router.delete('/videos/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
  if (!video) return res.status(404).json({ error: 'not found' });

  db.prepare('DELETE FROM videos WHERE id = ?').run(id);

  const rm = (dir, name) => {
    if (!name) return;
    const p = path.join(dir, name);
    if (path.dirname(p) !== dir) return; // refuse traversal
    fs.rm(p, { force: true }, () => {});
  };
  rm(config.mediaDir, video.filename);
  rm(config.thumbDir, video.thumb);

  res.json({ ok: true });
});

// ---- categories ----

router.get('/categories', requireAdmin, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.slug, COUNT(v.id) AS count
       FROM categories c LEFT JOIN videos v ON v.category_id = c.id
       GROUP BY c.id ORDER BY c.name`,
    )
    .all();
  res.json({ items: rows });
});

router.post('/categories', requireAdmin, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'name required' });
  const slug = slugify(name);
  db.prepare('INSERT OR IGNORE INTO categories (name, slug) VALUES (?, ?)').run(name, slug);
  res.status(201).json({ ok: true, name, slug });
});

router.delete('/categories/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---- comments ----

router.delete('/comments/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM comments WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---- stats ----

router.get('/stats', requireAdmin, (_req, res) => {
  const videos = db.prepare('SELECT COUNT(*) AS n FROM videos').get().n;
  const published = db.prepare('SELECT COUNT(*) AS n FROM videos WHERE published = 1').get().n;
  const views = db.prepare('SELECT COALESCE(SUM(views),0) AS n FROM videos').get().n;
  const likes = db.prepare('SELECT COALESCE(SUM(likes),0) AS n FROM videos').get().n;
  const comments = db.prepare('SELECT COUNT(*) AS n FROM comments').get().n;
  const categories = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
  res.json({ videos, published, views, likes, comments, categories, ffmpeg: media.hasFfmpeg() });
});

module.exports = router;
