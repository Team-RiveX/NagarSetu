const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const upload = require('../utils/upload');
const ledger = require('../utils/ledger');
const {
  CATEGORIES, catDept, serializeSummary, serializeFull, AUTO_RESOLVE_DAYS, REOPEN_WINDOW_DAYS, OFFICER_KEY, haversineKm,
} = require('../utils/helpers');

const router = express.Router();
const OFFICER_NAME = 'Anita Sharma';
const OFFICER_ROLE = 'Supervisor';

/* ---------- auth helpers ---------- */
function attachUser(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (token) {
    const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (session) req.phone = session.phone;
  }
  next();
}
function requireAuth(req, res, next) {
  if (!req.phone) return res.status(401).json({ error: 'Sign in required' });
  next();
}
function requireOfficer(req, res, next) {
  if ((req.headers['x-officer-key'] || '') !== OFFICER_KEY) {
    return res.status(403).json({ error: 'Officer access required' });
  }
  next();
}
router.use(attachUser);

function getRow(id) { return db.prepare('SELECT * FROM complaints WHERE id = ?').get(id); }
function addHistory(id, entry) {
  // Every history write goes through the tamper-evident hash chain instead
  // of a plain INSERT — see utils/ledger.js.
  ledger.appendEntry({
    complaint_id: id, label: entry.label, who: entry.who, role: entry.role,
    path: entry.path, note: entry.note, icon: entry.icon,
  });
}
function touch(id) { db.prepare(`UPDATE complaints SET updated_at = datetime('now') WHERE id = ?`).run(id); }

/* ---------- meta ---------- */
router.get('/meta/categories', (req, res) => res.json(CATEGORIES));


/* ---------- list ---------- */
router.get('/', (req, res) => {
  let rows = db.prepare('SELECT * FROM complaints ORDER BY created_at DESC').all();
  const { status, area, priority, category, search, needsReview, mine } = req.query;

  if (mine === 'true' && req.phone) rows = rows.filter(c => c.owner_phone === req.phone);
  if (status === 'open') rows = rows.filter(c => c.status !== 'resolved');
  if (status === 'resolved') rows = rows.filter(c => c.status === 'resolved');
  if (area) rows = rows.filter(c => (c.location_text || '').toLowerCase().includes(area.toLowerCase()));
  if (priority) { const list = priority.split(','); rows = rows.filter(c => list.includes(c.priority)); }
  if (category) { const list = category.split(','); rows = rows.filter(c => list.includes(c.category)); }
  if (needsReview === 'true') rows = rows.filter(c => c.priority_under_review);
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(c => c.title.toLowerCase().includes(q) || c.category.toLowerCase().includes(q) || (c.location_text || '').toLowerCase().includes(q));
  }
  res.json(rows.map(c => serializeSummary(c, req.phone)));
});

router.get('/stats', (req, res) => {
  const rows = db.prepare('SELECT status, priority_under_review FROM complaints').all();
  res.json({
    open: rows.filter(r => r.status !== 'resolved').length,
    resolved: rows.filter(r => r.status === 'resolved').length,
    needsReview: rows.filter(r => r.priority_under_review).length,
  });
});

/* ---------- near me (citizen dashboard) ---------- */
router.get('/nearby', (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
  const rows = db.prepare('SELECT * FROM complaints').all();
  const withDistance = rows
    .map(c => {
      const cLat = parseFloat(c.lat);
      const cLng = parseFloat(c.lng);
      const hasCoords = !Number.isNaN(cLat) && !Number.isNaN(cLng);
      const distanceKm = hasCoords ? haversineKm(lat, lng, cLat, cLng) : null;
      return { row: c, distanceKm };
    })
    .filter(x => x.distanceKm !== null)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);

  res.json(withDistance.map(x => ({
    ...serializeSummary(x.row, req.phone),
    distanceKm: Math.round(x.distanceKm * 10) / 10,
  })));
});

/* ---------- similar (for duplicate-prevention in the submit form) ---------- */
router.get('/similar', (req, res) => {
  const { category } = req.query;
  if (!category) return res.json([]);
  const rows = db.prepare(`SELECT * FROM complaints WHERE category = ? AND status != 'resolved' ORDER BY created_at DESC LIMIT 3`).all(category);
  res.json(rows.map(c => serializeSummary(c, req.phone)));
});

/* ---------- detail ---------- */
router.get('/:id', (req, res) => {
  const c = getRow(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json(serializeFull(c, req.phone));
});

/* ---------- create ---------- */
router.post('/', upload.array('images', 4), (req, res) => {
  const b = req.body;
  const anonymous = b.anonymous === 'true';
  const privateIdentity = b.private === 'true';
  const title = (b.title || '').trim();
  const category = b.category;
  const description = (b.description || '').trim();
  const priority = ['Low', 'Medium', 'High'].includes(b.priority) ? b.priority : 'Medium';

  if (!title) return res.status(400).json({ error: 'Title is required' });
  if (!CATEGORIES.some(c => c.id === category)) return res.status(400).json({ error: 'Valid category is required' });
  if (!description) return res.status(400).json({ error: 'Description is required' });
  if (!anonymous && !req.phone) return res.status(401).json({ error: 'Sign in required (or submit anonymously)' });

  const id = 'c' + crypto.randomBytes(5).toString('hex');
  const locationText = b.lat && b.lng ? `Lat ${b.lat}, Lng ${b.lng}` : (b.locationText || 'Location not set');
  const ownerPhone = anonymous ? null : req.phone;
  const contactPhone = anonymous ? (b.phone || null) : req.phone;

  db.prepare(`INSERT INTO complaints
    (id, title, category, description, location_text, lat, lng, owner_phone, contact_phone,
     anonymous, private_identity, status, priority, priority_under_review, priority_marked_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, title, category, description, locationText, b.lat || null, b.lng || null, ownerPhone, contactPhone,
      anonymous ? 1 : 0, privateIdentity ? 1 : 0, 'open', priority, priority === 'High' ? 1 : 0,
      priority === 'High' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null);

  (req.files || []).forEach(f => {
    db.prepare('INSERT INTO complaint_images (complaint_id, kind, url) VALUES (?, ?, ?)').run(id, 'problem', `/uploads/${f.filename}`);
  });
  let pastReports = [];
  try { pastReports = JSON.parse(b.pastReports || '[]'); } catch (e) { pastReports = []; }
  pastReports.forEach(r => { if (r && r.trim()) db.prepare('INSERT INTO past_reports (complaint_id, reference) VALUES (?, ?)').run(id, r.trim()); });

  addHistory(id, { label: 'Complaint first opened', icon: 'checkCircle' });

  res.status(201).json(serializeFull(getRow(id), req.phone));
});

/* ---------- edit (owner only; recorded) ---------- */
router.patch('/:id', requireAuth, (req, res) => {
  const c = getRow(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (c.owner_phone !== req.phone) return res.status(403).json({ error: 'Only the original submitter can edit this' });

  const changed = [];
  const b = req.body;
  if (b.title !== undefined && b.title.trim() && b.title.trim() !== c.title) { changed.push('title'); }
  if (b.category !== undefined && b.category !== c.category) { changed.push('category'); }
  if (b.description !== undefined && b.description.trim() && b.description.trim() !== c.description) { changed.push('description'); }

  db.prepare(`UPDATE complaints SET title=?, category=?, description=?, private_identity=?, updated_at=datetime('now') WHERE id=?`)
    .run(b.title !== undefined && b.title.trim() ? b.title.trim() : c.title,
      b.category !== undefined ? b.category : c.category,
      b.description !== undefined && b.description.trim() ? b.description.trim() : c.description,
      b.private !== undefined ? (b.private === 'true' || b.private === true ? 1 : 0) : c.private_identity,
      c.id);

  addHistory(c.id, { label: 'Citizen edited the complaint', note: changed.length ? `Updated: ${changed.join(', ')}.` : 'Minor edit made.', icon: 'edit' });
  res.json(serializeFull(getRow(c.id), req.phone));
});

/* ---------- votes ---------- */
router.post('/:id/upvote', requireAuth, (req, res) => {
  const c = getRow(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const existing = db.prepare(`SELECT 1 FROM complaint_votes WHERE complaint_id=? AND phone=? AND kind='upvote'`).get(c.id, req.phone);
  if (existing) return res.status(409).json({ error: 'Already upvoted' });
  db.prepare(`INSERT INTO complaint_votes (complaint_id, phone, kind) VALUES (?, ?, 'upvote')`).run(c.id, req.phone);
  db.prepare('UPDATE complaints SET upvotes = upvotes + 1 WHERE id = ?').run(c.id);
  res.json(serializeFull(getRow(c.id), req.phone));
});

router.post('/:id/verify', requireAuth, (req, res) => {
  const c = getRow(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const existing = db.prepare(`SELECT 1 FROM complaint_votes WHERE complaint_id=? AND phone=? AND kind='verify'`).get(c.id, req.phone);
  if (existing) return res.status(409).json({ error: 'Already verified' });
  db.prepare(`INSERT INTO complaint_votes (complaint_id, phone, kind) VALUES (?, ?, 'verify')`).run(c.id, req.phone);
  db.prepare('UPDATE complaints SET verified_count = verified_count + 1 WHERE id = ?').run(c.id);
  res.json(serializeFull(getRow(c.id), req.phone));
});

/* ---------- chat (officer must speak first) ---------- */
router.post('/:id/chat', (req, res) => {
  const c = getRow(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const role = req.body.role === 'officer' ? 'officer' : 'citizen';
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Message is empty' });

  if (role === 'officer') {
    if ((req.headers['x-officer-key'] || '') !== OFFICER_KEY) return res.status(403).json({ error: 'Officer access required' });
    db.prepare(`INSERT INTO chat_messages (complaint_id, from_role, name, text) VALUES (?, 'officer', ?, ?)`).run(c.id, OFFICER_NAME, text);
  } else {
    if (!req.phone) return res.status(401).json({ error: 'Sign in required' });
    const officerStarted = db.prepare(`SELECT 1 FROM chat_messages WHERE complaint_id=? AND from_role='officer'`).get(c.id);
    if (!officerStarted) return res.status(403).json({ error: "The officer hasn't started this chat yet" });
    const name = c.private_identity ? 'Resident (private)' : `Citizen •••${req.phone.slice(-4)}`;
    db.prepare(`INSERT INTO chat_messages (complaint_id, from_role, name, text) VALUES (?, 'citizen', ?, ?)`).run(c.id, name, text);
  }
  res.json(serializeFull(getRow(c.id), req.phone));
});

/* ---------- resolution workflow ---------- */
router.post('/:id/resolution-proof', requireOfficer, upload.array('images', 4), (req, res) => {
  const c = getRow(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (c.status === 'resolved') return res.status(400).json({ error: 'Already resolved' });
  const note = (req.body.note || '').trim();
  const imgs = req.files || [];
  if (!note && imgs.length === 0) return res.status(400).json({ error: 'Add a note or photo as proof' });

  imgs.forEach(f => db.prepare('INSERT INTO complaint_images (complaint_id, kind, url) VALUES (?, ?, ?)').run(c.id, 'resolution_proof', `/uploads/${f.filename}`));
  db.prepare(`UPDATE complaints SET status='resolution_submitted', resolution_note=?, resolution_submitted_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
    .run(note || 'Marked resolved by officer.', c.id);
  addHistory(c.id, { label: 'Resolution submitted', who: OFFICER_NAME, role: OFFICER_ROLE, note: note || 'Marked resolved by officer.', icon: 'image' });
  res.json(serializeFull(getRow(c.id), req.phone));
});

router.post('/:id/confirm', requireAuth, upload.array('images', 3), (req, res) => {
  const c = getRow(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (c.owner_phone && c.owner_phone !== req.phone) return res.status(403).json({ error: 'Only the submitter can confirm this' });
  if (c.status !== 'resolution_submitted') return res.status(400).json({ error: 'Nothing pending confirmation' });
  const rating = parseInt(req.body.rating, 10);
  if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ error: 'A rating from 1 to 5 is required' });
  const suggestion = (req.body.suggestion || '').trim();

  (req.files || []).forEach(f => db.prepare('INSERT INTO complaint_images (complaint_id, kind, url) VALUES (?, ?, ?)').run(c.id, 'confirm_proof', `/uploads/${f.filename}`));
  db.prepare(`UPDATE complaints SET status='resolved', resolved_verified=1, resolved_at=datetime('now'),
              rating=?, suggestion=?, reopen_window_open=1, updated_at=datetime('now') WHERE id=?`)
    .run(rating, suggestion, c.id);
  addHistory(c.id, { label: 'Resolution confirmed by citizen', note: `Rated ${rating}/5.${suggestion ? ' ' + suggestion : ''}`, icon: 'checkCircle' });
  res.json(serializeFull(getRow(c.id), req.phone));
});

router.post('/:id/reopen', requireAuth, (req, res) => {
  const c = getRow(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (c.owner_phone && c.owner_phone !== req.phone) return res.status(403).json({ error: 'Only the submitter can reopen this' });
  const reason = (req.body.reason || '').trim();

  if (c.status === 'resolution_submitted') {
    db.prepare(`UPDATE complaints SET status='in_progress', updated_at=datetime('now') WHERE id=?`).run(c.id);
    addHistory(c.id, { label: 'Reopened by citizen', note: reason || 'Citizen indicated the issue is not actually resolved.', icon: 'refresh' });
  } else if (c.status === 'resolved') {
    if (!c.reopen_window_open) return res.status(400).json({ error: 'Reopen window has closed for this complaint' });
    if (c.reopened) return res.status(400).json({ error: 'This complaint has already been reopened once' });
    db.prepare(`UPDATE complaints SET status='in_progress', reopened=1, updated_at=datetime('now') WHERE id=?`).run(c.id);
    addHistory(c.id, { label: 'Reopened by citizen', note: reason || 'Citizen reopened this resolved complaint within the allowed window.', icon: 'refresh' });
  } else {
    return res.status(400).json({ error: 'This complaint is not resolved' });
  }
  res.json(serializeFull(getRow(c.id), req.phone));
});

router.post('/:id/escalate', requireAuth, (req, res) => {
  const c = getRow(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (c.resolved_verified !== 0) return res.status(400).json({ error: 'Escalation is only for unverified auto-resolutions' });
  addHistory(c.id, { label: 'Escalated to senior officer', note: "Citizen escalated this unverified auto-resolution — the officer's inaction is on record.", icon: 'alertTriangle' });
  res.json(serializeFull(getRow(c.id), req.phone));
});

/* ---------- dev helper: force the auto-resolve timeout instead of waiting AUTO_RESOLVE_DAYS ---------- */
router.post('/:id/simulate-timeout', (req, res) => {
  const c = getRow(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (c.status !== 'resolution_submitted') return res.status(400).json({ error: 'Nothing pending confirmation' });
  db.prepare(`UPDATE complaints SET status='resolved', resolved_verified=0, resolved_at=datetime('now'), reopen_window_open=1, updated_at=datetime('now') WHERE id=?`).run(c.id);
  addHistory(c.id, { label: 'Auto-resolved — no citizen response', note: `No confirmation was received within ${AUTO_RESOLVE_DAYS} day(s), so this was closed automatically.`, icon: 'clock' });
  res.json(serializeFull(getRow(c.id), req.phone));
});

/* ---------- officer controls ---------- */
router.post('/:id/status', requireOfficer, (req, res) => {
  const c = getRow(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const status = req.body.status;
  if (!['open', 'in_progress', 'resolved'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (status === 'resolved') {
    db.prepare(`UPDATE complaints SET status=?, resolved_verified=1, resolved_at=datetime('now'), reopen_window_open=1, updated_at=datetime('now') WHERE id=?`).run(status, c.id);
  } else {
    db.prepare(`UPDATE complaints SET status=?, updated_at=datetime('now') WHERE id=?`).run(status, c.id);
  }
  res.json(serializeFull(getRow(c.id), req.phone));
});

router.post('/:id/priority', requireOfficer, (req, res) => {
  const c = getRow(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (!['Low', 'Medium', 'High'].includes(req.body.priority)) return res.status(400).json({ error: 'Invalid priority' });
  db.prepare(`UPDATE complaints SET priority=?, updated_at=datetime('now') WHERE id=?`).run(req.body.priority, c.id);
  res.json(serializeFull(getRow(c.id), req.phone));
});

router.post('/:id/priority-review', requireOfficer, (req, res) => {
  const c = getRow(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const action = req.body.action;
  if (action === 'confirm') {
    addHistory(c.id, { label: 'Priority confirmed as High', who: OFFICER_NAME, role: OFFICER_ROLE, note: 'Reviewed and kept at High priority.', icon: 'shield' });
  } else if (['Medium', 'Low'].includes(action)) {
    db.prepare('UPDATE complaints SET priority = ? WHERE id = ?').run(action, c.id);
    addHistory(c.id, { label: `Priority adjusted to ${action}`, who: OFFICER_NAME, role: OFFICER_ROLE, note: 'Reviewed within 3 days and downgraded — did not meet High-priority criteria.', icon: 'shield' });
  } else {
    return res.status(400).json({ error: 'Invalid action' });
  }
  db.prepare(`UPDATE complaints SET priority_under_review = 0, updated_at=datetime('now') WHERE id = ?`).run(c.id);
  res.json(serializeFull(getRow(c.id), req.phone));
});

router.post('/:id/officer-note', requireOfficer, (req, res) => {
  const c = getRow(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const note = (req.body.note || '').trim();
  if (!note) return res.status(400).json({ error: 'Write an update first' });
  addHistory(c.id, { label: 'Officer update logged', who: OFFICER_NAME, role: OFFICER_ROLE, note, icon: 'edit' });
  touch(c.id);
  res.json(serializeFull(getRow(c.id), req.phone));
});

router.post('/:id/assign', requireOfficer, (req, res) => {
  const c = getRow(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const { officer, department } = req.body;
  if (!officer) return res.status(400).json({ error: 'Officer name required' });
  addHistory(c.id, { label: `Assigned to ${department || catDept(c.category)}`, who: officer, role: 'Officer', path: `Complaints Cell → ${department || catDept(c.category)}`, icon: 'user' });
  if (c.status === 'open') db.prepare(`UPDATE complaints SET status='in_progress', updated_at=datetime('now') WHERE id=?`).run(c.id);
  res.json(serializeFull(getRow(c.id), req.phone));
});

module.exports = router;
