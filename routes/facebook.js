const express = require('express');
const router = express.Router();
const https = require('https');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');

const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || '1512904737116140';
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || '';
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

// ─── Facebook OAuth 2.0 ──────────────────────────────────────────

// Step 1: Redirect user to Facebook authorization
router.get('/connect', requireAuth, (req, res) => {
  if (!FACEBOOK_APP_ID) {
    return res.status(500).send('Facebook integration not configured. Set FACEBOOK_APP_ID env var.');
  }

  // Store user ID and redirect in state to link the account after callback
  const state = Buffer.from(JSON.stringify({ userId: req.user.id, redirect: req.query.redirect || '/distribute/connections' })).toString('base64url');

  const params = new URLSearchParams({
    client_id: FACEBOOK_APP_ID,
    redirect_uri: BASE_URL + '/auth/facebook/callback',
    scope: 'pages_manage_posts,pages_read_engagement,pages_show_list',
    state: state,
    response_type: 'code'
  });

  res.redirect('https://www.facebook.com/v21.0/dialog/oauth?' + params.toString());
});

// Step 2: Handle Facebook callback — exchange code for tokens
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error || !code) {
      console.error('Facebook auth error:', error || 'no code');
      return res.redirect('/distribute/connections?error=Facebook+connection+cancelled');
    }

    // Decode state to get userId and redirect
    let userId, redirectTo = '/distribute/connections';
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
      userId = stateData.userId;
      redirectTo = stateData.redirect || '/distribute/connections';
    } catch (e) {
      return res.redirect('/distribute/connections?error=Invalid+Facebook+auth+state');
    }

    // Exchange authorization code for short-lived access token
    const tokenData = await httpsGet(
      'https://graph.facebook.com/v21.0/oauth/access_token?client_id=' + encodeURIComponent(FACEBOOK_APP_ID) +
      '&client_secret=' + encodeURIComponent(FACEBOOK_APP_SECRET) +
      '&redirect_uri=' + encodeURIComponent(BASE_URL + '/auth/facebook/callback') +
      '&code=' + encodeURIComponent(code)
    );

    if (tokenData.error || !tokenData.access_token) {
      console.error('Facebook token exchange failed:', JSON.stringify(tokenData));
      return res.redirect('/distribute/connections?error=Facebook+auth+failed:+' + encodeURIComponent(tokenData.error?.message || tokenData.error || 'unknown'));
    }

    let accessToken = tokenData.access_token;

    // Exchange for long-lived token
    try {
      const longLivedData = await httpsGet(
        'https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=' + encodeURIComponent(FACEBOOK_APP_ID) +
        '&client_secret=' + encodeURIComponent(FACEBOOK_APP_SECRET) +
        '&fb_exchange_token=' + encodeURIComponent(accessToken)
      );

      if (longLivedData.access_token) {
        accessToken = longLivedData.access_token;
      }
    } catch (e) {
      console.error('Facebook long-lived token exchange error:', e.message);
      // Continue with short-lived token if long-lived fails
    }

    // Fetch user info
    let facebookId = '';
    let userName = '';
    try {
      const userInfo = await httpsGet(
        'https://graph.facebook.com/v21.0/me?fields=id,name',
        { Authorization: 'Bearer ' + accessToken }
      );
      if (userInfo.id) {
        facebookId = userInfo.id;
        userName = userInfo.name || '';
      }
    } catch (e) {
      console.error('Facebook user info fetch error:', e.message);
    }

    // Fetch user's pages and their access tokens
    let pages = [];
    try {
      const pagesData = await httpsGet(
        'https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token',
        { Authorization: 'Bearer ' + accessToken }
      );
      if (pagesData.data && Array.isArray(pagesData.data)) {
        pages = pagesData.data;
      }
    } catch (e) {
      console.error('Facebook pages fetch error:', e.message);
    }

    // Save Facebook tokens to user account
    const db = getDb();
    const { userOps, connectedAccountOps } = db;

    // Store user token and first page info if available
    let facebookPageId = '';
    let facebookPageToken = '';
    let facebookPageName = '';

    if (pages.length > 0) {
      facebookPageId = pages[0].id;
      facebookPageToken = pages[0].access_token;
      facebookPageName = pages[0].name || '';
    }

    await userOps.updateFacebook(userId, {
      facebookId: facebookId,
      accessToken: accessToken,
      pageId: facebookPageId,
      pageToken: facebookPageToken,
      pageName: facebookPageName,
      userName: userName,
      pages: pages
    });

    // Also save to connected_accounts for Repurpose feature
    try {
      const existing = await connectedAccountOps.getByUserAndPlatform(userId, 'facebook');
      if (existing.length > 0) {
        await connectedAccountOps.update(existing[0].id, {
          accessToken: accessToken, refreshToken: null,
          tokenExpiresAt: null, platformUsername: userName,
          accountName: userName || 'Facebook Account'
        });
      } else {
        await connectedAccountOps.create(userId, {
          platform: 'facebook', platformUserId: facebookId,
          platformUsername: userName, accountName: userName || 'Facebook Account',
          accessToken: accessToken, refreshToken: null,
          tokenExpiresAt: null, accountType: 'source_destination'
        });
      }
    } catch (e) { console.error('Connected account save error:', e.message); }

    res.redirect(redirectTo + (redirectTo.includes('?') ? '&' : '?') + 'success=Facebook+connected' + (userName ? '+as+' + encodeURIComponent(userName) : ''));

  } catch (err) {
    console.error('Facebook OAuth error:', err.message || err);
    res.redirect('/distribute/connections?error=Facebook+connection+failed:+' + encodeURIComponent(err.message || 'unknown'));
  }
});

// ─── Disconnect Facebook ─────────────────────────────────────────

router.post('/disconnect', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    await db.userOps.clearFacebook(req.user.id);
    res.json({ success: true, message: 'Facebook account disconnected' });
  } catch (err) {
    console.error('Facebook disconnect error:', err);
    res.status(500).json({ error: 'Failed to disconnect Facebook' });
  }
});

// ─── Facebook Content Posting API ────────────────────────────────

// Check connection status
router.get('/status', requireAuth, async (req, res) => {
  const user = req.user;
  res.json({
    connected: !!user.facebook_id,
    userName: user.facebook_user_name || null,
    facebookId: user.facebook_id || null,
    pageId: user.facebook_page_id || null,
    pageName: user.facebook_page_name || null
  });
});

// Get user's Facebook Pages
router.get('/pages', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user.facebook_access_token) {
      return res.status(400).json({ error: 'Facebook account not connected. Go to Settings to connect.' });
    }

    // Fetch user's pages
    const pagesData = await httpsGet(
      'https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token',
      { Authorization: 'Bearer ' + user.facebook_access_token }
    );

    if (!pagesData.data || !Array.isArray(pagesData.data)) {
      return res.status(400).json({ error: 'No Facebook Pages found' });
    }

    // Update pages in database
    const db = getDb();
    await db.userOps.updateFacebook(user.id, {
      facebookId: user.facebook_id,
      accessToken: user.facebook_access_token,
      pageId: user.facebook_page_id,
      pageToken: user.facebook_page_token,
      pageName: user.facebook_page_name,
      userName: user.facebook_user_name,
      pages: pagesData.data
    });

    res.json({
      success: true,
      pages: pagesData.data.map(p => ({
        id: p.id,
        name: p.name,
        selected: p.id === user.facebook_page_id
      }))
    });

  } catch (err) {
    console.error('Facebook pages fetch error:', err.message || err);
    res.status(500).json({ error: 'Failed to fetch pages: ' + (err.message || 'unknown') });
  }
});

// Select a specific page for posting
router.post('/pages/select', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const { pageId } = req.body;

    if (!user.facebook_access_token) {
      return res.status(400).json({ error: 'Facebook account not connected' });
    }

    if (!pageId) {
      return res.status(400).json({ error: 'Page ID is required' });
    }

    // Fetch user's pages to find the selected one
    const pagesData = await httpsGet(
      'https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token',
      { Authorization: 'Bearer ' + user.facebook_access_token }
    );

    const selectedPage = pagesData.data?.find(p => p.id === pageId);
    if (!selectedPage) {
      return res.status(400).json({ error: 'Page not found' });
    }

    // Update selected page in database
    const db = getDb();
    await db.userOps.updateFacebook(user.id, {
      facebookId: user.facebook_id,
      accessToken: user.facebook_access_token,
      pageId: selectedPage.id,
      pageToken: selectedPage.access_token,
      pageName: selectedPage.name,
      userName: user.facebook_user_name,
      pages: pagesData.data
    });

    res.json({
      success: true,
      message: 'Page selected: ' + selectedPage.name
    });

  } catch (err) {
    console.error('Facebook page selection error:', err.message || err);
    res.status(500).json({ error: 'Failed to select page: ' + (err.message || 'unknown') });
  }
});

// Post to Facebook Page (text + optional image/video)
router.post('/publish', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user.facebook_id) {
      return res.status(400).json({ error: 'Facebook account not connected. Go to Settings to connect.' });
    }

    if (!user.facebook_page_id || !user.facebook_page_token) {
      return res.status(400).json({ error: 'No Facebook Page selected. Use GET /pages to select one.' });
    }

    const { message, imageUrl, videoUrl, link } = req.body;

    if (!message && !imageUrl && !videoUrl) {
      return res.status(400).json({ error: 'Message or image/video URL is required' });
    }

    let publishData;

    // Post with image
    if (imageUrl && !videoUrl) {
      publishData = await httpsPost(
        'https://graph.facebook.com/v21.0/' + encodeURIComponent(user.facebook_page_id) + '/photos',
        {
          url: imageUrl,
          caption: message || '',
          access_token: user.facebook_page_token
        }
      );

      if (publishData.error) {
        console.error('Facebook image post failed:', JSON.stringify(publishData));
        return res.status(400).json({
          error: 'Facebook post failed: ' + (publishData.error.message || publishData.error.type || 'unknown')
        });
      }

      return res.json({
        success: true,
        postId: publishData.id,
        message: 'Image posted to Facebook Page'
      });
    }

    // Post with video
    if (videoUrl && !imageUrl) {
      publishData = await httpsPost(
        'https://graph.facebook.com/v21.0/' + encodeURIComponent(user.facebook_page_id) + '/videos',
        {
          file_url: videoUrl,
          description: message || '',
          access_token: user.facebook_page_token
        }
      );

      if (publishData.error) {
        console.error('Facebook video post failed:', JSON.stringify(publishData));
        return res.status(400).json({
          error: 'Facebook post failed: ' + (publishData.error.message || publishData.error.type || 'unknown')
        });
      }

      return res.json({
        success: true,
        postId: publishData.id,
        message: 'Video posted to Facebook Page'
      });
    }

    // Post text only or text with link
    const postData = {
      message: message || '',
      access_token: user.facebook_page_token
    };

    if (link) {
      postData.link = link;
    }

    publishData = await httpsPost(
      'https://graph.facebook.com/v21.0/' + encodeURIComponent(user.facebook_page_id) + '/feed',
      postData
    );

    if (publishData.error) {
      console.error('Facebook text post failed:', JSON.stringify(publishData));
      return res.status(400).json({
        error: 'Facebook post failed: ' + (publishData.error.message || publishData.error.type || 'unknown')
      });
    }

    res.json({
      success: true,
      postId: publishData.id,
      message: 'Post published to Facebook Page'
    });

  } catch (err) {
    console.error('Facebook publish error:', err.message || err);
    res.status(500).json({ error: 'Failed to publish to Facebook: ' + (err.message || 'unknown') });
  }
});

module.exports = router;
