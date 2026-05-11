const express = require('express');
const router = express.Router();
const https = require('https');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url);
      const opts = {
        hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'GET',
        headers: { 'User-Agent': 'Splicora/1.0', ...headers }
      };
      const req = https.request(opts, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve({ status: res.statusCode, body: d }));
      });
      req.on('error', reject);
      req.end();
    } catch (e) { reject(e); }
  });
}

function renderRssForm(platform) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Connect ${platform} — Splicora</title>
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
.err{background:#2a1515;border:1px solid #b91c1c;color:#fca5a5;padding:10px;border-radius:8px;font-size:13px;margin-bottom:16px;display:none}
.err.show{display:block}
</style></head><body>
<div class="card">
<h1>Connect ${platform}</h1>
<p>Paste your podcast RSS feed URL. Splicora will pull new episodes from this feed as source content.</p>
<div class="note">Your RSS feed URL is provided by your podcast host (Spotify for Podcasters, Apple Podcasts, Buzzsprout, etc.)</div>
<div id="err" class="err"></div>
<form id="f">
<label>RSS Feed URL</label>
<input type="url" id="rss" placeholder="https://feeds.example.com/podcast.xml" required>
<label>Podcast Label (optional)</label>
<input type="text" id="label" placeholder="My Podcast">
<button type="submit">Connect ${platform}</button>
</form>
</div>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const rssUrl = document.getElementById('rss').value.trim();
  const label = document.getElementById('label').value.trim();
  const err = document.getElementById('err');
  err.classList.remove('show');
  try {
    const r = await fetch(window.location.pathname.replace('/connect', '/authenticate'), {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ rssUrl, label })
    });
    const data = await r.json();
    if (data.success) window.location = data.redirect;
    else { err.textContent = data.error || 'Connection failed'; err.classList.add('show'); }
  } catch (ex) { err.textContent = ex.message; err.classList.add('show'); }
});
</script></body></html>`;
}

function extractRssTitle(xml) {
  const m = xml.match(/<channel>[\s\S]*?<title>\s*(?:<!\[CDATA\[)?([^<\]]+?)(?:\]\]>)?\s*<\/title>/i);
  return m ? m[1].trim() : '';
}

async function connectRssFeed(req, res, platform) {
  try {
    const { rssUrl, label } = req.body;
    if (!rssUrl) return res.json({ success: false, error: 'RSS feed URL is required' });

    let feedTitle = '';
    try {
      const resp = await httpsGet(rssUrl);
      if (resp.status >= 400) return res.json({ success: false, error: `Feed returned HTTP ${resp.status}` });
      if (!resp.body.includes('<rss') && !resp.body.includes('<feed')) {
        return res.json({ success: false, error: 'Not a valid RSS/Atom feed' });
      }
      feedTitle = extractRssTitle(resp.body);
    } catch (e) {
      return res.json({ success: false, error: 'Failed to fetch feed: ' + e.message });
    }

    const accountName = label || feedTitle || platform;
    const db = getDb();
    const { connectedAccountOps } = db;
    try {
      const existing = await connectedAccountOps.getByUserAndPlatform(req.user.id, platform);
      if (existing.length > 0) {
        await connectedAccountOps.update(existing[0].id, {
          accessToken: rssUrl, refreshToken: null,
          tokenExpiresAt: null, platformUsername: feedTitle || accountName,
          accountName: accountName
        });
      } else {
        await connectedAccountOps.create(req.user.id, {
          platform: platform, platformUserId: null,
          platformUsername: feedTitle || accountName, accountName: accountName,
          accessToken: rssUrl, refreshToken: null,
          tokenExpiresAt: null, accountType: 'source'
        });
      }
      res.json({ success: true, redirect: `/distribute/connections?success=${encodeURIComponent(platform + ' connected')}` });
    } catch (e) {
      console.error(`${platform} save error:`, e.message);
      res.json({ success: false, error: 'Failed to save connection' });
    }
  } catch (err) {
    console.error(`${platform} auth error:`, err.message || err);
    res.json({ success: false, error: err.message || 'Authentication failed' });
  }
}

router.get('/connect', requireAuth, (req, res) => {
  res.send(renderRssForm('Audio Podcast'));
});

router.post('/authenticate', requireAuth, async (req, res) => {
  await connectRssFeed(req, res, 'audiopodcast');
});

module.exports = router;
module.exports.renderRssForm = renderRssForm;
module.exports.connectRssFeed = connectRssFeed;
