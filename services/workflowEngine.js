const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const { getDb, workflowOps, connectedAccountOps, contentQueueOps } = require('../db/database');

// Workflow Engine Configuration
const POLL_INTERVAL = 60 * 1000; // Poll every 60 seconds
const WORKFLOW_TEMP_DIR = path.join('/tmp', 'workflow');

// Ensure temp directory exists
if (!fs.existsSync(WORKFLOW_TEMP_DIR)) {
  fs.mkdirSync(WORKFLOW_TEMP_DIR, { recursive: true });
}

function getYoutubeCookiesArgs() {
  const p = process.env.YT_COOKIES_PATH;
  if (p && require('fs').existsSync(p)) return ['--cookies', p];
  return [];
}

function getYoutubeProxyArgs() {
  const p = process.env.YT_PROXY_URL;
  if (p) return ['--proxy', p];
  return [];
}

// HTTPS/HTTP helpers
function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;
    const opts = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: { ...headers }
    };
    if (urlObj.port) opts.port = urlObj.port;

    const req = client.request(opts, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function httpsPost(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;
    const body = typeof data === 'string' ? data : new URLSearchParams(data).toString();
    const opts = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        ...headers
      }
    };
    if (urlObj.port) opts.port = urlObj.port;

    const req = client.request(opts, res => {
      let respData = '';
      res.on('data', chunk => { respData += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(respData) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: respData });
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpsPostJson(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;
    const body = JSON.stringify(data);
    const opts = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers
      }
    };
    if (urlObj.port) opts.port = urlObj.port;

    const req = client.request(opts, res => {
      let respData = '';
      res.on('data', chunk => { respData += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(respData) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: respData });
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Token refresh logic by platform
async function refreshTokenIfNeeded(account) {
  if (!account.refresh_token || !account.token_expires_at) return account;

  const now = new Date();
  const expiresAt = new Date(account.token_expires_at);
  const bufferTime = 5 * 60 * 1000; // 5 min buffer

  if (now.getTime() < expiresAt.getTime() - bufferTime) {
    return account; // Token still valid
  }

  console.log(`[WorkflowEngine] Token expiring soon for ${account.platform} (${account.id}), refreshing...`);

  try {
    let newTokenData;
    const platform = account.platform.toLowerCase();

    if (platform === 'youtube' || platform === 'google') {
      newTokenData = await httpsPost('https://oauth2.googleapis.com/token', {
        client_id: process.env.YOUTUBE_CLIENT_ID || '',
        client_secret: process.env.YOUTUBE_CLIENT_SECRET || '',
        refresh_token: account.refresh_token,
        grant_type: 'refresh_token'
      });
      if (newTokenData.body.access_token) {
        const expiresIn = newTokenData.body.expires_in || 3600;
        const newExpiresAt = new Date(Date.now() + (expiresIn * 1000));
        await connectedAccountOps.update(account.id, {
          accessToken: newTokenData.body.access_token,
          tokenExpiresAt: newExpiresAt
        });
        console.log(`[WorkflowEngine] Refreshed YouTube token for account ${account.id}`);
        return { ...account, access_token: newTokenData.body.access_token, token_expires_at: newExpiresAt };
      }
    } else if (platform === 'linkedin') {
      newTokenData = await httpsPost('https://www.linkedin.com/oauth/v2/accessToken', {
        client_id: process.env.LINKEDIN_CLIENT_ID || '',
        client_secret: process.env.LINKEDIN_CLIENT_SECRET || '',
        refresh_token: account.refresh_token,
        grant_type: 'refresh_token'
      });
      if (newTokenData.body.access_token) {
        const expiresIn = newTokenData.body.expires_in || 3600;
        const newExpiresAt = new Date(Date.now() + (expiresIn * 1000));
        await connectedAccountOps.update(account.id, {
          accessToken: newTokenData.body.access_token,
          tokenExpiresAt: newExpiresAt
        });
        console.log(`[WorkflowEngine] Refreshed LinkedIn token for account ${account.id}`);
        return { ...account, access_token: newTokenData.body.access_token, token_expires_at: newExpiresAt };
      }
    } else if (platform === 'tiktok') {
      newTokenData = await httpsPost('https://open.tiktokapis.com/v2/oauth/token/', {
        client_key: process.env.TIKTOK_CLIENT_KEY || '',
        client_secret: process.env.TIKTOK_CLIENT_SECRET || '',
        refresh_token: account.refresh_token,
        grant_type: 'refresh_token'
      });
      if (newTokenData.body.access_token) {
        const expiresIn = newTokenData.body.expires_in || 3600;
        const newExpiresAt = new Date(Date.now() + (expiresIn * 1000));
        await connectedAccountOps.update(account.id, {
          accessToken: newTokenData.body.access_token,
          tokenExpiresAt: newExpiresAt
        });
        console.log(`[WorkflowEngine] Refreshed TikTok token for account ${account.id}`);
        return { ...account, access_token: newTokenData.body.access_token, token_expires_at: newExpiresAt };
      }
    } else if (platform === 'twitter' || platform === 'x') {
      newTokenData = await httpsPost('https://api.twitter.com/2/oauth2/token', {
        client_id: process.env.TWITTER_CLIENT_ID || '',
        client_secret: process.env.TWITTER_CLIENT_SECRET || '',
        refresh_token: account.refresh_token,
        grant_type: 'refresh_token'
      });
      if (newTokenData.body.access_token) {
        const expiresIn = newTokenData.body.expires_in || 7200;
        const newExpiresAt = new Date(Date.now() + (expiresIn * 1000));
        await connectedAccountOps.update(account.id, {
          accessToken: newTokenData.body.access_token,
          tokenExpiresAt: newExpiresAt
        });
        console.log(`[WorkflowEngine] Refreshed Twitter token for account ${account.id}`);
        return { ...account, access_token: newTokenData.body.access_token, token_expires_at: newExpiresAt };
      }
    }
  } catch (err) {
    console.error(`[WorkflowEngine] Token refresh failed for ${account.platform} (${account.id}):`, err.message);
  }

  return account;
}

// Fetch recent content from source platform
async function fetchSourceContent(workflow, sourceAccount) {
  const platform = workflow.source_platform.toLowerCase();
  console.log(`[WorkflowEngine] Fetching content from ${platform} for workflow ${workflow.id}`);

  try {
    let items = [];

    if (platform === 'youtube') {
      // Get channel ID from metadata or use the one from account
      const channelId = sourceAccount.metadata?.channel_id || sourceAccount.platform_user_id;
      if (!channelId) throw new Error('No YouTube channel ID found');

      const response = await httpsGet(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&type=video&maxResults=10&order=date&key=${process.env.YOUTUBE_API_KEY || ''}`,
        { Authorization: `Bearer ${sourceAccount.access_token}` }
      );
      if (response.body.items) {
        items = response.body.items.map(item => ({
          id: item.id.videoId,
          title: item.snippet.title,
          description: item.snippet.description,
          thumbnail: item.snippet.thumbnails.default.url,
          url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
          platform: 'youtube',
          publishedAt: new Date(item.snippet.publishedAt)
        }));
      }
    } else if (platform === 'instagram') {
      const igUserId = sourceAccount.platform_user_id;
      if (!igUserId) throw new Error('No Instagram user ID found');

      const response = await httpsGet(
        `https://graph.instagram.com/${igUserId}/media?fields=id,caption,media_type,media_url,timestamp&access_token=${sourceAccount.access_token}`
      );
      if (response.body.data) {
        items = response.body.data.map(item => ({
          id: item.id,
          title: item.caption?.split('\n')[0].slice(0, 100) || 'Instagram Post',
          description: item.caption || '',
          thumbnail: item.media_url,
          url: `https://www.instagram.com/p/${item.id}/`,
          platform: 'instagram',
          mediaType: item.media_type,
          publishedAt: new Date(item.timestamp)
        }));
      }
    } else if (platform === 'tiktok') {
      // TikTok API requires different approach
      const response = await httpsGet(
        `https://open.tiktokapis.com/v2/video/list/?fields=id,create_time,description,duration,cover_image_url`,
        { Authorization: `Bearer ${sourceAccount.access_token}` }
      );
      if (response.body.data?.videos) {
        items = response.body.data.videos.map(video => ({
          id: video.id,
          title: video.description?.split('\n')[0].slice(0, 100) || 'TikTok Video',
          description: video.description || '',
          thumbnail: video.cover_image_url,
          url: `https://www.tiktok.com/video/${video.id}`,
          platform: 'tiktok',
          publishedAt: new Date(video.create_time * 1000)
        }));
      }
    } else if (platform === 'twitter' || platform === 'x') {
      const userId = sourceAccount.platform_user_id;
      if (!userId) throw new Error('No Twitter user ID found');

      const response = await httpsGet(
        `https://api.twitter.com/2/users/${userId}/tweets?tweet.fields=created_at,public_metrics&max_results=10`,
        { Authorization: `Bearer ${sourceAccount.access_token}` }
      );
      if (response.body.data) {
        items = response.body.data.map(tweet => ({
          id: tweet.id,
          title: tweet.text.split('\n')[0].slice(0, 100),
          description: tweet.text,
          thumbnail: '',
          url: `https://twitter.com/${sourceAccount.platform_username}/status/${tweet.id}`,
          platform: 'twitter',
          publishedAt: new Date(tweet.created_at)
        }));
      }
    } else if (platform === 'facebook') {
      const pageId = sourceAccount.metadata?.page_id || sourceAccount.platform_user_id;
      if (!pageId) throw new Error('No Facebook page ID found');

      const response = await httpsGet(
        `https://graph.facebook.com/${pageId}/feed?fields=id,message,picture,created_time&access_token=${sourceAccount.access_token}`
      );
      if (response.body.data) {
        items = response.body.data.map(post => ({
          id: post.id.split('_')[1],
          title: post.message?.split('\n')[0].slice(0, 100) || 'Facebook Post',
          description: post.message || '',
          thumbnail: post.picture,
          url: `https://www.facebook.com/${pageId}/posts/${post.id.split('_')[1]}`,
          platform: 'facebook',
          publishedAt: new Date(post.created_time)
        }));
      }
    }

    console.log(`[WorkflowEngine] Fetched ${items.length} items from ${platform}`);
    return items;
  } catch (err) {
    console.error(`[WorkflowEngine] Error fetching from ${platform}:`, err.message);
    return [];
  }
}

// Check if content already exists in queue
async function isContentAlreadyQueued(workflowId, sourceContentId) {
  try {
    const pool = getDb();
    const result = await pool.query(
      'SELECT id FROM content_queue WHERE workflow_id = $1 AND source_video_id = $2 LIMIT 1',
      [workflowId, sourceContentId]
    );
    return result.rows.length > 0;
  } catch (err) {
    console.error(`[WorkflowEngine] Error checking content queue:`, err.message);
    return false;
  }
}

// Download media (video or image)
async function downloadMedia(sourceItem, workflowId) {
  const tempPath = path.join(WORKFLOW_TEMP_DIR, `${workflowId}-${sourceItem.id}`);

  try {
    if (sourceItem.platform === 'youtube') {
      // Use yt-dlp for YouTube
      return new Promise((resolve, reject) => {
        const proc = spawn('yt-dlp', [
          '--no-warnings',
          ...getYoutubeCookiesArgs(),
          ...getYoutubeProxyArgs(),
          '-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
          '--merge-output-format', 'mp4',
          '-o', tempPath + '.mp4',
          sourceItem.url
        ]);
        let stderr = '';
        proc.stderr.on('data', d => { stderr += d.toString(); });
        proc.on('close', code => {
          if (code === 0) {
            resolve(tempPath + '.mp4');
          } else {
            reject(new Error('yt-dlp failed: ' + stderr.slice(-300)));
          }
        });
        proc.on('error', reject);
        setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('Download timeout')); }, 300000);
      });
    } else if (['instagram', 'tiktok', 'facebook'].includes(sourceItem.platform)) {
      // Download image/video using curl or wget
      return new Promise((resolve, reject) => {
        const ext = sourceItem.mediaType === 'VIDEO' || sourceItem.platform === 'tiktok' ? '.mp4' : '.jpg';
        const outPath = tempPath + ext;
        const proc = spawn('curl', ['-L', '-o', outPath, sourceItem.thumbnail || sourceItem.url]);
        proc.on('close', code => {
          if (code === 0) {
            resolve(outPath);
          } else {
            reject(new Error('curl failed'));
          }
        });
        proc.on('error', reject);
        setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('Download timeout')); }, 120000);
      });
    } else {
      throw new Error(`Unsupported source platform: ${sourceItem.platform}`);
    }
  } catch (err) {
    console.error(`[WorkflowEngine] Error downloading media for ${sourceItem.id}:`, err.message);
    throw err;
  }
}

// Convert video aspect ratio using face-tracking
async function convertAspectRatio(inputPath, sourceAspect, destAspect) {
  // Only convert if aspects are significantly different
  if (Math.abs(sourceAspect - destAspect) < 0.1) {
    return inputPath; // Already close to target
  }

  console.log(`[WorkflowEngine] Converting ${sourceAspect} to ${destAspect} for ${inputPath}`);

  try {
    // Try to use the existing detectFaces and crop logic from ai-reframe.js
    const faceDetectScript = path.join(__dirname, '..', 'scripts', 'face-detect.py');

    if (!fs.existsSync(faceDetectScript)) {
      console.warn(`[WorkflowEngine] Face detection script not found, skipping aspect ratio conversion`);
      return inputPath;
    }

    // Run face detection
    const faceData = await new Promise((resolve, reject) => {
      const proc = spawn('python3', [faceDetectScript, inputPath, '0.5']);
      let stdout = '';
      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.on('close', code => {
        if (code === 0 && stdout.trim()) {
          try {
            const data = JSON.parse(stdout.trim());
            if (data.error) reject(new Error(data.error));
            else resolve(data);
          } catch (e) {
            reject(new Error('Failed to parse face detection output'));
          }
        } else {
          reject(new Error('Face detection failed'));
        }
      });
      proc.on('error', reject);
      setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('Face detection timeout')); }, 120000);
    });

    // Calculate crop positions with face tracking
    const inputWidth = faceData.width || 1920;
    const inputHeight = faceData.height || 1080;
    let targetWidth, targetHeight;

    if (destAspect === 9 / 16) { // 9:16 (TikTok, Shorts, Reels)
      targetWidth = Math.min(1080, inputHeight * (9 / 16));
      targetHeight = inputHeight;
    } else if (destAspect === 16 / 9) { // 16:9 (YouTube, Facebook)
      targetWidth = inputWidth;
      targetHeight = Math.min(1080, inputWidth * (9 / 16));
    } else {
      return inputPath; // Unsupported aspect
    }

    const cropPositions = calculateFaceTrackingCrop(faceData, inputWidth, inputHeight, targetWidth, targetHeight);

    // Apply FFmpeg crop with the calculated positions
    const outputPath = inputPath.replace(/\.[^.]+$/, '') + '_reframed.mp4';
    await new Promise((resolve, reject) => {
      const cropFilter = cropPositions.length > 0
        ? `crop=${targetWidth}:${targetHeight}:${cropPositions[0].x}:${cropPositions[0].y}`
        : `crop=${targetWidth}:${targetHeight}`;

      const proc = spawn('ffmpeg', [
        '-i', inputPath,
        '-vf', cropFilter,
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '128k',
        outputPath
      ]);

      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error('FFmpeg crop failed'));
      });
      proc.on('error', reject);
      setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('FFmpeg timeout')); }, 300000);
    });

    // Clean up original
    try { fs.unlinkSync(inputPath); } catch (e) {}
    console.log(`[WorkflowEngine] Aspect ratio conversion complete: ${outputPath}`);
    return outputPath;
  } catch (err) {
    console.error(`[WorkflowEngine] Aspect ratio conversion failed:`, err.message);
    return inputPath; // Return original if conversion fails
  }
}

// Calculate face-tracking crop positions (simplified version from ai-reframe.js)
function calculateFaceTrackingCrop(faceData, inputWidth, inputHeight, targetWidth, targetHeight) {
  const positions = [];

  if (!faceData.samples || faceData.samples.length === 0) {
    return [{ x: (inputWidth - targetWidth) / 2, y: (inputHeight - targetHeight) / 2 }];
  }

  const samples = faceData.samples;
  let lastKnownCx = 0.5, lastKnownCy = 0.5;

  for (const sample of samples) {
    if (sample.faces && sample.faces.length > 0) {
      const avgCx = sample.faces.reduce((sum, f) => sum + f.cx, 0) / sample.faces.length;
      const avgCy = sample.faces.reduce((sum, f) => sum + f.cy, 0) / sample.faces.length;
      lastKnownCx = avgCx;
      lastKnownCy = avgCy;
    }

    const x = Math.max(0, Math.min(inputWidth - targetWidth, Math.floor(lastKnownCx * inputWidth - targetWidth / 2)));
    const y = Math.max(0, Math.min(inputHeight - targetHeight, Math.floor(lastKnownCy * inputHeight - targetHeight / 2)));
    positions.push({ x, y });
  }

  return positions;
}

// Publish to destination platform
async function publishToDestination(workflow, destAccount, sourceItem, mediaPath) {
  const platform = workflow.destination_platform.toLowerCase();
  console.log(`[WorkflowEngine] Publishing to ${platform} for workflow ${workflow.id}`);

  try {
    if (platform === 'youtube') {
      return await publishYouTube(destAccount, sourceItem, mediaPath);
    } else if (platform === 'instagram' || platform === 'instagram-reels') {
      return await publishInstagram(destAccount, sourceItem, mediaPath);
    } else if (platform === 'tiktok') {
      return await publishTikTok(destAccount, sourceItem, mediaPath);
    } else if (platform === 'twitter' || platform === 'x') {
      return await publishTwitter(destAccount, sourceItem, mediaPath);
    } else if (platform === 'facebook') {
      return await publishFacebook(destAccount, sourceItem, mediaPath);
    } else if (platform === 'linkedin') {
      return await publishLinkedIn(destAccount, sourceItem, mediaPath);
    } else if (platform === 'pinterest') {
      return await publishPinterest(destAccount, sourceItem, mediaPath);
    } else {
      throw new Error(`Unsupported destination platform: ${platform}`);
    }
  } catch (err) {
    console.error(`[WorkflowEngine] Publishing to ${platform} failed:`, err.message);
    throw err;
  }
}

async function publishYouTube(destAccount, sourceItem, mediaPath) {
  // Resumable upload — see https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
  if (!mediaPath || !fs.existsSync(mediaPath)) {
    throw new Error('YouTube publish: media file is missing');
  }
  const fileSize = fs.statSync(mediaPath).size;
  if (fileSize < 1024) {
    throw new Error('YouTube publish: media file is empty');
  }

  // YouTube clamps the title to 100 chars. Strip anything beyond and any
  // angle-brackets that would otherwise cause a 400.
  const safeTitle = String(sourceItem.title || 'Untitled')
    .replace(/[<>]/g, '')
    .slice(0, 100) || 'Untitled';
  const safeDescription = String(sourceItem.description || '').slice(0, 5000);

  const metadata = {
    snippet: {
      title: safeTitle,
      description: safeDescription,
      tags: Array.isArray(sourceItem.tags) && sourceItem.tags.length ? sourceItem.tags.slice(0, 10) : ['repurposed']
    },
    status: { privacyStatus: sourceItem.privacy || 'public', selfDeclaredMadeForKids: false }
  };

  const uploadUrl = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

  // YouTube needs these two X-Upload-* headers to allocate a resumable
  // session. Without them, the API returns a JSON error and never sets
  // the Location header — which is the failure mode behind the 'upload
  // session creation failed' message users were hitting.
  const response = await httpsPostJson(uploadUrl, metadata, {
    Authorization: `Bearer ${destAccount.access_token}`,
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Upload-Content-Type': 'video/mp4',
    'X-Upload-Content-Length': String(fileSize)
  });

  if (!response.headers.location) {
    // Surface the actual YouTube error rather than a generic message —
    // helps the user see auth/quota/scope issues directly.
    const status = response.status || 0;
    const body = response.body && (response.body.error || response.body);
    const reason = (body && (body.error_description || body.message ||
                   (body.error && (body.error.message || body.error.errors && body.error.errors[0] && body.error.errors[0].message))))
                   || (typeof body === 'string' ? body.slice(0, 200) : null);
    // Check quota FIRST — YouTube returns 403 for both 'token expired'
    // and 'quota exceeded', so we have to look at the message body to
    // tell them apart. Auth-style errors mention 'authError' or
    // 'invalid_grant'; quota errors say 'quota' or 'rateLimit'.
    const reasonStr = String(reason || '');
    const isQuota = /quota|rateLimit|userRateLimitExceeded|dailyLimitExceeded/i.test(reasonStr);
    const isAuth  = /authError|invalid[_ ]grant|invalid[_ ]credentials|expired|forbidden\.access/i.test(reasonStr) ||
                    (status === 401);
    if (isQuota) {
      throw new Error('YouTube daily upload quota exceeded. ' +
        'YouTube\'s default quota is 10,000 units per day and a single upload costs ~1,600 units (~6 uploads/day). ' +
        'Quota resets at midnight Pacific Time. To raise it, go to https://console.cloud.google.com -> APIs & Services -> YouTube Data API v3 -> Quotas -> Request quota increase.');
    }
    if (isAuth) {
      throw new Error('YouTube authentication failed (status ' + status + '). Reconnect YouTube on /distribute/connections and try again.' + (reasonStr ? ' Details: ' + reasonStr : ''));
    }
    throw new Error('YouTube upload session creation failed (status ' + status + ')' + (reason ? ': ' + reason : ''));
  }

  // Upload the video file to the resumable URL we just received.
  const resumableUrl = response.headers.location;
  const fileStream = fs.createReadStream(mediaPath);

  return new Promise((resolve, reject) => {
    const urlObj = new URL(resumableUrl);
    const opts = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': fileSize
      }
    };

    const req = https.request(opts, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const result = JSON.parse(data);
            resolve({ platform: 'youtube', videoId: result.id });
          } catch (e) {
            resolve({ platform: 'youtube', success: true });
          }
        } else {
          reject(new Error(`YouTube upload failed: ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    fileStream.pipe(req);
  });
}

async function publishInstagram(destAccount, sourceItem, mediaPath) {
  const igUserId = destAccount.platform_user_id;
  if (!igUserId) throw new Error('No Instagram user ID');

  // Create media container
  const containerResponse = await httpsPost(
    `https://graph.instagram.com/${igUserId}/media`,
    {
      media_type: sourceItem.mediaType || 'IMAGE',
      media_url: sourceItem.thumbnail,
      caption: sourceItem.description,
      access_token: destAccount.access_token
    }
  );

  if (!containerResponse.body.id) {
    throw new Error('Instagram container creation failed');
  }

  // Publish the container
  const publishResponse = await httpsPost(
    `https://graph.instagram.com/${igUserId}/media_publish`,
    {
      creation_id: containerResponse.body.id,
      access_token: destAccount.access_token
    }
  );

  if (!publishResponse.body.id) {
    throw new Error('Instagram publish failed');
  }

  return { platform: 'instagram', postId: publishResponse.body.id };
}

async function publishTikTok(destAccount, sourceItem, mediaPath) {
  // TikTok Content Posting API — Direct Post (video.publish scope).
  //
  // The /video/init/ endpoint rejects the request as "video info is empty"
  // unless we send BOTH post_info (title, privacy_level, disable_* flags)
  // AND a complete source_info with chunk_size + total_chunk_count.
  // The earlier minimal payload (just source_info.video_size) is what TikTok
  // returned the empty-info error for.
  //
  // Sandbox/unaudited apps: privacy_level must be SELF_ONLY — TikTok rejects
  // PUBLIC_TO_EVERYONE until the app has passed Content Posting API audit.
  // Once the app is approved we can flip this to PUBLIC_TO_EVERYONE (or read
  // it off sourceItem.privacy).
  const videoSize = fs.statSync(mediaPath).size;
  // TikTok chunked upload: single chunk fits up to 64MB; for clip sizes we
  // produce (~5MB) one chunk is fine.
  const CHUNK_SIZE = Math.min(videoSize, 64 * 1024 * 1024);
  const TOTAL_CHUNKS = Math.max(1, Math.ceil(videoSize / CHUNK_SIZE));
  // Title cap: TikTok rejects titles over 2200 chars. Default to a safe
  // 150-char trim so existing callers don't accidentally hit that limit.
  const rawTitle = (sourceItem.title || sourceItem.description || sourceItem.caption || 'Splicora clip').toString();
  const title = rawTitle.slice(0, 150);
  const privacyLevel = sourceItem.privacy_level || 'SELF_ONLY';
  const initResponse = await httpsPostJson(
    'https://open.tiktokapis.com/v2/post/publish/video/init/',
    {
      post_info: {
        title,
        privacy_level: privacyLevel,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 1000
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: videoSize,
        chunk_size: CHUNK_SIZE,
        total_chunk_count: TOTAL_CHUNKS
      }
    },
    { Authorization: `Bearer ${destAccount.access_token}` }
  );

  if (!initResponse.body.data?.upload_url) {
    // Surface TikTok's actual response so we can diagnose scope/sandbox
    // problems instead of returning a generic error.
    console.error('[publishTikTok] init failed:', JSON.stringify({
      statusCode: initResponse.statusCode,
      body: initResponse.body
    }));
    const ttErr = initResponse.body && initResponse.body.error;
    const errCode = ttErr && (ttErr.code || ttErr.error || '') || 'unknown';
    const errMsg = ttErr && (ttErr.message || ttErr.error_description || '') || JSON.stringify(initResponse.body).slice(0, 200);
    throw new Error(`TikTok upload init failed (${errCode}): ${errMsg}`);
  }

  const uploadUrl = initResponse.body.data.upload_url;
  const publishId = initResponse.body.data.publish_id;

  // Upload video file to TikTok's PUT endpoint.
  //
  // TikTok's chunked upload protocol requires Content-Range and
  // Content-Length headers even when there's only a single chunk —
  // omitting them returns HTTP 416 (Range Not Satisfiable). The values
  // match the chunk_size/total_chunk_count we sent to /video/init/.
  // We read the whole file into a buffer (clips are small, ~5MB) so
  // we can set Content-Length exactly. For larger uploads we'd switch
  // to multi-chunk with separate PUTs per chunk.
  const fileBuf = fs.readFileSync(mediaPath);
  const fileLen = fileBuf.length;
  await new Promise((resolve, reject) => {
    const urlObj = new URL(uploadUrl);
    const opts = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': fileLen,
        'Content-Range': 'bytes 0-' + (fileLen - 1) + '/' + fileLen
      }
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve();
        console.error('[publishTikTok] upload PUT failed:', res.statusCode, data.slice(0, 300));
        reject(new Error('TikTok upload failed: ' + res.statusCode + (data ? ' ' + data.slice(0, 200) : '')));
      });
    });
    req.on('error', reject);
    req.write(fileBuf);
    req.end();
  });

  // Direct Post flow: /video/init/ + PUT upload already constitutes the
  // publish. There is NO separate /video/publish/ call (the previous
  // implementation called one that returned an error). Instead, we poll
  // /v2/post/publish/status/fetch/ a few times to confirm TikTok actually
  // processed the upload, then return the publish_id as the externalId.
  //
  // Status terminal states:
  //   PUBLISH_COMPLETE — video is on the user's TikTok feed
  //   FAILED          — TikTok rejected it (gets logged + thrown)
  //   PROCESSING_DOWNLOAD / PROCESSING_UPLOAD — keep polling
  let finalStatus = 'PROCESSING';
  let failReason = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(r => setTimeout(r, 3000));
    const statusResp = await httpsPostJson(
      'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
      { publish_id: publishId },
      { Authorization: `Bearer ${destAccount.access_token}` }
    );
    const data = statusResp.body && statusResp.body.data;
    const s = data && data.status;
    if (s) finalStatus = s;
    if (s === 'PUBLISH_COMPLETE') break;
    if (s === 'FAILED') {
      failReason = (data.fail_reason || 'unknown');
      break;
    }
    // Other transient statuses: keep polling
  }
  if (finalStatus === 'FAILED') {
    throw new Error('TikTok publish failed: ' + failReason);
  }
  // For PROCESSING/SEND_TO_USER_INBOX/etc., trust TikTok will finish
  // asynchronously and return what we have.
  console.log('[publishTikTok] published as publishId=' + publishId + ' status=' + finalStatus);
  return { platform: 'tiktok', videoId: publishId, status: finalStatus };
}

async function publishTwitter(destAccount, sourceItem, mediaPath) {
  // Upload media first using v1.1 API
  const mediaFormData = new FormData();
  mediaFormData.append('media_data', fs.readFileSync(mediaPath));

  // For simplicity, just post text tweet for now
  const response = await httpsPostJson(
    'https://api.twitter.com/2/tweets',
    {
      text: sourceItem.title + '\n' + sourceItem.description
    },
    { Authorization: `Bearer ${destAccount.access_token}` }
  );

  if (!response.body.data?.id) {
    throw new Error('Twitter post failed');
  }

  return { platform: 'twitter', tweetId: response.body.data.id };
}

async function publishFacebook(destAccount, sourceItem, mediaPath) {
  const pageId = destAccount.metadata?.page_id || destAccount.platform_user_id;
  if (!pageId) throw new Error('No Facebook page ID');

  // Text-only path — Repurpose-style 'post body to Page feed' when no
  // media is attached. Posts via /<pageId>/feed instead of /photos.
  if (!mediaPath) {
    const text = (sourceItem.description || sourceItem.caption || sourceItem.title || '').slice(0, 5000);
    if (!text) throw new Error('Facebook requires text or media to post');
    const feedResp = await httpsPostJson(
      `https://graph.facebook.com/v21.0/${pageId}/feed`,
      { message: text, access_token: destAccount.access_token }
    );
    if (!feedResp.body || !feedResp.body.id) {
      throw new Error('Facebook text post failed: ' + JSON.stringify(feedResp.body).slice(0, 200));
    }
    return { platform: 'facebook', postId: feedResp.body.id };
  }

  // Post to Facebook feed
  const response = await httpsPost(
    `https://graph.facebook.com/${pageId}/photos`,
    {
      message: sourceItem.description,
      access_token: destAccount.access_token,
      url: sourceItem.thumbnail
    }
  );

  if (!response.body.id) {
    throw new Error('Facebook post failed');
  }

  return { platform: 'facebook', photoId: response.body.id };
}

async function publishLinkedIn(destAccount, sourceItem, mediaPath) {
  const personId = destAccount.platform_user_id;
  if (!personId) throw new Error('No LinkedIn person ID');

  // Register asset first
  const registerResponse = await httpsPostJson(
    'https://api.linkedin.com/v2/assets?action=registerUpload',
    {
      registerUploadRequest: {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-video'],
        owner: `urn:li:person:${personId}`,
        serviceRelationships: [
          {
            relationshipType: 'OWNER',
            identifier: 'urn:li:userGeneratedContent'
          }
        ]
      }
    },
    { Authorization: `Bearer ${destAccount.access_token}` }
  );

  // LinkedIn's response key is a literal dotted string (NOT chained
  // property access). LinkedIn has shipped at least two namespace
  // variants over time:
  //   - 'com.linkedin.digitalmedia.uploadmechanism.MediaUploadHttpRequest'
  //   - 'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'  (current)
  // ... and may introduce more. Rather than hardcode, find whichever
  // key carries the uploadUrl. Future-proofs against further renames
  // and avoids reintroducing the original bug.
  const value = registerResponse.body && registerResponse.body.value;
  const mechs = value && value.uploadMechanism;
  let mech = null;
  if (mechs && typeof mechs === 'object') {
    // Prefer the canonical MediaUploadHttpRequest key under any namespace,
    // otherwise take the first entry that has an uploadUrl.
    const keys = Object.keys(mechs);
    const preferred = keys.find(k => /MediaUploadHttpRequest$/i.test(k) && mechs[k] && mechs[k].uploadUrl);
    const anyKey    = keys.find(k => mechs[k] && mechs[k].uploadUrl);
    const key = preferred || anyKey;
    if (key) mech = mechs[key];
  }
  if (!mech || !mech.uploadUrl) {
    const detail = JSON.stringify(registerResponse.body || {}).slice(0, 300);
    throw new Error('LinkedIn asset registration failed: ' + detail);
  }

  // Upload the media
  const uploadUrl = mech.uploadUrl;
  const asset = registerResponse.body.value.asset;

  await new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(mediaPath);
    const urlObj = new URL(uploadUrl);
    // The mech object may carry transient auth headers (media token,
    // etc.) that must be forwarded with the upload request. Merge them
    // with our defaults.
    const extra = (mech && typeof mech.headers === 'object' && mech.headers) || {};
    const opts = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      // LinkedIn's MediaUploadHttpRequest spec uses PUT; using POST on
      // dms-uploads worked historically but PUT is what the docs call
      // for now.
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'video/mp4' }, extra)
    };

    const req = https.request(opts, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error('LinkedIn upload failed: ' + res.statusCode + (data ? ' — ' + data.slice(0, 200) : '')));
      });
    });
    req.on('error', reject);
    fileStream.pipe(req);
  });

  // LinkedIn processes the uploaded video asynchronously. Creating a
  // UGC post that references the asset before it's READY returns a
  // generic 400 'INVALID_PARAMETERS' for the media field. Wait briefly
  // for the processing to start; the worst case is the post still
  // fails and we surface the real reason below.
  await new Promise(r => setTimeout(r, 5000));

  // Create UGC post. LinkedIn requires X-Restli-Protocol-Version 2.0.0
  // on /v2/ugcPosts; without it the API rejects nested objects like
  // specificContent.com.linkedin.ugc.ShareContent with a generic 400.
  const commentary = (sourceItem.description || sourceItem.caption || sourceItem.title || '').slice(0, 3000);
  const postResponse = await httpsPostJson(
    'https://api.linkedin.com/v2/ugcPosts',
    {
      author: `urn:li:person:${personId}`,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: commentary },
          shareMediaCategory: 'VIDEO',
          media: [{ status: 'READY', media: asset, title: { text: (sourceItem.title || '').slice(0, 200) } }]
        }
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
    },
    {
      Authorization: `Bearer ${destAccount.access_token}`,
      'X-Restli-Protocol-Version': '2.0.0'
    }
  );

  if (!postResponse.body || !postResponse.body.id) {
    const status = postResponse.status || 0;
    const body = postResponse.body || {};
    const reason = body.message || body.error || (typeof body === 'string' ? body : JSON.stringify(body).slice(0, 300));
    // LinkedIn often returns 'Video is not yet uploaded' / 'INVALID_PARAMETERS'
    // when the asset hasn't finished processing. The 5-second wait above
    // covers most cases but very large files may need longer. Make the
    // hint actionable.
    if (/INVALID_PARAMETERS|not yet uploaded|not ready|processing/i.test(String(reason))) {
      throw new Error('LinkedIn rejected the post because the video is still being processed on their side. Try Publish again in 30-60 seconds.');
    }
    if (status === 401 || status === 403) {
      throw new Error('LinkedIn authentication failed (status ' + status + '). Reconnect LinkedIn on /distribute/connections.');
    }
    throw new Error('LinkedIn post creation failed (status ' + status + '): ' + reason);
  }

  return { platform: 'linkedin', postId: postResponse.body.id };
}

async function publishPinterest(destAccount, sourceItem, mediaPath) {
  // Create pin on Pinterest
  const response = await httpsPostJson(
    'https://api.pinterest.com/v5/pins',
    {
      title: sourceItem.title,
      description: sourceItem.description,
      link: sourceItem.url,
      image_url: sourceItem.thumbnail,
      board_id: destAccount.metadata?.board_id
    },
    { Authorization: `Bearer ${destAccount.access_token}` }
  );

  if (!response.body.id) {
    throw new Error('Pinterest pin creation failed');
  }

  return { platform: 'pinterest', pinId: response.body.id };
}

// Process a single workflow
async function processWorkflow(workflow) {
  console.log(`[WorkflowEngine] Processing workflow ${workflow.id} (${workflow.source_platform} -> ${workflow.destination_platform})`);

  try {
    // Get connected accounts
    const sourceAccount = await connectedAccountOps.getById(workflow.source_account_id);
    const destAccount = await connectedAccountOps.getById(workflow.destination_account_id);

    if (!sourceAccount) {
      console.error(`[WorkflowEngine] Source account not found for workflow ${workflow.id}`);
      return;
    }
    if (!destAccount) {
      console.error(`[WorkflowEngine] Destination account not found for workflow ${workflow.id}`);
      return;
    }

    // Refresh tokens if needed
    const refreshedSource = await refreshTokenIfNeeded(sourceAccount);
    const refreshedDest = await refreshTokenIfNeeded(destAccount);

    // Fetch recent content from source
    const sourceItems = await fetchSourceContent(workflow, refreshedSource);
    console.log(`[WorkflowEngine] Found ${sourceItems.length} source items for workflow ${workflow.id}`);

    for (const sourceItem of sourceItems) {
      try {
        // Check if already queued
        const alreadyQueued = await isContentAlreadyQueued(workflow.id, sourceItem.id);
        if (alreadyQueued) {
          console.log(`[WorkflowEngine] Content ${sourceItem.id} already queued, skipping`);
          continue;
        }

        // Download media
        console.log(`[WorkflowEngine] Downloading content ${sourceItem.id}...`);
        let mediaPath = await downloadMedia(sourceItem, workflow.id);

        // Convert aspect ratio if needed
        const sourceAspect = sourceItem.platform === 'youtube' || sourceItem.platform === 'facebook' ? 16 / 9 : 9 / 16;
        const destAspect = workflow.destination_platform === 'youtube' || workflow.destination_platform === 'facebook' ? 16 / 9 : 9 / 16;
        if (sourceAspect !== destAspect) {
          console.log(`[WorkflowEngine] Converting aspect ratio ${sourceAspect} -> ${destAspect}`);
          mediaPath = await convertAspectRatio(mediaPath, sourceAspect, destAspect);
        }

        // Publish to destination
        console.log(`[WorkflowEngine] Publishing to ${workflow.destination_platform}...`);
        const publishResult = await publishToDestination(workflow, refreshedDest, sourceItem, mediaPath);

        // Record in content queue
        await contentQueueOps.create({
          workflowId: workflow.id,
          userId: workflow.user_id,
          sourceVideoId: sourceItem.id,
          sourceUrl: sourceItem.url,
          title: sourceItem.title,
          description: sourceItem.description,
          thumbnailUrl: sourceItem.thumbnail,
          status: 'published',
          metadata: publishResult
        });

        // Increment post count
        await workflowOps.incrementPostCount(workflow.id);

        console.log(`[WorkflowEngine] Successfully published content ${sourceItem.id} from workflow ${workflow.id}`);

        // Clean up media
        try { fs.unlinkSync(mediaPath); } catch (e) {}
      } catch (itemErr) {
        console.error(`[WorkflowEngine] Failed to process item ${sourceItem.id}:`, itemErr.message);

        // Record failure in content queue
        try {
          await contentQueueOps.create({
            workflowId: workflow.id,
            userId: workflow.user_id,
            sourceVideoId: sourceItem.id,
            sourceUrl: sourceItem.url,
            title: sourceItem.title,
            status: 'failed',
            metadata: { error: itemErr.message }
          });
        } catch (e) {
          console.error(`[WorkflowEngine] Failed to record error:`, e.message);
        }
      }
    }
  } catch (err) {
    console.error(`[WorkflowEngine] Error processing workflow ${workflow.id}:`, err.message);
  }
}

// Get all active workflows
async function getActiveWorkflows() {
  try {
    const pool = getDb();
    const result = await pool.query(
      'SELECT * FROM workflows WHERE auto_publish = true AND is_active = true ORDER BY created_at DESC'
    );
    return result.rows;
  } catch (err) {
    console.error(`[WorkflowEngine] Error fetching active workflows:`, err.message);
    return [];
  }
}

// Main polling loop
async function startWorkflowEngine() {
  console.log('[WorkflowEngine] Starting workflow engine (polling every 60 seconds)');

  setInterval(async () => {
    try {
      const workflows = await getActiveWorkflows();
      if (workflows.length === 0) {
        console.log('[WorkflowEngine] No active workflows to process');
        return;
      }

      console.log(`[WorkflowEngine] Processing ${workflows.length} active workflows...`);

      for (const workflow of workflows) {
        // Process sequentially to avoid overwhelming the system
        await processWorkflow(workflow);
      }
    } catch (err) {
      console.error('[WorkflowEngine] Fatal error in polling loop:', err.message);
    }
  }, POLL_INTERVAL);
}

module.exports = {
  startWorkflowEngine,
  publishToDestination,
  publishYouTube,
  publishInstagram,
  publishTikTok,
  publishTwitter,
  publishFacebook,
  publishLinkedIn,
  publishPinterest,
  refreshTokenIfNeeded
};
