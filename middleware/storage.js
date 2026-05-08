// middleware/storage.js
// Phase 2 — storage byte metering with 30-day grace.
//
// trackUploadBytes(): runs AFTER multer parses an upload, records req.file.size
// against the user's account.
//
// requireStorageHeadroom(): pre-flight check before kicking off any feature
// that ingests data. If the user is over cap and grace has expired, returns 402.
// If over cap but grace is active (or just being granted now), allows the
// request and sets storage_grace_until to NOW()+30d on first detection.

const { storageOps } = require('../db/database');

const GB = 1024 * 1024 * 1024;
const GRACE_DAYS = 30;

// Plan cap table in BYTES. Aligned with the dashboard widget.
// Canonical plan set: free, starter, pro, teams (matches Stripe PRICE_MAP).
const STORAGE_CAPS = {
  free:        1 * GB,
  starter:    10 * GB,
  pro:        50 * GB,
  teams:     200 * GB,
  // Legacy alias.
  enterprise: 200 * GB
};

function capForPlan(plan) {
  if (plan && Object.prototype.hasOwnProperty.call(STORAGE_CAPS, plan)) return STORAGE_CAPS[plan];
  return STORAGE_CAPS.free;
}

function bytesToGB(b) { return Number(b) / GB; }
function formatBytes(b) {
  const n = Number(b) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / GB).toFixed(2)} GB`;
}

// Returns true if `until` (Date or ISO string) is in the future.
function graceActive(until) {
  if (!until) return false;
  const d = until instanceof Date ? until : new Date(until);
  return !isNaN(d) && d.getTime() > Date.now();
}

// Pre-flight middleware. Place AFTER requireAuth, BEFORE multer.
// Reads usage; if the user is at/over cap, decides whether to allow (grace)
// or block (no grace, or grace expired). If we're allowing because the user
// just crossed the cap and has no grace_until yet, set it to NOW()+30d.
function requireStorageHeadroom() {
  return async (req, res, next) => {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    let usage;
    try {
      usage = await storageOps.getUsage(req.user.id);
    } catch (err) {
      console.error('[storage] failed to read usage:', err);
      return next(); // fail open
    }
    if (!usage) return next();

    const cap = capForPlan(usage.plan);
    const overCap = usage.bytes >= cap;

    if (!overCap) return next();

    // Over cap. Grace logic.
    if (graceActive(usage.graceUntil)) {
      res.locals.storageGrace = { until: usage.graceUntil, used: usage.bytes, cap };
      return next();
    }

    // No grace yet — auto-grant 30-day grace once, then allow this request.
    if (!usage.graceUntil) {
      const until = new Date(Date.now() + GRACE_DAYS * 24 * 60 * 60 * 1000);
      try { await storageOps.setGrace(req.user.id, until); } catch (e) {
        console.error('[storage] failed to set grace:', e);
      }
      res.locals.storageGrace = { until, used: usage.bytes, cap, justGranted: true };
      return next();
    }

    // Grace exists but is expired. Block.
    return res.status(402).json({
      error: 'Storage cap reached',
      message: `You're using ${formatBytes(usage.bytes)} of ${formatBytes(cap)} on the ${usage.plan || 'free'} plan. ` +
               `Your 30-day grace period ended on ${new Date(usage.graceUntil).toLocaleDateString()}. ` +
               `Upgrade your plan or remove old projects to continue.`,
      used: usage.bytes,
      cap,
      graceUntil: usage.graceUntil,
      upgradeUrl: '/billing'
    });
  };
}

// Post-multer middleware. Reads req.file.size (single) or sums req.files (array).
// Increments the user's bytes_used after the upload has been received.
function trackUploadBytes() {
  return async (req, res, next) => {
    try {
      let bytes = 0;
      if (req.file && req.file.size) bytes += req.file.size;
      if (Array.isArray(req.files)) bytes += req.files.reduce((a, f) => a + (f.size || 0), 0);
      else if (req.files && typeof req.files === 'object') {
        for (const k of Object.keys(req.files)) {
          const v = req.files[k];
          if (Array.isArray(v)) bytes += v.reduce((a, f) => a + (f.size || 0), 0);
          else if (v && v.size) bytes += v.size;
        }
      }
      if (bytes > 0 && req.user && req.user.id) {
        await storageOps.addBytes(req.user.id, bytes);
        req.storageRecorded = bytes;
      }
    } catch (err) {
      console.error('[storage] addBytes failed:', err);
    }
    next();
  };
}

module.exports = {
  requireStorageHeadroom,
  trackUploadBytes,
  capForPlan,
  bytesToGB,
  formatBytes,
  graceActive,
  STORAGE_CAPS,
  GRACE_DAYS
};
