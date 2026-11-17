'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config();

const root = __dirname;
const resolve = (p) => (path.isAbsolute(p) ? p : path.join(root, p));

const config = {
  root,
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  siteName: process.env.SITE_NAME || 'Tubeflux',

  dataDir: resolve(process.env.DATA_DIR || './data'),
  mediaDir: resolve(process.env.MEDIA_DIR || './media'),
  thumbDir: resolve(process.env.THUMB_DIR || './thumbs'),

  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 4096) * 1024 * 1024,

  admin: {
    user: process.env.ADMIN_USER || 'admin',
    pass: process.env.ADMIN_PASS || 'changeme123',
  },

  // A random secret is generated when none is supplied. Sessions then die on
  // restart, which is fine for local use and loudly wrong for production.
  jwtSecret:
    process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16
      ? process.env.JWT_SECRET
      : crypto.randomBytes(32).toString('hex'),

  jwtSecretIsEphemeral: !(process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16),
};

module.exports = config;
