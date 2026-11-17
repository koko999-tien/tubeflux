'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('node:path');
const fs = require('node:fs');
const config = require('./config');
const { adminCreated } = require('./db');
const { attachUser } = require('./middleware/auth');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');

const app = express();
app.disable('x-powered-by');

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(attachUser);

// Streams video with HTTP range support so the player can seek.
function mediaStatic(dir) {
  return express.static(dir, {
    acceptRanges: true,
    cacheControl: true,
    maxAge: '7d',
    setHeaders(res, filePath) {
      if (/\.(mp4|webm|mkv|mov|m4v|ogv)$/i.test(filePath)) {
        res.setHeader('Content-Type', contentTypeFor(filePath));
      }
    },
  });
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      '.mp4': 'video/mp4',
      '.m4v': 'video/mp4',
      '.webm': 'video/webm',
      '.mkv': 'video/x-matroska',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.ogv': 'video/ogg',
    }[ext] || 'application/octet-stream'
  );
}

app.use('/media', mediaStatic(config.mediaDir));
app.use('/thumbs', mediaStatic(config.thumbDir));
app.use('/api/admin', adminRoutes);
app.use('/api', apiRoutes);

app.use(
  express.static(path.join(config.root, 'public'), {
    extensions: ['html'],
    setHeaders(res, filePath) {
      if (filePath.endsWith('admin.html')) res.setHeader('X-Robots-Tag', 'noindex');
    },
  }),
);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
  res.status(404).sendFile(path.join(config.root, 'public', '404.html'), (err) => {
    if (err) res.type('text').send('404');
  });
});

// Central error handler — multer size/type errors and everything else land here.
app.use((err, _req, res, _next) => {
  const status = err.status || (err instanceof multerError ? 400 : 500);
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ error: err.message || 'server error' });
});

// multer throws plain Errors with a `code`; detect without importing multer twice.
function multerError(err) {
  return typeof err.code === 'string' && err.code.startsWith('LIMIT_');
}

for (const dir of [config.mediaDir, config.thumbDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const server = app.listen(config.port, config.host, () => {
  const url = `http://localhost:${config.port}`;
  console.log(`\n  ${config.siteName} running at ${url}`);
  console.log(`  admin panel: ${url}/admin.html`);
  if (adminCreated) {
    console.log(`  admin created -> user: ${config.admin.user}  pass: ${config.admin.pass}`);
    console.log('  change it in the admin panel after first login');
  }
  if (config.jwtSecretIsEphemeral) {
    console.log('  [warn] JWT_SECRET not set — sessions reset on restart');
  }
});

function shutdown(sig) {
  console.log(`\n  ${sig} — closing server`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
