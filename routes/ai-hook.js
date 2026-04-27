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
const { featureUsageOps } = require('../db/database');

// Boot guard — see shorts.js explanation
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'missing-openai-key' });

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

// yt-dlp detection (used for fetching YouTube transcripts)
let ytdlpPath = null;
try { execSync('which yt-dlp', { stdio: 'pipe' }); ytdlpPath = 'yt-dlp'; } catch (e) {}

// Common yt-dlp args — must mirror ai-captions.js / shorts.js exactly.
// The bgutil-pot extractor + js-runtimes flags are required on Railway
// to bypass YouTube's bot check; without them captions fetch returns empty.
const YTDLP_COMMON_ARGS = [
  '--no-warnings',
  '--no-check-certificates',
  '--geo-bypass',
  '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  '--extractor-args', 'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416',
  '--js-runtimes', 'node',
  '--remote-components', 'ejs:github',
  '--retries', '3',
  '--extractor-retries', '3',
];

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

      <!-- Hero Visual Section -->
      <div style="background:linear-gradient(135deg,rgba(124,58,237,0.15),rgba(236,72,153,0.1));border-radius:20px;padding:2.5rem;margin-bottom:2rem;position:relative;overflow:hidden;border:1px solid rgba(124,58,237,0.2)">
        <div style="display:flex;align-items:center;justify-content:center;gap:2rem;flex-wrap:wrap">
          <div style="background:linear-gradient(135deg,#7C3AED,#EC4899);border-radius:16px;padding:2rem 2.5rem;position:relative;min-width:200px;text-align:center">
            <div style="font-size:2.5rem;margin-bottom:0.5rem">🎬</div>
            <div style="display:flex;align-items:center;gap:4px;justify-content:center">
              <div style="width:3px;height:20px;background:rgba(255,255,255,0.6);border-radius:2px;animation:wave1 1s ease-in-out infinite"></div>
              <div style="width:3px;height:30px;background:rgba(255,255,255,0.8);border-radius:2px;animation:wave2 1s ease-in-out infinite 0.1s"></div>
              <div style="width:3px;height:25px;background:rgba(255,255,255,0.7);border-radius:2px;animation:wave1 1s ease-in-out infinite 0.2s"></div>
              <div style="width:3px;height:35px;background:rgba(255,255,255,0.9);border-radius:2px;animation:wave2 1s ease-in-out infinite 0.3s"></div>
              <div style="width:3px;height:20px;background:rgba(255,255,255,0.6);border-radius:2px;animation:wave1 1s ease-in-out infinite 0.4s"></div>
              <div style="width:3px;height:28px;background:rgba(255,255,255,0.8);border-radius:2px;animation:wave2 1s ease-in-out infinite 0.5s"></div>
              <div style="width:3px;height:22px;background:rgba(255,255,255,0.7);border-radius:2px;animation:wave1 1s ease-in-out infinite 0.6s"></div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div style="background:linear-gradient(135deg,#EC4899,#F472B6);border-radius:12px;padding:1.2rem;text-align:center;font-size:1.5rem">🎙️</div>
            <div style="background:linear-gradient(135deg,#06B6D4,#22D3EE);border-radius:12px;padding:1.2rem;text-align:center;font-size:1.5rem">🪝</div>
            <div style="background:linear-gradient(135deg,#8B5CF6,#A78BFA);border-radius:12px;padding:1.2rem;text-align:center;font-size:1.5rem">✨</div>
            <div style="background:linear-gradient(135deg,#F59E0B,#FBBF24);border-radius:12px;padding:1.2rem;text-align:center;font-size:1.5rem">🔊</div>
          </div>
        </div>
        <style>
          @keyframes wave1{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.5)}}
          @keyframes wave2{0%,100%{transform:scaleY(1.5)}50%{transform:scaleY(0.7)}}
        </style>
      </div>

      <!-- Quick Import Bar (input mode selector + active panel) -->
      <div style="background:var(--surface);border-radius:16px;padding:1.5rem;margin-bottom:2rem;border:1px solid var(--border-subtle)">
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:1.25rem">
          <button type="button" id="modeUrlBtn" onclick="setInputMode('youtube')" style="padding:12px 24px;background:var(--primary);color:#fff;border:1px solid var(--primary);border-radius:10px;cursor:pointer;font-weight:600;font-size:0.95rem;transition:all 0.2s">🔗 URL Input</button>
          <button type="button" id="modeUploadBtn" onclick="setInputMode('upload')" style="padding:12px 24px;background:var(--dark-2);color:var(--text-muted);border:1px solid rgba(255,255,255,0.1);border-radius:10px;cursor:pointer;font-weight:600;font-size:0.95rem;transition:all 0.2s">⬆ Upload</button>
          <button type="button" id="modeTextBtn" onclick="setInputMode('text')" style="padding:12px 24px;background:var(--dark-2);color:var(--text-muted);border:1px solid rgba(255,255,255,0.1);border-radius:10px;cursor:pointer;font-weight:600;font-size:0.95rem;transition:all 0.2s">📝 Text/Transcript</button>
        </div>

        <!-- URL Input panel -->
        <div id="qibUrlPanel" style="display:block">
          <div style="display:flex;gap:8px;width:100%;max-width:600px;margin:0 auto">
            <div style="position:relative;flex:1">
              <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:1rem">🔗</span>
              <input type="url" id="youtubeUrl" name="youtubeUrl" placeholder="Drop a YouTube link" style="width:100%;padding:12px 12px 12px 36px;background:var(--dark-2);border:1px solid var(--border-subtle);border-radius:10px;color:var(--text-primary);font-size:0.95rem">
            </div>
            <button type="button" id="heroImportBtn" onclick="document.getElementById('youtubeUrl').focus()" style="padding:10px 20px;background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:600;font-size:0.9rem;white-space:nowrap">▶ Import</button>
          </div>
        </div>

        <!-- Upload panel -->
        <div id="qibUploadPanel" style="display:none">
          <div class="upload-zone" id="uploadContainer" ondrop="handleDrop(event)" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)">
            <h3>📹 Drop your video here</h3>
            <p>Or click to browse</p>
            <button type="button" class="upload-button" onclick="document.getElementById('videoFile').click()">Select Video</button>
            <input type="file" id="videoFile" style="display:none" accept="video/*" onchange="handleFileSelect(event)">
            <p id="fileName" style="color: var(--text-muted); font-size: 0.85rem; margin-top: 1rem;"></p>
          </div>
          <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:1rem">
            <button type="button" style="padding:10px 20px;background:linear-gradient(135deg,#4285F4,#34A853);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:600;font-size:0.9rem">📁 Google Drive</button>
            <button type="button" style="padding:10px 20px;background:linear-gradient(135deg,#0061FF,#0041B3);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:600;font-size:0.9rem">📦 Dropbox</button>
          </div>
          <p style="text-align:center;font-size:0.8rem;color:var(--text-muted);margin-top:0.8rem">You can upload videos up to 120 minutes long.</p>
        </div>

        <!-- Text/Transcript panel -->
        <div id="qibTextPanel" style="display:none">
          <div class="form-group" style="margin-bottom:0;max-width:800px;margin-left:auto;margin-right:auto">
            <label for="transcript" style="display:block;margin-bottom:0.5rem;font-weight:600;color:var(--text);font-size:0.95rem">Video Transcript or Description</label>
            <textarea id="transcript" name="transcript" rows="5" placeholder="Paste your video transcript or describe the video content..." style="width:100%;padding:0.75rem;background:var(--dark-2);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text);font-family:inherit;font-size:0.9rem;resize:vertical"></textarea>
          </div>
        </div>
      </div>



      <div class="input-section">
        <form id="hookForm">
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
          <button type="button" class="btn-apply" id="applyBtn" onclick="downloadHookAssets()">⬇ Download Hook Assets</button>
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

    // Quick Import Bar mode state — single source of truth for input type
    var selectedInputMode = 'youtube'; // 'youtube' | 'upload' | 'text'

    // Voice provider state
    var activeVoiceProvider = 'free';

    function setInputMode(mode) {
      selectedInputMode = mode;
      var urlPanel = document.getElementById('qibUrlPanel');
      var uploadPanel = document.getElementById('qibUploadPanel');
      var textPanel = document.getElementById('qibTextPanel');
      var urlBtn = document.getElementById('modeUrlBtn');
      var uploadBtn = document.getElementById('modeUploadBtn');
      var textBtn = document.getElementById('modeTextBtn');

      // Hide all panels
      urlPanel.style.display = 'none';
      uploadPanel.style.display = 'none';
      textPanel.style.display = 'none';

      // Reset all buttons to inactive
      [urlBtn, uploadBtn, textBtn].forEach(function(btn) {
        btn.style.background = 'var(--dark-2)';
        btn.style.color = 'var(--text-muted)';
        btn.style.borderColor = 'rgba(255,255,255,0.1)';
      });

      // Show active panel and highlight active button
      var activeBtn;
      if (mode === 'youtube') {
        urlPanel.style.display = 'block';
        activeBtn = urlBtn;
      } else if (mode === 'upload') {
        uploadPanel.style.display = 'block';
        activeBtn = uploadBtn;
      } else if (mode === 'text') {
        textPanel.style.display = 'block';
        activeBtn = textBtn;
      }
      if (activeBtn) {
        activeBtn.style.background = 'var(--primary)';
        activeBtn.style.color = '#fff';
        activeBtn.style.borderColor = 'var(--primary)';
      }
    }

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

      const inputType = selectedInputMode;
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
          // If transcription couldn't be completed, let the user know the
          // hook was generated from limited context so they aren't surprised
          // by a generic-sounding result.
          if (data.transcriptWarning === 'NO_YT_CAPTIONS') {
            showToast('No captions found on this YouTube video — hook was generated from limited context.', 5000);
          } else if (data.transcriptWarning === 'TRANSCRIBE_FAILED') {
            showToast('Could not transcribe the uploaded video — hook was generated from limited context.', 5000);
          } else if (!data.voiceError) {
            showToast('Hook generated successfully!');
          }
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

    // Trigger a browser download for an in-memory Blob with the given filename.
    function triggerBlobDownload(blob, filename) {
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke after a tick so the download has time to register.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    }

    // Build a short, filesystem-friendly slug from arbitrary text so users
    // get descriptive filenames rather than UUIDs.
    function slugify(s, maxLen) {
      maxLen = maxLen || 40;
      return (s || 'hook')
        .toString()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, maxLen) || 'hook';
    }

    async function downloadHookAssets() {
      if (!hookData) {
        showToast('Generate a hook first');
        return;
      }
      const btn = document.getElementById('applyBtn');
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Preparing download...';

      try {
        const slug = slugify(hookData.hookText, 40);

        // 1) Fetch the audio file as a Blob and force-download it. This
        //    bypasses the audio player's inline-playback behavior so the
        //    user actually gets a saved file in their Downloads folder.
        if (hookData.audioUrl) {
          try {
            const audioResp = await fetch(hookData.audioUrl);
            if (!audioResp.ok) throw new Error('audio fetch ' + audioResp.status);
            const audioBlob = await audioResp.blob();
            triggerBlobDownload(audioBlob, 'hook-' + slug + '.mp3');
          } catch (e) {
            console.warn('Audio download failed:', e);
            showToast('Audio could not be downloaded — text file will still be saved.');
          }
        } else {
          showToast('No audio was generated for this hook — saving text file only.');
        }

        // 2) Build a small text document with the hook spec the user can
        //    drop into their editor of choice.
        const lines = [];
        lines.push('# Hook Assets — Splicora AI Hook Generator');
        lines.push('');
        lines.push('Generated for: ' + (hookData.platform || '—') + ' (' + (hookData.style || '—') + ' style)');
        lines.push('');
        lines.push('## Hook Text (spoken VO)');
        lines.push(hookData.hookText || '');
        lines.push('');
        if (Array.isArray(hookData.impactWords) && hookData.impactWords.length > 0) {
          lines.push('## Impact Words (on-screen visual kicker)');
          hookData.impactWords.forEach(function(w, i) { lines.push((i + 1) + '. ' + w); });
          lines.push('');
        }
        if (hookData.sfx) {
          lines.push('## Recommended SFX');
          lines.push(hookData.sfx);
          lines.push('');
        }
        if (hookData.visualStyle) {
          lines.push('## Visual Style');
          lines.push(hookData.visualStyle);
          lines.push('');
        }
        if (hookData.cameraMovement) {
          lines.push('## Camera Movement');
          lines.push(hookData.cameraMovement);
          lines.push('');
        }
        if (hookData.patternInterrupt) {
          lines.push('## Pattern Interrupt (visual shock)');
          lines.push(hookData.patternInterrupt);
          lines.push('');
        }
        lines.push('---');
        lines.push('Drop hook-' + slug + '.mp3 into your editor as the first audio clip,');
        lines.push('overlay the impact words on-screen during the spoken VO, and pair');
        lines.push('with the recommended SFX/visual treatment for maximum scroll-stop.');

        const textBlob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
        // Stagger the second download by a tick so browsers don't drop it
        // as a duplicate user gesture.
        setTimeout(function() {
          triggerBlobDownload(textBlob, 'hook-' + slug + '.txt');
          showToast('Hook assets downloaded — check your Downloads folder.');
        }, 250);
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
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
  
      // Rotating placeholder for the URL input in the Quick Import Bar
      (function(){
        var urlInput = document.getElementById('youtubeUrl');
        if(!urlInput) return;
        var placeholders = ['Drop a YouTube link','Drop a Rumble link','Drop a Zoom link','Drop a Twitch link'];
        var idx = 0;
        setInterval(function(){
          // Only rotate when the field is empty and not focused, so we never overwrite user typing
          if (document.activeElement === urlInput) return;
          if (urlInput.value && urlInput.value.length > 0) return;
          idx = (idx + 1) % placeholders.length;
          urlInput.placeholder = placeholders[idx];
        }, 2500);
      })();
</script>
</body>
</html>`;

  res.send(html);
});

// ---------------------------------------------------------------------------
// Transcript pipeline
// ---------------------------------------------------------------------------
// Three input modes ultimately converge on a single string `sourceTranscript`,
// which is then fed through a two-pass LLM (gold-nugget extraction → hook
// composition). This replaces the old approach where Upload/YouTube modes
// sent only the filename/URL to GPT and Text mode was truncated to 500 chars.

// Helper: Extract audio from video as low-bitrate mono MP3 (Whisper's 25MB cap)
function extractAudioFromVideo(videoPath) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg not available'));
    const audioPath = path.join(uploadDir, `hook-audio-${uuidv4()}.mp3`);
    const proc = spawn(ffmpegPath, [
      '-i', videoPath,
      '-vn',          // strip video
      '-ac', '1',     // mono
      '-ar', '16000', // 16kHz — Whisper's recommended sample rate
      '-b:a', '64k',  // 64kbps speech-quality mp3
      '-y',
      audioPath
    ]);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve(audioPath);
      else reject(new Error('Audio extraction failed: ' + stderr.slice(-200)));
    });
    proc.on('error', reject);
  });
}

// Helper: Transcribe an audio file with OpenAI Whisper
async function transcribeAudioFile(audioPath) {
  const audioBuffer = fs.readFileSync(audioPath);
  const file = new File([audioBuffer], 'audio.mp3', { type: 'audio/mpeg' });
  const result = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file: file,
    response_format: 'text'
  });
  // SDK returns plain string when response_format is 'text'
  return (typeof result === 'string' ? result : (result && result.text) || '').trim();
}

// Helper: full Upload-mode transcription (audio extract → Whisper → cleanup)
async function transcribeUploadedVideo(videoPath) {
  const audioPath = await extractAudioFromVideo(videoPath);
  try {
    const text = await transcribeAudioFile(audioPath);
    return text;
  } finally {
    try { fs.unlinkSync(audioPath); } catch (e) {}
  }
}

// Helper: Extract YouTube videoId from any of the supported URL shapes
function extractYoutubeVideoId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtube\.com\/live\/|youtube\.com\/v\/|youtube-nocookie\.com\/(?:embed|v)\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

// Helper: Run yt-dlp once for a given subtitle strategy, return path to subtitle file
function tryYtdlpSubs(videoId, args, tmpDir) {
  return new Promise((resolve) => {
    if (!ytdlpPath) {
      console.warn('[ai-hook] yt-dlp not found in PATH');
      return resolve(null);
    }
    let stderrTail = '';
    const proc = spawn(ytdlpPath, args);
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', (d) => { stderrTail = (stderrTail + d.toString()).slice(-400); });
    proc.on('close', (code) => {
      try {
        const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(videoId) && /\.(vtt|json3|srt)$/.test(f));
        if (files.length > 0) {
          resolve(path.join(tmpDir, files[0]));
        } else {
          if (code !== 0) console.warn(`[ai-hook] yt-dlp exit ${code}, stderr tail: ${stderrTail}`);
          resolve(null);
        }
      } catch (e) { resolve(null); }
    });
    proc.on('error', (err) => { console.warn(`[ai-hook] yt-dlp spawn error: ${err.message}`); resolve(null); });
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch (e) {} resolve(null); }, 20000);
  });
}

// Helper: Parse a VTT/JSON3/SRT subtitle file into plain text
function parseSubsToText(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    let lines = [];

    if (filePath.endsWith('.json3')) {
      const json = JSON.parse(content);
      const events = json.events || [];
      for (const ev of events) {
        if (ev.segs) {
          const text = ev.segs.map(s => s.utf8 || '').join('').replace(/\n/g, ' ').trim();
          if (text) lines.push(text);
        }
      }
    } else {
      // VTT / SRT
      const raw = content.split('\n');
      for (const line of raw) {
        if (!line.trim()) continue;
        if (line.includes('-->')) continue;
        if (/^\d+$/.test(line.trim())) continue;
        if (line.startsWith('WEBVTT') || line.startsWith('Kind:') || line.startsWith('Language:')) continue;
        const clean = line.replace(/<[^>]*>/g, '').trim();
        if (clean) lines.push(clean);
      }
    }

    // De-duplicate consecutive identical lines (common in YouTube auto-subs)
    const deduped = [];
    for (const l of lines) {
      if (deduped.length === 0 || deduped[deduped.length - 1] !== l) deduped.push(l);
    }
    return deduped.join(' ').replace(/\s+/g, ' ').trim();
  } finally {
    try { fs.unlinkSync(filePath); } catch (e) {}
  }
}

// Helper: full YouTube transcript fetch with multiple subtitle-format fallbacks
async function fetchYoutubeTranscriptText(url) {
  const videoId = extractYoutubeVideoId(url);
  if (!videoId) throw new Error('Could not extract YouTube video ID from URL');
  if (!ytdlpPath) throw new Error('yt-dlp not available on this server');

  const tmpDir = path.join('/tmp', 'ai-hook-subs');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const outTemplate = path.join(tmpDir, videoId);

  // Clean previous artifacts for this videoId
  try {
    fs.readdirSync(tmpDir)
      .filter(f => f.startsWith(videoId))
      .forEach(f => { try { fs.unlinkSync(path.join(tmpDir, f)); } catch (e) {} });
  } catch (e) {}

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Strategy 1: English manual + auto subs in json3 (most accurate parser path)
  console.log(`[ai-hook] Fetching YouTube transcript for ${videoId} — strategy 1 (en json3)`);
  let subFile = await tryYtdlpSubs(videoId, [
    '--skip-download', ...YTDLP_COMMON_ARGS,
    '--write-auto-subs', '--write-subs', '--sub-langs', 'en.*,en',
    '--sub-format', 'json3',
    '-o', outTemplate, videoUrl
  ], tmpDir);

  // Strategy 2: English subs in vtt
  if (!subFile) {
    console.log(`[ai-hook] strategy 2 (en vtt)`);
    subFile = await tryYtdlpSubs(videoId, [
      '--skip-download', ...YTDLP_COMMON_ARGS,
      '--write-auto-subs', '--write-subs', '--sub-langs', 'en.*,en',
      '--sub-format', 'vtt',
      '-o', outTemplate, videoUrl
    ], tmpDir);
  }

  // Strategy 3: any-language auto subs in json3
  if (!subFile) {
    console.log(`[ai-hook] strategy 3 (any json3)`);
    subFile = await tryYtdlpSubs(videoId, [
      '--skip-download', ...YTDLP_COMMON_ARGS,
      '--write-auto-subs', '--sub-langs', 'all',
      '--sub-format', 'json3',
      '-o', outTemplate, videoUrl
    ], tmpDir);
  }

  // Strategy 4: any manual subs in json3
  if (!subFile) {
    console.log(`[ai-hook] strategy 4 (any manual json3)`);
    subFile = await tryYtdlpSubs(videoId, [
      '--skip-download', ...YTDLP_COMMON_ARGS,
      '--write-subs', '--sub-langs', 'all',
      '--sub-format', 'json3',
      '-o', outTemplate, videoUrl
    ], tmpDir);
  }

  if (!subFile) {
    throw new Error('No transcript / captions available for this video');
  }

  console.log(`[ai-hook] Got subtitle file: ${path.basename(subFile)}`);
  const text = parseSubsToText(subFile);
  if (!text) throw new Error('Transcript parsed empty');
  return text;
}

// Helper: Cap the transcript at a generous size while preserving beginning,
// middle, and end — videos often hide the best nugget in the second half.
function smartCapTranscript(text, maxChars) {
  if (!text || text.length <= maxChars) return text;
  const third = Math.floor(maxChars / 3);
  const head = text.slice(0, third);
  const midStart = Math.floor(text.length / 2 - third / 2);
  const mid = text.slice(midStart, midStart + third);
  const tail = text.slice(-third);
  return head + '\n\n[...transcript trimmed for length...]\n\n' + mid + '\n\n[...transcript trimmed for length...]\n\n' + tail;
}

// Helper: First-pass LLM call — pull the highest-leverage moments from the
// transcript so the second pass has something to write a real hook around.
async function extractGoldNuggets(transcript, style, platform) {
  const prompt = `You are a viral short-form video editor analyzing a transcript to find the SINGLE most hook-worthy moments.

Read the transcript and identify 3-5 "gold nuggets" — specific moments that would make a viewer stop scrolling. Prioritize:
- Specific numbers, stats, or unexpected facts
- Contrarian claims or strong opinions
- Vulnerable admissions or personal stakes
- Surprising before/after transformations
- Counterintuitive results
- Concrete examples (not abstract advice)

For a ${platform} video in ${style} style, return STRICT JSON with this schema:
{
  "topic": "one-sentence summary of what the video is actually about",
  "nuggets": [
    {"text": "the specific quote, claim, or moment from the transcript", "why": "why this would stop a scroll"}
  ]
}

Transcript:
"""
${transcript}
"""`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 700,
    temperature: 0.4,
    response_format: { type: 'json_object' }
  });

  const raw = (completion.choices[0].message.content || '').trim();
  try {
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (e) {
    return { topic: '', nuggets: [] };
  }
}

// Helper: Second-pass LLM call — compose the actual hook spec using the
// nuggets (or the raw transcript when nugget extraction was skipped/failed).
async function composeHookSpec({ transcript, nuggets, sourceLabel, style, platform, hasTranscript }) {
  let contentBlock;
  if (nuggets && nuggets.nuggets && nuggets.nuggets.length > 0) {
    const nuggetLines = nuggets.nuggets.map((n, i) => `${i + 1}. "${n.text}" — ${n.why || ''}`).join('\n');
    contentBlock = `Topic: ${nuggets.topic || 'Unknown'}\n\nThe video's gold-nugget moments (lift specifics from these — don't paraphrase generically):\n${nuggetLines}\n\nFull transcript for additional context:\n"""\n${transcript}\n"""`;
  } else if (hasTranscript && transcript) {
    contentBlock = `Transcript of the video:\n"""\n${transcript}\n"""`;
  } else {
    contentBlock = `Source: ${sourceLabel || 'unknown'} (no transcript was available — write a generic ${style} hook for the platform)`;
  }

  const prompt = `You are a short-form video hook director. Produce a 3-5s "thumb-stopper" intro hook for a ${platform} video in the ${style} style.

${contentBlock}

Return STRICT JSON, no prose, matching this exact schema:
{
  "hookText": "spoken VO, 12-25 words, bold opener, designed to stop scrolling. PULL specific words/numbers/claims from the gold nuggets when available — do NOT write generic openers.",
  "impactWords": ["1-3 uppercase high-impact words pulled from hookText — single words or short 2-word phrases, the VISUAL kicker"],
  "sfx": "one of: whoosh, riser, bass_drop, record_scratch, tension_hit, cinematic_boom",
  "visualStyle": "lighting description: one of volumetric, neon_noir, high_contrast_bw, cinematic_warm, cyberpunk_glow",
  "cameraMovement": "one of fast_zoom_in, orbit_360, handheld_shake, dolly_push, whip_pan, rack_focus",
  "patternInterrupt": "one-sentence description of the visual shock/unexpected action designed to stop the scroll"
}

IMPORTANT:
- hookText should work for spoken delivery
- impactWords should be the literal words the viewer SEES on screen (huge centered text)
- sfx must be one of the enumerated values
- visualStyle + cameraMovement must be from the enumerated lists`;

  let completion;
  try {
    completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
      temperature: 0.9,
      response_format: { type: 'json_object' }
    });
  } catch (e) {
    console.warn('[ai-hook compose] gpt-4o-mini failed, retrying gpt-4:', e.message);
    completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt + '\n\nReturn ONLY the JSON object, no prose.' }],
      max_tokens: 400,
      temperature: 0.8
    });
  }

  const raw = (completion.choices[0].message.content || '').trim();
  let spec = {};
  try { spec = JSON.parse(raw); }
  catch (_) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try { spec = JSON.parse(m[0]); } catch (_) { spec = { hookText: raw.slice(0, 180) }; }
    } else {
      spec = { hookText: raw.slice(0, 180) };
    }
  }
  return spec;
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

// ═════════════════════════════════════════════════════════════════════
// Task #31 — POST /ai-hook/compose-clip
// Given a hookText + audioUrl (generated earlier via /ai-hook/generate),
// renders a ready-to-insert MP4 hook clip and returns its mediaUrl.
// The clip is a simple gradient title-card with the hook text drawn
// centered + the audio track mixed in. Caller inserts the returned URL
// as a V1 clip at the start of the timeline.
// Body: { hookText: string, audioUrl: string ('/ai-hook/audio/xxx.mp3'),
//         width?: int (default 1280), height?: int (default 720) }
// Returns: { success, mediaUrl, duration, downloadUrl }
// ═════════════════════════════════════════════════════════════════════
router.post('/compose-clip', requireAuth, async (req, res) => {
  try {
    if (!ffmpegPath){
      return res.status(500).json({ error: 'FFmpeg is not available on this server' });
    }
    const { hookText, audioUrl } = req.body || {};
    const W = parseInt((req.body || {}).width,  10) || 1280;
    const H = parseInt((req.body || {}).height, 10) || 720;
    // Task #41 — cinematic spec passed through from /generate
    const impactWordsIn = Array.isArray((req.body || {}).impactWords) ? (req.body || {}).impactWords.slice(0, 3) : [];
    const sfxSpec = String((req.body || {}).sfx || '').toLowerCase();
    const visualStyle = String((req.body || {}).visualStyle || 'cinematic_warm');
    const cameraMovement = String((req.body || {}).cameraMovement || 'fast_zoom_in');

    if (!hookText || typeof hookText !== 'string'){
      return res.status(400).json({ error: 'hookText is required' });
    }

    // Resolve the audio URL to a local file path. Accepts either
    // /ai-hook/audio/xxx.mp3 or a cross-origin URL. When the TTS
    // endpoint already wrote to outputDir, we just use that file.
    let audioPath = null;
    if (audioUrl){
      const m = /\/ai-hook\/audio\/([^?#]+)/.exec(audioUrl);
      if (m){
        const candidate = path.join(outputDir, path.basename(decodeURIComponent(m[1])));
        if (fs.existsSync(candidate)) audioPath = candidate;
      }
    }

    // If we still don't have audio on disk, synthesize silence for the
    // estimated speech duration so the hook clip is still insertable
    // (text shows, no voiceover). Speech rate ~2.7 words/sec → rough
    // duration estimate.
    let dur;
    const wordCount = (hookText.trim().match(/\S+/g) || []).length || 6;
    if (audioPath){
      // Probe the audio duration
      try {
        const ffprobe = require('fluent-ffmpeg').setFfmpegPath(ffmpegPath);
      } catch(_){}
      dur = await new Promise(function(resolve){
        const p = spawn(ffmpegPath, ['-i', audioPath, '-hide_banner']);
        let err = '';
        p.stderr.on('data', d => err += d.toString());
        p.on('close', function(){
          const m = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(err);
          if (m){ resolve(+m[1] * 3600 + +m[2] * 60 + parseFloat(m[3])); }
          else resolve(Math.min(8, Math.max(3, wordCount / 2.7)));
        });
        p.on('error', function(){ resolve(Math.min(8, Math.max(3, wordCount / 2.7))); });
      });
    } else {
      dur = Math.min(8, Math.max(3, wordCount / 2.7));
    }
    // Task #41 — Clamp hook to 3-5s thumb-stopper window. TTS audio that's
    // longer than 5s gets trimmed in the composer so the hook stays tight.
    dur = Math.max(3, Math.min(5, dur));

    // Build the clip: gradient background + centered text + audio
    const outputFilename = 'hook-clip-' + Date.now() + '-' + uuidv4().slice(0, 8) + '.mp4';
    const outputPath = path.join(outputDir, outputFilename);

    // Escape drawtext special chars in the hook text
    const escDT = s => String(s).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\u2019");
    const safeText = escDT(hookText.slice(0, 180));

    // Find a bold font (same fallback chain as /video-editor export)
    let fontFile = '';
    const FONT_CANDIDATES = [
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
      '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
      '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf'
    ];
    for (const f of FONT_CANDIDATES){
      if (fs.existsSync(f)){
        fontFile = f.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
        break;
      }
    }

    // Responsive font ~5.5% of width
    const fontSize = Math.round(W * 0.055);

    // Build drawtext with word-wrap (FFmpeg's drawtext has no native wrap,
    // so we do light client-side wrapping of long hooks into 2-3 lines).
    function wrapByChars(t, maxCharsPerLine){
      const words = t.split(/\s+/);
      const lines = [];
      let cur = '';
      for (const w of words){
        const test = cur ? cur + ' ' + w : w;
        if (test.length > maxCharsPerLine && cur){ lines.push(cur); cur = w; }
        else cur = test;
      }
      if (cur) lines.push(cur);
      return lines;
    }
    const charCap = Math.max(20, Math.floor(W / (fontSize * 0.55)));
    const lines = wrapByChars(hookText.slice(0, 180), charCap);
    const escLines = lines.map(escDT);
    const lineH = Math.round(fontSize * 1.25);
    const totalH = lineH * escLines.length;

    // ─── Task #41 — cinematic drawtext pipeline ──────────────────────
    // Small VO subtitle (bottom-centered) + HUGE animated impact words
    // (center-stage, time-synced to the hook's peak moment around
    // 60% through the clip).
    const peakT = dur * 0.6;
    const voFontSize = Math.round(W * 0.028);
    const voLineH    = Math.round(voFontSize * 1.25);
    const voTotalH   = voLineH * escLines.length;
    // Small VO subtitle at bottom
    const voFilters = escLines.map(function(ln, i){
      const y = 'h-h*0.10-' + (voTotalH - (i * voLineH));
      const parts = [
        'drawtext=text=\'' + ln + '\'',
        'fontsize=' + voFontSize,
        'fontcolor=white',
        'shadowx=0', 'shadowy=' + Math.max(1, Math.round(voFontSize * 0.1)),
        'shadowcolor=black@0.85',
        'borderw=2', 'bordercolor=black@0.6',
        'x=(w-text_w)/2',
        'y=' + y
      ];
      if (fontFile) parts.splice(3, 0, 'fontfile=' + fontFile);
      return parts.join(':');
    }).join(',');

    // Impact words — HUGE, centered, one per sub-window, scale-pulses at peak
    const impactWordsSafe = (impactWordsIn.length ? impactWordsIn : [hookText.split(/\s+/).slice(0, 2).join(' ').toUpperCase()])
      .slice(0, 3)
      .map(function(w){ return escDT(String(w).toUpperCase().slice(0, 22)); });

    // Each impact word gets a time window; the last one hits at peakT
    const impactFilters = impactWordsSafe.map(function(word, idx){
      // Window for this word: ~1.2s wide, spaced across the duration
      const winStart = (idx + 0.25) * (dur / (impactWordsSafe.length + 0.5));
      const winEnd   = winStart + 1.1;
      // Scale pulse: base ~12% height, pulses to ~16% at the midpoint
      const baseSize = Math.round(H * 0.14);
      const peakSize = Math.round(H * 0.19);
      // Time-varying size via 'fontsize' expression isn't directly supported
      // for non-expression mode, so we use two overlapping drawtext passes:
      // one 'intro' (fade in + base size) and a 'peak' marker the last
      // word gets an extra glow pass.
      const parts = [
        'drawtext=text=\'' + word + '\'',
        'fontsize=' + (idx === impactWordsSafe.length - 1 ? peakSize : baseSize),
        'fontcolor=white',
        'shadowx=0', 'shadowy=6', 'shadowcolor=black@0.9',
        'borderw=3', 'bordercolor=black@0.6',
        'x=(w-text_w)/2',
        'y=(h-text_h)/2-h*0.02',
        "enable='between(t\\," + winStart.toFixed(3) + "\\," + winEnd.toFixed(3) + ")'"
      ];
      if (fontFile) parts.splice(3, 0, 'fontfile=' + fontFile);
      return parts.join(':');
    }).join(',');

    // Visual-style lookup — picks a gradient + accent color based on the
    // spec returned by /generate.
    const STYLE_PRESETS = {
      'volumetric':         { bg: '0x0a0a1a', accent: '0x6366f1', box: '0x6366f1@0.22' },
      'neon_noir':          { bg: '0x0c0012', accent: '0xec4899', box: '0xec4899@0.28' },
      'high_contrast_bw':   { bg: '0x000000', accent: '0xffffff', box: '0xffffff@0.12' },
      'cinematic_warm':     { bg: '0x1a0f08', accent: '0xf59e0b', box: '0xf59e0b@0.22' },
      'cyberpunk_glow':     { bg: '0x050014', accent: '0x22d3ee', box: '0x22d3ee@0.28' }
    };
    const style = STYLE_PRESETS[visualStyle] || STYLE_PRESETS['cinematic_warm'];

    // Animated vignette via drawbox alpha ramp (simple camera-feel)
    const accentBoxChain =
      'drawbox=x=0:y=0:w=' + W + ':h=' + H +
      ':color=' + style.box + ':t=fill';

    const drawtextFilters = [accentBoxChain, impactFilters, voFilters]
      .filter(Boolean).join(',');

    const bgFilter =
      'color=c=' + style.bg + ':s=' + W + 'x' + H + ':r=30:d=' + dur.toFixed(3) +
      '[bg];[bg]format=yuv420p,' +
      drawtextFilters + '[v]';

    const VCODEC = ['-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p',
                    '-profile:v', 'high', '-level', '4.0'];
    const ACODEC = ['-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '128k'];

    // ─── Task #41 — Synthesize an SFX track via lavfi filters ────────
    // All SFX are generated on-the-fly in FFmpeg (no audio assets in the
    // repo). Each returns a named filterchain that produces stereo audio
    // at the specified duration, with a target peak amplitude.
    function buildSfxFilter(kind, D){
      // D = duration in seconds
      switch (kind){
        case 'riser':
          // Pitch-rising tone + noise build, resolves at peakT
          return 'sine=frequency=200:duration=' + D.toFixed(3) +
                 ':sample_rate=44100,' +
                 "volume='min(1\\,t/" + D.toFixed(3) + "*1.0)':eval=frame," +
                 'aformat=channel_layouts=stereo';
        case 'bass_drop':
          return 'sine=frequency=55:duration=' + D.toFixed(3) +
                 ':sample_rate=44100,' +
                 "volume='pow(min(1\\,t/" + peakT.toFixed(3) + ")\\,2)':eval=frame," +
                 'aformat=channel_layouts=stereo';
        case 'record_scratch':
          // Short noise pulse at the start
          return 'anoisesrc=amplitude=0.5:duration=0.4:color=pink,' +
                 "volume='max(0\\,1-t*2.5)':eval=frame," +
                 'apad=whole_dur=' + D.toFixed(3) + ',' +
                 'aformat=channel_layouts=stereo';
        case 'tension_hit':
          return 'sine=frequency=110:duration=0.35:sample_rate=44100,' +
                 "volume='max(0\\,1-t*2.8)':eval=frame," +
                 'apad=whole_dur=' + D.toFixed(3) + ',' +
                 'aformat=channel_layouts=stereo';
        case 'cinematic_boom':
          return 'sine=frequency=48:duration=0.8:sample_rate=44100,' +
                 "volume='max(0\\,1-t*1.2)':eval=frame," +
                 'apad=whole_dur=' + D.toFixed(3) + ',' +
                 'aformat=channel_layouts=stereo';
        case 'whoosh':
        default:
          // Band-pass sweep on white noise → classic whoosh feel
          return 'anoisesrc=amplitude=0.6:duration=' + Math.min(0.8, D).toFixed(3) + ':color=white,' +
                 "volume='max(0\\,1-t*1.2)':eval=frame," +
                 'apad=whole_dur=' + D.toFixed(3) + ',' +
                 'aformat=channel_layouts=stereo';
      }
    }
    const sfxFilter = buildSfxFilter(sfxSpec || 'whoosh', dur);

    let args;
    if (audioPath){
      // Mix the VO and the SFX together, ducking the SFX slightly so the
      // voice stays intelligible. amerge + volume=-6dB on SFX.
      args = [
        '-f', 'lavfi', '-i', 'color=c=' + style.bg + ':s=' + W + 'x' + H + ':r=30:d=' + dur.toFixed(3),
        '-i', audioPath,
        '-f', 'lavfi', '-i', sfxFilter,
        '-filter_complex',
          '[0:v]format=yuv420p,' + drawtextFilters + '[v];' +
          '[1:a]volume=1.0,atrim=0:' + dur.toFixed(3) + ',asetpts=PTS-STARTPTS[vo];' +
          '[2:a]volume=0.6,atrim=0:' + dur.toFixed(3) + ',asetpts=PTS-STARTPTS[sfx];' +
          '[vo][sfx]amix=inputs=2:duration=longest:dropout_transition=0[a]',
        '-map', '[v]', '-map', '[a]',
        '-t', dur.toFixed(3), '-shortest'
      ].concat(VCODEC).concat(ACODEC).concat(['-movflags', '+faststart', '-y', outputPath]);
    } else {
      // No TTS — just SFX + impact words (still cinematic)
      args = [
        '-f', 'lavfi', '-i', 'color=c=' + style.bg + ':s=' + W + 'x' + H + ':r=30:d=' + dur.toFixed(3),
        '-f', 'lavfi', '-i', sfxFilter,
        '-filter_complex',
          '[0:v]format=yuv420p,' + drawtextFilters + '[v];' +
          '[1:a]volume=0.85,atrim=0:' + dur.toFixed(3) + ',asetpts=PTS-STARTPTS[a]',
        '-map', '[v]', '-map', '[a]',
        '-t', dur.toFixed(3), '-shortest'
      ].concat(VCODEC).concat(ACODEC).concat(['-movflags', '+faststart', '-y', outputPath]);
    }

    // EARLY — skip the legacy fallback below (kept for older clients
    // that don't pass impactWords). Jump straight to run + respond.
    await runFFmpeg(args);
    if (!fs.existsSync(outputPath)){
      return res.status(500).json({ error: 'Failed to render hook clip' });
    }
    try {
      const veUploadDir = path.join('/tmp', 'repurpose-uploads');
      if (!fs.existsSync(veUploadDir)) fs.mkdirSync(veUploadDir, { recursive: true });
      const veDest = path.join(veUploadDir, outputFilename);
      fs.copyFileSync(outputPath, veDest);
    } catch(e){ console.warn('[ai-hook compose v2] copy to uploads failed:', e.message); }
    return res.json({
      success: true,
      mediaUrl: '/video-editor/download/' + outputFilename,
      downloadUrl: '/video-editor/download/' + outputFilename,
      duration: dur,
      impactWords: impactWordsSafe.map(function(w){ return w; }),
      sfx: sfxSpec || 'whoosh',
      visualStyle: visualStyle
    });
  } catch (err){
    console.error('[ai-hook compose-clip] error:', err);
    res.status(500).json({ error: err.message || 'Hook compose failed' });
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

    // Resolve the source transcript for each input mode. Upload runs Whisper,
    // YouTube runs yt-dlp subtitle fetch, Text uses what the user pasted.
    // If the upstream transcription fails we still continue with an empty
    // transcript so the user gets *some* hook back — better than a hard fail.
    let sourceTranscript = '';
    let sourceLabel = '';
    let transcriptWarning = null;

    if (inputType === 'upload' && req.file) {
      sourceLabel = req.file.originalname || 'uploaded video';
      try {
        sourceTranscript = await transcribeUploadedVideo(req.file.path);
      } catch (err) {
        console.warn('[ai-hook] Whisper transcription failed:', err.message);
        transcriptWarning = 'TRANSCRIBE_FAILED';
      }
    } else if (inputType === 'youtube' && url) {
      sourceLabel = url;
      // Hard wall-clock cap so we never hang the request behind a slow
      // yt-dlp call; if we can't get a transcript in 30s, fall through to
      // the no-transcript hook path (the user will see a toast).
      const TRANSCRIPT_TIMEOUT_MS = 30000;
      try {
        sourceTranscript = await Promise.race([
          fetchYoutubeTranscriptText(url),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Transcript fetch timed out')), TRANSCRIPT_TIMEOUT_MS))
        ]);
      } catch (err) {
        console.warn('[ai-hook] YouTube transcript fetch failed:', err.message);
        transcriptWarning = 'NO_YT_CAPTIONS';
      }
    } else if (inputType === 'text' && transcript) {
      sourceLabel = 'Pasted transcript';
      sourceTranscript = transcript;
    } else {
      return res.status(400).json({ error: 'No content provided' });
    }

    // Cap transcript to stay well within gpt-4o-mini's context window.
    // 20K chars ≈ 5K tokens — leaves plenty of room for prompt + completion.
    sourceTranscript = smartCapTranscript(sourceTranscript, 20000);

    // Two-pass generation: extract gold nuggets, then compose the hook.
    // Skip the nugget extraction for very short transcripts — there isn't
    // enough material to mine, so single-pass composition is fine.
    let nuggets = null;
    if (sourceTranscript.trim().length >= 200) {
      try {
        nuggets = await extractGoldNuggets(sourceTranscript, style, platform);
      } catch (err) {
        console.warn('[ai-hook] Nugget extraction failed:', err.message);
      }
    }

    const hookSpec = await composeHookSpec({
      transcript: sourceTranscript,
      nuggets,
      sourceLabel,
      style,
      platform,
      hasTranscript: sourceTranscript.trim().length > 0
    });

    const hookText = (hookSpec.hookText || '').toString().trim();
    const impactWords = Array.isArray(hookSpec.impactWords) ? hookSpec.impactWords.slice(0, 3).map(w => String(w || '').toUpperCase().slice(0, 20)) : [];
    const SFX_WHITELIST = ['whoosh', 'riser', 'bass_drop', 'record_scratch', 'tension_hit', 'cinematic_boom'];
    const sfx = SFX_WHITELIST.indexOf((hookSpec.sfx || '').toLowerCase()) >= 0 ? hookSpec.sfx.toLowerCase() : 'whoosh';
    const visualStyle = String(hookSpec.visualStyle || 'cinematic_warm');
    const cameraMovement = String(hookSpec.cameraMovement || 'fast_zoom_in');
    const patternInterrupt = String(hookSpec.patternInterrupt || '');

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
      transcriptWarning,
      transcriptLength: sourceTranscript.length,
      usedNuggets: !!(nuggets && nuggets.nuggets && nuggets.nuggets.length > 0),
      style,
      voice,
      platform,
      // Task #41 — cinematic spec for the composer
      impactWords,
      sfx,
      visualStyle,
      cameraMovement,
      patternInterrupt,
      videoPath: req.file ? req.file.path : null
    });
    featureUsageOps.log(req.user.id, 'ai_hooks').catch(() => {});
  } catch (error) {
    console.error('AI Hook error:', error);
    // Task #43 — surface the actual error so the client knows what's wrong
    res.status(500).json({ error: (error && error.message) || 'Failed to generate hook' });
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
