const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const OpenAI = require('openai');
const archiver = require('archiver');
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
const { shortsOps, brandKitOps, calendarOps } = require('../db/database');
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

// Helper: Format timestamp in seconds to HH:MM:SS.mmm (with millisecond precision)
function formatTimestamp(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return [hrs, mins, secs].map(x => String(x).padStart(2, '0')).join(':') + '.' + String(ms).padStart(3, '0');
}

// Helper: Combine transcript segments into text with timestamps
function buildTranscriptText(segments) {
  return segments.map(seg => {
    const timestamp = formatTimestamp(seg.offset / 1000);
    return `[${timestamp}] ${seg.text}`;
  }).join(' ');
}

// Helper: Parse stored transcript text back into timed segments
// Transcript format: "[HH:MM:SS.mmm] text" or legacy "[HH:MM:SS] text"
function parseTranscriptToSegments(transcriptText) {
  const segments = [];
  const regex = /\[(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\]\s*(.*?)(?=\s*\[\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?\]|$)/g;
  let match;
  while ((match = regex.exec(transcriptText)) !== null) {
    const [, timestamp, text] = match;
    // Split "HH:MM:SS" or "HH:MM:SS.mmm"
    const [timePart, msPart] = timestamp.split('.');
    const parts = timePart.split(':').map(Number);
    const ms = msPart ? parseInt(msPart.padEnd(3, '0')) / 1000 : 0;
    const offsetSec = parts[0] * 3600 + parts[1] * 60 + parts[2] + ms;
    if (text.trim()) {
      segments.push({ offsetSec, text: text.trim() });
    }
  }
  return segments;
}

// Helper: Generate ASS subtitle file for burned-in captions
// Style: TikTok/Reels style - bold white text, black outline, centered in lower third
function generateASSSubtitles(segments, clipStartSec, clipDuration) {
  const clipEndSec = clipStartSec + clipDuration;

  // Filter segments that fall within the clip time range
  const clipSegments = segments.filter(seg =>
    seg.offsetSec >= clipStartSec && seg.offsetSec < clipEndSec
  );

  if (clipSegments.length === 0) return null;

  // ASS header with TikTok-style formatting
  // PlayResX/Y: 1080x1920 (9:16 vertical)
  // Font: Bold, large, white with black outline, positioned in lower third
  const assHeader = `[Script Info]
Title: Auto Captions
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Liberation Sans,72,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,0,2,40,40,180,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  // Generate dialogue lines
  const dialogueLines = [];

  for (let i = 0; i < clipSegments.length; i++) {
    const seg = clipSegments[i];
    // Time relative to clip start
    const relStart = seg.offsetSec - clipStartSec;

    // End time: next segment start, or +3 seconds, whichever is smaller
    let relEnd;
    if (i + 1 < clipSegments.length) {
      relEnd = Math.min(clipSegments[i + 1].offsetSec - clipStartSec, relStart + 4);
    } else {
      relEnd = Math.min(relStart + 4, clipDuration);
    }

    // Clamp to clip duration
    if (relEnd > clipDuration) relEnd = clipDuration;
    if (relStart >= clipDuration) continue;

    // Format as H:MM:SS.cc (ASS time format)
    const formatASSTime = (sec) => {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = Math.floor(sec % 60);
      const cs = Math.round((sec % 1) * 100);
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
    };

    // Break long text into max ~6 words per line for readability
    const words = seg.text.split(/\s+/);
    const lines = [];
    for (let w = 0; w < words.length; w += 6) {
      lines.push(words.slice(w, w + 6).join(' '));
    }
    // Use \N for line breaks in ASS, uppercase the text for TikTok style
    const displayText = lines.join('\\N').toUpperCase();

    dialogueLines.push(
      `Dialogue: 0,${formatASSTime(relStart)},${formatASSTime(relEnd)},Default,,0,0,0,,${displayText}`
    );
  }

  if (dialogueLines.length === 0) return null;

  return assHeader + '\n' + dialogueLines.join('\n') + '\n';
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
    "emotion": "primary emotion (inspiration/humor/surprise/education/controversy)",
    "platforms": ["tiktok", "instagram", "shorts"],
    "platformScores": { "tiktok": 90, "instagram": 80, "shorts": 85, "twitter": 70, "linkedin": 60 }
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
        }`,

        blog: `Write a compelling blog post based on this video moment: "${moment.script}"
        Video title: "${analysis.video_title || 'Untitled'}"

        Generate a JSON object with:
        {
          "title": "SEO-optimized blog post title",
          "hook": "Attention-grabbing opening paragraph (2-3 sentences)",
          "script": "Full blog post body (500-800 words, well-structured with subheadings marked with ##). Write in an engaging, conversational tone. Include insights, examples, and actionable takeaways.",
          "caption": "Meta description for SEO (150-160 chars)",
          "hashtags": ["keyword1", "keyword2", "keyword3"],
          "postingTips": "SEO and distribution tips",
          "outline": "Brief outline of the post structure"
        }`,

        newsletter: `Create an engaging email newsletter section based on this video moment: "${moment.script}"
        Video title: "${analysis.video_title || 'Untitled'}"

        Generate a JSON object with:
        {
          "title": "Compelling email subject line",
          "hook": "Preview text / opening hook (1-2 sentences)",
          "script": "Full newsletter body (300-500 words). Write in a personal, conversational tone. Include a story angle, key insights, and a clear call-to-action. Format with short paragraphs.",
          "caption": "Preview text for email",
          "hashtags": ["topic1", "topic2"],
          "postingTips": "Email timing and segmentation tips",
          "callToAction": "Clear CTA with link placeholder"
        }`,

        thread: `Create a viral Twitter/X thread (5-8 tweets) based on this video moment: "${moment.script}"
        Video title: "${analysis.video_title || 'Untitled'}"

        Generate a JSON object with:
        {
          "hook": "Thread opener tweet - must be curiosity-inducing (max 280 chars)",
          "script": "Tweet 2 through 7, separated by \\n\\n---\\n\\n between each tweet. Each tweet must be under 280 characters. Build narrative tension. End with a call-to-action tweet.",
          "caption": "Quote tweet text for sharing the thread",
          "hashtags": ["hashtag1", "hashtag2"],
          "postingTips": "Thread posting strategy (timing, replies, engagement)",
          "threadStructure": "Numbered outline of each tweet's purpose"
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

// GET /brand-kit - Get user's brand kit settings
router.get('/brand-kit', requireAuth, async (req, res) => {
  try {
    const kit = await brandKitOps.getByUserId(req.user.id);
    res.json({ success: true, brandKit: kit || {} });
  } catch (error) {
    console.error('Error fetching brand kit:', error);
    res.status(500).json({ error: 'Failed to fetch brand kit' });
  }
});

// POST /brand-kit - Save user's brand kit settings
router.post('/brand-kit', requireAuth, async (req, res) => {
  try {
    const { brandName, watermarkText, primaryColor, secondaryColor, fontStyle } = req.body;
    const kit = await brandKitOps.upsert(req.user.id, {
      brandName, watermarkText, primaryColor, secondaryColor, fontStyle
    });
    res.json({ success: true, brandKit: kit });
  } catch (error) {
    console.error('Error saving brand kit:', error);
    res.status(500).json({ error: 'Failed to save brand kit' });
  }
});

// POST /batch-analyze - Analyze multiple YouTube videos
router.post('/batch-analyze', requireAuth, async (req, res) => {
  try {
    const { videoUrls } = req.body;
    if (!videoUrls || !Array.isArray(videoUrls) || videoUrls.length === 0) {
      return res.status(400).json({ error: 'Provide an array of video URLs' });
    }
    if (videoUrls.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 videos per batch' });
    }

    // Validate all URLs first
    const validUrls = [];
    for (const url of videoUrls) {
      const vid = extractVideoId(url.trim());
      if (vid) validUrls.push({ url: url.trim(), videoId: vid });
    }
    if (validUrls.length === 0) {
      return res.status(400).json({ error: 'No valid YouTube URLs found' });
    }

    // Return immediately with batch ID, process in background
    const batchId = require('uuid').v4();
    res.json({ success: true, batchId, totalVideos: validUrls.length, message: `Processing ${validUrls.length} videos...` });

    // Process each video sequentially in background
    (async () => {
      const results = [];
      for (let i = 0; i < validUrls.length; i++) {
        const { url, videoId } = validUrls[i];
        try {
          // Simulate the analyze endpoint logic inline
          const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

          // Fetch transcript
          let transcript = null;
          try {
            // Try Supadata
            if (process.env.SUPADATA_API_KEY) {
              const supResp = await fetch(`https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(videoUrl)}&lang=en`, {
                headers: { 'x-api-key': process.env.SUPADATA_API_KEY }
              });
              if (supResp.ok) {
                const supData = await supResp.json();
                if (supData.content && supData.content.length > 0) {
                  transcript = supData.content.map(s => `[${formatTimestamp(s.offset / 1000)}] ${s.text}`).join(' ');
                }
              }
            }
          } catch (e) { console.log(`  Batch: transcript failed for ${videoId}:`, e.message); }

          // Get video title
          let videoTitle = 'Video ' + (i + 1);
          try {
            const pageResp = await fetch(`https://www.youtube.com/oembed?url=${videoUrl}&format=json`);
            if (pageResp.ok) {
              const oembed = await pageResp.json();
              videoTitle = oembed.title || videoTitle;
            }
          } catch (e) {}

          // Use AI to find moments
          const promptText = transcript
            ? `Analyze this YouTube video transcript and find the top 3-5 most viral-worthy moments.\n\nTranscript:\n${transcript.substring(0, 4000)}`
            : `Analyze this YouTube video (ID: ${videoId}, Title: ${videoTitle}) and suggest 3-5 potential viral moments based on the title.`;

          const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'You are a viral content analyst. Return a JSON array of moments with: title, timeRange (HH:MM:SS-HH:MM:SS), description, viralityScore (0-100), keyThemes (array), platforms (array).' },
              { role: 'user', content: promptText }
            ],
            response_format: { type: 'json_object' }
          });

          let moments = [];
          try {
            const parsed = JSON.parse(completion.choices[0].message.content);
            moments = parsed.moments || parsed.clips || parsed.results || [];
          } catch (e) {}

          // Save to DB
          const analysis = await shortsOps.create({
            userId: req.user.id,
            videoUrl,
            videoTitle,
            transcript: transcript || '',
            moments,
            status: 'completed'
          });

          results.push({ videoId, title: videoTitle, analysisId: analysis.id, momentCount: moments.length, status: 'completed' });
          console.log(`  Batch [${i+1}/${validUrls.length}]: ${videoTitle} - ${moments.length} moments`);
        } catch (err) {
          console.error(`  Batch [${i+1}] failed:`, err.message);
          results.push({ videoId, status: 'failed', error: err.message });
        }
      }
      // Store batch results in a temp file
      try {
        fs.writeFileSync(path.join(CLIPS_DIR, `batch_${batchId}.json`), JSON.stringify(results));
      } catch (e) {}
    })();

  } catch (error) {
    console.error('Batch analyze error:', error);
    res.status(500).json({ error: 'Batch analysis failed' });
  }
});

// GET /batch-status/:batchId - Check batch progress
router.get('/batch-status/:batchId', requireAuth, (req, res) => {
  const batchId = req.params.batchId.replace(/[^a-f0-9-]/g, '');
  const resultPath = path.join(CLIPS_DIR, `batch_${batchId}.json`);
  if (fs.existsSync(resultPath)) {
    const results = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    res.json({ complete: true, results });
  } else {
    res.json({ complete: false, message: 'Still processing...' });
  }
});

// Helper for timestamp formatting (with millisecond precision)
// Note: primary formatTimestamp is defined at top of file, this is kept for backward compat
function formatTimestampCompat(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const ms = Math.round((totalSeconds % 1) * 1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
}

// GET /export/:analysisId - Export all clips from an analysis as ZIP
router.get('/export/:analysisId', requireAuth, async (req, res) => {
  try {
    const analysis = await shortsOps.getById(req.params.analysisId);
    if (!analysis || analysis.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    // Find all clip files for this analysis
    const analysisId = req.params.analysisId;
    const analysisTag = `a${analysisId}`;
    const files = fs.readdirSync(CLIPS_DIR);
    const clipFiles = files.filter(f => f.endsWith('.mp4') && !f.includes('.encoding') && !f.includes('.temp'));
    const thumbFiles = files.filter(f => f.endsWith('.jpg') && f.startsWith('thumb_'));

    // First try to match clips by analysis ID tag in filename
    let matchedClips = clipFiles.filter(f => f.includes(analysisTag));
    let matchedThumbs = thumbFiles.filter(f => f.includes(analysisTag));

    // Fallback: if no tagged clips found, use recent clips (within last 24 hours) for backward compat
    if (matchedClips.length === 0 && matchedThumbs.length === 0) {
      const oneDayAgo = Date.now() - 86400000;
      matchedClips = clipFiles.filter(f => {
        try {
          const stat = fs.statSync(path.join(CLIPS_DIR, f));
          return stat.mtimeMs > oneDayAgo && stat.size > 50000;
        } catch (e) { return false; }
      });
      matchedThumbs = thumbFiles.filter(f => {
        try {
          const stat = fs.statSync(path.join(CLIPS_DIR, f));
          return stat.mtimeMs > oneDayAgo && stat.size > 1000;
        } catch (e) { return false; }
      });
    }

    if (matchedClips.length === 0 && matchedThumbs.length === 0) {
      return res.status(404).json({ error: 'No clips found. Clips are cleared on server updates — please download clips individually after generating them, or generate and export in the same session.' });
    }

    const safeTitle = (analysis.video_title || 'export').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
    const zipFilename = `${safeTitle}_export_${Date.now()}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.on('error', (err) => { console.error('Archive error:', err); res.status(500).end(); });
    archive.pipe(res);

    // Add clips
    for (const clip of matchedClips) {
      archive.file(path.join(CLIPS_DIR, clip), { name: `clips/${clip}` });
    }
    // Add thumbnails
    for (const thumb of matchedThumbs) {
      archive.file(path.join(CLIPS_DIR, thumb), { name: `thumbnails/${thumb}` });
    }

    // Add content summary JSON
    const summary = {
      videoTitle: analysis.video_title,
      videoUrl: analysis.video_url,
      exportDate: new Date().toISOString(),
      clips: matchedClips.length,
      thumbnails: matchedThumbs.length,
      moments: analysis.moments
    };
    archive.append(JSON.stringify(summary, null, 2), { name: 'summary.json' });

    await archive.finalize();

  } catch (error) {
    console.error('Export error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Export failed' });
  }
});

// POST /virality-analysis - Get detailed virality breakdown for a moment
router.post('/virality-analysis', requireAuth, async (req, res) => {
  try {
    const { analysisId, momentIndex } = req.body;
    const analysis = await shortsOps.getById(analysisId);
    if (!analysis || analysis.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not found or unauthorized' });
    }

    let moments = analysis.moments;
    if (typeof moments === 'string') {
      try { moments = JSON.parse(moments); } catch (e) { moments = []; }
    }
    const moment = moments[momentIndex];
    if (!moment) return res.status(404).json({ error: 'Moment not found' });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `You are a viral content expert. Analyze this moment and return a JSON object with:
          - hookStrength (0-100): How strong the opening hook is
          - emotionalImpact (0-100): Emotional resonance score
          - shareability (0-100): How likely people are to share
          - trendAlignment (0-100): How aligned with current trends
          - audienceReach (0-100): Potential audience size
          - boostTips (array of 3-5 strings): Specific actionable tips to increase virality
          - bestTimeToPost (string): Best time/day to post this content
          - targetAudience (string): Description of ideal target audience
          - predictedViews (string): Estimated view range (e.g. "10K-50K")` },
        { role: 'user', content: `Analyze this moment for virality:\nTitle: ${moment.title}\nDescription: ${moment.description}\nScore: ${moment.viralityScore}%\nThemes: ${(moment.keyThemes || []).join(', ')}\nPlatforms: ${(moment.platforms || []).join(', ')}` }
      ],
      response_format: { type: 'json_object' }
    });

    let breakdown = {};
    try {
      breakdown = JSON.parse(completion.choices[0].message.content);
    } catch (e) {
      breakdown = { error: 'Could not parse analysis' };
    }

    res.json({ success: true, breakdown });
  } catch (error) {
    console.error('Virality analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze virality' });
  }
});

// POST /broll-suggestions - AI-powered auto B-Roll scene selector
router.post('/broll-suggestions', requireAuth, async (req, res) => {
  try {
    const { analysisId, momentIndex } = req.body;
    const analysis = await shortsOps.getById(analysisId);
    if (!analysis || analysis.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not found or unauthorized' });
    }

    let moments = analysis.moments;
    if (typeof moments === 'string') {
      try { moments = JSON.parse(moments); } catch (e) { moments = []; }
    }
    const moment = moments[momentIndex];
    if (!moment) return res.status(404).json({ error: 'Moment not found' });

    // Use AI to analyze the moment script and pick specific B-Roll scenes
    let scenes = [];
    if (process.env.OPENAI_API_KEY) {
      try {
        const scenePrompt = `You are a professional video editor. Analyze this short-form video moment and suggest exactly 3-5 specific B-Roll scenes that would visually enhance the content. For each scene, pick the BEST visual that matches what is being discussed.

Moment Title: ${moment.title}
Script/Transcript: ${moment.script || moment.description || ''}
Key Themes: ${(moment.keyThemes || []).join(', ')}
Emotion: ${moment.emotion || 'educational'}

For each B-Roll scene, return:
- "timestamp_hint": approximate point in the moment where this B-Roll should appear (e.g. "beginning", "middle", "end", "0:15")
- "scene_description": what the viewer should see (1 sentence)
- "search_query": the BEST 2-4 word Pexels search query to find this exact footage. Be VERY specific — use concrete nouns and actions, NOT abstract concepts. For example: "person typing laptop" not "productivity", "cash register payment" not "business", "doctor stethoscope" not "health". Pexels works best with literal visual descriptions.
- "why": brief reason this visual fits (1 sentence)

Return a JSON array:
[
  {
    "timestamp_hint": "beginning",
    "scene_description": "Close-up of hands typing on a laptop keyboard",
    "search_query": "typing laptop closeup",
    "why": "Shows the work being discussed in the opening"
  }
]

IMPORTANT RULES:
- Pick visuals that DIRECTLY relate to what is being said at each point
- Use CONCRETE, LITERAL search terms — describe what the camera would see
- Avoid abstract/generic terms like "success", "motivation", "growth", "business"
- Prefer close-up and medium shots over wide/aerial shots for short-form content
- Think about what a human video editor would actually cut to`;

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: scenePrompt }
          ],
          temperature: 0.7,
          max_tokens: 1000
        });

        const sceneText = completion.choices[0].message.content;
        try {
          const jsonMatch = sceneText.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            scenes = JSON.parse(jsonMatch[0]);
          }
        } catch (e) {
          console.error('Error parsing AI scenes:', e.message);
        }
      } catch (aiErr) {
        console.error('AI scene analysis error:', aiErr.message);
      }
    }

    // Fallback if AI didn't produce scenes
    if (scenes.length === 0) {
      const keywords = (moment.keyThemes || []).slice(0, 3);
      const fallbackQueries = keywords.length > 0 ? keywords : [moment.title.split(' ').slice(0, 3).join(' ')];
      scenes = fallbackQueries.map((q, i) => ({
        timestamp_hint: i === 0 ? 'beginning' : i === 1 ? 'middle' : 'end',
        scene_description: 'Stock footage related to: ' + q,
        search_query: q,
        why: 'Matches the key theme of the moment'
      }));
    }

    // Fetch best matching video from Pexels for each scene
    const pexelsKey = process.env.PEXELS_API_KEY;
    const autoSelectedScenes = [];

    for (const scene of scenes) {
      const sceneResult = {
        ...scene,
        video: null,
        alternatives: [],
        searchUrl: `https://www.pexels.com/search/videos/${encodeURIComponent(scene.search_query)}/`
      };

      if (pexelsKey) {
        try {
          const pxResp = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(scene.search_query)}&per_page=8&orientation=portrait`, {
            headers: { 'Authorization': pexelsKey }
          });
          if (pxResp.ok) {
            const pxData = await pxResp.json();
            const videos = (pxData.videos || []).map(v => {
              // Prefer HD files, sorted by quality (hd first, then sd)
              const allFiles = (v.video_files || [])
                .filter(f => f.quality === 'hd' || f.quality === 'sd')
                .sort((a, b) => (b.quality === 'hd' ? 1 : 0) - (a.quality === 'hd' ? 1 : 0));
              return {
                id: v.id,
                duration: v.duration,
                thumbnail: v.image,
                url: v.url,
                videoFiles: allFiles.slice(0, 2)
                  .map(f => ({ quality: f.quality, link: f.link, width: f.width, height: f.height })),
                user: v.user ? v.user.name : 'Pexels'
              };
            });

            // Auto-select the best (first) result
            if (videos.length > 0) {
              sceneResult.video = videos[0];
              sceneResult.alternatives = videos.slice(1, 4);
            }
          }
        } catch (e) {
          console.error('Pexels API error for scene:', scene.search_query, e.message);
        }
      }

      autoSelectedScenes.push(sceneResult);
    }

    const hasPexels = !!pexelsKey;
    res.json({
      success: true,
      autoMode: true,
      scenes: autoSelectedScenes,
      message: hasPexels ? null : 'Add PEXELS_API_KEY for auto video previews. Browse Pexels links for now.'
    });
  } catch (error) {
    console.error('B-Roll suggestions error:', error);
    res.status(500).json({ error: 'Failed to get B-Roll suggestions' });
  }
});

// === Content Calendar API ===
router.get('/calendar', requireAuth, async (req, res) => {
  try {
    const { start, end } = req.query;
    const startDate = start || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const endDate = end || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0];
    const entries = await calendarOps.getByUserId(req.user.id, startDate, endDate);
    res.json({ success: true, entries });
  } catch (error) {
    console.error('Calendar fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch calendar' });
  }
});

router.post('/calendar', requireAuth, async (req, res) => {
  try {
    const { title, platform, scheduledDate, scheduledTime, contentText, analysisId, momentIndex, notes, color, reminderEmail, reminderMinutes } = req.body;
    if (!title || !scheduledDate) return res.status(400).json({ error: 'Title and date required' });
    const entry = await calendarOps.create({
      userId: req.user.id, title, platform, scheduledDate, scheduledTime, contentText, analysisId, momentIndex, notes, color,
      reminderEmail: reminderEmail || '', reminderMinutes: reminderMinutes || 0
    });
    res.json({ success: true, entry });
  } catch (error) {
    console.error('Calendar create error:', error);
    res.status(500).json({ error: 'Failed to create calendar entry' });
  }
});

router.put('/calendar/:id', requireAuth, async (req, res) => {
  try {
    const entry = await calendarOps.update(req.params.id, req.user.id, req.body);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    res.json({ success: true, entry });
  } catch (error) {
    console.error('Calendar update error:', error);
    res.status(500).json({ error: 'Failed to update entry' });
  }
});

router.delete('/calendar/:id', requireAuth, async (req, res) => {
  try {
    await calendarOps.delete(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Calendar delete error:', error);
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

// POST /thumbnail - Generate a thumbnail for a moment
router.post('/thumbnail', requireAuth, async (req, res) => {
  try {
    if (!ffmpegAvailable) {
      return res.status(503).json({ error: 'ffmpeg is not available on this server.' });
    }

    const { analysisId, momentIndex, style, titleText, titleColor, bgColor, fontSize } = req.body;

    const analysis = await shortsOps.getById(analysisId);
    if (!analysis || analysis.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not found or unauthorized' });
    }

    let moments = analysis.moments;
    if (typeof moments === 'string') {
      try { moments = JSON.parse(moments); } catch (e) { moments = []; }
    }
    const moment = moments[momentIndex];
    if (!moment) return res.status(404).json({ error: 'Moment not found' });

    const videoId = extractVideoId(analysis.video_url);
    if (!videoId) return res.status(400).json({ error: 'Invalid video URL' });

    // Fetch brand kit for colors
    let brandKit = null;
    try { brandKit = await brandKitOps.getByUserId(req.user.id); } catch (e) {}

    const thumbTitle = (titleText || moment.title || 'Viral Moment').substring(0, 60);
    const thumbColor = titleColor || (brandKit && brandKit.primary_color) || '#FFFFFF';
    const thumbBg = bgColor || '#000000';
    const thumbFontSize = fontSize || 72;
    const thumbStyle = style || 'gradient';
    const thumbAnalysisTag = `a${req.body.analysisId || 'unknown'}`;
    const filename = `thumb_${thumbAnalysisTag}_${Date.now()}.jpg`;
    const outputPath = path.join(CLIPS_DIR, filename);

    // Parse time to get a frame
    const rangeParts = (moment.timeRange || '').split('-');
    const parseTime = (str) => {
      const parts = (str || '').trim().split(':').map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return parts[0] || 0;
    };
    const startSec = parseTime(rangeParts[0]);
    // Use a point slightly into the moment for a better frame
    const frameSec = startSec + 2;

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    res.json({ success: true, status: 'processing', filename });

    // Background processing
    (async () => {
      try {
        // Download a short segment for frame extraction
        const tempVideo = outputPath + '.temp.mkv';
        try { fs.unlinkSync(tempVideo); } catch(e) {}

        // Try to download just a few seconds
        let ytdlpPath = 'yt-dlp';
        try { execSync('which yt-dlp', { stdio: 'pipe' }); } catch (e) {
          // If yt-dlp not available, use YouTube thumbnail API as fallback
          console.log('  yt-dlp not available for thumbnail, using YouTube API thumbnail');
          // Generate thumbnail from YouTube's static image
          const https = require('https');
          const thumbUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
          const tempImg = outputPath + '.temp.jpg';

          await new Promise((resolve, reject) => {
            const file = fs.createWriteStream(tempImg);
            https.get(thumbUrl, (response) => {
              if (response.statusCode === 200) {
                response.pipe(file);
                file.on('finish', () => { file.close(); resolve(); });
              } else {
                // Fallback to mqdefault
                https.get(`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`, (r2) => {
                  r2.pipe(file);
                  file.on('finish', () => { file.close(); resolve(); });
                });
              }
            }).on('error', reject);
          });

          // Apply text overlay to downloaded thumbnail
          await applyThumbnailOverlay(tempImg, outputPath, thumbTitle, thumbColor, thumbBg, thumbFontSize, thumbStyle, brandKit);
          try { fs.unlinkSync(tempImg); } catch(e) {}
          return;
        }

        // Download video segment
        const runCmd = (cmd, args, opts = {}) => {
          return new Promise((resolve, reject) => {
            const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
            let stdout = '', stderr = '';
            let settled = false;
            const settle = (fn, val) => { if (!settled) { settled = true; clearTimeout(timer); fn(val); } };
            proc.stdout.on('data', d => stdout += d.toString());
            proc.stderr.on('data', d => stderr += d.toString());
            proc.on('error', e => settle(reject, e));
            proc.on('close', code => code === 0 ? settle(resolve, { stdout, stderr }) : settle(reject, new Error(stderr.slice(-300))));
            const timer = opts.timeout ? setTimeout(() => { try { proc.kill('SIGKILL'); } catch(e) {} settle(reject, new Error('timeout')); }, opts.timeout) : null;
          });
        };

        try {
          await runCmd(ytdlpPath, [
            '--no-playlist', '-f', 'bestvideo[height<=1080]/best[height<=1080]/best',
            '--merge-output-format', 'mkv', '-o', tempVideo,
            '--no-warnings', '--no-check-certificates', '--no-part', '--force-overwrites',
            '--extractor-args', 'youtube:player_client=web,android',
            '--download-sections', `*${frameSec}-${frameSec + 5}`,
            videoUrl
          ], { timeout: 120000 });
        } catch (dlErr) {
          // download-sections might not be supported, download full and seek
          try {
            await runCmd(ytdlpPath, [
              '--no-playlist', '-f', 'bestvideo[height<=1080]/best[height<=1080]/best',
              '--merge-output-format', 'mkv', '-o', tempVideo,
              '--no-warnings', '--no-check-certificates', '--no-part', '--force-overwrites',
              '--extractor-args', 'youtube:player_client=web,android',
              videoUrl
            ], { timeout: 180000 });
          } catch (e2) {
            console.error('  Thumbnail: video download failed, falling back to YT thumbnail');
            // Fallback: use YouTube thumbnail
            const https = require('https');
            const tempImg = outputPath + '.temp.jpg';
            await new Promise((resolve, reject) => {
              const file = fs.createWriteStream(tempImg);
              https.get(`https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`, (response) => {
                if (response.statusCode === 200) {
                  response.pipe(file);
                  file.on('finish', () => { file.close(); resolve(); });
                } else {
                  https.get(`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`, (r2) => {
                    r2.pipe(file);
                    file.on('finish', () => { file.close(); resolve(); });
                  });
                }
              }).on('error', reject);
            });
            await applyThumbnailOverlay(tempImg, outputPath, thumbTitle, thumbColor, thumbBg, thumbFontSize, thumbStyle, brandKit);
            try { fs.unlinkSync(tempImg); } catch(e) {}
            return;
          }
        }

        // Find actual download
        let actualVideo = tempVideo;
        if (!fs.existsSync(tempVideo)) {
          const base = outputPath + '.temp';
          for (const ext of ['.mkv', '.mp4', '.webm']) {
            if (fs.existsSync(base + ext)) { actualVideo = base + ext; break; }
          }
        }

        if (!fs.existsSync(actualVideo)) {
          console.error('  Thumbnail: downloaded video not found');
          return;
        }

        // Extract frame at timestamp
        const frameImg = outputPath + '.frame.jpg';
        try {
          await runCmd(ffmpegPath, [
            '-y', '-ss', String(frameSec), '-i', actualVideo,
            '-frames:v', '1', '-q:v', '2',
            '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black',
            frameImg
          ], { timeout: 30000 });
        } catch (e) {
          // Try without seek (beginning of video)
          await runCmd(ffmpegPath, [
            '-y', '-i', actualVideo, '-frames:v', '1', '-q:v', '2',
            '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black',
            frameImg
          ], { timeout: 30000 });
        }

        try { fs.unlinkSync(actualVideo); } catch(e) {}

        // Apply text overlay
        await applyThumbnailOverlay(frameImg, outputPath, thumbTitle, thumbColor, thumbBg, thumbFontSize, thumbStyle, brandKit);
        try { fs.unlinkSync(frameImg); } catch(e) {}

        console.log(`  Thumbnail generated: ${filename}`);
      } catch (err) {
        console.error('  Thumbnail generation failed:', err.message);
        try { fs.writeFileSync(outputPath + '.error', err.message); } catch(e) {}
      }
    })();

  } catch (error) {
    console.error('Error generating thumbnail:', error);
    res.status(500).json({ error: 'Failed to start thumbnail generation' });
  }
});

// Helper: Apply text overlay to create a styled thumbnail
async function applyThumbnailOverlay(inputImg, outputPath, title, titleColor, bgColor, fontSize, style, brandKit) {
  const runCmd = (cmd, args, opts = {}) => {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      let settled = false;
      const settle = (fn, val) => { if (!settled) { settled = true; clearTimeout(timer); fn(val); } };
      proc.stdout.on('data', d => stdout += d.toString());
      proc.stderr.on('data', d => stderr += d.toString());
      proc.on('error', e => settle(reject, e));
      proc.on('close', code => code === 0 ? settle(resolve, { stdout, stderr }) : settle(reject, new Error(stderr.slice(-300))));
      const timer = opts.timeout ? setTimeout(() => { try { proc.kill('SIGKILL'); } catch(e) {} settle(reject, new Error('timeout')); }, opts.timeout) : null;
    });
  };

  const safeTitle = title.replace(/'/g, "'\\''").replace(/:/g, '\\:').replace(/\\/g, '\\\\');
  const cleanColor = (titleColor || '#FFFFFF').replace('#', '');
  const wmText = (brandKit && brandKit.watermark_text) ? brandKit.watermark_text.replace(/'/g, "'\\''").replace(/:/g, '\\:') : '';

  // Split title into lines if too long (max ~25 chars per line)
  const words = title.split(' ');
  let lines = [];
  let currentLine = '';
  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length > 25) {
      if (currentLine) lines.push(currentLine.trim());
      currentLine = word;
    } else {
      currentLine = (currentLine + ' ' + word).trim();
    }
  }
  if (currentLine) lines.push(currentLine.trim());

  // Build drawtext filter chain for each line
  const lineHeight = Math.round(fontSize * 1.3);
  const totalTextHeight = lines.length * lineHeight;
  const startY = Math.round((1080 - totalTextHeight) / 2);

  let textFilters = lines.map((line, i) => {
    const safeLine = line.replace(/'/g, "'\\''").replace(/:/g, '\\:').replace(/\\/g, '\\\\');
    const y = startY + (i * lineHeight);
    return `drawtext=text='${safeLine.toUpperCase()}':fontsize=${fontSize}:fontcolor=${cleanColor}:` +
           `borderw=4:bordercolor=black:font=Liberation Sans Bold:x=(w-text_w)/2:y=${y}`;
  }).join(',');

  let filterStr;
  if (style === 'dark') {
    // Dark overlay + centered text
    filterStr = `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,` +
                `colorbalance=bs=-0.3:gs=-0.3:rs=-0.3,eq=brightness=-0.3:contrast=1.2,${textFilters}`;
  } else if (style === 'border') {
    // Colored border frame + text
    const borderColor = (brandKit && brandKit.primary_color) || '#FF0050';
    const bc = borderColor.replace('#', '');
    filterStr = `scale=1860:1020:force_original_aspect_ratio=decrease,pad=1920:1080:30:30:${bc},${textFilters}`;
  } else if (style === 'split') {
    // Left half colored, right half video frame, text on left
    filterStr = `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,` +
                `drawbox=x=0:y=0:w=iw/2:h=ih:color=${cleanColor}@0.85:t=fill,${textFilters}`;
  } else {
    // gradient: bottom gradient overlay + text in lower half
    filterStr = `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,` +
                `drawbox=x=0:y=ih/2:w=iw:h=ih/2:color=black@0.7:t=fill,${textFilters}`;
  }

  // Add watermark if brand kit has one
  if (wmText) {
    const wmColor = (brandKit.primary_color || '#FFFFFF').replace('#', '');
    filterStr += `,drawtext=text='${wmText}':fontsize=32:fontcolor=${wmColor}@0.5:x=w-tw-40:y=h-th-30:font=Liberation Sans`;
  }

  await runCmd(ffmpegPath, [
    '-y', '-i', inputImg, '-vf', filterStr,
    '-q:v', '2', '-frames:v', '1', outputPath
  ], { timeout: 30000 });
}

// GET /thumbnail/status/:filename - Check if thumbnail is ready
router.get('/thumbnail/status/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(CLIPS_DIR, filename);
  const errorPath = filePath + '.error';

  if (fs.existsSync(errorPath)) {
    const msg = fs.readFileSync(errorPath, 'utf8');
    res.json({ ready: false, failed: true, message: msg });
  } else if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    if (stats.size > 1000) {
      res.json({ ready: true, size: stats.size, filename });
    } else {
      res.json({ ready: false, message: 'Generating...' });
    }
  } else {
    res.json({ ready: false, message: 'Generating thumbnail...' });
  }
});

// GET /thumbnail/download/:filename - Download generated thumbnail
router.get('/thumbnail/download/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!filename.endsWith('.jpg')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const filePath = path.join(CLIPS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Thumbnail not found' });
  }
  res.download(filePath, filename);
});

// POST /clip - Generate a video clip for a specific moment
router.post('/clip', requireAuth, async (req, res) => {
  try {
    if (!ytdl || !ffmpegAvailable) {
      return res.status(503).json({ error: 'Video clipping is not available on this server. ffmpeg or ytdl-core is missing.' });
    }

    const { analysisId, momentIndex, includeCaptions, clipStyle } = req.body;

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

    // Fetch user's brand kit for watermark
    let brandKit = null;
    try {
      brandKit = await brandKitOps.getByUserId(req.user.id);
    } catch (e) { console.log('Brand kit fetch skipped:', e.message); }

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
    const analysisTag = `a${req.body.analysisId || 'unknown'}`;
    const filename = `${safeTitle}_${analysisTag}_${Date.now()}.mp4`;
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
        const cmdLabel = path.basename(cmd);
        console.log(`  Running ${cmdLabel}: ${args.slice(0, 4).join(' ')}...`);
        const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const settle = (fn, val) => { if (!settled) { settled = true; clearTimeout(timer); fn(val); } };

        proc.stdout.on('data', (data) => {
          stdout += data.toString();
          const pctMatch = data.toString().match(/(\d+\.?\d*)%/);
          if (pctMatch) writeProgress(`Downloading: ${Math.round(parseFloat(pctMatch[1]))}%`);
        });
        proc.stderr.on('data', (data) => {
          stderr += data.toString();
          // yt-dlp sends progress to stderr when piped
          const pctMatch = data.toString().match(/(\d+\.?\d*)%/);
          if (pctMatch) writeProgress(`Downloading: ${Math.round(parseFloat(pctMatch[1]))}%`);
          // ffmpeg progress
          const timeMatch = data.toString().match(/time=(\d+:\d+:\d+)/);
          if (timeMatch) writeProgress(`Encoding: ${timeMatch[1]}`);
        });
        proc.on('error', (err) => settle(reject, new Error(`${cmdLabel} process error: ${err.message}`)));
        proc.on('close', (code, signal) => {
          if (code === 0) settle(resolve, { stdout, stderr });
          else settle(reject, new Error(`${cmdLabel} exit ${code}${signal ? '/'+signal : ''}: ${stderr.slice(-500)}`));
        });

        // Timeout: kill process
        const timer = options.timeout ? setTimeout(() => {
          console.error(`  ${cmdLabel} timed out after ${options.timeout/1000}s`);
          try { proc.kill('SIGKILL'); } catch(e) {}
          settle(reject, new Error(`${cmdLabel} timed out after ${options.timeout/1000}s`));
        }, options.timeout) : null;
      });
    };

    // Process in background (non-blocking - keeps event loop alive for health checks)
    (async () => {
      const timeout = setTimeout(() => {
        writeError('Clip generation timed out after 8 minutes. Try a shorter moment or one closer to the start.');
      }, 480000);

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
        // Blur-background style: full video centered with blurred background
        // [0:v] = blurred background scaled to fill 1080x1920
        // [1:v] = foreground video scaled to fit within 1080x1920 (preserving aspect ratio)
        // Overlay foreground centered on blurred background
        writeProgress('Creating vertical clip...');

        // === Generate captions if requested ===
        let assFilePath = null;
        if (includeCaptions && analysis.transcript) {
          try {
            console.log('  Generating captions...');
            const segments = parseTranscriptToSegments(analysis.transcript);
            console.log(`  Parsed ${segments.length} transcript segments`);
            const assContent = generateASSSubtitles(segments, startSec, duration);
            if (assContent) {
              assFilePath = outputPath + '.ass';
              fs.writeFileSync(assFilePath, assContent, 'utf8');
              console.log(`  ASS subtitle file written: ${assFilePath}`);
            } else {
              console.log('  No caption segments found for this time range');
            }
          } catch (captionErr) {
            console.error('  Caption generation failed:', captionErr.message);
            // Continue without captions
          }
        }

        // Build filter based on selected clip style
        const captionFilter = assFilePath ? `,ass='${assFilePath.replace(/'/g, "'\\''").replace(/:/g, '\\:')}'` : '';

        // Build watermark filter from brand kit
        let watermarkFilter = '';
        if (brandKit && brandKit.watermark_text && brandKit.watermark_text.trim()) {
          const wmText = brandKit.watermark_text.trim().replace(/'/g, "'\\''").replace(/:/g, '\\:').replace(/\\/g, '\\\\');
          const wmColor = (brandKit.primary_color || '#FFFFFF').replace('#', '');
          // Semi-transparent watermark in bottom-right corner
          watermarkFilter = `,drawtext=text='${wmText}':fontsize=28:fontcolor=${wmColor}@0.6:x=w-tw-30:y=h-th-30:font=Liberation Sans`;
        }

        const style = clipStyle || 'blur';
        let videoFilter;

        console.log(`  Clip style: ${style}, captions: ${!!assFilePath}, watermark: ${!!watermarkFilter}`);

        if (style === 'crop') {
          // Center crop: zoom in and crop to 9:16 (loses sides but fills frame)
          videoFilter = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1${captionFilter}${watermarkFilter}`;
        } else if (style === 'fit') {
          // Fit with black background: full video centered on black
          videoFilter = [
            'color=c=black:s=1080x1920:r=30[bg]',
            '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,setsar=1[fg]',
            '[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1,setsar=1' + captionFilter + watermarkFilter
          ].join(';');
        } else if (style === 'pip') {
          // Picture-in-Picture: cropped fullscreen background + small PiP in top-right
          // Uses split to avoid reading input twice (much faster)
          videoFilter = [
            '[0:v]split=2[base][small]',
            '[base]scale=1080:1920:force_original_aspect_ratio=increase:flags=fast_bilinear,crop=1080:1920:(iw-1080)/2:(ih-1920)/2,setsar=1[bg]',
            '[small]scale=380:-2:flags=lanczos,setsar=1[pip]',
            '[bg][pip]overlay=W-w-16:16,setsar=1' + captionFilter + watermarkFilter
          ].join(';');
        } else {
          // Default: blur background (most popular for repurposed content)
          videoFilter = [
            '[0:v]scale=270:-2,boxblur=8:3,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[bg]',
            '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,setsar=1[fg]',
            '[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1' + captionFilter + watermarkFilter
          ].join(';');
        }

        const ffmpegArgs = [
          '-y',
          '-ss', String(startSec),
          '-i', actualDownload,
          '-t', String(duration),
          ...(videoFilter.includes('[') ? ['-filter_complex', videoFilter] : ['-vf', videoFilter]),
          '-c:v', 'libx264',
          '-profile:v', 'high',
          '-level', '4.0',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-ar', '44100',
          '-ac', '2',
          '-preset', 'fast',
          '-crf', '22',
          '-movflags', '+faststart',
          '-max_muxing_queue_size', '2048',
          tempOutputPath
        ];

        let ffmpegSuccess = false;
        try {
          await runCommand(ffmpegPath, ffmpegArgs, { timeout: 240000 });
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
            ...(videoFilter.includes('[') ? ['-filter_complex', videoFilter] : ['-vf', videoFilter]),
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
            await runCommand(ffmpegPath, retryArgs, { timeout: 300000 });
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

        // Clean up temp files
        try { fs.unlinkSync(actualDownload); } catch(e) {}
        if (assFilePath) { try { fs.unlinkSync(assFilePath); } catch(e) {} }

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

// GET /clip/debug - Debug endpoint to see clip file states
router.get('/clip/debug', requireAuth, (req, res) => {
  try {
    const files = fs.readdirSync(CLIPS_DIR);
    const clipInfo = files.map(f => {
      const fullPath = path.join(CLIPS_DIR, f);
      const stat = fs.statSync(fullPath);
      let content = '';
      if (f.endsWith('.progress') || f.endsWith('.error')) {
        try { content = fs.readFileSync(fullPath, 'utf8'); } catch(e) {}
      }
      return { name: f, size: stat.size, modified: stat.mtime, content };
    });
    res.json({ clips_dir: CLIPS_DIR, files: clipInfo });
  } catch (err) {
    res.json({ error: err.message, clips_dir: CLIPS_DIR });
  }
});

// POST /clip-with-broll - Generate clip with B-Roll scenes spliced in
router.post('/clip-with-broll', requireAuth, async (req, res) => {
  try {
    if (!ffmpegAvailable) {
      return res.status(503).json({ error: 'ffmpeg not available on this server.' });
    }

    const { analysisId, momentIndex, includeCaptions, clipStyle, brollScenes } = req.body;
    if (!analysisId || momentIndex === undefined || !brollScenes || brollScenes.length === 0) {
      return res.status(400).json({ error: 'Analysis ID, moment index, and B-Roll scenes are required' });
    }

    const analysis = await shortsOps.getById(analysisId);
    if (!analysis || analysis.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not found or unauthorized' });
    }

    let brandKit = null;
    try { brandKit = await brandKitOps.getByUserId(req.user.id); } catch (e) {}

    let moments = analysis.moments;
    if (typeof moments === 'string') {
      try { moments = JSON.parse(moments); } catch (e) { moments = []; }
    }
    const moment = moments[momentIndex];
    if (!moment) return res.status(404).json({ error: 'Moment not found' });

    const rangeParts = (moment.timeRange || '').split('-');
    const parseTime = (str) => {
      const parts = (str || '').trim().split(':').map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return parts[0] || 0;
    };
    const startSec = parseTime(rangeParts[0]);
    const endSec = rangeParts[1] ? parseTime(rangeParts[1]) : startSec + 60;
    const duration = Math.max(endSec - startSec, 5);

    const videoId = extractVideoId(analysis.video_url);
    if (!videoId) return res.status(400).json({ error: 'Invalid video URL' });

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const safeTitle = (moment.title || 'clip').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
    const filename = `${safeTitle}_broll_${Date.now()}.mp4`;
    const outputPath = path.join(CLIPS_DIR, filename);
    const tempOutputPath = outputPath + '.encoding.mp4';

    res.json({ success: true, status: 'processing', message: 'Generating clip with B-Roll...', filename });

    const progressPath = outputPath + '.progress';
    const writeProgress = (msg) => { try { fs.writeFileSync(progressPath, msg); } catch (e) {} };
    const writeError = (msg) => {
      try { fs.unlinkSync(progressPath); } catch (e) {}
      try { fs.unlinkSync(outputPath); } catch (e) {}
      try { fs.writeFileSync(outputPath + '.error', msg); } catch (e) {}
    };

    const runCommand = (cmd, args, options = {}) => {
      return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '', stderr = '', settled = false;
        const settle = (fn, val) => { if (!settled) { settled = true; clearTimeout(timer); fn(val); } };
        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => {
          stderr += d.toString();
          const pct = d.toString().match(/(\d+\.?\d*)%/);
          if (pct) writeProgress(`Downloading: ${Math.round(parseFloat(pct[1]))}%`);
          const tm = d.toString().match(/time=(\d+:\d+:\d+)/);
          if (tm) writeProgress(`Encoding: ${tm[1]}`);
        });
        proc.on('error', (err) => settle(reject, err));
        proc.on('close', (code) => {
          if (code === 0) settle(resolve, { stdout, stderr });
          else settle(reject, new Error(`Exit ${code}: ${stderr.slice(-300)}`));
        });
        const timer = options.timeout ? setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch(e) {}
          settle(reject, new Error('Timed out'));
        }, options.timeout) : null;
      });
    };

    // Background processing
    (async () => {
      const timeout = setTimeout(() => writeError('Timed out after 10 minutes'), 600000);
      const tempFiles = [];

      try {
        // STEP 1: Download main video
        writeProgress('Downloading main video...');
        const tempDownload = outputPath + '.temp.mkv';
        tempFiles.push(tempDownload);

        try {
          await runCommand('yt-dlp', [
            '--no-playlist', '-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
            '--merge-output-format', 'mkv', '-o', tempDownload,
            '--no-warnings', '--no-check-certificates', '--no-part', '--force-overwrites',
            '--extractor-args', 'youtube:player_client=web,android',
            videoUrl
          ], { timeout: 240000 });
        } catch (e) {
          clearTimeout(timeout);
          writeError('Video download failed.');
          return;
        }

        // Find actual downloaded file
        let actualDownload = tempDownload;
        if (!fs.existsSync(tempDownload)) {
          const base = outputPath + '.temp';
          for (const ext of ['.mkv', '.mp4', '.webm']) {
            if (fs.existsSync(base + ext)) { actualDownload = base + ext; break; }
          }
        }
        if (!fs.existsSync(actualDownload)) { clearTimeout(timeout); writeError('Download not found.'); return; }
        if (actualDownload !== tempDownload) tempFiles.push(actualDownload);

        // STEP 2: Extract main clip segment
        writeProgress('Extracting clip segment...');
        const mainSegment = outputPath + '.main_seg.mp4';
        tempFiles.push(mainSegment);

        const style = clipStyle || 'blur';
        let captionFilter = '';
        if (includeCaptions && analysis.transcript) {
          try {
            const segments = parseTranscriptToSegments(analysis.transcript);
            const assContent = generateASSSubtitles(segments, startSec, duration);
            if (assContent) {
              const assFile = outputPath + '.ass';
              fs.writeFileSync(assFile, assContent, 'utf8');
              tempFiles.push(assFile);
              captionFilter = `,ass='${assFile.replace(/'/g, "'\\''").replace(/:/g, '\\:')}'`;
            }
          } catch (e) {}
        }

        let watermarkFilter = '';
        if (brandKit && brandKit.watermark_text && brandKit.watermark_text.trim()) {
          const wmText = brandKit.watermark_text.trim().replace(/'/g, "'\\''").replace(/:/g, '\\:').replace(/\\/g, '\\\\');
          const wmColor = (brandKit.primary_color || '#FFFFFF').replace('#', '');
          watermarkFilter = `,drawtext=text='${wmText}':fontsize=28:fontcolor=${wmColor}@0.6:x=w-tw-30:y=h-th-30:font=Liberation Sans`;
        }

        let videoFilter;
        if (style === 'crop') {
          videoFilter = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1${captionFilter}${watermarkFilter}`;
        } else if (style === 'fit') {
          videoFilter = ['color=c=black:s=1080x1920:r=30[bg]', '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,setsar=1[fg]', '[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1,setsar=1' + captionFilter + watermarkFilter].join(';');
        } else if (style === 'pip') {
          videoFilter = ['[0:v]split=2[base][small]', '[base]scale=1080:1920:force_original_aspect_ratio=increase:flags=fast_bilinear,crop=1080:1920:(iw-1080)/2:(ih-1920)/2,setsar=1[bg]', '[small]scale=380:-2:flags=lanczos,setsar=1[pip]', '[bg][pip]overlay=W-w-16:16,setsar=1' + captionFilter + watermarkFilter].join(';');
        } else {
          videoFilter = ['[0:v]scale=270:-2,boxblur=8:3,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[bg]', '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,setsar=1[fg]', '[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1' + captionFilter + watermarkFilter].join(';');
        }

        await runCommand(ffmpegPath, [
          '-y', '-ss', String(startSec), '-i', actualDownload, '-t', String(duration),
          ...(videoFilter.includes('[') ? ['-filter_complex', videoFilter] : ['-vf', videoFilter]),
          '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
          '-preset', 'fast', '-crf', '22', '-movflags', '+faststart', '-max_muxing_queue_size', '2048',
          mainSegment
        ], { timeout: 240000 });

        // STEP 3: Download B-Roll clips from Pexels
        writeProgress('Downloading B-Roll clips...');
        const brollSegments = [];

        for (let i = 0; i < brollScenes.length; i++) {
          const scene = brollScenes[i];
          if (!scene.videoUrl) continue;

          writeProgress(`Downloading B-Roll ${i + 1}/${brollScenes.length}...`);
          const brollRaw = outputPath + `.broll_raw_${i}.mp4`;
          const brollFormatted = outputPath + `.broll_fmt_${i}.mp4`;
          tempFiles.push(brollRaw, brollFormatted);

          try {
            // Download from Pexels
            const pxResp = await fetch(scene.videoUrl);
            if (!pxResp.ok) continue;
            const buffer = Buffer.from(await pxResp.arrayBuffer());
            fs.writeFileSync(brollRaw, buffer);

            // Reformat B-Roll to match main clip (1080x1920 vertical, 5s max)
            const brollDur = Math.min(scene.duration || 5, 8);
            await runCommand(ffmpegPath, [
              '-y', '-i', brollRaw, '-t', String(brollDur),
              '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,setsar=1',
              '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-crf', '22',
              '-an',
              '-movflags', '+faststart',
              brollFormatted
            ], { timeout: 60000 });

            brollSegments.push({
              path: brollFormatted,
              position: scene.position || 'middle',
              positionSec: scene.positionSec || null,
              duration: brollDur
            });
          } catch (e) {
            console.error(`  B-Roll ${i} download/format failed:`, e.message);
          }
        }

        if (brollSegments.length === 0) {
          // No B-Roll succeeded — just use the main segment
          fs.renameSync(mainSegment, outputPath);
          clearTimeout(timeout);
          try { fs.unlinkSync(progressPath); } catch (e) {}
          tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
          return;
        }

        // STEP 4: Get main clip duration
        let mainDuration = duration;
        try {
          const probe = await runCommand(ffmpegPath, [
            '-i', mainSegment, '-f', 'null', '-'
          ], { timeout: 10000 }).catch(() => null);
        } catch (e) {}

        // STEP 5: Split main clip and interleave B-Roll
        writeProgress('Splicing B-Roll into clip...');

        // Sort B-Roll by position in the clip
        const sortedBroll = brollSegments.map(b => {
          let insertAt;
          if (b.positionSec !== null && b.positionSec !== undefined) {
            insertAt = parseFloat(b.positionSec);
          } else if (b.position === 'beginning') {
            insertAt = 3;
          } else if (b.position === 'end') {
            insertAt = Math.max(mainDuration - 8, mainDuration * 0.8);
          } else {
            insertAt = mainDuration * 0.5;
          }
          return { ...b, insertAt: Math.max(0, Math.min(insertAt, mainDuration - 2)) };
        }).sort((a, b) => a.insertAt - b.insertAt);

        // Create segments: split main clip at each insertion point
        const parts = [];
        let currentPos = 0;

        for (let i = 0; i < sortedBroll.length; i++) {
          const br = sortedBroll[i];
          const splitAt = br.insertAt;

          // Main segment before this B-Roll
          if (splitAt > currentPos + 0.5) {
            const partFile = outputPath + `.part_main_${i}.mp4`;
            tempFiles.push(partFile);
            await runCommand(ffmpegPath, [
              '-y', '-ss', String(currentPos), '-i', mainSegment,
              '-t', String(splitAt - currentPos),
              '-c', 'copy', '-movflags', '+faststart', partFile
            ], { timeout: 30000 });
            parts.push(partFile);
          }

          // B-Roll segment
          parts.push(br.path);
          currentPos = splitAt;
        }

        // Remaining main clip after last B-Roll
        if (currentPos < mainDuration - 0.5) {
          const lastPart = outputPath + '.part_main_last.mp4';
          tempFiles.push(lastPart);
          await runCommand(ffmpegPath, [
            '-y', '-ss', String(currentPos), '-i', mainSegment,
            '-t', String(mainDuration - currentPos),
            '-c', 'copy', '-movflags', '+faststart', lastPart
          ], { timeout: 30000 });
          parts.push(lastPart);
        }

        // STEP 6: Concat all parts
        writeProgress('Combining final video...');
        const concatList = outputPath + '.concat.txt';
        tempFiles.push(concatList);
        const concatContent = parts.map(p => `file '${p}'`).join('\n');
        fs.writeFileSync(concatList, concatContent, 'utf8');

        // Re-encode concat for consistent format
        await runCommand(ffmpegPath, [
          '-y', '-f', 'concat', '-safe', '0', '-i', concatList,
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-crf', '23',
          '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
          '-movflags', '+faststart', '-max_muxing_queue_size', '2048',
          tempOutputPath
        ], { timeout: 180000 });

        // Validate and finalize
        clearTimeout(timeout);
        if (!fs.existsSync(tempOutputPath) || fs.statSync(tempOutputPath).size < 50000) {
          writeError('Final video encoding failed.');
          tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
          return;
        }

        fs.renameSync(tempOutputPath, outputPath);
        try { fs.unlinkSync(progressPath); } catch (e) {}

        // Clean up all temp files
        tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
        console.log(`  B-Roll clip ready: ${filename}`);

      } catch (err) {
        clearTimeout(timeout);
        writeError(`B-Roll clip failed: ${err.message}`);
        tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
      }
    })();

  } catch (error) {
    console.error('B-Roll clip error:', error);
    res.status(500).json({ error: 'Failed to generate B-Roll clip' });
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
        padding: 16px;
      }

      .cards-grid {
        grid-template-columns: 1fr;
      }

      .header-title {
        font-size: 22px;
      }

      .header-subtitle {
        font-size: 13px;
      }

      .upload-input-group {
        flex-direction: column;
      }

      .upload-input {
        font-size: 14px !important;
      }

      /* Modal mobile */
      .modal-content {
        width: 100%;
        max-width: 100%;
        max-height: 100vh;
        border-radius: 0;
        padding: 16px;
      }

      .modal-title {
        font-size: 18px;
      }

      .modal-close {
        top: 10px;
        right: 10px;
        width: 36px;
        height: 36px;
        font-size: 22px;
      }

      /* Moment cards mobile */
      .moment-card {
        padding: 12px !important;
      }

      .moment-card-header {
        flex-direction: column;
        gap: 8px;
      }

      .moment-card-title {
        font-size: 15px !important;
      }

      .moment-score {
        font-size: 20px !important;
      }

      /* Upload section */
      .upload-section {
        padding: 16px !important;
      }

      /* Calendar mobile */
      #calendarGrid {
        font-size: 11px;
      }

      #calendarGrid > div {
        min-height: 60px !important;
        padding: 4px !important;
      }

      /* Brand kit grid */
      #brandKitPanel > div:nth-child(3) {
        grid-template-columns: 1fr !important;
      }

      /* Workflow grid */
      #workflowPanel .card {
        padding: 12px !important;
      }

      /* Buttons wrap on mobile */
      .moment-card div[style*="display: flex"][style*="gap: 8px"] {
        flex-direction: column;
      }

      /* Calendar entry modal */
      #calendarEntryModal > div {
        margin-top: 5vh !important;
        width: 95% !important;
        padding: 16px !important;
      }

      #calendarEntryModal div[style*="grid-template-columns: 1fr 1fr"] {
        grid-template-columns: 1fr !important;
      }

      /* Calendar header */
      div[style*="Content Calendar"] {
        flex-direction: column;
        gap: 12px;
      }
    }

    @media (max-width: 480px) {
      .main-content {
        padding: 12px;
      }

      .header-title {
        font-size: 20px;
      }

      .modal-content {
        padding: 12px;
      }

      .btn {
        font-size: 12px !important;
        padding: 8px 12px !important;
      }

      .btn-small {
        font-size: 10px !important;
        padding: 4px 8px !important;
      }

      select {
        font-size: 12px !important;
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

      <!-- Workflow Templates -->
      <div style="margin-bottom: 16px;">
        <button class="btn" onclick="toggleWorkflows()" id="workflowToggle"
          style="background: rgba(243,156,18,0.12); color: #f39c12; border: 1px solid rgba(243,156,18,0.3); font-size: 13px; padding: 8px 16px;">
          Workflow Templates
        </button>
        <div id="workflowPanel" style="display:none; margin-top:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <p style="color:#888;font-size:13px;">Select a workflow to auto-configure clip settings</p>
            <button class="btn btn-small" onclick="toggleWorkflows()" style="background:rgba(255,255,255,0.1);color:var(--text-muted);font-size:12px;">&times; Close</button>
          </div>
          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:12px;">
            <div class="card" style="cursor:pointer;padding:16px;" onclick="applyWorkflow('yt-tiktok')">
              <div style="font-size:24px;margin-bottom:8px;">&#x1F3AC; &#x2192; &#x266C;</div>
              <div style="font-weight:600;margin-bottom:4px;">YouTube to TikTok</div>
              <div style="font-size:12px;color:var(--text-muted);">Blur background, auto-captions, TikTok-optimized content with trending hashtags</div>
              <div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap;">
                <span style="font-size:10px;background:rgba(255,0,80,0.2);color:#FF0050;padding:2px 6px;border-radius:4px;">Blur BG</span>
                <span style="font-size:10px;background:rgba(255,0,80,0.2);color:#FF0050;padding:2px 6px;border-radius:4px;">Captions ON</span>
                <span style="font-size:10px;background:rgba(255,0,80,0.2);color:#FF0050;padding:2px 6px;border-radius:4px;">TikTok + IG</span>
              </div>
            </div>
            <div class="card" style="cursor:pointer;padding:16px;" onclick="applyWorkflow('yt-shorts')">
              <div style="font-size:24px;margin-bottom:8px;">&#x1F3AC; &#x2192; &#x25B6;</div>
              <div style="font-weight:600;margin-bottom:4px;">YouTube to YT Shorts</div>
              <div style="font-size:12px;color:var(--text-muted);">Center crop for full-frame, captions, Shorts-optimized with SEO description</div>
              <div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap;">
                <span style="font-size:10px;background:rgba(255,0,0,0.2);color:#ff0000;padding:2px 6px;border-radius:4px;">Center Crop</span>
                <span style="font-size:10px;background:rgba(255,0,0,0.2);color:#ff0000;padding:2px 6px;border-radius:4px;">Captions ON</span>
                <span style="font-size:10px;background:rgba(255,0,0,0.2);color:#ff0000;padding:2px 6px;border-radius:4px;">Shorts Only</span>
              </div>
            </div>
            <div class="card" style="cursor:pointer;padding:16px;" onclick="applyWorkflow('yt-linkedin')">
              <div style="font-size:24px;margin-bottom:8px;">&#x1F3AC; &#x2192; &#x1F4BC;</div>
              <div style="font-weight:600;margin-bottom:4px;">YouTube to LinkedIn</div>
              <div style="font-size:12px;color:var(--text-muted);">Fit style with clean background, professional content + blog post</div>
              <div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap;">
                <span style="font-size:10px;background:rgba(0,119,181,0.2);color:#0077b5;padding:2px 6px;border-radius:4px;">Fit Style</span>
                <span style="font-size:10px;background:rgba(0,119,181,0.2);color:#0077b5;padding:2px 6px;border-radius:4px;">No Captions</span>
                <span style="font-size:10px;background:rgba(0,119,181,0.2);color:#0077b5;padding:2px 6px;border-radius:4px;">LinkedIn + Blog</span>
              </div>
            </div>
            <div class="card" style="cursor:pointer;padding:16px;" onclick="applyWorkflow('yt-all')">
              <div style="font-size:24px;margin-bottom:8px;">&#x1F3AC; &#x2192; &#x1F30D;</div>
              <div style="font-weight:600;margin-bottom:4px;">YouTube to Everything</div>
              <div style="font-size:12px;color:var(--text-muted);">Maximum reach: blur BG clip, captions, content for all 8 platforms, thumbnail</div>
              <div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap;">
                <span style="font-size:10px;background:rgba(108,92,231,0.2);color:#a29bfe;padding:2px 6px;border-radius:4px;">Blur BG</span>
                <span style="font-size:10px;background:rgba(108,92,231,0.2);color:#a29bfe;padding:2px 6px;border-radius:4px;">All Platforms</span>
                <span style="font-size:10px;background:rgba(108,92,231,0.2);color:#a29bfe;padding:2px 6px;border-radius:4px;">+ Thumbnail</span>
              </div>
            </div>
            <div class="card" style="cursor:pointer;padding:16px;" onclick="applyWorkflow('podcast')">
              <div style="font-size:24px;margin-bottom:8px;">&#x1F399; &#x2192; &#x1F4F1;</div>
              <div style="font-weight:600;margin-bottom:4px;">Podcast to Clips</div>
              <div style="font-size:12px;color:var(--text-muted);">PiP style for talking heads, bold captions, Twitter thread + newsletter</div>
              <div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap;">
                <span style="font-size:10px;background:rgba(243,156,18,0.2);color:#f39c12;padding:2px 6px;border-radius:4px;">PiP Style</span>
                <span style="font-size:10px;background:rgba(243,156,18,0.2);color:#f39c12;padding:2px 6px;border-radius:4px;">Thread + Newsletter</span>
              </div>
            </div>
            <div class="card" style="cursor:pointer;padding:16px;" onclick="applyWorkflow('education')">
              <div style="font-size:24px;margin-bottom:8px;">&#x1F393; &#x2192; &#x1F4DD;</div>
              <div style="font-weight:600;margin-bottom:4px;">Education to Blog</div>
              <div style="font-size:12px;color:var(--text-muted);">Fit style, captions for accessibility, long-form blog + LinkedIn article</div>
              <div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap;">
                <span style="font-size:10px;background:rgba(16,185,129,0.2);color:#10b981;padding:2px 6px;border-radius:4px;">Fit Style</span>
                <span style="font-size:10px;background:rgba(16,185,129,0.2);color:#10b981;padding:2px 6px;border-radius:4px;">Blog + LinkedIn</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Batch Analysis -->
      <div style="margin-bottom: 16px;">
        <button class="btn" onclick="toggleBatchInput()" id="batchToggle"
          style="background: rgba(255,0,80,0.12); color: #FF0050; border: 1px solid rgba(255,0,80,0.3); font-size: 13px; padding: 8px 16px;">
          Batch Analyze (Multiple Videos)
        </button>
        <div id="batchPanel" style="display:none; margin-top:12px; background:var(--surface-light); border:var(--border-subtle); border-radius:12px; padding:24px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <h3 style="font-size:16px; font-weight:600;">Batch Video Analysis</h3>
            <button class="btn btn-small" onclick="toggleBatchInput()" style="background:rgba(255,255,255,0.1);color:var(--text-muted);font-size:12px;">&times; Close</button>
          </div>
          <p style="color:#888; font-size:13px; margin-bottom:16px;">Paste up to 10 YouTube URLs (one per line) to analyze them all at once.</p>
          <textarea id="batchUrls" rows="6" placeholder="https://youtube.com/watch?v=...&#10;https://youtube.com/watch?v=...&#10;https://youtube.com/watch?v=..."
            style="width:100%; padding:12px; background:#111; border:1px solid #333; border-radius:8px; color:#fff; font-size:13px; resize:vertical; font-family:monospace;"></textarea>
          <div style="margin-top:12px; display:flex; gap:10px; align-items:center;">
            <button class="btn btn-primary" onclick="startBatchAnalysis()" id="batchBtn">Analyze All</button>
            <span id="batchStatus" style="font-size:13px; color:#888;"></span>
          </div>
          <div id="batchResults" style="display:none; margin-top:16px;"></div>
        </div>
      </div>

      <!-- Brand Kit Settings -->
      <div style="margin-bottom: 24px;">
        <button class="btn" onclick="toggleBrandKit()" id="brandKitToggle"
          style="background: rgba(108,92,231,0.15); color: #a29bfe; border: 1px solid rgba(108,92,231,0.3); font-size: 13px; padding: 8px 16px;">
          Brand Kit Settings
        </button>
        <div id="brandKitPanel" style="display:none; margin-top:12px; background:var(--surface-light); border:var(--border-subtle); border-radius:12px; padding:24px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h3 style="font-size:16px; font-weight:600;">Brand Kit</h3>
            <button class="btn btn-small" onclick="toggleBrandKit()" style="background:rgba(255,255,255,0.1);color:var(--text-muted);font-size:12px;">&times; Close</button>
          </div>
          <p style="color:#888; font-size:13px; margin-bottom:20px;">Customize your clips with your brand identity. Watermark text appears on all generated clips.</p>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
            <div>
              <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:6px;">Brand Name</label>
              <input type="text" id="bk-brandName" placeholder="My Brand"
                style="width:100%; padding:10px 12px; background:#111; border:1px solid #333; border-radius:8px; color:#fff; font-size:14px;">
            </div>
            <div>
              <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:6px;">Watermark Text</label>
              <input type="text" id="bk-watermarkText" placeholder="@mybrand"
                style="width:100%; padding:10px 12px; background:#111; border:1px solid #333; border-radius:8px; color:#fff; font-size:14px;">
            </div>
            <div>
              <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:6px;">Primary Color</label>
              <div style="display:flex; align-items:center; gap:8px;">
                <input type="color" id="bk-primaryColor" value="#FF0050"
                  style="width:40px; height:40px; border:none; border-radius:8px; cursor:pointer; background:none;">
                <input type="text" id="bk-primaryColorText" value="#FF0050"
                  style="flex:1; padding:10px 12px; background:#111; border:1px solid #333; border-radius:8px; color:#fff; font-size:14px; font-family:monospace;"
                  oninput="document.getElementById('bk-primaryColor').value=this.value">
              </div>
            </div>
            <div>
              <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:6px;">Secondary Color</label>
              <div style="display:flex; align-items:center; gap:8px;">
                <input type="color" id="bk-secondaryColor" value="#6c5ce7"
                  style="width:40px; height:40px; border:none; border-radius:8px; cursor:pointer; background:none;">
                <input type="text" id="bk-secondaryColorText" value="#6c5ce7"
                  style="flex:1; padding:10px 12px; background:#111; border:1px solid #333; border-radius:8px; color:#fff; font-size:14px; font-family:monospace;"
                  oninput="document.getElementById('bk-secondaryColor').value=this.value">
              </div>
            </div>
            <div>
              <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:6px;">Font Style</label>
              <select id="bk-fontStyle"
                style="width:100%; padding:10px 12px; background:#111; border:1px solid #333; border-radius:8px; color:#fff; font-size:14px; cursor:pointer;">
                <option value="modern">Modern (Sans-serif)</option>
                <option value="bold">Bold Impact</option>
                <option value="elegant">Elegant (Serif)</option>
                <option value="handwritten">Handwritten</option>
              </select>
            </div>
          </div>
          <div style="margin-top:20px; display:flex; gap:10px; align-items:center;">
            <button class="btn btn-primary" onclick="saveBrandKit()" id="bk-saveBtn"
              style="padding:10px 24px;">Save Brand Kit</button>
            <span id="bk-status" style="font-size:13px; color:#888;"></span>
          </div>
          <div id="bk-preview" style="display:none; margin-top:16px; padding:16px; background:#000; border-radius:8px;">
            <p style="font-size:12px; color:#666; margin-bottom:8px;">Preview:</p>
            <div style="position:relative; width:200px; height:356px; background:#1a1a2e; border-radius:8px; overflow:hidden;">
              <div id="bk-preview-watermark" style="position:absolute; bottom:10px; right:10px; font-size:14px; opacity:0.6;"></div>
            </div>
          </div>
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

      <!-- Content Calendar -->
      <div style="margin-top: 32px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <h2 style="font-size:22px;font-weight:700;">Content Calendar</h2>
          <div style="display:flex;gap:8px;align-items:center;">
            <button class="btn btn-small" onclick="changeCalendarMonth(-1)" style="background:rgba(255,255,255,0.08);">&larr;</button>
            <span id="calendarMonthLabel" style="font-size:14px;font-weight:600;min-width:140px;text-align:center;"></span>
            <button class="btn btn-small" onclick="changeCalendarMonth(1)" style="background:rgba(255,255,255,0.08);">&rarr;</button>
            <button class="btn btn-small" onclick="openAddEntry()" style="background:rgba(108,92,231,0.2);color:#a29bfe;">+ Add Entry</button>
          </div>
        </div>
        <div id="calendarGrid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:rgba(255,255,255,0.03);border-radius:12px;overflow:hidden;"></div>
      </div>
    </main>

  <!-- Calendar Entry Modal -->
  <!-- Day entries list modal (shows when clicking a day with entries) -->
  <div id="calendarDayModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9998;align-items:center;justify-content:center;">
    <div style="background:#1a1a2e;border-radius:12px;padding:24px;max-width:400px;width:90%;margin:auto;margin-top:15vh;">
      <h3 style="margin-bottom:16px;" id="dayModalTitle">Entries</h3>
      <div id="dayModalEntries"></div>
      <div style="display:flex;gap:8px;margin-top:14px;">
        <button class="btn btn-primary" id="dayModalAddBtn" style="flex:1;">+ Add New Entry</button>
        <button class="btn" onclick="document.getElementById('calendarDayModal').style.display='none'" style="background:rgba(255,255,255,0.1);flex:1;">Close</button>
      </div>
    </div>
  </div>

  <div id="calendarEntryModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;align-items:center;justify-content:center;">
    <div style="background:#1a1a2e;border-radius:12px;padding:24px;max-width:400px;width:90%;margin:auto;margin-top:15vh;">
      <h3 style="margin-bottom:16px;" id="calEntryTitle">Add Calendar Entry</h3>
      <input type="hidden" id="cal-entry-id">
      <div style="margin-bottom:12px;">
        <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Title</label>
        <input type="text" id="cal-title" placeholder="Post title"
          style="width:100%;padding:10px;background:#111;border:1px solid #333;border-radius:8px;color:#fff;font-size:14px;">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <div>
          <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Date</label>
          <input type="date" id="cal-date"
            style="width:100%;padding:10px;background:#111;border:1px solid #333;border-radius:8px;color:#fff;font-size:14px;">
        </div>
        <div>
          <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Time</label>
          <input type="time" id="cal-time" value="12:00"
            style="width:100%;padding:10px;background:#111;border:1px solid #333;border-radius:8px;color:#fff;font-size:14px;">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <div>
          <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Platform</label>
          <select id="cal-platform"
            style="width:100%;padding:10px;background:#111;border:1px solid #333;border-radius:8px;color:#fff;font-size:14px;">
            <option value="tiktok">TikTok</option>
            <option value="instagram">Instagram</option>
            <option value="shorts">YouTube Shorts</option>
            <option value="twitter">Twitter/X</option>
            <option value="linkedin">LinkedIn</option>
            <option value="blog">Blog</option>
            <option value="newsletter">Newsletter</option>
          </select>
        </div>
        <div>
          <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Status</label>
          <select id="cal-status"
            style="width:100%;padding:10px;background:#111;border:1px solid #333;border-radius:8px;color:#fff;font-size:14px;">
            <option value="planned">Planned</option>
            <option value="drafted">Drafted</option>
            <option value="ready">Ready</option>
            <option value="published">Published</option>
          </select>
        </div>
      </div>
      <div style="margin-bottom:12px;">
        <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Notes</label>
        <textarea id="cal-notes" rows="3" placeholder="Any notes..."
          style="width:100%;padding:10px;background:#111;border:1px solid #333;border-radius:8px;color:#fff;font-size:13px;resize:vertical;"></textarea>
      </div>
      <div style="margin-bottom:12px;padding:12px;background:rgba(108,92,231,0.08);border:1px solid rgba(108,92,231,0.2);border-radius:8px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <input type="checkbox" id="cal-reminder" style="width:16px;height:16px;accent-color:#a29bfe;cursor:pointer;">
          <label for="cal-reminder" style="font-size:13px;color:#e0e0e0;cursor:pointer;">📧 Email me a posting reminder</label>
        </div>
        <div id="cal-reminder-fields" style="display:none;">
          <input type="email" id="cal-reminder-email" placeholder="your@email.com"
            style="width:100%;padding:8px 10px;background:#111;border:1px solid #333;border-radius:6px;color:#fff;font-size:13px;margin-bottom:6px;">
          <select id="cal-reminder-time" style="width:100%;padding:8px 10px;background:#111;border:1px solid #333;border-radius:6px;color:#fff;font-size:13px;">
            <option value="30">30 minutes before</option>
            <option value="60">1 hour before</option>
            <option value="120">2 hours before</option>
            <option value="1440">1 day before</option>
          </select>
          <p style="font-size:10px;color:#888;margin:6px 0 0 0;">We will send you a reminder email before your scheduled post time.</p>
        </div>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary" onclick="saveCalendarEntry()" style="flex:1;">Save</button>
        <button class="btn" onclick="closeCalendarModal()" style="background:rgba(255,255,255,0.15);color:#fff;flex:1;border:1px solid rgba(255,255,255,0.2);">Cancel</button>
      </div>
      <button class="btn" id="cal-delete-btn" onclick="deleteCalendarEntry()" style="background:rgba(255,0,0,0.15);color:#ff6b6b;border:1px solid rgba(255,0,0,0.3);display:none;width:100%;margin-top:10px;padding:10px;">🗑️ Delete This Entry</button>
    </div>
  </div>

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
        if (!data.analysis) {
          throw new Error(data.error || 'Analysis data not found');
        }
        const analysis = data.analysis;
        const videoId = getVideoId(analysis.video_url || '');

        // Build transcript viewer with keyword highlights
        // Ensure moments is an array
        if (typeof analysis.moments === 'string') {
          try { analysis.moments = JSON.parse(analysis.moments); } catch(e) { analysis.moments = []; }
        }
        if (!Array.isArray(analysis.moments)) analysis.moments = [];

        const transcriptHtml = buildTranscriptViewer(analysis.transcript || '', analysis.moments, videoId);

        const html = \`
          <div class="modal-header">
            <h2 class="modal-title">\${analysis.video_title || 'Analysis'}</h2>
            <div style="display:flex; gap:8px; align-items:center; margin-top:8px;">
              <p style="color: #888; flex:1;">\${analysis.moments?.length || 0} viral moments found</p>
              <button class="btn btn-small" style="background:rgba(108,92,231,0.2);color:#a29bfe;font-size:12px;"
                onclick="document.getElementById('transcriptPanel').style.display = document.getElementById('transcriptPanel').style.display === 'none' ? 'block' : 'none'">
                View Transcript
              </button>
              <button class="btn btn-small" style="background:rgba(16,185,129,0.2);color:#10b981;font-size:12px;"
                onclick="exportAllClips('\${id}')">
                Export All (ZIP)
              </button>
            </div>
          </div>
          <div id="transcriptPanel" style="display:none; padding:0 16px 16px; max-height:300px; overflow-y:auto;
            background:rgba(0,0,0,0.3); margin:0 16px 16px; border-radius:8px;">
            <div style="position:sticky;top:0;background:rgba(0,0,0,0.9);padding:10px 0 8px;z-index:1;">
              <input type="text" id="transcriptSearch" placeholder="Search transcript..."
                style="width:100%;padding:8px 12px;background:#111;border:1px solid #333;border-radius:6px;color:#fff;font-size:13px;"
                oninput="filterTranscript(this.value)">
            </div>
            <div id="transcriptContent">\${transcriptHtml}</div>
          </div>
          <div id="momentsContainer"></div>
        \`;

        document.getElementById('modalBody').innerHTML = html;

        const container = document.getElementById('momentsContainer');
        (analysis.moments).forEach((moment, idx) => {
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
              <div class="moment-score" style="cursor:pointer;" onclick="event.stopPropagation();showViralityBreakdown('\${id}', \${idx})" title="Click for virality breakdown">\${moment.viralityScore}%</div>
            </div>
            \${videoEmbed}
            <div class="moment-card-desc">\${moment.description}</div>
            <div style="margin-top:8px;">
              <div style="height:4px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden;">
                <div style="height:100%;width:\${moment.viralityScore}%;background:linear-gradient(90deg,\${moment.viralityScore >= 80 ? '#10b981' : moment.viralityScore >= 60 ? '#f39c12' : '#ff6b6b'},\${moment.viralityScore >= 80 ? '#00b894' : moment.viralityScore >= 60 ? '#e67e22' : '#ff4757'});border-radius:2px;transition:width 0.5s;"></div>
              </div>
              <div style="display:flex;justify-content:space-between;margin-top:4px;">
                <span style="font-size:10px;color:\${moment.viralityScore >= 80 ? '#10b981' : moment.viralityScore >= 60 ? '#f39c12' : '#ff6b6b'};">\${moment.viralityScore >= 80 ? 'High Viral Potential' : moment.viralityScore >= 60 ? 'Good Potential' : 'Moderate Potential'}</span>
                <span style="font-size:10px;color:var(--text-muted);">\${(moment.keyThemes || []).slice(0,3).join(', ')}</span>
              </div>
            </div>
            <div style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
              <button class="btn btn-small btn-primary" onclick="generateContent('\${id}', '\${moment.timeRange}')">
                Generate Content
              </button>
              <button class="btn btn-small" id="clip-btn-\${idx}"
                style="background: linear-gradient(135deg, #FF0050 0%, #FF4500 100%); color: #fff;"
                onclick="downloadClip('\${id}', \${idx}, this)">
                Download Clip
              </button>
              <label style="display:flex; align-items:center; gap:4px; cursor:pointer; font-size:12px; color:var(--text-muted);"
                title="Burn animated captions into the clip">
                <input type="checkbox" id="captions-\${idx}" checked
                  style="accent-color:#FF0050; width:14px; height:14px;">
                <span>Captions</span>
              </label>
              <select id="clip-style-\${idx}" style="font-size:11px; padding:4px 6px; background:#1a1a2e; color:#ccc;
                border:1px solid #333; border-radius:4px; cursor:pointer;" title="Clip style">
                <option value="blur">Blur BG</option>
                <option value="crop">Center Crop</option>
                <option value="fit">Fit (Black BG)</option>
                <option value="pip">Picture-in-Picture</option>
              </select>
              <button class="btn btn-small" id="thumb-btn-\${idx}"
                style="background: linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%); color: #fff; font-size: 11px;"
                onclick="generateThumbnail('\${id}', \${idx}, this)">
                Thumbnail
              </button>
              <button class="btn btn-small" id="broll-btn-\${idx}"
                style="background: linear-gradient(135deg, #f39c12 0%, #e67e22 100%); color: #fff; font-size: 11px;"
                onclick="findBRoll('\${id}', \${idx}, this)">
                🎬 Auto B-Roll
              </button>
              <select id="thumb-style-\${idx}" style="font-size:11px; padding:4px 6px; background:#1a1a2e; color:#ccc;
                border:1px solid #333; border-radius:4px; cursor:pointer;" title="Thumbnail style">
                <option value="gradient">Gradient</option>
                <option value="dark">Dark Overlay</option>
                <option value="border">Color Border</option>
                <option value="split">Split Design</option>
              </select>
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
      // Show content type selector
      const html = \`
        <div class="modal-header">
          <h2 class="modal-title">Generate Content</h2>
        </div>
        <div style="padding: 16px;">
          <p style="color: var(--text-muted); margin-bottom: 16px;">Choose what to generate:</p>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin-bottom: 20px;">
            <label style="display:flex;align-items:center;gap:6px;padding:10px;background:rgba(255,255,255,0.05);border-radius:8px;cursor:pointer;">
              <input type="checkbox" class="content-type-cb" value="tiktok" checked style="accent-color:#FF0050;"> TikTok
            </label>
            <label style="display:flex;align-items:center;gap:6px;padding:10px;background:rgba(255,255,255,0.05);border-radius:8px;cursor:pointer;">
              <input type="checkbox" class="content-type-cb" value="instagram" checked style="accent-color:#FF0050;"> Instagram
            </label>
            <label style="display:flex;align-items:center;gap:6px;padding:10px;background:rgba(255,255,255,0.05);border-radius:8px;cursor:pointer;">
              <input type="checkbox" class="content-type-cb" value="shorts" checked style="accent-color:#FF0050;"> YT Shorts
            </label>
            <label style="display:flex;align-items:center;gap:6px;padding:10px;background:rgba(255,255,255,0.05);border-radius:8px;cursor:pointer;">
              <input type="checkbox" class="content-type-cb" value="twitter" checked style="accent-color:#FF0050;"> Twitter/X
            </label>
            <label style="display:flex;align-items:center;gap:6px;padding:10px;background:rgba(255,255,255,0.05);border-radius:8px;cursor:pointer;">
              <input type="checkbox" class="content-type-cb" value="linkedin" checked style="accent-color:#FF0050;"> LinkedIn
            </label>
            <label style="display:flex;align-items:center;gap:6px;padding:10px;background:rgba(255,255,255,0.05);border-radius:8px;cursor:pointer;">
              <input type="checkbox" class="content-type-cb" value="thread" style="accent-color:#FF0050;"> X Thread
            </label>
            <label style="display:flex;align-items:center;gap:6px;padding:10px;background:rgba(255,255,255,0.05);border-radius:8px;cursor:pointer;">
              <input type="checkbox" class="content-type-cb" value="blog" style="accent-color:#FF0050;"> Blog Post
            </label>
            <label style="display:flex;align-items:center;gap:6px;padding:10px;background:rgba(255,255,255,0.05);border-radius:8px;cursor:pointer;">
              <input type="checkbox" class="content-type-cb" value="newsletter" style="accent-color:#FF0050;"> Newsletter
            </label>
          </div>
          <button class="btn btn-primary" id="gen-content-btn" onclick="doGenerateContent('\${analysisId}', '\${momentId}')"
            style="width:100%;">
            Generate Selected Content
          </button>
        </div>
      \`;
      document.getElementById('modalBody').innerHTML = html;
      document.getElementById('analysisModal').classList.add('active');
    }

    async function doGenerateContent(analysisId, momentId) {
      const checkboxes = document.querySelectorAll('.content-type-cb:checked');
      const platforms = Array.from(checkboxes).map(cb => cb.value);
      if (platforms.length === 0) { showToast('Select at least one content type'); return; }

      const btn = document.getElementById('gen-content-btn');
      btn.disabled = true;
      btn.textContent = 'Generating ' + platforms.length + ' pieces...';

      try {
        const response = await fetch('/shorts/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ momentId, analysisId, platforms })
        });

        const data = await response.json();
        if (data.success) {
          showGeneratedContent(data.content);
        } else {
          throw new Error(data.error || 'Generation failed');
        }
      } catch (error) {
        showToast('Error: ' + error.message);
        btn.disabled = false;
        btn.textContent = 'Generate Selected Content';
      }
    }

    let _generatedContent = [];

    function copyToClipboard(text, btn) {
      navigator.clipboard.writeText(text).then(() => {
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        btn.style.background = '#10b981';
        setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 1500);
      });
    }

    function copyField(panelIdx, field) {
      const item = _generatedContent[panelIdx];
      if (!item) return;
      let text = '';
      if (field === 'hook') text = item.hook || '';
      else if (field === 'script') text = item.script || '';
      else if (field === 'caption') text = item.caption || '';
      else if (field === 'all') {
        text = [item.hook, item.script, (item.hashtags||[]).map(h => h.startsWith('#') ? h : '#'+h).join(' ')].filter(Boolean).join('\\n\\n');
      }
      const btn = event.target;
      navigator.clipboard.writeText(text).then(() => {
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        btn.style.background = '#10b981';
        setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 1500);
      });
    }

    function showGeneratedContent(content) {
      _generatedContent = content;
      const platformLabels = {
        tiktok: 'TikTok', instagram: 'Instagram', shorts: 'YT Shorts',
        twitter: 'Twitter/X', linkedin: 'LinkedIn', blog: 'Blog Post',
        newsletter: 'Newsletter', thread: 'X Thread'
      };
      const platformColors = {
        tiktok: '#FF0050', instagram: '#E1306C', shorts: '#FF0000',
        twitter: '#000', linkedin: '#0077B5', blog: '#6c5ce7',
        newsletter: '#f39c12', thread: '#1DA1F2'
      };

      // Build tabs
      const tabs = content.map((item, i) => \`
        <button class="content-tab" data-idx="\${i}"
          style="padding:8px 14px; border:none; border-radius:6px; cursor:pointer; font-size:12px; font-weight:600;
            background:\${i === 0 ? platformColors[item.platform] || '#6c5ce7' : 'rgba(255,255,255,0.08)'};
            color:\${i === 0 ? '#fff' : 'var(--text-muted)'};"
          onclick="switchContentTab(\${i})">
          \${platformLabels[item.platform] || item.platform}
        </button>
      \`).join('');

      // Build content panels
      const panels = content.map((item, i) => {
        const isLong = ['blog', 'newsletter', 'thread'].includes(item.platform);
        const escHtml = (s) => (s||'N/A').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

        return \`
          <div class="content-panel" id="content-panel-\${i}" style="display:\${i === 0 ? 'block' : 'none'};">
            \${item.title ? '<h3 style="margin-bottom:12px;color:#fff;">' + escHtml(item.title) + '</h3>' : ''}

            <div style="background:#0a0a0a;padding:14px;border-radius:8px;margin-bottom:10px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span style="font-size:11px;color:#888;text-transform:uppercase;">Hook</span>
                <button class="btn btn-small" style="font-size:11px;padding:2px 8px;background:rgba(255,255,255,0.1);"
                  onclick="copyField(\${i},'hook')">Copy</button>
              </div>
              <div style="font-size:14px;font-weight:600;">\${escHtml(item.hook)}</div>
            </div>

            <div style="background:#0a0a0a;padding:14px;border-radius:8px;margin-bottom:10px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span style="font-size:11px;color:#888;text-transform:uppercase;">\${isLong ? 'Full Content' : 'Script'}</span>
                <button class="btn btn-small" style="font-size:11px;padding:2px 8px;background:rgba(255,255,255,0.1);"
                  onclick="copyField(\${i},'script')">Copy</button>
              </div>
              <div style="font-size:13px;line-height:1.7;white-space:pre-wrap;\${isLong ? 'max-height:300px;overflow-y:auto;' : ''}">\${escHtml(item.script)}</div>
            </div>

            <div style="background:#0a0a0a;padding:14px;border-radius:8px;margin-bottom:10px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span style="font-size:11px;color:#888;text-transform:uppercase;">Caption / Description</span>
                <button class="btn btn-small" style="font-size:11px;padding:2px 8px;background:rgba(255,255,255,0.1);"
                  onclick="copyField(\${i},'caption')">Copy</button>
              </div>
              <div style="font-size:13px;">\${escHtml(item.caption)}</div>
            </div>

            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
              \${(item.hashtags || []).map(h => '<span style="background:rgba(108,92,231,0.2);color:#a29bfe;padding:3px 8px;border-radius:4px;font-size:12px;">' + (h.startsWith('#') ? h : '#' + h) + '</span>').join('')}
            </div>

            \${item.postingTips ? '<div style="background:rgba(255,255,255,0.03);padding:10px;border-radius:6px;font-size:12px;color:var(--text-muted);margin-bottom:10px;"><strong>Tips:</strong> ' + escHtml(item.postingTips) + '</div>' : ''}

            <div style="display:flex;gap:8px;margin-top:4px;">
              <button class="btn btn-primary" style="flex:1;"
                onclick="copyField(\${i},'all')">
                Copy All Content
              </button>
              <button class="btn" style="background:rgba(108,92,231,0.2);color:#a29bfe;"
                onclick="showPlatformPreview(\${i})">
                Preview
              </button>
            </div>
          </div>
        \`;
      }).join('');

      const html = \`
        <div class="modal-header">
          <h2 class="modal-title">Generated Content</h2>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;padding:0 16px 12px;border-bottom:1px solid #222;">
          \${tabs}
        </div>
        <div style="padding:16px;max-height:500px;overflow-y:auto;">
          \${panels}
        </div>
      \`;
      document.getElementById('modalBody').innerHTML = html;
    }

    function showPlatformPreview(contentIdx) {
      const item = _generatedContent[contentIdx];
      if (!item) return;
      const p = item.platform;
      const escHtml = (s) => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const caption = escHtml(item.caption || '').substring(0, 200);
      const hook = escHtml(item.hook || '');
      const hashtags = (item.hashtags || []).map(h => '<span style="color:#6c5ce7;">' + (h.startsWith('#') ? h : '#'+h) + '</span>').join(' ');
      const truncScript = escHtml((item.script || '').substring(0, 140));

      let mockup = '';
      if (p === 'tiktok' || p === 'shorts') {
        // Vertical phone mockup
        mockup = '<div style="width:270px;height:480px;background:#000;border-radius:24px;border:3px solid #333;margin:auto;position:relative;overflow:hidden;padding:16px;">' +
          '<div style="position:absolute;top:0;left:0;right:0;height:40px;background:linear-gradient(180deg,rgba(0,0,0,0.8),transparent);z-index:2;display:flex;align-items:center;justify-content:center;padding-top:8px;">' +
            '<span style="font-size:10px;color:#fff;opacity:0.6;">' + (p==='tiktok'?'For You':'Shorts') + '</span>' +
          '</div>' +
          '<div style="background:linear-gradient(135deg,#1a1a2e,#16213e);width:100%;height:100%;border-radius:16px;display:flex;flex-direction:column;justify-content:flex-end;padding:12px;">' +
            '<div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:6px;">@yourbrand</div>' +
            '<div style="font-size:11px;color:#eee;line-height:1.4;margin-bottom:8px;">' + caption + '</div>' +
            '<div style="font-size:10px;line-height:1.4;">' + hashtags + '</div>' +
          '</div>' +
          '<div style="position:absolute;right:8px;bottom:80px;display:flex;flex-direction:column;align-items:center;gap:16px;">' +
            '<div style="width:28px;height:28px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;">&#x2764;</div>' +
            '<div style="width:28px;height:28px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;">&#x1F4AC;</div>' +
            '<div style="width:28px;height:28px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;">&#x27A1;</div>' +
          '</div>' +
        '</div>';
      } else if (p === 'instagram') {
        mockup = '<div style="width:320px;background:#000;border-radius:16px;border:3px solid #333;margin:auto;overflow:hidden;">' +
          '<div style="padding:10px 12px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #222;">' +
            '<div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#f09433,#dc2743,#bc1888);"></div>' +
            '<span style="font-size:12px;font-weight:600;color:#fff;">yourbrand</span>' +
          '</div>' +
          '<div style="width:100%;aspect-ratio:1;background:linear-gradient(135deg,#1a1a2e,#16213e);display:flex;align-items:center;justify-content:center;padding:20px;">' +
            '<p style="font-size:16px;font-weight:700;color:#fff;text-align:center;line-height:1.4;">' + hook + '</p>' +
          '</div>' +
          '<div style="padding:10px 12px;">' +
            '<div style="display:flex;gap:12px;margin-bottom:8px;">' +
              '<span style="font-size:18px;">&#x2764;</span><span style="font-size:18px;">&#x1F4AC;</span><span style="font-size:18px;">&#x27A1;</span>' +
            '</div>' +
            '<div style="font-size:11px;color:#ccc;line-height:1.4;">' +
              '<strong style="color:#fff;">yourbrand</strong> ' + caption.substring(0,120) + '...' +
            '</div>' +
            '<div style="font-size:10px;margin-top:4px;">' + hashtags + '</div>' +
          '</div>' +
        '</div>';
      } else if (p === 'twitter' || p === 'thread') {
        const tweetText = p === 'thread' ? escHtml((item.script||'').split('\\n')[0] || hook) : caption;
        mockup = '<div style="width:360px;background:#000;border-radius:16px;border:1px solid #333;margin:auto;padding:16px;">' +
          '<div style="display:flex;gap:10px;">' +
            '<div style="width:36px;height:36px;border-radius:50%;background:#333;flex-shrink:0;"></div>' +
            '<div style="flex:1;">' +
              '<div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">' +
                '<span style="font-size:13px;font-weight:700;color:#fff;">Your Brand</span>' +
                '<span style="font-size:12px;color:#666;">@yourbrand</span>' +
              '</div>' +
              '<div style="font-size:14px;color:#e7e9ea;line-height:1.5;margin-bottom:10px;">' + tweetText.substring(0,280) + '</div>' +
              (p==='thread' ? '<div style="font-size:11px;color:#6c5ce7;margin-bottom:8px;">Show this thread</div>' : '') +
              '<div style="display:flex;gap:40px;margin-top:8px;">' +
                '<span style="font-size:12px;color:#666;">&#x1F4AC; 24</span>' +
                '<span style="font-size:12px;color:#666;">&#x1F504; 142</span>' +
                '<span style="font-size:12px;color:#666;">&#x2764; 1.2K</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      } else if (p === 'linkedin') {
        mockup = '<div style="width:360px;background:#1b1f23;border-radius:12px;border:1px solid #333;margin:auto;overflow:hidden;">' +
          '<div style="padding:12px 16px;display:flex;align-items:center;gap:10px;">' +
            '<div style="width:40px;height:40px;border-radius:50%;background:#0077b5;display:flex;align-items:center;justify-content:center;font-size:16px;color:#fff;font-weight:700;">Y</div>' +
            '<div><div style="font-size:13px;font-weight:600;color:#fff;">Your Brand</div><div style="font-size:11px;color:#888;">Content Creator</div></div>' +
          '</div>' +
          '<div style="padding:0 16px 12px;font-size:13px;color:#ccc;line-height:1.6;">' + caption.substring(0,250) + '</div>' +
          '<div style="padding:0 16px 8px;font-size:10px;">' + hashtags + '</div>' +
          '<div style="border-top:1px solid #333;padding:8px 16px;display:flex;justify-content:space-around;">' +
            '<span style="font-size:12px;color:#888;">Like</span><span style="font-size:12px;color:#888;">Comment</span><span style="font-size:12px;color:#888;">Share</span>' +
          '</div>' +
        '</div>';
      } else {
        // Blog / Newsletter - card preview
        mockup = '<div style="width:380px;background:#fff;border-radius:12px;margin:auto;overflow:hidden;color:#111;">' +
          '<div style="height:120px;background:linear-gradient(135deg,#6c5ce7,#a29bfe);display:flex;align-items:center;justify-content:center;">' +
            '<span style="font-size:20px;font-weight:800;color:#fff;text-align:center;padding:0 20px;">' + hook + '</span>' +
          '</div>' +
          '<div style="padding:16px;">' +
            '<p style="font-size:13px;color:#444;line-height:1.6;">' + truncScript + '...</p>' +
            '<div style="margin-top:12px;padding-top:12px;border-top:1px solid #eee;font-size:11px;color:#888;">' +
              (p==='newsletter' ? 'Email Newsletter Preview' : 'Blog Post Preview') +
            '</div>' +
          '</div>' +
        '</div>';
      }

      const previewModal = '<div id="platformPreviewOverlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:10000;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;" onclick="this.remove()">' +
        '<div style="margin-bottom:16px;text-align:center;">' +
          '<h3 style="color:#fff;font-size:16px;margin-bottom:4px;">' +
            ({'tiktok':'TikTok','instagram':'Instagram','shorts':'YouTube Shorts','twitter':'Twitter/X','linkedin':'LinkedIn','thread':'X Thread','blog':'Blog Post','newsletter':'Newsletter'}[p] || p) + ' Preview</h3>' +
          '<p style="color:#888;font-size:12px;">Click anywhere to close</p>' +
        '</div>' +
        mockup +
      '</div>';

      // Remove existing overlay if any
      const existing = document.getElementById('platformPreviewOverlay');
      if (existing) existing.remove();
      document.body.insertAdjacentHTML('beforeend', previewModal);
    }

    function switchContentTab(idx) {
      document.querySelectorAll('.content-panel').forEach((p, i) => {
        p.style.display = i === idx ? 'block' : 'none';
      });
      document.querySelectorAll('.content-tab').forEach((t, i) => {
        t.style.background = i === idx ? t.dataset.color || '#6c5ce7' : 'rgba(255,255,255,0.08)';
        t.style.color = i === idx ? '#fff' : 'var(--text-muted)';
      });
    }

    async function downloadClip(analysisId, momentIndex, btn) {
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Starting...';

      // Check options
      const captionsCheckbox = document.getElementById('captions-' + momentIndex);
      const includeCaptions = captionsCheckbox ? captionsCheckbox.checked : false;
      const styleSelect = document.getElementById('clip-style-' + momentIndex);
      const clipStyle = styleSelect ? styleSelect.value : 'blur';

      try {
        // Request clip generation
        const response = await fetch('/shorts/clip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ analysisId, momentIndex, includeCaptions, clipStyle })
        });

        const data = await response.json();
        if (!data.success) {
          throw new Error(data.error || 'Failed to start clip generation');
        }

        const filename = data.filename;
        btn.textContent = 'Processing...';
        btn.style.background = 'linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%)';
        btn.style.color = '#fff';

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

    // === Workflow Templates ===
    let activeWorkflow = null;
    const workflows = {
      'yt-tiktok': { clipStyle: 'blur', captions: true, platforms: ['tiktok', 'instagram'], name: 'YouTube to TikTok' },
      'yt-shorts': { clipStyle: 'crop', captions: true, platforms: ['shorts'], name: 'YouTube to YT Shorts' },
      'yt-linkedin': { clipStyle: 'fit', captions: false, platforms: ['linkedin', 'blog'], name: 'YouTube to LinkedIn' },
      'yt-all': { clipStyle: 'blur', captions: true, platforms: ['tiktok','instagram','shorts','twitter','linkedin','thread','blog','newsletter'], name: 'YouTube to Everything' },
      'podcast': { clipStyle: 'pip', captions: true, platforms: ['twitter', 'thread', 'newsletter'], name: 'Podcast to Clips' },
      'education': { clipStyle: 'fit', captions: true, platforms: ['blog', 'linkedin'], name: 'Education to Blog' }
    };

    function toggleWorkflows() {
      const panel = document.getElementById('workflowPanel');
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }

    function applyWorkflow(workflowId) {
      activeWorkflow = workflows[workflowId];
      if (!activeWorkflow) return;

      showToast('Workflow "' + activeWorkflow.name + '" active! Analyze a video to use it.');
      document.getElementById('workflowPanel').style.display = 'none';

      // Show active workflow badge
      const toggle = document.getElementById('workflowToggle');
      toggle.innerHTML = 'Workflow: <strong>' + activeWorkflow.name + '</strong> <span style="font-size:10px;cursor:pointer;" onclick="event.stopPropagation();clearWorkflow();">&times;</span>';
      toggle.style.background = 'rgba(243,156,18,0.3)';
    }

    function clearWorkflow() {
      activeWorkflow = null;
      const toggle = document.getElementById('workflowToggle');
      toggle.textContent = 'Workflow Templates';
      toggle.style.background = 'rgba(243,156,18,0.12)';
      showToast('Workflow cleared');
    }

    // Override viewAnalysis to apply workflow settings
    const _origViewAnalysis = viewAnalysis;
    viewAnalysis = async function(id) {
      await _origViewAnalysis(id);
      if (activeWorkflow) {
        // Apply workflow settings to all moment cards
        setTimeout(() => {
          const moments = document.querySelectorAll('.moment-card');
          moments.forEach((card, idx) => {
            const styleSelect = document.getElementById('clip-style-' + idx);
            if (styleSelect) styleSelect.value = activeWorkflow.clipStyle;
            const captionsCheck = document.getElementById('captions-' + idx);
            if (captionsCheck) captionsCheck.checked = activeWorkflow.captions;
          });
        }, 100);
      }
    };

    // === Content Calendar ===
    let calendarMonth = new Date().getMonth();
    let calendarYear = new Date().getFullYear();
    let calendarEntries = [];

    const platformEmojis = {
      tiktok: '&#9834;', instagram: '&#x1F4F7;', shorts: '&#x25B6;',
      twitter: '&#x1F426;', linkedin: 'in', blog: '&#x270F;', newsletter: '&#x2709;'
    };
    const statusColors = {
      planned: '#6c5ce7', drafted: '#f39c12', ready: '#10b981', published: '#00b894'
    };

    function changeCalendarMonth(delta) {
      calendarMonth += delta;
      if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
      if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
      renderCalendar();
    }

    async function renderCalendar() {
      const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      document.getElementById('calendarMonthLabel').textContent = months[calendarMonth] + ' ' + calendarYear;

      const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
      const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
      const startDate = calendarYear + '-' + String(calendarMonth+1).padStart(2,'0') + '-01';
      const endDate = calendarYear + '-' + String(calendarMonth+1).padStart(2,'0') + '-' + String(daysInMonth).padStart(2,'0');

      try {
        const resp = await fetch('/shorts/calendar?start=' + startDate + '&end=' + endDate);
        const data = await resp.json();
        calendarEntries = data.entries || [];
      } catch (e) { calendarEntries = []; }

      const grid = document.getElementById('calendarGrid');
      let html = '';

      // Day headers
      ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d => {
        html += '<div style="padding:8px;text-align:center;font-size:11px;color:var(--text-muted);font-weight:600;background:rgba(255,255,255,0.03);">' + d + '</div>';
      });

      // Empty cells before first day
      for (let i = 0; i < firstDay; i++) {
        html += '<div style="padding:8px;min-height:80px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.03);"></div>';
      }

      const today = new Date();
      const todayStr = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');

      // Day cells
      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = calendarYear + '-' + String(calendarMonth+1).padStart(2,'0') + '-' + String(day).padStart(2,'0');
        const isToday = dateStr === todayStr;
        const dayEntries = calendarEntries.filter(e => {
          const ed = (e.scheduled_date || '').substring(0,10);
          return ed === dateStr;
        });

        var bgColor = isToday ? 'rgba(108,92,231,0.15)' : 'rgba(255,255,255,0.04)';
        var borderStyle = isToday ? 'border:1px solid rgba(108,92,231,0.4)' : 'border:1px solid rgba(255,255,255,0.06)';
        html += '<div style="padding:6px;min-height:80px;background:' + bgColor +
          ';cursor:pointer;transition:background 0.2s;' + borderStyle + ';" onclick="openAddEntry(' + "'" + dateStr + "'" + ')" ' +
          'onmouseover="this.style.background=' + "'" + 'rgba(108,92,231,0.12)' + "'" + '" onmouseout="this.style.background=' + "'" + bgColor + "'" + '">' +
          '<div style="font-size:12px;font-weight:' + (isToday ? '700' : '500') + ';color:' + (isToday ? '#a29bfe' : '#bbb') + ';margin-bottom:4px;">' + day + '</div>';

        dayEntries.forEach(entry => {
          const sc = statusColors[entry.status] || '#6c5ce7';
          html += '<div style="font-size:10px;padding:3px 5px;margin-bottom:2px;background:' + sc + '22;border-left:2px solid ' + sc +
            ';border-radius:3px;color:#ccc;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;position:relative;" ' +
            'onclick="event.stopPropagation();editCalendarEntry(' + "'" + entry.id + "'" + ')" title="Click to edit or delete: ' + (entry.title || '').replace(/"/g,'&amp;quot;') + '">' +
            (platformEmojis[entry.platform] || '') + ' ' + (entry.title || '').substring(0,15) +
            '<span style="position:absolute;right:2px;top:50%;transform:translateY(-50%);font-size:8px;opacity:0.5;">&#9998;</span>' +
          '</div>';
        });

        html += '</div>';
      }

      grid.innerHTML = html;
    }

    function openAddEntry(dateStr) {
      // Check if this day has existing entries
      var dayEntries = calendarEntries.filter(function(e) {
        return (e.scheduled_date || '').substring(0,10) === dateStr;
      });

      if (dayEntries.length > 0) {
        // Show the day modal with existing entries + option to add
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        var d = new Date(dateStr + 'T12:00:00');
        document.getElementById('dayModalTitle').textContent = months[d.getMonth()] + ' ' + d.getDate() + ' — ' + dayEntries.length + ' entr' + (dayEntries.length === 1 ? 'y' : 'ies');

        var statusColors2 = { planned: '#6c5ce7', drafted: '#fdcb6e', ready: '#00b894', published: '#0984e3' };
        var platformEmojis2 = { tiktok: '🎵', instagram: '📸', shorts: '🎬', twitter: '🐦', linkedin: '💼', blog: '📝', newsletter: '📧' };

        var listHtml = '';
        dayEntries.forEach(function(entry) {
          var sc = statusColors2[entry.status] || '#6c5ce7';
          listHtml += '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;margin-bottom:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-left:3px solid ' + sc + ';border-radius:8px;">' +
            '<div style="flex:1;min-width:0;">' +
              '<div style="font-size:14px;color:#e0e0e0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (platformEmojis2[entry.platform] || '') + ' ' + (entry.title || 'Untitled') + '</div>' +
              '<div style="font-size:11px;color:#888;margin-top:2px;">' + (entry.status || 'planned') + (entry.scheduled_time ? ' at ' + entry.scheduled_time : '') + '</div>' +
            '</div>' +
            '<div style="display:flex;gap:6px;flex-shrink:0;margin-left:8px;">' +
              '<button class="btn btn-small" style="font-size:11px;background:rgba(108,92,231,0.2);color:#a29bfe;padding:6px 10px;" onclick="document.getElementById(' + "'" + 'calendarDayModal' + "'" + ').style.display=' + "'" + 'none' + "'" + ';editCalendarEntry(' + "'" + entry.id + "'" + ')">Edit</button>' +
              '<button class="btn btn-small" style="font-size:11px;background:rgba(255,0,0,0.15);color:#ff6b6b;padding:6px 10px;" onclick="quickDeleteEntry(' + "'" + entry.id + "'" + ')">Delete</button>' +
            '</div>' +
          '</div>';
        });

        document.getElementById('dayModalEntries').innerHTML = listHtml;
        document.getElementById('dayModalAddBtn').onclick = function() {
          document.getElementById('calendarDayModal').style.display = 'none';
          openNewEntry(dateStr);
        };
        document.getElementById('calendarDayModal').style.display = 'flex';
      } else {
        // No entries — go straight to add form
        openNewEntry(dateStr);
      }
    }

    function openNewEntry(dateStr) {
      document.getElementById('cal-entry-id').value = '';
      document.getElementById('cal-title').value = '';
      document.getElementById('cal-date').value = dateStr || new Date().toISOString().split('T')[0];
      document.getElementById('cal-time').value = '12:00';
      document.getElementById('cal-platform').value = 'tiktok';
      document.getElementById('cal-status').value = 'planned';
      document.getElementById('cal-notes').value = '';
      document.getElementById('cal-reminder').checked = false;
      document.getElementById('cal-reminder-fields').style.display = 'none';
      document.getElementById('cal-reminder-email').value = '';
      document.getElementById('cal-reminder-time').value = '30';
      document.getElementById('cal-delete-btn').style.display = 'none';
      document.getElementById('calEntryTitle').textContent = 'Add Calendar Entry';
      document.getElementById('calendarEntryModal').style.display = 'flex';
    }

    async function quickDeleteEntry(entryId) {
      if (!confirm('Delete this entry?')) return;
      try {
        await fetch('/shorts/calendar/' + entryId, { method: 'DELETE' });
        document.getElementById('calendarDayModal').style.display = 'none';
        renderCalendar();
        showToast('Entry deleted');
      } catch (e) { showToast('Error: ' + e.message); }
    }

    function editCalendarEntry(entryId) {
      const entry = calendarEntries.find(e => String(e.id) === String(entryId));
      if (!entry) return;
      document.getElementById('cal-entry-id').value = entry.id;
      document.getElementById('cal-title').value = entry.title || '';
      document.getElementById('cal-date').value = (entry.scheduled_date || '').substring(0,10);
      document.getElementById('cal-time').value = entry.scheduled_time || '12:00';
      document.getElementById('cal-platform').value = entry.platform || 'tiktok';
      document.getElementById('cal-status').value = entry.status || 'planned';
      document.getElementById('cal-notes').value = entry.notes || '';
      // Load reminder settings
      var hasReminder = entry.reminder_email && entry.reminder_email.trim();
      document.getElementById('cal-reminder').checked = !!hasReminder;
      document.getElementById('cal-reminder-fields').style.display = hasReminder ? 'block' : 'none';
      document.getElementById('cal-reminder-email').value = entry.reminder_email || '';
      document.getElementById('cal-reminder-time').value = entry.reminder_minutes || '30';
      document.getElementById('cal-delete-btn').style.display = 'block';
      document.getElementById('calEntryTitle').textContent = 'Edit Calendar Entry';
      document.getElementById('calendarEntryModal').style.display = 'flex';
    }

    function closeCalendarModal() {
      document.getElementById('calendarEntryModal').style.display = 'none';
    }

    async function saveCalendarEntry() {
      const entryId = document.getElementById('cal-entry-id').value;
      const reminderChecked = document.getElementById('cal-reminder').checked;
      const data = {
        title: document.getElementById('cal-title').value,
        scheduledDate: document.getElementById('cal-date').value,
        scheduledTime: document.getElementById('cal-time').value,
        platform: document.getElementById('cal-platform').value,
        status: document.getElementById('cal-status').value,
        notes: document.getElementById('cal-notes').value,
        reminderEmail: reminderChecked ? document.getElementById('cal-reminder-email').value : '',
        reminderMinutes: reminderChecked ? parseInt(document.getElementById('cal-reminder-time').value) : 0
      };
      if (!data.title || !data.scheduledDate) { showToast('Title and date required'); return; }
      if (reminderChecked && !data.reminderEmail) { showToast('Please enter your email for the reminder'); return; }

      try {
        const url = entryId ? '/shorts/calendar/' + entryId : '/shorts/calendar';
        const method = entryId ? 'PUT' : 'POST';
        const resp = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const result = await resp.json();
        if (result.success) {
          closeCalendarModal();
          renderCalendar();
          showToast(entryId ? 'Entry updated' : 'Entry added');
        } else {
          throw new Error(result.error);
        }
      } catch (e) { showToast('Error: ' + e.message); }
    }

    async function deleteCalendarEntry() {
      const entryId = document.getElementById('cal-entry-id').value;
      if (!entryId || !confirm('Delete this entry?')) return;
      try {
        await fetch('/shorts/calendar/' + entryId, { method: 'DELETE' });
        closeCalendarModal();
        renderCalendar();
        showToast('Entry deleted');
      } catch (e) { showToast('Error: ' + e.message); }
    }

    // Reminder checkbox toggle
    (function() {
      var cb = document.getElementById('cal-reminder');
      if (cb) {
        cb.addEventListener('change', function() {
          document.getElementById('cal-reminder-fields').style.display = this.checked ? 'block' : 'none';
          if (this.checked) {
            var emailField = document.getElementById('cal-reminder-email');
            if (!emailField.value) emailField.value = '${user.email || ''}';
          }
        });
      }
    })();

    // Initialize calendar
    renderCalendar();

    // === Batch Analysis & Export ===
    function toggleBatchInput() {
      const panel = document.getElementById('batchPanel');
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }

    async function startBatchAnalysis() {
      const textarea = document.getElementById('batchUrls');
      const urls = textarea.value.split('\\n').map(u => u.trim()).filter(u => u.length > 0);
      if (urls.length === 0) { showToast('Enter at least one URL'); return; }

      const btn = document.getElementById('batchBtn');
      const status = document.getElementById('batchStatus');
      btn.disabled = true;
      btn.textContent = 'Processing...';
      status.textContent = 'Sending ' + urls.length + ' videos for analysis...';

      try {
        const resp = await fetch('/shorts/batch-analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrls: urls })
        });
        const data = await resp.json();
        if (!data.success) throw new Error(data.error);

        status.textContent = 'Processing ' + data.totalVideos + ' videos... This may take a few minutes.';

        // Poll for completion
        const batchId = data.batchId;
        let attempts = 0;
        const poll = setInterval(async () => {
          attempts++;
          try {
            const sResp = await fetch('/shorts/batch-status/' + batchId);
            const sData = await sResp.json();
            if (sData.complete) {
              clearInterval(poll);
              const results = sData.results;
              const completed = results.filter(r => r.status === 'completed').length;
              const failed = results.filter(r => r.status === 'failed').length;

              status.textContent = completed + ' completed, ' + failed + ' failed';
              status.style.color = '#10b981';

              // Show results
              const resultsDiv = document.getElementById('batchResults');
              resultsDiv.style.display = 'block';
              resultsDiv.innerHTML = results.map(r =>
                '<div style="padding:8px 12px;background:' + (r.status === 'completed' ? 'rgba(16,185,129,0.1)' : 'rgba(255,107,107,0.1)') +
                ';border-radius:6px;margin-bottom:6px;font-size:13px;display:flex;justify-content:space-between;align-items:center;">' +
                  '<span>' + (r.title || r.videoId) + '</span>' +
                  (r.status === 'completed'
                    ? '<span style="color:#10b981;">' + r.momentCount + ' moments</span>'
                    : '<span style="color:#ff6b6b;">Failed</span>') +
                '</div>'
              ).join('');

              btn.disabled = false;
              btn.textContent = 'Analyze All';
              showToast('Batch analysis complete! Refresh to see all analyses.');
              setTimeout(() => location.reload(), 2000);
            } else if (attempts >= 180) {
              clearInterval(poll);
              status.textContent = 'Timed out. Some videos may still be processing.';
              btn.disabled = false;
              btn.textContent = 'Analyze All';
            } else {
              const dots = '.'.repeat((attempts % 3) + 1);
              status.textContent = 'Processing' + dots + ' (' + Math.round(attempts * 2/60) + ' min)';
            }
          } catch (e) {
            clearInterval(poll);
            status.textContent = 'Error checking status';
            btn.disabled = false;
            btn.textContent = 'Analyze All';
          }
        }, 2000);

      } catch (error) {
        showToast(error.message);
        btn.disabled = false;
        btn.textContent = 'Analyze All';
        status.textContent = '';
      }
    }

    async function exportAllClips(analysisId) {
      showToast('Preparing ZIP download...');
      try {
        const resp = await fetch('/shorts/export/' + analysisId);
        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          showToast(data.error || 'Export failed. Generate some clips first!', true);
          return;
        }
        // Download the ZIP blob
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const disposition = resp.headers.get('Content-Disposition') || '';
        const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
        a.download = filenameMatch ? filenameMatch[1] : 'clips_export.zip';
        a.href = url;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('ZIP downloaded!');
      } catch (err) {
        showToast('Export failed: ' + err.message, true);
      }
    }

    // === Virality Score Breakdown ===
    async function showViralityBreakdown(analysisId, momentIndex) {
      // Show loading overlay
      const overlayId = 'virality-overlay';
      const existing = document.getElementById(overlayId);
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = overlayId;
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:10000;display:flex;align-items:center;justify-content:center;';
      overlay.innerHTML = '<div style="background:#1a1a2e;border-radius:16px;padding:24px;max-width:480px;width:90%;max-height:80vh;overflow-y:auto;">' +
        '<div style="text-align:center;padding:20px;"><div style="font-size:24px;margin-bottom:8px;">Analyzing virality...</div><p style="color:#888;">Getting AI insights</p></div></div>';
      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
      document.body.appendChild(overlay);

      try {
        const resp = await fetch('/shorts/virality-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ analysisId, momentIndex })
        });
        const data = await resp.json();
        if (!data.success) throw new Error(data.error);

        const b = data.breakdown;
        const scoreBar = (label, value, color) =>
          '<div style="margin-bottom:10px;">' +
            '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">' +
              '<span style="color:#ccc;">' + label + '</span><span style="color:' + color + ';font-weight:600;">' + value + '%</span>' +
            '</div>' +
            '<div style="height:6px;background:rgba(255,255,255,0.1);border-radius:3px;">' +
              '<div style="height:100%;width:' + value + '%;background:' + color + ';border-radius:3px;transition:width 0.8s;"></div>' +
            '</div>' +
          '</div>';

        const getColor = (v) => v >= 80 ? '#10b981' : v >= 60 ? '#f39c12' : '#ff6b6b';

        let html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">' +
          '<h3 style="font-size:18px;">Virality Breakdown</h3>' +
          '<button class="btn btn-small" style="background:rgba(255,255,255,0.1);" onclick="document.getElementById(' + "'" + overlayId + "'" + ').remove()">Close</button>' +
        '</div>';

        // Score bars
        html += scoreBar('Hook Strength', b.hookStrength || 0, getColor(b.hookStrength || 0));
        html += scoreBar('Emotional Impact', b.emotionalImpact || 0, getColor(b.emotionalImpact || 0));
        html += scoreBar('Shareability', b.shareability || 0, getColor(b.shareability || 0));
        html += scoreBar('Trend Alignment', b.trendAlignment || 0, getColor(b.trendAlignment || 0));
        html += scoreBar('Audience Reach', b.audienceReach || 0, getColor(b.audienceReach || 0));

        // Meta info
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px 0;padding:12px;background:rgba(255,255,255,0.03);border-radius:8px;">' +
          '<div><div style="font-size:10px;color:#888;text-transform:uppercase;">Best Time</div><div style="font-size:13px;color:#fff;">' + (b.bestTimeToPost || 'N/A') + '</div></div>' +
          '<div><div style="font-size:10px;color:#888;text-transform:uppercase;">Predicted Views</div><div style="font-size:13px;color:#10b981;font-weight:600;">' + (b.predictedViews || 'N/A') + '</div></div>' +
          '<div style="grid-column:span 2;"><div style="font-size:10px;color:#888;text-transform:uppercase;">Target Audience</div><div style="font-size:13px;color:#ccc;">' + (b.targetAudience || 'N/A') + '</div></div>' +
        '</div>';

        // Boost tips
        if (b.boostTips && b.boostTips.length > 0) {
          html += '<h4 style="font-size:14px;margin-bottom:10px;color:#f39c12;">Boost Tips</h4>';
          b.boostTips.forEach((tip, i) => {
            html += '<div style="display:flex;gap:8px;margin-bottom:8px;padding:8px;background:rgba(243,156,18,0.08);border-radius:6px;">' +
              '<span style="color:#f39c12;font-weight:700;font-size:14px;">' + (i+1) + '.</span>' +
              '<span style="font-size:13px;color:#ccc;line-height:1.4;">' + tip + '</span>' +
            '</div>';
          });
        }

        overlay.querySelector('div > div').innerHTML = html;

      } catch (error) {
        overlay.querySelector('div > div').innerHTML =
          '<p style="color:#ff6b6b;text-align:center;">Error: ' + (error.message || 'Failed') + '</p>' +
          '<button class="btn" style="width:100%;margin-top:12px;background:rgba(255,255,255,0.1);" onclick="document.getElementById(' + "'" + overlayId + "'" + ').remove()">Close</button>';
      }
    }

    // === B-Roll Finder (Auto Scene Selector) ===
    // Store B-Roll data per moment for the download function
    var brollDataStore = {};

    async function findBRoll(analysisId, momentIndex, btn) {
      var originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'AI Picking Scenes...';

      try {
        var resp = await fetch('/shorts/broll-suggestions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ analysisId: analysisId, momentIndex: momentIndex })
        });
        var data = await resp.json();
        if (!data.success) throw new Error(data.error);

        // Store scene data for later use
        brollDataStore[momentIndex] = { analysisId: analysisId, scenes: data.scenes || [] };

        var panelId = 'broll-panel-' + momentIndex;
        var hasPexels = !data.message;
        var html = '<div style="margin-top:12px;background:rgba(243,156,18,0.04);border:1px solid rgba(243,156,18,0.2);border-radius:10px;padding:16px;" id="' + panelId + '">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
            '<div style="display:flex;align-items:center;gap:8px;">' +
              '<span style="font-size:18px;">🎬</span>' +
              '<h4 style="font-size:14px;color:#f39c12;margin:0;">AI-Selected B-Roll Scenes</h4>' +
            '</div>' +
            '<button class="btn btn-small" style="font-size:10px;background:rgba(255,255,255,0.1);" onclick="document.getElementById(' + "'" + panelId + "'" + ').remove()">Close</button>' +
          '</div>';

        if (data.message) {
          html += '<div style="margin-bottom:14px;padding:12px;background:rgba(243,156,18,0.08);border:1px solid rgba(243,156,18,0.2);border-radius:8px;">' +
            '<p style="font-size:13px;color:#f39c12;margin:0 0 8px 0;font-weight:600;">Setup Required for Auto B-Roll:</p>' +
            '<div style="font-size:12px;color:#ccc;line-height:1.6;">' +
              '<p style="margin:0 0 4px 0;">To auto-add B-Roll to your clips, add a free <strong>PEXELS_API_KEY</strong> to your Railway environment variables.</p>' +
              '<p style="margin:0 0 4px 0;">1. Go to <a href="https://www.pexels.com/api/" target="_blank" style="color:#a29bfe;font-weight:600;">pexels.com/api</a> (free signup)</p>' +
              '<p style="margin:0 0 4px 0;">2. Copy your API key</p>' +
              '<p style="margin:0 0 4px 0;">3. Add <strong>PEXELS_API_KEY</strong> in Railway env vars</p>' +
              '<p style="margin:8px 0 0 0;padding-top:8px;border-top:1px solid rgba(255,255,255,0.1);font-size:11px;color:#888;">Meanwhile, you can browse Pexels manually for each scene below.</p>' +
            '</div>' +
          '</div>';
        }

        if (data.scenes && data.scenes.length > 0) {
          // Instructions when Pexels is connected
          if (hasPexels) {
            html += '<div style="margin-bottom:14px;padding:10px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:8px;">' +
              '<p style="font-size:12px;color:#10b981;margin:0;line-height:1.5;">Select the scenes you want, choose where to place them, then click <strong>"Download Clip with B-Roll"</strong> — the B-Roll will be automatically spliced into your video!</p>' +
            '</div>';
          }

          data.scenes.forEach(function(scene, sIdx) {
            var timeBadgeColor = scene.timestamp_hint === 'beginning' ? '#00b894' : scene.timestamp_hint === 'middle' ? '#0984e3' : scene.timestamp_hint === 'end' ? '#e17055' : '#a29bfe';
            var cbId = 'broll-cb-' + momentIndex + '-' + sIdx;
            var posId = 'broll-pos-' + momentIndex + '-' + sIdx;
            var durId = 'broll-dur-' + momentIndex + '-' + sIdx;
            var hasVideo = scene.video && scene.video.videoFiles && scene.video.videoFiles.length > 0;

            html += '<div style="margin-bottom:14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:12px;">';

            // Checkbox + scene info header
            html += '<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px;">';
            if (hasVideo) {
              html += '<input type="checkbox" id="' + cbId + '" checked style="margin-top:3px;width:18px;height:18px;accent-color:#f39c12;cursor:pointer;flex-shrink:0;">';
            }
            html += '<div style="flex:1;">' +
                '<span style="display:inline-block;font-size:10px;color:#fff;background:' + timeBadgeColor + ';padding:2px 8px;border-radius:10px;margin-bottom:4px;">' + (scene.timestamp_hint || 'scene') + '</span>' +
                '<p style="font-size:13px;color:#e0e0e0;margin:4px 0 0 0;">' + (scene.scene_description || '') + '</p>' +
                '<p style="font-size:11px;color:#888;margin:3px 0 0 0;font-style:italic;">' + (scene.why || '') + '</p>' +
              '</div>' +
            '</div>';

            if (hasVideo) {
              var v = scene.video;
              html += '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">' +
                '<div style="position:relative;flex-shrink:0;">' +
                  '<img src="' + v.thumbnail + '" style="width:160px;height:90px;object-fit:cover;border-radius:6px;display:block;border:2px solid #f39c12;" alt="B-Roll">' +
                  '<span style="position:absolute;top:4px;left:4px;background:#f39c12;color:#000;font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;">AUTO-PICK</span>' +
                  '<span style="position:absolute;bottom:4px;right:4px;background:rgba(0,0,0,0.7);color:#fff;font-size:10px;padding:1px 5px;border-radius:3px;">' + v.duration + 's</span>' +
                '</div>' +
                '<div style="flex:1;min-width:120px;">' +
                  '<div style="font-size:11px;color:#aaa;margin-bottom:6px;">By ' + v.user + '</div>';

              // Position selector
              html += '<div style="margin-bottom:6px;">' +
                '<label style="font-size:10px;color:#888;display:block;margin-bottom:3px;">Position in clip:</label>' +
                '<select id="' + posId + '" style="font-size:12px;padding:5px 8px;background:#111;color:#fff;border:1px solid #333;border-radius:5px;width:100%;cursor:pointer;">' +
                  '<option value="beginning"' + (scene.timestamp_hint === 'beginning' ? ' selected' : '') + '>Beginning (first 3s)</option>' +
                  '<option value="middle"' + (scene.timestamp_hint === 'middle' || (!scene.timestamp_hint || scene.timestamp_hint === 'scene') ? ' selected' : '') + '>Middle (halfway)</option>' +
                  '<option value="end"' + (scene.timestamp_hint === 'end' ? ' selected' : '') + '>End (last 8s)</option>' +
                  '<option value="quarter">25% in</option>' +
                  '<option value="three-quarter">75% in</option>' +
                '</select>' +
              '</div>';

              // Duration selector
              html += '<div style="margin-bottom:6px;">' +
                '<label style="font-size:10px;color:#888;display:block;margin-bottom:3px;">B-Roll duration:</label>' +
                '<select id="' + durId + '" style="font-size:12px;padding:5px 8px;background:#111;color:#fff;border:1px solid #333;border-radius:5px;width:100%;cursor:pointer;">' +
                  '<option value="3">3 seconds</option>' +
                  '<option value="5" selected>5 seconds</option>' +
                  '<option value="8">8 seconds</option>' +
                '</select>' +
              '</div>';

              // Swap button
              if (scene.alternatives && scene.alternatives.length > 0) {
                var altId = 'broll-alts-' + momentIndex + '-' + sIdx;
                html += '<button class="btn btn-small" style="font-size:10px;background:rgba(255,255,255,0.08);color:#ccc;width:100%;" onclick="var el=document.getElementById(' + "'" + altId + "'" + ');el.style.display=el.style.display===' + "'none'" + '?' + "'flex'" + ':' + "'none'" + ';">Swap Scene (' + scene.alternatives.length + ' more)</button>';
              }

              html += '</div></div>';

              // Alternatives
              if (scene.alternatives && scene.alternatives.length > 0) {
                var altId2 = 'broll-alts-' + momentIndex + '-' + sIdx;
                html += '<div id="' + altId2 + '" style="display:none;gap:8px;margin-top:6px;overflow-x:auto;padding-bottom:4px;">';
                scene.alternatives.forEach(function(alt, aIdx) {
                  var selectAltFn = 'selectAltBroll(' + momentIndex + ',' + sIdx + ',' + aIdx + ')';
                  html += '<div style="flex-shrink:0;width:120px;cursor:pointer;text-align:center;" onclick="' + selectAltFn + '">' +
                    '<img src="' + alt.thumbnail + '" style="width:120px;height:68px;object-fit:cover;border-radius:5px;display:block;border:1px solid #333;" alt="Alt B-Roll">' +
                    '<div style="font-size:9px;color:#888;margin-top:2px;">' + alt.duration + 's - ' + alt.user + '</div>' +
                    '<div style="font-size:9px;color:#f39c12;margin-top:1px;">Click to use this</div>' +
                  '</div>';
                });
                html += '</div>';
              }

            } else {
              // No Pexels key — manual browse
              html += '<div style="display:flex;align-items:center;gap:12px;padding:10px;background:rgba(255,255,255,0.03);border-radius:8px;">' +
                '<a href="' + scene.searchUrl + '" target="_blank" class="btn btn-small" style="font-size:12px;background:linear-gradient(135deg,#f39c12,#e67e22);color:#fff;text-decoration:none;display:inline-flex;align-items:center;gap:6px;padding:8px 14px;flex-shrink:0;">Browse on Pexels</a>' +
                '<div style="flex:1;">' +
                  '<p style="font-size:12px;color:#e0e0e0;margin:0;">Search: <strong style="color:#f39c12;">' + scene.search_query + '</strong></p>' +
                '</div>' +
              '</div>';
            }

            html += '</div>';
          });

          // Download button (only when Pexels is connected)
          if (hasPexels) {
            html += '<div style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.1);">' +
              '<button class="btn btn-primary" id="broll-download-btn-' + momentIndex + '" onclick="downloadClipWithBRoll(' + "'" + analysisId + "'" + ',' + momentIndex + ',this)" ' +
                'style="width:100%;padding:12px;font-size:14px;background:linear-gradient(135deg,#f39c12 0%,#e67e22 50%,#d35400 100%);border:none;font-weight:600;">' +
                '🎬 Download Clip with B-Roll' +
              '</button>' +
              '<p style="font-size:11px;color:#888;text-align:center;margin:6px 0 0 0;">Uncheck scenes you don' + "'" + 't want. Change position and duration above.</p>' +
            '</div>';
          }
        }

        html += '</div>';

        var old = document.getElementById(panelId);
        if (old) old.remove();

        btn.closest('.moment-card').insertAdjacentHTML('beforeend', html);
        btn.disabled = false;
        btn.textContent = originalText;
        showToast('AI selected ' + (data.scenes ? data.scenes.length : 0) + ' B-Roll scenes!');

      } catch (error) {
        showToast(error.message || 'Failed to find B-Roll');
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }

    // Swap to alternative B-Roll
    function selectAltBroll(momentIndex, sceneIdx, altIdx) {
      var store = brollDataStore[momentIndex];
      if (!store) return;
      var scene = store.scenes[sceneIdx];
      if (!scene || !scene.alternatives || !scene.alternatives[altIdx]) return;

      // Swap: move current video to alternatives, put selected alt as main
      var oldVideo = scene.video;
      scene.video = scene.alternatives[altIdx];
      scene.alternatives[altIdx] = oldVideo;

      // Re-render by clicking the button again
      var btn = document.getElementById('broll-btn-' + momentIndex);
      var panel = document.getElementById('broll-panel-' + momentIndex);
      if (panel) panel.remove();

      // Rebuild panel with updated data (re-use stored data)
      rebuildBrollPanel(momentIndex);
      showToast('Scene swapped!');
    }

    function rebuildBrollPanel(momentIndex) {
      var store = brollDataStore[momentIndex];
      if (!store) return;
      // Simulate the response and rebuild
      var fakeBtn = document.getElementById('broll-btn-' + momentIndex);
      if (fakeBtn) {
        var card = fakeBtn.closest('.moment-card');
        // Remove old panel
        var old = document.getElementById('broll-panel-' + momentIndex);
        if (old) old.remove();
        // Trigger findBRoll which will use the API again - instead, just call with cached data
        fakeBtn.click();
      }
    }

    // Download clip with selected B-Roll spliced in
    async function downloadClipWithBRoll(analysisId, momentIndex, btn) {
      var store = brollDataStore[momentIndex];
      if (!store) { showToast('No B-Roll data found. Click Auto B-Roll first.'); return; }

      // Gather selected scenes
      var selectedScenes = [];
      store.scenes.forEach(function(scene, sIdx) {
        var cb = document.getElementById('broll-cb-' + momentIndex + '-' + sIdx);
        if (!cb || !cb.checked) return;
        if (!scene.video || !scene.video.videoFiles || !scene.video.videoFiles.length) return;

        var posSelect = document.getElementById('broll-pos-' + momentIndex + '-' + sIdx);
        var durSelect = document.getElementById('broll-dur-' + momentIndex + '-' + sIdx);

        selectedScenes.push({
          videoUrl: scene.video.videoFiles[0].link,
          position: posSelect ? posSelect.value : (scene.timestamp_hint || 'middle'),
          duration: durSelect ? parseInt(durSelect.value) : 5,
          description: scene.scene_description || ''
        });
      });

      if (selectedScenes.length === 0) {
        showToast('No B-Roll scenes selected. Check at least one scene.');
        return;
      }

      var originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Generating...';

      // Get clip style from moment card
      var styleSelect = document.getElementById('clip-style-' + momentIndex);
      var clipStyle = styleSelect ? styleSelect.value : 'blur';
      var captionsCheckbox = document.getElementById('captions-' + momentIndex);
      var includeCaptions = captionsCheckbox ? captionsCheckbox.checked : false;

      try {
        var response = await fetch('/shorts/clip-with-broll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            analysisId: analysisId,
            momentIndex: momentIndex,
            includeCaptions: includeCaptions,
            clipStyle: clipStyle,
            brollScenes: selectedScenes
          })
        });

        var data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to start');

        var filename = data.filename;
        btn.textContent = 'Processing...';

        // Poll for readiness (same status endpoint as regular clips)
        var attempts = 0;
        var maxAttempts = 200;
        var pollInterval = setInterval(async function() {
          attempts++;
          try {
            var statusResp = await fetch('/shorts/clip/status/' + filename);
            var statusData = await statusResp.json();

            if (statusData.failed) {
              clearInterval(pollInterval);
              throw new Error(statusData.message || 'Generation failed');
            } else if (statusData.ready) {
              clearInterval(pollInterval);
              btn.textContent = 'Downloading...';
              var link = document.createElement('a');
              link.href = '/shorts/clip/download/' + filename;
              link.download = filename;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              btn.disabled = false;
              btn.textContent = originalText;
              showToast('B-Roll clip downloaded!');
            } else if (attempts >= maxAttempts) {
              clearInterval(pollInterval);
              btn.disabled = false;
              btn.textContent = originalText;
              showToast('Timed out. Please try again.');
            } else {
              btn.textContent = statusData.progress || ('Processing' + '.'.repeat((attempts % 3) + 1));
            }
          } catch (e) {
            clearInterval(pollInterval);
            showToast('Error: ' + e.message);
            btn.disabled = false;
            btn.textContent = originalText;
          }
        }, 2000);

      } catch (error) {
        showToast(error.message || 'Failed to generate B-Roll clip');
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }

    // === Thumbnail Generation ===
    async function generateThumbnail(analysisId, momentIndex, btn) {
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Generating...';

      const styleSelect = document.getElementById('thumb-style-' + momentIndex);
      const thumbStyle = styleSelect ? styleSelect.value : 'gradient';

      try {
        const response = await fetch('/shorts/thumbnail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ analysisId, momentIndex, style: thumbStyle })
        });

        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed');

        const filename = data.filename;
        btn.textContent = 'Processing...';

        // Poll for readiness
        let attempts = 0;
        const poll = setInterval(async () => {
          attempts++;
          try {
            const statusResp = await fetch('/shorts/thumbnail/status/' + filename);
            const statusData = await statusResp.json();

            if (statusData.failed) {
              clearInterval(poll);
              throw new Error(statusData.message || 'Failed');
            } else if (statusData.ready) {
              clearInterval(poll);

              // Show preview + download link
              const previewHtml = '<div style="margin-top:12px;background:#000;border-radius:8px;padding:12px;position:relative;" id="thumb-preview-' + momentIndex + '">' +
                '<img src="/shorts/thumbnail/download/' + filename + '" style="width:100%;border-radius:6px;display:block;" alt="Thumbnail">' +
                '<div style="margin-top:8px;display:flex;gap:8px;">' +
                  '<a href="/shorts/thumbnail/download/' + filename + '" download="' + filename + '" class="btn btn-small" ' +
                    'style="background:linear-gradient(135deg,#6c5ce7,#a29bfe);color:#fff;text-decoration:none;font-size:11px;">Download</a>' +
                  '<button class="btn btn-small" style="background:rgba(255,255,255,0.1);color:var(--text-muted);font-size:11px;" ' +
                    'onclick="document.getElementById(' + "'thumb-preview-" + momentIndex + "'" + ').remove()">Close</button>' +
                '</div>' +
              '</div>';

              // Remove old preview if any
              const old = document.getElementById('thumb-preview-' + momentIndex);
              if (old) old.remove();

              btn.closest('.moment-card').insertAdjacentHTML('beforeend', previewHtml);
              btn.disabled = false;
              btn.textContent = originalText;
              showToast('Thumbnail generated!');
            } else if (attempts >= 60) {
              clearInterval(poll);
              throw new Error('Timed out');
            }
          } catch (pollError) {
            clearInterval(poll);
            showToast('Error: ' + pollError.message);
            btn.disabled = false;
            btn.textContent = originalText;
          }
        }, 2000);

      } catch (error) {
        showToast(error.message || 'Failed to generate thumbnail');
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }

    // === Brand Kit Functions ===
    function toggleBrandKit() {
      const panel = document.getElementById('brandKitPanel');
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      if (panel.style.display === 'block') loadBrandKit();
    }

    async function loadBrandKit() {
      try {
        const resp = await fetch('/shorts/brand-kit');
        const data = await resp.json();
        if (data.success && data.brandKit) {
          const kit = data.brandKit;
          document.getElementById('bk-brandName').value = kit.brand_name || '';
          document.getElementById('bk-watermarkText').value = kit.watermark_text || '';
          document.getElementById('bk-primaryColor').value = kit.primary_color || '#FF0050';
          document.getElementById('bk-primaryColorText').value = kit.primary_color || '#FF0050';
          document.getElementById('bk-secondaryColor').value = kit.secondary_color || '#6c5ce7';
          document.getElementById('bk-secondaryColorText').value = kit.secondary_color || '#6c5ce7';
          document.getElementById('bk-fontStyle').value = kit.font_style || 'modern';
          updateBrandPreview();
        }
      } catch (e) { console.log('Brand kit load error:', e); }
    }

    async function saveBrandKit() {
      const btn = document.getElementById('bk-saveBtn');
      const status = document.getElementById('bk-status');
      btn.disabled = true;
      btn.textContent = 'Saving...';

      try {
        const resp = await fetch('/shorts/brand-kit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            brandName: document.getElementById('bk-brandName').value,
            watermarkText: document.getElementById('bk-watermarkText').value,
            primaryColor: document.getElementById('bk-primaryColor').value,
            secondaryColor: document.getElementById('bk-secondaryColor').value,
            fontStyle: document.getElementById('bk-fontStyle').value
          })
        });
        const data = await resp.json();
        if (data.success) {
          status.textContent = 'Saved!';
          status.style.color = '#10b981';
          showToast('Brand Kit saved! Watermark will appear on future clips.');
          updateBrandPreview();
        } else {
          throw new Error(data.error);
        }
      } catch (e) {
        status.textContent = 'Error saving';
        status.style.color = '#ff6b6b';
        showToast('Error: ' + e.message);
      }
      btn.disabled = false;
      btn.textContent = 'Save Brand Kit';
      setTimeout(() => { status.textContent = ''; }, 3000);
    }

    function updateBrandPreview() {
      const watermark = document.getElementById('bk-watermarkText').value;
      const color = document.getElementById('bk-primaryColor').value;
      const preview = document.getElementById('bk-preview');
      const wmEl = document.getElementById('bk-preview-watermark');
      if (watermark) {
        preview.style.display = 'block';
        wmEl.textContent = watermark;
        wmEl.style.color = color;
      } else {
        preview.style.display = 'none';
      }
    }

    // Sync color picker with text input
    document.getElementById('bk-primaryColor').addEventListener('input', function() {
      document.getElementById('bk-primaryColorText').value = this.value;
      updateBrandPreview();
    });
    document.getElementById('bk-secondaryColor').addEventListener('input', function() {
      document.getElementById('bk-secondaryColorText').value = this.value;
    });

    function buildTranscriptViewer(transcript, moments, videoId) {
      if (!transcript) return '<p style="color:#888;padding:10px;">No transcript available.</p>';

      // Extract keywords from moments for highlighting
      const keywords = new Set();
      (moments || []).forEach(m => {
        (m.keyThemes || []).forEach(t => { if (t.length > 3) keywords.add(t.toLowerCase()); });
      });

      // Parse transcript "[HH:MM:SS] text" format
      const lines = [];
      const regex = /\[(\d{2}:\d{2}:\d{2})\]\s*(.*?)(?=\s*\[\d{2}:\d{2}:\d{2}\]|$)/g;
      let match;
      while ((match = regex.exec(transcript)) !== null) {
        lines.push({ time: match[1], text: (match[2] || '').trim() });
      }

      if (lines.length === 0) return '<p style="color:#888;padding:10px;">Transcript format not recognized.</p>';

      return lines.map(line => {
        let text = line.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        // Highlight keywords (simple word boundary match)
        keywords.forEach(kw => {
          const escaped = kw.replace(/[.*+?^$|()]/g, String.fromCharCode(92) + '$&');
          const re = new RegExp('(' + escaped + ')', 'gi');
          text = text.replace(re, '<mark style="background:#6c5ce740;color:#a29bfe;padding:1px 3px;border-radius:2px;">$1</mark>');
        });

        const secs = line.time.split(':').reduce((a,b) => a*60 + parseInt(b), 0);
        const sq = String.fromCharCode(39);
        const ytLink = videoId ? ' onclick="window.open(' + sq + 'https://youtube.com/watch?v=' + videoId + '&t=' + secs + sq + ', ' + sq + '_blank' + sq + ')"' : '';

        return '<div class="transcript-line" style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer;"' + ytLink + '>' +
          '<span style="color:#6c5ce7;font-size:12px;font-family:monospace;white-space:nowrap;min-width:65px;">' + line.time + '</span>' +
          '<span style="font-size:13px;line-height:1.5;color:#ccc;">' + text + '</span>' +
        '</div>';
      }).join('');
    }

    function filterTranscript(query) {
      const lines = document.querySelectorAll('.transcript-line');
      const q = query.toLowerCase();
      lines.forEach(line => {
        line.style.display = !q || line.textContent.toLowerCase().includes(q) ? 'flex' : 'none';
      });
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
