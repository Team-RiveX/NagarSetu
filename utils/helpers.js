const db = require('../db');

const AUTO_RESOLVE_DAYS = parseFloat(process.env.AUTO_RESOLVE_DAYS || '7');
const REOPEN_WINDOW_DAYS = parseFloat(process.env.REOPEN_WINDOW_DAYS || '7');
const OFFICER_KEY = process.env.OFFICER_KEY || 'demo-officer-key';

const CATEGORIES = [
  { id: 'roads', label: 'Roads & Potholes', dept: 'PWD (Roads)' },
  { id: 'water', label: 'Water Supply', dept: 'Water Board' },
  { id: 'garbage', label: 'Garbage & Waste', dept: 'Sanitation Dept' },
  { id: 'streetlights', label: 'Streetlights', dept: 'Electricity Board' },
  { id: 'drainage', label: 'Drainage & Sewage', dept: 'PWD (Drainage)' },
  { id: 'noise', label: 'Noise Pollution', dept: 'Pollution Control Board' },
  { id: 'parks', label: 'Parks & Trees', dept: 'Parks Dept' },
  { id: 'electricity', label: 'Electricity', dept: 'Electricity Board' },
  { id: 'encroachment', label: 'Encroachment / Illegal Building', dept: 'Municipal Corporation' },
  { id: 'health', label: 'Public Health', dept: 'Health Dept' },
  { id: 'transport', label: 'Public Transport', dept: 'Transport Dept' },
  { id: 'other', label: 'Other', dept: 'General Complaints Cell' },
];
function catLabel(id) { const c = CATEGORIES.find(c => c.id === id); return c ? c.label : id; }
function catDept(id) { const c = CATEGORIES.find(c => c.id === id); return c ? c.dept : 'Complaints Cell'; }

/* ---------- time formatting ---------- */
function toMs(sqlDateStr) {
  if (!sqlDateStr) return null;
  // SQLite datetime('now') strings look like 'YYYY-MM-DD HH:MM:SS' (UTC).
  const iso = sqlDateStr.includes('T') ? sqlDateStr : sqlDateStr.replace(' ', 'T') + 'Z';
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}
function relativeTime(sqlDateStr) {
  const t = toMs(sqlDateStr);
  if (t === null) return '';
  const diffMs = Date.now() - t;
  if (diffMs < 45 * 1000) return 'Just now';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}
function ageDays(sqlDateStr) {
  const t = toMs(sqlDateStr);
  if (t === null) return 0;
  return (Date.now() - t) / 86400000;
}

/* ---------- related-row lookups ---------- */
function imageCount(id, kind) {
  return db.prepare('SELECT COUNT(*) as n FROM complaint_images WHERE complaint_id=? AND kind=?').get(id, kind).n;
}
function getPastReports(id) {
  return db.prepare('SELECT reference FROM past_reports WHERE complaint_id=? ORDER BY id').all(id).map(r => r.reference);
}
function hasVote(id, phone, kind) {
  if (!phone) return false;
  return !!db.prepare('SELECT 1 FROM complaint_votes WHERE complaint_id=? AND phone=? AND kind=?').get(id, phone, kind);
}
function getHistory(id) {
  return db.prepare('SELECT * FROM history WHERE complaint_id=? ORDER BY created_at ASC, id ASC').all(id)
    .map(h => ({
      label: h.label, who: h.who, role: h.role, path: h.path, note: h.note,
      icon: h.icon || 'checkCircle', date: relativeTime(h.created_at),
      hash: h.hash ? h.hash.slice(0, 10) : null,
      prevHash: h.prev_hash ? h.prev_hash.slice(0, 10) : null,
    }));
}
function getChat(id) {
  return db.prepare('SELECT * FROM chat_messages WHERE complaint_id=? ORDER BY created_at ASC, id ASC').all(id)
    .map(m => ({ from: m.from_role, name: m.name, text: m.text, date: relativeTime(m.created_at) }));
}

/* ---------- "current phase" card shown on open/in-progress complaints ---------- */
function computePhase(c) {
  if (c.status === 'resolved' || c.status === 'resolution_submitted') return null;
  const days = Math.floor(ageDays(c.priority_marked_at || c.created_at));
  let note;
  if (c.status === 'in_progress') note = 'Being handled by the assigned department.';
  else note = days < 1 ? 'Just submitted — awaiting review.' : 'Awaiting assignment to a department.';
  return { days, note };
}

function authorName(c) {
  if (c.anonymous) return 'Anonymous';
  if (c.private_identity) return 'Resident (private)';
  return c.owner_phone ? `Citizen •••${String(c.owner_phone).slice(-4)}` : 'Citizen';
}

/* ---------- serializers matching the frontend's expected shape ---------- */
function serializeSummary(c, viewerPhone) {
  return {
    id: c.id,
    title: c.title,
    category: c.category,
    locationText: c.location_text,
    status: c.status,
    priority: c.priority,
    priorityUnderReview: !!c.priority_under_review,
    priorityMarkedAgo: c.priority_marked_at ? relativeTime(c.priority_marked_at) : null,
    openedAgo: relativeTime(c.created_at),
    resolvedAgo: c.resolved_at ? relativeTime(c.resolved_at) : null,
    resolvedVerified: c.resolved_verified === null || c.resolved_verified === undefined ? null : !!c.resolved_verified,
    stale: c.status === 'open' && ageDays(c.created_at) >= 7,
    phase: computePhase(c),
    upvotes: c.upvotes,
    verifiedCount: c.verified_count,
    anonymous: !!c.anonymous,
    private: !!c.private_identity,
    authorName: authorName(c),
    ownerPhone: c.owner_phone || null,
  };
}

function serializeFull(c, viewerPhone) {
  return {
    ...serializeSummary(c, viewerPhone),
    description: c.description,
    lat: c.lat,
    lng: c.lng,
    images: imageCount(c.id, 'problem'),
    pastReports: getPastReports(c.id),
    phone: c.contact_phone || '',
    voted: hasVote(c.id, viewerPhone, 'upvote'),
    verifiedByMe: hasVote(c.id, viewerPhone, 'verify'),
    rating: c.rating,
    suggestion: c.suggestion || '',
    reopenWindowOpen: !!c.reopen_window_open,
    reopened: !!c.reopened,
    resolutionProof: c.resolution_note ? {
      images: imageCount(c.id, 'resolution_proof'),
      note: c.resolution_note,
      submittedAgo: relativeTime(c.resolution_submitted_at),
      submittedAt: toMs(c.resolution_submitted_at),
    } : null,
    history: getHistory(c.id),
    chat: getChat(c.id),
  };
}

module.exports = {
  CATEGORIES, catLabel, catDept,
  AUTO_RESOLVE_DAYS, REOPEN_WINDOW_DAYS, OFFICER_KEY,
  relativeTime, ageDays,
  serializeSummary, serializeFull,
};
