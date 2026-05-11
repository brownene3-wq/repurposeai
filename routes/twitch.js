const express = require('express');
const router = express.Router();
const https = require('https');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');

const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || '';
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || '';
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
  if (!TWITCH_CLIENT_ID) return res.status(500).send('Twitch integration not configured. Set TWITCH_CLIENT_ID env var.');
  const state = Buffer.from(JSON.stringify({ userId: req.user.id, redirect: req.query.redirect || '/distribute/connections' })).toString('base64url');
  const params = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    redirect_uri: BASE_URL + '/auth/twitch/callback',
    response_type: 'code',
    scope: 'user:read:email channel:read:stream_key clips:edit',
    state: state
  });
  res.redirect('https://id.twitch.tv/oauth2/authorize?' + params.toString());
});

router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error || !code) return res.redirect('/distribute/connections?error=Twitch+connection+cancelled');

    let userId, redirectTo = '/distribute/connections';
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
      userId = stateData.userId;
      redirectTo = stateData.redirect || '/distribute/connections';
    } catch (e) { return res.redirect('/distribute/connections?error=Invalid+auth+state'); }

    const tokenData = await httpsPost('https://id.twitch.tv/oauth2/token', {
      client_id: TWITCH_CLIENT_ID,
      client_secret: TWITCH_CLIENT_SECRET,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: BASE_URL + '/auth/twitch/callback'
    });

    if (tokenData.error || !tokenData.access_token) {
      console.error('Twitch token exchange failed:', JSON.stringify(tokenData));
      return res.redirect('/distribute/connections?error=Twitch+auth+failed');
    }

    const { access_token, refresh_token, expires_in } = tokenData;
    const expiresAt = expires_in ? new Date(Date.now() + (expires_in * 1000)) : null;

    let username = '', twitchId = '';
    try {
      const userData = await httpsGet('https://api.twitch.tv/helix/users', {
        Authorization: 'Bearer ' + access_token,
        'Client-Id': TWITCH_CLIENT_ID
      });
      if (userData.data && userData.data[0]) {
        username = userData.data[0].display_name || userData.data[0].login || '';
        twitchId = userData.data[0].id || '';
      }
    } catch (e) { console.error('Twitch user info error:', e.message); }

    const db = getDb();
    const { connectedAccountOps } = db;
    try {
      const existing = await connectedAccountOps.getByUserAndPlatform(userId, 'twitch');
      if (existing.length > 0) {
        await connectedAccountOps.update(existing[0].id, {
          accessToken: access_token, refreshToken: refresh_token,
          tokenExpiresAt: expiresAt, platformUsername: username,
          accountName: username || 'Twitch'
        });
      } else {
        await connectedAccountOps.create(userId, {
          platform: 'twitch', platformUserId: twitchId,
          platformUsername: username, accountName: username || 'Twitch',
          accessToken: access_token, refreshToken: refresh_token,
          tokenExpiresAt: expiresAt, accountType: 'source_destination'
        });
      }
    } catch (e) { console.error('Connected account save error:', e.message); }

    res.redirect(redirectTo + (redirectTo.includes('?') ? '&' : '?') + 'success=Twitch+connected' + (username ? '+as+' + encodeURIComponent(username) : ''));
  } catch (err) {
    console.error('Twitch OAuth error:', err.message || err);
    res.redirect('/distribute/connections?error=Twitch+connection+failed');
  }
});

module.exports = router;
