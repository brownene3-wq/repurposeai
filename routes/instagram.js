const express = require('express');
const router = express.Router();
const https = require('https');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');

const INSTAGRAM_CLIENT_ID = process.env.INSTAGRAM_CLIENT_ID || '804406049400199';
const INSTAGRAM_CLIENT_SECRET = process.env.INSTAGRAM_CLIENT_SECRET || '';
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

// ─── Instagram OAuth 2.0 ────────────────────────────────────────

// Step 1: Redirect user to Instagram authorization
router.get('/connect', requireAuth, (req, res) => {
  if (!INSTAGRAM_CLIENT_ID || !INSTAGRAM_CLIENT_SECRET) {
    return res.status(500).send('Instagram integration not configured. Set INSTAGRAM_CLIENT_ID and INSTAGRAM_CLIENT_SECRET env vars.');
  }

  // Store user ID and redirect in state to link the account after callback
  const state = Buffer.from(JSON.stringify({ userId: req.user.id, redirect: req.query.redirect || '/distribute/connections' })).toString('base64url');

  const params = new URLSearchParams({
    client_id: INSTAGRAM_CLIENT_ID,
    redirect_uri: BASE_URL + '/auth/instagram/callback',
    scope: 'instagram_business_basic,instagram_business_content_publish',
    response_type: 'code',
    state: state
  });

  res.redirect('https://www.instagram.com/oauth/authorize?' + params.toString());
});

// Step 2: Handle Instagram callback — exchange code for tokens
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error || !code) {
      console.error('Instagram auth error:', error || 'no code');
      return res.redirect('/distribute/connections?error=Instagram+connection+cancelled');
    }

    // Decode state to get userId and redirect
    let userId, redirectTo = '/distribute/connections';
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
      userId = stateData.userId;
      redirectTo = stateData.redirect || '/distribute/connections';
    } catch (e) {
      return res.redirect('/distribute/connections?error=Invalid+Instagram+auth+state');
    }

    // Step 2a: Exchange authorization code for short-lived token
    const shortTokenData = await httpsPost('https://api.instagram.com/oauth/access_token', {
      client_id: INSTAGRAM_CLIENT_ID,
      client_secret: INSTAGRAM_CLIENT_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: BASE_URL + '/auth/instagram/callback',
      code: code
    });

    if (shortTokenData.error || !shortTokenData.access_token) {
      console.error('Instagram short-lived token exchange failed:', JSON.stringify(shortTokenData));
      return res.redirect('/distribute/connections?error=Instagram+auth+failed:+' + encodeURIComponent(shortTokenData.error_description || shortTokenData.error || 'unknown'));
    }

    const shortLivedToken = shortTokenData.access_token;
    const userId_ig = shortTokenData.user_id;

    // Step 2b: Exchange short-lived token for long-lived token
    const longTokenData = await httpsGet(
      'https://graph.instagram.com/access_token?' +
      new URLSearchParams({
        grant_type: 'ig_exchange_token',
        client_secret: INSTAGRAM_CLIENT_SECRET,
        access_token: shortLivedToken
      }).toString()
    );

    if (longTokenData.error || !longTokenData.access_token) {
      console.error('Instagram long-lived token exchange failed:', JSON.stringify(longTokenData));
      return res.redirect('/distribute/connections?error=Instagram+token+upgrade+failed:+' + encodeURIComponent(longTokenData.error?.message || 'unknown'));
    }

    const access_token = longTokenData.access_token;
    const expires_in = longTokenData.expires_in || 5184000; // 60 days default

    // Token refresh is valid for 60 days; store expiration accordingly
    const expiresAt = new Date(Date.now() + (expires_in * 1000));

    // Fetch user profile
    let username = '';
    try {
      const profileData = await httpsGet(
        'https://graph.instagram.com/v21.0/me?fields=user_id,username&access_token=' + access_token
      );
      if (profileData.user_id && profileData.username) {
        username = profileData.username;
      }
    } catch (e) {
      console.error('Instagram profile fetch error:', e.message);
    }

    // Save Instagram tokens to user account
    const db = getDb();
    const { userOps, connectedAccountOps } = db;
    await userOps.updateInstagram(userId, {
      instagramId: userId_ig,
      accessToken: access_token,
      expiresAt: expiresAt,
      username: username
    });

    // Also save to connected_accounts for Repurpose feature
    try {
      const existing = await connectedAccountOps.getByUserAndPlatform(userId, 'instagram');
      if (existing.length > 0) {
        await connectedAccountOps.update(existing[0].id, {
          accessToken: access_token, refreshToken: null,
          tokenExpiresAt: expiresAt, platformUsername: username,
          accountName: username || 'Instagram Account'
        });
      } else {
        await connectedAccountOps.create(userId, {
          platform: 'instagram', platformUserId: userId_ig,
          platformUsername: username, accountName: username || 'Instagram Account',
          accessToken: access_token, refreshToken: null,
          tokenExpiresAt: expiresAt, accountType: 'source_destination'
        });
      }
    } catch (e) { console.error('Connected account save error:', e.message); }

    res.redirect(redirectTo + (redirectTo.includes('?') ? '&' : '?') + 'success=Instagram+connected' + (username ? '+as+@' + encodeURIComponent(username) : ''));

  } catch (err) {
    console.error('Instagram OAuth error:', err.message || err);
    res.redirect('/distribute/connections?error=Instagram+connection+failed:+' + encodeURIComponent(err.message || 'unknown'));
  }
});

// ─── Disconnect Instagram ────────────────────────────────────────

router.post('/disconnect', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    await db.userOps.clearInstagram(req.user.id);
    res.json({ success: true, message: 'Instagram account disconnected' });
  } catch (err) {
    console.error('Instagram disconnect error:', err);
    res.status(500).json({ error: 'Failed to disconnect Instagram' });
  }
});

// ─── Refresh Instagram Token ────────────────────────────────────

async function refreshInstagramToken(user) {
  if (!user.instagram_access_token) throw new Error('No access token available');

  const tokenData = await httpsGet(
    'https://graph.instagram.com/refresh_access_token?' +
    new URLSearchParams({
      grant_type: 'ig_refresh_token',
      access_token: user.instagram_access_token
    }).toString()
  );

  if (tokenData.error || !tokenData.access_token) {
    throw new Error('Token refresh failed: ' + (tokenData.error?.message || tokenData.error || 'unknown'));
  }

  const db = getDb();
  const expires_in = tokenData.expires_in || 5184000; // 60 days default
  const expiresAt = new Date(Date.now() + (expires_in * 1000));
  await db.userOps.updateInstagram(user.id, {
    instagramId: user.instagram_id,
    accessToken: tokenData.access_token,
    expiresAt: expiresAt,
    username: user.instagram_username
  });

  return tokenData.access_token;
}

// Get a valid access token, refreshing if expired
async function getValidToken(user) {
  if (!user.instagram_access_token) throw new Error('Instagram not connected');

  // Check if token is expired (with 5 min buffer)
  const expiresAt = user.instagram_token_expires_at ? new Date(user.instagram_token_expires_at) : null;
  if (expiresAt && expiresAt.getTime() < Date.now() + 300000) {
    return await refreshInstagramToken(user);
  }

  return user.instagram_access_token;
}

// ─── Instagram Content Publishing API ───────────────────────────

// Check connection status
router.get('/status', requireAuth, async (req, res) => {
  const user = req.user;
  res.json({
    connected: !!user.instagram_id,
    username: user.instagram_username || null,
    instagramId: user.instagram_id || null
  });
});

// Publish a photo or video to Instagram
// POST body: { imageUrl, videoUrl, caption }
// Only one of imageUrl or videoUrl should be provided
router.post('/publish', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user.instagram_id) {
      return res.status(400).json({ error: 'Instagram account not connected. Go to Settings to connect.' });
    }

    const accessToken = await getValidToken(user);
    const { imageUrl, videoUrl, caption } = req.body;

    if (!imageUrl && !videoUrl) {
      return res.status(400).json({ error: 'Either imageUrl or videoUrl is required' });
    }

    if (imageUrl && videoUrl) {
      return res.status(400).json({ error: 'Provide only imageUrl or videoUrl, not both' });
    }

    // Step 1: Create media container
    const containerPayload = {
      caption: caption || ''
    };

    if (imageUrl) {
      containerPayload.image_url = imageUrl;
      containerPayload.media_type = 'IMAGE';
    } else {
      containerPayload.video_url = videoUrl;
      containerPayload.media_type = 'VIDEO';
    }

    const containerData = await httpsPostJson(
      `https://graph.instagram.com/v21.0/${user.instagram_id}/media`,
      containerPayload,
      { Authorization: 'Bearer ' + accessToken }
    );

    if (containerData.error || !containerData.id) {
      console.error('Instagram media container creation failed:', JSON.stringify(containerData));
      return res.status(400).json({
        error: 'Instagram media creation failed: ' + (containerData.error?.message || 'unknown')
      });
    }

    const creationId = containerData.id;

    // Step 2: Publish the media
    const publishData = await httpsPostJson(
      `https://graph.instagram.com/v21.0/${user.instagram_id}/media_publish`,
      { creation_id: creationId },
      { Authorization: 'Bearer ' + accessToken }
    );

    if (publishData.error || !publishData.id) {
      console.error('Instagram media publish failed:', JSON.stringify(publishData));
      return res.status(400).json({
        error: 'Instagram publish failed: ' + (publishData.error?.message || 'unknown')
      });
    }

    res.json({
      success: true,
      instagramPostId: publishData.id,
      message: 'Content published to Instagram successfully'
    });

  } catch (err) {
    console.error('Instagram publish error:', err.message || err);
    res.status(500).json({ error: 'Failed to publish to Instagram: ' + (err.message || 'unknown') });
  }
});

module.exports = router;
