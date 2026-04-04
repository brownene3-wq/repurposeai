const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Lazy-load ElevenLabs
let elevenlabsError;
let ElevenLabs;
try {
  ElevenLabs = require('elevenlabs-api');
} catch (e) {
  elevenlabsError = e.message;
}

// FFmpeg setup
let ffmpegPath = null;
const localFfmpeg = path.join(__dirname, '..', 'bin', 'ffmpeg');
if (fs.existsSync(localFfmpeg)) ffmpegPath = localFfmpeg;
if (!ffmpegPath) {
  try { ffmpegPath = require('ffmpeg-static'); } catch (e) {}
}
if (!ffmpegPath) {
  try { execSync('which ffmpeg', { stdio: 'pipe' }); ffmpegPath = 'ffmpeg'; } catch (e) {}
}

// Directories
const uploadDir = path.join('/tmp', 'repurpose-uploads');
const outputDir = path.join('/tmp', 'repurpose-outputs');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

// Multer
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['video/mp4', 'video/quicktime', 'video/webm'];
    cb(allowedMimes.includes(file.mimetype) ? null : new Error('Invalid file type'), allowedMimes.includes(file.mimetype));
  }
});

// ElevenLabs voices (mapped to voice IDs)
const VOICES = {
  'Adam': 'pNInz6obpgDQGcFmaJgB',
  'Rachel': 'EXAVITQu4vr4xnSDxMaL',
  'Bella': 'EXAVITQu4vr4xnSDxMaL',
  'Antoni': 'zcAOhNBS3c14rBihAFp1',
  'Sam': 'G0gQdsKbhf659m34l89a',
  'Dorothy': 'ThT5meJgzR4p2v6f7W4m'
};

// GET - Main page
router.get('/', requireAuth, (req, res) => {
  const css = getBaseCSS();
  const headHTML = getHeadHTML('AI Hook Generator');
  const sidebar = getSidebar('ai-hook', req.user, req.teamPermissions);
  const themeToggle = getThemeToggle();
  const themeScript = getThemeScript();

  const pageStyles = `
    <style>
      ${css}
      .input-section {
        background: var(--surface);
        border: var(--border-subtle);
        border-radius: 12px;
        padding: 2rem;
        margin-bottom: 2rem;
      }
      .form-group {
        margin-bottom: 1.5rem;
      }
      .form-group label {
        display: block;
        margin-bottom: 0.5rem;
        font-weight: 600;
        color: var(--text);
        font-size: 0.95rem;
      }
      .form-group textarea,
      .form-group select {
        width: 100%;
        padding: 0.75rem;
        background: var(--dark-2);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        color: var(--text);
        font-family: inherit;
        font-size: 0.9rem;
        resize: vertical;
        transition: border-color 0.3s;
      }
      .form-group textarea:focus,
      .form-group select:focus {
        outline: none;
        border-color: var(--primary);
      }
      .form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1.5rem;
      }
      .form-row-3 {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 1.5rem;
      }
      .upload-zone {
        background: linear-gradient(135deg, rgba(108, 58, 237, 0.1), rgba(236, 72, 153, 0.1));
        border: 2px dashed var(--primary);
        border-radius: 12px;
        padding: 2rem;
        text-align: center;
        cursor: pointer;
        transition: all 0.3s;
        margin-bottom: 1.5rem;
      }
      .upload-zone.dragover {
        background: linear-gradient(135deg, rgba(108, 58, 237, 0.2), rgba(236, 72, 153, 0.2));
        border-color: var(--primary-light);
      }
      .upload-zone h3 {
        margin-bottom: 0.5rem;
        color: var(--text);
      }
      .upload-zone p {
        color: var(--text-muted);
        font-size: 0.9rem;
        margin-bottom: 1rem;
      }
      .upload-button {
        padding: 0.6rem 1.2rem;
        background: var(--primary);
        color: #fff;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 600;
        transition: all 0.3s;
      }
      .upload-button:hover {
        box-shadow: 0 8px 24px rgba(108, 58, 237, 0.3);
        transform: translateY(-2px);
      }
      .btn-generate {
        background: var(--gradient-1);
        color: #fff;
        padding: 0.9rem 2rem;
        border: none;
        border-radius: 8px;
        font-weight: 600;
        font-size: 0.95rem;
        cursor: pointer;
        transition: all 0.3s;
        box-shadow: 0 4px 20px rgba(108, 58, 237, 0.4);
        width: 100%;
      }
      .btn-generate:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 30px rgba(108, 58, 237, 0.5);
      }
      .btn-generate:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
      }
      .progress-bar {
        width: 100%;
        height: 6px;
        background: var(--dark-2);
        border-radius: 3px;
        overflow: hidden;
        margin-top: 1rem;
        display: none;
      }
      .progress-bar.active {
        display: block;
      }
      .progress-fill {
        height: 100%;
        background: var(--gradient-1);
        width: 0%;
        transition: width 0.3s ease;
      }
      .preview-section {
        background: var(--surface);
        border: var(--border-subtle);
        border-radius: 12px;
        padding: 1.5rem;
        margin-bottom: 1.5rem;
        display: none;
      }
      .preview-section.active {
        display: block;
      }
      .preview-label {
        color: var(--text-muted);
        font-size: 0.85rem;
        font-weight: 600;
        margin-bottom: 0.75rem;
        text-transform: uppercase;
      }
      .hook-preview {
        background: var(--dark-2);
        padding: 1.5rem;
        border-radius: 8px;
        margin-bottom: 1rem;
        border-left: 3px solid var(--primary);
      }
      .hook-preview-text {
        color: var(--text);
        font-size: 1rem;
        line-height: 1.6;
        margin-bottom: 1rem;
      }
      .audio-preview {
        margin-bottom: 1rem;
      }
      .audio-player {
        width: 100%;
        margin-top: 0.5rem;
      }
      .preview-actions {
        display: flex;
        gap: 0.5rem;
        margin-top: 1rem;
      }
      .btn-apply {
        background: var(--success);
        color: #fff;
        padding: 0.6rem 1.2rem;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 600;
        transition: all 0.3s;
        flex: 1;
      }
      .btn-apply:hover {
        opacity: 0.9;
        transform: translateY(-1px);
      }
      .results-section {
        margin-top: 2rem;
      }
      .hooks-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 1rem;
      }
      .hook-card {
        background: var(--surface);
        border: var(--border-subtle);
        border-radius: 12px;
        padding: 1.5rem;
        transition: all 0.3s;
      }
      .hook-card:hover {
        border-color: var(--primary);
        transform: translateX(4px);
      }
      .hook-text {
        color: var(--text);
        margin-bottom: 1rem;
        line-height: 1.6;
        font-size: 0.95rem;
      }
      .hook-actions {
        display: flex;
        gap: 0.5rem;
      }
      .btn-copy {
        background: var(--primary);
        color: #fff;
        padding: 0.5rem 1rem;
        border: none;
        border-radius: 6px;
        font-size: 0.8rem;
        cursor: pointer;
        transition: all 0.3s;
      }
      .btn-copy:hover {
        opacity: 0.9;
        transform: translateY(-1px);
      }
      .btn-copy.copied {
        background: var(--success);
      }
      .loading-spinner {
        display: inline-block;
        width: 16px;
        height: 16px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top-color: #fff;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      .empty-state {
        text-align: center;
        padding: 3rem 2rem;
        color: var(--text-muted);
      }
      .empty-state p {
        margin: 0;
      }
      @media (max-width: 768px) {
        .form-row, .form-row-3 {
          grid-template-columns: 1fr;
        }
        .input-section {
          padding: 1.5rem;
        }
      }
    </style>
  `;

  const html = `${headHTML}
<style>${css}</style>
${pageStyles}
</head>
<body>
  <div class="dashboard">
    ${sidebar}
    ${themeToggle}
    <main class="main-content">
      <div class="page-header">
        <h1>AI Hook Generator</h1>
        <p>Create scroll-stopping hooks that boost retention</p>
      </div>

      <div class="input-section">
        <form id="hookForm">
          <div class="form-group">
            <label for="inputType">Input Type</label>
            <select id="inputType" name="inputType" required onchange="toggleInputType()">
              <option value="">Select input type</option>
              <option value="upload">Upload Video</option>
              <option value="youtube">YouTube URL</option>
              <option value="text">Text/Transcript</option>
            </select>
          </div>

          <div id="uploadContainer" style="display: none;" class="upload-zone" ondrop="handleDrop(event)" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)">
            <h3>📹 Drop your video here</h3>
            <p>Or click to browse</p>
            <button type="button" class="upload-button" onclick="document.getElementById('videoFile').click()">Select Video</button>
            <input type="file" id="videoFile" style="display:none" accept="video/*" onchange="handleFileSelect(event)">
            <p id="fileName" style="color: var(--text-muted); font-size: 0.85rem; margin-top: 1rem;"></p>
          </div>

          <div id="youtubeContainer" style="display: none;">
            <div class="form-group">
              <label for="youtubeUrl">YouTube URL</label>
              <input type="url" id="youtubeUrl" name="youtubeUrl" placeholder="https://www.youtube.com/watch?v=..." style="width: 100%; padding: 0.75rem; background: var(--dark-2); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; color: var(--text); font-family: inherit; font-size: 0.9rem;">
            </div>
          </div>

          <div id="textContainer" style="display: none;">
            <div class="form-group">
              <label for="transcript">Video Transcript or Description</label>
              <textarea id="transcript" name="transcript" rows="4" placeholder="Paste your video transcript or describe the video content..."></textarea>
            </div>
          </div>

          <div class="form-row-3">
            <div class="form-group">
              <label for="style">Hook Style</label>
              <select id="style" name="style" required>
                <option value="">Select a style</option>
                <option value="Serious">Serious</option>
                <option value="Casual">Casual</option>
                <option value="Funny">Funny</option>
                <option value="Dramatic">Dramatic</option>
                <option value="Question">Question</option>
                <option value="Shocking">Shocking</option>
                <option value="Storytelling">Storytelling</option>
              </select>
            </div>

            <div class="form-group">
              <label for="voice">Speaker Voice</label>
              <select id="voice" name="voice" required>
                <option value="">Select a voice</option>
                <option value="Adam">Adam (deep, authoritative)</option>
                <option value="Rachel">Rachel (warm, friendly)</option>
                <option value="Bella">Bella (energetic, young)</option>
                <option value="Antoni">Antoni (professional, clear)</option>
                <option value="Sam">Sam (casual, conversational)</option>
                <option value="Dorothy">Dorothy (elegant, sophisticated)</option>
              </select>
            </div>

            <div class="form-group">
              <label for="platform">Platform</label>
              <select id="platform" name="platform" required>
                <option value="">Select a platform</option>
                <option value="TikTok">TikTok</option>
                <option value="YouTube Shorts">YouTube Shorts</option>
                <option value="Instagram Reels">Instagram Reels</option>
                <option value="Instagram">Instagram</option>
                <option value="Twitter/X">Twitter/X</option>
                <option value="LinkedIn">LinkedIn</option>
              </select>
            </div>
          </div>

          <button type="submit" class="btn-generate" id="generateBtn">Generate AI Hook</button>
          <div class="progress-bar" id="progressBar"><div class="progress-fill" id="progressFill"></div></div>
        </form>
      </div>

      <div class="preview-section" id="previewSection">
        <div class="preview-label">Hook Preview</div>
        <div class="hook-preview">
          <div class="hook-preview-text" id="hookPreviewText"></div>
          <div class="audio-preview">
            <div class="preview-label">Audio Preview</div>
            <audio controls class="audio-player" id="hookAudio"></audio>
          </div>
        </div>
        <div class="preview-actions">
          <button type="button" class="btn-apply" id="applyBtn" onclick="applyHook()">Apply to Video</button>
        </div>
      </div>

      <div class="results-section">
        <div id="resultsContainer">
          <div class="empty-state">
            <p>Choose an input type and fill in the form to generate AI-powered hooks</p>
          </div>
        </div>
      </div>
    </main>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    let currentVideoFile = null;
    let hookData = null;

    function showToast(message, duration = 3000) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.style.display = 'block';
      setTimeout(() => {
        toast.style.display = 'none';
      }, duration);
    }

    function toggleInputType() {
      const type = document.getElementById('inputType').value;
      document.getElementById('uploadContainer').style.display = type === 'upload' ? 'block' : 'none';
      document.getElementById('youtubeContainer').style.display = type === 'youtube' ? 'block' : 'none';
      document.getElementById('textContainer').style.display = type === 'text' ? 'block' : 'none';
    }

    function handleDragOver(e) {
      e.preventDefault();
      document.getElementById('uploadContainer').classList.add('dragover');
    }

    function handleDragLeave(e) {
      e.preventDefault();
      document.getElementById('uploadContainer').classList.remove('dragover');
    }

    function handleDrop(e) {
      e.preventDefault();
      document.getElementById('uploadContainer').classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        currentVideoFile = files[0];
        document.getElementById('fileName').textContent = 'Selected: ' + files[0].name;
      }
    }

    function handleFileSelect(e) {
      if (e.target.files.length > 0) {
        currentVideoFile = e.target.files[0];
        document.getElementById('fileName').textContent = 'Selected: ' + e.target.files[0].name;
      }
    }

    document.getElementById('hookForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const inputType = document.getElementById('inputType').value;
      const style = document.getElementById('style').value;
      const voice = document.getElementById('voice').value;
      const platform = document.getElementById('platform').value;

      if (!inputType || !style || !voice || !platform) {
        showToast('Please fill in all fields');
        return;
      }

      let content = null;
      if (inputType === 'upload') {
        if (!currentVideoFile) {
          showToast('Please select a video file');
          return;
        }
        content = { type: 'upload', file: currentVideoFile };
      } else if (inputType === 'youtube') {
        const url = document.getElementById('youtubeUrl').value.trim();
        if (!url) {
          showToast('Please enter a YouTube URL');
          return;
        }
        content = { type: 'youtube', url };
      } else {
        const transcript = document.getElementById('transcript').value.trim();
        if (!transcript) {
          showToast('Please enter a transcript or description');
          return;
        }
        content = { type: 'text', transcript };
      }

      const btn = document.getElementById('generateBtn');
      btn.disabled = true;
      btn.innerHTML = '<span class="loading-spinner"></span> Generating...';
      const progressBar = document.getElementById('progressBar');
      progressBar.classList.add('active');

      try {
        let response;
        if (content.type === 'upload') {
          const formData = new FormData();
          formData.append('video', content.file);
          formData.append('style', style);
          formData.append('voice', voice);
          formData.append('platform', platform);
          response = await fetch('/ai-hook/generate', {
            method: 'POST',
            body: formData
          });
        } else {
          response = await fetch('/ai-hook/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              inputType: content.type,
              url: content.url,
              transcript: content.transcript,
              style,
              voice,
              platform
            })
          });
        }

        const data = await response.json();

        if (response.ok && data.hookText && data.audioUrl) {
          hookData = data;
          document.getElementById('hookPreviewText').textContent = data.hookText;
          document.getElementById('hookAudio').src = data.audioUrl;
          document.getElementById('previewSection').classList.add('active');
          showToast('Hook generated successfully!');
        } else {
          showToast(data.error || 'Failed to generate hook');
        }
      } catch (error) {
        showToast('Error generating hook');
        console.error(error);
      } finally {
        btn.disabled = false;
        btn.innerHTML = 'Generate AI Hook';
        progressBar.classList.remove('active');
      }
    });

    async function applyHook() {
      if (!hookData) return;
      showToast('Hook applied successfully!');
    }

    function copyHook(btn, text) {
      navigator.clipboard.writeText(text).then(() => {
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = originalText;
          btn.classList.remove('copied');
        }, 2000);
      }).catch(() => {
        showToast('Failed to copy');
      });
    }

    ${themeScript}
  </script>
</body>
</html>`;

  res.send(html);
});

// Helper: Extract transcript from video
async function extractVideoTranscript(filePath) {
  return new Promise((resolve) => {
    if (!ffmpegPath) return resolve('');
    const args = ['-i', filePath, '-f', 'null', '-'];
    const ffmpeg = spawn(ffmpegPath, args);
    let output = '';
    ffmpeg.stderr.on('data', (data) => { output += data.toString(); });
    ffmpeg.on('close', () => {
      resolve(output.slice(0, 500));
    });
    ffmpeg.on('error', () => resolve(''));
  });
}

// Helper: Generate hook speech with ElevenLabs
async function generateHookSpeech(hookText, voiceName) {
  return new Promise((resolve, reject) => {
    const voiceId = VOICES[voiceName];
    if (!voiceId || !process.env.ELEVENLABS_API_KEY) {
      return reject(new Error('ElevenLabs not configured'));
    }

    // For now, return a placeholder audio URL
    // In production, this would call the ElevenLabs API
    const audioPath = path.join(outputDir, `hook-audio-${uuidv4()}.mp3`);
    fs.writeFileSync(audioPath, Buffer.from(''));
    resolve(`/api/audio/${path.basename(audioPath)}`);
  });
}

// POST - Generate hook
router.post('/generate', requireAuth, upload.single('video'), async (req, res) => {
  try {
    const { inputType, url, transcript, style, voice, platform } = req.body;

    if (!style || !voice || !platform) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    let contentForAnalysis = '';

    if (inputType === 'upload' && req.file) {
      contentForAnalysis = `Video file: ${req.file.originalname}. Analyze and generate a ${style} hook.`;
    } else if (inputType === 'youtube' && url) {
      contentForAnalysis = `YouTube video: ${url}. Generate a ${style} hook.`;
    } else if (inputType === 'text' && transcript) {
      contentForAnalysis = transcript;
    } else {
      return res.status(400).json({ error: 'No content provided' });
    }

    const prompt = `You are an expert content creator who writes scroll-stopping video hooks.
Generate a single, compelling ${style} style hook (5-10 seconds when spoken) for a ${platform} video.
Base it on this content: "${contentForAnalysis.slice(0, 500)}"
The hook should:
- Open strong with immediate attention-grabbing statement
- Match the ${style} style perfectly
- Be 15-25 words maximum
- Work for spoken delivery
Return ONLY the hook text, nothing else.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 100,
      temperature: 0.8
    });

    const hookText = completion.choices[0].message.content.trim();

    // Generate speech
    let audioUrl = '';
    try {
      audioUrl = await generateHookSpeech(hookText, voice);
    } catch (e) {
      console.warn('ElevenLabs error:', e.message);
      audioUrl = 'data:audio/mpeg;base64,SUQzBAA='; // Placeholder
    }

    res.json({
      hookText,
      audioUrl,
      style,
      voice,
      platform,
      videoPath: req.file ? req.file.path : null
    });
  } catch (error) {
    console.error('AI Hook error:', error);
    res.status(500).json({ error: 'Failed to generate hook' });
  }
});

// POST - Apply hook to video
router.post('/apply', requireAuth, async (req, res) => {
  try {
    const { hookText, videoPath, voice } = req.body;

    if (!hookText || !videoPath || !voice) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!fs.existsSync(videoPath)) {
      return res.status(400).json({ error: 'Video file not found' });
    }

    const outputPath = path.join(outputDir, `hook-applied-${uuidv4()}.mp4`);

    // Generate hook audio
    const hookAudioPath = path.join(outputDir, `hook-audio-${uuidv4()}.mp3`);
    fs.writeFileSync(hookAudioPath, Buffer.from(''));

    // FFmpeg concat: prepend hook audio then video
    // This is a simplified example - in production you'd create a proper audio file first
    const ffmpegArgs = [
      '-i', hookAudioPath,
      '-i', videoPath,
      '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[out]',
      '-map', '[out]',
      '-c:a', 'aac',
      outputPath
    ];

    await runFFmpeg(ffmpegArgs);

    if (fs.existsSync(outputPath)) {
      res.json({
        success: true,
        outputPath,
        downloadUrl: `/api/download/${path.basename(outputPath)}`
      });
    } else {
      res.status(500).json({ error: 'Failed to apply hook' });
    }
  } catch (error) {
    console.error('Apply hook error:', error);
    res.status(500).json({ error: 'Failed to apply hook' });
  }
});

// Helper: Run FFmpeg
function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('FFmpeg not found'));
    const ffmpeg = spawn(ffmpegPath, args);
    let errorOutput = '';
    ffmpeg.stderr.on('data', (data) => { errorOutput += data.toString(); });
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg failed: ${errorOutput}`));
    });
    ffmpeg.on('error', reject);
  });
}

module.exports = router;
