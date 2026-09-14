const db = require('./db');
const ledger = require('./utils/ledger');

function seedIfEmpty() {
  const { count } = db.prepare('SELECT COUNT(*) as count FROM complaints').get();
  if (count > 0) return;

  const DEMO_PHONE = '9876543210';
  db.prepare(`INSERT INTO users (phone, verified) VALUES (?, 1)`).run(DEMO_PHONE);

  const insertComplaint = db.prepare(`INSERT INTO complaints
    (id, title, category, description, location_text, lat, lng, owner_phone, contact_phone,
     anonymous, private_identity, status, priority, priority_under_review, priority_marked_at,
     upvotes, verified_count, resolved_verified, rating, suggestion, reopen_window_open, reopened,
     resolution_note, resolution_submitted_at, resolved_at, created_at)
    VALUES (@id,@title,@category,@description,@location_text,@lat,@lng,@owner_phone,@contact_phone,
     @anonymous,@private_identity,@status,@priority,@priority_under_review,@priority_marked_at,
     @upvotes,@verified_count,@resolved_verified,@rating,@suggestion,@reopen_window_open,@reopened,
     @resolution_note,@resolution_submitted_at,@resolved_at,@created_at)`);

  const insertChat = db.prepare(`INSERT INTO chat_messages (complaint_id, from_role, name, text, created_at) VALUES (?,?,?,?,?)`);
  const insertPastReport = db.prepare(`INSERT INTO past_reports (complaint_id, reference) VALUES (?, ?)`);

  const now = Date.now();
  const daysAgo = n => new Date(now - n * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const hoursAgo = n => new Date(now - n * 3600000).toISOString().slice(0, 19).replace('T', ' ');

  const rows = [
    {
      id: 'c1', title: 'Large pothole on Gandhi Road', category: 'roads',
      description: 'Deep pothole near the Gandhi Road junction causing traffic jams and tyre damage.',
      location_text: 'Gandhi Road, Central Delhi', lat: '28.6139', lng: '77.2090',
      owner_phone: DEMO_PHONE, contact_phone: DEMO_PHONE, anonymous: 0, private_identity: 0,
      status: 'open', priority: 'High', priority_under_review: 0, priority_marked_at: daysAgo(11),
      upvotes: 0, verified_count: 2, resolved_verified: null, rating: null, suggestion: '',
      reopen_window_open: 0, reopened: 0, resolution_note: null, resolution_submitted_at: null, resolved_at: null,
      created_at: daysAgo(12),
      pastReports: ['FIR No. 112/2025', 'PWD receipt 88231'],
      history: [
        { label: 'Complaint first opened', created_at: daysAgo(12), icon: 'checkCircle' },
        { label: 'Assigned to PWD (Roads)', who: 'Rajesh Kumar', role: 'Clerk', path: 'Complaints Cell → PWD (Roads)', note: 'Routed to roads division for pothole rectification', created_at: daysAgo(11), icon: 'user' },
        { label: 'Priority confirmed as High', who: 'Anita Sharma', role: 'Supervisor', note: 'Backed by attached FIR and PWD receipt — kept at High priority.', created_at: daysAgo(10), icon: 'shield' },
        { label: 'Transferred to PWD (Roads)', who: 'Anita Sharma', role: 'Supervisor', path: 'PWD (Roads)', note: 'Inspected site; scheduled for patching', created_at: daysAgo(3), icon: 'arrowRight' },
        { label: 'Site inspection completed', who: 'Anita Sharma', role: 'Supervisor', note: 'Pothole measured at 2m x 1.5m. Work order raised.', created_at: daysAgo(3), icon: 'checkCircle' },
      ],
      chat: [
        { from_role: 'officer', name: 'Anita Sharma', text: 'Could you share the exact landmark near the pothole so the crew can locate it faster?', created_at: daysAgo(2) },
        { from_role: 'citizen', name: 'Citizen •••3210', text: 'It is right opposite the Gandhi Road bus stop, near the tea stall.', created_at: daysAgo(1) },
      ],
    },
    {
      id: 'c2', title: 'Loud construction noise at night', category: 'noise',
      description: 'Construction crew running heavy machinery past midnight, disturbing the whole block.',
      location_text: 'Sector 12, Central Delhi', lat: '28.6270', lng: '77.2190',
      owner_phone: DEMO_PHONE, contact_phone: DEMO_PHONE, anonymous: 0, private_identity: 0,
      status: 'resolution_submitted', priority: 'Medium', priority_under_review: 0, priority_marked_at: null,
      upvotes: 2, verified_count: 1, resolved_verified: null, rating: null, suggestion: '',
      reopen_window_open: 0, reopened: 0,
      resolution_note: 'Notice served to the contractor; work now stops at 9 PM.',
      resolution_submitted_at: hoursAgo(48), resolved_at: null,
      created_at: daysAgo(5),
      pastReports: [],
      history: [
        { label: 'Complaint first opened', created_at: daysAgo(5), icon: 'checkCircle' },
        { label: 'Assigned to Pollution Control Board', who: 'Sunil Verma', role: 'Field Officer', path: 'Complaints Cell → Pollution Control Board', note: 'Notice sent to site contractor for working-hour violation.', created_at: daysAgo(4), icon: 'user' },
        { label: 'Resolution submitted', who: 'Sunil Verma', role: 'Field Officer', note: 'Notice served to the contractor; work now stops at 9 PM.', created_at: hoursAgo(48), icon: 'image' },
      ],
      chat: [
        { from_role: 'officer', name: 'Sunil Verma', text: 'We have served a notice to the contractor — can you confirm if the noise has stopped after 9 PM?', created_at: hoursAgo(48) },
      ],
    },
    {
      id: 'c3', title: 'Overgrown park grass', category: 'parks',
      description: 'Grass in the community park has not been cut in over a month, attracting pests.',
      location_text: 'Nehru Park, Central Delhi', lat: '28.5921', lng: '77.1936',
      owner_phone: DEMO_PHONE, contact_phone: DEMO_PHONE, anonymous: 0, private_identity: 0,
      status: 'open', priority: 'Low', priority_under_review: 0, priority_marked_at: null,
      upvotes: 5, verified_count: 4, resolved_verified: null, rating: null, suggestion: '',
      reopen_window_open: 0, reopened: 0, resolution_note: null, resolution_submitted_at: null, resolved_at: null,
      created_at: daysAgo(8),
      pastReports: [],
      history: [{ label: 'Complaint first opened', created_at: daysAgo(8), icon: 'checkCircle' }],
      chat: [],
    },
    {
      id: 'c4', title: 'Overflowing community dustbin', category: 'garbage',
      description: 'Dustbin near the market entrance has been overflowing for days, waste spilling onto the road.',
      location_text: 'Sector 18, Noida', lat: '28.5697', lng: '77.3260',
      owner_phone: null, contact_phone: null, anonymous: 1, private_identity: 0,
      status: 'resolved', priority: 'Medium', priority_under_review: 0, priority_marked_at: null,
      upvotes: 0, verified_count: 1, resolved_verified: 1, rating: 4,
      suggestion: 'Please add a second bin here — foot traffic near the market is high and one bin fills up too fast.',
      reopen_window_open: 1, reopened: 0,
      resolution_note: 'Bin cleared and pickup frequency increased for this block.',
      resolution_submitted_at: daysAgo(10), resolved_at: daysAgo(9),
      created_at: daysAgo(14),
      pastReports: [],
      history: [
        { label: 'Complaint first opened', created_at: daysAgo(14), icon: 'checkCircle' },
        { label: 'Assigned to Sanitation Dept', who: 'Meena Iyer', role: 'Supervisor', path: 'Complaints Cell → Sanitation Dept', note: 'Extra pickup scheduled for the area.', created_at: daysAgo(13), icon: 'user' },
        { label: 'Resolution submitted', who: 'Meena Iyer', role: 'Supervisor', note: 'Bin cleared and pickup frequency increased for this block.', created_at: daysAgo(10), icon: 'image' },
        { label: 'Resolution confirmed by citizen', note: 'Rated 4/5. Suggested adding a second bin nearby.', created_at: daysAgo(9), icon: 'checkCircle' },
      ],
      chat: [],
    },
    {
      id: 'c5', title: 'Waterlogging on MG Road after rain', category: 'water',
      description: 'Road gets waterlogged within minutes of rainfall, making it hard for two-wheelers to pass.',
      location_text: 'MG Road, Central Delhi', lat: '28.6304', lng: '77.2177',
      owner_phone: DEMO_PHONE, contact_phone: DEMO_PHONE, anonymous: 0, private_identity: 0,
      status: 'open', priority: 'High', priority_under_review: 1, priority_marked_at: hoursAgo(50),
      upvotes: 9, verified_count: 6, resolved_verified: null, rating: null, suggestion: '',
      reopen_window_open: 0, reopened: 0, resolution_note: null, resolution_submitted_at: null, resolved_at: null,
      created_at: daysAgo(7),
      pastReports: ['Complaint ID WB-4471'],
      history: [
        { label: 'Complaint first opened', created_at: daysAgo(7), icon: 'checkCircle' },
        { label: 'Assigned to Water Board', who: 'Karan Mehta', role: 'Engineer', path: 'Complaints Cell → Water Board', note: 'Site survey planned to check drain capacity.', created_at: daysAgo(6), icon: 'user' },
      ],
      chat: [
        { from_role: 'officer', name: 'Karan Mehta', text: 'Survey is scheduled for this week — will update once the crew visits.', created_at: daysAgo(3) },
      ],
    },
    {
      id: 'c6', title: 'Illegal garbage dumping', category: 'garbage',
      description: 'Truckloads of construction debris being dumped on the vacant plot behind the school.',
      location_text: 'Sector 18, Noida', lat: '28.5701', lng: '77.3252',
      owner_phone: null, contact_phone: null, anonymous: 1, private_identity: 0,
      status: 'resolved', priority: 'Medium', priority_under_review: 0, priority_marked_at: null,
      upvotes: 0, verified_count: 0, resolved_verified: 0, rating: null, suggestion: '',
      reopen_window_open: 0, reopened: 0,
      resolution_note: 'Site cleared; warning notice issued to the contractor.',
      resolution_submitted_at: daysAgo(21), resolved_at: daysAgo(14),
      created_at: daysAgo(24),
      pastReports: [],
      history: [
        { label: 'Complaint first opened', created_at: daysAgo(24), icon: 'checkCircle' },
        { label: 'Resolution submitted', who: 'Meena Iyer', role: 'Supervisor', note: 'Site cleared; warning notice issued to the contractor.', created_at: daysAgo(21), icon: 'image' },
        { label: 'Auto-resolved — no citizen response', note: 'No confirmation was received within 7 days, so this was closed automatically.', created_at: daysAgo(14), icon: 'clock' },
      ],
      chat: [],
    },
    {
      id: 'c7', title: 'Broken streetlight near school', category: 'streetlights',
      description: 'Streetlight outside the primary school gate has been off for two weeks, unsafe for kids in the evening.',
      location_text: 'MG Road, Central Delhi', lat: '28.6299', lng: '77.2165',
      owner_phone: DEMO_PHONE, contact_phone: DEMO_PHONE, anonymous: 0, private_identity: 0,
      status: 'in_progress', priority: 'Medium', priority_under_review: 0, priority_marked_at: null,
      upvotes: 3, verified_count: 2, resolved_verified: null, rating: null, suggestion: '',
      reopen_window_open: 0, reopened: 0, resolution_note: null, resolution_submitted_at: null, resolved_at: null,
      created_at: daysAgo(4),
      pastReports: [],
      history: [
        { label: 'Complaint first opened', created_at: daysAgo(4), icon: 'checkCircle' },
        { label: 'Assigned to Electricity Board', who: 'Dev Anand', role: 'Lineman', path: 'Complaints Cell → Electricity Board', note: 'Faulty ballast identified; part ordered.', created_at: daysAgo(3), icon: 'user' },
      ],
      chat: [],
    },
  ];

  const COMPLAINT_COLS = [
    'id', 'title', 'category', 'description', 'location_text', 'lat', 'lng', 'owner_phone', 'contact_phone',
    'anonymous', 'private_identity', 'status', 'priority', 'priority_under_review', 'priority_marked_at',
    'upvotes', 'verified_count', 'resolved_verified', 'rating', 'suggestion', 'reopen_window_open', 'reopened',
    'resolution_note', 'resolution_submitted_at', 'resolved_at', 'created_at',
  ];
  const insertAll = db.transaction(rows => {
    for (const r of rows) {
      const params = {};
      COMPLAINT_COLS.forEach(k => { params[k] = r[k] === undefined ? null : r[k]; });
      insertComplaint.run(params);
      r.pastReports.forEach(ref => insertPastReport.run(r.id, ref));
      r.history.forEach(h => ledger.appendEntry({ complaint_id: r.id, label: h.label, who: h.who, role: h.role, path: h.path, note: h.note, icon: h.icon || 'checkCircle', created_at: h.created_at }));
      r.chat.forEach(m => insertChat.run(r.id, m.from_role, m.name, m.text, m.created_at));
    }
  });
  insertAll(rows);
  console.log('Seeded demo data (7 complaints, demo citizen 9876543210).');
}

module.exports = { seedIfEmpty };
