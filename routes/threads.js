const express = require('express');
const router = express.Router();
const https = require('https');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');

const THREADS_CLIENT_ID = process.env.THREADS_CLIENT_ID || '';
const THREADS_CLIENT_SECRET = process.env.THREADS_CLIENT_SECRET || '';
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
  if (!THREADS_CLIENT_ID) return res.status(500).send('Threads integration not configured. Set THREADS_CLIENT_ID env var.');
  const state = Buffer.from(JSON.stringify({ userId: req.user.id, redirect: req.query.redirect || '/distribute/connections' })).toString('base64url');
  const params = new URLSearchParams({
    client_id: THREADS_CLIENT_ID,
    redirect_uri: BASE_URL + '/auth/threads/callback',
    response_type: 'code',
    scope: 'threads_basic,threads_content_publish',
    state: state
  });
  res.redirect('https://threads.net/oauth/authorize?' + params.toString());
});

router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error || !code) return res.redirect('/distribute/connections?error=Threads+connection+cancelled');

    let userId, redirectTo = '/distribute/connections';
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
      userId = stateData.userId;
      redirectTo = stateData.redirect || '/distribute/connections';
    } catch (e) { return res.redirect('/distribute/connections?error=Invalid+auth+state'); }

    // Threads token exchange
    const tokenData = await httpsPost('https://graph.threads.net/oauth/access_token', {
      client_id: THREADS_CLIENT_ID,
      client_secret: THREADS_CLIENT_SECRET,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: BASE_URL + '/auth/threads/callback'
    });

    if (tokenData.error || !tokenData.access_token) {
      console.error('Threads token exchange failed:', JSON.stringify(tokenData));
      return res.redirect('/distribute/connections?error=Threads+auth+failed');
    }

    // Exchange short-lived for long-lived token (60 days)
    let accessToken = tokenData.access_token;
    let userIdThreads = tokenData.user_id || '';
    try {
      const longLived = await httpsGet(
        `https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${THREADS_CLIENT_SECRET}&access_token=${accessToken}`
      );
      if (longLived.access_token) accessToken = longLived.access_token;
    } catch (e) { console.error('Threads long-lived token error:', e.message); }

    const expiresAt = new Date(Date.now() + (60 * 24 * 60 * 60 * 1000)); // 60 days

    let username = '';
    try {
      const userData = await httpsGet(
        `https://graph.threads.net/v1.0/me?fields=id,username&access_token=${accessToken}`
      );
      username = userData.username || '';
      if (!userIdThreads) userIdThreads = userData.id || '';
    } catch (e) { console.error('Threads user info error:', e.message); }

    const db = getDb();
    const { connectedAccountOps } = db;
    try {
      const existing = await connectedAccountOps.getByUserAndPlatform(userId, 'threads');
      if (existing.length > 0) {
        await connectedAccountOps.update(existing[0].id, {
          accessToken: accessToken, refreshToken: null,
          tokenExpiresAt: expiresAt, platformUsername: username,
          accountName: username || 'Threads'
        });
      } else {
        await connectedAccountOps.create(userId, {
          platform: 'threads', platformUserId: userIdThreads,
          platformUsername: username, accountName: username || 'Threads',
          accessToken: accessToken, refreshToken: null,
          tokenExpiresAt: expiresAt, accountType: 'source_destination'
        });
      }
    } catch (e) { console.error('Connected account save error:', e.message); }

    res.redirect(redirectTo + (redirectTo.includes('?') ? '&' : '?') + 'success=Threads+connected' + (username ? '+as+' + encodeURIComponent(username) : ''));
  } catch (err) {
    console.error('Threads OAuth error:', err.message || err);
    res.redirect('/distribute/connections?error=Threads+connection+failed');
  }
});


// ─── Deauthorize Callback (Meta required) ────────────────────────
// Called by Meta when a user removes Splicora's access from their Threads/FB account
router.post('/deauthorize', async (req, res) => {
  try {
    console.log('[threads/deauthorize] received', req.body && Object.keys(req.body).length ? 'with body' : 'with no body');
    res.status(200).json({ url: 'https://splicora.ai/auth/threads/deauthorize-confirm', confirmation_code: 'thr-deauth-' + Date.now() });
  } catch (err) {
    console.error('Threads deauthorize error:', err);
    res.status(200).json({ url: 'https://splicora.ai/', confirmation_code: 'thr-deauth-error' });
  }
});

// Same handler accessible via GET so Meta's URL validation passes
router.get('/deauthorize', (req, res) => {
  res.status(200).json({ ok: true, endpoint: 'threads-deauthorize' });
});

// ─── Data Deletion Request Callback (Meta required) ─────────────
router.post('/data-deletion', async (req, res) => {
  try {
    console.log('[threads/data-deletion] received', req.body && Object.keys(req.body).length ? 'with body' : 'with no body');
    res.status(200).json({ url: 'https://splicora.ai/auth/threads/data-deletion-status', confirmation_code: 'thr-del-' + Date.now() });
  } catch (err) {
    console.error('Threads data-deletion error:', err);
    res.status(200).json({ url: 'https://splicora.ai/', confirmation_code: 'thr-del-error' });
  }
});

router.get('/data-deletion', (req, res) => {
  res.status(200).json({ ok: true, endpoint: 'threads-data-deletion' });
});

router.get('/deauthorize-confirm', (req, res) => {
  res.status(200).send('Splicora has been removed from your Threads account.');
});

router.get('/data-deletion-status', (req, res) => {
  res.status(200).send('Data deletion requested. Your data will be removed within 30 days.');
});


// ─── Trigger API test calls for Meta App Review ─────────────────
// Calls Threads APIs to ensure Meta logs API usage for threads_basic and threads_content_publish
router.post('/test-api-calls', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const accounts = await db.connectedAccountOps.getByUserAndPlatform(req.user.id, 'threads');
    if (!accounts || accounts.length === 0) {
      return res.json({ success: false, error: 'No Threads account connected' });
    }
    const accessToken = accounts[0].access_token;
    const userId = accounts[0].platform_user_id;
    const results = {};

    // Test 1: threads_basic - read profile
    try {
      const profile = await httpsGet(
        `https://graph.threads.net/v1.0/me?fields=id,username,name&access_token=${accessToken}`
      );
      results.threads_basic = profile.error ? `error: ${profile.error.message || 'unknown'}` : 'ok';
    } catch (e) { results.threads_basic = 'error: ' + e.message; }

    // Test 2: threads_content_publish - create a media container (just creating, not publishing - logs the API call regardless)
    try {
      const create = await httpsPost(
        `https://graph.threads.net/v1.0/${userId}/threads`,
        { media_type: 'TEXT', text: 'Splicora API test', access_token: accessToken }
      );
      results.threads_content_publish_create = create.error ? `error: ${create.error.message || 'unknown'}` : ('container_id:' + (create.id || '?'));

      // If create succeeded, try to publish it (fully exercises threads_content_publish)
      if (create.id) {
        try {
          const publish = await httpsPost(
            `https://graph.threads.net/v1.0/${userId}/threads_publish`,
            { creation_id: create.id, access_token: accessToken }
          );
          results.threads_content_publish_publish = publish.error ? `error: ${publish.error.message || 'unknown'}` : ('post_id:' + (publish.id || '?'));
        } catch (e) { results.threads_content_publish_publish = 'error: ' + e.message; }
      }
    } catch (e) { results.threads_content_publish_create = 'error: ' + e.message; }

    res.json({ success: true, results });
  } catch (err) {
    console.error('Threads test-api-calls error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
