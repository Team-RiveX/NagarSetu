const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db');
const { AUTO_RESOLVE_DAYS } = require('./utils/helpers');
require('./seed').seedIfEmpty();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/complaints', require('./routes/complaints'));
app.use('/api/audit', require('./routes/audit'));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// SPA fallback for the client router.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ---------- background job: auto-resolve stale "resolution_submitted" complaints ----------
   AUTO_RESOLVE_DAYS defaults to 7. Lower it via env var to see this fire sooner, e.g.:
     AUTO_RESOLVE_DAYS=0.02 npm start     (~30 minutes)
   The /simulate-timeout endpoint (used by the "Simulate 7 days" button in the UI) does the
   same thing on demand, for demoing without waiting at all. */
function runAutoResolveSweep() {
  const rows = db.prepare(`SELECT * FROM complaints WHERE status = 'resolution_submitted'`).all();
  const cutoffMs = AUTO_RESOLVE_DAYS * 86400000;
  rows.forEach(c => {
    const submittedAt = new Date((c.resolution_submitted_at || c.updated_at).replace(' ', 'T') + 'Z').getTime();
    if (Date.now() - submittedAt >= cutoffMs) {
      db.prepare(`UPDATE complaints SET status='resolved', resolved_verified=0, resolved_at=datetime('now'),
                  reopen_window_open=1, updated_at=datetime('now') WHERE id=?`).run(c.id);
      db.prepare(`INSERT INTO history (complaint_id, label, note, icon)
                  VALUES (?, 'Auto-resolved — no citizen response', ?, 'clock')`)
        .run(c.id, `No confirmation was received within ${AUTO_RESOLVE_DAYS} day(s), so this was closed automatically.`);
      console.log(`[auto-resolve] ${c.id} closed as unverified`);
    }
  });
}
setInterval(runAutoResolveSweep, 5 * 60 * 1000); // check every 5 minutes
runAutoResolveSweep();

app.listen(PORT, () => {
  console.log(`Civic Tracker backend running at http://localhost:${PORT}`);
  console.log(`Auto-resolve window: ${AUTO_RESOLVE_DAYS} day(s) (set AUTO_RESOLVE_DAYS to change)`);
});
