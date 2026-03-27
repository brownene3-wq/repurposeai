const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
// youtube-transcript has "type":"module" which breaks dynamic import in CJS projects
// Use our CJS wrapper that loads the bundle directly
const { YoutubeTranscript } = require('../utils/youtube-transcript-loader.cjs');
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

      // Fetch transcript
      let segments;
      try {
        segments = await YoutubeTranscript.fetchTranscript(videoId);
      } catch (transcriptError) {
        console.error('Transcript fetch error:', transcriptError);
        sendUpdate({ status: 'error', message: 'Could not fetch transcript. Make sure the video has captions enabled.' });
        return res.end();
      }

      if (!segments || segments.length === 0) {
        sendUpdate({ status: 'error', message: 'No transcript found for this video. The video may not have captions.' });
        return res.end();
      }

      const transcriptText = buildTranscriptText(segments);
      const videoTitle = 'YouTube Video';

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

    // Process in background with timeout
    (async () => {
      // Set a 5-minute timeout for the whole operation
      const timeout = setTimeout(() => {
        writeError('Clip generation timed out after 5 minutes. Try a moment closer to the start of the video.');
      }, 300000);

      try {
        writeProgress('Downloading and clipping video...');

        // Use yt-dlp (Python) for reliable YouTube downloads - it handles all YouTube's
        // anti-bot measures and is actively maintained. Combined with ffmpeg for clipping.
        // yt-dlp can download a specific section using --download-sections
        const startTs = formatTimestamp(startSec);
        const endTs = formatTimestamp(startSec + duration);

        // Check if yt-dlp is available
        let ytdlpPath = 'yt-dlp';
        try { execSync('which yt-dlp', { stdio: 'pipe' }); } catch (e) {
          clearTimeout(timeout);
          writeError('yt-dlp is not installed on this server');
          return;
        }

        // Step 1: Download the section with yt-dlp at good quality
        const tempDownload = outputPath + '.temp.mp4';
        const ytdlpArgs = [
          '--no-playlist',
          '--download-sections', `*${startTs}-${endTs}`,
          '--force-keyframes-at-cuts',
          '-f', 'bestvideo[height<=1080][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
          '--merge-output-format', 'mp4',   // Ensure final output is mp4 container
          '-o', tempDownload,
          '--no-warnings',
          '--no-check-certificates',
          '--no-part',           // Don't use .part files (write directly to output)
          videoUrl
        ];

        console.log(`  Running yt-dlp: section ${startTs} to ${endTs}`);
        const ytdlpProc = spawn(ytdlpPath, ytdlpArgs);

        let stderrLog = '';
        ytdlpProc.stdout.on('data', (data) => {
          const msg = data.toString().trim();
          console.log(`  yt-dlp: ${msg}`);
          // Parse download progress
          const pctMatch = msg.match(/(\d+\.?\d*)%/);
          if (pctMatch) {
            writeProgress(`Downloading: ${Math.round(parseFloat(pctMatch[1]))}%`);
          }
        });

        ytdlpProc.stderr.on('data', (data) => {
          stderrLog += data.toString();
          if (stderrLog.length > 2048) stderrLog = stderrLog.slice(-2048);
          console.error(`  yt-dlp stderr: ${data.toString().trim()}`);
        });

        ytdlpProc.on('close', (code) => {
          if (code !== 0) {
            clearTimeout(timeout);
            try { fs.unlinkSync(progressPath); } catch (e) {}
            console.error('yt-dlp stderr:', stderrLog.slice(-800));
            const lines = stderrLog.split('\n');
            const errorLine = lines.find(l => /error|denied|forbidden|refused/i.test(l)) || lines.slice(-3).join(' ');
            writeError(`yt-dlp exit code ${code}: ${errorLine.substring(0, 300)}`);
            return;
          }

          // Step 2: Use ffmpeg to crop the downloaded clip to vertical 9:16 format
          writeProgress('Converting to vertical short format...');

          // yt-dlp may output with slightly different filename - find the actual file
          let actualDownload = tempDownload;
          if (!fs.existsSync(tempDownload)) {
            // Look for files matching our base name in CLIPS_DIR
            const baseName = path.basename(outputPath, '.mp4');
            const files = fs.readdirSync(CLIPS_DIR);
            const match = files.find(f => f.includes(baseName) && f.includes('.temp'));
            if (match) {
              actualDownload = path.join(CLIPS_DIR, match);
              console.log(`  Found actual download: ${match}`);
            } else {
              // Try any recent file that's not the output
              const outputBase = path.basename(outputPath);
              const recentFiles = files.filter(f => f !== outputBase && !f.endsWith('.progress') && !f.endsWith('.error'));
              console.log(`  Temp file not found. CLIPS_DIR contents: ${recentFiles.join(', ')}`);
              writeError('Downloaded file not found after yt-dlp completed. Check server logs.');
              return;
            }
          }

          console.log(`  Cropping to 9:16 vertical: ${actualDownload}`);

          // Crop center of video to 9:16 portrait, scale to 1080x1920
          // Use min() to avoid cropping wider/taller than the source
          // For landscape: crop width = height*9/16, full height, centered
          // For portrait/square: just scale to fit 1080x1920
          const cropFilter = "crop='min(ih*9/16,iw)':'min(iw*16/9,ih)':'(iw-min(ih*9/16,iw))/2':'(ih-min(iw*16/9,ih))/2',scale=1080:1920:flags=lanczos";
          const ffmpegCrop = spawn(ffmpegPath, [
            '-i', actualDownload,
            '-vf', cropFilter,
            '-c:v', 'libx264',
            '-profile:v', 'baseline',   // Baseline profile = maximum device compatibility
            '-level', '3.1',
            '-pix_fmt', 'yuv420p',      // Required for QuickTime/browser playback
            '-c:a', 'aac',
            '-b:a', '128k',
            '-ar', '44100',             // Standard audio sample rate
            '-ac', '2',                 // Stereo audio
            '-preset', 'fast',
            '-crf', '23',
            '-movflags', '+faststart',  // Enable progressive download
            '-brand', 'mp42',           // MP4 brand for maximum compatibility
            '-y',
            outputPath
          ]);

          let ffmpegStderr = '';
          ffmpegCrop.stderr.on('data', (data) => {
            ffmpegStderr += data.toString();
            if (ffmpegStderr.length > 2048) ffmpegStderr = ffmpegStderr.slice(-2048);
            const msg = data.toString();
            if (msg.includes('time=')) {
              const timeMatch = msg.match(/time=(\S+)/);
              if (timeMatch) writeProgress(`Formatting: ${timeMatch[1]}`);
            }
          });

          ffmpegCrop.on('close', (ffCode) => {
            clearTimeout(timeout);
            try { fs.unlinkSync(progressPath); } catch (e) {}
            try { fs.unlinkSync(actualDownload); } catch (e) {} // Clean up actual download
            if (actualDownload !== tempDownload) {
              try { fs.unlinkSync(tempDownload); } catch (e) {} // Clean up temp too
            }

            if (ffCode === 0) {
              const size = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
              console.log(`Short clip generated: ${filename} (${(size / 1024 / 1024).toFixed(1)}MB, 1080x1920)`);
              if (size === 0) {
                writeError('Clip formatting produced empty file');
              }
            } else {
              console.error('ffmpeg crop stderr:', ffmpegStderr.slice(-800));
              writeError(`Video formatting failed (code ${ffCode})`);
            }
          });

          ffmpegCrop.on('error', (err) => {
            clearTimeout(timeout);
            try { fs.unlinkSync(tempDownload); } catch (e) {}
            writeError('ffmpeg crop error: ' + err.message);
          });
        });

        ytdlpProc.on('error', (err) => {
          clearTimeout(timeout);
          writeError('yt-dlp process error: ' + err.message);
        });

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
    if (stats.size > 0) {
      try { fs.unlinkSync(progressPath); } catch (e) {}
      res.json({ ready: true, size: stats.size, filename });
    } else {
      res.json({ ready: false, message: 'Still processing...' });
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
router.get('/clip/download/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename); // Prevent path traversal
  const filePath = path.join(CLIPS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Clip not found. It may still be processing or has expired.' });
  }

  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);

  // Clean up file after download (with delay to allow stream to finish)
  stream.on('end', () => {
    setTimeout(() => {
      try { fs.unlinkSync(filePath); } catch (e) {}
    }, 5000);
  });
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

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              let data;
              try {
                data = JSON.parse(line.slice(6));
              } catch (parseErr) {
                console.log('SSE parse skip:', line.slice(0, 100));
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
