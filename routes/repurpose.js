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
const { contentOps, outputOps, brandVoiceOps } = require('../db/database');

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
const upload = multer({ dest: uploadDir, limits: { fileSize: 200 * 1024 * 1024 } });

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
          background: linear-gradient(135deg, #6C3AED 0%, #EC4899 100%);
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
          background: linear-gradient(135deg, #6C3AED 0%, #EC4899 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          font-weight: 700;
        }

        body.light .form-section h2 {
          background: linear-gradient(135deg, #5B21B6 0%, #DB2777 100%);
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
            <h1>Transform Your Content</h1>
            <p>Turn any YouTube video into tailored content for multiple platforms with AI</p>
          </div>

          <div class="form-container">
            <div class="form-section">
              <h2>Step 1: Your Content</h2>
              <div class="form-group">
                <label>YouTube URL</label>
                <input type="url" id="youtubeUrl" name="yt_repurpose_url" autocomplete="one-time-code" data-form-type="other" data-lpignore="true" placeholder="https://www.youtube.com/watch?v=..." />
              </div>

              <h2 style="margin-top: 30px;">Step 2: Choose Platforms</h2>
              <div class="platform-selector">
                <div class="platform-card" data-platform="Instagram">
                  <input type="checkbox" name="platform" value="Instagram" />
                  <span>📷 Instagram</span>
                </div>
                <div class="platform-card" data-platform="TikTok">
                  <input type="checkbox" name="platform" value="TikTok" />
                  <span>🎵 TikTok</span>
                </div>
                <div class="platform-card" data-platform="Twitter">
                  <input type="checkbox" name="platform" value="Twitter" />
                  <span>𝕏 Twitter/X</span>
                </div>
                <div class="platform-card" data-platform="LinkedIn">
                  <input type="checkbox" name="platform" value="LinkedIn" />
                  <span>💼 LinkedIn</span>
                </div>
                <div class="platform-card" data-platform="Facebook">
                  <input type="checkbox" name="platform" value="Facebook" />
                  <span>👍 Facebook</span>
                </div>
                <div class="platform-card" data-platform="YouTube">
                  <input type="checkbox" name="platform" value="YouTube" />
                  <span>🎬 YouTube</span>
                </div>
                <div class="platform-card" data-platform="Blog">
                  <input type="checkbox" name="platform" value="Blog" />
                  <span>📝 Blog Post</span>
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

              <div class="button-group">
                <button class="btn btn-primary" onclick="repurposeContent()">✨ Create Now</button>
              </div>
            </div>
          </div>

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

        async function repurposeContent() {
          const url = document.getElementById('youtubeUrl').value.trim();
          const platforms = Array.from(document.querySelectorAll('input[name="platform"]:checked')).map(el => el.value);
          const tone = document.getElementById('toneValue').value || null;
          const brandVoiceId = document.getElementById('brandVoice').value;

          if (!url) {
            showError('Please enter a YouTube URL');
            return;
          }
          if (platforms.length === 0) { 
            showError('Please select at least one platform');
            return;
          }

          if (!tone && !brandVoiceId) {
            showError('Please select a tone or a brand voice');
            return;
          }

          try {
            showLoading();
            document.getElementById('resultsGrid').innerHTML = '';
            let resultCount = 0;
            let hadError = false;
            const response = await fetch('/repurpose/process-stream', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url,
                platforms,
                tone,
                brandVoiceId: brandVoiceId || null
              })
            });

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
                <button class="icon-btn copy-btn" data-content="\${btoa(unescape(encodeURIComponent(content)))}">📋 Copy</button>
                <button class="icon-btn" onclick="shareContent('\${platform}', '\${btoa(unescape(encodeURIComponent(content)))}')">🔗 Share</button>
                <button class="icon-btn" onclick="regenerate('\${contentId}', '\${platform}')">🔄 Regenerate</button>
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
              <button class="icon-btn copy-btn" data-content="\${btoa(unescape(encodeURIComponent(content)))}">📋 Copy</button>
              <button class="icon-btn" onclick="shareContent('\${platform}', '\${btoa(unescape(encodeURIComponent(content)))}')">🔗 Share</button>
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

        function shareContent(platform, encodedContent) {
          const text = decodeURIComponent(escape(atob(encodedContent)));
          const encoded = encodeURIComponent(text);
          let url = '';

          switch(platform) {
            case 'Twitter':
              url = 'https://twitter.com/intent/tweet?text=' + encoded;
              break;
            case 'LinkedIn':
              url = 'https://www.linkedin.com/sharing/share-offsite/?url=&summary=' + encoded;
              break;
            case 'Facebook':
              url = 'https://www.facebook.com/sharer/sharer.php?quote=' + encoded;
              break;
            default:
              // For Instagram, TikTok, YouTube, Blog — copy to clipboard instead
              navigator.clipboard.writeText(text).then(() => {
                const feedback = document.getElementById('successFeedback');
                feedback.textContent = '✓ Copied! Now paste it in ' + platform;
                feedback.classList.add('show');
                setTimeout(() => {
                  feedback.classList.remove('show');
                  feedback.textContent = '✓ Copied to clipboard!';
                }, 3000);
              });
              return;
          }

          window.open(url, '_blank', 'width=600,height=500');
        }

        function copyToClipboard(text) {
          navigator.clipboard.writeText(text).then(() => {
            const feedback = document.getElementById('successFeedback');
            feedback.classList.add('show');
            setTimeout(() => feedback.classList.remove('show'), 2000);
          });
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
    const platforms = ['Instagram', 'Twitter', 'LinkedIn'];
    const tone = 'Professional';
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
          generatePlatformContent(transcript, platform, tone, null),
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
          background: linear-gradient(135deg, #6C3AED 0%, #EC4899 100%);
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
            <h1>Content Library</h1>
            <p>Browse and manage all your created content</p>
          </div>

          <div class="controls">
            <input type="text" class="search-input" id="searchInput" placeholder="Search content..." />
          </div>

          <div class="content-grid" id="contentGrid"></div>

          <div class="empty-state" id="emptyState" style="display: none;">
            <h2>No content yet</h2>
            <p>Start by creating a video to see it here</p>
          </div>

          <div class="pagination">
            <button onclick="previousPage()" id="prevBtn">← Previous</button>
            <span id="pageInfo" style="padding: 10px 15px; color: #888;">Page 1</span>
            <button onclick="nextPage()" id="nextBtn">Next →</button>
          </div>
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
                html += '<div class="output-card">';
                html += '<div class="output-platform">' + escapeHtml(output.platform) + '</div>';
                html += '<div class="output-text">' + escapeHtml(output.generated_content || '') + '</div>';
                html += '<div class="output-actions">';
                html += '<button onclick="copyOutput(this)">📋 Copy</button>';
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
            setTimeout(function() { btn.textContent = '📋 Copy'; }, 2000);
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

        loadHistory();
      </script>
    </body>
    </html>
  `);
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
