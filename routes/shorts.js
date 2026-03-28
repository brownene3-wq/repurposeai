const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const OpenAI = require('openai');
// Lazy-load ytdl-core to avoid crashing if it has issues
let ytdl, ytdlError;
try { ytdl = require('@distube/ytdl-core'); } catch (e) { ytdlError = e.message; console.error('ytdl-core not available:', e.message); }

// Find ffmpeg binary: check local bin/, then ffmpeg-static, then system
let ffmpegPath = null;
const localFfmpeg = path.join(__dirname, '..', 'bin', 'ffmpeg');
if (fs.existsSync(localFfmpeg)) { ffmpegPath = localFfmpeg; }
if (!ffmpegPath) { try { ffmpegPath = require('ffmpeg-static'); } catch (e) {} }
if (!ffmpegPath) { try { execSync('which ffmpeg', { stdio: 'pipe' }); ffmpegPath = 'ffmpeg'; } catch (e) {} }
const ffmpegAvailable = !!ffmpegPath;
console.log(ffmpegAvailable ? `ffmpeg available at: ${ffmpegPath}` : 'ffmpeg not found - clip download disabled');
const { requireAuth, checkPlanLimit } = require('../middleware/auth');
const { shortsOps } = require('../db/database');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Clips directory
const CLIPS_DIR = path.join('/tmp', 'repurpose-clips');
if (!fs.existsSync(CLIPS_DIR)) fs.mkdirSync(CLIPS_DIR, { recursive: true });

// Helper: Extract video ID from YouTube URL
function extractVideoId(url) {
  const regexPatterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  for (const pattern of regexPatterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Helper: Format timestamp in seconds to HH:MM:SS
function formatTimestamp(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return [hrs, mins, secs].map(x => String(x).padStart(2, '0')).join(':');
}

// Helper: Combine transcript segments into text with timestamps
function buildTranscriptText(segments) {
  return segments.map(seg => {
    const timestamp = formatTimestamp(seg.offset / 1000);
    return `[${timestamp}] ${seg.text}`;
  }).join(' ');
}

// Helper: Fetch transcript using Supadata.ai API (most reliable - paid service, no YouTube blocking)
async function fetchTranscriptSupadata(videoId) {
  const apiKey = process.env.SUPADATA_API_KEY;
  if (!apiKey) throw new Error('SUPADATA_API_KEY not configured');

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  console.log('  Supadata: Fetching transcript for', videoId);

  const resp = await fetch(`https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(videoUrl)}&lang=en`, {
    headers: {
      'x-api-key': apiKey,
    }
  });

  // Handle async job (HTTP 202 for long videos)
  if (resp.status === 202) {
    const jobData = await resp.json();
    const jobId = jobData.jobId;
    if (!jobId) throw new Error('Supadata returned 202 but no jobId');

    console.log(`  Supadata: Long video, polling job ${jobId}...`);

    // Poll for up to 2 minutes
    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 5000)); // Wait 5s between polls

      const jobResp = await fetch(`https://api.supadata.ai/v1/transcript/${jobId}`, {
        headers: { 'x-api-key': apiKey }
      });

      if (jobResp.status === 200) {
        const result = await jobResp.json();
        if (result.content) {
          return parseSupadataResponse(result);
        }
      } else if (jobResp.status === 404) {
        throw new Error('Supadata job expired or not found');
      }
      // Otherwise keep polling (202 = still processing)
      console.log(`  Supadata: Job still processing (attempt ${i + 1}/24)...`);
    }
    throw new Error('Supadata job timed out after 2 minutes');
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Supadata API returned ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  return parseSupadataResponse(data);
}

function parseSupadataResponse(data) {
  // If text mode was used, content is a string
  if (typeof data.content === 'string') {
    // Split into pseudo-segments
    const sentences = data.content.split(/[.!?]+\s+/).filter(s => s.trim());
    return sentences.map((text, i) => ({ offset: i * 5000, text: text.trim() }));
  }

  // Array mode: content is [{ text, offset, duration, lang }]
  if (!Array.isArray(data.content) || data.content.length === 0) {
    throw new Error('Supadata returned empty transcript');
  }

  const segments = data.content
    .filter(seg => seg.text && seg.text.trim())
    .map(seg => ({
      offset: seg.offset || 0,
      text: seg.text.trim()
    }));

  if (segments.length === 0) throw new Error('Supadata transcript had no text segments');
  console.log(`  Supadata: Got ${segments.length} transcript segments`);
  return segments;
}

// Helper: Fetch transcript using YouTube's InnerTube API (free fallback)
async function fetchTranscriptInnerTube(videoId) {
  console.log('  InnerTube: Fetching transcript for', videoId);

  // Use InnerTube player API directly to get caption tracks - no HTML scraping needed
  // This bypasses YouTube's bot detection on the video page
  const apiKey = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

  // Step 1: Get player data with caption tracks via InnerTube API
  console.log('  InnerTube: Calling player API');
  const playerResp = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': '2.20240101.00.00',
      'Origin': 'https://www.youtube.com',
      'Referer': 'https://www.youtube.com/',
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20240101.00.00',
          hl: 'en',
          gl: 'US',
        }
      },
      videoId: videoId
    })
  });

  if (!playerResp.ok) throw new Error(`InnerTube player API returned ${playerResp.status}`);
  const playerData = await playerResp.json();

  // Check for playability issues
  const playability = playerData?.playabilityStatus?.status;
  console.log('  InnerTube: Playability status:', playability);

  // Extract caption tracks from player response
  const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  console.log(`  InnerTube: Found ${captionTracks.length} caption tracks`);

  if (captionTracks.length > 0) {
    console.log('  Caption tracks:', captionTracks.map(t => `${t.languageCode}(${t.kind||'manual'})`).join(', '));

    // Prefer English auto-generated, then English manual, then any
    let track = captionTracks.find(t => (t.languageCode || '').startsWith('en') && t.kind === 'asr');
    if (!track) track = captionTracks.find(t => (t.languageCode || '').startsWith('en'));
    if (!track) track = captionTracks.find(t => t.kind === 'asr');
    if (!track) track = captionTracks[0];

    let subtitleUrl = track.baseUrl;
    if (!subtitleUrl) throw new Error('Caption track has no URL');

    console.log(`  Using track: ${track.languageCode} (${track.kind || 'manual'})`);

    // Try JSON3 format first (most structured)
    let segments = [];
    const json3Url = subtitleUrl + (subtitleUrl.includes('?') ? '&' : '?') + 'fmt=json3';
    console.log('  Fetching JSON3 captions...');
    try {
      const subResp = await fetch(json3Url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      if (subResp.ok) {
        const subText = await subResp.text();
        try {
          const json = JSON.parse(subText);
          const events = json.events || [];
          for (const event of events) {
            if (event.segs && event.tStartMs !== undefined) {
              const text = event.segs.map(s => s.utf8 || '').join('').trim();
              if (text && text !== '\n') {
                segments.push({ offset: event.tStartMs, text: text.replace(/\n/g, ' ') });
              }
            }
          }
        } catch(e) {
          console.log('  JSON3 parse failed, trying XML in same response...');
          // Response might be XML
          const textMatches = subText.matchAll(/<text start="([\d.]+)"[^>]*>(.*?)<\/text>/g);
          for (const m of textMatches) {
            const startMs = Math.round(parseFloat(m[1]) * 1000);
            const text = m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
            if (text) segments.push({ offset: startMs, text });
          }
        }
      }
    } catch(e) {
      console.log('  JSON3 fetch error:', e.message);
    }

    // Fall back to plain XML subtitle URL
    if (segments.length === 0) {
      console.log('  Trying XML captions...');
      try {
        const xmlResp = await fetch(subtitleUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        if (xmlResp.ok) {
          const xmlText = await xmlResp.text();
          const textMatches = xmlText.matchAll(/<text start="([\d.]+)"[^>]*>(.*?)<\/text>/g);
          for (const m of textMatches) {
            const startMs = Math.round(parseFloat(m[1]) * 1000);
            const text = m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
            if (text) segments.push({ offset: startMs, text });
          }
        }
      } catch(e) {
        console.log('  XML fetch error:', e.message);
      }
    }

    if (segments.length > 0) {
      console.log(`  InnerTube: Got ${segments.length} transcript segments from caption tracks`);
      return segments;
    }
  }

  // Step 2: Try the get_transcript endpoint (for engagement panel transcript)
  // First need to get the page to find the continuation token
  console.log('  InnerTube: Caption tracks empty, trying page scraping for transcript panel...');
  const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const pageResp = await fetch(pageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }
  });

  if (!pageResp.ok) throw new Error(`YouTube page returned ${pageResp.status}`);
  const pageHtml = await pageResp.text();
  console.log(`  InnerTube: Got page HTML (${pageHtml.length} bytes)`);

  // Also try to extract caption tracks from HTML as fallback
  let htmlCaptionTracks;
  const startIdx = pageHtml.indexOf('"captionTracks":');
  if (startIdx !== -1) {
    const arrStart = pageHtml.indexOf('[', startIdx);
    if (arrStart !== -1 && arrStart < startIdx + 30) {
      let depth = 0, arrEnd = arrStart;
      for (let i = arrStart; i < pageHtml.length && i < arrStart + 100000; i++) {
        if (pageHtml[i] === '[') depth++;
        if (pageHtml[i] === ']') depth--;
        if (depth === 0) { arrEnd = i + 1; break; }
      }
      try {
        htmlCaptionTracks = JSON.parse(pageHtml.substring(arrStart, arrEnd));
        console.log(`  Found ${htmlCaptionTracks.length} caption tracks in HTML`);
      } catch(e) {
        console.log('  captionTracks parse error:', e.message);
      }
    }
  }

  // Try fetching from HTML caption tracks
  if (htmlCaptionTracks && htmlCaptionTracks.length > 0) {
    let track = htmlCaptionTracks.find(t => (t.languageCode || '').startsWith('en'));
    if (!track) track = htmlCaptionTracks.find(t => t.kind === 'asr');
    if (!track) track = htmlCaptionTracks[0];

    let subtitleUrl = track.baseUrl;
    if (subtitleUrl) {
      let segments = [];
      const json3Url = subtitleUrl + (subtitleUrl.includes('?') ? '&' : '?') + 'fmt=json3';
      try {
        const subResp = await fetch(json3Url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        if (subResp.ok) {
          const subText = await subResp.text();
          try {
            const json = JSON.parse(subText);
            for (const event of (json.events || [])) {
              if (event.segs && event.tStartMs !== undefined) {
                const text = event.segs.map(s => s.utf8 || '').join('').trim();
                if (text && text !== '\n') {
                  segments.push({ offset: event.tStartMs, text: text.replace(/\n/g, ' ') });
                }
              }
            }
          } catch(e) {
            const textMatches = subText.matchAll(/<text start="([\d.]+)"[^>]*>(.*?)<\/text>/g);
            for (const m of textMatches) {
              const startMs = Math.round(parseFloat(m[1]) * 1000);
              const text = m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
              if (text) segments.push({ offset: startMs, text });
            }
          }
        }
      } catch(e) {
        console.log('  HTML caption fetch error:', e.message);
      }

      if (segments.length > 0) {
        console.log(`  InnerTube/HTML captions: Got ${segments.length} transcript segments`);
        return segments;
      }
    }
  }

  // Try transcript panel continuation token
  let continuationToken = null;
  const engagementIdx = pageHtml.indexOf('"engagementPanels"');
  if (engagementIdx !== -1) {
    const searchArea = pageHtml.substring(engagementIdx, engagementIdx + 50000);
    const contMatch = searchArea.match(/"continuation"\s*:\s*"([^"]+)"[^}]*?"label"\s*:\s*"[^"]*[Tt]ranscript/);
    if (!contMatch) {
      const altMatch = searchArea.match(/Show transcript.*?"continuation"\s*:\s*"([^"]+)"/s);
      if (altMatch) continuationToken = altMatch[1];
    } else {
      continuationToken = contMatch[1];
    }
  }

  if (!continuationToken) {
    const allConts = pageHtml.matchAll(/"continuation"\s*:\s*"([^"]{50,})"/g);
    for (const m of allConts) {
      if (m[1].length > 100) {
        continuationToken = m[1];
        break;
      }
    }
  }

  if (continuationToken) {
    console.log('  InnerTube: Found continuation token, fetching transcript panel');
    const transcriptResp = await fetch(`https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20240101.00.00',
            hl: 'en',
            gl: 'US',
          }
        },
        params: continuationToken
      })
    });

    if (transcriptResp.ok) {
      const data = await transcriptResp.json();
      const segments = [];
      const body = data?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.body?.transcriptBodyRenderer?.cueGroups ||
                   data?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments ||
                   [];

      for (const group of body) {
        const cue = group?.transcriptCueGroupRenderer?.cues?.[0]?.transcriptCueRenderer;
        if (cue) {
          const startMs = parseInt(cue.startOffsetMs || '0');
          const text = cue.cue?.simpleText || cue.cue?.runs?.map(r => r.text).join('') || '';
          if (text.trim()) {
            segments.push({ offset: startMs, text: text.trim() });
          }
        }
      }

      if (segments.length > 0) {
        console.log(`  InnerTube: Got ${segments.length} transcript segments from panel`);
        return segments;
      }
    }
  }

  throw new Error('InnerTube: No transcript available from any method');
}

// Helper: Fetch transcript directly from YouTube's timedtext API (legacy)
async function fetchTranscriptDirect(videoId) {
  console.log('  Fetching transcript directly from YouTube for:', videoId);

  // Step 1: Fetch the video page to get caption track URLs
  const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const pageResp = await fetch(pageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    }
  });

  if (!pageResp.ok) {
    throw new Error(`YouTube page returned ${pageResp.status}`);
  }

  const pageHtml = await pageResp.text();

  // Step 2: Extract caption tracks using bracket-counting (most reliable)
  let captionTracks;
  const startIdx = pageHtml.indexOf('"captionTracks":');
  if (startIdx !== -1) {
    const arrStart = pageHtml.indexOf('[', startIdx);
    if (arrStart !== -1 && arrStart < startIdx + 30) {
      let depth = 0, arrEnd = arrStart;
      for (let i = arrStart; i < pageHtml.length && i < arrStart + 100000; i++) {
        if (pageHtml[i] === '[') depth++;
        if (pageHtml[i] === ']') depth--;
        if (depth === 0) { arrEnd = i + 1; break; }
      }
      try {
        captionTracks = JSON.parse(pageHtml.substring(arrStart, arrEnd));
      } catch(e) {
        console.log('  captionTracks parse error:', e.message, 'raw:', pageHtml.substring(arrStart, arrStart + 200));
        throw new Error('Failed to parse captionTracks JSON: ' + e.message);
      }
    }
  }

  if (!captionTracks || captionTracks.length === 0) {
    // Check if video page has playability status
    const playMatch = pageHtml.match(/"playabilityStatus":\s*\{[^}]*"status"\s*:\s*"([^"]+)"/);
    const reason = playMatch ? playMatch[1] : 'unknown';
    throw new Error(`No caption tracks found (playability: ${reason}, pageLen: ${pageHtml.length})`);
  }

  console.log(`  Found ${captionTracks.length} caption tracks:`, captionTracks.map(t => `${t.languageCode}(${t.kind||'manual'})`).join(', '));

  // Step 3: Prefer English, fall back to first available
  let track = captionTracks.find(t => (t.languageCode || '').startsWith('en'));
  if (!track) {
    track = captionTracks.find(t => t.kind === 'asr');
  }
  if (!track) {
    track = captionTracks[0];
  }

  console.log(`  Using caption track: ${track.languageCode} (${track.kind || 'manual'})`);

  // Step 4: Fetch the subtitle content
  let subtitleUrl = track.baseUrl;
  if (!subtitleUrl) {
    throw new Error('Caption track has no URL');
  }

  // Request JSON3 format for easier parsing
  subtitleUrl += (subtitleUrl.includes('?') ? '&' : '?') + 'fmt=json3';

  const subResp = await fetch(subtitleUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    }
  });

  if (!subResp.ok) {
    throw new Error(`Subtitle fetch returned ${subResp.status}`);
  }

  const subText = await subResp.text();
  let segments = [];

  try {
    // Try JSON3 format
    const json = JSON.parse(subText);
    const events = json.events || [];
    for (const event of events) {
      if (event.segs && event.tStartMs !== undefined) {
        const text = event.segs.map(s => s.utf8 || '').join('').trim();
        if (text && text !== '\n') {
          segments.push({ offset: event.tStartMs, text: text.replace(/\n/g, ' ') });
        }
      }
    }
    // If json3 parsed but events were empty, check for different json structure
    if (segments.length === 0 && json.actions) {
      // Some videos use actions instead of events
      for (const action of json.actions) {
        if (action.updateEngagementPanelAction) continue;
        const body = action.appendContinuationItemsAction?.continuationItems || [];
        for (const item of body) {
          const text = item?.transcriptSegmentRenderer?.snippet?.runs?.map(r => r.text).join('') || '';
          const startMs = parseInt(item?.transcriptSegmentRenderer?.startMs || '0');
          if (text.trim()) {
            segments.push({ offset: startMs, text: text.trim() });
          }
        }
      }
    }
  } catch (jsonErr) {
    // Fall back to XML parsing
    console.log('  JSON parse failed, trying XML. First 200 chars:', subText.slice(0, 200));
    const textMatches = subText.matchAll(/<text start="([\d.]+)"[^>]*>(.*?)<\/text>/g);
    for (const m of textMatches) {
      const startMs = Math.round(parseFloat(m[1]) * 1000);
      const text = m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
      if (text) {
        segments.push({ offset: startMs, text });
      }
    }
  }

  if (segments.length === 0) {
    // Try fetching without fmt=json3 (get XML instead)
    const xmlUrl = subtitleUrl.replace('&fmt=json3', '').replace('?fmt=json3', '');
    console.log('  JSON3 was empty, trying XML format');
    const xmlResp = await fetch(xmlUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (xmlResp.ok) {
      const xmlText = await xmlResp.text();
      const textMatches = xmlText.matchAll(/<text start="([\d.]+)"[^>]*>(.*?)<\/text>/g);
      for (const m of textMatches) {
        const startMs = Math.round(parseFloat(m[1]) * 1000);
        const text = m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
        if (text) {
          segments.push({ offset: startMs, text });
        }
      }
    }
  }

  if (segments.length === 0) {
    throw new Error('Parsed transcript was empty');
  }

  console.log(`  Direct fetch got ${segments.length} transcript segments`);
  return segments;
}

// Helper: Run a single yt-dlp subtitle attempt with given args
function tryYtdlpSubtitles(videoId, args, tmpDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args);
    let stderr = '';
    proc.stdout.on('data', (data) => { console.log('  yt-dlp subs:', data.toString().trim()); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    proc.on('close', (code) => {
      // Find any subtitle file for this video
      try {
        const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(videoId) && !f.endsWith('.mp4'));
        if (files.length > 0) {
          resolve(path.join(tmpDir, files[0]));
        } else {
          console.log(`  yt-dlp attempt found no files (code ${code}). stderr: ${stderr.slice(-300)}`);
          resolve(null);
        }
      } catch(e) { resolve(null); }
    });
    proc.on('error', (err) => { resolve(null); });
  });
}

// Helper: Parse subtitle file content into segments
function parseSubtitleFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  let segments = [];

  if (filePath.endsWith('.json3')) {
    const json = JSON.parse(content);
    const events = json.events || [];
    for (const event of events) {
      if (event.segs && event.tStartMs !== undefined) {
        const text = event.segs.map(s => s.utf8 || '').join('').trim();
        if (text && text !== '\n') {
          segments.push({ offset: event.tStartMs, text: text.replace(/\n/g, ' ') });
        }
      }
    }
  } else {
    // Parse VTT/SRT format
    const lines = content.split('\n');
    let currentTime = 0;
    for (const line of lines) {
      const timeMatch = line.match(/(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/);
      if (timeMatch) {
        currentTime = parseInt(timeMatch[1]) * 3600000 + parseInt(timeMatch[2]) * 60000 +
                     parseInt(timeMatch[3]) * 1000 + parseInt(timeMatch[4]);
      } else if (line.trim() && !line.includes('-->') && !line.match(/^\d+$/) && !line.startsWith('WEBVTT')) {
        segments.push({ offset: currentTime, text: line.trim().replace(/<[^>]*>/g, '') });
      }
    }
  }

  // Clean up
  try { fs.unlinkSync(filePath); } catch(e) {}
  return segments;
}

// Helper: Fetch transcript using yt-dlp with multiple fallback strategies
async function fetchTranscriptWithYtdlp(videoId) {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const tmpDir = path.join('/tmp', 'yt-subtitles');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const outTemplate = path.join(tmpDir, `${videoId}`);

  // Clean up any previous subtitle files for this video
  try {
    const existing = fs.readdirSync(tmpDir).filter(f => f.startsWith(videoId));
    existing.forEach(f => { try { fs.unlinkSync(path.join(tmpDir, f)); } catch(e) {} });
  } catch(e) {}

  const baseArgs = ['--skip-download', '--no-warnings', '--no-check-certificates', '-o', outTemplate, videoUrl];

  // Use extractor-args to try different YouTube player clients for better compatibility
  const extraArgs = ['--extractor-args', 'youtube:player_client=web,android'];

  // Strategy 1: English auto-generated + manual subs in json3 (wildcard for en variants)
  console.log('  Trying: English json3 subtitles (wildcard)');
  let subFile = await tryYtdlpSubtitles(videoId, [
    '--skip-download', '--no-warnings', '--no-check-certificates',
    ...extraArgs,
    '--write-auto-subs', '--write-subs', '--sub-langs', 'en.*,en', '--sub-format', 'json3',
    '-o', outTemplate, videoUrl
  ], tmpDir);

  // Strategy 2: English subs in vtt format (wildcard)
  if (!subFile) {
    console.log('  Trying: English vtt subtitles (wildcard)');
    subFile = await tryYtdlpSubtitles(videoId, [
      '--skip-download', '--no-warnings', '--no-check-certificates',
      ...extraArgs,
      '--write-auto-subs', '--write-subs', '--sub-langs', 'en.*,en', '--sub-format', 'vtt',
      '-o', outTemplate, videoUrl
    ], tmpDir);
  }

  // Strategy 3: Any language auto-generated subs (all languages)
  if (!subFile) {
    console.log('  Trying: Any language auto-generated subtitles');
    subFile = await tryYtdlpSubtitles(videoId, [
      '--skip-download', '--no-warnings', '--no-check-certificates',
      ...extraArgs,
      '--write-auto-subs', '--sub-langs', 'all', '--sub-format', 'json3',
      '-o', outTemplate, videoUrl
    ], tmpDir);
  }

  // Strategy 4: Any manual subs at all
  if (!subFile) {
    console.log('  Trying: Any manual subtitles');
    subFile = await tryYtdlpSubtitles(videoId, [
      '--skip-download', '--no-warnings', '--no-check-certificates',
      ...extraArgs,
      '--write-subs', '--sub-langs', 'all', '--sub-format', 'json3',
      '-o', outTemplate, videoUrl
    ], tmpDir);
  }

  if (!subFile) {
    throw new Error('No transcript available for this video. It may not have captions enabled.');
  }

  console.log('  Found subtitle file:', path.basename(subFile));
  const segments = parseSubtitleFile(subFile);

  if (segments.length === 0) {
    throw new Error('Transcript was empty.');
  }

  console.log(`  Got ${segments.length} transcript segments`);
  return segments;
}

// Helper: Strategy C - Use yt-dlp --dump-json to get subtitle URLs and fetch them
async function fetchTranscriptFromYtdlpJson(videoId) {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Get video info JSON which includes subtitle URLs
  const jsonStr = await new Promise((resolve, reject) => {
    let output = '';
    const proc = spawn('yt-dlp', [
      '--skip-download', '--dump-json', '--no-warnings', '--no-check-certificates',
      videoUrl
    ]);
    proc.stdout.on('data', (data) => { output += data.toString(); });
    proc.stderr.on('data', () => {});
    proc.on('close', (code) => {
      if (code === 0 && output.trim()) resolve(output.trim());
      else reject(new Error(`yt-dlp dump-json exited with code ${code}`));
    });
    proc.on('error', (err) => reject(err));
  });

  const info = JSON.parse(jsonStr);

  // Look for subtitles in automatic_captions or subtitles
  const allSubs = { ...(info.automatic_captions || {}), ...(info.subtitles || {}) };

  // Prefer English
  let subLang = Object.keys(allSubs).find(k => k.startsWith('en'));
  if (!subLang) subLang = Object.keys(allSubs)[0];

  if (!subLang || !allSubs[subLang] || allSubs[subLang].length === 0) {
    throw new Error('No subtitles found in video metadata');
  }

  console.log(`  Found subtitle language: ${subLang} with ${allSubs[subLang].length} formats`);

  // Prefer json3 format, then vtt, then srv3
  const formats = allSubs[subLang];
  let subEntry = formats.find(f => f.ext === 'json3');
  if (!subEntry) subEntry = formats.find(f => f.ext === 'vtt');
  if (!subEntry) subEntry = formats.find(f => f.ext === 'srv3');
  if (!subEntry) subEntry = formats[0];

  if (!subEntry || !subEntry.url) {
    throw new Error('No usable subtitle URL found');
  }

  console.log(`  Fetching subtitle format: ${subEntry.ext} from URL`);
  const subResp = await fetch(subEntry.url);
  if (!subResp.ok) throw new Error(`Subtitle fetch returned ${subResp.status}`);

  const subText = await subResp.text();
  let segments = [];

  if (subEntry.ext === 'json3') {
    const json = JSON.parse(subText);
    const events = json.events || [];
    for (const event of events) {
      if (event.segs && event.tStartMs !== undefined) {
        const text = event.segs.map(s => s.utf8 || '').join('').trim();
        if (text && text !== '\n') {
          segments.push({ offset: event.tStartMs, text: text.replace(/\n/g, ' ') });
        }
      }
    }
  } else {
    // Parse VTT/SRT format
    const lines = subText.split('\n');
    let currentTime = 0;
    for (const line of lines) {
      const timeMatch = line.match(/(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/);
      if (timeMatch) {
        currentTime = parseInt(timeMatch[1]) * 3600000 + parseInt(timeMatch[2]) * 60000 +
                     parseInt(timeMatch[3]) * 1000 + parseInt(timeMatch[4]);
      } else if (line.trim() && !line.includes('-->') && !line.match(/^\d+$/) && !line.startsWith('WEBVTT')) {
        const cleanText = line.trim().replace(/<[^>]*>/g, '');
        if (cleanText) segments.push({ offset: currentTime, text: cleanText });
      }
    }
  }

  if (segments.length === 0) throw new Error('Parsed transcript was empty');
  console.log(`  Strategy C got ${segments.length} transcript segments`);
  return segments;
}

// Helper: Fetch video title using yt-dlp
function fetchVideoTitle(videoId) {
  return new Promise((resolve) => {
    const proc = spawn('yt-dlp', [
      '--skip-download', '--print', 'title', '--no-warnings',
      `https://www.youtube.com/watch?v=${videoId}`
    ]);
    let title = '';
    proc.stdout.on('data', (data) => { title += data.toString(); });
    proc.on('close', () => { resolve(title.trim() || 'YouTube Video'); });
    proc.on('error', () => { resolve('YouTube Video'); });
  });
}

// Helper: Parse moment timestamp range (MM:SS-MM:SS format)
function parseTimeRange(rangeStr) {
  const [start, end] = rangeStr.split('-');
  const parseTime = (str) => {
    const [mins, secs] = str.split(':').map(Number);
    return mins * 60 + secs;
  };
  return { start: parseTime(start), end: parseTime(end) };
}

// GET / - Main Smart Shorts page
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = 12;
    const offset = 0;

    const analyses = await shortsOps.getByUserId(userId, limit, offset);

    // Parse moments JSON for each analysis
    for (const a of analyses) {
      if (a.moments && typeof a.moments === 'string') {
        try { a.moments = JSON.parse(a.moments); } catch (e) { a.moments = []; }
      }
    }

    const html = renderShortsPage(req.user, analyses);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    console.error('Error loading Smart Shorts page:', error);
    res.status(500).json({ error: 'Failed to load Smart Shorts' });
  }
});

// POST /analyze - Analyze YouTube video
router.post('/analyze', requireAuth, async (req, res) => {
  let sseStarted = false;

  try {
    const { videoUrl } = req.body;
    if (!videoUrl) {
      return res.status(400).json({ error: 'Video URL is required' });
    }

    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL. Please paste a valid YouTube video link.' });
    }

    // Check OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'AI service is not configured. Please contact support.' });
    }

    const userId = req.user.id;

    // Check for existing analysis of same video
    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
    try {
      const { pool } = require('../db/database');
      const existing = await pool.query(
        `SELECT id FROM smart_shorts WHERE user_id = $1 AND video_url LIKE $2 AND status = 'completed' LIMIT 1`,
        [userId, `%${videoId}%`]
      );
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: 'You have already analyzed this video. Check your analyses below.' });
      }
    } catch(e) {
      console.log('Duplicate check failed (non-fatal):', e.message);
    }

    // Set up Server-Sent Events
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    sseStarted = true;

    const sendUpdate = (data) => {
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (e) {
        console.error('Error writing SSE:', e);
      }
    };

    try {
      sendUpdate({ status: 'fetching_transcript', message: 'Fetching transcript...' });

      // Try multiple transcript sources with fallbacks
      let segments;

      // Strategy 1: Supadata.ai API (most reliable - paid service, bypasses YouTube blocking)
      if (process.env.SUPADATA_API_KEY) {
        try {
          console.log('  Strategy 1: Supadata.ai API');
          segments = await fetchTranscriptSupadata(videoId);
        } catch (supadataErr) {
          console.log('  Supadata fetch failed:', supadataErr.message);
          segments = null;
        }
      } else {
        console.log('  Strategy 1: Skipped (SUPADATA_API_KEY not set)');
      }

      // Strategy 2: InnerTube player API + captionTracks (free fallback)
      if (!segments || segments.length === 0) {
        sendUpdate({ status: 'fetching_transcript', message: 'Fetching transcript (trying alternate method)...' });
        try {
          console.log('  Strategy 2: InnerTube API');
          segments = await fetchTranscriptInnerTube(videoId);
        } catch (innerErr) {
          console.log('  InnerTube fetch failed:', innerErr.message);
        }
      }

      // Strategy 3: yt-dlp subtitle fetching (handles geo-restricted, etc)
      if (!segments || segments.length === 0) {
        sendUpdate({ status: 'fetching_transcript', message: 'Fetching transcript (trying another method)...' });
        try {
          console.log('  Strategy 3: yt-dlp subtitles');
          segments = await fetchTranscriptWithYtdlp(videoId);
        } catch (ytdlpErr) {
          console.error('  yt-dlp subtitle fetch failed:', ytdlpErr.message);
        }
      }

      // Strategy 4: yt-dlp --dump-json to get subtitle URLs, then fetch directly
      if (!segments || segments.length === 0) {
        sendUpdate({ status: 'fetching_transcript', message: 'Fetching transcript (trying final method)...' });
        try {
          console.log('  Strategy 4: yt-dlp dump-json for subtitle URLs');
          segments = await fetchTranscriptFromYtdlpJson(videoId);
        } catch (jsonErr) {
          console.error('  yt-dlp json strategy failed:', jsonErr.message);
        }
      }

      // Strategy 5: Legacy direct fetch (original method)
      if (!segments || segments.length === 0) {
        try {
          console.log('  Strategy 5: Legacy direct fetch');
          segments = await fetchTranscriptDirect(videoId);
        } catch (directErr) {
          console.log('  Legacy fetch failed:', directErr.message);
        }
      }

      if (!segments || segments.length === 0) {
        sendUpdate({ status: 'error', message: 'Could not fetch transcript. Make sure the video has captions/subtitles enabled.' });
        return res.end();
      }

      const transcriptText = buildTranscriptText(segments);

      // Fetch actual video title
      sendUpdate({ status: 'fetching_title', message: 'Getting video info...' });
      const videoTitle = await fetchVideoTitle(videoId);

      // Create initial record
      sendUpdate({ status: 'creating_record', message: 'Saving to database...' });
      const analysisId = await shortsOps.create(userId, videoUrl, videoTitle, transcriptText);

      // Update status
      await shortsOps.updateStatus(analysisId, 'analyzing');
      sendUpdate({ status: 'analyzing', message: 'Analyzing with AI to identify viral moments...' });

      // Call OpenAI to identify moments
      const systemPrompt = `You are an expert content strategist specializing in identifying viral short-form content moments from transcripts. Analyze the provided transcript and identify the top 5-8 most compelling, viral-worthy moments that would perform exceptionally well on TikTok, Instagram Reels, and YouTube Shorts.

For each moment, evaluate based on:
- Emotional hooks (inspiration, surprise, humor, controversy)
- Actionable insights and practical value
- Storytelling potential and narrative arcs
- Relatability and universal appeal
- Memorable quotes and quotable moments
- Visual potential and descriptive language
- Audience engagement probability

Return a JSON array of moments with this exact structure:
[
  {
    "title": "Brief descriptive title",
    "timeRange": "MM:SS-MM:SS",
    "description": "Why this moment is viral-worthy (2-3 sentences)",
    "script": "Exact transcript text for this moment",
    "hooks": ["Hook line 1", "Hook line 2", "Hook line 3"],
    "viralityScore": 85,
    "keyThemes": ["theme1", "theme2"],
    "suggestedCaptions": ["caption1", "caption2"],
    "suggestedHashtags": ["#hashtag1", "#hashtag2"],
    "emotion": "primary emotion (inspiration/humor/surprise/education/controversy)"
  }
]

Ensure all times are accurate to the transcript. Focus on moments that are 30-120 seconds long when extracted.`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Analyze this transcript:\n\n${transcriptText}` }
        ],
        temperature: 0.7,
        max_tokens: 3000
      });

      const momentText = response.choices[0].message.content;

      // Parse JSON response
      let moments = [];
      try {
        const jsonMatch = momentText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          moments = JSON.parse(jsonMatch[0]);
        }
      } catch (parseError) {
        console.error('Error parsing moments JSON:', parseError);
        moments = [];
      }

      // Save moments to database
      await shortsOps.updateMoments(analysisId, moments);
      await shortsOps.updateStatus(analysisId, 'completed');

      sendUpdate({
        status: 'completed',
        message: 'Analysis complete!',
        analysisId,
        moments
      });

      res.end();
    } catch (streamError) {
      console.error('Error during analysis stream:', streamError);
      sendUpdate({ status: 'error', message: streamError.message || 'Analysis failed unexpectedly.' });
      res.end();
    }
  } catch (error) {
    console.error('Error in analyze endpoint:', error);
    if (!sseStarted) {
      res.status(500).json({ error: error.message || 'Analysis failed. Please try again.' });
    } else {
      try {
        res.write(`data: ${JSON.stringify({ status: 'error', message: error.message || 'Analysis failed.' })}\n\n`);
        res.end();
      } catch (e) {
        res.end();
      }
    }
  }
});

// POST /generate - Generate platform-specific content
router.post('/generate', requireAuth, async (req, res) => {
  try {
    const { momentId, platforms, analysisId } = req.body;

    if (!momentId || !platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Fetch the analysis to get the moment details
    const analysis = await shortsOps.getById(analysisId);
    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    // Parse moments JSON if needed
    let moments = analysis.moments;
    if (typeof moments === 'string') {
      try { moments = JSON.parse(moments); } catch (e) { moments = []; }
    }

    const moment = (moments || []).find(m => m.timeRange === momentId);
    if (!moment) {
      return res.status(404).json({ error: 'Moment not found' });
    }

    // Generate content for each platform
    const generateForPlatform = async (platform) => {
      const platformPrompts = {
        tiktok: `Create a TikTok short optimized for maximum viral potential. The moment is: "${moment.script}"

        Generate a JSON object with:
        {
          "hook": "A captivating opening hook (max 10 words)",
          "script": "30-60 second short-form script",
          "caption": "TikTok caption with emojis",
          "hashtags": ["hashtag1", "hashtag2", "hashtag3"],
          "postingTips": "Best times and engagement tips",
          "soundSuggestion": "Suggested audio/music style"
        }`,

        instagram: `Create an Instagram Reel optimized for Reels algorithm. The moment is: "${moment.script}"

        Generate a JSON object with:
        {
          "hook": "Attention-grabbing opening (max 10 words)",
          "script": "30-60 second Reel script",
          "caption": "Instagram caption with relevant emojis and call-to-action",
          "hashtags": ["hashtag1", "hashtag2", "hashtag3"],
          "postingTips": "Engagement and reach tips",
          "musicSuggestion": "Audio/music recommendation"
        }`,

        shorts: `Create a YouTube Shorts script optimized for YouTube algorithm. The moment is: "${moment.script}"

        Generate a JSON object with:
        {
          "hook": "Compelling opening line (max 10 words)",
          "script": "45-60 second Shorts script",
          "caption": "YouTube description text",
          "hashtags": ["hashtag1", "hashtag2", "hashtag3"],
          "postingTips": "YouTube Shorts best practices",
          "thumbnailSuggestion": "Key frame description"
        }`,

        twitter: `Create a Twitter/X thread or single tweet for maximum engagement. The moment is: "${moment.script}"

        Generate a JSON object with:
          "hook": "Compelling opening (max 15 words)",
          "script": "Main tweet text or thread structure",
          "caption": "Follow-up engagement prompt",
          "hashtags": ["hashtag1", "hashtag2"],
          "postingTips": "Best times and engagement tactics",
          "threadStructure": "If thread, outline each tweet"
        }`,

        linkedin: `Create professional LinkedIn content that drives engagement. The moment is: "${moment.script}"

        Generate a JSON object with:
        {
          "hook": "Professional opening (max 15 words)",
          "script": "LinkedIn post (professional, insightful)",
          "caption": "Value proposition and call-to-action",
          "hashtags": ["hashtag1", "hashtag2", "hashtag3"],
          "postingTips": "LinkedIn engagement strategy",
          "callToAction": "Professional CTA"
        }`
      };

      const prompt = platformPrompts[platform] || platformPrompts.tiktok;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are an expert social media content creator. Generate platform-optimized content in valid JSON format only.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.8,
        max_tokens: 1000
      });

      const contentText = response.choices[0].message.content;
      let platformContent = {};

      try {
        const jsonMatch = contentText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          platformContent = JSON.parse(jsonMatch[0]);
        }
      } catch (parseError) {
        console.error(`Error parsing ${platform} content:`, parseError);
      }

      return { platform, ...platformContent };
    };

    // Generate for all requested platforms
    const generatedContent = await Promise.all(
      platforms.map(p => generateForPlatform(p))
    );

    res.json({ success: true, content: generatedContent });
  } catch (error) {
    console.error('Error generating content:', error);
    res.status(500).json({ error: 'Failed to generate content' });
  }
});

// GET /history - View past analyses
router.get('/history', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    const analyses = await shortsOps.getByUserId(userId, limit, offset);
    res.json({ analyses });
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// GET /api/:id - Get specific analysis
router.get('/api/:id', requireAuth, async (req, res) => {
  try {
    const analysis = await shortsOps.getById(req.params.id);
    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }
    if (analysis.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    // Parse moments JSON
    if (analysis.moments && typeof analysis.moments === 'string') {
      try { analysis.moments = JSON.parse(analysis.moments); } catch (e) { analysis.moments = []; }
    }
    res.json({ analysis });
  } catch (error) {
    console.error('Error fetching analysis:', error);
    res.status(500).json({ error: 'Failed to fetch analysis' });
  }
});

// DELETE /api/:id - Delete analysis
router.delete('/api/:id', requireAuth, async (req, res) => {
  try {
    const analysis = await shortsOps.getById(req.params.id);
    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }
    if (analysis.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    await shortsOps.delete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting analysis:', error);
    res.status(500).json({ error: 'Failed to delete analysis' });
  }
});

// POST /clip - Generate a video clip for a specific moment
router.post('/clip', requireAuth, async (req, res) => {
  try {
    if (!ytdl || !ffmpegAvailable) {
      return res.status(503).json({ error: 'Video clipping is not available on this server. ffmpeg or ytdl-core is missing.' });
    }

    const { analysisId, momentIndex } = req.body;

    if (!analysisId || momentIndex === undefined) {
      return res.status(400).json({ error: 'Analysis ID and moment index are required' });
    }

    const analysis = await shortsOps.getById(analysisId);
    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }
    if (analysis.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Parse moments
    let moments = analysis.moments;
    if (typeof moments === 'string') {
      try { moments = JSON.parse(moments); } catch (e) { moments = []; }
    }

    const moment = moments[momentIndex];
    if (!moment) {
      return res.status(404).json({ error: 'Moment not found' });
    }

    // Parse time range
    const rangeParts = (moment.timeRange || '').split('-');
    const parseTime = (str) => {
      const parts = (str || '').trim().split(':').map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return parts[0] || 0;
    };
    const startSec = parseTime(rangeParts[0]);
    const endSec = rangeParts[1] ? parseTime(rangeParts[1]) : startSec + 60;
    const duration = Math.max(endSec - startSec, 5); // At least 5 seconds

    // Extract video ID
    const videoId = extractVideoId(analysis.video_url);
    if (!videoId) {
      return res.status(400).json({ error: 'Invalid video URL in analysis' });
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const safeTitle = (moment.title || 'clip').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
    const filename = `${safeTitle}_${Date.now()}.mp4`;
    const outputPath = path.join(CLIPS_DIR, filename);
    const tempOutputPath = outputPath + '.encoding.mp4'; // Encode to temp file, rename when done

    // Send initial response
    res.json({
      success: true,
      status: 'processing',
      message: 'Generating clip...',
      filename
    });

    // Write progress to a file so the status endpoint can report it
    const progressPath = outputPath + '.progress';
    const writeProgress = (msg) => {
      try { fs.writeFileSync(progressPath, msg); } catch (e) {}
      console.log(`  [${filename}] ${msg}`);
    };
    const writeError = (msg) => {
      try { fs.unlinkSync(progressPath); } catch (e) {}
      try { fs.unlinkSync(outputPath); } catch (e) {}
      try { fs.writeFileSync(outputPath + '.error', msg); } catch (e) {}
      console.error(`  [${filename}] ERROR: ${msg}`);
    };

    // Helper: run a command with spawn (non-blocking, keeps event loop alive)
    const runCommand = (cmd, args, options = {}) => {
      return new Promise((resolve, reject) => {
        console.log(`  Running: ${cmd} ${args.slice(0, 3).join(' ')}...`);
        const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], ...options });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (data) => {
          stdout += data.toString();
          // Update progress for yt-dlp downloads
          const pctMatch = data.toString().match(/(\d+\.?\d*)%/);
          if (pctMatch) writeProgress(`Downloading: ${Math.round(parseFloat(pctMatch[1]))}%`);
        });
        proc.stderr.on('data', (data) => { stderr += data.toString(); });
        proc.on('error', (err) => reject(new Error(`Process error: ${err.message}`)));
        proc.on('close', (code) => {
          if (code === 0) resolve({ stdout, stderr });
          else reject(new Error(`Exit code ${code}: ${stderr.slice(-500)}`));
        });
        // Timeout: kill process after specified time
        if (options.timeout) {
          setTimeout(() => { try { proc.kill('SIGKILL'); } catch(e) {} }, options.timeout);
        }
      });
    };

    // Process in background (non-blocking - keeps event loop alive for health checks)
    (async () => {
      const timeout = setTimeout(() => {
        writeError('Clip generation timed out after 5 minutes. Try a moment closer to the start of the video.');
      }, 300000);

      try {
        writeProgress('Downloading video...');

        // Check if yt-dlp is available
        let ytdlpPath = 'yt-dlp';
        try { execSync('which yt-dlp', { stdio: 'pipe' }); } catch (e) {
          clearTimeout(timeout);
          writeError('yt-dlp is not installed on this server');
          return;
        }

        // === STEP 1: Download full video (non-blocking spawn) ===
        const tempDownload = outputPath + '.temp.mkv';
        try { fs.unlinkSync(tempDownload); } catch(e) {}

        console.log(`  Downloading video: start=${startSec}s, dur=${duration}s`);

        try {
          await runCommand(ytdlpPath, [
            '--no-playlist',
            '-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
            '--merge-output-format', 'mkv',
            '-o', tempDownload,
            '--no-warnings',
            '--no-check-certificates',
            '--no-part',
            '--force-overwrites',
            '--extractor-args', 'youtube:player_client=web,android',
            videoUrl
          ], { timeout: 240000 });
        } catch (dlErr) {
          clearTimeout(timeout);
          console.error('  yt-dlp failed:', dlErr.message);
          writeError('Video download failed. Please try again.');
          return;
        }

        // Find the actual downloaded file (yt-dlp may change extension)
        let actualDownload = tempDownload;
        if (!fs.existsSync(tempDownload)) {
          const base = outputPath + '.temp';
          for (const ext of ['.mkv', '.mp4', '.webm']) {
            if (fs.existsSync(base + ext)) { actualDownload = base + ext; break; }
          }
        }

        if (!fs.existsSync(actualDownload)) {
          clearTimeout(timeout);
          writeError('Downloaded file not found. Please try again.');
          return;
        }

        const dlSize = fs.statSync(actualDownload).size;
        console.log(`  Downloaded: ${(dlSize / 1024 / 1024).toFixed(1)}MB`);

        if (dlSize < 10000) {
          clearTimeout(timeout);
          console.error(`  Download too small: ${dlSize} bytes`);
          try { fs.unlinkSync(actualDownload); } catch(e) {}
          writeError('Video download was too small - the video may be unavailable.');
          return;
        }

        // === STEP 2: ffmpeg encode (non-blocking spawn) ===
        writeProgress('Creating vertical clip...');

        const ffmpegArgs = [
          '-y',
          '-ss', String(startSec),
          '-i', actualDownload,
          '-t', String(duration),
          '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1',
          '-c:v', 'libx264',
          '-profile:v', 'high',
          '-level', '4.0',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-ar', '44100',
          '-ac', '2',
          '-preset', 'fast',
          '-crf', '23',
          '-movflags', '+faststart',
          '-max_muxing_queue_size', '2048',
          tempOutputPath
        ];

        let ffmpegSuccess = false;
        try {
          await runCommand(ffmpegPath, ffmpegArgs, { timeout: 180000 });
          console.log('  ffmpeg completed successfully');
          ffmpegSuccess = true;
        } catch (ffErr) {
          console.error('  ffmpeg fast-seek failed:', ffErr.message);
          try { fs.unlinkSync(tempOutputPath); } catch(e) {}
        }

        // Retry with accurate seek if fast seek failed
        if (!ffmpegSuccess) {
          console.log('  Retrying with accurate seek (-ss after -i)...');
          writeProgress('Encoding (retry)...');

          const retryArgs = [
            '-y',
            '-i', actualDownload,
            '-ss', String(startSec),
            '-t', String(duration),
            '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1',
            '-c:v', 'libx264',
            '-profile:v', 'high',
            '-level', '4.0',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-ar', '44100',
            '-ac', '2',
            '-preset', 'fast',
            '-crf', '23',
            '-movflags', '+faststart',
            '-max_muxing_queue_size', '2048',
            tempOutputPath
          ];

          try {
            await runCommand(ffmpegPath, retryArgs, { timeout: 240000 });
            console.log('  ffmpeg retry succeeded');
            ffmpegSuccess = true;
          } catch (retryErr) {
            clearTimeout(timeout);
            console.error('  ffmpeg retry also failed:', retryErr.message);
            try { fs.unlinkSync(tempOutputPath); } catch(e) {}
            try { fs.unlinkSync(actualDownload); } catch(e) {}
            writeError('Video encoding failed. Please try again.');
            return;
          }
        }

        // Clean up downloaded video
        try { fs.unlinkSync(actualDownload); } catch(e) {}

        // === STEP 3: Validate output and atomically rename ===
        clearTimeout(timeout);

        if (!fs.existsSync(tempOutputPath)) {
          writeError('Video encoding produced no output. Please try again.');
          return;
        }

        const size = fs.statSync(tempOutputPath).size;
        console.log(`  Encoded output size: ${size} bytes (${(size / 1024 / 1024).toFixed(1)}MB)`);

        if (size < 50000) {
          console.error(`  Output too small: ${size} bytes`);
          try { fs.unlinkSync(tempOutputPath); } catch(e) {}
          writeError('Video encoding produced empty file. Please try again.');
          return;
        }

        // Validate MP4 header
        const fd = fs.openSync(tempOutputPath, 'r');
        const header = Buffer.alloc(12);
        fs.readSync(fd, header, 0, 12, 0);
        fs.closeSync(fd);
        const ftyp = header.toString('ascii', 4, 8);

        if (ftyp !== 'ftyp') {
          console.error(`  Invalid header: ftyp='${ftyp}'`);
          try { fs.unlinkSync(tempOutputPath); } catch(e) {}
          writeError('Video encoding produced invalid file. Please try again.');
          return;
        }

        // Atomic rename: move completed file to final path
        fs.renameSync(tempOutputPath, outputPath);
        // Remove progress file LAST to signal completion
        try { fs.unlinkSync(progressPath); } catch (e) {}
        console.log(`  Clip ready: ${filename} (${(size / 1024 / 1024).toFixed(1)}MB)`);

      } catch (err) {
        clearTimeout(timeout);
        writeError(`Clip generation failed: ${err.message}`);
      }
    })();

  } catch (error) {
    console.error('Error starting clip generation:', error);
    res.status(500).json({ error: 'Failed to start clip generation' });
  }
});

// GET /clip/status/:filename - Check if clip is ready
router.get('/clip/status/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename); // Prevent path traversal
  const filePath = path.join(CLIPS_DIR, filename);
  const errorPath = filePath + '.error';
  const progressPath = filePath + '.progress';

  // Check for error marker first
  if (fs.existsSync(errorPath)) {
    let errorMsg = 'Clip generation failed';
    try { errorMsg = fs.readFileSync(errorPath, 'utf8'); } catch (e) {}
    try { fs.unlinkSync(errorPath); } catch (e) {}
    return res.json({ ready: false, failed: true, message: errorMsg });
  }

  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    // Only report ready if: file has real content AND no progress file (encoding complete)
    const stillProcessing = fs.existsSync(progressPath);
    if (stats.size > 10000 && !stillProcessing) {
      res.json({ ready: true, size: stats.size, filename });
    } else if (stillProcessing) {
      let progressMsg = 'Still processing...';
      try { progressMsg = fs.readFileSync(progressPath, 'utf8') || progressMsg; } catch (e) {}
      res.json({ ready: false, message: progressMsg });
    } else {
      res.json({ ready: false, message: 'Finalizing...' });
    }
  } else {
    // Check for progress file
    let progressMsg = 'Still processing...';
    if (fs.existsSync(progressPath)) {
      try { progressMsg = fs.readFileSync(progressPath, 'utf8') || progressMsg; } catch (e) {}
    }
    res.json({ ready: false, message: progressMsg });
  }
});

// GET /clip/download/:filename - Download generated clip
// Supports Range requests for QuickTime/browser video player compatibility
router.get('/clip/download/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename); // Prevent path traversal
  const filePath = path.join(CLIPS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Clip not found. It may still be processing or has expired.' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  // Support Range requests (required by QuickTime and most video players)
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = (end - start) + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4',
    });

    const stream = fs.createReadStream(filePath, { start, end });
    stream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);

    // Clean up file after full download (with delay to allow stream to finish)
    stream.on('end', () => {
      setTimeout(() => {
        try { fs.unlinkSync(filePath); } catch (e) {}
      }, 30000); // 30s delay to allow re-downloads
    });
  }
});

// Main page renderer
function renderShortsPage(user, analyses) {
  const platformColors = {
    tiktok: '#ff0050',
    instagram: 'linear-gradient(135deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)',
    shorts: '#ff0000',
    twitter: '#000000',
    linkedin: '#0077b5'
  };

  const platformIcons = {
    tiktok: 'âª',
    instagram: 'ð·',
    shorts: 'â¶ï¸',
    twitter: 'ð',
    linkedin: 'in'
  };

  return `${getHeadHTML('Smart Shorts')}
  <style>
    ${getBaseCSS()}

    /* Shorts-specific styles */
    .main-content {
      margin-left: 250px;
      padding: 40px;
    }

    .header {
      margin-bottom: 40px;
    }

    .header-title {
      font-size: 32px;
      font-weight: 700;
      margin-bottom: 8px;
    }

    .header-subtitle {
      font-size: 16px;
      color: var(--text-muted);
    }

    /* Cards */
    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 24px;
      margin-top: 24px;
    }

    .card {
      background: var(--surface-light);
      border: var(--border-subtle);
      border-radius: 12px;
      padding: 24px;
      backdrop-filter: blur(10px);
      transition: all 0.3s ease;
      cursor: pointer;
    }

    .card:hover {
      border-color: var(--primary);
      transform: translateY(-4px);
      box-shadow: 0 8px 24px rgba(108, 92, 231, 0.2);
    }

    .card-header {
      margin-bottom: 16px;
    }

    .card-title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .card-meta {
      font-size: 13px;
      color: var(--text-dim);
    }

    .moments-list {
      margin-top: 16px;
    }

    .moment-item {
      background: var(--dark);
      border-left: 3px solid var(--primary);
      padding: 12px;
      margin-bottom: 8px;
      border-radius: 4px;
      font-size: 13px;
    }

    .moment-item-title {
      font-weight: 600;
      margin-bottom: 4px;
    }

    .virality-score {
      display: inline-block;
      background: var(--gradient-1);
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      margin-top: 4px;
      color: #fff;
    }

    .empty-state {
      text-align: center;
      padding: 60px 40px;
      color: var(--text-dim);
    }

    .empty-state-icon {
      font-size: 64px;
      margin-bottom: 16px;
    }

    .empty-state-title {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 8px;
      color: var(--text);
    }

    .empty-state-text {
      font-size: 14px;
      margin-bottom: 24px;
    }

    /* Upload Section */
    .upload-section {
      background: rgba(108, 58, 237, 0.05);
      border: 2px dashed var(--primary);
      border-radius: 12px;
      padding: 32px;
      text-align: center;
      margin-bottom: 40px;
    }

    .upload-input-group {
      display: flex;
      gap: 12px;
      margin-top: 16px;
    }

    .upload-input {
      flex: 1;
      background: var(--surface);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 12px 16px;
      color: var(--text);
      font-size: 14px;
    }

    .upload-input::placeholder {
      color: var(--text-dim);
    }

    .btn-primary {
      background: var(--gradient-1);
      color: #fff;
    }

    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(108, 58, 237, 0.4);
    }

    .btn-primary:active {
      transform: translateY(0);
    }

    .btn-small {
      padding: 8px 16px;
      font-size: 12px;
    }

    .loading {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255, 255, 255, 0.2);
      border-top: 2px solid #fff;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: var(--surface-light);
      border: var(--border-subtle);
      color: var(--text);
      padding: 16px 20px;
      border-radius: 8px;
      font-size: 14px;
      display: block !important;
      animation: slideUp 0.3s ease;
      z-index: 10000;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }

    @keyframes slideUp {
      from {
        transform: translateY(100px);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }

    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      z-index: 200;
      align-items: center;
      justify-content: center;
    }

    .modal.active {
      display: flex;
    }

    .modal-content {
      background: var(--surface);
      border: var(--border-subtle);
      border-radius: 12px;
      padding: 32px;
      max-width: 800px;
      max-height: 85vh;
      overflow-y: auto;
      width: 95%;
    }

    .moment-video-wrap {
      position: relative;
      width: 100%;
      max-height: 180px;
      margin-bottom: 12px;
      border-radius: 8px;
      overflow: hidden;
      background: #000;
    }

    .moment-video-wrap img {
      width: 100%;
      max-height: 180px;
      object-fit: cover;
      border: none;
      border-radius: 8px;
    }

    .modal-header {
      margin-bottom: 24px;
    }

    .modal-title {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 8px;
    }

    .modal-close {
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(0,0,0,0.6);
      border: 2px solid rgba(255,255,255,0.3);
      color: #fff;
      font-size: 28px;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1002;
      transition: background 0.2s;
    }
    .modal-close:hover {
      background: rgba(255,0,0,0.6);
    }

    .platform-selector {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }

    .platform-badge {
      padding: 12px 16px;
      border: 2px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      text-align: center;
      cursor: pointer;
      transition: all 0.3s ease;
      font-size: 13px;
      font-weight: 600;
      background: var(--surface-light);
      color: var(--text);
    }

    .platform-badge.selected {
      border-color: var(--primary);
      background: rgba(108, 58, 237, 0.1);
    }

    .moment-card {
      background: var(--dark);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 12px;
      cursor: pointer;
      transition: all 0.3s ease;
    }

    .moment-card:hover {
      border-color: var(--primary);
      background: rgba(108, 58, 237, 0.05);
    }

    .moment-card.selected {
      border-color: var(--primary-light);
      background: rgba(108, 58, 237, 0.15);
    }

    .moment-card-header {
      display: flex;
      justify-content: space-between;
      align-items: start;
      margin-bottom: 8px;
    }

    .moment-card-title {
      font-weight: 600;
      font-size: 14px;
      color: var(--text);
    }

    .moment-score {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--gradient-1);
      font-weight: 700;
      font-size: 12px;
      color: #fff;
    }

    .moment-card-time {
      font-size: 12px;
      color: var(--text-dim);
      margin-bottom: 8px;
    }

    .moment-card-desc {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.5;
    }

    /* Responsive */
    @media (max-width: 768px) {
      .sidebar {
        transform: translateX(-100%);
        transition: transform 0.3s ease;
      }

      .sidebar.open {
        transform: translateX(0);
      }

      .main-content {
        margin-left: 0;
        padding: 24px;
      }

      .cards-grid {
        grid-template-columns: 1fr;
      }

      .header-title {
        font-size: 24px;
      }

      .upload-input-group {
        flex-direction: column;
      }
    }
  </style>
</head>
<body class="dashboard">
  ${getThemeToggle()}
  ${getSidebar('shorts')}

  <!-- Main content -->
  <main class="main-content">
      <div class="header">
        <h1 class="header-title">Smart Shorts</h1>
        <p class="header-subtitle">Transform any YouTube video into viral short-form content</p>
      </div>

      <!-- Upload section -->
      <div class="upload-section">
        <div style="margin-bottom: 16px;">
          <h3 style="margin-bottom: 8px;">Analyze a YouTube Video</h3>
          <p style="color: #888; font-size: 14px;">Paste a YouTube URL to extract viral moments</p>
        </div>
        <div class="upload-input-group">
          <input
            type="text"
            class="upload-input"
            id="videoUrl"
            placeholder="https://youtube.com/watch?v=..."
          >
          <button class="btn btn-primary" onclick="analyzeVideo()">
            <span id="analyzeBtn">Analyze</span>
          </button>
        </div>
      </div>

      <!-- Analyses grid -->
      <div id="analysesContainer">
        ${analyses.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">&#x2702;&#xFE0F;</div>
            <h3 class="empty-state-title">No analyses yet</h3>
            <p class="empty-state-text">Paste a YouTube URL above to get started</p>
          </div>
        ` : `
          <div class="cards-grid">
            ${analyses.map(analysis => {
              // Extract video ID for thumbnail
              const ytRegex = new RegExp('(?:youtube\\.com/watch\\\\?v=|youtu\\.be/|youtube\\.com/embed/)([a-zA-Z0-9_-]{11})');
              const vidMatch = (analysis.video_url || '').match(ytRegex);
              const vidId = vidMatch ? vidMatch[1] : null;
              return `
              <div class="card" onclick="viewAnalysis('${analysis.id}')" style="position:relative;">
                <button onclick="event.stopPropagation(); deleteAnalysis('${analysis.id}', this)" title="Delete"
                  style="position:absolute; top:8px; right:8px; background:rgba(0,0,0,0.5); border:none; color:#ff6b6b;
                  width:32px; height:32px; border-radius:50%; cursor:pointer; font-size:16px; display:flex;
                  align-items:center; justify-content:center; z-index:2; transition:background 0.2s;"
                  onmouseover="this.style.background='rgba(255,0,0,0.6)'; this.style.color='#fff'"
                  onmouseout="this.style.background='rgba(0,0,0,0.5)'; this.style.color='#ff6b6b'"
                >&times;</button>
                ${vidId ? `<img src="https://img.youtube.com/vi/${vidId}/mqdefault.jpg" alt="Video thumbnail" style="width:100%;border-radius:8px;margin-bottom:12px;aspect-ratio:16/9;object-fit:cover;">` : ''}
                <div class="card-header">
                  <div class="card-title">${analysis.video_title || 'YouTube Video'}</div>
                  <div class="card-meta">${new Date(analysis.created_at).toLocaleDateString()}</div>
                </div>
                <div class="card-meta" style="margin-bottom: 12px;">${analysis.status === 'completed' ? analysis.moments?.length || 0 : 0} moments</div>
                <div class="moments-list">
                  ${(analysis.moments || []).slice(0, 3).map((moment, idx) => `
                    <div class="moment-item">
                      <div class="moment-item-title">${moment.title || 'Moment'}</div>
                      <div class="virality-score">${moment.viralityScore || 0}% viral</div>
                    </div>
                  `).join('')}
                  ${(analysis.moments?.length || 0) > 3 ? '<div style="padding: 8px 0; color: #666; font-size: 12px;">+' + ((analysis.moments?.length || 0) - 3) + ' more</div>' : ''}
                </div>
              </div>
            `}).join('')}
          </div>
        `}
      </div>
    </main>

  <!-- Modal for viewing analysis -->
  <div class="modal" id="analysisModal">
    <div class="modal-content">
      <button class="modal-close" onclick="closeModal()" title="Close">&times;</button>
      <div id="modalBody"></div>
    </div>
  </div>

  <script>
    // Enter key triggers analyze (attached immediately since script is at end of body)
    (function() {
      var urlInput = document.getElementById('videoUrl');
      if (urlInput) {
        urlInput.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            analyzeVideo();
          }
        });
        urlInput.addEventListener('keypress', function(e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            analyzeVideo();
          }
        });
      }
    })();

    async function analyzeVideo() {
      const url = document.getElementById('videoUrl').value.trim();
      if (!url) {
        showToast('Please enter a YouTube URL');
        return;
      }

      const btn = document.querySelector('.btn-primary');
      const btnText = document.getElementById('analyzeBtn');
      btn.disabled = true;
      btnText.innerHTML = '<span class="loading"></span> Analyzing...';

      try {
        const response = await fetch('/shorts/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl: url })
        });

        // If response is JSON (error before SSE started), handle it
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await response.json();
          throw new Error(data.error || 'Analysis failed');
        }

        if (!response.ok) {
          throw new Error('Analysis failed. Please try again.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split('\\n');
          // Keep the last (potentially incomplete) line in the buffer
          sseBuffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              let data;
              try {
                data = JSON.parse(trimmed.slice(6));
              } catch (parseErr) {
                console.log('SSE parse skip:', trimmed.slice(0, 100));
                continue;
              }
              if (data.status === 'completed') {
                showToast('Analysis complete!');
                setTimeout(() => location.reload(), 1500);
              } else if (data.status === 'error') {
                throw new Error(data.message || 'Analysis failed');
              } else if (data.message) {
                btnText.textContent = data.message;
              }
            }
          }
        }

        // If we get here without completing, reset the button
        btn.disabled = false;
        btnText.textContent = 'Analyze';
      } catch (error) {
        showToast(error.message || 'Analysis failed');
        btn.disabled = false;
        btnText.textContent = 'Analyze';
      }
    }

    function getVideoId(url) {
      if (!url) return null;
      const patterns = [
        /(?:youtube\\.com\\/watch\\?v=|youtu\\.be\\/|youtube\\.com\\/embed\\/)([a-zA-Z0-9_-]{11})/,
        /^([a-zA-Z0-9_-]{11})$/
      ];
      for (const p of patterns) {
        const m = url.match(p);
        if (m) return m[1];
      }
      return null;
    }

    function timeToSeconds(timeStr) {
      if (!timeStr) return 0;
      const parts = timeStr.split(':').map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return parts[0] || 0;
    }

    async function viewAnalysis(id) {
      try {
        const response = await fetch('/shorts/api/' + id);
        const data = await response.json();
        const analysis = data.analysis;
        const videoId = getVideoId(analysis.video_url);

        const html = \`
          <div class="modal-header">
            <h2 class="modal-title">\${analysis.video_title || 'Analysis'}</h2>
            <p style="color: #888; margin-top: 8px;">\${analysis.moments?.length || 0} viral moments found</p>
          </div>
          <div id="momentsContainer"></div>
        \`;

        document.getElementById('modalBody').innerHTML = html;

        const container = document.getElementById('momentsContainer');
        (analysis.moments || []).forEach((moment, idx) => {
          const card = document.createElement('div');
          card.className = 'moment-card';

          // Parse time range for video embed
          const rangeParts = (moment.timeRange || '').split('-');
          const startSec = timeToSeconds(rangeParts[0]);
          const endSec = rangeParts[1] ? timeToSeconds(rangeParts[1]) : startSec + 60;

          // Build clickable thumbnail preview (iframes fail when embedding is disabled)
          const videoEmbed = videoId ? \`
            <a href="https://youtube.com/watch?v=\${videoId}&t=\${startSec}" target="_blank" style="display:block; position:relative; text-decoration:none; height:120px; overflow:hidden; border-radius:8px; margin-bottom:12px; background:#000;">
              <img src="https://img.youtube.com/vi/\${videoId}/mqdefault.jpg" alt="Video thumbnail"
                style="width:100%; height:120px; object-fit:cover; display:block;" loading="lazy" />
              <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
                width:44px; height:44px; background:rgba(0,0,0,0.7); border-radius:50%;
                display:flex; align-items:center; justify-content:center;">
                <div style="width:0; height:0; border-left:16px solid #fff; border-top:10px solid transparent;
                  border-bottom:10px solid transparent; margin-left:3px;"></div>
              </div>
              <div style="position:absolute; bottom:6px; left:6px; background:rgba(0,0,0,0.8);
                padding:2px 6px; border-radius:4px; color:#fff; font-size:11px;">
                \${moment.timeRange}
              </div>
            </a>
          \` : '';

          card.innerHTML = \`
            <div class="moment-card-header">
              <div style="flex: 1;">
                <div class="moment-card-title">\${moment.title}</div>
                <div class="moment-card-time">\${moment.timeRange} (\${endSec - startSec}s clip)</div>
              </div>
              <div class="moment-score">\${moment.viralityScore}%</div>
            </div>
            \${videoEmbed}
            <div class="moment-card-desc">\${moment.description}</div>
            <div style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap;">
              <button class="btn btn-small btn-primary" onclick="generateContent('\${id}', '\${moment.timeRange}')">
                Generate Content
              </button>
              <button class="btn btn-small" id="clip-btn-\${idx}"
                style="background: linear-gradient(135deg, #FF0050 0%, #FF4500 100%); color: #fff;"
                onclick="downloadClip('\${id}', \${idx}, this)">
                Download Clip
              </button>
              \${videoId ? \`<a href="https://youtube.com/watch?v=\${videoId}&t=\${startSec}" target="_blank"
                class="btn btn-small" style="background: rgba(255,255,255,0.1); color: var(--text-muted); text-decoration: none;">
                Open on YouTube
              </a>\` : ''}
            </div>
          \`;
          card.onclick = (e) => {
            if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'A' && e.target.tagName !== 'IFRAME') {
              card.classList.toggle('selected');
            }
          };
          container.appendChild(card);
        });

        document.getElementById('analysisModal').classList.add('active');
      } catch (error) {
        showToast('Error loading analysis: ' + error.message);
      }
    }

    async function generateContent(analysisId, momentId) {
      const platforms = ['tiktok', 'instagram', 'shorts', 'twitter', 'linkedin'];

      showToast('Generating content for all platforms...');

      try {
        const response = await fetch('/shorts/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            momentId,
            analysisId,
            platforms
          })
        });

        const data = await response.json();
        if (data.success) {
          showGeneratedContent(data.content);
        }
      } catch (error) {
        showToast('Error: ' + error.message);
      }
    }

    function showGeneratedContent(content) {
      const html = \`
        <div class="modal-header">
          <h2 class="modal-title">Generated Content</h2>
        </div>
        <div style="max-height: 400px; overflow-y: auto;">
          \${content.map(item => \`
            <div style="margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid #222;">
              <h4 style="text-transform: capitalize; margin-bottom: 12px; color: #6c5ce7;">\${item.platform}</h4>
              <div style="background: #0a0a0a; padding: 12px; border-radius: 8px; margin-bottom: 8px;">
                <div style="font-size: 12px; color: #888; margin-bottom: 4px;">Hook:</div>
                <div style="font-size: 14px;">\${item.hook || 'N/A'}</div>
              </div>
              <div style="background: #0a0a0a; padding: 12px; border-radius: 8px; margin-bottom: 8px;">
                <div style="font-size: 12px; color: #888; margin-bottom: 4px;">Script:</div>
                <div style="font-size: 13px; line-height: 1.6;">\${(item.script || 'N/A').substring(0, 200)}...</div>
              </div>
              <div style="background: #0a0a0a; padding: 12px; border-radius: 8px;">
                <div style="font-size: 12px; color: #888; margin-bottom: 4px;">Hashtags:</div>
                <div style="font-size: 13px;">\${(item.hashtags || []).join(' ')}</div>
              </div>
            </div>
          \`).join('')}
        </div>
      \`;
      document.getElementById('modalBody').innerHTML = html;
    }

    async function downloadClip(analysisId, momentIndex, btn) {
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Starting...';

      try {
        // Request clip generation
        const response = await fetch('/shorts/clip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ analysisId, momentIndex })
        });

        const data = await response.json();
        if (!data.success) {
          throw new Error(data.error || 'Failed to start clip generation');
        }

        const filename = data.filename;
        btn.textContent = 'Processing...';
        btn.style.background = 'rgba(255,255,255,0.15)';

        // Poll for clip readiness
        let attempts = 0;
        const maxAttempts = 150; // 5 minutes max
        const pollInterval = setInterval(async () => {
          attempts++;
          try {
            const statusResp = await fetch('/shorts/clip/status/' + filename);
            const statusData = await statusResp.json();

            if (statusData.failed) {
              clearInterval(pollInterval);
              throw new Error(statusData.message || 'Clip generation failed');
            } else if (statusData.ready) {
              clearInterval(pollInterval);
              btn.textContent = 'Downloading...';

              // Trigger download
              const link = document.createElement('a');
              link.href = '/shorts/clip/download/' + filename;
              link.download = filename;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);

              setTimeout(() => {
                btn.disabled = false;
                btn.textContent = 'Download Clip';
                btn.style.background = 'linear-gradient(135deg, #FF0050 0%, #FF4500 100%)';
              }, 2000);

              showToast('Clip downloaded!');
            } else if (attempts >= maxAttempts) {
              clearInterval(pollInterval);
              throw new Error('Clip generation timed out');
            } else {
              // Update progress with server message
              const msg = statusData.message || '';
              if (msg.startsWith('Encoding:')) {
                btn.textContent = msg;
              } else if (msg !== 'Still processing...') {
                btn.textContent = msg.substring(0, 30);
              } else {
                const dots = '.'.repeat((attempts % 3) + 1);
                btn.textContent = 'Processing' + dots;
              }
            }
          } catch (pollError) {
            clearInterval(pollInterval);
            throw pollError;
          }
        }, 2000);

      } catch (error) {
        showToast(error.message || 'Failed to generate clip');
        btn.disabled = false;
        btn.textContent = originalText;
        btn.style.background = 'linear-gradient(135deg, #FF0050 0%, #FF4500 100%)';
      }
    }

    function closeModal() {
      document.getElementById('analysisModal').classList.remove('active');
    }

    // Close modal when clicking the backdrop (outside the content)
    document.getElementById('analysisModal').addEventListener('click', function(e) {
      if (e.target === this) closeModal();
    });

    async function deleteAnalysis(id, btn) {
      if (!confirm('Delete this analysis? This cannot be undone.')) return;
      try {
        const resp = await fetch('/shorts/api/' + id, { method: 'DELETE' });
        const data = await resp.json();
        if (data.success) {
          // Remove the card from the DOM
          const card = btn.closest('.card');
          if (card) {
            card.style.transition = 'opacity 0.3s, transform 0.3s';
            card.style.opacity = '0';
            card.style.transform = 'scale(0.9)';
            setTimeout(() => card.remove(), 300);
          }
          showToast('Analysis deleted');
        } else {
          showToast(data.error || 'Failed to delete');
        }
      } catch (err) {
        showToast('Error: ' + err.message);
      }
    }

    function showToast(message) {
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.textContent = message;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });

    ${getThemeScript()}
  </script>
</body>
</html>`;
}

module.exports = router;
