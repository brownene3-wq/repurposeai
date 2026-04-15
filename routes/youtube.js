const express = require('express');
const router = express.Router();
const https = require('https');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');

const YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID || '';
const YOUTUBE_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET || '';
const BASE_URL = process.env.BASE_URL || 'https://www.splicora.ai';

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

// ─── Google OAuth 2.0 (YouTube) ──────────────────────────────────

// Step 1: Redirect user to Google OAuth authorization
router.get('/connect', requireAuth, (req, res) => {
  if (!YOUTUBE_CLIENT_ID) {
    return res.status(500).send('YouTube integration not configured. Set YOUTUBE_CLIENT_ID env var.');
  }

  // Store user ID in state to link the account after callback
  const state = Buffer.from(JSON.stringify({ userId: req.user.id })).toString('base64url');

  const params = new URLSearchParams({
    client_id: YOUTUBE_CLIENT_ID,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
    redirect_uri: BASE_URL + '/auth/youtube/callback',
    state: state,
    access_type: 'offline',
    prompt: 'consent'
  });

  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
});

// Step 2: Handle Google OAuth callback — exchange code for tokens
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error || !code) {
      console.error('YouTube auth error:', error || 'no code');
      return res.redirect('/settings?error=YouTube+connection+cancelled');
    }

    // Decode state to get userId
    let userId;
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
      userId = stateData.userId;
    } catch (e) {
      return res.redirect('/settings?error=Invalid+YouTube+auth+state');
    }

    // Exchange authorization code for access token
    const tokenData = await httpsPost('https://oauth2.googleapis.com/token', {
      client_id: YOUTUBE_CLIENT_ID,
      client_secret: YOUTUBE_CLIENT_SECRET,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: BASE_URL + '/auth/youtube/callback'
    });

    if (tokenData.error || !tokenData.access_token) {
      console.error('YouTube token exchange failed:', JSON.stringify(tokenData));
      return res.redirect('/settings?error=YouTube+auth+failed:+' + encodeURIComponent(tokenData.error_description || tokenData.error || 'unknown'));
    }

    const { access_token, refresh_token, expires_in } = tokenData;
    const expiresAt = new Date(Date.now() + (expires_in * 1000));

    // Fetch user channel info
    let channelTitle = '';
    let channelId = '';
    try {
      const channelData = await httpsGet(
        'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
        { Authorization: 'Bearer ' + access_token }
      );
      if (channelData.items && channelData.items[0]) {
        channelTitle = channelData.items[0].snippet?.title || '';
        channelId = channelData.items[0].id || '';
      }
    } catch (e) {
      console.error('YouTube channel fetch error:', e.message);
    }

    // Save YouTube tokens to user account
    const db = getDb();
    const { userOps } = db;
    await userOps.updateYouTube(userId, {
      youtubeId: channelId,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: expiresAt,
      channelTitle: channelTitle
    });

    res.redirect('/settings?success=YouTube+account+connected' + (channelTitle ? '+as+' + encodeURIComponent(channelTitle) : ''));

  } catch (err) {
    console.error('YouTube OAuth error:', err.message || err);
    res.redirect('/settings?error=YouTube+connection+failed:+' + encodeURIComponent(err.message || 'unknown'));
  }
});

// ─── Disconnect YouTube ──────────────────────────────────────────

router.post('/disconnect', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    await db.userOps.clearYouTube(req.user.id);
    res.json({ success: true, message: 'YouTube account disconnected' });
  } catch (err) {
    console.error('YouTube disconnect error:', err);
    res.status(500).json({ error: 'Failed to disconnect YouTube' });
  }
});

// ─── Refresh YouTube Token ──────────────────────────────────────

async function refreshYouTubeToken(user) {
  if (!user.youtube_refresh_token) throw new Error('No refresh token available');

  const tokenData = await httpsPost('https://oauth2.googleapis.com/token', {
    client_id: YOUTUBE_CLIENT_ID,
    client_secret: YOUTUBE_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: user.youtube_refresh_token
  });

  if (tokenData.error || !tokenData.access_token) {
    throw new Error('Token refresh failed: ' + (tokenData.error_description || tokenData.error));
  }

  const db = getDb();
  const expiresAt = new Date(Date.now() + (tokenData.expires_in * 1000));
  await db.userOps.updateYouTube(user.id, {
    youtubeId: user.youtube_id,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || user.youtube_refresh_token,
    expiresAt: expiresAt,
    channelTitle: user.youtube_channel_title
  });

  return tokenData.access_token;
}

// Get a valid access token, refreshing if expired
async function getValidToken(user) {
  if (!user.youtube_access_token) throw new Error('YouTube not connected');

  // Check if token is expired (with 5 min buffer)
  const expiresAt = user.youtube_token_expires_at ? new Date(user.youtube_token_expires_at) : null;
  if (expiresAt && expiresAt.getTime() < Date.now() + 300000) {
    return await refreshYouTubeToken(user);
  }

  return user.youtube_access_token;
}

// ─── YouTube Content Posting API ────────────────────────────────

// Check connection status
router.get('/status', requireAuth, async (req, res) => {
  const user = req.user;
  res.json({
    connected: !!user.youtube_id,
    channelTitle: user.youtube_channel_title || null,
    youtubeId: user.youtube_id || null
  });
});

// Initialize resumable video upload (Step 1 of content upload)
router.post('/publish', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user.youtube_id) {
      return res.status(400).json({ error: 'YouTube account not connected. Go to Settings to connect.' });
    }

    const accessToken = await getValidToken(user);
    const { title, description = '', tags = [], privacyStatus = 'private', videoUrl } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Video title is required' });
    }

    if (!videoUrl) {
      return res.status(400).json({ error: 'Video URL is required' });
    }

    // Initialize resumable upload session
    // First, create a request body with video metadata
    const videoMetadata = {
      snippet: {
        title: title,
        description: description,
        tags: tags || [],
        categoryId: '22'  // People & Blogs (default)
      },
      status: {
        privacyStatus: privacyStatus,
        embeddable: true
      }
    };

    // Create the resumable upload session
    const uploadInit = await httpsPostJson(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      videoMetadata,
      { Authorization: 'Bearer ' + accessToken }
    );

    // The Location header contains the session URI for uploading the actual video file
    // For URL-based uploads, we'll need to pass the videoUrl in the actual upload phase
    // For now, return the session URI to the client
    if (!uploadInit || uploadInit.error) {
      console.error('YouTube upload init failed:', JSON.stringify(uploadInit));
      return res.status(400).json({
        error: 'YouTube upload init failed: ' + (uploadInit?.error?.message || 'unknown')
      });
    }

    res.json({
      success: true,
      sessionUri: uploadInit.id || null,
      videoUrl: videoUrl,
      message: 'Upload session initialized. Ready to upload video file.'
    });

  } catch (err) {
    console.error('YouTube publish error:', err.message || err);
    res.status(500).json({ error: 'Failed to initialize YouTube upload: ' + (err.message || 'unknown') });
  }
});

// Upload video to YouTube (resumable upload protocol)
router.post('/publish/upload', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user.youtube_id) {
      return res.status(400).json({ error: 'YouTube account not connected' });
    }

    const accessToken = await getValidToken(user);
    const { sessionUri, videoData, fileSize, contentRange } = req.body;

    if (!sessionUri) {
      return res.status(400).json({ error: 'Session URI is required' });
    }

    if (!videoData) {
      return res.status(400).json({ error: 'Video data is required' });
    }

    // Use resumable protocol to upload chunk
    // Note: In production, this would handle multipart streaming for large files
    const uploadResult = await httpsPost(
      sessionUri,
      videoData,
      {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'video/mp4',
        'Content-Length': Buffer.byteLength(videoData),
        'Content-Range': contentRange || `bytes 0-${Buffer.byteLength(videoData) - 1}/${fileSize || Buffer.byteLength(videoData)}`
      }
    );

    if (uploadResult.error) {
      console.error('YouTube upload failed:', JSON.stringify(uploadResult));
      return res.status(400).json({
        error: 'YouTube upload failed: ' + (uploadResult.error.message || 'unknown')
      });
    }

    res.json({
      success: true,
      videoId: uploadResult.id,
      message: 'Video uploaded to YouTube successfully'
    });

  } catch (err) {
    console.error('YouTube upload error:', err.message || err);
    res.status(500).json({ error: 'Failed to upload to YouTube: ' + (err.message || 'unknown') });
  }
});

// Simplified URL-based publish (for already-hosted videos)
router.post('/publish/from-url', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user.youtube_id) {
      return res.status(400).json({ error: 'YouTube account not connected' });
    }

    const accessToken = await getValidToken(user);
    const { title, description = '', tags = [], privacyStatus = 'private', videoUrl } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Video title is required' });
    }

    if (!videoUrl) {
      return res.status(400).json({ error: 'Video URL is required' });
    }

    // Create video with metadata via YouTube API
    // Note: YouTube doesn't directly support importing from URL in the same way TikTok does
    // This endpoint would initiate an upload session for the client to send the video data
    const videoMetadata = {
      snippet: {
        title: title,
        description: description,
        tags: tags || [],
        categoryId: '22'  // People & Blogs
      },
      status: {
        privacyStatus: privacyStatus,
        embeddable: true
      }
    };

    const uploadSession = await httpsPostJson(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      videoMetadata,
      { Authorization: 'Bearer ' + accessToken }
    );

    if (!uploadSession || uploadSession.error) {
      console.error('YouTube upload session failed:', JSON.stringify(uploadSession));
      return res.status(400).json({
        error: 'YouTube upload session failed: ' + (uploadSession?.error?.message || 'unknown')
      });
    }

    res.json({
      success: true,
      sessionUri: uploadSession.id || null,
      videoUrl: videoUrl,
      message: 'Upload session created. Client should fetch video from URL and upload to session URI.'
    });

  } catch (err) {
    console.error('YouTube URL publish error:', err.message || err);
    res.status(500).json({ error: 'Failed to create YouTube upload session: ' + (err.message || 'unknown') });
  }
});

// Check video upload/processing status
router.get('/publish/status/:videoId', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user.youtube_id) {
      return res.status(400).json({ error: 'YouTube account not connected' });
    }

    const accessToken = await getValidToken(user);

    const statusData = await httpsGet(
      `https://www.googleapis.com/youtube/v3/videos?id=${req.params.videoId}&part=processingDetails,status`,
      { Authorization: 'Bearer ' + accessToken }
    );

    if (!statusData.items || statusData.items.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const video = statusData.items[0];
    res.json({
      videoId: req.params.videoId,
      uploadStatus: video.status?.uploadStatus,
      privacyStatus: video.status?.privacyStatus,
      processingStatus: video.processingDetails?.processingStatus,
      processingProgress: video.processingDetails?.processingProgress,
      details: {
        status: video.status,
        processingDetails: video.processingDetails
      }
    });

  } catch (err) {
    console.error('YouTube status check error:', err.message || err);
    res.status(500).json({ error: 'Failed to check video status: ' + (err.message || 'unknown') });
  }
});

module.exports = router;
