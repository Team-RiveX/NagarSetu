// Minimal, dependency-free stand-in for multer. The frontend sends photos as
// base64 data URLs inside the regular JSON body (e.g. `images: ["data:image/..."]`)
// rather than multipart/form-data, so no extra npm package is needed to parse
// uploads. Each route calls `upload.array('images', N)` exactly like multer.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const EXT_BY_MIME = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
  'image/gif': 'gif', 'image/webp': 'webp',
};
const MAX_BYTES = 8 * 1024 * 1024; // 8MB per image

function saveDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = /^data:(image\/[a-zA-Z0-9+.-]+);base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match) return null;
  const ext = EXT_BY_MIME[match[1].toLowerCase()] || 'jpg';
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0 || buffer.length > MAX_BYTES) return null;
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
  return { filename, size: buffer.length };
}

function array(fieldName, maxCount) {
  return (req, res, next) => {
    try {
      const raw = req.body ? req.body[fieldName] : undefined;
      let list = [];
      if (Array.isArray(raw)) list = raw;
      else if (typeof raw === 'string' && raw.trim()) {
        try { const parsed = JSON.parse(raw); list = Array.isArray(parsed) ? parsed : [parsed]; }
        catch (e) { list = [raw]; }
      }
      req.files = list.slice(0, maxCount || 10).map(saveDataUrl).filter(Boolean);
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { array };
