// SQLite database layer. Uses Node's built-in `node:sqlite` module (available
// in Node 22.5+, no native compilation required — safe for any host).
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'civic.db');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  phone       TEXT PRIMARY KEY,
  verified    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS otps (
  phone       TEXT PRIMARY KEY,
  code        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  phone       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS complaints (
  id                      TEXT PRIMARY KEY,
  title                   TEXT NOT NULL,
  category                TEXT NOT NULL,
  description             TEXT NOT NULL,
  location_text           TEXT,
  lat                     TEXT,
  lng                     TEXT,
  owner_phone             TEXT,
  contact_phone           TEXT,
  anonymous               INTEGER NOT NULL DEFAULT 0,
  private_identity        INTEGER NOT NULL DEFAULT 0,
  status                  TEXT NOT NULL DEFAULT 'open',
  priority                TEXT NOT NULL DEFAULT 'Medium',
  priority_under_review   INTEGER NOT NULL DEFAULT 0,
  priority_marked_at      TEXT,
  upvotes                 INTEGER NOT NULL DEFAULT 0,
  verified_count          INTEGER NOT NULL DEFAULT 0,
  resolved_verified       INTEGER,
  rating                  INTEGER,
  suggestion              TEXT DEFAULT '',
  reopen_window_open      INTEGER NOT NULL DEFAULT 0,
  reopened                INTEGER NOT NULL DEFAULT 0,
  resolution_note         TEXT,
  resolution_submitted_at TEXT,
  resolved_at             TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  complaint_id  TEXT NOT NULL,
  label         TEXT NOT NULL,
  who           TEXT,
  role          TEXT,
  path          TEXT,
  note          TEXT,
  icon          TEXT DEFAULT 'checkCircle',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  prev_hash     TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  hash          TEXT
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  complaint_id  TEXT NOT NULL,
  from_role     TEXT NOT NULL,
  name          TEXT,
  text          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS past_reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  complaint_id  TEXT NOT NULL,
  reference     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS complaint_images (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  complaint_id  TEXT NOT NULL,
  kind          TEXT NOT NULL,
  url           TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS complaint_votes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  complaint_id  TEXT NOT NULL,
  phone         TEXT NOT NULL,
  kind          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(complaint_id, phone, kind)
);

CREATE INDEX IF NOT EXISTS idx_history_complaint ON history(complaint_id);
CREATE INDEX IF NOT EXISTS idx_chat_complaint ON chat_messages(complaint_id);
CREATE INDEX IF NOT EXISTS idx_past_reports_complaint ON past_reports(complaint_id);
CREATE INDEX IF NOT EXISTS idx_images_complaint ON complaint_images(complaint_id);
CREATE INDEX IF NOT EXISTS idx_votes_complaint ON complaint_votes(complaint_id);
CREATE INDEX IF NOT EXISTS idx_sessions_phone ON sessions(phone);
`);

// node:sqlite's DatabaseSync has no built-in `.transaction()` helper like
// better-sqlite3 — add a small compatible shim so seed.js etc. work as-is.
db.transaction = function transaction(fn) {
  return (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
};

module.exports = db;
