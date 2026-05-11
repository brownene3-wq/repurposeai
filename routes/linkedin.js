const express = require('express');
const router = express.Router();
const https = require('https');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');

const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || '78m5fxmzdcrtgb';
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET || '';
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

// ─── LinkedIn OAuth 2.0 ────────────────────────────────────────────

// Step 1: Redirect user to LinkedIn authorization
router.get('/connect', requireAuth, (req, res) => {
  if (!LINKEDIN_CLIENT_ID || !LINKEDIN_CLIENT_SECRET) {
    return res.status(500).send('LinkedIn integration not configured. Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET env vars.');
  }

  // Store user ID and redirect in state to link the account after callback
  const state = Buffer.from(JSON.stringify({ userId: req.user.id, redirect: req.query.redirect || '/distribute/connections' })).toString('base64url');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: LINKEDIN_CLIENT_ID,
    redirect_uri: BASE_URL + '/auth/linkedin/callback',
    state: state,
    scope: 'openid profile w_member_social'
  });

  res.redirect('https://www.linkedin.com/oauth/v2/authorization?' + params.toString());
});

// Step 2: Handle LinkedIn callback — exchange code for tokens
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    if (error || !code) {
      console.error('LinkedIn auth error:', error || 'no code');
      return res.redirect('/distribute/connections?error=LinkedIn+connection+cancelled');
    }

    // Decode state to get userId and redirect
    let userId, redirectTo = '/distribute/connections';
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
      userId = stateData.userId;
      redirectTo = stateData.redirect || '/distribute/connections';
    } catch (e) {
      return res.redirect('/distribute/connections?error=Invalid+LinkedIn+auth+state');
    }

    // Exchange authorization code for access token
    const tokenData = await httpsPost('https://www.linkedin.com/oauth/v2/accessToken', {
      grant_type: 'authorization_code',
      code: code,
      client_id: LINKEDIN_CLIENT_ID,
      client_secret: LINKEDIN_CLIENT_SECRET,
      redirect_uri: BASE_URL + '/auth/linkedin/callback'
    });

    if (tokenData.error || !tokenData.access_token) {
      console.error('LinkedIn token exchange failed:', JSON.stringify(tokenData));
      return res.redirect('/distribute/connections?error=LinkedIn+auth+failed:+' + encodeURIComponent(tokenData.error_description || tokenData.error || 'unknown'));
    }

    const { access_token, refresh_token, expires_in } = tokenData;
    const expiresAt = new Date(Date.now() + (expires_in * 1000));

    // Fetch user profile (sub field contains the personId)
    let linkedInId = '';
    let profileName = '';
    try {
      const profileData = await httpsGet(
        'https://api.linkedin.com/v2/userinfo',
        { Authorization: 'Bearer ' + access_token }
      );
      if (profileData.sub) {
        linkedInId = profileData.sub;
      }
      if (profileData.name) {
        profileName = profileData.name;
      }
    } catch (e) {
      console.error('LinkedIn profile fetch error:', e.message);
    }

    // Save LinkedIn tokens to user account
    const db = getDb();
    const { userOps, connectedAccountOps } = db;
    await userOps.updateLinkedIn(userId, {
      linkedInId: linkedInId,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: expiresAt,
      name: profileName
    });

    // Also save to connected_accounts for Repurpose feature
    try {
      const existing = await connectedAccountOps.getByUserAndPlatform(userId, 'linkedin');
      if (existing.length > 0) {
        await connectedAccountOps.update(existing[0].id, {
          accessToken: access_token, refreshToken: refresh_token,
          tokenExpiresAt: expiresAt, platformUsername: profileName,
          accountName: profileName || 'LinkedIn Account'
        });
      } else {
        await connectedAccountOps.create(userId, {
          platform: 'linkedin', platformUserId: linkedInId,
          platformUsername: profileName, accountName: profileName || 'LinkedIn Account',
          accessToken: access_token, refreshToken: refresh_token,
          tokenExpiresAt: expiresAt, accountType: 'destination'
        });
      }
    } catch (e) { console.error('Connected account save error:', e.message); }

    res.redirect(redirectTo + (redirectTo.includes('?') ? '&' : '?') + 'success=LinkedIn+connected' + (profileName ? '+as+' + encodeURIComponent(profileName) : ''));

  } catch (err) {
    console.error('LinkedIn OAuth error:', err.message || err);
    res.redirect('/distribute/connections?error=LinkedIn+connection+failed:+' + encodeURIComponent(err.message || 'unknown'));
  }
});

// ─── Disconnect LinkedIn ─────────────────────────────────────────

router.post('/disconnect', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    await db.userOps.clearLinkedIn(req.user.id);
    res.json({ success: true, message: 'LinkedIn account disconnected' });
  } catch (err) {
    console.error('LinkedIn disconnect error:', err);
    res.status(500).json({ error: 'Failed to disconnect LinkedIn' });
  }
});

// ─── Refresh LinkedIn Token ────────────────────────────────────────

async function refreshLinkedInToken(user) {
  if (!user.linkedin_refresh_token) throw new Error('No refresh token available');

  const tokenData = await httpsPost('https://www.linkedin.com/oauth/v2/accessToken', {
    grant_type: 'refresh_token',
    refresh_token: user.linkedin_refresh_token,
    client_id: LINKEDIN_CLIENT_ID,
    client_secret: LINKEDIN_CLIENT_SECRET
  });

  if (tokenData.error || !tokenData.access_token) {
    throw new Error('Token refresh failed: ' + (tokenData.error_description || tokenData.error));
  }

  const db = getDb();
  const expiresAt = new Date(Date.now() + (tokenData.expires_in * 1000));
  await db.userOps.updateLinkedIn(user.id, {
    linkedInId: user.linkedin_id,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || user.linkedin_refresh_token,
    expiresAt: expiresAt,
    name: user.linkedin_name
  });

  return tokenData.access_token;
}

// Get a valid access token, refreshing if expired
async function getValidToken(user) {
  if (!user.linkedin_access_token) throw new Error('LinkedIn not connected');

  // Check if token is expired (with 5 min buffer)
  const expiresAt = user.linkedin_token_expires_at ? new Date(user.linkedin_token_expires_at) : null;
  if (expiresAt && expiresAt.getTime() < Date.now() + 300000) {
    return await refreshLinkedInToken(user);
  }

  return user.linkedin_access_token;
}

// ─── LinkedIn Content Posting API ─────────────────────────────────

// Check connection status
router.get('/status', requireAuth, async (req, res) => {
  const user = req.user;
  res.json({
    connected: !!user.linkedin_id,
    name: user.linkedin_name || null,
    linkedInId: user.linkedin_id || null
  });
});

// Publish a text post to LinkedIn (with optional image/video URL)
router.post('/publish', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user.linkedin_id) {
      return res.status(400).json({ error: 'LinkedIn account not connected. Go to Settings to connect.' });
    }

    const accessToken = await getValidToken(user);
    const { text, mediaUrl, mediaType } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Post text is required' });
    }

    // Construct the post payload
    // LinkedIn uses URN format for personId: urn:li:person:{personId}
    const personUrn = 'urn:li:person:' + user.linkedin_id;

    let postData = {
      author: personUrn,
      commentary: text,
      visibility: { peekedBy: 'PUBLIC' },
      distribution: { feedDistribution: 'MAIN_FEED' },
      lifecycleState: 'PUBLISHED'
    };

    // If media URL is provided, add media handling
    if (mediaUrl) {
      postData.content = {
        media: {
          title: 'Shared Media',
          id: mediaUrl // LinkedIn API may require actual media upload, but this is the placeholder
        }
      };
    }

    // Make the post request with LinkedIn-Version header
    const publishData = await httpsPostJson(
      'https://api.linkedin.com/rest/posts',
      postData,
      {
        Authorization: 'Bearer ' + accessToken,
        'LinkedIn-Version': '202401',
        'Content-Type': 'application/json'
      }
    );

    if (publishData.error || !publishData.id) {
      console.error('LinkedIn publish failed:', JSON.stringify(publishData));
      return res.status(400).json({
        error: 'LinkedIn publish failed: ' + (publishData.message || publishData.error || 'unknown')
      });
    }

    res.json({
      success: true,
      postId: publishData.id,
      message: 'Post published to LinkedIn successfully'
    });

  } catch (err) {
    console.error('LinkedIn publish error:', err.message || err);
    res.status(500).json({ error: 'Failed to publish to LinkedIn: ' + (err.message || 'unknown') });
  }
});

module.exports = router;
