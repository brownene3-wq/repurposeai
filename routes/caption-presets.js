const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');
const { featureUsageOps } = require('../db/database');

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
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .preset-card {
      background: var(--surface);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      overflow: hidden;
      transition: all 0.3s ease;
      display: flex;
      flex-direction: column;
    }

    .preset-card:hover {
      border-color: var(--primary);
      box-shadow: 0 6px 24px rgba(108, 58, 237, 0.2);
      transform: translateY(-3px);
    }

    .preview-container {
      background: #000000;
      height: 80px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      position: relative;
      overflow: hidden;
    }

    .preview-text {
      font-size: 0.95rem;
      text-align: center;
      white-space: nowrap;
      word-wrap: break-word;
      max-width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
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

    /* Hormozi - Alex Hormozi style: bold white with yellow keyword highlight */
    .hormozi .preview-text {
      font-weight: 900;
      font-size: 1.4rem;
      color: #ffffff;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .hormozi .word-highlight {
      color: #FACC15;
      background: rgba(250,204,21,0.15);
      padding: 0 4px;
      border-radius: 3px;
    }

    /* MrBeast - big bold colorful text with thick outline */
    .mrbeast .preview-text {
      font-weight: 900;
      font-size: 1.5rem;
      color: #FFD700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      text-shadow:
        -3px -3px 0 #1a1a1a,
        3px -3px 0 #1a1a1a,
        -3px 3px 0 #1a1a1a,
        3px 3px 0 #1a1a1a,
        -4px 0 0 #1a1a1a,
        4px 0 0 #1a1a1a,
        0 -4px 0 #1a1a1a,
        0 4px 0 #1a1a1a;
      -webkit-text-stroke: 1px #000;
    }

    /* Classic Subtitle - white text on semi-transparent black bar */
    .classic-sub .preview-container {
      background: #111;
    }
    .classic-sub .preview-text {
      background: rgba(0,0,0,0.75);
      color: #ffffff;
      font-weight: 500;
      font-size: 1rem;
      padding: 6px 16px;
      border-radius: 4px;
      letter-spacing: 0.02em;
    }

    /* Outline - thick outlined text, no fill */
    .outline-style .preview-text {
      font-weight: 900;
      font-size: 1.4rem;
      color: transparent;
      -webkit-text-stroke: 2px #ffffff;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    /* Glow - soft white glow effect */
    .soft-glow .preview-text {
      color: #ffffff;
      font-weight: 600;
      font-size: 1.2rem;
      text-shadow:
        0 0 10px rgba(255,255,255,0.8),
        0 0 20px rgba(255,255,255,0.5),
        0 0 40px rgba(255,255,255,0.3),
        0 0 60px rgba(168,85,247,0.3);
      letter-spacing: 0.05em;
    }

    /* Retro VHS - distorted retro look */
    .retro-vhs .preview-text {
      font-family: 'Courier New', monospace;
      color: #ff3366;
      font-weight: 700;
      font-size: 1.2rem;
      text-transform: uppercase;
      letter-spacing: 0.15em;
      text-shadow:
        2px 0 #00ffff,
        -2px 0 #ff0066,
        0 0 8px rgba(255,51,102,0.5);
    }

    /* Comic - fun playful style */
    .comic .preview-text {
      font-family: 'Comic Sans MS', 'Chalkboard SE', cursive;
      color: #ffffff;
      font-weight: 700;
      font-size: 1.2rem;
      background: linear-gradient(135deg, #FF6B6B, #FFE66D);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      filter: drop-shadow(2px 2px 0 #000);
    }

    /* Fire - orange/red gradient with glow */
    .fire .preview-text {
      font-weight: 800;
      font-size: 1.3rem;
      background: linear-gradient(180deg, #FFD700 0%, #FF6B00 40%, #FF0000 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      filter: drop-shadow(0 0 8px rgba(255,107,0,0.6));
    }

    /* Clean Modern - sleek sans-serif */
    .clean-modern .preview-text {
      font-weight: 500;
      font-size: 1.1rem;
      color: #ffffff;
      letter-spacing: 0.08em;
      border-bottom: 2px solid var(--primary);
      padding-bottom: 4px;
    }

    /* Podcast - centered with quotation marks feel */
    .podcast .preview-text {
      font-family: 'Georgia', 'Times New Roman', serif;
      color: #e2e8f0;
      font-weight: 400;
      font-size: 1.15rem;
      font-style: italic;
      letter-spacing: 0.02em;
      border-left: 3px solid var(--primary);
      padding-left: 12px;
    }

    /* TikTok Trending - bold with emoji-friendly rounded look */
    .tiktok-trend .preview-text {
      font-weight: 800;
      font-size: 1.3rem;
      color: #ffffff;
      background: linear-gradient(90deg, #25F4EE, #FE2C55);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    /* Shadow Drop - dramatic shadow */
    .shadow-drop .preview-text {
      font-weight: 800;
      font-size: 1.3rem;
      color: #ffffff;
      text-shadow:
        4px 4px 0 rgba(108,58,237,0.7),
        8px 8px 0 rgba(108,58,237,0.3);
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .preset-info {
      padding: 0.75rem;
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .preset-name {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 0.5rem;
    }

    .use-button {
      margin-top: auto;
      padding: 0.5rem 1rem;
      background: var(--primary);
      color: white;
      border: none;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      font-size: 0.8rem;
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

    /* Selected card state */
    .preset-card.selected {
      border-color: var(--primary);
      box-shadow: 0 0 0 2px var(--primary), 0 8px 32px rgba(108,58,237,0.25);
      position: relative;
    }
    .preset-card.selected::after {
      content: '✓';
      position: absolute;
      top: 6px;
      right: 6px;
      background: var(--primary);
      color: white;
      font-size: 0.65rem;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 10px;
      z-index: 2;
    }

    /* Modal styles */
    .style-modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(4px);
      z-index: 1000;
      display: none;
      align-items: center;
      justify-content: center;
    }
    .style-modal-overlay.show {
      display: flex;
    }
    .style-modal {
      background: var(--surface);
      border: 1px solid var(--border-subtle);
      border-radius: 20px;
      width: 90%;
      max-width: 480px;
      overflow: hidden;
      animation: modalIn 0.3s ease;
    }
    @keyframes modalIn {
      from { transform: scale(0.9); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
    .style-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid var(--border-subtle);
    }
    .style-modal-header h3 {
      font-size: 1.1rem;
      font-weight: 700;
      background: var(--gradient-1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .modal-close {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 1.5rem;
      cursor: pointer;
      padding: 0 0.25rem;
      line-height: 1;
    }
    .modal-close:hover { color: var(--text); }
    .style-modal-body {
      padding: 1.5rem;
    }
    .style-modal-body > p {
      color: var(--text-muted);
      font-size: 0.9rem;
      margin-bottom: 1.25rem;
    }
    .modal-preview {
      background: #000;
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 80px;
    }
    .modal-actions {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    .modal-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.85rem 1.5rem;
      border-radius: 10px;
      font-weight: 600;
      font-size: 0.95rem;
      cursor: pointer;
      transition: all 0.2s;
      text-decoration: none;
      border: none;
      font-family: inherit;
    }
    .modal-btn-primary {
      background: var(--primary);
      color: white;
    }
    .modal-btn-primary:hover {
      box-shadow: 0 8px 24px rgba(108,58,237,0.4);
      transform: translateY(-2px);
    }
    .modal-btn-secondary {
      background: rgba(108,58,237,0.15);
      color: var(--primary);
      border: 1px solid rgba(108,58,237,0.3);
    }
    .modal-btn-secondary:hover {
      background: rgba(108,58,237,0.25);
    }
    .modal-hint {
      font-size: 0.8rem;
      color: var(--text-muted);
      text-align: center;
      opacity: 0.7;
    }

    /* Responsive */
    @media (max-width: 768px) {
      .presets-grid {
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 0.75rem;
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
              <button class="use-button" onclick="useStyle('Karaoke','karaoke')">Use Style</button>
            </div>
          </div>

          <!-- Bold Pop -->
          <div class="preset-card bold-pop">
            <div class="preview-container">
              <div class="preview-text">BOLD POP</div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">Bold Pop</h3>
              <button class="use-button" onclick="useStyle('Bold Pop','bold-pop')">Use Style</button>
            </div>
          </div>

          <!-- Minimal -->
          <div class="preset-card minimal">
            <div class="preview-container">
              <div class="preview-text">subtle text</div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">Minimal</h3>
              <button class="use-button" onclick="useStyle('Minimal','minimal')">Use Style</button>
            </div>
          </div>

          <!-- Neon Glow -->
          <div class="preset-card neon-glow">
            <div class="preview-container">
              <div class="preview-text">NEON GLOW</div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">Neon Glow</h3>
              <button class="use-button" onclick="useStyle('Neon Glow','neon-glow')">Use Style</button>
            </div>
          </div>

          <!-- Gradient Wave -->
          <div class="preset-card gradient-wave">
            <div class="preview-container">
              <div class="preview-text">Gradient Wave</div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">Gradient Wave</h3>
              <button class="use-button" onclick="useStyle('Gradient Wave','gradient-wave')">Use Style</button>
            </div>
          </div>

          <!-- Typewriter -->
          <div class="preset-card typewriter">
            <div class="preview-container">
              <div class="preview-text">typewriter</div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">Typewriter</h3>
              <button class="use-button" onclick="useStyle('Typewriter','typewriter')">Use Style</button>
            </div>
          </div>

          <!-- Cinematic -->
          <div class="preset-card cinematic">
            <div class="preview-container">
              <div class="preview-text">Cinematic</div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">Cinematic</h3>
              <button class="use-button" onclick="useStyle('Cinematic','cinematic')">Use Style</button>
            </div>
          </div>

          <!-- Street -->
          <div class="preset-card street">
            <div class="preview-container">
              <div class="preview-text">STREET</div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">Street</h3>
              <button class="use-button" onclick="useStyle('Street','street')">Use Style</button>
            </div>
          </div>

          <!-- Hormozi -->
          <div class="preset-card hormozi">
            <div class="preview-container">
              <div class="preview-text">MAKE <span class="word-highlight">MONEY</span> NOW</div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">Hormozi</h3>
              <button class="use-button" onclick="useStyle('Hormozi','hormozi')">Use Style</button>
            </div>
          </div>

          <!-- MrBeast -->
          <div class="preset-card mrbeast">
            <div class="preview-container">
              <div class="preview-text">EPIC TEXT</div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">MrBeast</h3>
              <button class="use-button" onclick="useStyle('MrBeast','mrbeast')">Use Style</button>
            </div>
          </div>

          <!-- Classic Subtitle -->
          <div class="preset-card classic-sub">
            <div class="preview-container">
              <div class="preview-text">Classic subtitle text</div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">Classic Subtitle</h3>
              <button class="use-button" onclick="useStyle('Classic Subtitle','classic-sub')">Use Style</button>
            </div>
          </div>

          <!-- Outline -->
          <div class="preset-card outline-style">
            <div class="preview-container">
              <div class="preview-text">OUTLINE</div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">Outline</h3>
              <button class="use-button" onclick="useStyle('Outline','outline-style')">Use Style</button>
            </div>
          </div>

          <!-- Soft Glow -->
          <div class="preset-card soft-glow">
            <div class="preview-container">
              <div class="preview-text">Soft Glow</div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">Soft Glow</h3>
              <button class="use-button" onclick="useStyle('Soft Glow','soft-glow')">Use Style</button>
            </div>
          </div>

          <!-- Retro VHS -->
          <div class="preset-card retro-vhs">
            <div class="preview-container">
              <div class="preview-text">RETRO VHS</div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">Retro VHS</h3>
              <button class="use-button" onclick="useStyle('Retro VHS','retro-vhs')">Use Style</button>
            </div>
          </div>

          <!-- Comic -->
          <div class="preset-card comic">
            <div class="preview-container">
              <div class="preview-text">Fun Comic!</div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">Comic</h3>
              <button class="use-button" onclick="useStyle('Comic','comic')">Use Style</button>
            </div>
          </div>

          <!-- Fire -->
          <div class="preset-card fire">
            <div class="preview-container">
              <div class="preview-text">ON FIRE</div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">Fire</h3>
              <button class="use-button" onclick="useStyle('Fire','fire')">Use Style</button>
            </div>
          </div>

          <!-- Clean Modern -->
          <div class="preset-card clean-modern">
            <div class="preview-container">
              <div class="preview-text">Clean Modern</div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">Clean Modern</h3>
              <button class="use-button" onclick="useStyle('Clean Modern','clean-modern')">Use Style</button>
            </div>
          </div>

          <!-- Podcast -->
          <div class="preset-card podcast">
            <div class="preview-container">
              <div class="preview-text">The key insight is this...</div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">Podcast</h3>
              <button class="use-button" onclick="useStyle('Podcast','podcast')">Use Style</button>
            </div>
          </div>

          <!-- TikTok Trending -->
          <div class="preset-card tiktok-trend">
            <div class="preview-container">
              <div class="preview-text">TRENDING</div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">TikTok Trending</h3>
              <button class="use-button" onclick="useStyle('TikTok Trending','tiktok-trend')">Use Style</button>
            </div>
          </div>

          <!-- Shadow Drop -->
          <div class="preset-card shadow-drop">
            <div class="preview-container">
              <div class="preview-text">SHADOW</div>
            </div>
            <div class="preset-info">
              <h3 class="preset-name">Shadow Drop</h3>
              <button class="use-button" onclick="useStyle('Shadow Drop','shadow-drop')">Use Style</button>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>

  <div class="toast" id="toast"></div>

  <!-- Style Selection Modal -->
  <div class="style-modal-overlay" id="styleModal">
    <div class="style-modal">
      <div class="style-modal-header">
        <h3 id="modalTitle">Apply Caption Style</h3>
        <button class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      <div class="style-modal-body">
        <p id="modalDescription">Where would you like to use this caption style?</p>
        <div class="modal-preview" id="modalPreview"></div>
        <div class="modal-actions">
          <a href="/smart-shorts" class="modal-btn modal-btn-primary">
            <span>🎬</span> Use in Smart Shorts
          </a>
          <button class="modal-btn modal-btn-secondary" onclick="savePreference()">
            <span>💾</span> Set as Default Style
          </button>
        </div>
        <p class="modal-hint">Your selected style will be applied when generating clips in Smart Shorts</p>
      </div>
    </div>
  </div>

  <script>
    ${themeScript}

    let selectedStyle = null;

    function useStyle(styleName, styleClass) {
      selectedStyle = { name: styleName, class: styleClass };

      // Update modal
      document.getElementById('modalTitle').textContent = styleName + ' Style';
      document.getElementById('modalDescription').textContent = 'Apply "' + styleName + '" caption style to your videos';

      // Show preview in modal
      const previewEl = document.getElementById('modalPreview');
      const card = document.querySelector('.' + styleClass + ' .preview-text');
      if (card) {
        previewEl.innerHTML = '<div class="' + styleClass + '"><div class="preview-text">' + card.innerHTML + '</div></div>';
      }

      document.getElementById('styleModal').classList.add('show');
    }

    function closeModal() {
      document.getElementById('styleModal').classList.remove('show');
    }

    // Close modal on overlay click
    document.getElementById('styleModal').addEventListener('click', function(e) {
      if (e.target === this) closeModal();
    });

    async function savePreference() {
      if (!selectedStyle) return;

      try {
        const response = await fetch('/caption-presets/save-preference', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ style: selectedStyle.class, name: selectedStyle.name })
        });

        if (response.ok) {
          closeModal();
          showToast(selectedStyle.name + ' set as your default caption style!');

          // Highlight the selected card
          document.querySelectorAll('.preset-card').forEach(c => c.classList.remove('selected'));
          document.querySelector('.preset-card.' + selectedStyle.class).classList.add('selected');
        } else {
          showToast('Failed to save preference', true);
        }
      } catch (err) {
        showToast('Failed to save preference', true);
      }
    }

    function showToast(message, isError) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      if (isError) {
        toast.style.background = '#EF4444';
      } else {
        toast.style.background = 'var(--primary)';
      }
      toast.classList.remove('hide');
      toast.classList.add('show');

      setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hide');
      }, 2500);
    }

    // Load saved preference on page load
    (async function() {
      try {
        const response = await fetch('/caption-presets/get-preference');
        if (response.ok) {
          const data = await response.json();
          if (data.style) {
            const card = document.querySelector('.preset-card.' + data.style);
            if (card) card.classList.add('selected');
          }
        }
      } catch(e) {}
    })();
  </script>
</body>
</html>`;

  res.send(html);
});

// POST: Save caption style preference
router.post('/save-preference', requireAuth, async (req, res) => {
  try {
    const { style, name } = req.body;
    if (!style || !name) {
      return res.status(400).json({ error: 'Style and name are required' });
    }

    // Store preference in user's settings (using a simple cookie for now, can be DB later)
    res.cookie('caption_style', JSON.stringify({ style, name }), {
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
      httpOnly: false,
      sameSite: 'lax'
    });

    res.json({ success: true, style, name });
    featureUsageOps.log(req.user.id, 'caption_styles').catch(() => {});
  } catch (error) {
    console.error('Save caption preference error:', error);
    res.status(500).json({ error: 'Failed to save preference' });
  }
});

// GET: Get saved caption style preference
router.get('/get-preference', requireAuth, (req, res) => {
  try {
    const pref = req.cookies?.caption_style;
    if (pref) {
      const parsed = JSON.parse(pref);
      res.json(parsed);
    } else {
      res.json({ style: null, name: null });
    }
  } catch (error) {
    res.json({ style: null, name: null });
  }
});

module.exports = router;
