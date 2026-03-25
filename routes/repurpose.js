const express = require('express');
const router = express.Router();
const { getTranscript } = require('youtube-transcript');
const OpenAI = require('openai');
const { v4: uuidv4 } = require('uuid');
const requireAuth = require('../middleware/auth');
const { contentOps, outputOps, brandVoiceOps } = require('../db/database');

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// GET - Premium repurpose form page
router.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Repurpose Content - Content Repurpose SaaS</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          background: #0a0a0a;
          color: #e0e0e0;
          transition: background 0.3s, color 0.3s;
        }

        body.light {
          background: #f5f5f5;
          color: #1a1a1a;
        }

        .container {
          display: flex;
          min-height: 100vh;
        }

        .sidebar {
          width: 250px;
          background: #111;
          padding: 30px 20px;
          border-right: 1px solid #222;
          position: fixed;
          height: 100vh;
          overflow-y: auto;
        }

        body.light .sidebar {
          background: #f0f0f0;
          border-right: 1px solid #e0e0e0;
        }

        .logo {
          font-size: 24px;
          font-weight: bold;
          color: #6c5ce7;
          margin-bottom: 40px;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .sidebar a {
          display: block;
          padding: 12px 16px;
          color: #b0b0b0;
          text-decoration: none;
          border-radius: 8px;
          margin-bottom: 8px;
          transition: all 0.3s;
          font-size: 14px;
        }

        body.light .sidebar a {
          color: #666;
        }

        .sidebar a:hover {
          background: #1a1a1a;
          color: #6c5ce7;
        }

        body.light .sidebar a:hover {
          background: #e0e0e0;
          color: #6c5ce7;
        }

        .sidebar a.active {
          background: #6c5ce7;
          color: white;
        }

        .theme-toggle {
          position: absolute;
          bottom: 20px;
          left: 20px;
          width: 40px;
          height: 40px;
          border: 1px solid #222;
          background: #161616;
          border-radius: 8px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          transition: all 0.3s;
        }

        body.light .theme-toggle {
          background: #fff;
          border: 1px solid #ddd;
        }

        .theme-toggle:hover {
          border-color: #6c5ce7;
          color: #6c5ce7;
        }

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
          background: linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .header p {
          color: #888;
          font-size: 16px;
        }

        body.light .header p {
          color: #999;
        }

        .form-container {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 40px;
          max-width: 1200px;
        }

        .form-section {
          background: #161616;
          border: 1px solid #222;
          border-radius: 12px;
          padding: 30px;
          backdrop-filter: blur(10px);
        }

        body.light .form-section {
          background: #fff;
          border: 1px solid #e0e0e0;
        }

        .form-section h2 {
          font-size: 18px;
          margin-bottom: 20px;
          color: #e0e0e0;
        }

        body.light .form-section h2 {
          color: #1a1a1a;
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
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.3s;
          text-align: center;
          user-select: none;
          background: #0a0a0a;
        }

        body.light .platform-card {
          background: #f5f5f5;
          border: 2px solid #ddd;
        }

        .platform-card:hover {
          border-color: #6c5ce7;
        }

        .platform-card.selected {
          background: #6c5ce7;
          border-color: #6c5ce7;
          color: white;
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
        }

        .tone-option:hover {
          border-color: #6c5ce7;
        }

        .tone-option.selected {
          background: #6c5ce7;
          border-color: #6c5ce7;
          color: white;
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
          background: linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%);
          color: white;
        }

        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 30px rgba(108, 92, 231, 0.3);
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
          font-weight: 600;
          color: #6c5ce7;
        }

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

          .theme-toggle {
            position: static;
            margin-top: 20px;
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
        <div class="sidebar">
          <div class="logo">🎬 Repurpose</div>
          <a href="/dashboard">Dashboard</a>
          <a href="/repurpose" class="active">Repurpose</a>
          <a href="/repurpose/history">Library</a>
          <a href="/dashboard/analytics">Analytics</a>
          <a href="/dashboard/calendar">Calendar</a>
          <a href="/dashboard/scheduled">Scheduled</a>
          <a href="/brand-voice">Brand Voice</a>
          <a href="/billing">Billing</a>
          <a href="/contact">Support</a>
          <button class="theme-toggle" onclick="toggleTheme()">🌙</button>
        </div>

        <div class="main-content">
          <div class="header">
            <h1>Transform Your Content</h1>
            <p>Turn any YouTube video into tailored content for multiple platforms with AI</p>
          </div>

          <div class="form-container">
            <div class="form-section">
              <h2>Step 1: Your Content</h2>
              <div class="form-group">
                <label>YouTube URL</label>
                <input type="text" id="youtubeUrl" placeholder="https://www.youtube.com/watch?v=..." />
              </div>

              <h2 style="margin-top: 30px;">Step 2: Select Platforms</h2>
              <div class="platform-selector">
                <label class="platform-card">
                  <input type="checkbox" name="platform" value="Twitter" />
                  <span>𝕏 Twitter/X</span>
                </label>
                <label class="platform-card">
                  <input type="checkbox" name="platform" value="LinkedIn" />
                  <span>💼 LinkedIn</span>
                </label>
                <label class="platform-card">
                  <input type="checkbox" name="platform" value="Instagram" />
                  <span>📷 Instagram</span>
                </label>
                <label class="platform-card">
                  <input type="checkbox" name="platform" value="Facebook" />
                  <span>f Facebook</span>
                </label>
                <label class="platform-card" style="grid-column: 1 / -1;">
                  <input type="checkbox" name="platform" value="Blog" />
                  <span>📝 Blog Article</span>
                </label>
              </div>
            </div>

            <div class="form-section">
              <h2>Step 3: Tone & Brand Voice</h2>
              <div class="form-group">
                <label>Tone of Voice</label>
                <div class="tone-grid">
                  <label class="tone-option">
                    <input type="radio" name="tone" value="Professional" />
                    Professional
                  </label>
                  <label class="tone-option">
                    <input type="radio" name="tone" value="Casual" />
                    Casual
                  </label>
                  <label class="tone-option">
                    <input type="radio" name="tone" value="Humorous" />
                    Humorous
                  </label>
                  <label class="tone-option">
                    <input type="radio" name="tone" value="Inspirational" />
                    Inspirational
                  </label>
                  <label class="tone-option">
                    <input type="radio" name="tone" value="Educational" />
                    Educational
                  </label>
                </div>
              </div>

              <div class="form-group" style="margin-top: 20px;">
                <label>Brand Voice (Optional)</label>
                <select id="brandVoice">
                  <option value="">None</option>
                </select>
              </div>

              <div class="button-group">
                <button class="btn btn-primary" onclick="repurposeContent()">✨ Repurpose Now</button>
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
        let brandVoices = [];

        async function loadBrandVoices() {
          try {
            const response = await fetch('/api/brand-voices');
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

        document.querySelectorAll('.platform-card input').forEach(input => {
          input.parentElement.addEventListener('click', function(e) {
            if (e.target.tagName !== 'INPUT') {
              input.checked = !input.checked;
            }
            this.classList.toggle('selected');
          });
        });

        document.querySelectorAll('.tone-option input').forEach(input => {
          input.parentElement.addEventListener('click', function(e) {
            if (e.target.tagName !== 'INPUT') {
              document.querySelectorAll('.tone-option').forEach(opt => opt.classList.remove('selected'));
              this.classList.add('selected');
              input.checked = true;
            } else {
              document.querySelectorAll('.tone-option').forEach(opt => opt.classList.remove('selected'));
              this.classList.add('selected');
            }
          });
        });

        async function repurposeContent() {
          const url = document.getElementById('youtubeUrl').value.trim();
          const platforms = Array.from(document.querySelectorAll('input[name="platform"]:checked')).map(el => el.value);
          const tone = document.querySelector('input[name="tone"]:checked')?.value;
          const brandVoiceId = document.getElementById('brandVoice').value;

          if (!url) {
            showError('Please enter a YouTube URL');
            return;
          }

          if (platforms.length === 0) {
            showError('Please select at least one platform');
            return;
          }

          if (!tone) {
            showError('Please select a tone');
            return;
          }

          showLoading();

          try {
            const response = await fetch('/repurpose/process', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url,
                platforms,
                tone,
                brandVoiceId: brandVoiceId || null
              })
            });

            const data = await response.json();

            if (!response.ok) {
              throw new Error(data.error || 'Failed to repurpose content');
            }

            displayResults(data.outputs);
          } catch (error) {
            showError(error.message);
          }
        }

        function displayResults(outputs) {
          document.getElementById('loadingState').classList.remove('show');
          document.getElementById('resultsContent').style.display = 'block';

          const grid = document.getElementById('resultsGrid');
          grid.innerHTML = '';

          outputs.forEach(output => {
            const card = document.createElement('div');
            card.className = 'result-card';
            card.innerHTML = \`
              <div class="result-header">
                <div class="platform-name">\${output.platform}</div>
                <div class="char-count">\${output.generated_content.length} chars</div>
              </div>
              <div class="result-content">\${escapeHtml(output.generated_content)}</div>
              <div class="result-actions">
                <button class="icon-btn" onclick="copyToClipboard('\${escapeHtml(output.generated_content)}')">📋 Copy</button>
                <button class="icon-btn" onclick="regenerate('\${output.content_id}', '\${output.platform}')">🔄 Regenerate</button>
              </div>
            \`;
            grid.appendChild(card);
          });
        }

        function copyToClipboard(text) {
          const decoded = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'");
          navigator.clipboard.writeText(decoded).then(() => {
            const feedback = document.getElementById('successFeedback');
            feedback.classList.add('show');
            setTimeout(() => feedback.classList.remove('show'), 2000);
          });
        }

        function showLoading() {
          document.getElementById('resultsContainer').classList.add('show');
          document.getElementById('loadingState').classList.add('show');
          document.getElementById('resultsContent').style.display = 'none';
          document.getElementById('errorMessage').classList.remove('show');
        }

        function showError(message) {
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
          document.querySelectorAll('input[name="tone"]').forEach(el => {
            el.checked = false;
            el.parentElement.classList.remove('selected');
          });
          document.getElementById('brandVoice').value = '';
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

        function toggleTheme() {
          document.body.classList.toggle('light');
          localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark');
          const btn = document.querySelector('.theme-toggle');
          btn.textContent = document.body.classList.contains('light') ? '🌙' : '☀️';
        }

        if (localStorage.getItem('theme') === 'light') {
          document.body.classList.add('light');
          document.querySelector('.theme-toggle').textContent = '☀️';
        }

        loadBrandVoices();
      </script>
    </body>
    </html>
  `);
});

// POST - Process and generate content
router.post('/process', requireAuth, async (req, res) => {
  try {
    const { url, platforms, tone, brandVoiceId } = req.body;
    const userId = req.user.id;

    // Validate YouTube URL
    const youtubeRegex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/;
    if (!youtubeRegex.test(url)) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    // Get transcript
    const videoId = url.match(youtubeRegex)[1];
    let transcript;
    try {
      const transcripts = await getTranscript(videoId);
      transcript = transcripts.map(t => t.text).join(' ');
    } catch (error) {
      return res.status(400).json({ error: 'Could not fetch video transcript. Video may not have captions.' });
    }

    // Create content item
    const content = await contentOps.create(
      userId,
      `Video: ${videoId}`,
      transcript,
      'youtube',
      url
    );

    // Get brand voice if provided
    let brandVoice = null;
    if (brandVoiceId) {
      brandVoice = await brandVoiceOps.getById(brandVoiceId);
    }

    // Generate content for each platform
    const outputs = [];
    for (const platform of platforms) {
      try {
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

        outputs.push(output);
      } catch (error) {
        console.error(`Error generating content for ${platform}:`, error);
      }
    }

    res.json({ success: true, outputs });
  } catch (error) {
    console.error('Repurpose error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// Generate content for specific platform
async function generatePlatformContent(transcript, platform, tone, brandVoice) {
  const platformPrompts = {
    'Twitter': `Create a viral Twitter/X thread (3-5 tweets) based on this transcript. Keep each tweet under 280 characters. Focus on the most engaging and shareable points. Format as numbered tweets.`,
    'LinkedIn': `Write a professional LinkedIn post (200-300 words) based on this transcript. Include relevant industry insights and a call-to-action. Professional tone emphasizing business value.`,
    'Instagram': `Create an Instagram caption (100-150 characters) with 5-8 relevant hashtags. Make it engaging and visually descriptive. Suitable for an accompanying image or carousel post.`,
    'Facebook': `Write a Facebook post (150-300 words) that's engaging and encourages discussion. Include a call-to-action and ask a question to boost engagement.`,
    'Blog': `Write a complete blog article (800-1200 words) based on this transcript. Include: H2 headings for each section, 3-4 main sections, introduction and conclusion, and actionable insights.`
  };

  let prompt = platformPrompts[platform] || 'Create content based on this transcript';

  if (brandVoice) {
    prompt += `\n\nBrand Voice Guidelines:\n- Tone: ${brandVoice.tone}\n- Description: ${brandVoice.description}\n- Example: "${brandVoice.example_content}"\nMaintain consistency with these guidelines.`;
  }

  prompt += `\n\nTone of voice: ${tone}\n\nTranscript:\n${transcript}`;

  const response = await client.chat.completions.create({
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
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Content Library - Content Repurpose SaaS</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          background: #0a0a0a;
          color: #e0e0e0;
        }

        body.light {
          background: #f5f5f5;
          color: #1a1a1a;
        }

        .container {
          display: flex;
          min-height: 100vh;
        }

        .sidebar {
          width: 250px;
          background: #111;
          padding: 30px 20px;
          border-right: 1px solid #222;
          position: fixed;
          height: 100vh;
          overflow-y: auto;
        }

        body.light .sidebar {
          background: #f0f0f0;
          border-right: 1px solid #e0e0e0;
        }

        .logo {
          font-size: 24px;
          font-weight: bold;
          color: #6c5ce7;
          margin-bottom: 40px;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .sidebar a {
          display: block;
          padding: 12px 16px;
          color: #b0b0b0;
          text-decoration: none;
          border-radius: 8px;
          margin-bottom: 8px;
          transition: all 0.3s;
          font-size: 14px;
        }

        body.light .sidebar a {
          color: #666;
        }

        .sidebar a:hover {
          background: #1a1a1a;
          color: #6c5ce7;
        }

        body.light .sidebar a:hover {
          background: #e0e0e0;
          color: #6c5ce7;
        }

        .sidebar a.active {
          background: #6c5ce7;
          color: white;
        }

        .theme-toggle {
          position: absolute;
          bottom: 20px;
          left: 20px;
          width: 40px;
          height: 40px;
          border: 1px solid #222;
          background: #161616;
          border-radius: 8px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          transition: all 0.3s;
        }

        body.light .theme-toggle {
          background: #fff;
          border: 1px solid #ddd;
        }

        .theme-toggle:hover {
          border-color: #6c5ce7;
          color: #6c5ce7;
        }

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
          background: linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%);
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
          padding: 12px;
          background: #161616;
          border: 1px solid #333;
          border-radius: 8px;
          color: #e0e0e0;
          font-size: 14px;
        }

        body.light .search-input {
          background: #fff;
          border: 1px solid #ddd;
          color: #1a1a1a;
        }

        .search-input::placeholder {
          color: #888;
        }

        .content-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 20px;
          margin-bottom: 40px;
        }

        .content-card {
          background: #161616;
          border: 1px solid #222;
          border-radius: 12px;
          padding: 20px;
          cursor: pointer;
          transition: all 0.3s;
        }

        body.light .content-card {
          background: #fff;
          border: 1px solid #e0e0e0;
        }

        .content-card:hover {
          border-color: #6c5ce7;
          transform: translateY(-4px);
        }

        .card-title {
          font-weight: 600;
          margin-bottom: 10px;
          color: #e0e0e0;
        }

        body.light .card-title {
          color: #1a1a1a;
        }

        .card-date {
          font-size: 12px;
          color: #888;
          margin-bottom: 12px;
        }

        .card-platforms {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 12px;
        }

        .platform-badge {
          display: inline-block;
          background: #0a0a0a;
          color: #6c5ce7;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 500;
        }

        body.light .platform-badge {
          background: #f0f0f0;
        }

        .card-preview {
          color: #b0b0b0;
          font-size: 13px;
          line-height: 1.5;
          max-height: 60px;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        body.light .card-preview {
          color: #666;
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
        <div class="sidebar">
          <div class="logo">🎬 Repurpose</div>
          <a href="/dashboard">Dashboard</a>
          <a href="/repurpose">Repurpose</a>
          <a href="/repurpose/history" class="active">Library</a>
          <a href="/dashboard/analytics">Analytics</a>
          <a href="/dashboard/calendar">Calendar</a>
          <a href="/dashboard/scheduled">Scheduled</a>
          <a href="/brand-voice">Brand Voice</a>
          <a href="/billing">Billing</a>
          <a href="/contact">Support</a>
          <button class="theme-toggle" onclick="toggleTheme()">🌙</button>
        </div>

        <div class="main-content">
          <div class="header">
            <h1>Content Library</h1>
            <p>Browse and manage all your repurposed content</p>
          </div>

          <div class="controls">
            <input type="text" class="search-input" id="searchInput" placeholder="Search content..." />
          </div>

          <div class="content-grid" id="contentGrid"></div>

          <div class="empty-state" id="emptyState" style="display: none;">
            <h2>No content yet</h2>
            <p>Start by repurposing a video to see it here</p>
          </div>

          <div class="pagination">
            <button onclick="previousPage()" id="prevBtn">← Previous</button>
            <span id="pageInfo" style="padding: 10px 15px; color: #888;">Page 1</span>
            <button onclick="nextPage()" id="nextBtn">Next →</button>
          </div>
        </div>
      </div>

      <script>
        let allContent = [];
        let currentPage = 1;
        const itemsPerPage = 9;

        async function loadHistory() {
          try {
            const response = await fetch('/repurpose/api/history');
            const data = await response.json();
            allContent = data;
            renderPage();
          } catch (error) {
            console.error('Error loading history:', error);
          }
        }

        function renderPage() {
          const grid = document.getElementById('contentGrid');
          const emptyState = document.getElementById('emptyState');

          if (allContent.length === 0) {
            grid.innerHTML = '';
            emptyState.style.display = 'block';
            document.querySelector('.pagination').style.display = 'none';
            return;
          }

          emptyState.style.display = 'none';
          document.querySelector('.pagination').style.display = 'flex';

          const startIdx = (currentPage - 1) * itemsPerPage;
          const endIdx = startIdx + itemsPerPage;
          const pageItems = allContent.slice(startIdx, endIdx);

          grid.innerHTML = pageItems.map(item => \`
            <div class="content-card" onclick="viewContent('\${item.id}')">
              <div class="card-title">\${escapeHtml(item.title || 'Untitled')}</div>
              <div class="card-date">\${new Date(item.created_at).toLocaleDateString()}</div>
              <div class="card-platforms">
                \${item.platforms.map(p => \`<span class="platform-badge">\${p}</span>\`).join('')}
              </div>
              <div class="card-preview">\${escapeHtml((item.preview || '').substring(0, 100))}...</div>
            </div>
          \`).join('');

          document.getElementById('pageInfo').textContent = \`Page \${currentPage}\`;
          document.getElementById('prevBtn').disabled = currentPage === 1;
          document.getElementById('nextBtn').disabled = endIdx >= allContent.length;
        }

        function previousPage() {
          if (currentPage > 1) {
            currentPage--;
            renderPage();
            window.scrollTo(0, 0);
          }
        }

        function nextPage() {
          const maxPage = Math.ceil(allContent.length / itemsPerPage);
          if (currentPage < maxPage) {
            currentPage++;
            renderPage();
            window.scrollTo(0, 0);
          }
        }

        function viewContent(contentId) {
          // TODO: Implement detail view
          alert('Content detail view coming soon');
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

        function toggleTheme() {
          document.body.classList.toggle('light');
          localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark');
          const btn = document.querySelector('.theme-toggle');
          btn.textContent = document.body.classList.contains('light') ? '🌙' : '☀️';
        }

        if (localStorage.getItem('theme') === 'light') {
          document.body.classList.add('light');
          document.querySelector('.theme-toggle').textContent = '☀️';
        }

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
          preview: outputs[0]?.generated_content?.substring(0, 100) || ''
        };
      })
    );

    res.json(contentWithOutputs);
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
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
