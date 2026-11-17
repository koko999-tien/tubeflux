'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

const COOKIE = 'tf_session';

function sign(user) {
  return jwt.sign({ uid: user.id, username: user.username }, config.jwtSecret, {
    expiresIn: '7d',
  });
}

function setSession(res, user) {
  res.cookie(COOKIE, sign(user), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 3600 * 1000,
  });
}

function clearSession(res) {
  res.clearCookie(COOKIE);
}

// Reads the session cookie and attaches req.user. Never rejects on its own —
// routes decide whether auth is required.
function attachUser(req, _res, next) {
  req.user = null;
  const token = req.cookies && req.cookies[COOKIE];
  if (token) {
    try {
      req.user = jwt.verify(token, config.jwtSecret);
    } catch {
      req.user = null;
    }
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'auth required' });
  next();
}

module.exports = { COOKIE, sign, setSession, clearSession, attachUser, requireAdmin };
