const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');

router.get('/', requireAuth, (req, res) => {
  const headHTML = getHeadHTML('Caption Styles');
  const sidebar = getSidebar('caption-presets', req.user, req.teamPermissions);
  const themeToggle = getThemeToggle();
  const themeScript = getThemeScript();
  const baseCSS = getBaseCSS();

  const css = `
    ${baseCSS}

    :root {
      --primary: #6C3AED;
      --surface: #1a1a2e;
      --dark: #0f0f1e;
      --text: #ffffff;
      --text-muted: #a0aec0;
      --border-subtle: #2d2d4a;
      --gradient-1: linear-gradient(135deg, #6C3AED, #ec4899);
      --gradient-wave: linear-gradient(90deg, #a855f7, #ec4899);
      --neon-green: #39ff14;
      --neon-cyan: #00ffff;
      --golden: #d4a574;
    }

    [data-theme="light"] {
      --surface: #ffffff;
      --dark: #f5f5f5;
      --text: #1a1a2e;
      --text-muted: #64748b;
      --border-subtle: #e2e8f0;
      --gradient-1: linear-gradient(135deg, #6C3AED, #ec4899);
      --golden: #b8860b;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: var(--dark);
      color: var(--text);
      line-height: 1.6;
    }

    .dashboard {
      display: flex;
      height: 100vh;
      overflow: hidden;
    }

    .sidebar {
      flex-shrink: 0;
    }

    .main-content {
      flex: 1;
      overflow-y: auto;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 2rem;
      background: var(--surface);
      border-bottom: 1px solid var(--border-subtle);
      margin-bottom: 2rem;
    }

    .header-content h1 {
      font-size: 2rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
      background: var(--gradient-1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .header-content p {
      color: var(--text-muted);
      font-size: 0.95rem;
    }

    .theme-toggle-header {
      display: flex;
      align-items: center;
    }

    .content-wrapper {
      padding: 0 2rem 2rem 2rem;
      max-width: 1400px;
      margin: 0 auto;
    }

    .presets-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 2rem;
      margin-bottom: 2rem;
    }

    .preset-card {
      background: var(--surface);
      border: 1px solid var(--border-subtle);
      border-radius: 16px;
      overflow: hidden;
      transition: all 0.3s ease;
      display: flex;
      flex-direction: column;
    }

    .preset-card:hover {
      border-color: var(--primary);
      box-shadow: 0 8px 32px rgba(108, 58, 237, 0.2);
      transform: translateY(-4px);
    }

    .preview-container {
      background: #000000;
      height: 120px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
      position: relative;
      overflow: hidden;
    }

    .preview-text {
      font-size: 1.2rem;
      text-align: center;
      white-space: nowrap;
      word-wrap: break-word;
      max-width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
    }

    /* Preset Styles */
    .karaoke .preview-text {
      font-weight: 600;
      letter-spacing: 0.05em;
    }

    .karaoke .word-current {
      background: var(--gradient-wave);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .karaoke .word-next {
      color: #ffffff;
      opacity: 0.7;
    }

    .bold-pop .preview-text {
      font-weight: 900;
      font-size: 1.4rem;
      color: #ffffff;
      text-shadow:
        -2px -2px 0 #000000,
        2px -2px 0 #000000,
        -2px 2px 0 #000000,
        2px 2px 0 #000000,
        -2px 0 0 #000000,
        2px 0 0 #000000,
        0 -2px 0 #000000,
        0 2px 0 #000000,
        -3px 0 0 #000000,
        3px 0 0 #000000,
        0 -3px 0 #000000,
        0 3px 0 #000000;
    }

    .minimal .preview-text {
      font-weight: 300;
      font-size: 1rem;
      letter-spacing: 0.1em;
      color: #ffffff;
      text-transform: lowercase;
      opacity: 0.9;
    }

    .neon-glow .preview-text {
      color: var(--neon-green);
      font-weight: 600;
      font-size: 1.1rem;
      text-shadow:
        0 0 10px var(--neon-green),
        0 0 20px var(--neon-green),
        0 0 30px var(--neon-green),
        0 0 40px var(--neon-cyan),
        0 0 20px var(--neon-cyan);
      filter: brightness(1.2);
    }

    .gradient-wave .preview-text {
      background: var(--gradient-wave);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      font-weight: 700;
      font-size: 1.3rem;
      letter-spacing: 0.03em;
    }

    .typewriter .preview-text {
      font-family: 'Courier New', monospace;
      color: #00ff00;
      font-weight: 500;
      font-size: 1.1rem;
      letter-spacing: 0.05em;
      text-shadow: 0 0 8px rgba(0, 255, 0, 0.5);
    }

    .cinematic .preview-text {
      font-family: 'Georgia', 'Times New Roman', serif;
      color: var(--golden);
      font-weight: 600;
      font-size: 1.3rem;
      letter-spacing: 0.15em;
      font-style: italic;
    }

    .street .preview-text {
      font-weight: 900;
      color: #ffff00;
      font-size: 1.3rem;
      font-style: italic;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      text-shadow:
        2px 2px 0 #ff6600,
        4px 4px 0 #ff0000,
        -2px 2px 0 #ff0000;
    }

    .preset-info {
      padding: 1.5rem;
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .preset-name {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 1rem;
    }

    .use-button {
      margin-top: auto;
      padding: 0.75rem 1.5rem;
      background: var(--primary);
      color: white;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      font-size: 0.9rem;
    }

    .use-button:hover {
      background: linear-gradient(135deg, var(--primary), #a855f7);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(108, 58, 237, 0.4);
    }

    .use-button:active {
      transform: translateY(0);
    }

    /* Toast Notification */
    .toast {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      background: var(--primary);
      color: white;
      padding: 1rem 2rem;
      border-radius: 8px;
      box-shadow: 0 8px 32px rgba(108, 58, 237, 0.3);
      display: none;
      align-items: center;
      gap: 0.75rem;
      z-index: 1000;
      font-weight: 500;
      animation: slideIn 0.3s ease;
    }

    .toast.show {
      display: flex;
    }

    .toast::before {
      content: '✓';
      font-size: 1.5rem;
      font-weight: bold;
    }

    @keyframes slideIn {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }

    @keyframes slideOut {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(400px);
        opacity: 0;
      }
    }

    .toast.hide {
      animation: slideOut 0.3s ease forwards;
    }

    /* Responsive */
    @media (max-width: 768px) {
      .presets-grid {
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 1.5rem;
      }

      .header {
        padding: 1.5rem;
        margin-bottom: 1.5rem;
      }

      .header-content h1 {
        font-size: 1.5rem;
      }

      .content-wrapper {
        padding: 0 1rem 1.5rem 1rem;
      }

      .preview-container {
        height: 100px;
        padding: 1.5rem;
      }

      .preview-text {
        font-size: 1rem;
      }

      .bold-pop .preview-text {
        font-size: 1.1rem;
      }

      .cinematic .preview-text {
        font-size: 1rem;
        letter-spacing: 0.1em;
      }

      .street .preview-text {
        font-size: 1rem;
      }

      .toast {
        bottom: 1rem;
        right: 1rem;
        padding: 0.75rem 1.5rem;
        font-size: 0.9rem;
      }
    }

    @media (max-width: 480px) {
      .presets-grid {
        grid-template-columns: 1fr;
      }

      .header-content h1 {
        font-size: 1.25rem;
      }

      .header-content p {
        font-size: 0.85rem;
      }

      .preview-container {
        height: 100px;
      }

      .preview-text {
        font-size: 0.9rem;
      }
    }
  `;

  const html = `${headHTML}
<style>${css}</style>
</head>
<body>
  <div class="dashboard">
    ${sidebar}
    ${themeToggle}
    <main class="main-content">
      <div class="header">
        <div class="header-content">
          <h1>Caption Styles</h1>
          <p>Choose from premium caption presets to make your videos stand out</p>
        </div>
      </div>

      <div class="content-wrapper">
        <div class="presets-grid">
          <!-- Karaoke -->
          <div class="preset-card karaoke">
            <div class="preview-container">
              <div class="preview-text">
                <span class="word-current">Your</span> <span class="word-next">caption</span>
              </div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">Karaoke</h3>
              <button class="use-button" onclick="showToast('Karaoke')">Use Style</button>
            </div>
          </div>

          <!-- Bold Pop -->
          <div class="preset-card bold-pop">
            <div class="preview-container">
              <div class="preview-text">BOLD POP</div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">Bold Pop</h3>
              <button class="use-button" onclick="showToast('Bold Pop')">Use Style</button>
            </div>
          </div>

          <!-- Minimal -->
          <div class="preset-card minimal">
            <div class="preview-container">
              <div class="preview-text">subtle text</div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">Minimal</h3>
              <button class="use-button" onclick="showToast('Minimal')">Use Style</button>
            </div>
          </div>

          <!-- Neon Glow -->
          <div class="preset-card neon-glow">
            <div class="preview-container">
              <div class="preview-text">NEON GLOW</div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">Neon Glow</h3>
              <button class="use-button" onclick="showToast('Neon Glow')">Use Style</button>
            </div>
          </div>

          <!-- Gradient Wave -->
          <div class="preset-card gradient-wave">
            <div class="preview-container">
              <div class="preview-text">Gradient Wave</div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">Gradient Wave</h3>
              <button class="use-button" onclick="showToast('Gradient Wave')">Use Style</button>
            </div>
          </div>

          <!-- Typewriter -->
          <div class="preset-card typewriter">
            <div class="preview-container">
              <div class="preview-text">typewriter</div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">Typewriter</h3>
              <button class="use-button" onclick="showToast('Typewriter')">Use Style</button>
            </div>
          </div>

          <!-- Cinematic -->
          <div class="preset-card cinematic">
            <div class="preview-container">
              <div class="preview-text">Cinematic</div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">Cinematic</h3>
              <button class="use-button" onclick="showToast('Cinematic')">Use Style</button>
            </div>
          </div>

          <!-- Street -->
          <div class="preset-card street">
            <div class="preview-container">
              <div class="preview-text">STREET</div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">Street</h3>
              <button class="use-button" onclick="showToast('Street')">Use Style</button>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    ${themeScript}

    function showToast(styleName) {
      const toast = document.getElementById('toast');
      toast.textContent = 'Style applied!';
      toast.classList.remove('hide');
      toast.classList.add('show');

      setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hide');
      }, 2500);
    }
  </script>
</body>
</html>`;

  res.send(html);
});

module.exports = router;
