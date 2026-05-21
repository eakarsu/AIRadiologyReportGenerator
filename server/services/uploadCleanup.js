// Background cleanup for server/uploads/.
// Multer writes every vision-endpoint upload to disk; without this they
// accumulate forever. Deletes files older than MAX_AGE_MS, runs on boot
// and then every INTERVAL_MS.

const fs = require('fs');
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'server', 'uploads');
const MAX_AGE_MS = parseInt(process.env.UPLOAD_MAX_AGE_MS, 10) || 24 * 60 * 60 * 1000; // 24h
const INTERVAL_MS = parseInt(process.env.UPLOAD_CLEANUP_INTERVAL_MS, 10) || 60 * 60 * 1000; // 1h

function sweep() {
  if (!fs.existsSync(UPLOAD_DIR)) return { scanned: 0, deleted: 0 };
  const now = Date.now();
  let scanned = 0, deleted = 0;
  for (const name of fs.readdirSync(UPLOAD_DIR)) {
    const p = path.join(UPLOAD_DIR, name);
    try {
      const stat = fs.statSync(p);
      scanned++;
      if (!stat.isFile()) continue;
      if (now - stat.mtimeMs > MAX_AGE_MS) {
        fs.unlinkSync(p);
        deleted++;
      }
    } catch (_) { /* ignore unlink race */ }
  }
  return { scanned, deleted };
}

function startUploadCleanup() {
  try {
    const r = sweep();
    if (r.deleted > 0) {
      console.log(`[upload-cleanup] boot sweep: scanned=${r.scanned} deleted=${r.deleted}`);
    }
  } catch (e) {
    console.warn(`[upload-cleanup] boot sweep failed: ${e.message}`);
  }
  const handle = setInterval(() => {
    try {
      const r = sweep();
      if (r.deleted > 0) {
        console.log(`[upload-cleanup] periodic sweep: scanned=${r.scanned} deleted=${r.deleted}`);
      }
    } catch (e) {
      console.warn(`[upload-cleanup] periodic sweep failed: ${e.message}`);
    }
  }, INTERVAL_MS);
  if (typeof handle.unref === 'function') handle.unref();
  return handle;
}

module.exports = { startUploadCleanup, sweep, UPLOAD_DIR, MAX_AGE_MS };
