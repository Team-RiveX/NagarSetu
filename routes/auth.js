const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { OFFICER_KEY } = require('../utils/helpers');
const router = express.Router();

// Simulated OTP — every request gets the same demo code. Swap this file's
// otp/request handler for a real SMS provider (Twilio, MSG91, etc.) to go live.
const DEMO_OTP = '1234';

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

router.post('/otp/request', (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (phone.length !== 10) return res.status(400).json({ error: 'Enter a valid 10-digit phone number' });
  db.prepare(`INSERT INTO otps (phone, code, created_at) VALUES (?, ?, datetime('now'))
              ON CONFLICT(phone) DO UPDATE SET code = excluded.code, created_at = datetime('now')`)
    .run(phone, DEMO_OTP);
  res.json({ ok: true, message: 'OTP sent (simulated)', demoCode: DEMO_OTP });
});

router.post('/otp/verify', (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const code = String(req.body.code || '');
  const row = db.prepare('SELECT * FROM otps WHERE phone = ?').get(phone);
  if (!row || row.code !== code) return res.status(400).json({ error: 'Invalid or expired code' });

  db.prepare(`INSERT INTO users (phone, verified) VALUES (?, 0)
              ON CONFLICT(phone) DO NOTHING`).run(phone);

  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, phone) VALUES (?, ?)').run(token, phone);
  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  res.json({ ok: true, token, phone, verified: !!user.verified });
});

router.post('/verify-identity', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  // Stand-in for a real Aadhaar/phone verification provider.
  db.prepare('UPDATE users SET verified = 1 WHERE phone = ?').run(session.phone);
  res.json({ ok: true, verified: true });
});

router.get('/me', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(session.phone);
  res.json({ phone: session.phone, verified: !!(user && user.verified) });
});

router.post('/logout', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.json({ ok: true });
});

// Officer sign-in: validates the officer key server-side before the frontend
// grants access to the dashboard. Officer actions elsewhere are still
// independently protected by the same key on every request — this endpoint
// just gives the UI a real "sign in" step instead of silently trusting a
// hardcoded default.
router.post('/officer-login', (req, res) => {
  const key = String(req.body.key || '');
  if (!key || key !== OFFICER_KEY) {
    return res.status(401).json({ error: 'Incorrect officer key' });
  }
  res.json({ ok: true });
});

module.exports = router;
