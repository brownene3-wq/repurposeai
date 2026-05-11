const express = require('express');
const router = express.Router();
const https = require('https');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');

const ZOOM_CLIENT_ID = process.env.ZOOM_CLIENT_ID || '';
const ZOOM_CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET || '';
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

router.get('/connect', requireAuth, (req, res) => {
  if (!ZOOM_CLIENT_ID) return res.status(500).send('Zoom integration not configured. Set ZOOM_CLIENT_ID env var.');
  const state = Buffer.from(JSON.stringify({ userId: req.user.id, redirect: req.query.redirect || '/distribute/connections' })).toString('base64url');
  const params = new URLSearchParams({
    client_id: ZOOM_CLIENT_ID,
    redirect_uri: BASE_URL + '/auth/zoom/callback',
    response_type: 'code',
    state: state
  });
  res.redirect('https://zoom.us/oauth/authorize?' + params.toString());
});

router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error || !code) return res.redirect('/distribute/connections?error=Zoom+connection+cancelled');

    let userId, redirectTo = '/distribute/connections';
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
      userId = stateData.userId;
      redirectTo = stateData.redirect || '/distribute/connections';
    } catch (e) { return res.redirect('/distribute/connections?error=Invalid+auth+state'); }

    const basicAuth = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString('base64');
    const tokenData = await httpsPost('https://zoom.us/oauth/token', {
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: BASE_URL + '/auth/zoom/callback'
    }, { Authorization: 'Basic ' + basicAuth });

    if (tokenData.error || !tokenData.access_token) {
      console.error('Zoom token exchange failed:', JSON.stringify(tokenData));
      return res.redirect('/distribute/connections?error=Zoom+auth+failed');
    }

    const { access_token, refresh_token, expires_in } = tokenData;
    const expiresAt = expires_in ? new Date(Date.now() + (expires_in * 1000)) : null;

    let email = '', zoomId = '', displayName = '';
    try {
      const me = await httpsGet('https://api.zoom.us/v2/users/me', { Authorization: 'Bearer ' + access_token });
      email = me.email || '';
      zoomId = me.id || '';
      displayName = me.display_name || `${me.first_name || ''} ${me.last_name || ''}`.trim();
    } catch (e) { console.error('Zoom user info error:', e.message); }

    const db = getDb();
    const { connectedAccountOps } = db;
    try {
      const existing = await connectedAccountOps.getByUserAndPlatform(userId, 'zoom');
      if (existing.length > 0) {
        await connectedAccountOps.update(existing[0].id, {
          accessToken: access_token, refreshToken: refresh_token,
          tokenExpiresAt: expiresAt, platformUsername: email,
          accountName: displayName || email || 'Zoom'
        });
      } else {
        await connectedAccountOps.create(userId, {
          platform: 'zoom', platformUserId: zoomId,
          platformUsername: email, accountName: displayName || email || 'Zoom',
          accessToken: access_token, refreshToken: refresh_token,
          tokenExpiresAt: expiresAt, accountType: 'source'
        });
      }
    } catch (e) { console.error('Connected account save error:', e.message); }

    res.redirect(redirectTo + (redirectTo.includes('?') ? '&' : '?') + 'success=Zoom+connected' + (email ? '+as+' + encodeURIComponent(email) : ''));
  } catch (err) {
    console.error('Zoom OAuth error:', err.message || err);
    res.redirect('/distribute/connections?error=Zoom+connection+failed');
  }
});

module.exports = router;
