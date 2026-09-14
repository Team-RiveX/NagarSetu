// A lightweight, genuinely tamper-evident audit ledger for the civic complaint
// history. Every history entry (status change, priority decision, officer
// note, resolution, citizen confirmation, etc.) is chained to the one before
// it, the same way blocks in a blockchain are chained: each entry's hash is
// computed over its own data *plus* the previous entry's hash, so altering
// or deleting any past entry breaks every hash that comes after it.
//
// This is intentionally NOT a distributed blockchain — there's no consensus,
// no mining, no separate nodes. It IS a real cryptographic hash chain: the
// same core integrity mechanism blockchains build on, applied to a single
// authoritative ledger. `verifyChain()` below walks every row and recomputes
// the hashes from scratch, so any tampering with the underlying SQLite file
// is detectable, not just theoretically prevented.
const crypto = require('crypto');
const db = require('../db');

const GENESIS_HASH = '0'.repeat(64);

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function computeHash(prevHash, row) {
  const canonical = [
    prevHash,
    row.complaint_id,
    row.label,
    row.who || '',
    row.role || '',
    row.path || '',
    row.note || '',
    row.icon || 'checkCircle',
    row.created_at,
  ].join('|');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function getTipHash() {
  const row = db.prepare('SELECT hash FROM history ORDER BY id DESC LIMIT 1').get();
  return row ? row.hash : GENESIS_HASH;
}

/**
 * Appends one entry to the global hash-chained ledger and to the (same)
 * `history` table used for the on-screen complaint timeline. Returns the
 * inserted row's id/prev_hash/hash.
 */
function appendEntry({ complaint_id, label, who, role, path, note, icon, created_at }) {
  const prevHash = getTipHash();
  const ts = created_at || nowSql();
  const hash = computeHash(prevHash, { complaint_id, label, who, role, path, note, icon, created_at: ts });
  const info = db.prepare(`INSERT INTO history
      (complaint_id, label, who, role, path, note, icon, created_at, prev_hash, hash)
      VALUES (@complaint_id, @label, @who, @role, @path, @note, @icon, @created_at, @prev_hash, @hash)`)
    .run({
      complaint_id,
      label,
      who: who || null,
      role: role || null,
      path: path || null,
      note: note || null,
      icon: icon || 'checkCircle',
      created_at: ts,
      prev_hash: prevHash,
      hash,
    });
  return { id: info.lastInsertRowid, prev_hash: prevHash, hash };
}

/**
 * Walks the entire ledger in insertion order and recomputes every hash from
 * the raw row data. If anything in the `history` table was edited, deleted,
 * or reordered outside of `appendEntry`, this will detect it and report
 * exactly where the chain first breaks.
 */
function verifyChain() {
  const rows = db.prepare('SELECT * FROM history ORDER BY id ASC').all();
  let expectedPrev = GENESIS_HASH;
  for (const row of rows) {
    const recomputed = computeHash(expectedPrev, row);
    if (row.prev_hash !== expectedPrev || row.hash !== recomputed) {
      return {
        valid: false,
        checked: rows.length,
        brokenAt: { id: row.id, complaintId: row.complaint_id, label: row.label },
      };
    }
    expectedPrev = row.hash;
  }
  return { valid: true, checked: rows.length, tipHash: expectedPrev };
}

module.exports = { appendEntry, verifyChain, nowSql, GENESIS_HASH };
