const express = require('express');
const router = express.Router();
const https = require('https');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');

const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID || '';
const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET || '';
const BASE_URL = process.env.BASE_URL || 'https://splicora.ai';

// ─── HTTP helpers (matching auth.js pattern) ──────────────────────

function httpsPost(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = typeof data === 'string' ? data : new URLSearchParams(data).toString();
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), ...headers }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(d)); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpsPostJson(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(d)); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: headers
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(d)); } });
    });
    req.on('error', reject);
    req.end();
  });
}

// ─── PKCE Helper Functions ───────────────────────────────────────

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// ─── Twitter OAuth 2.0 (with PKCE) ──────────────────────────────

// Step 1: Redirect user to Twitter authorization
router.get('/connect', requireAuth, (req, res) => {
  if (!TWITTER_CLIENT_ID) {
    return res.status(500).send('Twitter integration not configured. Set TWITTER_CLIENT_ID env var.');
  }

  // Generate PKCE code verifier and challenge
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // Store code verifier and user ID in secure httpOnly cookie for the callback
  const stateData = Buffer.from(JSON.stringify({ userId: req.user.id, codeVerifier, redirect: req.query.redirect || '/distribute/connections' })).toString('base64url');
  res.cookie('twitter_auth_state', stateData, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600000 // 10 minutes
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: TWITTER_CLIENT_ID,
    redirect_uri: BASE_URL + '/auth/twitter/callback',
    scope: 'tweet.read tweet.write users.read offline.access',
    state: Buffer.from(JSON.stringify({ userId: req.user.id, redirect: req.query.redirect || '/distribute/connections' })).toString('base64url'),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });

  res.redirect('https://twitter.com/i/oauth2/authorize?' + params.toString());
});

// Step 2: Handle Twitter callback — exchange code for tokens
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error || !code) {
      console.error('Twitter auth error:', error || 'no code');
      return res.redirect('/distribute/connections?error=Twitter+connection+cancelled');
    }

    // Decode state to get userId and redirect
    let userId, redirectTo = '/distribute/connections';
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
      userId = stateData.userId;
      redirectTo = stateData.redirect || '/distribute/connections';
    } catch (e) {
      return res.redirect('/distribute/connections?error=Invalid+Twitter+auth+state');
    }

    // Get PKCE code verifier from cookie
    const authStateCookie = req.cookies.twitter_auth_state;
    if (!authStateCookie) {
      return res.redirect('/settings?error=Missing+Twitter+auth+session');
    }

    let codeVerifier;
    try {
      const authState = JSON.parse(Buffer.from(authStateCookie, 'base64url').toString());
      codeVerifier = authState.codeVerifier;
    } catch (e) {
      return res.redirect('/distribute/connections?error=Invalid+Twitter+auth+cookie');
    }

    // Exchange authorization code for access token
    const tokenData = await httpsPost('https://api.twitter.com/2/oauth2/token', {
      code: code,
      grant_type: 'authorization_code',
      client_id: TWITTER_CLIENT_ID,
      client_secret: TWITTER_CLIENT_SECRET,
      redirect_uri: BASE_URL + '/auth/twitter/callback',
      code_verifier: codeVerifier
    });

    if (tokenData.error || !tokenData.access_token) {
      console.error('Twitter token exchange failed:', JSON.stringify(tokenData));
      return res.redirect('/distribute/connections?error=Twitter+auth+failed:+' + encodeURIComponent(tokenData.error_description || tokenData.error || 'unknown'));
    }

    const { access_token, refresh_token, expires_in } = tokenData;
    const expiresAt = new Date(Date.now() + (expires_in * 1000));

    // Fetch user profile
    let username = '';
    let twitterId = '';
    try {
      const profileData = await httpsGet(
        'https://api.twitter.com/2/users/me?user.fields=username,id',
        { Authorization: 'Bearer ' + access_token }
      );
      if (profileData.data) {
        username = profileData.data.username || '';
        twitterId = profileData.data.id || '';
      }
    } catch (e) {
      console.error('Twitter profile fetch error:', e.message);
    }

    // Save Twitter tokens to user account
    const db = getDb();
    const { userOps, connectedAccountOps } = db;
    await userOps.updateTwitter(userId, {
      twitterId: twitterId,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: expiresAt,
      username: username
    });

    // Also save to connected_accounts for Repurpose feature
    try {
      const existing = await connectedAccountOps.getByUserAndPlatform(userId, 'twitter');
      if (existing.length > 0) {
        await connectedAccountOps.update(existing[0].id, {
          accessToken: access_token, refreshToken: refresh_token,
          tokenExpiresAt: expiresAt, platformUsername: username,
          accountName: username || 'Twitter Account'
        });
      } else {
        await connectedAccountOps.create(userId, {
          platform: 'twitter', platformUserId: twitterId,
          platformUsername: username, accountName: username || 'Twitter Account',
          accessToken: access_token, refreshToken: refresh_token,
          tokenExpiresAt: expiresAt, accountType: 'destination'
        });
      }
    } catch (e) { console.error('Connected account save error:', e.message); }

    // Clear the auth state cookie
    res.clearCookie('twitter_auth_state');

    res.redirect(redirectTo + (redirectTo.includes('?') ? '&' : '?') + 'success=Twitter+connected' + (username ? '+as+@' + encodeURIComponent(username) : ''));

  } catch (err) {
    console.error('Twitter OAuth error:', err.message || err);
    res.redirect('/distribute/connections?error=Twitter+connection+failed:+' + encodeURIComponent(err.message || 'unknown'));
  }
});

// ─── Disconnect Twitter ──────────────────────────────────────────

router.post('/disconnect', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    await db.userOps.clearTwitter(req.user.id);
    res.json({ success: true, message: 'Twitter account disconnected' });
  } catch (err) {
    console.error('Twitter disconnect error:', err);
    res.status(500).json({ error: 'Failed to disconnect Twitter' });
  }
});

// ─── Refresh Twitter Token ──────────────────────────────────────

async function refreshTwitterToken(user) {
  if (!user.twitter_refresh_token) throw new Error('No refresh token available');

  const tokenData = await httpsPost('https://api.twitter.com/2/oauth2/token', {
    grant_type: 'refresh_token',
    refresh_token: user.twitter_refresh_token,
    client_id: TWITTER_CLIENT_ID,
    client_secret: TWITTER_CLIENT_SECRET
  });

  if (tokenData.error || !tokenData.access_token) {
    throw new Error('Token refresh failed: ' + (tokenData.error_description || tokenData.error));
  }

  const db = getDb();
  const expiresAt = new Date(Date.now() + (tokenData.expires_in * 1000));
  await db.userOps.updateTwitter(user.id, {
    twitterId: user.twitter_id,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || user.twitter_refresh_token,
    expiresAt: expiresAt,
    username: user.twitter_username
  });

  return tokenData.access_token;
}

// Get a valid access token, refreshing if expired
async function getValidToken(user) {
  if (!user.twitter_access_token) throw new Error('Twitter not connected');

  // Check if token is expired (with 5 min buffer)
  const expiresAt = user.twitter_token_expires_at ? new Date(user.twitter_token_expires_at) : null;
  if (expiresAt && expiresAt.getTime() < Date.now() + 300000) {
    return await refreshTwitterToken(user);
  }

  return user.twitter_access_token;
}

// ─── Twitter Content Posting API ────────────────────────────────

// Check connection status
router.get('/status', requireAuth, async (req, res) => {
  const user = req.user;
  res.json({
    connected: !!user.twitter_id,
    username: user.twitter_username || null,
    twitterId: user.twitter_id || null
  });
});

// Publish a tweet (text + optional media)
router.post('/publish', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user.twitter_id) {
      return res.status(400).json({ error: 'Twitter account not connected. Go to Settings to connect.' });
    }

    const accessToken = await getValidToken(user);
    const { text, media_ids } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Tweet text is required' });
    }

    // Build tweet payload
    const tweetPayload = {
      text: text.trim()
    };

    // Add media if provided (array of media IDs)
    if (media_ids && Array.isArray(media_ids) && media_ids.length > 0) {
      tweetPayload.media = {
        media_ids: media_ids
      };
    }

    // Post tweet to Twitter API v2
    const tweetData = await httpsPostJson(
      'https://api.twitter.com/2/tweets',
      tweetPayload,
      { Authorization: 'Bearer ' + accessToken }
    );

    if (tweetData.errors || !tweetData.data) {
      console.error('Twitter tweet publish failed:', JSON.stringify(tweetData));
      const errorMsg = tweetData.errors?.[0]?.message || tweetData.detail || 'unknown error';
      return res.status(400).json({
        error: 'Failed to publish tweet: ' + errorMsg
      });
    }

    res.json({
      success: true,
      tweetId: tweetData.data.id,
      text: text,
      message: 'Tweet published successfully'
    });

  } catch (err) {
    console.error('Twitter publish error:', err.message || err);
    res.status(500).json({ error: 'Failed to publish tweet: ' + (err.message || 'unknown') });
  }
});

module.exports = router;
