// utils/r2.js — Cloudflare R2 (S3-compatible) helpers using native fetch
// and AWS Signature v4. No SDK dependency.
//
// Env vars expected on the server:
//   R2_ACCOUNT_ID         - your Cloudflare account id
//   R2_BUCKET             - bucket name (default: splicora-clips)
//   R2_ACCESS_KEY_ID      - Access Key ID from R2 API token
//   R2_SECRET_ACCESS_KEY  - Secret Access Key from R2 API token
//
// All functions are no-ops (return null / { ok:false, skipped:true }) when
// credentials aren't configured so dev environments without R2 won't crash.

const crypto = require('crypto');

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const BUCKET = process.env.R2_BUCKET || 'splicora-clips';
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const HOST = ACCOUNT_ID ? `${ACCOUNT_ID}.r2.cloudflarestorage.com` : '';
const REGION = 'auto';
const SERVICE = 's3';

function isConfigured() {
  return !!(ACCOUNT_ID && ACCESS_KEY_ID && SECRET_ACCESS_KEY && BUCKET);
}

function hmac(key, str) { return crypto.createHmac('sha256', key).update(str).digest(); }
function sha256Hex(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

// Encode each path segment per AWS sigv4 rules: encode everything except A–Z a–z 0–9 - _ . ~ /
function encodePath(p) {
  return p.split('/').map(seg =>
    encodeURIComponent(seg)
      .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  ).join('/');
}

function signRequest(method, key, queryString, bodyBuf, contentType) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const canonicalUri = '/' + BUCKET + '/' + encodePath(key);
  const payloadHash = sha256Hex(bodyBuf || Buffer.alloc(0));

  // Canonical headers must be in lowercase, sorted by name.
  const hdrs = {
    host: HOST,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate
  };
  if (contentType && method === 'PUT') hdrs['content-type'] = contentType;
  const hdrNames = Object.keys(hdrs).sort();
  const canonicalHeaders = hdrNames.map(n => `${n}:${hdrs[n]}\n`).join('');
  const signedHeaders = hdrNames.join(';');

  const canonicalRequest = `${method}\n${canonicalUri}\n${queryString || ''}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${sha256Hex(Buffer.from(canonicalRequest))}`;

  const kDate = hmac(`AWS4${SECRET_ACCESS_KEY}`, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization = `${algorithm} Credential=${ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `https://${HOST}${canonicalUri}${queryString ? '?' + queryString : ''}`,
    headers: {
      'Host': HOST,
      ...(contentType && method === 'PUT' ? { 'Content-Type': contentType } : {}),
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      'Authorization': authorization
    }
  };
}

// Upload a file (Buffer) to R2 under `key`. Returns { ok, status, error? }.
async function putObject(key, body, contentType = 'application/octet-stream') {
  if (!isConfigured()) return { ok: false, skipped: true };
  if (!Buffer.isBuffer(body)) body = Buffer.from(body);
  try {
    const { url, headers } = signRequest('PUT', key, '', body, contentType);
    const res = await fetch(url, {
      method: 'PUT',
      headers: { ...headers, 'Content-Length': String(body.length) },
      body
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: txt.slice(0, 500) };
    }
    return { ok: true, status: res.status, key };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

// GET an object as a Buffer. Returns { ok, body, contentType, error? }.
async function getObject(key) {
  if (!isConfigured()) return { ok: false, skipped: true };
  try {
    const { url, headers } = signRequest('GET', key, '', null);
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: txt.slice(0, 500) };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: true, body: buf, contentType: res.headers.get('content-type') || 'application/octet-stream', size: buf.length };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

// Check whether an object exists (HEAD). Returns { exists, size?, contentType? }.
async function headObject(key) {
  if (!isConfigured()) return { exists: false, skipped: true };
  try {
    const { url, headers } = signRequest('HEAD', key, '', null);
    const res = await fetch(url, { method: 'HEAD', headers });
    if (res.status === 404) return { exists: false };
    if (!res.ok) return { exists: false, status: res.status };
    return {
      exists: true,
      size: Number(res.headers.get('content-length') || 0),
      contentType: res.headers.get('content-type') || ''
    };
  } catch (e) {
    return { exists: false, error: e.message || String(e) };
  }
}

async function deleteObject(key) {
  if (!isConfigured()) return { ok: false, skipped: true };
  try {
    const { url, headers } = signRequest('DELETE', key, '', null);
    const res = await fetch(url, { method: 'DELETE', headers });
    return { ok: res.status === 204 || res.status === 200, status: res.status };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

// Stream an R2 object into an Express response. Use this from /clip/download.
// Keeps the request flowing through Express so auth still applies.
async function streamObjectToRes(key, res, filename) {
  if (!isConfigured()) {
    res.status(503).json({ error: 'R2 storage not configured on the server' });
    return false;
  }
  try {
    const { url, headers } = signRequest('GET', key, '', null);
    const r2res = await fetch(url, { method: 'GET', headers });
    if (r2res.status === 404) { res.status(404).json({ error: 'Clip not found in R2' }); return false; }
    if (!r2res.ok) {
      const txt = await r2res.text().catch(() => '');
      res.status(502).json({ error: 'R2 fetch failed: ' + r2res.status + ' ' + txt.slice(0, 200) });
      return false;
    }
    const ct = r2res.headers.get('content-type') || 'video/mp4';
    const cl = r2res.headers.get('content-length');
    res.setHeader('Content-Type', ct);
    if (cl) res.setHeader('Content-Length', cl);
    if (filename) res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
    // Node Readable.fromWeb gives us a usable stream.
    const { Readable } = require('stream');
    if (r2res.body) {
      Readable.fromWeb(r2res.body).pipe(res);
    } else {
      const buf = Buffer.from(await r2res.arrayBuffer());
      res.end(buf);
    }
    return true;
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: 'R2 stream error: ' + (e.message || e) });
    return false;
  }
}

module.exports = {
  isConfigured,
  putObject,
  getObject,
  headObject,
  deleteObject,
  streamObjectToRes,
  bucket: () => BUCKET,
  accountId: () => ACCOUNT_ID,
};
