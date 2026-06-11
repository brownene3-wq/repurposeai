const express = require('express');
const router = express.Router();
const https = require('https');
const http = require('http');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');

// Helper: make an HTTPS request (GET or POST)
function httpsRequest(url, options = {}) {
  return new Promise((resolve, reject) =>  {
    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...(options.headers || {})
      }
    };
    const req = https.request(reqOptions, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsRequest(res.headers.location, options).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

// Decode HTML entities in transcript text
function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/\n/g, ' ')
    .trim();
}

// Fetch YouTube video title using oEmbed API
async function fetchVideoTitle(videoId) {
  // Method 1: oEmbed API
  try {
    const oembedUrl = 'https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=' + videoId + '&format=json';
    const response = await httpsRequest(oembedUrl);
    if (response.status === 200) {
      const data = JSON.parse(response.data);
      if (data.title) return data.title;
    }
  } catch (e) {
    console.error('oEmbed title fetch failed for', videoId, ':', e.message);
  }

  // Method 2: Scrape from YouTube watch page <title> tag
  try {
    const watchUrl = 'https://www.youtube.com/watch?v=' + videoId;
    const response = await httpsRequest(watchUrl);
    if (response.status === 200 && response.data) {
      // Try og:title meta tag first (most reliable)
      const ogMatch = response.data.match(/<meta\s+property="og:title"\s+content="([^"]+)"/);
      if (ogMatch && ogMatch[1]) return decodeEntities(ogMatch[1]);
      // Try <title> tag (contains " - YouTube" suffix)
      const titleMatch = response.data.match(/<title>([^<]+)<\/title>/);
      if (titleMatch && titleMatch[1]) {
        const title = titleMatch[1].replace(/\s*-\s*YouTube\s*$/, '').trim();
        if (title && title !== 'YouTube') return decodeEntities(title);
      }
    }
  } catch (e) {
    console.error('Page scrape title fetch failed for', videoId, ':', e.message);
  }

  // Method 3: noembed.com fallback
  try {
    const noembedUrl = 'https://noembed.com/embed?url=https://www.youtube.com/watch?v=' + videoId;
    const response = await httpsRequest(noembedUrl);
    if (response.status === 200) {
      const data = JSON.parse(response.data);
      if (data.title) return data.title;
    }
  } catch (e) {
    console.error('noembed title fetch failed for', videoId, ':', e.message);
  }

  return 'Untitled Video';
}

// Parse transcript XML into text
function parseTranscriptXml(xml) {
  const texts = [];
  // Try <p> format first (newer format)
  const pRegex = /<p\s+t="\d+"[^>]*>([\s\S]*?)<\/p>/g;
  let match;
  while ((match = pRegex.exec(xml)) !== null) {
    const inner = match[1];
    // Extract text from <s> tags if present
    const sTexts = [];
    const sRegex = /<s[^>]*>([^<]*)<\/s>/g;
    let sMatch;
    while ((sMatch = sRegex.exec(inner)) !== null) {
      sTexts.push(sMatch[1]);
    }
    const text = sTexts.length > 0 ? sTexts.join('') : inner.replace(/<[^>]+>/g, '');
    const decoded = decodeEntities(text);
    if (decoded) texts.push(decoded);
  }
  if (texts.length > 0) return texts.join(' ');

  // Try <text> format (older format)
  const textRegex = /<text[^>]*>(.*?)<\/text>/gs;
  while ((match = textRegex.exec(xml)) !== null) {
    const decoded = decodeEntities(match[1]);
    if (decoded) texts.push(decoded);
  }
  return texts.join(' ');
}

// Method 0: Fetch transcript via Supadata API (paid, reliable)
async function fetchTranscriptViaSupadata(videoId) {
  const apiKey = process.env.SUPADATA_API_KEY || 'sd_18fdc58ae29bb5969c690d748c5ce1bd';
  if (!apiKey) {
    throw new Error('SUPADATA_API_KEY not configured');
  }
  console.log('[Transcript] Trying Supadata API for', videoId);
  const videoUrl = encodeURIComponent('https://www.youtube.com/watch?v=' + videoId);
          const response = await httpsRequest('https://api.supadata.ai/v1/transcript?url=https://www.youtube.com/watch?v=' + videoId, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'Accept': 'application/json'
    }
  });

  console.log('[Transcript] Supadata response status:', response.status);

  if (response.status === 202) {
    // Async processing - poll for result
    const jobData = JSON.parse(response.data);
    const jobId = jobData.id || jobData.jobId;
    if (!jobId) throw new Error('Supadata returned 202 but no job ID');
    console.log('[Transcript] Supadata async job:', jobId, '- polling...');

    // Poll up to 30 seconds
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const pollResponse = await httpsRequest('https://api.supadata.ai/v1/transcript/' + jobId, {
        method: 'GET',
        headers: { 'x-api-key': apiKey, 'Accept': 'application/json' }
      });
      if (pollResponse.status === 200) {
        const pollData = JSON.parse(pollResponse.data);
        const text = extractSupadataTranscript(pollData);
        if (text) {
          console.log('[Transcript] Supadata async success:', text.length, 'chars');
          return text;
        }
      }
    }
    throw new Error('Supadata async job timed out after 30s');
  }

  if (response.status !== 200) {
    const errMsg = response.data ? response.data.substring(0, 200) : 'Unknown error';
    throw new Error('Supadata API error ' + response.status + ': ' + errMsg);
  }

  const data = JSON.parse(response.data);
  const text = extractSupadataTranscript(data);
  if (!text) {
    throw new Error('Supadata returned empty transcript');
  }
  console.log('[Transcript] Supadata success:', text.length, 'chars');
  return text;
}

function extractSupadataTranscript(data) {
  // Handle array of segments with text field
  if (data.content && Array.isArray(data.content)) {
    return data.content.map(seg => seg.text || seg).filter(Boolean).join(' ').trim();
  }
  // Handle direct string content
  if (data.content && typeof data.content === 'string') {
    return data.content.trim();
  }
  // Handle transcript field
  if (data.transcript && typeof data.transcript === 'string') {
    return data.transcript.trim();
  }
  if (data.transcript && Array.isArray(data.transcript)) {
    return data.transcript.map(seg => seg.text || seg).filter(Boolean).join(' ').trim();
  }
  // Handle text field directly
  if (data.text && typeof data.text === 'string') {
    return data.text.trim();
  }
  return null;
}

// Method 1: Fetch transcript via YouTube innertube player API (ANDROID client)
async function fetchTranscriptViaAndroid(videoId) {
  console.log('[Transcript] Trying ANDROID innertube for', videoId);
  const postData = JSON.stringify({
    context: {
      client: {
        clientName: 'ANDROID',
        clientVersion: '19.29.37',
        androidSdkVersion: 34,
        hl: 'en',
        gl: 'US'
      }
    },
    videoId: videoId
  });

  const resp = await httpsRequest('https://www.youtube.com/youtubei/v1/player?key=AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w&prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'com.google.android.youtube/19.29.37 (Linux; U; Android 14; en_US) gzip',
      'X-Goog-Api-Format-Version': '2'
    },
    body: postData
  });

  if (resp.status !== 200) throw new Error('Innertube player returned ' + resp.status);

  let json;
  try {
    json = JSON.parse(resp.data);
  } catch (e) {
    console.error('[Transcript] ANDROID innertube returned non-JSON:', resp.data.substring(0, 500));
    throw new Error('ANDROID innertube returned invalid JSON');
  }

  // Debug: log playability status and available keys
  const playability = json?.playabilityStatus;
  if (playability) {
    console.log('[Transcript] ANDROID playability:', playability.status, playability.reason || '');
  }
  console.log('[Transcript] ANDROID captions exists:', !!json?.captions);

  if (playability?.status === 'LOGIN_REQUIRED') {
    throw new Error('LOGIN_REQUIRED from ANDROID innertube');
  }

  const tracks = json?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw new Error('No caption tracks from ANDROID innertube (playability: ' + (playability?.status || 'unknown') + ')');
  }

  // Prefer English
  const track = tracks.find(t => t.languageCode === 'en') || tracks[0];
  const captionUrl = track.baseUrl;
  if (!captionUrl) throw new Error('No baseUrl in caption track');

  const captionResp = await httpsRequest(captionUrl);
  const transcript = parseTranscriptXml(captionResp.data);
  if (!transcript) throw new Error('Empty transcript from ANDROID innertube');
  console.log('[Transcript] ANDROID innertube succeeded for', videoId, '- length:', transcript.length);
  return transcript;
}

// Method 2: Fetch transcript via WEB page scraping
async function fetchTranscriptViaWebPage(videoId) {
  console.log('[Transcript] Trying WEB page scraping for', videoId);
  const resp = await httpsRequest('https://www.youtube.com/watch?v=' + videoId, {
    headers: { 'Cookie': 'CONSENT=PENDING+999' }
  });

  if (resp.status !== 200) throw new Error('YouTube page returned ' + resp.status);

  console.log('[Transcript] WEB page response length:', resp.data.length);

  // Check for CAPTCHA
  if (resp.data.includes('class="g-recaptcha"')) {
    throw new Error('YouTube CAPTCHA triggered');
  }

  // Check for consent page
  if (resp.data.includes('consent.youtube.com') || resp.data.includes('CONSENT')) {
    console.log('[Transcript] WEB page has consent redirect');
  }

  // Extract caption tracks from ytInitialPlayerResponse
  let captionTracks;

  // Method A: Extract from ytInitialPlayerResponse inline JSON
  const playerMatch = resp.data.match(/var ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
  if (playerMatch) {
    try {
      const playerData = JSON.parse(playerMatch[1]);
      const playStatus = playerData?.playabilityStatus;
      console.log('[Transcript] WEB page playability:', playStatus?.status, playStatus?.reason || '');
      console.log('[Transcript] WEB page captions exists:', !!playerData?.captions);
      captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    } catch (e) {
      console.log('[Transcript] WEB page ytInitialPlayerResponse JSON parse failed');
    }
  } else {
    console.log('[Transcript] WEB page: no ytInitialPlayerResponse found');
    // Check if page has the video at all
    console.log('[Transcript] WEB page has playabilityStatus:', resp.data.includes('playabilityStatus'));
    console.log('[Transcript] WEB page has captionTracks string:', resp.data.includes('captionTracks'));
  }

  // Method B: Extract captionTracks directly
  if (!captionTracks) {
    const captionMatch = resp.data.match(/"captionTracks":\s*(\[.*?\])/);
    if (captionMatch) {
      try {
        captionTracks = JSON.parse(captionMatch[1]);
        console.log('[Transcript] WEB page method B found', captionTracks.length, 'tracks');
      } catch (e) {}
    }
  }

  if (!Array.isArray(captionTracks) || captionTracks.length === 0) {
    throw new Error('No caption tracks found on page');
  }

  const track = captionTracks.find(t => t.languageCode === 'en') || captionTracks[0];
  let captionUrl = track.baseUrl;
  if (!captionUrl) throw new Error('No baseUrl in caption track');

  const captionResp = await httpsRequest(captionUrl);
  const transcript = parseTranscriptXml(captionResp.data);
  if (!transcript) throw new Error('Empty transcript from web page');
  console.log('[Transcript] WEB page scraping succeeded for', videoId, '- length:', transcript.length);
  return transcript;
}

// Method 3: Fetch transcript via WEB innertube player API
async function fetchTranscriptViaWebInnertube(videoId) {
  console.log('[Transcript] Trying WEB innertube for', videoId);
  const postData = JSON.stringify({
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20250101.00.00',
        hl: 'en',
        gl: 'US'
      }
    },
    videoId: videoId
  });

  const resp = await httpsRequest('https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8&prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://www.youtube.com',
      'Referer': 'https://www.youtube.com/watch?v=' + videoId
    },
    body: postData
  });

  if (resp.status !== 200) throw new Error('WEB innertube returned ' + resp.status);

  let json;
  try {
    json = JSON.parse(resp.data);
  } catch (e) {
    console.error('[Transcript] WEB innertube returned non-JSON:', resp.data.substring(0, 500));
    throw new Error('WEB innertube returned invalid JSON');
  }

  const playability = json?.playabilityStatus;
  if (playability) {
    console.log('[Transcript] WEB innertube playability:', playability.status, playability.reason || '');
  }
  console.log('[Transcript] WEB innertube captions exists:', !!json?.captions);

  // If LOGIN_REQUIRED, don't waste time parsing — fail fast
  if (playability?.status === 'LOGIN_REQUIRED') {
    throw new Error('LOGIN_REQUIRED from WEB innertube');
  }

  const tracks = json?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw new Error('No caption tracks from WEB innertube (playability: ' + (playability?.status || 'unknown') + ')');
  }

  const track = tracks.find(t => t.languageCode === 'en') || tracks[0];
  const captionUrl = track.baseUrl;
  if (!captionUrl) throw new Error('No baseUrl in caption track');

  const captionResp = await httpsRequest(captionUrl);
  const transcript = parseTranscriptXml(captionResp.data);
  if (!transcript) throw new Error('Empty transcript from WEB innertube');
  console.log('[Transcript] WEB innertube succeeded for', videoId, '- length:', transcript.length);
  return transcript;
}

// Method 4: Use innertube get_transcript endpoint (works for Shorts)
async function fetchTranscriptViaGetTranscript(videoId) {
  console.log('[Transcript] Trying get_transcript endpoint for', videoId);

  // First we need to get the video page to extract serialized share entity
  // The get_transcript endpoint needs a params token
  // We can construct it from the video ID
  // The params field is a base64-encoded protobuf that contains the video ID
  // Format: \n\x0b{videoId}\x12\x04asr\x18\x01
  const paramsBytes = Buffer.from(
    '\n\x0b' + videoId + '\x12\x04asr\x18\x01'
  );
  const params = paramsBytes.toString('base64');

  const postData = JSON.stringify({
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20250101.00.00',
        hl: 'en',
        gl: 'US'
      }
    },
    params: params
  });

  const resp = await httpsRequest('https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: postData
  });

  if (resp.status !== 200) throw new Error('get_transcript returned ' + resp.status);

  let json;
  try {
    json = JSON.parse(resp.data);
  } catch (e) {
    throw new Error('get_transcript returned invalid JSON');
  }

  // Navigate the response structure
  const actions = json?.actions;
  if (!actions || actions.length === 0) {
    console.log('[Transcript] get_transcript response keys:', Object.keys(json || {}).join(','));
    throw new Error('No actions in get_transcript response');
  }

  // Try to find transcript segments
  let segments;
  try {
    // Path 1: Standard transcript panel
    segments = actions[0]?.updateEngagementPanelAction?.content
      ?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body
      ?.transcriptSegmentListRenderer?.initialSegments;
  } catch (e) {}

  if (!segments || segments.length === 0) {
    // Path 2: Try alternative structure
    try {
      const renderer = actions[0]?.updateEngagementPanelAction?.content?.transcriptRenderer;
      if (renderer) {
        console.log('[Transcript] get_transcript renderer keys:', Object.keys(renderer).join(','));
      }
      // Try direct body path
      segments = renderer?.body?.transcriptSegmentListRenderer?.initialSegments;
    } catch (e) {}
  }

  if (!segments || segments.length === 0) {
    // Log what we got for debugging
    console.log('[Transcript] get_transcript action type:', Object.keys(actions[0] || {}).join(','));
    throw new Error('No transcript segments in get_transcript response');
  }

  const texts = segments
    .map(seg => {
      const runs = seg?.transcriptSegmentRenderer?.snippet?.runs;
      if (runs) return runs.map(r => r.text).join('');
      return null;
    })
    .filter(Boolean);

  if (texts.length === 0) throw new Error('Empty transcript from get_transcript');
  const transcript = texts.join(' ');
  console.log('[Transcript] get_transcript succeeded for', videoId, '- length:', transcript.length);
  return transcript;
}

// Method 5: Use third-party transcript proxy APIs (bypass YouTube IP blocking)
async function fetchTranscriptViaProxy(videoId) {
  console.log('[Transcript] Trying proxy APIs for', videoId);

  // Try multiple free transcript proxy services
  const proxyApis = [
    {
      name: 'kome.ai',
      url: 'https://kome.ai/api/tools/youtube-transcripts',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_id: videoId, format: false }),
      extract: (data) => {
        const json = JSON.parse(data);
        if (json.transcript) return json.transcript;
        if (json.text) return json.text;
        throw new Error('No transcript in response');
      }
    },
    {
      name: 'youtubetranscript.com',
      url: 'https://www.youtubetranscript.com/api/transcript?videoId=' + videoId,
      method: 'GET',
      headers: {},
      body: null,
      extract: (data) => {
        // Returns array of segments or XML
        try {
          const json = JSON.parse(data);
          if (Array.isArray(json)) {
            return json.map(s => s.text || s.snippet || '').filter(Boolean).join(' ');
          }
          if (json.transcript) return json.transcript;
        } catch (e) {}
        // Try parsing as XML
        const transcript = parseTranscriptXml(data);
        if (transcript) return transcript;
        throw new Error('Could not parse response');
      }
    },
    {
      name: 'tactiq.io',
      url: 'https://tactiq-apps-prod.tactiq.io/transcript',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl: 'https://www.youtube.com/watch?v=' + videoId, langCode: 'en' }),
      extract: (data) => {
        const json = JSON.parse(data);
        if (json.captions) {
          return json.captions.map(c => c.text).filter(Boolean).join(' ');
        }
        throw new Error('No captions in response');
      }
    }
  ];

  for (const api of proxyApis) {
    try {
      console.log('[Transcript] Trying proxy:', api.name);
      const resp = await httpsRequest(api.url, {
        method: api.method,
        headers: api.headers,
        body: api.body
      });

      if (resp.status !== 200) {
        console.log('[Transcript] Proxy', api.name, 'returned status', resp.status);
        continue;
      }

      const transcript = api.extract(resp.data);
      if (transcript && transcript.trim().length > 0) {
        console.log('[Transcript] Proxy', api.name, 'succeeded for', videoId, '- length:', transcript.length);
        return transcript;
      }
    } catch (err) {
      console.log('[Transcript] Proxy', api.name, 'failed:', err.message);
    }
  }

  throw new Error('All proxy APIs failed');
}

// Master function: try all methods
async function fetchVideoTranscript(videoId) {
  const methods = [
    { name: 'Supadata API', fn: fetchTranscriptViaSupadata },
    { name: 'ANDROID innertube', fn: fetchTranscriptViaAndroid },
    { name: 'WEB page scraping', fn: fetchTranscriptViaWebPage },
    { name: 'WEB innertube', fn: fetchTranscriptViaWebInnertube },
    { name: 'get_transcript', fn: fetchTranscriptViaGetTranscript },
    { name: 'proxy APIs', fn: fetchTranscriptViaProxy }
  ];

  const errors = [];
  for (const method of methods) {
    try {
      const transcript = await method.fn(videoId);
      if (transcript && transcript.trim().length > 0) {
        return transcript;
      }
    } catch (err) {
      console.error('[Transcript]', method.name, 'failed for', videoId, ':', err.message);
      errors.push(method.name + ': ' + err.message);
    }
  }

  throw new Error('All transcript methods failed. Details: ' + errors.join(' | '));
}

// Legacy alias kept for compatibility
async function fetchTranscriptFallback(videoId) {
  return new Promise((resolve, reject) => {
    const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Cookie': 'CONSENT=YES+1'
      }
    };
    https.get(pageUrl, options, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, options, handleResponse).on('error', reject);
        return;
      }
      handleResponse(res);
    }).on('error', reject);

    function handleResponse(res) {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          // Extract captions URL from page source
          const captionMatch = data.match(/"captionTracks":\s*(\[.*?\])/);
          if (!captionMatch) {
            // Try alternative pattern
            const altMatch = data.match(/playerCaptionsTracklistRenderer.*?"captionTracks":\s*(\[.*?\])/);
            if (!altMatch) {
              return reject(new Error('No captions found on page'));
            }
            var tracks = JSON.parse(altMatch[1]);
          } else {
            var tracks = JSON.parse(captionMatch[1]);
          }
          if (!tracks || tracks.length === 0) {
            return reject(new Error('No caption tracks available'));
          }
          // Prefer English track
          let track = tracks.find(t => t.languageCode === 'en') || tracks[0];
          let captionUrl = track.baseUrl;
          if (!captionUrl) {
            return reject(new Error('No caption URL found'));
          }
          // Add format parameter for better results
          if (!captionUrl.includes('fmt=')) {
            captionUrl += (captionUrl.includes('?') ? '&' : '?') + 'fmt=srv3';
          }
          // Fetch the actual captions XML
          https.get(captionUrl, options, (captionRes) => {
            let captionData = '';
            captionRes.on('data', chunk => captionData += chunk);
            captionRes.on('end', () => {
              // Parse XML captions - extract text between <text> tags
              const texts = [];
              const textRegex = /<text[^>]*>(.*?)<\/text>/gs;
              let match;
              while ((match = textRegex.exec(captionData)) !== null) {
                let text = match[1]
                  .replace(/&amp;/g, '&')
                  .replace(/&lt;/g, '<')
                  .replace(/&gt;/g, '>')
                  .replace(/&quot;/g, '"')
                  .replace(/&#39;/g, "'")
                  .replace(/\n/g, ' ')
                  .trim();
                if (text) texts.push(text);
              }
              if (texts.length === 0) {
                return reject(new Error('No text found in captions'));
              }
              resolve(texts.join(' '));
            });
          }).on('error', reject);
        } catch (e) {
          reject(e);
        }
      });
    }
  });
}

// Second fallback: Use YouTube's innertube API directly
async function fetchTranscriptInnertube(videoId) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20240101.00.00',
          hl: 'en',
          gl: 'US'
        }
      },
      videoId: videoId
    });

    const options = {
      hostname: 'www.youtube.com',
      path: '/youtubei/v1/get_transcript?prettyPrint=false',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const actions = json?.actions;
          if (!actions) return reject(new Error('No transcript data from innertube'));
          const transcriptRenderer = actions[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments;
          if (!transcriptRenderer || transcriptRenderer.length === 0) {
            return reject(new Error('No transcript segments from innertube'));
          }
          const texts = transcriptRenderer
            .map(seg => seg?.transcriptSegmentRenderer?.snippet?.runs?.map(r => r.text).join(''))
            .filter(Boolean);
          if (texts.length === 0) return reject(new Error('Empty innertube transcript'));
          resolve(texts.join(' '));
        } catch (e) {
          reject(new Error('Failed to parse innertube response: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

const OpenAI = require('openai');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { requireAuth, checkPlanLimit } = require('../middleware/auth');
const { contentOps, outputOps, brandVoiceOps, userRenderOps } = require('../db/database');

let client;
function getOpenAIClient() {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 55000 });
  }
  return client;
}

// File upload setup for video/audio repurposing
const uploadDir = path.join(__dirname, '..', 'uploads', 'repurpose');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) { cb(null, uploadDir); },
    filename: function (req, file, cb) {
      const ext = (path.extname(file.originalname || '') || '').toLowerCase();
      cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 10) + ext);
    }
  }),
  limits: { fileSize: 200 * 1024 * 1024 }
});

// Find ffmpeg binary
let ffmpegPath = null;
const localFfmpeg = path.join(__dirname, '..', 'node_modules', 'ffmpeg-static', 'ffmpeg');
if (fs.existsSync(localFfmpeg)) { ffmpegPath = localFfmpeg; }
if (!ffmpegPath) { try { ffmpegPath = require('ffmpeg-static'); } catch (e) {} }
if (!ffmpegPath) { try { execSync('which ffmpeg', { stdio: 'pipe' }); ffmpegPath = 'ffmpeg'; } catch (e) {} }

// Extract audio as MP3 for Whisper (keeps file under 25MB limit)
function extractAudioForRepurpose(inputPath) {
  const mp3Path = inputPath + '.mp3';
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg not available'));
    const proc = spawn(ffmpegPath, [
      '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', '-y', mp3Path
    ]);
    proc.on('close', (code) => code === 0 ? resolve(mp3Path) : reject(new Error('Audio extraction failed')));
    proc.on('error', reject);
  });
}

// Transcribe audio file using OpenAI Whisper
async function transcribeUploadedFile(audioPath) {
  const openai = getOpenAIClient();
  let stat;
  try { stat = fs.statSync(audioPath); } catch (e) { throw new Error('Audio file not found at ' + audioPath); }
  const sizeMB = stat.size / (1024 * 1024);
  if (sizeMB > 24.5) {
    throw new Error('Audio is ' + sizeMB.toFixed(1) + 'MB after extraction. Whisper limit is 25MB. Please upload a shorter clip (or split it first).');
  }
  console.log('[transcribeUploadedFile] path=' + audioPath + ' size=' + sizeMB.toFixed(2) + 'MB');
  const fileStream = fs.createReadStream(audioPath);
  const response = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file: fileStream,
    response_format: 'text'
  });
  return response;
}

// GET - Premium repurpose form page
router.get('/', requireAuth, (req, res) => {
  res.send(`
    ${getHeadHTML('Create')}
      <style>
        ${getBaseCSS()}

        .main-content {
          margin-left: 250px;
          flex: 1;
          padding: 40px;
        }

        .header {
          margin-bottom: 40px;
        }

        .header h1 {
          font-size: 32px;
          margin-bottom: 10px;
          background: var(--gradient-1);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .header p {
          color: #a0aec0;
          font-size: 16px;
        }

        body.light .header p {
          color: #4a5568;
        }

        .form-container {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 40px;
          max-width: 1200px;
        }

        .form-section {
          background: #161616;
          border: 1px solid rgba(108,58,237,0.15);
          border-radius: 16px;
          padding: 30px;
          backdrop-filter: blur(10px);
        }

        body.light .form-section {
          background: #fff;
          border: 1px solid rgba(108,58,237,0.12);
          box-shadow: 0 2px 12px rgba(108,58,237,0.06);
        }

        .form-section h2 {
          font-size: 18px;
          margin-bottom: 20px;
          background: var(--gradient-1);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          font-weight: 700;
        }

        body.light .form-section h2 {
          background: var(--gradient-1);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .form-group {
          margin-bottom: 20px;
        }

        .form-group label {
          display: block;
          margin-bottom: 8px;
          font-size: 14px;
          color: #b0b0b0;
          font-weight: 500;
        }

        body.light .form-group label {
          color: #666;
        }

        .form-group input {
          width: 100%;
          padding: 12px;
          background: #0a0a0a;
          border: 1px solid #333;
          border-radius: 8px;
          color: #e0e0e0;
          font-size: 14px;
          transition: all 0.3s;
        }

        body.light .form-group input {
          background: #f5f5f5;
          border: 1px solid #ddd;
          color: #1a1a1a;
        }

        .form-group input:focus {
          outline: none;
          border-color: #6c5ce7;
          box-shadow: 0 0 0 3px rgba(108, 92, 231, 0.1);
        }

        /* ── Source toggle (URL ↔ Upload) ─────────────────────── */
        .source-toggle {
          display: flex;
          gap: 6px;
          padding: 4px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px;
          margin-bottom: 14px;
          max-width: 460px;
        }
        body.light .source-toggle { background: rgba(108,58,237,0.05); border-color: rgba(108,58,237,0.12); }
        .source-tab {
          flex: 1 1 auto;
          padding: 9px 14px;
          border: none;
          border-radius: 8px;
          background: transparent;
          color: var(--text-muted);
          font-size: 0.86rem;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease;
        }
        .source-tab:hover { background: rgba(255,255,255,0.05); color: var(--text); }
        .source-tab.active { background: linear-gradient(135deg, #6C3AED, #EC4899); color: #fff; }
        .source-panel.hidden { display: none; }
        /* Upload zone — modeled after AI Captions */
        .upload-zone {
          border: 2px dashed rgba(108,58,237,0.30);
          background: rgba(108,58,237,0.04);
          border-radius: 14px;
          padding: 28px 20px 24px;
          text-align: center;
          color: var(--text);
          cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease;
        }
        .upload-zone:hover, .upload-zone.dragover {
          border-color: rgba(108,58,237,0.65);
          background: rgba(108,58,237,0.10);
        }
        .upload-zone h3 { margin: 0 0 4px; font-size: 1rem; font-weight: 700; }
        .upload-zone p  { margin: 0 0 12px; color: var(--text-muted); font-size: 0.85rem; }
        .upload-zone .btn-secondary {
          background: rgba(108,58,237,0.18);
          border: 1px solid rgba(108,58,237,0.40);
          color: #fff;
          padding: 8px 18px;
          border-radius: 8px;
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
        }
        .upload-zone .btn-secondary:hover { background: rgba(108,58,237,0.30); }
        .upload-file-name {
          margin-top: 12px;
          padding: 8px 12px;
          background: rgba(16,185,129,0.10);
          border: 1px solid rgba(16,185,129,0.30);
          border-radius: 8px;
          color: #6ee7b7;
          font-size: 0.82rem;
          font-weight: 600;
        }
        .upload-hint {
          margin: 8px 0 0;
          font-size: 0.78rem;
          color: var(--text-muted);
          line-height: 1.5;
        }

        .platform-selector {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
        }

        .platform-card {
          padding: 16px;
          border: 2px solid #333;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.3s;
          text-align: center;
          user-select: none;
          background: #0a0a0a;
          position: relative;
          overflow: hidden;
        }

        body.light .platform-card {
          background: #f8f9fc;
          border: 2px solid #e2e8f0;
        }

        .platform-card:hover {
          border-color: #6c5ce7;
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(108,58,237,0.15);
        }

        .platform-card.selected {
          color: white;
          border-color: transparent;
        }

        .platform-card[data-platform="Instagram"].selected {
          background: linear-gradient(135deg, #833AB4, #E1306C, #F77737);
          border-color: transparent;
        }
        .platform-card[data-platform="TikTok"].selected {
          background: linear-gradient(135deg, #010101, #25F4EE, #FE2C55);
          border-color: transparent;
        }
        .platform-card[data-platform="Twitter"].selected {
          background: linear-gradient(135deg, #14171A, #1DA1F2);
          border-color: transparent;
        }
        .platform-card[data-platform="LinkedIn"].selected {
          background: linear-gradient(135deg, #0A66C2, #004182);
          border-color: transparent;
        }
        .platform-card[data-platform="Facebook"].selected {
          background: linear-gradient(135deg, #1877F2, #0D47A1);
          border-color: transparent;
        }
        .platform-card[data-platform="YouTube"].selected {
          background: linear-gradient(135deg, #FF0000, #CC0000);
          border-color: transparent;
        }
        .platform-card[data-platform="Threads"].selected {
          background: linear-gradient(135deg, #333333, #555555);
          border-color: transparent;
        }
        .platform-card[data-platform="Pinterest"].selected {
          background: linear-gradient(135deg, #E60023, #AD081B);
          border-color: transparent;
        }
        .platform-card[data-platform="Blog"].selected {
          background: linear-gradient(135deg, #6C3AED, #EC4899);
          border-color: transparent;
        }

        .platform-card input {
          display: none;
        }

        .tone-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
        }

        .tone-option {
          padding: 12px;
          border: 1px solid #333;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.3s;
          text-align: center;
          background: #0a0a0a;
          font-size: 13px;
        }


        body.light .tone-option {
          background: #f5f5f5;
          border: 1px solid #ddd;
          color: #1a1a2e;
        }

        .tone-option:hover {
          border-color: #6c5ce7;
        }

        body.light .tone-option:hover {
          border-color: #6c5ce7;
          background: #f0eeff;
        }

        .tone-option.selected {
          background: #6c5ce7;
          border-color: #6c5ce7;
          color: white;
        }

        body.light .tone-option.selected {
          background: #6c5ce7;
          border-color: #6c5ce7;
          color: white;
        }

        .tone-option.disabled {
          opacity: 0.35;
          cursor: not-allowed;
          pointer-events: none;
        }

        .tone-label-disabled {
          font-size: 12px;
          color: #6c5ce7;
          margin-top: 6px;
          font-style: italic;
          display: none;
        }

        .tone-label-disabled.show {
          display: block;
        }

        .form-group select {
          width: 100%;
          padding: 12px;
          background: #0a0a0a;
          border: 1px solid #333;
          border-radius: 8px;
          color: #e0e0e0;
          font-size: 14px;
        }

        body.light .form-group select {
          background: #f5f5f5;
          border: 1px solid #ddd;
          color: #1a1a1a;
        }

        .form-group select:focus {
          outline: none;
          border-color: #6c5ce7;
        }

        .button-group {
          display: flex;
          gap: 12px;
          margin-top: 30px;
        }

        .btn {
          flex: 1;
          padding: 14px 24px;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
        }

        .btn-primary {
          background: linear-gradient(135deg, #6C3AED 0%, #EC4899 100%);
          color: white;
          border-radius: 50px;
        }

        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 30px rgba(108, 58, 237, 0.4);
        }

        .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
        }

        .btn-secondary {
          background: #222;
          color: #e0e0e0;
          border: 1px solid #333;
        }

        body.light .btn-secondary {
          background: #f0f0f0;
          color: #1a1a1a;
          border: 1px solid #ddd;
        }

        .btn-secondary:hover {
          background: #333;
        }

        body.light .btn-secondary:hover {
          background: #e0e0e0;
        }

        .results-container {
          display: none;
          margin-top: 40px;
        }

        .results-container.show {
          display: block;
        }

        .results-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 20px;
          margin-top: 20px;
        }

        .result-card {
          background: #161616;
          border: 1px solid #222;
          border-radius: 12px;
          padding: 20px;
          backdrop-filter: blur(10px);
          animation: slideIn 0.5s ease-out;
        }

        body.light .result-card {
          background: #fff;
          border: 1px solid #e0e0e0;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .result-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 15px;
          padding-bottom: 15px;
          border-bottom: 1px solid #222;
        }

        body.light .result-header {
          border-bottom: 1px solid #e0e0e0;
        }

        .platform-name {
          font-size: 16px;
          font-weight: 700;
          color: #6c5ce7;
        }
        .platform-name[data-platform="Instagram"] { color: #E1306C; }
        .platform-name[data-platform="TikTok"] { color: #25F4EE; }
        body.light .platform-name[data-platform="TikTok"] { color: #010101; }
        .platform-name[data-platform="Twitter"] { color: #1DA1F2; }
        .platform-name[data-platform="LinkedIn"] { color: #0A66C2; }
        .platform-name[data-platform="Facebook"] { color: #1877F2; }
        .platform-name[data-platform="YouTube"] { color: #FF0000; }
        .platform-name[data-platform="Threads"] { color: #ccc; }
        body.light .platform-name[data-platform="Threads"] { color: #000; }
        .platform-name[data-platform="Pinterest"] { color: #E60023; }
        .platform-name[data-platform="Blog"] { background: linear-gradient(135deg, #6C3AED, #EC4899); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }

        .char-count {
          font-size: 12px;
          color: #888;
          background: #0a0a0a;
          padding: 4px 8px;
          border-radius: 4px;
        }

        body.light .char-count {
          background: #f5f5f5;
          color: #999;
        }

        .result-content {
          color: #e0e0e0;
          font-size: 14px;
          line-height: 1.6;
          margin-bottom: 15px;
          max-height: 200px;
          overflow-y: auto;
        }

        body.light .result-content {
          color: #333;
        }

        .result-actions {
          display: flex;
          gap: 10px;
        }

        .icon-btn {
          flex: 1;
          padding: 10px;
          border: 1px solid #333;
          background: #0a0a0a;
          color: #b0b0b0;
          border-radius: 6px;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.3s;
        }

        body.light .icon-btn {
          border: 1px solid #ddd;
          background: #f5f5f5;
          color: #666;
        }

        .icon-btn:hover {
          border-color: #6c5ce7;
          color: #6c5ce7;
        }

        .loading {
          display: none;
          text-align: center;
          padding: 40px;
        }

        .loading.show {
          display: block;
        }

        .spinner {
          width: 50px;
          height: 50px;
          border: 4px solid #333;
          border-top: 4px solid #6c5ce7;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 20px;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .loading-text {
          color: #888;
          font-size: 16px;
        }

        /* Toast — mirrors the AI Captions pattern. Bottom-right pill
           that slides in and auto-dismisses. Used by Create's
           validation so users get the same feedback they're used to
           on AI Captions. */
        .toast {
          position: fixed;
          bottom: 20px;
          right: 20px;
          background: #1a1a2e;
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 8px;
          padding: 1rem 1.5rem;
          font-size: 0.9rem;
          z-index: 1000;
          display: none;
          color: #fff;
          max-width: 400px;
          animation: slideIn 0.3s ease-out;
          box-shadow: 0 12px 32px rgba(0,0,0,0.45);
        }
        .toast.show { display: block; }
        .toast.success { border-color: #10B981; background: #064e3b; color: #6ee7b7; }
        .toast.error   { border-color: #EF4444; background: #7f1d1d; color: #fca5a5; }
        @keyframes slideIn {
          from { transform: translateX(110%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }

        .error {
          background: #4a1a1a;
          border: 1px solid #a22a2a;
          color: #ff6b6b;
          padding: 15px;
          border-radius: 8px;
          margin-top: 20px;
          display: none;
        }

        .error.show {
          display: block;
        }

        .success-feedback {
          position: fixed;
          bottom: 20px;
          right: 20px;
          background: #2a7a2a;
          color: #6bff6b;
          padding: 15px 20px;
          border-radius: 8px;
          animation: slideInRight 0.3s ease-out;
          display: none;
          z-index: 1000;
        }

        .success-feedback.show {
          display: block;
        }

        @keyframes slideInRight {
          from {
            opacity: 0;
            transform: translateX(300px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @media (max-width: 768px) {
          .form-container {
            grid-template-columns: 1fr;
          }

          .sidebar {
            width: 100%;
            height: auto;
            position: relative;
            border-right: none;
            border-bottom: 1px solid #222;
          }

          .main-content {
            margin-left: 0;
          }

          .platform-selector {
            grid-template-columns: 1fr;
          }

          .results-grid {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </head>
    <body>
      <div class="container">
        ${getSidebar('repurpose', req.user, req.teamPermissions)}

        <div class="main-content">
          ${getThemeToggle()}
          <div class="header">
            <h1><img src="/images/section-icons/A-2.png" alt="" style="height:36px;width:36px;vertical-align:middle;margin-right:8px;border-radius:8px;display:inline-block">Create</h1>
            <p>Turn any YouTube video into tailored content for multiple platforms with AI</p>
          </div>

          <div class="form-container">
            <div class="form-section">
              <h2>Step 1: Your Content</h2>

              <!-- Source toggle — mutually exclusive URL vs Upload, AI
                   Captions style. Switching hides the other panel
                   completely so users can't fill both. -->
              <div class="source-toggle" role="tablist" aria-label="Content source">
                <button type="button" id="srcTabUrl" class="source-tab active" role="tab" aria-selected="true" onclick="setSourceMode('url')">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:6px"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                  YouTube URL
                </button>
                <button type="button" id="srcTabUpload" class="source-tab" role="tab" aria-selected="false" onclick="setSourceMode('upload')">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:6px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  Upload File
                </button>
              </div>

              <!-- URL panel — default visible -->
              <div class="form-group source-panel" id="srcPanelUrl">
                <label>YouTube URL</label>
                <input type="url" id="youtubeUrl" name="yt_repurpose_url" autocomplete="one-time-code" data-form-type="other" data-lpignore="true" placeholder="https://www.youtube.com/watch?v=..." />
              </div>

              <!-- Upload panel — hidden until user picks 'Upload File' -->
              <div class="form-group source-panel hidden" id="srcPanelUpload">
                <label>Upload Video or Audio</label>
                <div class="upload-zone" id="uploadZone" tabindex="0" role="button" aria-label="Choose a file to upload">
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-bottom:8px;opacity:.85"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  <h3>Drop your file here</h3>
                  <p>or click to browse — MP4, MOV, WebM, MP3, WAV, M4A</p>
                  <button type="button" class="btn-secondary" onclick="document.getElementById('repFileInput').click()">Choose File</button>
                  <input type="file" id="repFileInput" style="display:none" accept="video/*,audio/*" onchange="handleRepurposeFile(this)">
                  <div id="repFileName" class="upload-file-name" style="display:none"></div>
                </div>
                <p class="upload-hint">Up to ~120 minutes. We'll extract the audio and transcribe it with the same engine that processes YouTube videos.</p>
              </div>

              <h2 style="margin-top: 30px;">Step 2: Choose Platforms</h2>
              <div class="platform-selector">
                <div class="platform-card" data-platform="Instagram">
                  <input type="checkbox" name="platform" value="Instagram" />
                  <span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;margin-right:4px"><defs><radialGradient id="ig" cx="30%" cy="107%" r="150%"><stop offset="0%" stop-color="#fdf497"/><stop offset="5%" stop-color="#fdf497"/><stop offset="45%" stop-color="#fd5949"/><stop offset="60%" stop-color="#d6249f"/><stop offset="90%" stop-color="#285AEB"/></radialGradient></defs><rect x="2" y="2" width="20" height="20" rx="6" fill="url(#ig)"/><circle cx="12" cy="12" r="5" stroke="#fff" stroke-width="2" fill="none"/><circle cx="17.5" cy="6.5" r="1.5" fill="#fff"/></svg> Instagram</span>
                </div>
                <div class="platform-card" data-platform="TikTok">
                  <input type="checkbox" name="platform" value="TikTok" />
                  <span><svg width="16" height="16" viewBox="0 0 24 24" style="vertical-align:middle;margin-right:4px"><rect width="24" height="24" rx="6" fill="#000"/><path d="M16.5 8.5c1.2.8 2.6 1 3.5 1v-2.5c-.8 0-2-.5-2.7-1.3-.6-.7-.8-1.5-.8-2.2h-2.3v10.8c0 1.5-1.2 2.7-2.7 2.7s-2.7-1.2-2.7-2.7 1.2-2.7 2.7-2.7c.3 0 .5 0 .8.1V9.1c-.3 0-.5-.1-.8-.1-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5V8.5z" fill="#fff"/></svg> TikTok</span>
                </div>
                <div class="platform-card" data-platform="Twitter">
                  <input type="checkbox" name="platform" value="Twitter" />
                  <span><svg width="16" height="16" viewBox="0 0 24 24" style="vertical-align:middle;margin-right:4px"><rect width="24" height="24" rx="6" fill="#000"/><path d="M13.8 10.5L19 4.5h-1.5l-4.5 5.2L9.2 4.5H4.5l5.6 8.1L4.5 19.5H6l4.8-5.6 4 5.6h4.7l-5.7-9zm-1.7 2l-.6-.8L6.5 5.5h1.9l3.6 5.1.6.8 4.7 6.7h-1.9l-3.3-5.6z" fill="#fff"/></svg> Twitter/X</span>
                </div>
                <div class="platform-card" data-platform="LinkedIn">
                  <input type="checkbox" name="platform" value="LinkedIn" />
                  <span><svg width="16" height="16" viewBox="0 0 24 24" style="vertical-align:middle;margin-right:4px"><rect width="24" height="24" rx="6" fill="#0A66C2"/><path d="M8.5 10v7H6v-7h2.5zM7.25 9c-.8 0-1.25-.55-1.25-1.25S6.45 6.5 7.25 6.5s1.25.55 1.25 1.25S8.05 9 7.25 9zM18 17h-2.5v-3.5c0-1-.4-1.7-1.3-1.7-.7 0-1.1.5-1.3.9-.1.1-.1.3-.1.5V17H10.5s0-6.5 0-7h2.3v1c.3-.5 1-1.2 2.2-1.2 1.6 0 3 1.1 3 3.3V17z" fill="#fff"/></svg> LinkedIn</span>
                </div>
                <div class="platform-card" data-platform="Facebook">
                  <input type="checkbox" name="platform" value="Facebook" />
                  <span><svg width="16" height="16" viewBox="0 0 24 24" style="vertical-align:middle;margin-right:4px"><rect width="24" height="24" rx="6" fill="#1877F2"/><path d="M16.5 12.5l.5-3h-3V8c0-.8.4-1.5 1.6-1.5H17V4.1s-1.1-.2-2.2-.2c-2.2 0-3.6 1.3-3.6 3.7v2.4H8.5v3h2.7V20h3.3v-7.5h2z" fill="#fff"/></svg> Facebook</span>
                </div>
                <div class="platform-card" data-platform="YouTube">
                  <input type="checkbox" name="platform" value="YouTube" />
                  <span><svg width="16" height="16" viewBox="0 0 24 24" style="vertical-align:middle;margin-right:4px"><rect width="24" height="24" rx="6" fill="#FF0000"/><path d="M19.6 8.3c-.2-.8-.8-1.4-1.6-1.6C16.8 6.5 12 6.5 12 6.5s-4.8 0-6 .2c-.8.2-1.4.8-1.6 1.6C4.2 9.5 4.2 12 4.2 12s0 2.5.2 3.7c.2.8.8 1.4 1.6 1.6 1.2.2 6 .2 6 .2s4.8 0 6-.2c.8-.2 1.4-.8 1.6-1.6.2-1.2.2-3.7.2-3.7s0-2.5-.2-3.7z" fill="#FF0000"/><path d="M10.5 14.8V9.2L15 12l-4.5 2.8z" fill="#fff"/></svg> YouTube</span>
                </div>
                <div class="platform-card" data-platform="Threads">
                  <input type="checkbox" name="platform" value="Threads" />
                  <span><svg width="16" height="16" viewBox="0 0 24 24" style="vertical-align:middle;margin-right:4px"><rect width="24" height="24" rx="6" fill="#333" stroke="#555" stroke-width="1"/><path d="M16.5 11.5c-.1-2.4-1.4-3.8-3.6-3.8-1.3 0-2.4.6-3 1.7l1.3.7c.4-.7 1-1 1.7-1 1.2 0 1.9.7 2 2-.5-.3-1.2-.4-1.9-.4-2 0-3.4 1-3.4 2.6 0 1.5 1.3 2.5 3 2.5 1.3 0 2.2-.6 2.7-1.6.1.5.1 1 .1 1.5h1.5c0-.7-.1-1.4-.2-2-.1-.7-.2-1.5-.2-2.2zm-3.5 3.3c-.8 0-1.4-.4-1.4-1.1 0-.8.7-1.2 1.8-1.2.6 0 1.1.1 1.5.3-.2 1.2-1 2-1.9 2z" fill="#fff"/></svg> Threads</span>
                </div>
                <div class="platform-card" data-platform="Pinterest">
                  <input type="checkbox" name="platform" value="Pinterest" />
                  <span><svg width="16" height="16" viewBox="0 0 24 24" style="vertical-align:middle;margin-right:4px"><rect width="24" height="24" rx="6" fill="#E60023"/><path d="M12 5c-3.9 0-7 3.1-7 7 0 2.8 1.6 5.2 4 6.3 0-.5 0-1.1.1-1.6.2-.6 1-4.3 1-4.3s-.3-.5-.3-1.2c0-1.2.7-2 1.5-2 .7 0 1.1.5 1.1 1.2 0 .7-.5 1.8-.7 2.8-.2.8.4 1.5 1.2 1.5 1.5 0 2.5-1.9 2.5-4.2 0-1.7-1.2-3-3.3-3-2.4 0-3.9 1.8-3.9 3.8 0 .7.2 1.2.5 1.5.1.2.2.2.1.4l-.2.6c0 .2-.2.3-.4.2-1.1-.4-1.6-1.7-1.6-3 0-2.5 2.1-5.5 6.2-5.5 3.3 0 5.5 2.4 5.5 5 0 3.4-1.9 6-4.6 6-.9 0-1.8-.5-2.1-1.1l-.6 2.3c-.2.7-.6 1.4-1 2 .8.2 1.6.4 2.5.4 3.9 0 7-3.1 7-7s-3.1-7-7-7z" fill="#fff"/></svg> Pinterest</span>
                </div>
                <div class="platform-card" data-platform="Blog">
                  <input type="checkbox" name="platform" value="Blog" />
                  <span><svg width="16" height="16" viewBox="0 0 24 24" style="vertical-align:middle;margin-right:4px"><rect width="24" height="24" rx="6" fill="#6C3AED"/><path d="M7 7h10v2H7V7zm0 4h10v2H7v-2zm0 4h7v2H7v-2z" fill="#fff"/></svg> Blog Post</span>
                </div>
              </div>
            </div>

            <div class="form-section">
              <h2>Step 3: Tone & Brand Voice</h2>
              <div class="form-group">
                <label>Tone of Voice</label>
                <input type="hidden" name="tone" id="toneValue" value="" />
                <div class="tone-grid">
                  <div class="tone-option" data-tone="Professional">
                    Professional
                  </div>
                  <div class="tone-option" data-tone="Casual">
                    Casual
                  </div>
                  <div class="tone-option" data-tone="Humorous">
                    Humorous
                  </div>
                  <div class="tone-option" data-tone="Inspirational">
                    Inspirational
                  </div>
                  <div class="tone-option" data-tone="Educational">
                    Educational
                  </div>
                </div>
                <div class="tone-label-disabled" id="toneDisabledHint">Tone is set by your brand voice</div>
              </div>

              <div class="form-group" style="margin-top: 20px;">
                <label>Brand Voice (Optional)</label>
                <select id="brandVoice" onchange="handleBrandVoiceChange()">
                  <option value="">None</option>
                </select>
              </div>

              <div class="button-group" style="display:flex;justify-content:center">
                <button class="btn btn-primary" style="max-width:280px;width:100%;justify-content:center" onclick="repurposeContent()">Create Now</button>
              </div>
            </div>
          </div>

          <div class="toast" id="createToast" role="status" aria-live="polite"></div>

          <div class="results-container" id="resultsContainer">
            <div class="loading" id="loadingState">
              <div class="spinner"></div>
              <div class="loading-text">Analyzing video and generating content...</div>
            </div>

            <div id="errorMessage" class="error"></div>

            <div id="resultsContent" style="display: none;">
              <h2 style="margin-bottom: 20px;">Your Generated Content</h2>
              <div class="results-grid" id="resultsGrid"></div>
              <div class="button-group" style="margin-top: 30px;">
                <button class="btn btn-secondary" onclick="resetForm()">← Generate More</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="success-feedback" id="successFeedback">✓ Copied to clipboard!</div>

      <script>
        ${getThemeScript()}
        let brandVoices = [];

        async function loadBrandVoices() {
          try {
            const response = await fetch('/repurpose/api/brand-voices');
            if (response.ok) {
              brandVoices = await response.json();
              const select = document.getElementById('brandVoice');
              brandVoices.forEach(voice => {
                const option = document.createElement('option');
                option.value = voice.id;
                option.textContent = voice.name;
                select.appendChild(option);
              });
            }
          } catch (error) {
            console.error('Error loading brand voices:', error);
          }
        }

        document.querySelectorAll('.platform-card').forEach(card => {
          card.addEventListener('click', function(e) {
            e.preventDefault();
            const input = this.querySelector('input');
            input.checked = !input.checked;
            this.classList.toggle('selected', input.checked);
          });
        });

        document.querySelectorAll('.tone-option').forEach(option => {
          option.addEventListener('click', function() {
            if (this.classList.contains('disabled')) return;
            document.querySelectorAll('.tone-option').forEach(opt => {
              opt.classList.remove('selected');
            });
            this.classList.add('selected');
            document.getElementById('toneValue').value = this.getAttribute('data-tone');
          });
        });

        function handleBrandVoiceChange() {
          const brandVoiceId = document.getElementById('brandVoice').value;
          const toneOptions = document.querySelectorAll('.tone-option');
          const hint = document.getElementById('toneDisabledHint');

          if (brandVoiceId) {
            // Brand voice selected — disable tone options
            toneOptions.forEach(opt => {
              opt.classList.add('disabled');
              opt.classList.remove('selected');
            });
            document.getElementById('toneValue').value = '';
            hint.classList.add('show');
          } else {
            // No brand voice — re-enable tone options
            toneOptions.forEach(opt => opt.classList.remove('disabled'));
            hint.classList.remove('show');
          }
        }

        // Source mode state — 'url' (default) | 'upload'. Toggled by
        // the Source pills above the input field. We pivot the
        // repurposeContent() submit path on this value.
        var _sourceMode = 'url';
        var _pendingFile = null;
        function setSourceMode(mode) {
          _sourceMode = mode === 'upload' ? 'upload' : 'url';
          document.getElementById('srcTabUrl').classList.toggle('active', _sourceMode === 'url');
          document.getElementById('srcTabUpload').classList.toggle('active', _sourceMode === 'upload');
          document.getElementById('srcTabUrl').setAttribute('aria-selected', _sourceMode === 'url' ? 'true' : 'false');
          document.getElementById('srcTabUpload').setAttribute('aria-selected', _sourceMode === 'upload' ? 'true' : 'false');
          // Mutually exclusive panels — hide the inactive one entirely.
          document.getElementById('srcPanelUrl').classList.toggle('hidden', _sourceMode !== 'url');
          document.getElementById('srcPanelUpload').classList.toggle('hidden', _sourceMode !== 'upload');
        }
        function handleRepurposeFile(input) {
          var f = input && input.files && input.files[0];
          if (!f) return;
          _pendingFile = f;
          var nameEl = document.getElementById('repFileName');
          if (nameEl) {
            nameEl.textContent = '✓ ' + f.name + ' (' + (f.size > 1024*1024 ? (f.size/1024/1024).toFixed(1) + ' MB' : Math.round(f.size/1024) + ' KB') + ')';
            nameEl.style.display = 'block';
          }
        }
        // Drag-and-drop on the upload zone.
        (function(){
          var z = document.getElementById('uploadZone');
          if (!z) return;
          ['dragenter','dragover'].forEach(function(ev){
            z.addEventListener(ev, function(e){ e.preventDefault(); e.stopPropagation(); z.classList.add('dragover'); });
          });
          ['dragleave','drop'].forEach(function(ev){
            z.addEventListener(ev, function(e){ e.preventDefault(); e.stopPropagation(); z.classList.remove('dragover'); });
          });
          z.addEventListener('drop', function(e){
            var dt = e.dataTransfer;
            if (dt && dt.files && dt.files[0]) {
              var input = document.getElementById('repFileInput');
              if (input) {
                input.files = dt.files;
                handleRepurposeFile(input);
              }
            }
          });
          z.addEventListener('click', function(e){
            if (e.target === z || e.target.closest('svg') || e.target.tagName === 'H3' || e.target.tagName === 'P') {
              document.getElementById('repFileInput').click();
            }
          });
          z.addEventListener('keydown', function(e){
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              document.getElementById('repFileInput').click();
            }
          });
        })();

        async function repurposeContent() {
          const url = document.getElementById('youtubeUrl').value.trim();
          const platforms = Array.from(document.querySelectorAll('input[name="platform"]:checked')).map(el => el.value);
          const tone = document.getElementById('toneValue').value || null;
          const brandVoiceId = document.getElementById('brandVoice').value;

          // Source-mode validation — bottom-right toast, same as AI Captions.
          if (_sourceMode === 'url' && !url) {
            showToast('Please enter a YouTube URL', 'error');
            return;
          }
          if (_sourceMode === 'upload' && !_pendingFile) {
            showToast('Please choose a file to upload', 'error');
            return;
          }
          if (platforms.length === 0) {
            showToast('Please select at least one platform', 'error');
            return;
          }
          if (!tone && !brandVoiceId) {
            showToast('Please select a tone or a brand voice', 'error');
            return;
          }

          try {
            showLoading();
            document.getElementById('resultsGrid').innerHTML = '';
            let resultCount = 0;
            let hadError = false;
            let response;
            if (_sourceMode === 'upload') {
              // Multipart POST so multer can pull the file out + we
              // forward platforms/tone/brandVoiceId alongside it.
              const fd = new FormData();
              fd.append('file', _pendingFile);
              fd.append('platforms', JSON.stringify(platforms));
              fd.append('tone', tone || '');
              if (brandVoiceId) fd.append('brandVoiceId', brandVoiceId);
              response = await fetch('/repurpose/process-upload', {
                method: 'POST',
                body: fd
              });
            } else {
              response = await fetch('/repurpose/process-stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  url,
                  platforms,
                  tone,
                  brandVoiceId: brandVoiceId || null
                })
              });
            }

            if (!response.ok) {
              const text = await response.text();
              throw new Error(text || 'Server error. Please try again.');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            const NL = String.fromCharCode(10);

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });

              const parts = buffer.split(NL);
              buffer = parts.pop();

              for (const line of parts) {
                const trimmed = line.trim();
                if (trimmed.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(trimmed.slice(6));
                    if (data.error) { showError(data.error); hadError = true; break; }
                    if (data.done) continue;
                    if (data.platform) {
                      document.getElementById('loadingState').classList.remove('show');
                      document.getElementById('resultsContent').style.display = 'block';
                      addResult(data);
                      resultCount++;
                    }
                  } catch(e) {}
                }
              }
            }

            if (resultCount === 0 && !hadError) {
              showError('No content was generated. Try a different video.');
            }
          } catch (error) {
            showError(error.message);
          }
        }

        function displayResults(outputs) {
          document.getElementById('loadingState').classList.remove('show');
          document.getElementById('resultsContent').style.display = 'block';

          const grid = document.getElementById('resultsGrid');
          grid.innerHTML = '';

          if (!outputs || outputs.length === 0) {
            grid.innerHTML = '<p style="color: var(--text-muted); padding: 2rem;">No content generated. Please try again.</p>';
            return;
          }

          outputs.forEach(output => {
            const content = output.generated_content || '';
            const platform = output.platform || 'Unknown';
            const contentId = output.content_id || output.id || '';
            const card = document.createElement('div');
            card.className = 'result-card';
            card.innerHTML = \`
              <div class="result-header">
                <div class="platform-name" data-platform="\${platform}">\${platform}</div>
                <div class="char-count">\${content.length} chars</div>
              </div>
              <div class="result-content">\${escapeHtml(content)}</div>
              <div class="result-actions">
                <button class="icon-btn copy-btn" data-content="\${btoa(unescape(encodeURIComponent(content)))}"><img src="/images/section-icons/A-84.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Copy</button>
                <button class="icon-btn" style="background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border-color:transparent" data-content-id="\${contentId}" data-output-id="\${output.id || ''}" data-platform="\${platform.toLowerCase()}" data-text-b64="\${btoa(unescape(encodeURIComponent(content)))}" onclick="openRpPublishModal(this)">✈️ Publish to…</button>
                <button class="icon-btn" onclick="regenerate('\${contentId}', '\${platform}')"><img src="/images/section-icons/A-83.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Regenerate</button>
              </div>
            \`;
            grid.appendChild(card);
          });

          // Attach copy handlers
          document.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', function() {
              const text = decodeURIComponent(escape(atob(this.dataset.content)));
              navigator.clipboard.writeText(text).then(() => {
                const feedback = document.getElementById('successFeedback');
                feedback.classList.add('show');
                setTimeout(() => feedback.classList.remove('show'), 2000);
              });
            });
          });
        }

        function addResult(output) {
          const grid = document.getElementById('resultsGrid');
          const content = output.generated_content || '';
          const platform = output.platform || 'Unknown';
          const contentId = output.id || '';
          const card = document.createElement('div');
          card.className = 'result-card';
          card.style.animation = 'fadeIn 0.3s ease';
          card.innerHTML = \`
            <div class="result-header">
              <div class="platform-name" data-platform="\${platform}">\${platform}</div>
              <div class="char-count">\${content.length} chars</div>
            </div>
            <div class="result-content">\${escapeHtml(content)}</div>
            <div class="result-actions">
              <button class="icon-btn copy-btn" data-content="\${btoa(unescape(encodeURIComponent(content)))}"><img src="/images/section-icons/A-84.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Copy</button>
              <button class="icon-btn" style="background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border-color:transparent" data-content-id="\${contentId}" data-output-id="\${output.id || ''}" data-platform="\${platform.toLowerCase()}" data-text-b64="\${btoa(unescape(encodeURIComponent(content)))}" onclick="openRpPublishModal(this)">✈️ Publish to…</button>
            </div>
          \`;
          grid.appendChild(card);
          // Attach copy handler to the new button
          card.querySelector('.copy-btn').addEventListener('click', function() {
            const text = decodeURIComponent(escape(atob(this.dataset.content)));
            navigator.clipboard.writeText(text).then(() => {
              const feedback = document.getElementById('successFeedback');
              feedback.classList.add('show');
              setTimeout(() => feedback.classList.remove('show'), 2000);
            });
          });
        }

        function copyToClipboard(text) {
          navigator.clipboard.writeText(text).then(() => {
            const feedback = document.getElementById('successFeedback');
            feedback.classList.add('show');
            setTimeout(() => feedback.classList.remove('show'), 2000);
          });
        }

        // ── Publish Generated Post modal ────────────────────────────
        // Mirrors the rpPublishModal used on /repurpose/history > Posts
        // so users can publish a Create result directly to their
        // connected text-capable accounts (Twitter/X, LinkedIn,
        // Facebook, Threads). Uses the same backend endpoint:
        // POST /repurpose/api/publish-output.
        function ensureRpPublishModal(){
          if (document.getElementById('rpPublishModal')) return;
          var div = document.createElement('div');
          div.id = 'rpPublishModal';
          div.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);z-index:99999;align-items:center;justify-content:center;padding:20px;';
          div.addEventListener('click', function(e){ if (e.target === div) closeRpPublishModal(); });
          div.innerHTML = '\
          <div style="background:#16112a;border:1px solid rgba(108,58,237,0.30);border-radius:16px;width:100%;max-width:520px;padding:24px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.5);color:#e2e0f0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif">\
            <h3 style="margin:0 0 4px;font-size:1.1rem;display:flex;align-items:center;gap:8px;">✈️ Publish Generated Post</h3>\
            <div id="rpPubSub" style="color:#8e87b0;font-size:0.82rem;margin-bottom:18px;">Pick a connected account.</div>\
            <label style="display:block;font-size:0.72rem;color:#8e87b0;margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Account</label>\
            <select id="rpPubAccount" onchange="rpOnAccountChange()" style="width:100%;background:#0f0a1f;border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:10px 12px;color:#e2e0f0;font-size:0.85rem;font-family:inherit;outline:none;margin-bottom:10px;"><option value="">Loading…</option></select>\
            <div id="rpPubNoAcct" style="display:none;background:rgba(255,180,0,0.08);border:1px solid rgba(255,180,0,0.35);color:#ffd591;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:0.8rem;line-height:1.4;">No connected accounts yet. <a href="/distribute/connections" target="_blank" style="background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;text-decoration:none;padding:0.4rem 0.9rem;border-radius:6px;font-weight:600;font-size:0.78rem;display:inline-block;margin-top:6px">Connect →</a></div>\
            <div id="rpWorkflowChip" style="display:none;margin-bottom:14px;border-radius:10px;padding:10px 12px;font-size:0.78rem;line-height:1.45;letter-spacing:0.01em;"><div id="rpWorkflowChipBody"></div></div>\
            <label style="display:block;font-size:0.72rem;color:#8e87b0;margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Post text</label>\
            <textarea id="rpPubText" rows="6" style="width:100%;background:#0f0a1f;border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:10px 12px;color:#e2e0f0;font-size:0.85rem;font-family:inherit;outline:none;margin-bottom:14px;resize:vertical;min-height:120px;"></textarea>\
            <div style="display:flex;gap:8px;margin-bottom:14px;background:#0f0a1f;border-radius:10px;padding:4px;border:1px solid rgba(255,255,255,0.06);">\
              <button id="rpPubTabNow" type="button" onclick="setRpPubMode(\\'now\\')" style="flex:1;background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;padding:8px 12px;border-radius:6px;font-weight:600;font-size:0.82rem;cursor:pointer;">Post now</button>\
              <button id="rpPubTabLater" type="button" onclick="setRpPubMode(\\'later\\')" style="flex:1;background:transparent;color:#8e87b0;border:none;padding:8px 12px;border-radius:6px;font-weight:600;font-size:0.82rem;cursor:pointer;">Schedule for later</button>\
            </div>\
            <div id="rpPubLater" style="display:none;margin-bottom:14px;"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;"><div><label style="display:block;font-size:0.72rem;color:#8e87b0;margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Date</label><input type="date" id="rpPubDate" style="width:100%;background:#0f0a1f;border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:10px 12px;color:#e2e0f0;font-size:0.85rem;outline:none;"></div><div><label style="display:block;font-size:0.72rem;color:#8e87b0;margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Time</label><input type="time" id="rpPubTime" value="12:00" style="width:100%;background:#0f0a1f;border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:10px 12px;color:#e2e0f0;font-size:0.85rem;outline:none;"></div></div></div>\
            <div id="rpPubStatus" style="display:none;background:rgba(108,58,237,0.10);border:1px solid rgba(108,58,237,0.30);color:#c4b5fd;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:0.8rem;line-height:1.4;"></div>\
            <div style="display:flex;justify-content:flex-end;gap:8px;"><button onclick="closeRpPublishModal()" style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:#e2e0f0;padding:0.5rem 1rem;border-radius:8px;font-weight:600;font-size:0.85rem;cursor:pointer;">Cancel</button><button id="rpPubSubmit" onclick="submitRpPublish()" style="background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;padding:0.5rem 1.2rem;border-radius:8px;font-weight:600;font-size:0.85rem;cursor:pointer;">Publish</button></div>\
          </div>';
          document.body.appendChild(div);
        }
        var _rpPubMode = 'now';
        var _rpPubCtx = { contentId: null, outputId: null, platform: null };
        // openRpPublishModal supports two call shapes:
        //   • btn with .output-card parent (the /history flow)
        //   • btn with data-platform + data-text-b64 attributes
        //     (Create-page result cards — no .output-card wrapper)
        async function openRpPublishModal(btn){
          var contentId = btn && btn.dataset ? btn.dataset.contentId : null;
          var outputId  = btn && btn.dataset && btn.dataset.outputId ? btn.dataset.outputId : null;
          ensureRpPublishModal();
          var platform = '';
          var text = '';
          var card = btn && btn.closest && btn.closest('.output-card');
          if (card) {
            platform = (card.dataset && card.dataset.platform || '').toLowerCase();
            text = (card.querySelector('.output-text') && card.querySelector('.output-text').textContent) || '';
          } else if (btn && btn.dataset && btn.dataset.platform) {
            platform = String(btn.dataset.platform).toLowerCase();
            if (btn.dataset.textB64) {
              try { text = decodeURIComponent(escape(atob(btn.dataset.textB64))); } catch (_) {}
            }
          }
          _rpPubCtx = { contentId: contentId, outputId: outputId, platform: platform };
          document.getElementById('rpPubText').value = text;
          document.getElementById('rpPubSub').textContent = platform ? ('Source platform: ' + platform) : 'Pick a connected account.';
          var d = new Date(); d.setMinutes(d.getMinutes() + 60);
          document.getElementById('rpPubDate').value = d.toISOString().slice(0, 10);
          document.getElementById('rpPubTime').value = String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
          document.getElementById('rpPubStatus').style.display = 'none';
          setRpPubMode('now');
          document.getElementById('rpPublishModal').style.display = 'flex';

          var sel = document.getElementById('rpPubAccount');
          var noAcct = document.getElementById('rpPubNoAcct');
          sel.innerHTML = '<option value="">Loading…</option>';
          try {
            var r = await fetch('/api/connections', { credentials: 'same-origin' });
            var j = await r.json();
            var accounts = (j && j.accounts) || [];
            // Show every connected account. publishToConnection in
            // utils/connections.js routes per platform — image/video-only
            // destinations will surface their own error if the text-only
            // post is rejected.
            accounts = accounts.filter(function(c){ return !!c && !!c.platform; });
            if (platform) {
              accounts.sort(function(a, b){
                if (a.platform === platform && b.platform !== platform) return -1;
                if (b.platform === platform && a.platform !== platform) return 1;
                return 0;
              });
            }
            if (accounts.length === 0) {
              sel.style.display = 'none';
              noAcct.style.display = 'block';
            } else {
              sel.style.display = '';
              noAcct.style.display = 'none';
              sel.innerHTML = accounts.map(function(c){
                return '<option value="' + c.id + '">' + (c.platform.charAt(0).toUpperCase()+c.platform.slice(1)) + ' — ' + (c.accountName || c.platformUsername || c.id) + '</option>';
              }).join('');
              // Refresh the workflow chip for the auto-selected first option.
              rpOnAccountChange();
            }
          } catch(e){
            sel.innerHTML = '<option value="">Failed to load accounts</option>';
          }
        }
        // ── Workflow status chip ─────────────────────────────────────
        // Same pattern as the Smart Shorts + Video Editor publish
        // modals. Reuses the /distribute/api/workflows-by-source/<id>
        // endpoint already shipped with those. Prefixed _rp to avoid
        // colliding with their identifiers if multiple modals share
        // the dashboard session.
        var _rpWfCache = {};
        function rpOnAccountChange() {
          var sel = document.getElementById('rpPubAccount');
          var chip = document.getElementById('rpWorkflowChip');
          var body = document.getElementById('rpWorkflowChipBody');
          if (!sel || !chip || !body) return;
          var connectionId = sel.value;
          if (!connectionId) { chip.style.display = 'none'; return; }
          if (_rpWfCache[connectionId]) { _rpRenderWfChip(_rpWfCache[connectionId]); return; }
          _rpSetWfChipTone('neutral');
          body.innerHTML = '<div style="display:flex;align-items:center;gap:8px;color:#8e87b0;"><div style="width:10px;height:10px;border:2px solid rgba(255,255,255,0.18);border-top-color:#a78bfa;border-radius:50%;animation:spin 0.7s linear infinite;"></div><span>Checking workflows for this account...</span></div>';
          chip.style.display = 'block';
          fetch('/distribute/api/workflows-by-source/' + encodeURIComponent(connectionId), { credentials: 'same-origin' })
            .then(function(r){ return r.ok ? r.json() : { workflows: [] }; })
            .then(function(data){ var wfs = (data && data.workflows) || []; _rpWfCache[connectionId] = wfs; _rpRenderWfChip(wfs); })
            .catch(function(){ _rpWfCache[connectionId] = []; _rpRenderWfChip([]); });
        }
        function _rpSetWfChipTone(tone) {
          var chip = document.getElementById('rpWorkflowChip');
          if (!chip) return;
          if (tone === 'active') { chip.style.background = 'rgba(0,184,148,0.10)'; chip.style.border = '1px solid rgba(0,184,148,0.35)'; chip.style.color = '#a3e8c8'; }
          else if (tone === 'none') { chip.style.background = 'rgba(108,58,237,0.10)'; chip.style.border = '1px solid rgba(108,58,237,0.30)'; chip.style.color = '#d8c9ff'; }
          else { chip.style.background = 'rgba(255,255,255,0.04)'; chip.style.border = '1px solid rgba(255,255,255,0.08)'; chip.style.color = '#8e87b0'; }
        }
        function _rpFmtDelay(w) {
          if (w.delayMode === 'immediate' || !w.delayHours) return 'immediately after this post';
          var h = w.delayHours;
          if (h < 1) return 'shortly after this post';
          if (h === 1) return '1 hour after this post';
          if (h < 24) return h + ' hours after this post';
          var days = Math.round(h / 24);
          return days === 1 ? '1 day after this post' : days + ' days after this post';
        }
        function _rpCapPlatform(p) {
          if (!p) return 'another platform';
          var map = { youtube:'YouTube', tiktok:'TikTok', instagram:'Instagram', facebook:'Facebook', twitter:'X (Twitter)', linkedin:'LinkedIn', pinterest:'Pinterest', threads:'Threads', bluesky:'Bluesky', snapchat:'Snapchat' };
          return map[p] || (p.charAt(0).toUpperCase() + p.slice(1));
        }
        function _rpEscAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
        function _rpRenderWfChip(workflows) {
          var body = document.getElementById('rpWorkflowChipBody');
          if (!body) return;
          if (workflows && workflows.length) {
            _rpSetWfChipTone('active');
            var lines = workflows.map(function(w) {
              var dest = _rpCapPlatform(w.destinationPlatform);
              var user = w.destinationUsername ? ('@' + w.destinationUsername) : '';
              var when = _rpFmtDelay(w);
              var name = w.name ? (' - <em style="font-style:normal;color:#fff;font-weight:600;">' + _rpEscAttr(w.name) + '</em>') : '';
              return '<div style="display:flex;align-items:flex-start;gap:8px;margin-top:6px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;margin-top:2px;"><polyline points="20 6 9 17 4 12"></polyline></svg><span>Will also publish to <strong style="color:#fff;">' + dest + (user ? ' (' + _rpEscAttr(user) + ')' : '') + '</strong> ' + when + name + '.</span></div>';
            }).join('');
            body.innerHTML = '<div style="display:flex;align-items:center;gap:8px;font-weight:700;color:#9be3b9;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg><span>Active workflow triggered by this account</span></div>' + lines;
          } else {
            _rpSetWfChipTone('none');
            body.innerHTML = '<div style="display:flex;align-items:flex-start;gap:8px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;margin-top:2px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg><div><div style="font-weight:600;color:#d8c9ff;margin-bottom:2px;">No workflow set for this account yet.</div><div style="color:#8e87b0;">Want this post auto-republished elsewhere? <a href="/distribute" target="_blank" rel="noopener" style="color:#c4b5fd;text-decoration:underline;font-weight:600;">Set up a workflow</a> on the Repurpose page - then every future publish here will fire it.</div></div></div>';
          }
        }
        function closeRpPublishModal(){ var m = document.getElementById('rpPublishModal'); if (m) m.style.display = 'none'; }
        function setRpPubMode(mode){
          _rpPubMode = mode;
          var nowBtn = document.getElementById('rpPubTabNow');
          var laterBtn = document.getElementById('rpPubTabLater');
          var laterFields = document.getElementById('rpPubLater');
          var submitBtn = document.getElementById('rpPubSubmit');
          if (mode === 'now') {
            nowBtn.style.background = 'linear-gradient(135deg,#6C3AED,#EC4899)'; nowBtn.style.color = '#fff';
            laterBtn.style.background = 'transparent'; laterBtn.style.color = '#8e87b0';
            laterFields.style.display = 'none';
            submitBtn.textContent = 'Publish now';
          } else {
            laterBtn.style.background = 'linear-gradient(135deg,#6C3AED,#EC4899)'; laterBtn.style.color = '#fff';
            nowBtn.style.background = 'transparent'; nowBtn.style.color = '#8e87b0';
            laterFields.style.display = 'block';
            submitBtn.textContent = 'Schedule';
          }
        }
        async function submitRpPublish(){
          var btn = document.getElementById('rpPubSubmit');
          var statusEl = document.getElementById('rpPubStatus');
          var connectionId = document.getElementById('rpPubAccount').value;
          if (!connectionId) { statusEl.style.display = 'block'; statusEl.textContent = 'Pick an account first.'; return; }
          var text = document.getElementById('rpPubText').value.trim();
          if (!text) { statusEl.style.display = 'block'; statusEl.textContent = 'Post body is empty.'; return; }
          var payload = {
            contentId: _rpPubCtx.contentId,
            outputId: _rpPubCtx.outputId,
            connectionId: connectionId,
            text: text
          };
          if (_rpPubMode === 'later') {
            var d = document.getElementById('rpPubDate').value;
            var t = document.getElementById('rpPubTime').value || '12:00';
            if (!d) { statusEl.style.display = 'block'; statusEl.textContent = 'Pick a date and time.'; return; }
            payload.scheduledAt = d + 'T' + t + ':00';
          }
          btn.disabled = true; var orig = btn.textContent;
          btn.textContent = _rpPubMode === 'now' ? 'Publishing…' : 'Scheduling…';
          statusEl.style.display = 'block';
          statusEl.textContent = _rpPubMode === 'now' ? 'Posting…' : 'Saving the scheduled post…';
          try {
            var resp = await fetch('/repurpose/api/publish-output', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            var data = await resp.json();
            if (!resp.ok || !data.success) throw new Error(data.error || 'Failed');
            statusEl.textContent = _rpPubMode === 'now'
              ? ('Posted to ' + (data.platform || 'platform'))
              : ('Scheduled for ' + (data.scheduledFor || payload.scheduledAt));
            setTimeout(closeRpPublishModal, 1500);
          } catch(e){
            statusEl.textContent = 'Error: ' + e.message;
          } finally {
            btn.disabled = false; btn.textContent = orig;
          }
        }

        function showLoading() {
          document.getElementById('resultsContainer').classList.add('show');
          document.getElementById('loadingState').classList.add('show');
          document.getElementById('resultsContainer').scrollIntoView({behavior: 'smooth', block: 'start'});
          document.getElementById('resultsContent').style.display = 'none';
          document.getElementById('errorMessage').classList.remove('show');
        }

        function showError(message) {
          document.getElementById('loadingState').classList.remove('show');
          const errorEl = document.getElementById('errorMessage');
          errorEl.textContent = message;
          errorEl.classList.add('show');
        }
        // Floating toast — same pattern AI Captions uses. Auto-dismisses
        // after 3s so it never lingers, and replaces any earlier toast
        // mid-flight so consecutive clicks don't queue up.
        var _createToastTimer = null;
        function showToast(message, type) {
          var t = document.getElementById('createToast');
          if (!t) return;
          t.textContent = message;
          t.className = 'toast show ' + (type || 'success');
          if (_createToastTimer) clearTimeout(_createToastTimer);
          _createToastTimer = setTimeout(function(){ t.classList.remove('show'); }, 3000);
        }

        function resetForm() {
          document.getElementById('youtubeUrl').value = '';
          document.querySelectorAll('input[name="platform"]').forEach(el => {
            el.checked = false;
            el.parentElement.classList.remove('selected');
          });
          document.querySelectorAll('.tone-option').forEach(el => {
            el.classList.remove('selected');
            el.classList.remove('disabled');
          });
          document.getElementById('toneValue').value = '';
          document.getElementById('brandVoice').value = '';
          document.getElementById('toneDisabledHint').classList.remove('show');
          document.getElementById('resultsContainer').classList.remove('show');
          document.getElementById('resultsContent').style.display = 'none';
        }

        function escapeHtml(text) {
          const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
          };
          return text.replace(/[&<>"']/g, m => map[m]);
        }

        loadBrandVoices();

        // Pre-fill URL from query parameter (when redirected from dashboard)
        const params = new URLSearchParams(window.location.search);
        if (params.get('url')) {
          document.getElementById('youtubeUrl').value = params.get('url');
        }
      </script>
    </body>
    </html>
  `);
});

// POST - Stream content generation (Server-Sent Events)
// Process uploaded file: extract audio → transcribe → generate content (SSE stream)
router.post('/process-upload', requireAuth, checkPlanLimit('creationsPerMonth'), upload.single('file'), async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let filePath = null;
  let audioPath = null;

  try {
    if (!req.file) {
      res.write('data: ' + JSON.stringify({ error: 'No file uploaded' }) + '\n\n');
      return res.end();
    }

    filePath = req.file.path;
    const fileName = req.file.originalname || 'Uploaded Video';
    // Accept the same fields the URL flow does, with the same defaults.
    // Form-encoded by multer alongside the file part. JSON-string for
    // platforms (front-end sends JSON.stringify([...])); fall back to
    // comma-separated for resilience.
    let platforms = ['Instagram','TikTok','Twitter','LinkedIn','Facebook','YouTube','Blog'];
    if (req.body && req.body.platforms) {
      try {
        const p = typeof req.body.platforms === 'string'
          ? JSON.parse(req.body.platforms)
          : req.body.platforms;
        if (Array.isArray(p) && p.length) platforms = p;
      } catch (_) {
        const parts = String(req.body.platforms).split(',').map(s => s.trim()).filter(Boolean);
        if (parts.length) platforms = parts;
      }
    }
    const tone = (req.body && req.body.tone) || 'Professional';
    const brandVoiceId = (req.body && req.body.brandVoiceId) || null;
    const brandVoice = brandVoiceId ? await brandVoiceOps.getById(brandVoiceId).catch(() => null) : null;
    const userId = req.user.id;

    const totalStart = Date.now();

    // Step 1: Extract audio
    res.write('data: ' + JSON.stringify({ status: 'Extracting audio...' }) + '\n\n');
    try {
      audioPath = await extractAudioForRepurpose(filePath);
    } catch (err) {
      // If audio extraction fails, try transcribing the file directly (might be audio-only)
      audioPath = filePath;
    }

    // Step 2: Transcribe with Whisper
    res.write('data: ' + JSON.stringify({ status: 'Transcribing with AI...' }) + '\n\n');
    let transcript;
    try {
      transcript = await transcribeUploadedFile(audioPath);
    } catch (err) {
      console.error('Whisper transcription failed:', err.message);
      res.write('data: ' + JSON.stringify({ error: 'Transcription failed: ' + err.message }) + '\n\n');
      return res.end();
    }

    if (!transcript || transcript.trim().length === 0) {
      res.write('data: ' + JSON.stringify({ error: 'Could not extract any speech from the file.' }) + '\n\n');
      return res.end();
    }

    // Cap transcript to ~8000 words
    const words = transcript.split(/\s+/);
    if (words.length > 8000) {
      transcript = words.slice(0, 8000).join(' ');
    }

    console.log('[Upload] Transcribed', words.length, 'words in', Date.now() - totalStart, 'ms');

    // Step 3: Save to DB
    const content = await contentOps.create(userId, fileName, transcript, 'upload', fileName);

    // Step 4: Generate content for each platform (stream results)
    res.write('data: ' + JSON.stringify({ status: 'Generating content...' }) + '\n\n');
    const promises = platforms.map(async (platform) => {
      try {
        const generatedContent = await Promise.race([
          generatePlatformContent(transcript, platform, tone, brandVoice),
          new Promise((_, reject) => setTimeout(() => reject(new Error('AI generation timed out for ' + platform)), 60000))
        ]);
        const output = await outputOps.create(content.id, userId, 'generated', generatedContent, platform, tone);
        res.write('data: ' + JSON.stringify({ platform: output.platform, generated_content: output.generated_content, id: output.id }) + '\n\n');
      } catch (err) {
        console.error('Error generating ' + platform + ':', err.message);
        res.write('data: ' + JSON.stringify({ platform: platform, error: err.message }) + '\n\n');
      }
    });

    await Promise.allSettled(promises);
    console.log('[Upload] Total process-upload:', Date.now() - totalStart, 'ms');
    res.write('data: ' + JSON.stringify({ done: true }) + '\n\n');
    res.end();
  } catch (error) {
    console.error('Upload stream error:', error);
    res.write('data: ' + JSON.stringify({ error: error.message || 'Processing failed' }) + '\n\n');
    res.end();
  } finally {
    // Clean up temp files
    try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
    try { if (audioPath && audioPath !== filePath && fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch (e) {}
  }
});

router.post('/process-stream', requireAuth, checkPlanLimit('creationsPerMonth'), async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const { url, brandVoiceId } = req.body;
    const platforms = req.body.platforms || ['Instagram','TikTok','Twitter','LinkedIn','Facebook','YouTube','Blog'];
    const tone = req.body.tone || 'Professional';
    const userId = req.user.id;

    const youtubeRegex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/;
    if (!youtubeRegex.test(url)) {
      res.write('data: ' + JSON.stringify({ error: 'Invalid YouTube URL' }) + '\n\n');
      return res.end();
    }

    const videoId = url.match(youtubeRegex)[1];
    const totalStart = Date.now();

    // Fetch title and transcript IN PARALLEL to save 2-4 seconds
    const titlePromise = Promise.race([fetchVideoTitle(videoId), new Promise((_, reject) => setTimeout(() => reject(new Error("Title fetch timed out")), 15000))]).catch(() => 'Untitled Video');
    const transcriptPromise = Promise.race([fetchVideoTranscript(videoId), new Promise((_, reject) => setTimeout(() => reject(new Error("Transcript fetch timed out after 30 seconds")), 30000))]);

    let transcript;
    let videoTitle;
    try {
      const fetchStart = Date.now();
      const [titleResult, transcriptResult] = await Promise.all([titlePromise, transcriptPromise]);
      videoTitle = titleResult;
      transcript = transcriptResult;
      console.log('[Timing] Parallel title+transcript fetch:', Date.now() - fetchStart, 'ms');
      if (!transcript || transcript.trim().length === 0) {
        res.write('data: ' + JSON.stringify({ error: 'Video transcript is empty.' }) + '\n\n');
        return res.end();
      }
      // Cap transcript to ~8000 words to speed up OpenAI generation
      const words = transcript.split(/\s+/);
      if (words.length > 8000) {
        transcript = words.slice(0, 8000).join(' ');
        console.log('[Timing] Transcript truncated from', words.length, 'to 8000 words');
      }
    } catch (error) {
        console.error('All transcript methods failed for', videoId, ':', error.message);
      res.write('data: ' + JSON.stringify({ error: 'Could not fetch transcript. Make sure the video has captions enabled.' }) + '\n\n');
      return res.end();
    }

    // DB write and brand voice fetch IN PARALLEL
    const dbStart = Date.now();
    const [content, brandVoice] = await Promise.all([
      contentOps.create(userId, videoTitle, transcript, 'youtube', url),
      brandVoiceId ? brandVoiceOps.getById(brandVoiceId) : Promise.resolve(null)
    ]);
    console.log('[Timing] DB + brand voice:', Date.now() - dbStart, 'ms');

    // Send each platform as it completes
    const promises = platforms.map(async (platform) => {
      try {
        const genStart = Date.now();
        const generatedContent = await Promise.race([generatePlatformContent(transcript, platform, tone, brandVoice), new Promise((_, reject) => setTimeout(() => reject(new Error('AI generation timed out for ' + platform)), 60000))]);
        console.log('[Timing] OpenAI generation for', platform, ':', Date.now() - genStart, 'ms');
        const output = await outputOps.create(content.id, userId, 'generated', generatedContent, platform, tone);
        res.write('data: ' + JSON.stringify({ platform: output.platform, generated_content: output.generated_content, id: output.id }) + '\n\n');
      } catch (err) {
        console.error('Error generating ' + platform + ':', err.message);
        res.write('data: ' + JSON.stringify({ platform: platform, error: err.message }) + '\n\n');
      }
    });

    await Promise.allSettled(promises);
    console.log('[Timing] Total process-stream:', Date.now() - totalStart, 'ms');
    res.write('data: ' + JSON.stringify({ done: true }) + '\n\n');
    res.end();
  } catch (error) {
    console.error('Stream error:', error);
    res.write('data: ' + JSON.stringify({ error: error.message || 'Processing failed' }) + '\n\n');
    res.end();
  }
});

// POST - Process and generate content
router.post('/process', requireAuth, checkPlanLimit('creationsPerMonth'), async (req, res) => {
  try {
    const { url, brandVoiceId } = req.body;
    const platforms = req.body.platforms || ['Instagram','TikTok','Twitter','LinkedIn','Facebook','YouTube','Blog'];
    const tone = req.body.tone || 'Professional';
    const userId = req.user.id;

    // Validate YouTube URL
    const youtubeRegex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/;
    if (!youtubeRegex.test(url)) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    // Get title and transcript IN PARALLEL
    const videoId = url.match(youtubeRegex)[1];
    const titlePromise = fetchVideoTitle(videoId).catch(() => 'Untitled Video');
    const transcriptPromise = fetchVideoTranscript(videoId);

    let videoTitle, transcript;
    try {
      [videoTitle, transcript] = await Promise.all([titlePromise, transcriptPromise]);
      if (!transcript || transcript.trim().length === 0) {
        return res.status(400).json({ error: 'Video transcript is empty. Please try a video with spoken content and captions enabled.' });
      }
    } catch (error) {
      console.error('Transcript fetch error for video', videoId, ':', error.message);
      return res.status(400).json({ error: 'Could not fetch video transcript. Make sure the video has captions/subtitles enabled. YouTube Shorts may not have auto-generated captions — try a regular YouTube video instead.' });
    }

    // Create content item + fetch brand voice IN PARALLEL
    const [content, brandVoice] = await Promise.all([
      contentOps.create(userId, videoTitle, transcript, 'youtube', url),
      brandVoiceId ? brandVoiceOps.getById(brandVoiceId) : Promise.resolve(null)
    ]);

    // Generate content for all platforms in parallel
    const results = await Promise.allSettled(
      platforms.map(async (platform) => {
        const generatedContent = await generatePlatformContent(
          transcript,
          platform,
          tone,
          brandVoice
        );
        const output = await outputOps.create(
          content.id,
          userId,
          'generated',
          generatedContent,
          platform,
          tone
        );
        return output;
      })
    );

    const outputs = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        outputs.push(result.value);
      } else {
        console.error(`Error generating content for ${platforms[i]}:`, result.reason);
      }
    });

    if (outputs.length === 0) {
      return res.status(500).json({ error: 'AI content generation failed for all platforms. Please try again.' });
    }

    res.json({ success: true, outputs });
  } catch (error) {
    console.error('Repurpose error:', error);
    res.status(500).json({ error: error.message || 'Failed to process request. Please try again.' });
  }
});

// Generate content for specific platform
async function generatePlatformContent(transcript, platform, tone, brandVoice) {
  const platformPrompts = {
    'Instagram': `Create an engaging Instagram caption (150-300 words) based on this transcript. Include 8-10 relevant hashtags at the end. Make it engaging and visually descriptive. Suitable for an accompanying image or carousel post. Use emojis naturally.`,
    'TikTok': `Create a short, punchy TikTok video caption (under 300 characters) based on this transcript. Make it trendy and attention-grabbing. Include 5-7 relevant hashtags. Use Gen-Z friendly language where appropriate.`,
    'Twitter': `Create a viral Twitter/X thread (3-5 tweets) based on this transcript. Keep each tweet under 280 characters. Focus on the most engaging and shareable points. Format as numbered tweets.`,
    'LinkedIn': `Write a professional LinkedIn post (200-300 words) based on this transcript. Include relevant industry insights and a call-to-action. Professional tone emphasizing business value.`,
    'Facebook': `Write a Facebook post (150-300 words) that's engaging and encourages discussion. Include a call-to-action and ask a question to boost engagement.`,
    'YouTube': `Create a YouTube video description (200-400 words) based on this transcript. Include: an attention-grabbing first line, timestamps/chapters section, key takeaways, relevant tags, and a call-to-action to like/subscribe. Also suggest a compelling video title (under 70 characters) at the top.`,
    'Threads': `Create a Threads post (under 500 characters) based on this transcript. Make it conversational, authentic, and engaging. Threads is a text-first platform — keep it punchy and relatable. Include 3-5 relevant hashtags at the end.`,
    'Pinterest': `Create a Pinterest pin description (150-300 characters) based on this transcript. Make it keyword-rich for search discovery. Include a compelling call-to-action. Add 5-8 relevant hashtags. Also suggest a pin title (under 100 characters) at the top.`,
    'Blog': `Write a complete blog article (800-1200 words) based on this transcript. Include: H2 headings for each section, 3-4 main sections, introduction and conclusion, and actionable insights.`
  };

  let prompt = platformPrompts[platform] || 'Create content based on this transcript';

  if (brandVoice) {
    prompt += `\n\nBrand Voice Guidelines:\n- Tone: ${brandVoice.tone}\n- Description: ${brandVoice.description}\n- Example: "${brandVoice.example_content}"\nMaintain consistency with these guidelines.`;
  }

  prompt += `\n\nTone of voice: ${tone}\n\nTranscript:\n${transcript}`;

  try {
    const response = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    return response.choices[0].message.content;
  } catch (aiError) {
    console.error('OpenAI API error:', aiError.message, aiError.status || '');
    if (aiError.message?.includes('API key') || aiError.status === 401) {
      throw new Error('AI service configuration error. Please contact support.');
    }
    if (aiError.code === 'ETIMEDOUT' || aiError.code === 'ECONNABORTED') {
      throw new Error('AI generation timed out. Please try again with a shorter video.');
    }
    throw new Error('AI content generation failed. Please try again.');
  }
}

// POST - Regenerate single platform
router.post('/regenerate', requireAuth, async (req, res) => {
  try {
    const { contentId, platform, tone, brandVoiceId } = req.body;
    const userId = req.user.id;

    const content = await contentOps.getById(contentId);
    if (!content || content.user_id !== userId) {
      return res.status(404).json({ error: 'Content not found' });
    }

    let brandVoice = null;
    if (brandVoiceId) {
      brandVoice = await brandVoiceOps.getById(brandVoiceId);
    }

    const generatedContent = await generatePlatformContent(
      content.original_content,
      platform,
      tone,
      brandVoice
    );

    const existingOutputs = await outputOps.getByContentId(contentId);
    const existingOutput = existingOutputs.find(o => o.platform === platform);

    let output;
    if (existingOutput) {
      output = await outputOps.updateById(existingOutput.id, generatedContent);
    } else {
      output = await outputOps.create(
        contentId,
        userId,
        'generated',
        generatedContent,
        platform,
        tone
      );
    }

    res.json({ success: true, output });
  } catch (error) {
    console.error('Regenerate error:', error);
    res.status(500).json({ error: 'Failed to regenerate content' });
  }
});

// GET - Content history/library
router.get('/history', requireAuth, (req, res) => {
  res.send(`
    ${getHeadHTML('Library')}
      <style>
        ${getBaseCSS()}

        .main-content {
          margin-left: 250px;
          flex: 1;
          padding: 40px;
        }

        .header {
          margin-bottom: 40px;
        }

        .header h1 {
          font-size: 32px;
          margin-bottom: 10px;
          background: var(--gradient-1);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .controls {
          display: flex;
          gap: 20px;
          margin-bottom: 30px;
          flex-wrap: wrap;
        }

        .search-input {
          flex: 1;
          min-width: 200px;
          padding: 12px 16px;
          background: #161616;
          border: 1px solid rgba(108,58,237,0.15);
          border-radius: 12px;
          color: #e0e0e0;
          font-size: 14px;
          transition: all 0.3s;
        }

        .search-input:focus {
          outline: none;
          border-color: #6C3AED;
          box-shadow: 0 0 0 3px rgba(108,58,237,0.1);
        }

        body.light .search-input {
          background: #fff;
          border: 1px solid rgba(108,58,237,0.12);
          color: #1a1a1a;
          box-shadow: 0 2px 8px rgba(108,58,237,0.04);
        }

        .search-input::placeholder {
          color: #718096;
        }

        /* ── Library tabs ─────────────────────────────────────── */
        .lib-tabs {
          display: flex;
          gap: 4px;
          flex-wrap: wrap;
          margin: 0 0 1.5rem;
          padding: 4px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
        }
        body.light .lib-tabs { background: rgba(108,58,237,0.04); border-color: rgba(108,58,237,0.10); }
        .lib-tab {
          flex: 1 1 auto;
          min-width: 0;
          padding: 9px 14px;
          border-radius: 8px;
          border: none;
          background: transparent;
          color: var(--text-muted);
          font-weight: 600;
          font-size: 0.85rem;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.15s ease, color 0.15s ease;
        }
        .lib-tab:hover { background: rgba(255,255,255,0.05); color: var(--text); }
        .lib-tab.active { background: linear-gradient(135deg, #6C3AED, #EC4899); color: #fff; }
        .lib-pane { display: none; }
        .lib-pane.active { display: block; }
        /* Per-tab render grid */
        .lib-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 16px;
          margin-bottom: 1.5rem;
        }
        .lib-card {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          transition: transform 0.15s ease, border-color 0.15s ease;
        }
        body.light .lib-card { background: #fff; border-color: rgba(108,58,237,0.10); }
        .lib-card:hover { transform: translateY(-2px); border-color: rgba(108,58,237,0.40); }
        .lib-card-thumb {
          aspect-ratio: 16 / 9;
          background: linear-gradient(135deg, rgba(108,58,237,0.18), rgba(236,72,153,0.14));
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          font-size: 28px;
          overflow: hidden;
        }
        .lib-card-thumb video, .lib-card-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .lib-card-thumb.image { aspect-ratio: 16 / 9; background: #0a0a0a; }
        .lib-card-body { padding: 11px 14px; flex: 1; display: flex; flex-direction: column; gap: 4px; }
        .lib-card-title {
          font-weight: 700;
          font-size: 13.5px;
          color: var(--text);
          line-height: 1.35;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .lib-card-meta { font-size: 11px; color: var(--text-muted); display: flex; gap: 8px; flex-wrap: wrap; }
        .lib-card-actions {
          display: flex;
          gap: 4px;
          padding: 9px 12px 12px;
          flex-wrap: wrap;
          border-top: 1px solid rgba(255,255,255,0.04);
        }
        body.light .lib-card-actions { border-top-color: rgba(0,0,0,0.05); }
        .lib-card-actions a, .lib-card-actions button {
          flex: 1 1 calc(50% - 4px);
          min-width: 0;
          padding: 6px 8px;
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.04);
          color: var(--text);
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          text-align: center;
          text-decoration: none;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .lib-card-actions a.primary, .lib-card-actions button.primary {
          background: linear-gradient(135deg, #6C3AED, #EC4899);
          color: #fff;
          border-color: transparent;
        }
        .lib-card-actions button.danger {
          background: rgba(239, 68, 68, 0.10);
          color: #fca5a5;
          border-color: rgba(239, 68, 68, 0.25);
        }
        .lib-card-actions button.danger:hover { background: #EF4444; color: #fff; }
        .lib-empty {
          grid-column: 1 / -1;
          text-align: center;
          padding: 56px 20px;
          color: var(--text-muted);
          border: 1px dashed rgba(255,255,255,0.10);
          border-radius: 14px;
          line-height: 1.55;
        }
        .lib-empty strong { color: var(--text); font-weight: 700; display: block; margin-bottom: 6px; font-size: 1rem; }
        .lib-storage {
          font-size: 12px;
          color: var(--text-muted);
          margin: 0 0 1rem;
        }
        .lib-storage strong { color: #e056fd; font-weight: 700; font-size: 13px; }
        .toast { position: fixed; bottom: 20px; right: 20px; padding: 10px 16px; background: rgba(0,0,0,0.85); color: #fff; border-radius: 8px; font-size: 13px; z-index: 9999; display: none; }
        .toast.show { display: block; }

        .content-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 20px;
          margin-bottom: 40px;
        }

        .content-card {
          background: #161616;
          border: 1px solid rgba(108,58,237,0.12);
          border-radius: 16px;
          padding: 24px;
          cursor: pointer;
          transition: all 0.3s;
          position: relative;
          overflow: hidden;
        }

        .content-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(90deg, #6C3AED, #EC4899);
          opacity: 0;
          transition: opacity 0.3s;
        }

        .content-card:hover::before {
          opacity: 1;
        }

        body.light .content-card {
          background: #fff;
          border: 1px solid rgba(108,58,237,0.1);
          box-shadow: 0 2px 12px rgba(108,58,237,0.04);
        }

        .content-card:hover {
          border-color: rgba(108,58,237,0.3);
          transform: translateY(-4px);
          box-shadow: 0 8px 24px rgba(108,58,237,0.12);
        }

        .card-title {
          font-weight: 700;
          margin-bottom: 10px;
          color: #e0e0e0;
        }

        body.light .card-title {
          color: #1a1a1a;
        }

        .card-date {
          font-size: 12px;
          color: #718096;
          margin-bottom: 12px;
        }

        .card-platforms {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 12px;
        }

        .platform-badge {
          display: inline-block;
          padding: 4px 10px;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 600;
          color: #fff;
          background: linear-gradient(135deg, #6C3AED, #EC4899);
        }

        .platform-badge[data-platform="Instagram"] { background: linear-gradient(135deg, #833AB4, #E1306C); }
        .platform-badge[data-platform="TikTok"] { background: linear-gradient(135deg, #010101, #25F4EE); }
        .platform-badge[data-platform="Twitter"] { background: linear-gradient(135deg, #14171A, #1DA1F2); }
        .platform-badge[data-platform="LinkedIn"] { background: linear-gradient(135deg, #0A66C2, #004182); }
        .platform-badge[data-platform="Facebook"] { background: linear-gradient(135deg, #1877F2, #42a5f5); }
        .platform-badge[data-platform="YouTube"] { background: linear-gradient(135deg, #FF0000, #CC0000); }
        .platform-badge[data-platform="Threads"] { background: linear-gradient(135deg, #333333, #555555); }
        .platform-badge[data-platform="Pinterest"] { background: linear-gradient(135deg, #E60023, #AD081B); }
        .platform-badge[data-platform="Blog"] { background: linear-gradient(135deg, #6C3AED, #EC4899); }

        body.light .platform-badge {
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .card-preview {
          color: #a0aec0;
          font-size: 13px;
          line-height: 1.5;
          max-height: 60px;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        body.light .card-preview {
          color: #4a5568;
        }

        .empty-state {
          text-align: center;
          padding: 60px 20px;
          color: #888;
        }

        .empty-state h2 {
          font-size: 24px;
          margin-bottom: 10px;
        }

        .pagination {
          display: flex;
          justify-content: center;
          gap: 10px;
          margin-top: 40px;
        }

        .pagination button {
          padding: 10px 15px;
          border: 1px solid #333;
          background: #161616;
          color: #e0e0e0;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.3s;
        }

        body.light .pagination button {
          border: 1px solid #ddd;
          background: #fff;
          color: #1a1a1a;
        }

        .pagination button:hover:not(:disabled) {
          border-color: #6c5ce7;
          color: #6c5ce7;
        }

        .pagination button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .modal-overlay {
          display: none;
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.7);
          z-index: 1000;
          justify-content: center;
          align-items: flex-start;
          padding: 40px 20px;
          overflow-y: auto;
        }

        .modal-overlay.show {
          display: flex;
        }

        .modal-content {
          background: #161616;
          border: 1px solid #333;
          border-radius: 16px;
          max-width: 900px;
          width: 100%;
          padding: 30px;
          position: relative;
        }

        body.light .modal-content {
          background: #fff;
          border-color: #e0e0e0;
        }

        .modal-close {
          position: absolute;
          top: 15px;
          right: 20px;
          background: none;
          border: none;
          color: #888;
          font-size: 24px;
          cursor: pointer;
        }

        .modal-close:hover {
          color: #fff;
        }

        body.light .modal-close:hover {
          color: #333;
        }

        .modal-title {
          font-size: 22px;
          font-weight: 700;
          margin-bottom: 5px;
        }

        .modal-date {
          font-size: 13px;
          color: #888;
          margin-bottom: 20px;
        }

        .output-card {
          background: #0a0a0a;
          border: 1px solid #222;
          border-radius: 10px;
          padding: 20px;
          margin-bottom: 15px;
        }

        body.light .output-card {
          background: #f8f8f8;
          border-color: #e0e0e0;
        }

        .output-platform {
          color: #6c5ce7;
          font-weight: 600;
          font-size: 15px;
          margin-bottom: 10px;
        }

        .output-text {
          color: #ccc;
          font-size: 14px;
          line-height: 1.7;
          white-space: pre-wrap;
          word-wrap: break-word;
        }

        body.light .output-text {
          color: #444;
        }

        .output-actions {
          display: flex;
          gap: 10px;
          margin-top: 12px;
        }

        .output-actions button {
          padding: 6px 14px;
          border-radius: 6px;
          border: 1px solid #333;
          background: #161616;
          color: #ccc;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s;
        }

        body.light .output-actions button {
          background: #fff;
          border-color: #ddd;
          color: #555;
        }

        .output-actions button:hover {
          border-color: #6c5ce7;
          color: #6c5ce7;
        }

        .modal-loading {
          text-align: center;
          padding: 40px;
          color: #888;
        }

        @media (max-width: 768px) {
          .sidebar {
            width: 100%;
            height: auto;
            position: relative;
            border-right: none;
            border-bottom: 1px solid #222;
          }

          .main-content {
            margin-left: 0;
          }

          .theme-toggle {
            position: static;
            margin-top: 20px;
          }

          .content-grid {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </head>
    <body>
      <div class="container">
        ${getSidebar('library', req.user, req.teamPermissions)}

        <div class="main-content">
          ${getThemeToggle()}
          <div class="header">
            <h1><img src="/images/section-icons/A-13.png" alt="" style="height:36px;width:36px;vertical-align:middle;margin-right:8px;border-radius:8px;display:inline-block">Library</h1>
            <p>Every render, edit, and post — one place to find them all.</p>
          </div>

          <!-- Tab bar — 8 tabs, one per output surface. Use the data-tab
               attribute and switchTab() to swap panes. -->
          <div class="lib-tabs" role="tablist">
            <button class="lib-tab active" data-tab="clips"     onclick="switchTab('clips', this)">Clips</button>
            <button class="lib-tab"        data-tab="editor"    onclick="switchTab('editor', this)">Edited Videos</button>
            <button class="lib-tab"        data-tab="captions"  onclick="switchTab('captions', this)">Captioned Videos</button>
            <button class="lib-tab"        data-tab="hooks"     onclick="switchTab('hooks', this)">Hook Videos</button>
            <button class="lib-tab"        data-tab="reframe"   onclick="switchTab('reframe', this)">Reframed Videos</button>
            <button class="lib-tab"        data-tab="broll"     onclick="switchTab('broll', this)">B-Roll Renders</button>
            <button class="lib-tab"        data-tab="thumbs"    onclick="switchTab('thumbs', this)">Thumbnails</button>
            <button class="lib-tab"        data-tab="posts"     onclick="switchTab('posts', this)">Posts</button>
          </div>

          <!-- Tab 1: Clips — iframes /shorts/clips?embed=1 so the
               existing My Clips page renders inside the Library tab
               with identical functionality. -->
          <div class="lib-pane active" id="pane-clips">
            <iframe id="clipsFrame" src="/shorts/clips?embed=1" scrolling="no" style="width:100%;height:280px;min-height:0;border:0;display:block;background:transparent;overflow:hidden;" title="My Clips" loading="eager"></iframe>
          </div>

          <!-- Tabs 2-7: video/image renders from user_renders -->
          <div class="lib-pane" id="pane-editor"></div>
          <div class="lib-pane" id="pane-captions"></div>
          <div class="lib-pane" id="pane-hooks"></div>
          <div class="lib-pane" id="pane-reframe"></div>
          <div class="lib-pane" id="pane-broll"></div>
          <div class="lib-pane" id="pane-thumbs"></div>

          <!-- Tab 8: Posts — the existing text content view, unchanged. -->
          <div class="lib-pane" id="pane-posts">
            <div class="controls">
              <input type="text" class="search-input" id="searchInput" placeholder="Search content..." />
            </div>
            <div class="content-grid" id="contentGrid"></div>
            <div class="empty-state" id="emptyState" style="display: none;">
              <h2>No posts yet</h2>
              <p>Generate text-based posts from /create or /repurpose to see them here</p>
            </div>
            <div class="pagination">
              <button onclick="previousPage()" id="prevBtn">← Previous</button>
              <span id="pageInfo" style="padding: 10px 15px; color: #888;">Page 1</span>
              <button onclick="nextPage()" id="nextBtn">Next →</button>
            </div>
          </div>

          <div class="toast" id="libToast" role="status" aria-live="polite"></div>
        </div>
      </div>

      <div class="modal-overlay" id="contentModal">
        <div class="modal-content">
          <button class="modal-close" onclick="closeModal()">&times;</button>
          <div id="modalBody">
            <div class="modal-loading">Loading...</div>
          </div>
        </div>
      </div>

      <script>
        ${getThemeScript()}

        // ── Library tab switching ────────────────────────────────────
        // Lazy-loads each render tab the first time it's activated so
        // we don't fire 6 API calls on page load. Iframe-based Clips
        // tab loads immediately because it's the default.
        var _libLoaded = { clips: true, posts: false };
        var TOOL_BY_TAB = {
          editor: 'video-editor',
          captions: 'ai-captions',
          hooks: 'ai-hook',
          reframe: 'ai-reframe',
          broll: 'ai-broll',
          thumbs: 'ai-thumbnail'
        };
        var EMPTY_COPY = {
          editor:   { title: 'No edited videos yet', body: 'Export a timeline from the Video Editor to see it here.' },
          captions: { title: 'No captioned videos yet', body: 'Burn captions onto a video from AI Captions to see it here.' },
          hooks:    { title: 'No hook videos yet', body: 'Generate a hook clip from AI Hooks to see it here.' },
          reframe:  { title: 'No reframed videos yet', body: 'Reframe a video from AI Reframe to see outputs for every aspect ratio here.' },
          broll:    { title: 'No B-Roll renders yet', body: 'Render a B-Roll-enhanced video from AI B-Roll to see it here.' },
          thumbs:   { title: 'No thumbnails yet', body: 'Generate thumbnail variants from AI Thumbnails to see them here.' }
        };

        function switchTab(name, btn) {
          document.querySelectorAll('.lib-tab').forEach(function(b){ b.classList.remove('active'); });
          document.querySelectorAll('.lib-pane').forEach(function(p){ p.classList.remove('active'); });
          if (btn) btn.classList.add('active');
          else document.querySelector('.lib-tab[data-tab="' + name + '"]')?.classList.add('active');
          var pane = document.getElementById('pane-' + name);
          if (pane) pane.classList.add('active');
          // Update URL so deep-links work.
          try {
            var u = new URL(location.href);
            u.searchParams.set('tab', name);
            history.replaceState(null, '', u.toString());
          } catch (_) {}
          // Lazy-load on first activation.
          if (name === 'posts' && !_libLoaded.posts) {
            loadHistory();
            _libLoaded.posts = true;
          } else if (TOOL_BY_TAB[name] && !_libLoaded[name]) {
            loadLibraryTab(name);
            _libLoaded[name] = true;
          }
        }

        async function loadLibraryTab(name) {
          var pane = document.getElementById('pane-' + name);
          var tool = TOOL_BY_TAB[name];
          if (!pane || !tool) return;
          pane.innerHTML = '<div class="lib-empty">Loading…</div>';
          try {
            var resp = await fetch('/repurpose/api/library?tool=' + encodeURIComponent(tool), { credentials: 'same-origin' });
            var data = await resp.json();
            renderLibraryTab(name, data.items || []);
          } catch (e) {
            pane.innerHTML = '<div class="lib-empty">Error loading: ' + libEscape(e.message) + '</div>';
          }
        }

        function renderLibraryTab(name, items) {
          var pane = document.getElementById('pane-' + name);
          if (!items.length) {
            var copy = EMPTY_COPY[name] || { title: 'Nothing here yet', body: '' };
            pane.innerHTML = '<div class="lib-empty"><strong>' + libEscape(copy.title) + '</strong>' + libEscape(copy.body) + '</div>';
            return;
          }
          // Storage header
          var totalBytes = items.reduce(function(s, i){ return s + (i.fileSize || 0); }, 0);
          var head = '<div class="lib-storage">Showing <strong>' + items.length + '</strong> ' + (items.length === 1 ? 'item' : 'items') + ' · <strong>' + libFmtBytes(totalBytes) + '</strong> used.</div>';
          var html = head + '<div class="lib-grid">' + items.map(function(it) {
            var thumb;
            // Task #162 — Drafts have no rendered file, so render a
            // styled "Draft" tile that doubles as a click target into
            // the editor for that project id.
            if (it.isDraft){
              thumb = '<a href="' + libEscape(it.editorUrl) + '" class="lib-card-thumb" style="background:linear-gradient(135deg,#1e1b4b,#7c3aed);display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;text-decoration:none;gap:8px;cursor:pointer">' +
                        '<span style="font-size:36px;line-height:1">✏️</span>' +
                        '<span style="font-size:11px;letter-spacing:1.5px;font-weight:700;opacity:.85">DRAFT</span>' +
                      '</a>';
            } else if (it.kind === 'image') {
              thumb = '<div class="lib-card-thumb image"><img src="' + libEscape(it.downloadUrl) + '" alt="" loading="lazy"></div>';
            } else {
              // Always render the <video> tag — the download endpoint
              // handles R2 fallback automatically when the local /tmp
              // file is gone (Railway redeploys), so 'onDisk' alone
              // shouldn't gate the thumbnail.
              //
              // #t=0.5 forces the browser to seek to 0.5s and paint
              // that frame as the poster. Without this, preload=
              // metadata loads dimensions/duration only and leaves
              // the player visually blank.
              var src = libEscape(it.downloadUrl) + '#t=0.5';
              thumb = '<div class="lib-card-thumb">' +
                        '<video src="' + src + '" muted playsinline preload="metadata" ' +
                          'onloadeddata="this.currentTime=0.5"></video>' +
                      '</div>';
            }
            var actions = '';
            if (it.isDraft){
              actions += '<a class="primary" href="' + libEscape(it.editorUrl) + '">✏️ Open in Editor</a>';
              actions += '<button onclick="libDelete(\\'' + it.id + '\\', this)" class="danger">\u{1F5D1} Delete</button>';
            } else {
              actions += '<a class="primary" href="' + libEscape(it.downloadUrl) + '" download="' + libEscape(it.filename) + '">⬇ Download</a>';
              actions += '<button onclick="libDelete(\\'' + it.id + '\\', this)" class="danger">\u{1F5D1} Delete</button>';
            }
            // Task #162 — Draft badge in the title row so users can
            // scan the grid and distinguish drafts from rendered
            // exports at a glance.
            var draftBadge = it.isDraft
              ? '<span style="display:inline-block;background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;font-size:9px;font-weight:800;letter-spacing:.6px;padding:2px 7px;border-radius:999px;margin-right:6px;vertical-align:middle">DRAFT</span>'
              : '';
            return (
              '<div class="lib-card' + (it.isDraft ? ' lib-card-draft' : '') + '" data-render-id="' + libEscape(it.id) + '">' +
                thumb +
                '<div class="lib-card-body">' +
                  '<div class="lib-card-title">' + draftBadge + libEscape(it.title || it.filename) + '</div>' +
                  '<div class="lib-card-meta">' +
                    (it.fileSize ? '<span>\u{1F4BE} ' + libFmtBytes(it.fileSize) + '</span>' : '') +
                    '<span>\u{1F552} ' + libFmtDate(it.createdAt) + '</span>' +
                  '</div>' +
                '</div>' +
                '<div class="lib-card-actions">' + actions + '</div>' +
              '</div>'
            );
          }).join('') + '</div>';
          pane.innerHTML = html;
        }

        async function libDelete(id, btn) {
          if (!confirm('Delete this render? The file will be removed from the server.')) return;
          btn.disabled = true; btn.textContent = '…';
          try {
            var r = await fetch('/repurpose/api/library/' + encodeURIComponent(id) + '/delete', { method: 'POST', credentials: 'same-origin' });
            var d = await r.json();
            if (!r.ok) throw new Error(d.error || 'Failed');
            document.querySelector('.lib-card[data-render-id="' + id + '"]')?.remove();
            libToast('Render deleted');
          } catch (e) {
            libToast('Delete failed: ' + e.message);
            btn.disabled = false; btn.textContent = '\u{1F5D1} Delete';
          }
        }

        function libEscape(s) {
          return String(s == null ? '' : s)
            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
        }
        function libFmtBytes(b) {
          if (!b) return '0 B';
          var u = ['B','KB','MB','GB','TB'];
          var i = 0, n = b;
          while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
          return n.toFixed(n < 10 && i > 0 ? 1 : 0) + ' ' + u[i];
        }
        function libFmtDate(s) {
          if (!s) return '';
          var d = new Date(s); if (isNaN(d)) return '';
          var diff = Math.round((Date.now() - d) / 1000);
          if (diff < 60) return 'just now';
          if (diff < 3600) return Math.round(diff/60) + 'm ago';
          if (diff < 86400) return Math.round(diff/3600) + 'h ago';
          if (diff < 604800) return Math.round(diff/86400) + 'd ago';
          return d.toLocaleDateString();
        }
        function libToast(msg) {
          var t = document.getElementById('libToast');
          if (!t) return;
          t.textContent = msg; t.classList.add('show');
          setTimeout(function(){ t.classList.remove('show'); }, 2800);
        }

        // Delegated fallback for video thumbnails that fail to load
        // (file no longer on /tmp AND no R2 backup). Replace the broken
        // <video> with a film-clapper icon so the card still reads
        // visually, instead of showing a blank/broken-video square.
        document.addEventListener('error', function(e) {
          var v = e.target;
          if (!v || v.tagName !== 'VIDEO') return;
          var card = v.closest && v.closest('.lib-card-thumb');
          if (!card) return;
          card.innerHTML = '<span style="font-size:28px;color:var(--text-muted)">\u{1F3AC}</span>';
        }, true);

        // Auto-resize the embedded Clips iframe to its full natural
        // content height. We DON'T cap it — that would force an
        // internal scrollbar nested inside the parent page's
        // scrollbar. Instead the iframe expands to fit and the parent
        // page's single global scrollbar handles all vertical motion.
        //
        // The modals inside the iframe (Delete confirm, Publish, etc.)
        // re-anchor themselves to the parent's current viewport via JS
        // (see anchorToParentViewport in /shorts/clips embed mode), so
        // a tall iframe doesn't push them off-screen.
        window.addEventListener('message', function(e) {
          if (!e || !e.data || e.data.type !== 'my-clips-height') return;
          var f = document.getElementById('clipsFrame');
          if (!f) return;
          // Honor the actual content height with a tiny floor for the
          // empty-state card. Lets the iframe shrink right under the
          // last clip when the user has just a few items.
          var h = Math.max(140, Number(e.data.height) || 0);
          if (h && Math.abs(f.clientHeight - h) > 4) f.style.height = h + 'px';
        });

        // Deep-link: ?tab=clips|editor|captions|hooks|reframe|broll|thumbs|posts
        (function(){
          try {
            var t = new URLSearchParams(location.search).get('tab');
            if (t && document.querySelector('.lib-tab[data-tab="' + t + '"]')) {
              switchTab(t, document.querySelector('.lib-tab[data-tab="' + t + '"]'));
            }
          } catch (_) {}
        })();

        let allContent = [];
        let filteredContent = [];
        let currentPage = 1;
        const itemsPerPage = 9;

        async function loadHistory() {
          try {
            const response = await fetch('/repurpose/api/history');
            const data = await response.json();
            allContent = data;
            filteredContent = data;
            renderPage();
          } catch (error) {
            console.error('Error loading history:', error);
          }
        }

        function renderPage() {
          const grid = document.getElementById('contentGrid');
          const emptyState = document.getElementById('emptyState');

          if (filteredContent.length === 0) {
            grid.innerHTML = '';
            emptyState.style.display = 'block';
            document.querySelector('.pagination').style.display = 'none';
            return;
          }

          emptyState.style.display = 'none';
          document.querySelector('.pagination').style.display = 'flex';

          const startIdx = (currentPage - 1) * itemsPerPage;
          const endIdx = startIdx + itemsPerPage;
          const pageItems = filteredContent.slice(startIdx, endIdx);

          grid.innerHTML = pageItems.map(item => \`
            <div class="content-card" onclick="viewContent('\${item.id}')">
              <div class="card-title">\${escapeHtml(item.title || 'Untitled')}</div>
              <div class="card-date">\${new Date(item.created_at).toLocaleDateString()}</div>
              <div class="card-platforms">
                \${item.platforms.map(p => \`<span class="platform-badge" data-platform="\${p}">\${p}</span>\`).join('')}
              </div>
              <div class="card-preview">\${escapeHtml((item.preview || '').substring(0, 100))}...</div>
            </div>
          \`).join('');

          document.getElementById('pageInfo').textContent = \`Page \${currentPage}\`;
          document.getElementById('prevBtn').disabled = currentPage === 1;
          document.getElementById('nextBtn').disabled = endIdx >= filteredContent.length;
        }

        function previousPage() {
          if (currentPage > 1) {
            currentPage--;
            renderPage();
            window.scrollTo(0, 0);
          }
        }

        function nextPage() {
          const maxPage = Math.ceil(filteredContent.length / itemsPerPage);
          if (currentPage < maxPage) {
            currentPage++;
            renderPage();
            window.scrollTo(0, 0);
          }
        }

        async function viewContent(contentId) {
          const modal = document.getElementById('contentModal');
          const modalBody = document.getElementById('modalBody');
          modal.classList.add('show');
          modalBody.innerHTML = '<div class="modal-loading">Loading content...</div>';

          try {
            const response = await fetch('/repurpose/api/content/' + contentId);
            const data = await response.json();

            if (data.error) {
              modalBody.innerHTML = '<div class="modal-loading">Content not found</div>';
              return;
            }

            let html = '<div class="modal-title">' + escapeHtml(data.title || 'Untitled') + '</div>';
            html += '<div class="modal-date">' + new Date(data.created_at).toLocaleDateString() + '</div>';

            if (data.outputs && data.outputs.length > 0) {
              data.outputs.forEach(function(output) {
                html += '<div class="output-card" data-platform="' + escapeHtml(output.platform || '') + '">';
                html += '<div class="output-platform">' + escapeHtml(output.platform) + '</div>';
                html += '<div class="output-text">' + escapeHtml(output.generated_content || '') + '</div>';
                html += '<div class="output-actions">';
                html += '<button onclick="copyOutput(this)"><img src="/images/section-icons/A-84.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Copy</button>';
                // Phase 2d - Publish button. Reuses /api/connections and routes
                // to /repurpose/api/publish-output which dispatches via the
                // unified publishToConnection helper as a text-only post.
                html += '<button data-content-id="' + escapeHtml(String(contentId)) + '" data-output-id="' + escapeHtml(String(output.id == null ? '' : output.id)) + '" onclick="openRpPublishModal(this)" style="background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;">✈️ Publish to…</button>';
                html += '</div>';
                html += '</div>';
              });
            } else {
              html += '<div class="modal-loading">No generated content found</div>';
            }

            modalBody.innerHTML = html;
          } catch (err) {
            modalBody.innerHTML = '<div class="modal-loading">Error loading content</div>';
          }
        }

        function closeModal() {
          document.getElementById('contentModal').classList.remove('show');
        }

        document.getElementById('contentModal').addEventListener('click', function(e) {
          if (e.target === this) closeModal();
        });

        document.addEventListener('keydown', function(e) {
          if (e.key === 'Escape') closeModal();
        });

        function copyOutput(btn) {
          const text = btn.closest('.output-card').querySelector('.output-text').textContent;
          navigator.clipboard.writeText(text).then(function() {
            btn.textContent = '✅ Copied!';
            setTimeout(function() { btn.innerHTML = '<img src="/images/section-icons/A-84.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Copy'; }, 2000);
          });
        }

        function escapeHtml(text) {
          const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
          };
          return text.replace(/[&<>"']/g, m => map[m]);
        }

        document.getElementById('searchInput').addEventListener('input', function(e) {
          const searchTerm = e.target.value.toLowerCase().trim();
          if (!searchTerm) {
            filteredContent = allContent;
          } else {
            filteredContent = allContent.filter(function(item) {
              const title = (item.title || '').toLowerCase();
              const preview = (item.preview || '').toLowerCase();
              const content = (item.content || '').toLowerCase();
              const platforms = (item.platforms || []).join(' ').toLowerCase();
              return title.includes(searchTerm) || preview.includes(searchTerm) || content.includes(searchTerm) || platforms.includes(searchTerm);
            });
          }
          currentPage = 1;
          renderPage();
        });

        // loadHistory() now fires only when the Posts tab is first opened
        // (see switchTab). The Clips tab loads via its iframe on page load.

        // ── Phase 2d — Repurpose Publish Modal ────────────────────────
        // Opened from each output-card's "Publish to..." button. Lists the
        // user's connected accounts filtered to text-capable platforms
        // (Twitter/X, LinkedIn, Facebook today). Submit hits the new
        // /repurpose/api/publish-output endpoint which dispatches via the
        // unified publishToConnection helper as a text-only post.
        function ensureRpPublishModal(){
          if (document.getElementById('rpPublishModal')) return;
          const div = document.createElement('div');
          div.id = 'rpPublishModal';
          div.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);z-index:99999;align-items:center;justify-content:center;padding:20px;';
          div.addEventListener('click', function(e){ if (e.target === div) closeRpPublishModal(); });
          div.innerHTML = '\
          <div style="background:#16112a;border:1px solid rgba(108,58,237,0.30);border-radius:16px;width:100%;max-width:520px;padding:24px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.5);color:#e2e0f0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif">\
            <h3 style="margin:0 0 4px;font-size:1.1rem;display:flex;align-items:center;gap:8px;">✈️ Publish Generated Post</h3>\
            <div id="rpPubSub" style="color:#8e87b0;font-size:0.82rem;margin-bottom:18px;">Pick a connected account.</div>\
            <label style="display:block;font-size:0.72rem;color:#8e87b0;margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Account</label>\
            <select id="rpPubAccount" onchange="rpOnAccountChange()" style="width:100%;background:#0f0a1f;border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:10px 12px;color:#e2e0f0;font-size:0.85rem;font-family:inherit;outline:none;margin-bottom:10px;"><option value="">Loading…</option></select>\
            <div id="rpPubNoAcct" style="display:none;background:rgba(255,180,0,0.08);border:1px solid rgba(255,180,0,0.35);color:#ffd591;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:0.8rem;line-height:1.4;">No connected accounts yet. <a href="/distribute/connections" target="_blank" style="background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;text-decoration:none;padding:0.4rem 0.9rem;border-radius:6px;font-weight:600;font-size:0.78rem;display:inline-block;margin-top:6px">Connect →</a></div>\
            <div id="rpWorkflowChip" style="display:none;margin-bottom:14px;border-radius:10px;padding:10px 12px;font-size:0.78rem;line-height:1.45;letter-spacing:0.01em;"><div id="rpWorkflowChipBody"></div></div>\
            <label style="display:block;font-size:0.72rem;color:#8e87b0;margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Post text</label>\
            <textarea id="rpPubText" rows="6" style="width:100%;background:#0f0a1f;border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:10px 12px;color:#e2e0f0;font-size:0.85rem;font-family:inherit;outline:none;margin-bottom:14px;resize:vertical;min-height:120px;"></textarea>\
            <div style="display:flex;gap:8px;margin-bottom:14px;background:#0f0a1f;border-radius:10px;padding:4px;border:1px solid rgba(255,255,255,0.06);">\
              <button id="rpPubTabNow" type="button" onclick="setRpPubMode(\\'now\\')" style="flex:1;background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;padding:8px 12px;border-radius:6px;font-weight:600;font-size:0.82rem;cursor:pointer;">Post now</button>\
              <button id="rpPubTabLater" type="button" onclick="setRpPubMode(\\'later\\')" style="flex:1;background:transparent;color:#8e87b0;border:none;padding:8px 12px;border-radius:6px;font-weight:600;font-size:0.82rem;cursor:pointer;">Schedule for later</button>\
            </div>\
            <div id="rpPubLater" style="display:none;margin-bottom:14px;"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;"><div><label style="display:block;font-size:0.72rem;color:#8e87b0;margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Date</label><input type="date" id="rpPubDate" style="width:100%;background:#0f0a1f;border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:10px 12px;color:#e2e0f0;font-size:0.85rem;outline:none;"></div><div><label style="display:block;font-size:0.72rem;color:#8e87b0;margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Time</label><input type="time" id="rpPubTime" value="12:00" style="width:100%;background:#0f0a1f;border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:10px 12px;color:#e2e0f0;font-size:0.85rem;outline:none;"></div></div></div>\
            <div id="rpPubStatus" style="display:none;background:rgba(108,58,237,0.10);border:1px solid rgba(108,58,237,0.30);color:#c4b5fd;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:0.8rem;line-height:1.4;"></div>\
            <div style="display:flex;justify-content:flex-end;gap:8px;"><button onclick="closeRpPublishModal()" style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:#e2e0f0;padding:0.5rem 1rem;border-radius:8px;font-weight:600;font-size:0.85rem;cursor:pointer;">Cancel</button><button id="rpPubSubmit" onclick="submitRpPublish()" style="background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;padding:0.5rem 1.2rem;border-radius:8px;font-weight:600;font-size:0.85rem;cursor:pointer;">Publish</button></div>\
          </div>';
          document.body.appendChild(div);
        }
        var _rpPubMode = 'now';
        var _rpPubCtx = { contentId: null, outputId: null, platform: null };
        async function openRpPublishModal(btn){
          var contentId = btn && btn.dataset ? btn.dataset.contentId : null;
          var outputId = btn && btn.dataset && btn.dataset.outputId ? btn.dataset.outputId : null;
          ensureRpPublishModal();
          var card = btn && btn.closest && btn.closest('.output-card');
          var platform = (card && card.dataset && card.dataset.platform || '').toLowerCase();
          var text = (card && card.querySelector('.output-text') && card.querySelector('.output-text').textContent) || '';
          _rpPubCtx = { contentId: contentId, outputId: outputId, platform: platform };
          document.getElementById('rpPubText').value = text;
          document.getElementById('rpPubSub').textContent = platform ? ('Source platform: ' + platform) : 'Pick a connected account.';
          var d = new Date(); d.setMinutes(d.getMinutes() + 60);
          document.getElementById('rpPubDate').value = d.toISOString().slice(0, 10);
          document.getElementById('rpPubTime').value = String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
          document.getElementById('rpPubStatus').style.display = 'none';
          setRpPubMode('now');
          document.getElementById('rpPublishModal').style.display = 'flex';

          var sel = document.getElementById('rpPubAccount');
          var noAcct = document.getElementById('rpPubNoAcct');
          sel.innerHTML = '<option value="">Loading…</option>';
          try {
            var r = await fetch('/api/connections', { credentials: 'same-origin' });
            var j = await r.json();
            var accounts = (j && j.accounts) || [];
            // Text-only-capable platforms today.
            // Show every connected account. publishToConnection in
            // utils/connections.js routes per platform — image/video-only
            // destinations will surface their own error if the text-only
            // post is rejected.
            accounts = accounts.filter(function(c){ return !!c && !!c.platform; });
            // Prefer matching the source platform first.
            if (platform) {
              accounts.sort(function(a, b){
                if (a.platform === platform && b.platform !== platform) return -1;
                if (b.platform === platform && a.platform !== platform) return 1;
                return 0;
              });
            }
            if (accounts.length === 0) {
              sel.style.display = 'none';
              noAcct.style.display = 'block';
            } else {
              sel.style.display = '';
              noAcct.style.display = 'none';
              sel.innerHTML = accounts.map(function(c){
                return '<option value="' + c.id + '">' + (c.platform.charAt(0).toUpperCase()+c.platform.slice(1)) + ' — ' + (c.accountName || c.platformUsername || c.id) + '</option>';
              }).join('');
              // Refresh the workflow chip for the auto-selected first option.
              rpOnAccountChange();
            }
          } catch(e){
            sel.innerHTML = '<option value="">Failed to load accounts</option>';
          }
        }
        // ── Workflow status chip ─────────────────────────────────────
        // Same pattern as the Smart Shorts + Video Editor publish
        // modals. Reuses the /distribute/api/workflows-by-source/<id>
        // endpoint already shipped with those. Prefixed _rp to avoid
        // colliding with their identifiers if multiple modals share
        // the dashboard session.
        var _rpWfCache = {};
        function rpOnAccountChange() {
          var sel = document.getElementById('rpPubAccount');
          var chip = document.getElementById('rpWorkflowChip');
          var body = document.getElementById('rpWorkflowChipBody');
          if (!sel || !chip || !body) return;
          var connectionId = sel.value;
          if (!connectionId) { chip.style.display = 'none'; return; }
          if (_rpWfCache[connectionId]) { _rpRenderWfChip(_rpWfCache[connectionId]); return; }
          _rpSetWfChipTone('neutral');
          body.innerHTML = '<div style="display:flex;align-items:center;gap:8px;color:#8e87b0;"><div style="width:10px;height:10px;border:2px solid rgba(255,255,255,0.18);border-top-color:#a78bfa;border-radius:50%;animation:spin 0.7s linear infinite;"></div><span>Checking workflows for this account...</span></div>';
          chip.style.display = 'block';
          fetch('/distribute/api/workflows-by-source/' + encodeURIComponent(connectionId), { credentials: 'same-origin' })
            .then(function(r){ return r.ok ? r.json() : { workflows: [] }; })
            .then(function(data){ var wfs = (data && data.workflows) || []; _rpWfCache[connectionId] = wfs; _rpRenderWfChip(wfs); })
            .catch(function(){ _rpWfCache[connectionId] = []; _rpRenderWfChip([]); });
        }
        function _rpSetWfChipTone(tone) {
          var chip = document.getElementById('rpWorkflowChip');
          if (!chip) return;
          if (tone === 'active') { chip.style.background = 'rgba(0,184,148,0.10)'; chip.style.border = '1px solid rgba(0,184,148,0.35)'; chip.style.color = '#a3e8c8'; }
          else if (tone === 'none') { chip.style.background = 'rgba(108,58,237,0.10)'; chip.style.border = '1px solid rgba(108,58,237,0.30)'; chip.style.color = '#d8c9ff'; }
          else { chip.style.background = 'rgba(255,255,255,0.04)'; chip.style.border = '1px solid rgba(255,255,255,0.08)'; chip.style.color = '#8e87b0'; }
        }
        function _rpFmtDelay(w) {
          if (w.delayMode === 'immediate' || !w.delayHours) return 'immediately after this post';
          var h = w.delayHours;
          if (h < 1) return 'shortly after this post';
          if (h === 1) return '1 hour after this post';
          if (h < 24) return h + ' hours after this post';
          var days = Math.round(h / 24);
          return days === 1 ? '1 day after this post' : days + ' days after this post';
        }
        function _rpCapPlatform(p) {
          if (!p) return 'another platform';
          var map = { youtube:'YouTube', tiktok:'TikTok', instagram:'Instagram', facebook:'Facebook', twitter:'X (Twitter)', linkedin:'LinkedIn', pinterest:'Pinterest', threads:'Threads', bluesky:'Bluesky', snapchat:'Snapchat' };
          return map[p] || (p.charAt(0).toUpperCase() + p.slice(1));
        }
        function _rpEscAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
        function _rpRenderWfChip(workflows) {
          var body = document.getElementById('rpWorkflowChipBody');
          if (!body) return;
          if (workflows && workflows.length) {
            _rpSetWfChipTone('active');
            var lines = workflows.map(function(w) {
              var dest = _rpCapPlatform(w.destinationPlatform);
              var user = w.destinationUsername ? ('@' + w.destinationUsername) : '';
              var when = _rpFmtDelay(w);
              var name = w.name ? (' - <em style="font-style:normal;color:#fff;font-weight:600;">' + _rpEscAttr(w.name) + '</em>') : '';
              return '<div style="display:flex;align-items:flex-start;gap:8px;margin-top:6px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;margin-top:2px;"><polyline points="20 6 9 17 4 12"></polyline></svg><span>Will also publish to <strong style="color:#fff;">' + dest + (user ? ' (' + _rpEscAttr(user) + ')' : '') + '</strong> ' + when + name + '.</span></div>';
            }).join('');
            body.innerHTML = '<div style="display:flex;align-items:center;gap:8px;font-weight:700;color:#9be3b9;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg><span>Active workflow triggered by this account</span></div>' + lines;
          } else {
            _rpSetWfChipTone('none');
            body.innerHTML = '<div style="display:flex;align-items:flex-start;gap:8px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;margin-top:2px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg><div><div style="font-weight:600;color:#d8c9ff;margin-bottom:2px;">No workflow set for this account yet.</div><div style="color:#8e87b0;">Want this post auto-republished elsewhere? <a href="/distribute" target="_blank" rel="noopener" style="color:#c4b5fd;text-decoration:underline;font-weight:600;">Set up a workflow</a> on the Repurpose page - then every future publish here will fire it.</div></div></div>';
          }
        }
        function closeRpPublishModal(){ var m = document.getElementById('rpPublishModal'); if (m) m.style.display = 'none'; }
        function setRpPubMode(mode){
          _rpPubMode = mode;
          var nowBtn = document.getElementById('rpPubTabNow');
          var laterBtn = document.getElementById('rpPubTabLater');
          var laterFields = document.getElementById('rpPubLater');
          var submitBtn = document.getElementById('rpPubSubmit');
          if (mode === 'now') {
            nowBtn.style.background = 'linear-gradient(135deg,#6C3AED,#EC4899)'; nowBtn.style.color = '#fff';
            laterBtn.style.background = 'transparent'; laterBtn.style.color = '#8e87b0';
            laterFields.style.display = 'none';
            submitBtn.textContent = 'Publish now';
          } else {
            laterBtn.style.background = 'linear-gradient(135deg,#6C3AED,#EC4899)'; laterBtn.style.color = '#fff';
            nowBtn.style.background = 'transparent'; nowBtn.style.color = '#8e87b0';
            laterFields.style.display = 'block';
            submitBtn.textContent = 'Schedule';
          }
        }
        async function submitRpPublish(){
          var btn = document.getElementById('rpPubSubmit');
          var statusEl = document.getElementById('rpPubStatus');
          var connectionId = document.getElementById('rpPubAccount').value;
          if (!connectionId) { statusEl.style.display = 'block'; statusEl.textContent = 'Pick an account first.'; return; }
          var text = document.getElementById('rpPubText').value.trim();
          if (!text) { statusEl.style.display = 'block'; statusEl.textContent = 'Post body is empty.'; return; }
          var payload = {
            contentId: _rpPubCtx.contentId,
            outputId: _rpPubCtx.outputId,
            connectionId: connectionId,
            text: text
          };
          if (_rpPubMode === 'later') {
            var d = document.getElementById('rpPubDate').value;
            var t = document.getElementById('rpPubTime').value || '12:00';
            if (!d) { statusEl.style.display = 'block'; statusEl.textContent = 'Pick a date and time.'; return; }
            payload.scheduledAt = d + 'T' + t + ':00';
          }
          btn.disabled = true; var orig = btn.textContent;
          btn.textContent = _rpPubMode === 'now' ? 'Publishing…' : 'Scheduling…';
          statusEl.style.display = 'block';
          statusEl.textContent = _rpPubMode === 'now' ? 'Posting…' : 'Saving the scheduled post…';
          try {
            var resp = await fetch('/repurpose/api/publish-output', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            var data = await resp.json();
            if (!resp.ok || !data.success) throw new Error(data.error || 'Failed');
            statusEl.textContent = _rpPubMode === 'now'
              ? ('Posted to ' + (data.platform || 'platform'))
              : ('Scheduled for ' + (data.scheduledFor || payload.scheduledAt));
            setTimeout(closeRpPublishModal, 1500);
          } catch(e){
            statusEl.textContent = 'Error: ' + e.message;
          } finally {
            btn.disabled = false; btn.textContent = orig;
          }
        }
      </script>
    </body>
    </html>
  `);
});

// Phase 2d - POST /repurpose/api/publish-output
// Unified Repurpose -> Connected Account publish bridge for text-only
// platform outputs. Body: { contentId, outputId, connectionId, text, scheduledAt? }
// scheduledAt in the future -> creates a calendar_entries row with
//   auto_publish=true + connection_id; schedulePublisher picks it up.
// Otherwise -> publishToConnection(userId, connectionId, { description, ... })
//   with no mediaPath, so the per-platform publisher takes its text-only branch
//   (Twitter already text-only; LinkedIn + Facebook gained text-only short-
//   circuits in workflowEngine.js for this phase).
router.post('/api/publish-output', requireAuth, async (req, res) => {
  try {
    const { contentId, outputId, connectionId, text, scheduledAt } = req.body || {};
    if (!connectionId) return res.status(400).json({ success: false, error: 'connectionId is required' });
    if (!text || !text.trim()) return res.status(400).json({ success: false, error: 'Post body is empty' });

    const { getConnectionById, publishToConnection } = require('../utils/connections');
    const acct = await getConnectionById(req.user.id, connectionId);
    if (!acct) return res.status(404).json({ success: false, error: 'Connection not found' });

    // Schedule path - reuse calendar_entries + schedulePublisher cron.
    if (scheduledAt) {
      const when = new Date(scheduledAt);
      if (isNaN(when.getTime())) {
        return res.status(400).json({ success: false, error: 'Invalid scheduled date/time.' });
      }
      if (when.getTime() <= Date.now() + 60_000) {
        // Don't silently fall through to post-now — that path crashed
        // with confusing fs errors when the user expected scheduling.
        return res.status(400).json({ success: false, error: 'Scheduled time must be at least 1 minute in the future.' });
      }
      {
        const { calendarOps } = require('../db/database');
        const dateStr = when.toISOString().slice(0, 10);
        const timeStr = String(when.getUTCHours()).padStart(2, '0') + ':' + String(when.getUTCMinutes()).padStart(2, '0');
        const entry = await calendarOps.create({
          userId: req.user.id,
          title: (text || '').split('\n')[0].slice(0, 100) || 'Repurpose post',
          platform: acct.platform,
          scheduledDate: dateStr,
          scheduledTime: timeStr,
          contentText: text,
          analysisId: null, momentIndex: null,
          notes: '', color: '#6c5ce7',
          autoPublish: true,
          // Text-only post -> no clip required. schedulePublisher's new
          // connection_id branch publishes via publishToConnection which
          // routes to text-only paths when mediaPath is absent.
          clipFilename: '',
          connectionId: acct.id
        });
        return res.json({ success: true, scheduled: true, scheduledFor: dateStr + ' ' + timeStr, entryId: entry.id });
      }
    }

    // Post-now path - text-only publish via the unified dispatcher.
    const result = await publishToConnection(req.user.id, connectionId, {
      title: (text || '').split('\n')[0].slice(0, 100),
      description: text,
      caption: text
      // No mediaPath -> platform publishers take their text-only branch.
    });
    if (!result.success) return res.status(400).json(result);

    // Workflow bridge — if the user has any active LinkedIn/Pinterest/
    // etc. cross-publish workflows whose source is this connection,
    // queue downstream entries so the cron will republish them after
    // each workflow's configured delay_hours. Fire-and-forget so a
    // queue hiccup never blocks the original response.
    try {
      const { enqueueDownstreamPublishes } = require('../utils/workflowQueue');
      enqueueDownstreamPublishes(req.user.id, connectionId, {
        sourceType: 'post',
        title: (text || '').split('\n')[0].slice(0, 100),
        description: text,
        text: text,
        sourceUrl: null,
        dedupeKey: 'pubout-' + (outputId || Date.now())
      }).catch(function(e){ console.warn('[publish-output] workflow enqueue:', e && e.message); });
    } catch (qErr) { console.warn('[publish-output] workflow enqueue require failed:', qErr.message); }

    res.json({ success: true, platform: acct.platform, externalId: result.externalId || null });
  } catch (err) {
    console.error('[POST /repurpose/api/publish-output]', err.message);
    res.status(500).json({ success: false, error: err.message || 'Publish failed' });
  }
});

// GET - API endpoint for history data
router.get('/api/history', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const contents = await contentOps.getByUserId(userId, 100, 0);

    const contentWithOutputs = await Promise.all(
      contents.map(async (content) => {
        const outputs = await outputOps.getByContentId(content.id);
        return {
          id: content.id,
          title: content.title,
          created_at: content.created_at,
          platforms: outputs.map(o => o.platform),
          preview: outputs[0]?.generated_content?.substring(0, 100) || '',
          content: outputs[0]?.generated_content || ''
        };
      })
    );

    res.json(contentWithOutputs);
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// ── Library API ──────────────────────────────────────────────────
// GET /repurpose/api/library?tool=<slug>&status=<state>&sortBy=&sortDir=
// Lists user_renders rows for the authenticated user, filtered to a
// single tool slug used by one of the Library tabs:
//   video-editor | ai-captions | ai-hook | ai-reframe | ai-broll | ai-thumbnail
// Clips and Posts tabs use their own legacy endpoints (clip_renders /
// content_items + generated_outputs), not this one.
router.get('/api/library', requireAuth, async (req, res) => {
  try {
    const opts = {
      tool:    req.query.tool    || 'all',
      status:  req.query.status  || 'ready',
      sortBy:  req.query.sortBy  || 'created_at',
      sortDir: req.query.sortDir || 'desc',
      limit:   parseInt(req.query.limit, 10) || 100,
      offset:  parseInt(req.query.offset, 10) || 0
    };
    const rows = await userRenderOps.getByUser(req.user.id, opts);
    // Build a download URL + onDisk flag so the UI can choose how to
    // render each card. R2 fallback happens server-side on download.
    const path = require('path');
    const fs = require('fs');
    const outputDir = path.join('/tmp', 'repurpose-outputs');
    const items = rows.map(r => {
      let onDisk = false;
      try { onDisk = fs.existsSync(path.join(outputDir, r.filename)); } catch (_) {}
      return {
        id: r.id,
        tool: r.tool,
        kind: r.kind || 'video',
        filename: r.filename,
        title: r.title,
        sourceUrl: r.source_url,
        sourceId: r.source_id,
        thumbnailUrl: r.thumbnail_url,
        fileSize: Number(r.file_size || 0),
        durationSeconds: r.duration_seconds || null,
        status: r.status,
        createdAt: r.created_at,
        readyAt: r.created_at,
        downloadUrl: '/repurpose/api/library/' + encodeURIComponent(r.id) + '/download',
        onDisk,
        hasR2: !!r.r2_key,
        metadata: r.metadata || null,
        isDraft: false
      };
    });
    // Task #162 — merge Save-as-Draft rows into the video-editor tab.
    // Drafts are projects with status='draft'; they share the Library
    // surface but render with a Draft badge + Open-in-Editor action
    // (no Download URL) because the final file doesn't exist yet.
    if (opts.tool === 'video-editor' || opts.tool === 'all'){
      try {
        const { projectOps } = require('../db/database');
        const drafts = await projectOps.listDraftsByUser(req.user.id, 100);
        const draftItems = drafts.map(d => ({
          id: 'draft_' + d.id,
          projectId: d.id,
          tool: 'video-editor',
          kind: 'video',
          filename: d.primary_filename || (d.name + '.draft'),
          title: d.name || 'Untitled Draft',
          sourceUrl: null,
          sourceId: null,
          thumbnailUrl: null,
          fileSize: 0,
          durationSeconds: Number(d.primary_duration) || null,
          status: 'draft',
          createdAt: d.updated_at || d.created_at,
          readyAt: d.updated_at || d.created_at,
          downloadUrl: null,                            // no download — draft, not exported
          onDisk: false,
          hasR2: false,
          metadata: null,
          isDraft: true,
          editorUrl: '/video-editor/' + d.id
        }));
        items.push(...draftItems);
        // Re-sort newest first now that drafts are mixed in.
        items.sort((a, b) => new Date(b.readyAt || b.createdAt) - new Date(a.readyAt || a.createdAt));
      } catch (e){ console.warn('[library] draft merge failed:', e.message); }
    }
    res.json({ items });
  } catch (err) {
    console.error('[GET /repurpose/api/library]', err);
    res.status(500).json({ error: err.message || 'Library fetch failed' });
  }
});

// GET /repurpose/api/library/storage?tool=<slug>
// Aggregate file_size + count for the storage indicator in the header.
router.get('/api/library/storage', requireAuth, async (req, res) => {
  try {
    const s = await userRenderOps.totalStorageBytes(req.user.id, req.query.tool || 'all');
    res.json({ totalBytes: s.total, count: s.count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /repurpose/api/library/:id/download
// Streams the file from /tmp first; if missing, restores from R2 to /tmp
// and streams that. Same fallback pattern as the Smart Shorts clip
// download endpoint, so the user can always grab their renders even
// after a Railway redeploy wipes /tmp.
router.get('/api/library/:id/download', requireAuth, async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const row = await userRenderOps.getById(req.params.id);
    if (!row || row.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
    if (row.deleted_at) return res.status(410).json({ error: 'This render has been deleted' });
    const outputDir = path.join('/tmp', 'repurpose-outputs');
    let full = path.join(outputDir, row.filename);
    if (!fs.existsSync(full) && row.r2_key) {
      try {
        const r2 = require('../utils/r2');
        if (r2.isConfigured()) {
          const got = await r2.getObject(row.r2_key);
          if (got && got.ok && got.body) {
            try { if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true }); } catch (_) {}
            fs.writeFileSync(full, got.body);
          }
        }
      } catch (rErr) { console.warn('[library download] R2 restore failed:', rErr.message); }
    }
    if (!fs.existsSync(full)) {
      return res.status(410).json({ error: 'File is no longer available. Re-render to download.' });
    }
    res.setHeader('Content-Disposition', 'attachment; filename="' + row.filename + '"');
    return res.sendFile(full);
  } catch (err) {
    console.error('[library download]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /repurpose/api/library/:id/delete — soft-delete a render row
// and best-effort remove the local file + R2 object.
//
// Task #162 — Also handles draft rows: when id starts with 'draft_'
// it's a synthetic id from the listing-merge in /api/library and
// the real key is the underlying project id (the suffix). Drafts
// are deleted by removing the projects row entirely.
router.post('/api/library/:id/delete', requireAuth, async (req, res) => {
  try {
    const rawId = req.params.id || '';
    if (rawId.indexOf('draft_') === 0){
      const projectId = rawId.slice('draft_'.length);
      const { projectOps } = require('../db/database');
      const ok = await projectOps.delete(projectId, req.user.id);
      return res.json({ success: !!ok });
    }
    const fs = require('fs');
    const path = require('path');
    const row = await userRenderOps.getById(rawId);
    if (!row || row.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
    try { fs.unlinkSync(path.join('/tmp', 'repurpose-outputs', row.filename)); } catch (_) {}
    if (row.r2_key) {
      try {
        const r2 = require('../utils/r2');
        if (r2.isConfigured()) await r2.deleteObject(row.r2_key);
      } catch (_) {}
    }
    await userRenderOps.softDelete(rawId, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API endpoint for content detail with all outputs
router.get('/api/content/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const contentId = req.params.id;
    const content = await contentOps.getById(contentId);

    if (!content || content.user_id !== userId) {
      return res.status(404).json({ error: 'Content not found' });
    }

    const outputs = await outputOps.getByContentId(contentId);

    res.json({
      id: content.id,
      title: content.title,
      created_at: content.created_at,
      source_url: content.source_url,
      outputs: outputs.map(o => ({
        id: o.id,
        platform: o.platform,
        generated_content: o.generated_content,
        tone: o.tone,
        created_at: o.created_at
      }))
    });
  } catch (error) {
    console.error('Error fetching content detail:', error);
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});

// API endpoint for brand voices
router.get('/api/brand-voices', requireAuth, async (req, res) => {
  try {
    const voices = await brandVoiceOps.getByUserId(req.user.id);
    res.json(voices);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch brand voices' });
  }
});

module.exports = router;
module.exports.extractAudioForRepurpose = extractAudioForRepurpose;
module.exports.transcribeUploadedFile = transcribeUploadedFile;
module.exports.repurposeUpload = upload;
