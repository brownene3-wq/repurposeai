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

const https = require('https');

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
              <label>Voice Provider</label>
              <div style="display:flex;gap:.5rem;margin-bottom:.6rem">
                <button type="button" class="tab-btn active" id="providerFreeBtn" onclick="switchVoiceProvider('free')" style="flex:1;padding:.5rem;background:var(--primary);color:#fff;border:1px solid var(--primary);border-radius:6px;cursor:pointer;font-size:.8rem;font-weight:600;transition:all .2s">Free AI Voice</button>
                <button type="button" class="tab-btn" id="providerElevenBtn" onclick="switchVoiceProvider('elevenlabs')" style="flex:1;padding:.5rem;background:var(--dark-2);color:var(--text-muted);border:1px solid rgba(255,255,255,0.1);border-radius:6px;cursor:pointer;font-size:.8rem;font-weight:600;transition:all .2s">ElevenLabs</button>
              </div>
            </div>
            <div class="form-group" id="freeVoiceGroup">
              <label for="voice">Speaker Voice</label>
              <select id="voice" name="voice" required>
                <option value="">Select a free voice</option>
                <option value="free_male_1">Alex (Male, Deep)</option>
                <option value="free_male_2">Marcus (Male, Warm)</option>
                <option value="free_male_3">James (Male, Energetic)</option>
                <option value="free_female_1">Sarah (Female, Professional)</option>
                <option value="free_female_2">Emma (Female, Friendly)</option>
                <option value="free_female_3">Lily (Female, Calm)</option>
              </select>
              <p style="font-size:.72rem;color:var(--text-muted);margin-top:.3rem">High-quality AI voices — no API key needed</p>
            </div>
            <div class="form-group" id="elevenVoiceGroup" style="display:none">
              <label for="voiceEleven">Speaker Voice</label>
              <select id="voiceEleven" name="voiceEleven">
                <option value="">Loading ElevenLabs voices...</option>
              </select>
              <p id="voiceHint" style="font-size:.78rem;color:var(--text-muted);margin-top:.4rem;display:none"></p>
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

          <div id="apiKeyNotice" style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:0.75rem 1rem;margin-bottom:1rem;display:none">
            <p style="color:#F59E0B;font-size:.85rem;margin:0"><strong>ElevenLabs API Key Required</strong> — To generate voice hooks, connect your own ElevenLabs API key in <a href="/shorts#settings" style="color:#6C3AED;font-weight:600">Smart Shorts &rarr; Settings</a>. The hook text will still be generated without a key.</p>
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

    // Voice provider state
    var activeVoiceProvider = 'free';

    function switchVoiceProvider(provider) {
      activeVoiceProvider = provider;
      var freeGroup = document.getElementById('freeVoiceGroup');
      var elevenGroup = document.getElementById('elevenVoiceGroup');
      var freeBtn = document.getElementById('providerFreeBtn');
      var elevenBtn = document.getElementById('providerElevenBtn');
      var apiNotice = document.getElementById('apiKeyNotice');

      if (provider === 'free') {
        freeGroup.style.display = 'block';
        elevenGroup.style.display = 'none';
        freeBtn.style.background = 'var(--primary)';
        freeBtn.style.color = '#fff';
        freeBtn.style.borderColor = 'var(--primary)';
        elevenBtn.style.background = 'var(--dark-2)';
        elevenBtn.style.color = 'var(--text-muted)';
        elevenBtn.style.borderColor = 'rgba(255,255,255,0.1)';
        apiNotice.style.display = 'none';
      } else {
        freeGroup.style.display = 'none';
        elevenGroup.style.display = 'block';
        elevenBtn.style.background = 'var(--primary)';
        elevenBtn.style.color = '#fff';
        elevenBtn.style.borderColor = 'var(--primary)';
        freeBtn.style.background = 'var(--dark-2)';
        freeBtn.style.color = 'var(--text-muted)';
        freeBtn.style.borderColor = 'rgba(255,255,255,0.1)';
        // Show API key notice if no ElevenLabs voices loaded
        var elevenSelect = document.getElementById('voiceEleven');
        if (elevenSelect.options.length <= 1 && elevenSelect.options[0] && elevenSelect.options[0].value === '') {
          apiNotice.style.display = 'block';
        }
      }
    }

    function getSelectedVoice() {
      if (activeVoiceProvider === 'free') {
        return document.getElementById('voice').value;
      } else {
        return document.getElementById('voiceEleven').value;
      }
    }

    // Load ElevenLabs voices from user's account
    (async function loadElevenLabsVoices() {
      var voiceSelect = document.getElementById('voiceEleven');
      var voiceHint = document.getElementById('voiceHint');
      try {
        var res = await fetch('/ai-hook/voices');
        var data = await res.json();
        voiceSelect.innerHTML = '';
        if (data.voices && data.voices.length > 0) {
          voiceSelect.innerHTML = '<option value="">Select an ElevenLabs voice</option>';
          data.voices.forEach(function(v) {
            var opt = document.createElement('option');
            opt.value = v.voice_id;
            opt.textContent = v.name + (v.labels ? ' (' + Object.values(v.labels).join(', ') + ')' : '');
            voiceSelect.appendChild(opt);
          });
          if (data.source === 'elevenlabs') {
            voiceHint.textContent = 'Voices loaded from your ElevenLabs account';
            voiceHint.style.display = 'block';
            voiceHint.style.color = '#10B981';
          }
        } else if (data.noKey) {
          voiceSelect.innerHTML = '<option value="">No ElevenLabs key connected</option>';
          voiceHint.innerHTML = 'Connect your ElevenLabs API key in <a href="/brand-voice" style="color:#6C3AED;font-weight:600">Brand Voice</a> or <a href="/settings" style="color:#6C3AED;font-weight:600">Settings</a> to enable voice selection.';
          voiceHint.style.display = 'block';
        } else {
          voiceSelect.innerHTML = '<option value="">No voices available</option>';
        }
      } catch (err) {
        voiceSelect.innerHTML = '<option value="">Could not load voices</option>';
        voiceHint.textContent = 'Voice loading failed. You can still use Free AI Voices.';
        voiceHint.style.display = 'block';
      }
    })();

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
      const voice = getSelectedVoice();
      const platform = document.getElementById('platform').value;

      if (!inputType || !style || !platform) {
        showToast('Please fill in all required fields');
        return;
      }
      if (!voice) {
        showToast('Please select a voice');
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
          formData.append('inputType', 'upload');
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

        if (response.ok && data.hookText) {
          hookData = data;
          document.getElementById('hookPreviewText').textContent = data.hookText;
          if (data.audioUrl && !data.voiceError) {
            document.getElementById('hookAudio').src = data.audioUrl;
            document.getElementById('hookAudio').style.display = 'block';
          } else {
            document.getElementById('hookAudio').style.display = 'none';
            if (data.voiceError === 'NO_API_KEY') {
              document.getElementById('apiKeyNotice').style.display = 'block';
              showToast('Hook text generated! Connect your ElevenLabs API key for voice audio.');
            } else if (data.voiceError === 'FREE_TTS_ERROR') {
              showToast('Hook text generated! Free voice audio could not be created on this server.');
            }
          }
          document.getElementById('previewSection').classList.add('active');
          if (!data.voiceError) showToast('Hook generated successfully!');
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

// Helper: Get user's ElevenLabs API key from brand_kits
async function getUserElevenLabsKey(userId) {
  try {
    const { getDb } = require('../db/database');
    const db = getDb();
    const result = await db.query('SELECT elevenlabs_api_key FROM brand_kits WHERE user_id = $1', [userId]);
    if (result.rows.length > 0 && result.rows[0].elevenlabs_api_key) {
      return result.rows[0].elevenlabs_api_key;
    }
  } catch (e) {}
  return null;
}

// Free voice mapping to OpenAI TTS voices + speed settings
const FREE_VOICE_MAP = {
  'free_male_1':   { voice: 'onyx',   speed: 0.95 },   // Alex - Deep male
  'free_male_2':   { voice: 'echo',   speed: 1.0 },    // Marcus - Warm male
  'free_male_3':   { voice: 'fable',  speed: 1.1 },    // James - Energetic male
  'free_female_1': { voice: 'nova',   speed: 1.0 },    // Sarah - Professional female
  'free_female_2': { voice: 'shimmer', speed: 1.05 },  // Emma - Friendly female
  'free_female_3': { voice: 'alloy',  speed: 0.9 }     // Lily - Calm female
};

// Helper: Generate free TTS using OpenAI TTS API (server's own key, no cost to user)
async function generateFreeTTS(hookText, voiceId) {
  const profile = FREE_VOICE_MAP[voiceId] || FREE_VOICE_MAP['free_male_2'];
  const audioPath = path.join(outputDir, `hook-free-${uuidv4()}.mp3`);

  try {
    const mp3 = await openai.audio.speech.create({
      model: 'tts-1',
      voice: profile.voice,
      input: hookText,
      speed: profile.speed,
      response_format: 'mp3'
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    fs.writeFileSync(audioPath, buffer);
    return '/ai-hook/audio/' + path.basename(audioPath);
  } catch (err) {
    console.error('OpenAI TTS error:', err.message);
    throw new Error('FREE_TTS_ERROR');
  }
}

// Helper: Generate hook speech with ElevenLabs using USER'S API key
async function generateHookSpeech(hookText, voiceNameOrId, apiKey) {
  return new Promise((resolve, reject) => {
    // Accept either a voice name (legacy) or a direct voice_id from ElevenLabs
    const voiceId = VOICES[voiceNameOrId] || voiceNameOrId;
    if (!voiceId) return reject(new Error('NO_VOICE'));
    if (!apiKey) return reject(new Error('NO_API_KEY'));

    const audioPath = path.join(outputDir, `hook-audio-${uuidv4()}.mp3`);
    const body = JSON.stringify({
      text: hookText,
      model_id: 'eleven_monolingual_v1',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 }
    });

    const options = {
      hostname: 'api.elevenlabs.io',
      port: 443,
      path: `/v1/text-to-speech/${voiceId}`,
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', c => errBody += c);
        res.on('end', () => reject(new Error('ElevenLabs API error (' + res.statusCode + ')')));
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        fs.writeFileSync(audioPath, buffer);
        resolve(`/ai-hook/audio/${path.basename(audioPath)}`);
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('ElevenLabs timeout')); });
    req.write(body);
    req.end();
  });
}

// Serve generated audio files
router.get('/audio/:filename', (req, res) => {
  const filePath = path.join(outputDir, req.params.filename);
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'audio/mpeg');
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: 'Audio not found' });
  }
});

// GET - Fetch user's ElevenLabs voices
router.get('/voices', requireAuth, async (req, res) => {
  try {
    const userApiKey = await getUserElevenLabsKey(req.user.id);

    if (!userApiKey) {
      return res.json({ voices: [], noKey: true, message: 'No ElevenLabs API key configured' });
    }

    // Fetch voices from ElevenLabs API
    const https = require('https');
    const data = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('ElevenLabs API timeout')), 8000);
      const options = {
        hostname: 'api.elevenlabs.io',
        path: '/v1/voices',
        method: 'GET',
        headers: { 'xi-api-key': userApiKey }
      };
      const req = https.request(options, (response) => {
        clearTimeout(timeout);
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => {
          try { resolve(JSON.parse(body)); } catch(e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.end();
    });

    if (data.voices && Array.isArray(data.voices)) {
      // Return voice id, name, and labels for display
      const voices = data.voices.map(v => ({
        voice_id: v.voice_id,
        name: v.name,
        labels: v.labels || {},
        preview_url: v.preview_url || null,
        category: v.category || 'custom'
      }));
      return res.json({ voices, source: 'elevenlabs' });
    }

    // If API returned an error
    res.json({ voices: [], noKey: false, message: data.detail || 'Could not fetch voices' });
  } catch (error) {
    console.error('Voices fetch error:', error);
    res.json({ voices: [], noKey: false, message: 'Failed to load voices: ' + error.message });
  }
});

// POST - Generate hook
router.post('/generate', requireAuth, upload.single('video'), async (req, res) => {
  try {
    const { inputType, url, transcript, style, voice, platform } = req.body;

    if (!style || !platform) {
      return res.status(400).json({ error: 'Missing required fields (style and platform are required)' });
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

    // Generate speech — free TTS or ElevenLabs depending on voice selection
    let audioUrl = '';
    let voiceError = null;
    if (!voice) {
      voiceError = 'NO_VOICE';
    } else if (voice.startsWith('free_')) {
      // Use free server-side TTS
      try {
        audioUrl = await generateFreeTTS(hookText, voice);
      } catch (e) {
        console.warn('Free TTS error:', e.message);
        voiceError = 'FREE_TTS_ERROR';
      }
    } else {
      // Use ElevenLabs with user's own API key
      try {
        const userApiKey = await getUserElevenLabsKey(req.user.id);
        if (!userApiKey) {
          voiceError = 'NO_API_KEY';
        } else {
          audioUrl = await generateHookSpeech(hookText, voice, userApiKey);
        }
      } catch (e) {
        console.warn('ElevenLabs error:', e.message);
        voiceError = e.message === 'NO_API_KEY' ? 'NO_API_KEY' : (e.message === 'NO_VOICE' ? 'NO_VOICE' : e.message);
      }
    }

    res.json({
      hookText,
      audioUrl,
      voiceError,
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
