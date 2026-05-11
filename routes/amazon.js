const express = require('express');
const router = express.Router();
const https = require('https');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');

const AMAZON_CLIENT_ID = process.env.AMAZON_CLIENT_ID || '';
const AMAZON_CLIENT_SECRET = process.env.AMAZON_CLIENT_SECRET || '';
const BASE_URL = process.env.BASE_URL || 'https://splicora.ai';

function httpsPost(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = typeof data === 'string' ? data : new URLSearchParams(data).toString();
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), ...headers }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(d)); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

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

// Amazon Login with Amazon (LWA) OAuth
router.get('/connect', requireAuth, (req, res) => {
  if (!AMAZON_CLIENT_ID) return res.status(500).send('Amazon integration not configured. Set AMAZON_CLIENT_ID env var.');
  const state = Buffer.from(JSON.stringify({ userId: req.user.id, redirect: req.query.redirect || '/distribute/connections' })).toString('base64url');
  const params = new URLSearchParams({
    client_id: AMAZON_CLIENT_ID,
    scope: 'profile',
    response_type: 'code',
    redirect_uri: BASE_URL + '/auth/amazon/callback',
    state: state
  });
  res.redirect('https://www.amazon.com/ap/oa?' + params.toString());
});

router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error || !code) return res.redirect('/distribute/connections?error=Amazon+connection+cancelled');

    let userId, redirectTo = '/distribute/connections';
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
      userId = stateData.userId;
      redirectTo = stateData.redirect || '/distribute/connections';
    } catch (e) { return res.redirect('/distribute/connections?error=Invalid+auth+state'); }

    const tokenData = await httpsPost('https://api.amazon.com/auth/o2/token', {
      grant_type: 'authorization_code',
      code: code,
      client_id: AMAZON_CLIENT_ID,
      client_secret: AMAZON_CLIENT_SECRET,
      redirect_uri: BASE_URL + '/auth/amazon/callback'
    });

    if (tokenData.error || !tokenData.access_token) {
      console.error('Amazon token exchange failed:', JSON.stringify(tokenData));
      return res.redirect('/distribute/connections?error=Amazon+auth+failed');
    }

    const { access_token, refresh_token, expires_in } = tokenData;
    const expiresAt = expires_in ? new Date(Date.now() + (expires_in * 1000)) : null;

    let email = '', name = '', amazonUserId = '';
    try {
      const profile = await httpsGet('https://api.amazon.com/user/profile', { Authorization: 'Bearer ' + access_token });
      email = profile.email || '';
      name = profile.name || '';
      amazonUserId = profile.user_id || '';
    } catch (e) { console.error('Amazon profile error:', e.message); }

    const db = getDb();
    const { connectedAccountOps } = db;
    try {
      const existing = await connectedAccountOps.getByUserAndPlatform(userId, 'amazon');
      if (existing.length > 0) {
        await connectedAccountOps.update(existing[0].id, {
          accessToken: access_token, refreshToken: refresh_token,
          tokenExpiresAt: expiresAt, platformUsername: email,
          accountName: name || email || 'Amazon'
        });
      } else {
        await connectedAccountOps.create(userId, {
          platform: 'amazon', platformUserId: amazonUserId,
          platformUsername: email, accountName: name || email || 'Amazon',
          accessToken: access_token, refreshToken: refresh_token,
          tokenExpiresAt: expiresAt, accountType: 'destination'
        });
      }
    } catch (e) { console.error('Connected account save error:', e.message); }

    res.redirect(redirectTo + (redirectTo.includes('?') ? '&' : '?') + 'success=Amazon+connected' + (email ? '+as+' + encodeURIComponent(email) : ''));
  } catch (err) {
    console.error('Amazon OAuth error:', err.message || err);
    res.redirect('/distribute/connections?error=Amazon+connection+failed');
  }
});

module.exports = router;
