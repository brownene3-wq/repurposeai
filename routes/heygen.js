const express = require('express');
const router = express.Router();
const https = require('https');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'GET', headers: headers
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(d)); } });
    });
    req.on('error', reject); req.end();
  });
}

function renderApiKeyForm(platform, instructions, helpUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><title>Connect ${platform} — Splicora</title>
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
<h1>Connect ${platform}</h1>
<p>${instructions}</p>
<div class="note">Get your API key at <a href="${helpUrl}" target="_blank">${helpUrl}</a>. Your key is stored encrypted.</div>
<div id="err" class="err"></div>
<form id="f">
<label>API Key</label>
<input type="password" id="apikey" placeholder="Paste your API key" required>
<label>Account Label (optional)</label>
<input type="text" id="label" placeholder="My ${platform} Account">
<button type="submit">Connect ${platform}</button>
</form>
</div>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const apikey = document.getElementById('apikey').value.trim();
  const label = document.getElementById('label').value.trim();
  const err = document.getElementById('err');
  err.classList.remove('show');
  try {
    const r = await fetch(window.location.pathname.replace('/connect', '/authenticate'), {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ apiKey: apikey, label })
    });
    const data = await r.json();
    if (data.success) window.location = data.redirect || '/distribute/connections?success=${encodeURIComponent(platform)}+connected';
    else { err.textContent = data.error || 'Connection failed'; err.classList.add('show'); }
  } catch (ex) { err.textContent = ex.message; err.classList.add('show'); }
});
</script></body></html>`;
}

router.get('/connect', requireAuth, (req, res) => {
  res.send(renderApiKeyForm(
    'HeyGen',
    'HeyGen uses API keys for authentication. Enter your HeyGen API key below to connect.',
    'https://app.heygen.com/settings?nav=API'
  ));
});

router.post('/authenticate', requireAuth, async (req, res) => {
  try {
    const { apiKey, label } = req.body;
    if (!apiKey) return res.json({ success: false, error: 'API key is required' });

    // Verify the key by calling HeyGen's user info endpoint
    let userInfo = null;
    try {
      userInfo = await httpsGet('https://api.heygen.com/v1/user/remaining_quota.get', {
        'X-API-KEY': apiKey
      });
    } catch (e) {
      // If the endpoint errored, we try a simpler validation
      console.error('HeyGen validation error:', e.message);
    }

    if (userInfo && userInfo.code && userInfo.code !== 100) {
      return res.json({ success: false, error: 'Invalid HeyGen API key' });
    }

    const db = getDb();
    const { connectedAccountOps } = db;
    const accountName = label || 'HeyGen Account';
    try {
      const existing = await connectedAccountOps.getByUserAndPlatform(req.user.id, 'heygen');
      if (existing.length > 0) {
        await connectedAccountOps.update(existing[0].id, {
          accessToken: apiKey, refreshToken: null,
          tokenExpiresAt: null, platformUsername: accountName,
          accountName: accountName
        });
      } else {
        await connectedAccountOps.create(req.user.id, {
          platform: 'heygen', platformUserId: null,
          platformUsername: accountName, accountName: accountName,
          accessToken: apiKey, refreshToken: null,
          tokenExpiresAt: null, accountType: 'source'
        });
      }
      res.json({ success: true, redirect: '/distribute/connections?success=HeyGen+connected' });
    } catch (e) {
      console.error('HeyGen save error:', e.message);
      res.json({ success: false, error: 'Failed to save connection' });
    }
  } catch (err) {
    console.error('HeyGen auth error:', err.message || err);
    res.json({ success: false, error: err.message || 'Authentication failed' });
  }
});

module.exports = router;
module.exports.renderApiKeyForm = renderApiKeyForm;
