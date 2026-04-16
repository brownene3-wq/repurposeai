const express = require('express');
const router = express.Router();
const https = require('https');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');
const { renderApiKeyForm } = require('./heygen');

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

router.get('/connect', requireAuth, (req, res) => {
  res.send(renderApiKeyForm(
    'Libsyn',
    'Libsyn uses API credentials for publishing. Generate an API key in your Libsyn dashboard under API Access.',
    'https://four.libsyn.com/account/api'
  ));
});

router.post('/authenticate', requireAuth, async (req, res) => {
  try {
    const { apiKey, label } = req.body;
    if (!apiKey) return res.json({ success: false, error: 'API key is required' });

    const db = getDb();
    const { connectedAccountOps } = db;
    const accountName = label || 'Libsyn Account';
    try {
      const existing = await connectedAccountOps.getByUserAndPlatform(req.user.id, 'libsyn');
      if (existing.length > 0) {
        await connectedAccountOps.update(existing[0].id, {
          accessToken: apiKey, refreshToken: null,
          tokenExpiresAt: null, platformUsername: accountName,
          accountName: accountName
        });
      } else {
        await connectedAccountOps.create(req.user.id, {
          platform: 'libsyn', platformUserId: null,
          platformUsername: accountName, accountName: accountName,
          accessToken: apiKey, refreshToken: null,
          tokenExpiresAt: null, accountType: 'destination'
        });
      }
      res.json({ success: true, redirect: '/distribute/connections?success=Libsyn+connected' });
    } catch (e) {
      console.error('Libsyn save error:', e.message);
      res.json({ success: false, error: 'Failed to save connection' });
    }
  } catch (err) {
    console.error('Libsyn auth error:', err.message || err);
    res.json({ success: false, error: err.message || 'Authentication failed' });
  }
});

module.exports = router;
