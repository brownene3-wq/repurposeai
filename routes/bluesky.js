const express = require('express');
const router = express.Router();
const https = require('https');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');

const BASE_URL = process.env.BASE_URL || 'https://splicora.ai';

function httpsPostJson(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(d)); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

// Bluesky uses AT Protocol — connect via handle + app password
router.get('/connect', requireAuth, (req, res) => {
  // Render a connection form since Bluesky doesn't have OAuth
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Connect Bluesky — Splicora</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0a;color:#e4e4e7;margin:0;padding:40px;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#18181b;border:1px solid #27272a;border-radius:16px;padding:40px;max-width:480px;width:100%}
h1{margin:0 0 8px;font-size:24px}
p{color:#a1a1aa;margin:0 0 24px;font-size:14px;line-height:1.6}
label{display:block;margin-bottom:6px;font-size:13px;font-weight:600;color:#d4d4d8}
input{width:100%;background:#0a0a0a;border:1px solid #3f3f46;color:#fff;padding:12px 14px;border-radius:8px;font-size:14px;margin-bottom:16px;box-sizing:border-box}
input:focus{outline:none;border-color:#0085ff}
button{width:100%;background:#0085ff;color:#fff;border:0;padding:12px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer}
button:hover{background:#0073e6}
.note{background:#1c2940;border:1px solid #1e40af;border-radius:8px;padding:12px;font-size:12px;color:#93c5fd;margin-bottom:20px}
.note a{color:#60a5fa}
.err{background:#2a1515;border:1px solid #b91c1c;color:#fca5a5;padding:10px;border-radius:8px;font-size:13px;margin-bottom:16px;display:none}
.err.show{display:block}
</style>
</head>
<body>
<div class="card">
<h1>Connect Bluesky</h1>
<p>Bluesky uses app passwords (not OAuth). Create an app password in your Bluesky settings and enter it below.</p>
<div class="note">Get an app password at <a href="https://bsky.app/settings/app-passwords" target="_blank">bsky.app/settings/app-passwords</a>. Your password is stored encrypted and only used to post on your behalf.</div>
<div id="err" class="err"></div>
<form id="f">
<label>Handle (e.g. yourname.bsky.social)</label>
<input type="text" id="handle" placeholder="yourname.bsky.social" required>
<label>App Password</label>
<input type="password" id="password" placeholder="xxxx-xxxx-xxxx-xxxx" required>
<button type="submit">Connect Bluesky</button>
</form>
</div>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const handle = document.getElementById('handle').value.trim();
  const password = document.getElementById('password').value;
  const err = document.getElementById('err');
  err.classList.remove('show');
  try {
    const r = await fetch('/auth/bluesky/authenticate', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ handle, password })
    });
    const data = await r.json();
    if (data.success) window.location = data.redirect || '/distribute/connections?success=Bluesky+connected';
    else { err.textContent = data.error || 'Connection failed'; err.classList.add('show'); }
  } catch (ex) { err.textContent = ex.message; err.classList.add('show'); }
});
</script>
</body></html>`;
  res.send(html);
});

router.post('/authenticate', requireAuth, async (req, res) => {
  try {
    const { handle, password } = req.body;
    if (!handle || !password) return res.json({ success: false, error: 'Handle and app password are required' });

    const cleanHandle = handle.replace(/^@/, '').trim();

    // Authenticate with Bluesky PDS via createSession
    const session = await httpsPostJson('https://bsky.social/xrpc/com.atproto.server.createSession', {
      identifier: cleanHandle,
      password: password
    });

    if (!session.accessJwt || session.error) {
      return res.json({ success: false, error: session.message || 'Invalid handle or app password' });
    }

    const { accessJwt, refreshJwt, did } = session;
    // Bluesky access tokens typically last ~2 hours; refresh tokens are long-lived
    const expiresAt = new Date(Date.now() + (2 * 60 * 60 * 1000));

    const db = getDb();
    const { connectedAccountOps } = db;
    try {
      const existing = await connectedAccountOps.getByUserAndPlatform(req.user.id, 'bluesky');
      if (existing.length > 0) {
        await connectedAccountOps.update(existing[0].id, {
          accessToken: accessJwt, refreshToken: refreshJwt,
          tokenExpiresAt: expiresAt, platformUsername: cleanHandle,
          accountName: cleanHandle
        });
      } else {
        await connectedAccountOps.create(req.user.id, {
          platform: 'bluesky', platformUserId: did,
          platformUsername: cleanHandle, accountName: cleanHandle,
          accessToken: accessJwt, refreshToken: refreshJwt,
          tokenExpiresAt: expiresAt, accountType: 'source_destination'
        });
      }
      res.json({ success: true, redirect: '/distribute/connections?success=Bluesky+connected+as+' + encodeURIComponent(cleanHandle) });
    } catch (e) {
      console.error('Bluesky save error:', e.message);
      res.json({ success: false, error: 'Failed to save connection' });
    }
  } catch (err) {
    console.error('Bluesky auth error:', err.message || err);
    res.json({ success: false, error: err.message || 'Authentication failed' });
  }
});

module.exports = router;
