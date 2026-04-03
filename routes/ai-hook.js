const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const { requireAuth } = require('../middleware/auth');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
        .form-row {
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
            <label for="topic">Video Topic / Description</label>
            <textarea id="topic" name="topic" rows="4" placeholder="Describe your video topic or paste your script excerpt..." required></textarea>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="style">Hook Style</label>
              <select id="style" name="style" required>
                <option value="">Select a style</option>
                <option value="Question">Question</option>
                <option value="Bold Statement">Bold Statement</option>
                <option value="Statistic">Statistic</option>
                <option value="Story">Story</option>
                <option value="Controversy">Controversy</option>
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
                <option value="Facebook">Facebook</option>
                <option value="LinkedIn">LinkedIn</option>
              </select>
            </div>
          </div>

          <button type="submit" class="btn-generate" id="generateBtn">Generate Hooks</button>
        </form>
      </div>

      <div class="results-section">
        <div id="resultsContainer">
          <div class="empty-state">
            <p>Fill in the form above and click "Generate Hooks" to create your AI-powered opening lines</p>
          </div>
        </div>
      </div>
    </main>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    function showToast(message, duration = 3000) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.style.display = 'block';
      setTimeout(() => {
        toast.style.display = 'none';
      }, duration);
    }

    document.getElementById('hookForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const topic = document.getElementById('topic').value.trim();
      const style = document.getElementById('style').value;
      const platform = document.getElementById('platform').value;

      if (!topic || !style || !platform) {
        showToast('Please fill in all fields');
        return;
      }

      const btn = document.getElementById('generateBtn');
      btn.disabled = true;
      btn.innerHTML = '<span class="loading-spinner"></span> Generating...';

      try {
        const response = await fetch('/ai-hook/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic, style, platform })
        });

        const data = await response.json();

        if (response.ok && data.hooks) {
          const container = document.getElementById('resultsContainer');
          container.innerHTML = '<h2 style="margin-bottom: 1.5rem; color: var(--text);">Generated Hooks</h2>' +
            data.hooks.map((hook, idx) => \`
              <div class="hook-card">
                <div class="hook-text">\${hook}</div>
                <div class="hook-actions">
                  <button type="button" class="btn-copy" onclick="copyHook(this, '\${hook.replace(/'/g, "\\\\'")}')">Copy</button>
                </div>
              </div>
            \`).join('');
        } else {
          showToast(data.error || 'Failed to generate hooks');
        }
      } catch (error) {
        showToast('Error generating hooks');
        console.error(error);
      } finally {
        btn.disabled = false;
        btn.innerHTML = 'Generate Hooks';
      }
    });

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

// POST - Generate hooks
router.post('/generate', requireAuth, async (req, res) => {
  try {
    const { topic, style, platform } = req.body;

    if (!topic || !style || !platform) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const prompt = `Generate 5 unique and creative hooks for a ${platform} video about: "${topic}".
Each hook should use the "${style}" style and be scroll-stopping, attention-grabbing, and platform-optimized.
Make them concise (1-2 sentences max), punchy, and designed to maximize retention.
Return only the 5 hooks, one per line, without numbering or extra text.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.8
    });

    const text = completion.choices[0].message.content;
    const hooks = text.split('\n').filter(line => line.trim()).slice(0, 5);

    if (hooks.length === 0) {
      return res.status(500).json({ error: 'Failed to generate hooks' });
    }

    res.json({ hooks });
  } catch (error) {
    console.error('AI Hook error:', error);
    res.status(500).json({ error: 'Failed to generate hooks' });
  }
});

module.exports = router;
