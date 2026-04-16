const express = require('express');
const router = express.Router();
const https = require('https');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');

const PINTEREST_CLIENT_ID = process.env.PINTEREST_CLIENT_ID || '';
const PINTEREST_CLIENT_SECRET = process.env.PINTEREST_CLIENT_SECRET || '';
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

// ─── Pinterest OAuth 2.0 ────────────────────────────────────────

// Step 1: Redirect user to Pinterest authorization
router.get('/connect', requireAuth, (req, res) => {
  if (!PINTEREST_CLIENT_ID) {
    return res.status(500).send('Pinterest integration not configured. Set PINTEREST_CLIENT_ID env var.');
  }

  // Store user ID and redirect in state to link the account after callback
  const state = Buffer.from(JSON.stringify({ userId: req.user.id, redirect: req.query.redirect || '/distribute/connections' })).toString('base64url');

  const params = new URLSearchParams({
    client_id: PINTEREST_CLIENT_ID,
    redirect_uri: BASE_URL + '/auth/pinterest/callback',
    response_type: 'code',
    scope: 'boards:read,pins:read,pins:write',
    state: state
  });

  res.redirect('https://www.pinterest.com/oauth/?' + params.toString());
});

// Step 2: Handle Pinterest callback — exchange code for tokens
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error || !code) {
      console.error('Pinterest auth error:', error || 'no code');
      return res.redirect('/distribute/connections?error=Pinterest+connection+cancelled');
    }

    // Decode state to get userId and redirect
    let userId, redirectTo = '/distribute/connections';
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
      userId = stateData.userId;
      redirectTo = stateData.redirect || '/distribute/connections';
    } catch (e) {
      return res.redirect('/distribute/connections?error=Invalid+Pinterest+auth+state');
    }

    // Create Basic Auth header (base64 encoded client_id:client_secret)
    const basicAuth = Buffer.from(PINTEREST_CLIENT_ID + ':' + PINTEREST_CLIENT_SECRET).toString('base64');

    // Exchange authorization code for access token
    const tokenData = await httpsPost('https://api.pinterest.com/v5/oauth/token', {
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: BASE_URL + '/auth/pinterest/callback'
    }, {
      Authorization: 'Basic ' + basicAuth
    });

    if (tokenData.error || !tokenData.access_token) {
      console.error('Pinterest token exchange failed:', JSON.stringify(tokenData));
      return res.redirect('/distribute/connections?error=Pinterest+auth+failed:+' + encodeURIComponent(tokenData.error_description || tokenData.error || 'unknown'));
    }

    const { access_token, refresh_token, expires_in } = tokenData;
    const expiresAt = new Date(Date.now() + (expires_in * 1000));

    // Fetch user profile
    let username = '';
    try {
      const profileData = await httpsGet(
        'https://api.pinterest.com/v5/user_account',
        { Authorization: 'Bearer ' + access_token }
      );
      if (profileData.data) {
        username = profileData.data.username || '';
      }
    } catch (e) {
      console.error('Pinterest profile fetch error:', e.message);
    }

    // Save Pinterest tokens to user account
    const db = getDb();
    const { userOps, connectedAccountOps } = db;
    await userOps.updatePinterest(userId, {
      pinterestId: profileData.data?.id || '',
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: expiresAt,
      username: username
    });

    // Also save to connected_accounts for Repurpose feature
    try {
      const existing = await connectedAccountOps.getByUserAndPlatform(userId, 'pinterest');
      if (existing.length > 0) {
        await connectedAccountOps.update(existing[0].id, {
          accessToken: access_token, refreshToken: refresh_token,
          tokenExpiresAt: expiresAt, platformUsername: username,
          accountName: username || 'Pinterest Account'
        });
      } else {
        await connectedAccountOps.create(userId, {
          platform: 'pinterest', platformUserId: profileData.data?.id || '',
          platformUsername: username, accountName: username || 'Pinterest Account',
          accessToken: access_token, refreshToken: refresh_token,
          tokenExpiresAt: expiresAt, accountType: 'destination'
        });
      }
    } catch (e) { console.error('Connected account save error:', e.message); }

    res.redirect(redirectTo + (redirectTo.includes('?') ? '&' : '?') + 'success=Pinterest+connected' + (username ? '+as+' + encodeURIComponent(username) : ''));

  } catch (err) {
    console.error('Pinterest OAuth error:', err.message || err);
    res.redirect('/distribute/connections?error=Pinterest+connection+failed:+' + encodeURIComponent(err.message || 'unknown'));
  }
});

// ─── Disconnect Pinterest ────────────────────────────────────────

router.post('/disconnect', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    await db.userOps.clearPinterest(req.user.id);
    res.json({ success: true, message: 'Pinterest account disconnected' });
  } catch (err) {
    console.error('Pinterest disconnect error:', err);
    res.status(500).json({ error: 'Failed to disconnect Pinterest' });
  }
});

// ─── Refresh Pinterest Token ─────────────────────────────────────

async function refreshPinterestToken(user) {
  if (!user.pinterest_refresh_token) throw new Error('No refresh token available');

  const basicAuth = Buffer.from(PINTEREST_CLIENT_ID + ':' + PINTEREST_CLIENT_SECRET).toString('base64');

  const tokenData = await httpsPost('https://api.pinterest.com/v5/oauth/token', {
    grant_type: 'refresh_token',
    refresh_token: user.pinterest_refresh_token
  }, {
    Authorization: 'Basic ' + basicAuth
  });

  if (tokenData.error || !tokenData.access_token) {
    throw new Error('Token refresh failed: ' + (tokenData.error_description || tokenData.error));
  }

  const db = getDb();
  const expiresAt = new Date(Date.now() + (tokenData.expires_in * 1000));
  await db.userOps.updatePinterest(user.id, {
    pinterestId: user.pinterest_id,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || user.pinterest_refresh_token,
    expiresAt: expiresAt,
    username: user.pinterest_username
  });

  return tokenData.access_token;
}

// Get a valid access token, refreshing if expired
async function getValidToken(user) {
  if (!user.pinterest_access_token) throw new Error('Pinterest not connected');

  // Check if token is expired (with 5 min buffer)
  const expiresAt = user.pinterest_token_expires_at ? new Date(user.pinterest_token_expires_at) : null;
  if (expiresAt && expiresAt.getTime() < Date.now() + 300000) {
    return await refreshPinterestToken(user);
  }

  return user.pinterest_access_token;
}

// ─── Pinterest Content Publishing API ───────────────────────────

// Check connection status
router.get('/status', requireAuth, async (req, res) => {
  const user = req.user;
  res.json({
    connected: !!user.pinterest_id,
    username: user.pinterest_username || null,
    pinterestId: user.pinterest_id || null
  });
});

// List user's boards (for UI to select where to pin)
router.get('/boards', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user.pinterest_id) {
      return res.status(400).json({ error: 'Pinterest account not connected. Go to Settings to connect.' });
    }

    const accessToken = await getValidToken(user);

    const boardsData = await httpsGet(
      'https://api.pinterest.com/v5/boards',
      { Authorization: 'Bearer ' + accessToken }
    );

    if (boardsData.error) {
      console.error('Pinterest boards fetch failed:', JSON.stringify(boardsData));
      return res.status(400).json({
        error: 'Failed to fetch boards: ' + (boardsData.error.message || 'unknown')
      });
    }

    const boards = (boardsData.data || []).map(b => ({
      id: b.id,
      name: b.name,
      url: b.url
    }));

    res.json({
      success: true,
      boards: boards
    });

  } catch (err) {
    console.error('Pinterest boards error:', err.message || err);
    res.status(500).json({ error: 'Failed to fetch boards: ' + (err.message || 'unknown') });
  }
});

// Create a Pin
router.post('/publish', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user.pinterest_id) {
      return res.status(400).json({ error: 'Pinterest account not connected. Go to Settings to connect.' });
    }

    const accessToken = await getValidToken(user);
    const { boardId, title, description, link, imageUrl, videoUrl } = req.body;

    if (!boardId) {
      return res.status(400).json({ error: 'Board ID is required' });
    }

    if (!imageUrl && !videoUrl) {
      return res.status(400).json({ error: 'Image URL or Video URL is required' });
    }

    // Build media_source based on image or video
    let mediaSource;
    if (videoUrl) {
      mediaSource = {
        source_type: 'video_url',
        url: videoUrl
      };
    } else {
      mediaSource = {
        source_type: 'image_url',
        url: imageUrl
      };
    }

    // Create pin payload
    const pinData = {
      board_id: boardId,
      title: title || 'Untitled Pin',
      description: description || '',
      media_source: mediaSource
    };

    // Add link if provided
    if (link) {
      pinData.link = link;
    }

    // Create the pin
    const createData = await httpsPostJson(
      'https://api.pinterest.com/v5/pins',
      pinData,
      { Authorization: 'Bearer ' + accessToken }
    );

    if (createData.error) {
      console.error('Pinterest pin creation failed:', JSON.stringify(createData));
      return res.status(400).json({
        error: 'Pinterest pin creation failed: ' + (createData.error.message || createData.error || 'unknown')
      });
    }

    res.json({
      success: true,
      pinId: createData.data?.id,
      message: 'Pin created successfully on Pinterest'
    });

  } catch (err) {
    console.error('Pinterest publish error:', err.message || err);
    res.status(500).json({ error: 'Failed to publish to Pinterest: ' + (err.message || 'unknown') });
  }
});

module.exports = router;
