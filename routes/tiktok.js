const express = require('express');
const router = express.Router();
const https = require('https');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');

const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || '';
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || '';
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

// ─── TikTok OAuth 2.0 (Login Kit) ────────────────────────────────

// Step 1: Redirect user to TikTok authorization
router.get('/connect', requireAuth, (req, res) => {
  if (!TIKTOK_CLIENT_KEY) {
    return res.status(500).send('TikTok integration not configured. Set TIKTOK_CLIENT_KEY env var.');
  }

  // Store user ID and redirect in state to link the account after callback
  const state = Buffer.from(JSON.stringify({ userId: req.user.id, redirect: req.query.redirect || '/distribute/connections' })).toString('base64url');

  const params = new URLSearchParams({
    client_key: TIKTOK_CLIENT_KEY,
    response_type: 'code',
    scope: 'user.info.basic,video.publish,video.upload',
    redirect_uri: BASE_URL + '/auth/tiktok/callback',
    state: state
  });

  res.redirect('https://www.tiktok.com/v2/auth/authorize/?' + params.toString());
});

// Step 2: Handle TikTok callback — exchange code for tokens
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error || !code) {
      console.error('TikTok auth error:', error || 'no code');
      return res.redirect('/distribute/connections?error=TikTok+connection+cancelled');
    }

    // Decode state to get userId and redirect
    let userId, redirectTo = '/distribute/connections';
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
      userId = stateData.userId;
      redirectTo = stateData.redirect || '/distribute/connections';
    } catch (e) {
      return res.redirect('/distribute/connections?error=Invalid+TikTok+auth+state');
    }

    // Exchange authorization code for access token
    const tokenData = await httpsPost('https://open.tiktokapis.com/v2/oauth/token/', {
      client_key: TIKTOK_CLIENT_KEY,
      client_secret: TIKTOK_CLIENT_SECRET,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: BASE_URL + '/auth/tiktok/callback'
    });

    if (tokenData.error || !tokenData.access_token) {
      console.error('TikTok token exchange failed:', JSON.stringify(tokenData));
      return res.redirect('/distribute/connections?error=TikTok+auth+failed:+' + encodeURIComponent(tokenData.error_description || tokenData.error || 'unknown'));
    }

    const { access_token, refresh_token, expires_in, open_id } = tokenData;
    const expiresAt = new Date(Date.now() + (expires_in * 1000));

    // Fetch user profile
    let username = '';
    try {
      const profileData = await httpsGet(
        'https://open.tiktokapis.com/v2/user/info/?fields=display_name,username',
        { Authorization: 'Bearer ' + access_token }
      );
      if (profileData.data && profileData.data.user) {
        username = profileData.data.user.username || profileData.data.user.display_name || '';
      }
    } catch (e) {
      console.error('TikTok profile fetch error:', e.message);
    }

    // Save TikTok tokens to user account
    const db = getDb();
    const { userOps, connectedAccountOps } = db;
    await userOps.updateTikTok(userId, {
      tiktokId: open_id,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: expiresAt,
      username: username
    });

    // Also save to connected_accounts for Repurpose feature
    try {
      const existing = await connectedAccountOps.getByUserAndPlatform(userId, 'tiktok');
      if (existing.length > 0) {
        await connectedAccountOps.update(existing[0].id, {
          accessToken: access_token, refreshToken: refresh_token,
          tokenExpiresAt: expiresAt, platformUsername: username,
          accountName: username || 'TikTok Account'
        });
      } else {
        await connectedAccountOps.create(userId, {
          platform: 'tiktok', platformUserId: open_id,
          platformUsername: username, accountName: username || 'TikTok Account',
          accessToken: access_token, refreshToken: refresh_token,
          tokenExpiresAt: expiresAt, accountType: 'source_destination'
        });
      }
    } catch (e) { console.error('Connected account save error:', e.message); }

    res.redirect(redirectTo + (redirectTo.includes('?') ? '&' : '?') + 'success=TikTok+connected' + (username ? '+as+@' + encodeURIComponent(username) : ''));

  } catch (err) {
    console.error('TikTok OAuth error:', err.message || err);
    res.redirect('/distribute/connections?error=TikTok+connection+failed:+' + encodeURIComponent(err.message || 'unknown'));
  }
});

// ─── Disconnect TikTok ───────────────────────────────────────────

router.post('/disconnect', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    await db.userOps.clearTikTok(req.user.id);
    res.json({ success: true, message: 'TikTok account disconnected' });
  } catch (err) {
    console.error('TikTok disconnect error:', err);
    res.status(500).json({ error: 'Failed to disconnect TikTok' });
  }
});

// ─── Refresh TikTok Token ────────────────────────────────────────

async function refreshTikTokToken(user) {
  if (!user.tiktok_refresh_token) throw new Error('No refresh token available');

  const tokenData = await httpsPost('https://open.tiktokapis.com/v2/oauth/token/', {
    client_key: TIKTOK_CLIENT_KEY,
    client_secret: TIKTOK_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: user.tiktok_refresh_token
  });

  if (tokenData.error || !tokenData.access_token) {
    throw new Error('Token refresh failed: ' + (tokenData.error_description || tokenData.error));
  }

  const db = getDb();
  const expiresAt = new Date(Date.now() + (tokenData.expires_in * 1000));
  await db.userOps.updateTikTok(user.id, {
    tiktokId: user.tiktok_id,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || user.tiktok_refresh_token,
    expiresAt: expiresAt,
    username: user.tiktok_username
  });

  return tokenData.access_token;
}

// Get a valid access token, refreshing if expired
async function getValidToken(user) {
  if (!user.tiktok_access_token) throw new Error('TikTok not connected');

  // Check if token is expired (with 5 min buffer)
  const expiresAt = user.tiktok_token_expires_at ? new Date(user.tiktok_token_expires_at) : null;
  if (expiresAt && expiresAt.getTime() < Date.now() + 300000) {
    return await refreshTikTokToken(user);
  }

  return user.tiktok_access_token;
}

// ─── TikTok Content Posting API ──────────────────────────────────

// Check connection status
router.get('/status', requireAuth, async (req, res) => {
  const user = req.user;
  res.json({
    connected: !!user.tiktok_id,
    username: user.tiktok_username || null,
    tiktokId: user.tiktok_id || null
  });
});

// Initialize video upload (Step 1 of Content Posting)
router.post('/publish/init', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user.tiktok_id) {
      return res.status(400).json({ error: 'TikTok account not connected. Go to Settings to connect.' });
    }

    const accessToken = await getValidToken(user);
    const { title, videoUrl, privacyLevel = 'SELF_ONLY' } = req.body;

    if (!videoUrl) {
      return res.status(400).json({ error: 'Video URL is required' });
    }

    // Initialize video publish using pull-from-URL method
    const publishData = await httpsPostJson(
      'https://open.tiktokapis.com/v2/post/publish/video/init/',
      {
        post_info: {
          title: title || '',
          privacy_level: privacyLevel,
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false
        },
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: videoUrl
        }
      },
      { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' }
    );

    if (publishData.error && publishData.error.code !== 'ok') {
      console.error('TikTok publish init failed:', JSON.stringify(publishData));
      return res.status(400).json({
        error: 'TikTok publish failed: ' + (publishData.error.message || publishData.error.code || 'unknown')
      });
    }

    res.json({
      success: true,
      publishId: publishData.data?.publish_id,
      message: 'Video submitted to TikTok for processing'
    });

  } catch (err) {
    console.error('TikTok publish error:', err.message || err);
    res.status(500).json({ error: 'Failed to publish to TikTok: ' + (err.message || 'unknown') });
  }
});

// Check publish status
router.get('/publish/status/:publishId', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user.tiktok_id) {
      return res.status(400).json({ error: 'TikTok account not connected' });
    }

    const accessToken = await getValidToken(user);

    const statusData = await httpsPostJson(
      'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
      { publish_id: req.params.publishId },
      { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' }
    );

    res.json({
      status: statusData.data?.status || 'unknown',
      publishId: req.params.publishId,
      details: statusData.data
    });

  } catch (err) {
    console.error('TikTok status check error:', err.message || err);
    res.status(500).json({ error: 'Failed to check publish status' });
  }
});

// Direct file upload flow (alternative to URL pull)
router.post('/publish/upload-init', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user.tiktok_id) {
      return res.status(400).json({ error: 'TikTok account not connected' });
    }

    const accessToken = await getValidToken(user);
    const { title, fileSize, chunkSize, totalChunkCount, privacyLevel = 'SELF_ONLY' } = req.body;

    if (!fileSize) {
      return res.status(400).json({ error: 'File size is required' });
    }

    const initData = await httpsPostJson(
      'https://open.tiktokapis.com/v2/post/publish/video/init/',
      {
        post_info: {
          title: title || '',
          privacy_level: privacyLevel,
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: fileSize,
          chunk_size: chunkSize || fileSize,
          total_chunk_count: totalChunkCount || 1
        }
      },
      { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' }
    );

    if (initData.error && initData.error.code !== 'ok') {
      return res.status(400).json({
        error: 'TikTok upload init failed: ' + (initData.error.message || initData.error.code)
      });
    }

    res.json({
      success: true,
      publishId: initData.data?.publish_id,
      uploadUrl: initData.data?.upload_url,
      message: 'Upload URL generated. Send video data to the upload URL.'
    });

  } catch (err) {
    console.error('TikTok upload init error:', err.message || err);
    res.status(500).json({ error: 'Failed to initialize upload: ' + (err.message || 'unknown') });
  }
});

module.exports = router;
