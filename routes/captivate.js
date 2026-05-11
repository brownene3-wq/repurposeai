const express = require('express');
const router = express.Router();
const https = require('https');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');
const { renderApiKeyForm } = require('./heygen');

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

router.get('/connect', requireAuth, (req, res) => {
  // Captivate uses user_id + api_key. Render a custom form.
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Connect Captivate.fm — Splicora</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0a;color:#e4e4e7;margin:0;padding:40px;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#18181b;border:1px solid #27272a;border-radius:16px;padding:40px;max-width:480px;width:100%}
h1{margin:0 0 8px;font-size:24px}
p{color:#a1a1aa;margin:0 0 24px;font-size:14px;line-height:1.6}
label{display:block;margin-bottom:6px;font-size:13px;font-weight:600;color:#d4d4d8}
input{width:100%;background:#0a0a0a;border:1px solid #3f3f46;color:#fff;padding:12px 14px;border-radius:8px;font-size:14px;margin-bottom:16px;box-sizing:border-box}
input:focus{outline:none;border-color:#0085ff}
button{width:100%;background:#0085ff;color:#fff;border:0;padding:12px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer}
.note{background:#1c2940;border:1px solid #1e40af;border-radius:8px;padding:12px;font-size:12px;color:#93c5fd;margin-bottom:20px}
.note a{color:#60a5fa}
.err{background:#2a1515;border:1px solid #b91c1c;color:#fca5a5;padding:10px;border-radius:8px;font-size:13px;margin-bottom:16px;display:none}
.err.show{display:block}
</style></head><body>
<div class="card">
<h1>Connect Captivate.fm</h1>
<p>Captivate.fm uses user ID + API key. Find both in your Captivate dashboard under Developer.</p>
<div class="note">Get credentials at <a href="https://my.captivate.fm/" target="_blank">my.captivate.fm</a></div>
<div id="err" class="err"></div>
<form id="f">
<label>User ID</label>
<input type="text" id="userid" placeholder="Your Captivate user ID" required>
<label>API Key</label>
<input type="password" id="apikey" placeholder="Your API key" required>
<button type="submit">Connect Captivate.fm</button>
</form>
</div>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const userId = document.getElementById('userid').value.trim();
  const apiKey = document.getElementById('apikey').value.trim();
  const err = document.getElementById('err');
  err.classList.remove('show');
  try {
    const r = await fetch('/auth/captivate/authenticate', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ userId, apiKey })
    });
    const data = await r.json();
    if (data.success) window.location = data.redirect;
    else { err.textContent = data.error || 'Connection failed'; err.classList.add('show'); }
  } catch (ex) { err.textContent = ex.message; err.classList.add('show'); }
});
</script></body></html>`;
  res.send(html);
});

router.post('/authenticate', requireAuth, async (req, res) => {
  try {
    const { userId: capUserId, apiKey } = req.body;
    if (!capUserId || !apiKey) return res.json({ success: false, error: 'User ID and API key are required' });

    // Verify by authenticating
    let token = null;
    try {
      const authResp = await httpsPostJson('https://api.captivate.fm/authenticate/token', {
        username: capUserId, token: apiKey
      });
      if (authResp.user && authResp.user.token) token = authResp.user.token;
    } catch (e) { console.error('Captivate auth verify error:', e.message); }

    const db = getDb();
    const { connectedAccountOps } = db;
    const accountName = 'Captivate.fm';
    try {
      // Store apiKey as accessToken, capUserId in platformUserId
      const existing = await connectedAccountOps.getByUserAndPlatform(req.user.id, 'captivate');
      if (existing.length > 0) {
        await connectedAccountOps.update(existing[0].id, {
          accessToken: token || apiKey, refreshToken: apiKey,
          tokenExpiresAt: null, platformUsername: capUserId,
          accountName: accountName
        });
      } else {
        await connectedAccountOps.create(req.user.id, {
          platform: 'captivate', platformUserId: capUserId,
          platformUsername: capUserId, accountName: accountName,
          accessToken: token || apiKey, refreshToken: apiKey,
          tokenExpiresAt: null, accountType: 'destination'
        });
      }
      res.json({ success: true, redirect: '/distribute/connections?success=Captivate.fm+connected' });
    } catch (e) {
      console.error('Captivate save error:', e.message);
      res.json({ success: false, error: 'Failed to save connection' });
    }
  } catch (err) {
    console.error('Captivate auth error:', err.message || err);
    res.json({ success: false, error: err.message || 'Authentication failed' });
  }
});

module.exports = router;
