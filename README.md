# Civic Tracker

A citizen complaint tracking app — report civic issues (potholes, streetlights,
garbage, etc.), track them through resolution, and let officers manage a
dashboard of open cases. Real Express + SQLite backend, wired end-to-end to
the frontend (no mock data).

## Stack

- **Backend:** Node.js + Express, SQLite via Node's built-in `node:sqlite`
  module (zero native/compiled dependencies — no `better-sqlite3` build step,
  works anywhere Node 22.5+ runs).
- **Tamper-evident audit ledger:** every history event (status change,
  priority decision, resolution proof, citizen confirmation, etc.) is
  SHA-256 hash-chained to the one before it — see `utils/ledger.js` and the
  "Blockchain / integrity" section below.
- **Frontend:** a single static `public/index.html` (vanilla JS, no build
  step) served directly by Express.
- **Photo uploads:** sent as base64 data URLs in normal JSON requests (no
  `multer`/multipart needed) and stored under `/uploads`.

## Tamper-evident audit ledger ("blockchain component")

Every entry in a complaint's history — first opened, assigned, priority
reviewed, resolution submitted, citizen confirmed, reopened, escalated — is
appended to a single, system-wide hash chain (`utils/ledger.js`), not just a
plain database row:

```
hash_n = SHA256(hash_(n-1) + complaint_id + label + who + role + path + note + icon + timestamp)
```

This is the same core integrity primitive blockchains are built on — each
record cryptographically commits to everything before it — applied as a
single authoritative ledger rather than a distributed, consensus-based chain
(there's no mining or multiple nodes here; it's intentionally lightweight).
The practical effect: if anyone edits or deletes a past entry directly in the
database, every hash computed after that point stops matching, and it's
detectable, not just theoretically prevented.

- `GET /api/audit/verify` walks every row in the ledger, recomputes each hash
  from scratch, and reports whether the chain is intact — and if not, exactly
  which entry broke it.
- Each history entry shown in the app displays its short hash, and there's a
  "Verify integrity" button on every complaint's timeline that calls this
  endpoint live.
- This has been tested against real tampering (directly editing a row in the
  SQLite file, bypassing the app) and correctly detects and pinpoints it.

## Run locally

```bash
npm install
npm start
```

Then open **http://localhost:3000**. On first run it seeds 7 demo complaints
and a demo citizen (phone `9876543210`).

- OTP login: enter any 10-digit phone number, then use code **1234** (this is
  a simulated OTP — see `routes/auth.js` to plug in a real SMS provider like
  Twilio or MSG91).
- Citizen "Problems near you": the home screen's quick-card opens a
  location-based feed of nearby complaints (real browser geolocation, with a
  central-Delhi fallback if permission is denied), sorted nearest-first, with
  inline upvoting and tap-through to full detail.
- Officer dashboard: tap the "Officer" tab (bottom nav) — this is the only
  way in. This now requires actually
  signing in with the officer key (`POST /api/auth/officer-login` validates
  it server-side) — the dashboard is no longer reachable without it. Default
  key is `demo-officer-key`; change this via the `OFFICER_KEY` env var
  before going live (see below). All officer-only write actions (status,
  priority, resolution proof) are independently gated by the same key on
  every request, regardless of the sign-in screen.

## Environment variables

| Variable            | Default             | Purpose                                             |
|----------------------|---------------------|------------------------------------------------------|
| `PORT`               | `3000`              | HTTP port                                             |
| `OFFICER_KEY`        | `demo-officer-key`  | Shared secret required for officer-only actions       |
| `AUTO_RESOLVE_DAYS`  | `7`                 | Days a submitted resolution waits before auto-closing |
| `DB_PATH`            | `./data/civic.db`   | SQLite file location                                   |

Set these in a `.env` file or your host's environment settings — `server.js`
already reads them via `process.env`.

## Deploying

This needs a host that runs a persistent Node process (it's not a static
site) with a writable disk for the SQLite file and uploaded photos — Render,
Railway, Fly.io, or a small VPS all work well.

### Render / Railway (easiest)

1. Push this folder to a GitHub repo.
2. Create a new **Web Service**, connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Add a **persistent disk** mounted at `/opt/render/project/src/data` (Render)
   or the app's `data/` and `uploads/` folders (Railway) so complaints and
   photos survive restarts/deploys.
5. Set `OFFICER_KEY` to a real secret in the service's environment settings.

### Docker

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
VOLUME ["/app/data", "/app/uploads"]
EXPOSE 3000
CMD ["npm", "start"]
```

```bash
docker build -t civic-tracker .
docker run -p 3000:3000 -v civic-data:/app/data -v civic-uploads:/app/uploads civic-tracker
```

## Notes / things to change before real production use

- **OTP is simulated** (`routes/auth.js`) — every number gets the same demo
  code. Swap in a real SMS provider before launch.
- **Officer key is a shared secret**, not per-officer accounts — fine for a
  small pilot, but add real officer login before wider rollout.
- The background job in `server.js` auto-closes stale "resolution submitted"
  complaints as unverified after `AUTO_RESOLVE_DAYS` — there's also a
  `/simulate-timeout` endpoint the UI uses to demo this instantly without
  waiting.
- Complaint list/detail reads (`GET /api/complaints`, `GET /api/complaints/:id`)
  are intentionally public/unauthenticated, matching a public transparency
  register. Tighten this if you don't want that.

## Project structure

```
server.js             entry point
db.js                  SQLite schema + connection
seed.js                demo data (only runs if the complaints table is empty)
routes/auth.js         OTP login, sessions, identity verification
routes/complaints.js   complaint CRUD, voting, chat, officer actions
routes/audit.js        GET /api/audit/verify — recomputes and checks the ledger
utils/helpers.js       categories, response serializers, relative-time formatting
utils/upload.js        base64 image upload handling
utils/ledger.js         SHA-256 hash-chained audit ledger (the "blockchain" component)
public/index.html      the entire frontend (no build step)
data/                   SQLite database file (created on first run)
uploads/                uploaded photos (created on first run)
```
