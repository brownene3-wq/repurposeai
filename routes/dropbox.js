const express = require('express');
const router = express.Router();
const https = require('https');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');

const DROPBOX_CLIENT_ID = process.env.DROPBOX_CLIENT_ID || '';
const DROPBOX_CLIENT_SECRET = process.env.DROPBOX_CLIENT_SECRET || '';
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
  if (!DROPBOX_CLIENT_ID) return res.status(500).send('Dropbox integration not configured. Set DROPBOX_CLIENT_ID env var.');
  const state = Buffer.from(JSON.stringify({ userId: req.user.id, redirect: req.query.redirect || '/distribute/connections' })).toString('base64url');
  const params = new URLSearchParams({
    client_id: DROPBOX_CLIENT_ID,
    response_type: 'code',
    redirect_uri: BASE_URL + '/auth/dropbox/callback',
    state: state,
    token_access_type: 'offline'
  });
  res.redirect('https://www.dropbox.com/oauth2/authorize?' + params.toString());
});

router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error || !code) return res.redirect('/distribute/connections?error=Dropbox+connection+cancelled');

    let userId, redirectTo = '/distribute/connections';
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
      userId = stateData.userId;
      redirectTo = stateData.redirect || '/distribute/connections';
    } catch (e) { return res.redirect('/distribute/connections?error=Invalid+auth+state'); }

    const tokenData = await httpsPost('https://api.dropboxapi.com/oauth2/token', {
      code: code,
      grant_type: 'authorization_code',
      client_id: DROPBOX_CLIENT_ID,
      client_secret: DROPBOX_CLIENT_SECRET,
      redirect_uri: BASE_URL + '/auth/dropbox/callback'
    });

    if (tokenData.error || !tokenData.access_token) {
      console.error('Dropbox token exchange failed:', JSON.stringify(tokenData));
      return res.redirect('/distribute/connections?error=Dropbox+auth+failed');
    }

    const { access_token, refresh_token, expires_in, account_id } = tokenData;
    const expiresAt = expires_in ? new Date(Date.now() + (expires_in * 1000)) : null;

    let accountName = '', accountEmail = '';
    try {
      const acct = await httpsPostJson('https://api.dropboxapi.com/2/users/get_current_account', null, {
        Authorization: 'Bearer ' + access_token
      });
      accountName = acct.name?.display_name || '';
      accountEmail = acct.email || '';
    } catch (e) { console.error('Dropbox acct info error:', e.message); }

    const db = getDb();
    const { connectedAccountOps } = db;
    try {
      const existing = await connectedAccountOps.getByUserAndPlatform(userId, 'dropbox');
      if (existing.length > 0) {
        await connectedAccountOps.update(existing[0].id, {
          accessToken: access_token, refreshToken: refresh_token,
          tokenExpiresAt: expiresAt, platformUsername: accountEmail || accountName,
          accountName: accountName || accountEmail || 'Dropbox'
        });
      } else {
        await connectedAccountOps.create(userId, {
          platform: 'dropbox', platformUserId: account_id,
          platformUsername: accountEmail || accountName,
          accountName: accountName || accountEmail || 'Dropbox',
          accessToken: access_token, refreshToken: refresh_token,
          tokenExpiresAt: expiresAt, accountType: 'source_destination'
        });
      }
    } catch (e) { console.error('Connected account save error:', e.message); }

    res.redirect(redirectTo + (redirectTo.includes('?') ? '&' : '?') + 'success=Dropbox+connected' + (accountName ? '+as+' + encodeURIComponent(accountName) : ''));
  } catch (err) {
    console.error('Dropbox OAuth error:', err.message || err);
    res.redirect('/distribute/connections?error=Dropbox+connection+failed');
  }
});

module.exports = router;
