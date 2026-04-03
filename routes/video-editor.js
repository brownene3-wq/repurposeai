const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');

router.get('/', requireAuth, async (req, res) => {
  const html = `${getHeadHTML('Video Editor')}
  <style>
    ${getBaseCSS()}
    .editor-container{display:flex;height:calc(100vh - 80px);gap:1.5rem;padding:1.5rem}
    .editor-main{flex:1;display:flex;flex-direction:column}
    .editor-header{margin-bottom:1rem}
    .editor-header h1{font-size:2rem;font-weight:800;margin-bottom:.25rem}
    .editor-header p{color:var(--text-muted);font-size:.95rem}
    .coming-soon-badge{display:inline-flex;align-items:center;gap:.5rem;background:linear-gradient(135deg,rgba(236,72,153,0.15),rgba(108,58,237,0.15));border:1px solid rgba(236,72,153,0.3);border-radius:50px;padding:.5rem 1.2rem;margin-bottom:1rem;font-size:.8rem;font-weight:600;color:var(--primary);}
    .video-container{background:var(--surface);border:1px solid var(--border-subtle);border-radius:16px;padding:1rem;flex:1;display:flex;flex-direction:column;min-height:0}
    .video-preview-area{background:linear-gradient(135deg,rgba(108,58,237,0.1),rgba(236,72,153,0.1));border-radius:12px;flex:1;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;min-height:300px}
    .video-preview-gradient{position:absolute;top:0;left:0;right:0;bottom:0;background:linear-gradient(135deg,#1e293b 0%,#0f172a 50%,#1e293b 100%);opacity:0.8}
    .video-play-button{position:relative;z-index:2;width:80px;height:80px;background:var(--primary);border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:transform 0.2s,box-shadow 0.2s}
    .video-play-button:hover{transform:scale(1.1);box-shadow:0 8px 32px rgba(108,58,237,0.4)}
    .video-play-button::after{content:'';width:0;height:0;border-left:28px solid white;border-top:18px solid transparent;border-bottom:18px solid transparent;margin-left:4px}
    .timeline-strip{margin-top:1rem;background:var(--dark);border-radius:10px;border:1px solid rgba(255,255,255,0.08);padding:12px;height:80px;display:flex;align-items:center;position:relative;overflow-x:auto}
    .timeline-content{display:flex;gap:8px;width:100%;min-width:100%;height:100%}
    .timeline-segment{flex:0 0 80px;height:100%;border-radius:6px;background:linear-gradient(135deg,#6366F1,#3B82F6);position:relative;cursor:pointer;transition:opacity 0.2s}
    .timeline-segment:nth-child(1){background:linear-gradient(135deg,#6C3AED,#EC4899)}
    .timeline-segment:nth-child(2){background:linear-gradient(135deg,#0EA5E9,#6366F1)}
    .timeline-segment:nth-child(3){background:linear-gradient(135deg,#F59E0B,#EF4444)}
    .timeline-segment:nth-child(4){background:linear-gradient(135deg,#10B981,#06B6D4)}
    .timeline-segment:nth-child(5){background:linear-gradient(135deg,#8B5CF6,#A78BFA)}
    .timeline-segment:hover{opacity:0.8}
    .trim-handle{position:absolute;top:0;bottom:0;width:8px;background:rgba(255,255,255,0.3);cursor:ew-resize;border-radius:2px}
    .trim-handle.left{left:0}
    .trim-handle.right{right:0}
    .tools-section{display:flex;gap:.6rem;margin-top:1rem;flex-wrap:wrap}
    .tool-button{padding:.6rem 1.2rem;background:var(--dark);border:1px solid var(--border-subtle);border-radius:10px;color:var(--text);cursor:pointer;font-size:.85rem;font-weight:500;transition:all .2s;display:flex;align-items:center;gap:.4rem;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif}
    .tool-button:hover{background:var(--surface);border-color:var(--primary);color:var(--primary)}
    .tool-button.active{background:var(--primary);color:white;border-color:var(--primary)}
    .editor-sidebar{width:320px;display:flex;flex-direction:column;gap:1rem}
    .properties-panel{background:var(--surface);border:1px solid var(--border-subtle);border-radius:16px;padding:1.5rem}
    .panel-title{font-size:.9rem;font-weight:700;color:var(--text);margin-bottom:1rem;display:flex;align-items:center;gap:.5rem}
    .slider-group{margin-bottom:1.5rem}
    .slider-label{font-size:.8rem;color:var(--text-muted);margin-bottom:.5rem;display:flex;justify-content:space-between}
    .slider-value{color:var(--primary);font-weight:600}
    .slider{width:100%;height:6px;border-radius:3px;background:var(--dark);outline:none;-webkit-appearance:none;appearance:none}
    .slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;border-radius:50%;background:var(--primary);cursor:pointer;transition:box-shadow 0.2s}
    .slider::-webkit-slider-thumb:hover{box-shadow:0 0 0 8px rgba(108,58,237,0.2)}
    .slider::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:var(--primary);cursor:pointer;border:none;transition:box-shadow 0.2s}
    .slider::-moz-range-thumb:hover{box-shadow:0 0 0 8px rgba(108,58,237,0.2)}
    .export-panel{background:var(--surface);border:1px solid var(--border-subtle);border-radius:16px;padding:1.5rem}
    .dropdown-group{margin-bottom:1.5rem}
    .dropdown-label{font-size:.8rem;color:var(--text-muted);margin-bottom:.5rem;display:block}
    .dropdown{width:100%;padding:.6rem .8rem;background:var(--dark);border:1px solid var(--border-subtle);border-radius:8px;color:var(--text);font-size:.85rem;outline:none;transition:border-color 0.2s;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;cursor:pointer}
    .dropdown:hover{border-color:var(--primary)}
    .dropdown:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgba(108,58,237,0.15)}
    .export-button{width:100%;padding:.8rem;background:var(--dark);border:1px solid var(--border-subtle);border-radius:10px;color:var(--text-muted);font-weight:600;cursor:not-allowed;font-size:.9rem;transition:opacity 0.2s;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;opacity:0.5}
    .export-button:disabled{opacity:0.5}
    .export-button:not(:disabled){background:var(--primary);color:white;border-color:var(--primary);cursor:pointer}
    .export-button:not(:disabled):hover{box-shadow:0 8px 24px rgba(108,58,237,0.3)}
    body.light .video-container{border-color:rgba(108,58,237,0.2);background:rgba(108,58,237,0.02)}
    body.light .timeline-strip{background:rgba(108,58,237,0.08);border-color:rgba(108,58,237,0.15)}
    body.light .properties-panel,body.light .export-panel{background:rgba(108,58,237,0.05);border-color:rgba(108,58,237,0.15)}
    body.light .tool-button{background:rgba(108,58,237,0.08);border-color:rgba(108,58,237,0.15);color:var(--text)}
    body.light .tool-button:hover{background:rgba(108,58,237,0.15);border-color:var(--primary)}
    body.light .dropdown{background:rgba(108,58,237,0.08);border-color:rgba(108,58,237,0.15)}
    body.light .slider{background:rgba(108,58,237,0.15)}
    @media(max-width:1200px){.editor-sidebar{width:280px}}
    @media(max-width:768px){.editor-container{flex-direction:column;height:auto;gap:1rem}.editor-main{min-height:600px}.editor-sidebar{width:100%}.video-preview-area{min-height:250px}.timeline-strip{height:70px}.tools-section{flex-direction:column}.tool-button{width:100%;justify-content:center}}
  </style>
</head>
<body>
 <div class="dashboard">
    ${getSidebar('video-editor', req.user, req.teamPermissions)}

    <main class="main-content">
      ${getThemeToggle()}

      <div class="editor-container">
        <div class="editor-main">
          <div class="editor-header">
            <div class="coming-soon-badge">
              <span>✨</span>
              <span>Coming Soon</span>
            </div>
            <h1>Video Editor</h1>
            <p>Trim, cut, and enhance your videos with AI-powered tools</p>
          </div>

          <div class="video-container">
            <div class="video-preview-area">
              <div class="video-preview-gradient"></div>
              <div class="video-play-button"></div>
            </div>

            <div class="timeline-strip">
              <div class="timeline-content">
                <div class="timeline-segment">
                  <div class="trim-handle left"></div>
                  <div class="trim-handle right"></div>
                </div>
                <div class="timeline-segment">
                  <div class="trim-handle left"></div>
                  <div class="trim-handle right"></div>
                </div>
                <div class="timeline-segment">
                  <div class="trim-handle left"></div>
                  <div class="trim-handle right"></div>
                </div>
                <div class="timeline-segment">
                  <div class="trim-handle left"></div>
                  <div class="trim-handle right"></div>
                </div>
                <div class="timeline-segment">
                  <div class="trim-handle left"></div>
                  <div class="trim-handle right"></div>
                </div>
              </div>
            </div>

            <div class="tools-section">
              <button class="tool-button active">✂️ Trim</button>
              <button class="tool-button">🔀 Split</button>
              <button class="tool-button">📝 Text Overlay</button>
              <button class="tool-button">✨ Transitions</button>
              <button class="tool-button">🎨 Filters</button>
              <button class="tool-button">⚡ Speed</button>
              <button class="tool-button">🔊 Audio</button>
            </div>
          </div>
        </div>

        <div class="editor-sidebar">
          <div class="properties-panel">
            <div class="panel-title">⚙️ Properties</div>

            <div class="slider-group">
              <div class="slider-label">
                <span>Brightness</span>
                <span class="slider-value">100%</span>
              </div>
              <input type="range" class="slider" min="0" max="200" value="100" disabled>
            </div>

            <div class="slider-group">
              <div class="slider-label">
                <span>Contrast</span>
                <span class="slider-value">100%</span>
              </div>
              <input type="range" class="slider" min="0" max="200" value="100" disabled>
            </div>

            <div class="slider-group">
              <div class="slider-label">
                <span>Saturation</span>
                <span class="slider-value">100%</span>
              </div>
              <input type="range" class="slider" min="0" max="200" value="100" disabled>
            </div>
          </div>

          <div class="export-panel">
            <div class="panel-title">📤 Export Settings</div>

            <div class="dropdown-group">
              <label class="dropdown-label">Resolution</label>
              <select class="dropdown" disabled>
                <option value="1080p">1080p (1920x1080)</option>
                <option value="720p" selected>720p (1280x720)</option>
                <option value="4k">4K (3840x2160)</option>
                <option value="480p">480p (854x480)</option>
              </select>
            </div>

            <div class="dropdown-group">
              <label class="dropdown-label">Format</label>
              <select class="dropdown" disabled>
                <option value="mp4" selected>MP4 (H.264)</option>
                <option value="mov">MOV (Apple ProRes)</option>
                <option value="webm">WebM (VP9)</option>
                <option value="gif">GIF (Animated)</option>
              </select>
            </div>

            <button class="export-button" disabled>📥 Export Video</button>
          </div>
        </div>
      </div>
    </main>
  </div>

  <script>
    ${getThemeScript()}

    // Slider value display updates (for demo purposes)
    document.querySelectorAll('.slider').forEach(slider => {
      slider.addEventListener('input', function() {
        const valueSpan = this.parentElement.querySelector('.slider-value');
        if (valueSpan) {
          valueSpan.textContent = this.value + '%';
        }
      });
    });
  </script>
</body>
</html>`;
  res.send(html);
});

module.exports = router;
