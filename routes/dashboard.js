const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { contentOps, outputOps } = require('../db/database');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');

router.get('/', requireAuth, async (req, res) => {
  // Fetch real stats
  let videosProcessed = 0, postsGenerated = 0;
  try {
    videosProcessed = await contentOps.countByUserIdThisMonth(req.user.id);
    postsGenerated = await outputOps.countByUserId(req.user.id);
  } catch (e) { console.error('Dashboard stats error:', e); }
  const planLabel = req.user.plan === 'pro' ? 'Pro' : req.user.plan === 'enterprise' ? 'Enterprise' : 'Free';
  const creditsUsed = videosProcessed;
  const creditsTotal = req.user.plan === 'pro' ? 100 : req.user.plan === 'enterprise' ? 500 : 5;
  const storageUsed = (postsGenerated * 0.02).toFixed(1);
  const storageTotal = req.user.plan === 'pro' ? '50' : req.user.plan === 'enterprise' ? '200' : '1';

  const html = `${getHeadHTML('Dashboard')}
  <style>
    ${getBaseCSS()}
    /* Hero Input Section */
    .hero-input{background:var(--surface);border-radius:20px;padding:2.5rem;border:1px solid rgba(108,58,237,0.15);margin-bottom:2rem;text-align:center}
    .hero-input h2{font-size:1.6rem;font-weight:800;margin-bottom:.5rem;background:var(--gradient-1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
    .hero-input p{color:var(--text-muted);font-size:.9rem;margin-bottom:1.5rem}
    .input-row{display:flex;gap:.8rem;max-width:700px;margin:0 auto 1rem}
    .url-input{flex:1;padding:1rem 1.2rem;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:14px;color:var(--text);font-size:1rem;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;outline:none;transition:border-color .3s}
    .url-input:focus{border-color:var(--primary)}
    .url-input::placeholder{color:var(--text-dim)}
    .or-divider{display:flex;align-items:center;gap:1rem;max-width:700px;margin:0 auto 1rem;color:var(--text-dim);font-size:.8rem}
    .or-divider::before,.or-divider::after{content:'';flex:1;height:1px;background:rgba(255,255,255,0.08)}
    .import-btns{display:flex;gap:.8rem;justify-content:center;flex-wrap:wrap}
    .import-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.7rem 1.4rem;border-radius:12px;background:var(--dark);border:1px solid rgba(255,255,255,0.08);color:var(--text-muted);font-size:.85rem;font-weight:500;cursor:pointer;transition:all .2s;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
    .import-btn:hover{border-color:var(--primary);color:var(--primary-light);background:rgba(108,58,237,0.08)}
    .import-btn svg{width:18px;height:18px}

    /* Tool Icons Grid */
    .tools-section{margin-bottom:2rem}
    .tools-section h3{font-size:1.1rem;font-weight:700;margin-bottom:1rem;color:var(--text)}
    .tools-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:1rem}
    .tool-card{background:var(--surface);border:1px solid rgba(108,58,237,0.1);border-radius:16px;padding:1.5rem 1rem;text-align:center;cursor:pointer;transition:all .25s;text-decoration:none;color:var(--text);position:relative;overflow:hidden}
    .tool-card:hover{transform:translateY(-3px);box-shadow:0 8px 30px rgba(108,58,237,0.15);border-color:rgba(108,58,237,0.3)}
    .tool-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:var(--gradient-1);opacity:0;transition:opacity .25s}
    .tool-card:hover::before{opacity:1}
    .tool-icon{font-size:2rem;margin-bottom:.6rem;display:block}
    .tool-label{font-size:.8rem;font-weight:600;color:var(--text-muted)}
    .tool-badge{position:absolute;top:.6rem;right:.6rem;font-size:.55rem;font-weight:700;background:var(--gradient-1);color:#fff;padding:2px 6px;border-radius:50px;text-transform:uppercase;letter-spacing:.5px}

    /* Stats Row */
    .stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:2rem}
    .stat-card{background:var(--surface);border-radius:16px;padding:1.3rem;border:1px solid rgba(108,58,237,0.12);position:relative;overflow:hidden}
    .stat-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px}
    .stat-card:nth-child(1)::before{background:linear-gradient(90deg,#6C3AED,#EC4899)}
    .stat-card:nth-child(2)::before{background:linear-gradient(90deg,#0EA5E9,#6366F1)}
    .stat-card:nth-child(3)::before{background:linear-gradient(90deg,#F59E0B,#EF4444)}
    .stat-card:nth-child(4)::before{background:linear-gradient(90deg,#10B981,#06B6D4)}
    .stat-value{font-size:1.6rem;font-weight:800;background:var(--gradient-1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
    .stat-label{font-size:.78rem;color:var(--text-dim);margin-top:.2rem}
    .stat-bar{margin-top:.6rem;height:4px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:hidden}
    .stat-bar-fill{height:100%;border-radius:4px;transition:width .5s ease}

    /* Recent Projects */
    .projects-section{margin-bottom:2rem}
    .projects-section h3{font-size:1.1rem;font-weight:700;margin-bottom:1rem}
    .empty-state{background:var(--surface);border:1px dashed rgba(255,255,255,0.1);border-radius:16px;padding:3rem;text-align:center;color:var(--text-dim)}
    .empty-state .empty-icon{font-size:3rem;margin-bottom:1rem;opacity:.5}
    .empty-state p{font-size:.9rem;margin-bottom:1rem}

    /* Quick Actions */
    .quick-actions{display:flex;gap:.8rem;justify-content:center;flex-wrap:wrap;margin-top:1rem}

    /* Loading */
    .loading-spinner{display:none;text-align:center;padding:3rem}
    .loading-spinner.show{display:block}
    .spinner{width:40px;height:40px;border:3px solid var(--surface);border-top-color:var(--primary);border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 1rem}
    @keyframes spin{to{transform:rotate(360deg)}}
    .results-section{display:none}
    .results-section.show{display:block}
    .platform-tabs{display:flex;gap:.5rem;margin-bottom:1.5rem;flex-wrap:wrap}
    .platform-tab{padding:.6rem 1.2rem;border-radius:10px;background:var(--surface);border:var(--border-subtle);color:var(--text-muted);cursor:pointer;font-size:.85rem;font-weight:500;transition:all .2s;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
    .platform-tab:hover,.platform-tab.active{background:linear-gradient(135deg,rgba(108,58,237,0.15),rgba(236,72,153,0.1));color:var(--primary-light);border-color:rgba(108,58,237,0.3)}
    .platform-content{background:var(--dark);border-radius:12px;padding:1.5rem;border:var(--border-subtle);display:none}
    .platform-content.show{display:block}
    .content-textarea{width:100%;min-height:200px;background:var(--surface);border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:var(--text);padding:1rem;font-size:.9rem;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;resize:vertical;outline:none}
    .content-textarea:focus{border-color:var(--primary)}

    /* Light theme overrides */
    body.light .hero-input,html.light .hero-input{border-color:rgba(108,58,237,0.12);box-shadow:0 2px 12px rgba(108,58,237,0.06)}
    body.light .url-input,html.light .url-input{background:#F8F9FC;border-color:rgba(0,0,0,0.1)}
    body.light .import-btn,html.light .import-btn{background:#F8F9FC;border-color:rgba(0,0,0,0.08);color:#4A5568}
    body.light .import-btn:hover,html.light .import-btn:hover{background:rgba(108,58,237,0.06)}
    body.light .or-divider::before,body.light .or-divider::after,html.light .or-divider::before,html.light .or-divider::after{background:rgba(0,0,0,0.08)}
    body.light .tool-card,html.light .tool-card{border-color:rgba(108,58,237,0.08);box-shadow:0 2px 8px rgba(108,58,237,0.04)}
    body.light .tool-card:hover,html.light .tool-card:hover{box-shadow:0 8px 24px rgba(108,58,237,0.1)}
    body.light .stat-card,html.light .stat-card{border-color:rgba(108,58,237,0.08);box-shadow:0 2px 8px rgba(0,0,0,0.04)}
    body.light .stat-bar,html.light .stat-bar{background:rgba(0,0,0,0.06)}
    body.light .empty-state,html.light .empty-state{border-color:rgba(0,0,0,0.1)}
    body.light .content-textarea,html.light .content-textarea{background:#F8F9FC;border-color:rgba(0,0,0,0.08)}

    @media(max-width:768px){
      .stats-row{grid-template-columns:repeat(2,1fr)}
      .tools-grid{grid-template-columns:repeat(auto-fill,minmax(100px,1fr))}
      .tool-card{padding:1rem .7rem}
      .tool-icon{font-size:1.6rem}
      .tool-label{font-size:.72rem}
      .input-row{flex-direction:column}
      .hero-input{padding:1.5rem}
      .hero-input h2{font-size:1.2rem}
    }
    @media(max-width:480px){
      .stats-row{grid-template-columns:1fr 1fr}
      .tools-grid{grid-template-columns:repeat(3,1fr)}
    }
  </style>
</head>
<body>
 <div class="dashboard">
    ${getSidebar('dashboard', req.user, req.teamPermissions)}

    <main class="main-content">
      ${getThemeToggle()}
      ${req.query.restricted === '1' ? '<div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:12px;padding:1rem 1.5rem;margin-bottom:1.5rem;color:#EF4444;font-size:.9rem;">You don\'t have permission to access that page. Contact your team admin to request access.</div>' : ''}

      <div class="page-header">
        <h1>&#x1F3AC; Content Studio</h1>
        <p>Transform your content into viral posts for every platform</p>
      </div>

      <!-- Stats Row -->
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-value">${creditsUsed}/${creditsTotal}</div>
          <div class="stat-label">Credits Used</div>
          <div class="stat-bar"><div class="stat-bar-fill" style="width:${Math.min((creditsUsed/creditsTotal)*100,100)}%;background:linear-gradient(90deg,#6C3AED,#EC4899)"></div></div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${postsGenerated}</div>
          <div class="stat-label">Posts Generated</div>
          <div class="stat-bar"><div class="stat-bar-fill" style="width:${Math.min(postsGenerated*5,100)}%;background:linear-gradient(90deg,#0EA5E9,#6366F1)"></div></div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${storageUsed} GB</div>
          <div class="stat-label">Storage (${storageTotal} GB)</div>
          <div class="stat-bar"><div class="stat-bar-fill" style="width:${Math.min((parseFloat(storageUsed)/parseFloat(storageTotal))*100,100)}%;background:linear-gradient(90deg,#F59E0B,#EF4444)"></div></div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${planLabel}</div>
          <div class="stat-label">Current Plan</div>
          <div class="stat-bar"><div class="stat-bar-fill" style="width:100%;background:linear-gradient(90deg,#10B981,#06B6D4)"></div></div>
        </div>
      </div>

      <!-- Hero Input -->
      <div class="hero-input" ${req.isTeamMember && (!req.teamPermissions || !req.teamPermissions.use_repurpose) ? 'style="display:none"' : ''}>
        <h2>&#x26A1; Start Creating</h2>
        <p>Paste a YouTube link, upload a file, or import from cloud storage</p>
        <div class="input-row">
          <input type="url" class="url-input" id="youtubeUrl" name="yt_dashboard_url" autocomplete="one-time-code" data-form-type="other" data-lpignore="true" placeholder="Paste YouTube URL here...">
          <button class="btn btn-primary" id="processBtn" onclick="processVideo()">&#x26A1; Repurpose</button>
        </div>
        <div class="or-divider"><span>or import from</span></div>
        <div class="import-btns">
          <button class="import-btn" onclick="alert('Google Drive import coming soon!')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 19.5h20L12 2z"/><path d="M2 19.5L8.5 8h14.5"/><path d="M15.5 8L22 19.5H2"/></svg>
            Google Drive
          </button>
          <button class="import-btn" onclick="alert('Dropbox import coming soon!')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l-7 4.5L12 11l7-4.5L12 2z"/><path d="M5 6.5L12 11l7-4.5"/><path d="M5 11.5L12 16l7-4.5"/><path d="M12 16v5"/></svg>
            Dropbox
          </button>
          <label class="import-btn" style="cursor:pointer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Upload File
            <input type="file" accept="video/*,audio/*" style="display:none" onchange="alert('File upload processing coming soon!')">
          </label>
        </div>
      </div>

      <!-- Loading State -->
      <div class="loading-spinner" id="loading">
        <div class="spinner"></div>
        <p style="color:var(--text-muted)">AI is analyzing your video and generating content...</p>
      </div>

      <!-- Results (immediately after input so user sees them right away) -->
      <div class="results-section" id="results" style="display:none;">
        <h2 style="font-size:1.2rem;font-weight:700;margin-bottom:1rem">&#x2728; Generated Content</h2>
        <div class="platform-tabs" id="platformTabs"></div>
        <div id="platformContents"></div>
        <p style="margin-top:1rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">Want all 7 platforms? <a href="/repurpose" style="color:var(--primary);">Go to Repurpose</a></p>
      </div>

      <!-- AI Tools Grid -->
      <div class="tools-section">
        <h3>&#x1F9E0; AI Tools</h3>
        <div class="tools-grid">
          <a href="/repurpose" class="tool-card">
            <span class="tool-icon">&#x1F504;</span>
            <span class="tool-label">Repurpose</span>
          </a>
          <a href="/shorts" class="tool-card">
            <span class="tool-icon">&#x2702;&#xFE0F;</span>
            <span class="tool-label">Smart Shorts</span>
          </a>
          <a href="/ai-hook" class="tool-card">
            <span class="tool-icon">&#x1F3A3;</span>
            <span class="tool-label">AI Hooks</span>
          </a>
          <a href="/caption-presets" class="tool-card">
            <span class="tool-icon">&#x1F4DD;</span>
            <span class="tool-label">Captions</span>
          </a>
          <a href="/ai-reframe" class="tool-card">
            <span class="tool-icon">&#x1F5BC;&#xFE0F;</span>
            <span class="tool-label">AI Reframe</span>
          </a>
          <a href="/video-editor" class="tool-card">
            <span class="tool-icon">&#x1F3AC;</span>
            <span class="tool-label">Video Editor</span>
          </a>
          <a href="/ai-captions" class="tool-card">
            <span class="tool-icon">&#x1F4AC;</span>
            <span class="tool-label">AI Captions</span>
            <span class="tool-badge">New</span>
          </a>
          <a href="/enhance-speech" class="tool-card">
            <span class="tool-icon">&#x1F399;&#xFE0F;</span>
            <span class="tool-label">Enhance Audio</span>
          </a>
          <a href="/ai-broll" class="tool-card">
            <span class="tool-icon">&#x1F3A5;</span>
            <span class="tool-label">AI B-Roll</span>
            <span class="tool-badge">New</span>
          </a>
          <a href="/brand-templates" class="tool-card">
            <span class="tool-icon">&#x1F3A8;</span>
            <span class="tool-label">Brand Templates</span>
            <span class="tool-badge">New</span>
          </a>
          <a href="/ai-thumbnail" class="tool-card">
            <span class="tool-icon">&#x1F5BC;&#xFE0F;</span>
            <span class="tool-label">AI Thumbnails</span>
          </a>
          <a href="/brand-voice" class="tool-card">
            <span class="tool-icon">&#x1F3A4;</span>
            <span class="tool-label">Brand Voice</span>
          </a>
          <a href="/dashboard/calendar" class="tool-card">
            <span class="tool-icon">&#x1F4C5;</span>
            <span class="tool-label">Scheduler</span>
          </a>
          <a href="/dashboard/analytics" class="tool-card">
            <span class="tool-icon">&#x1F4CA;</span>
            <span class="tool-label">Analytics</span>
          </a>
        </div>
      </div>

      <!-- Recent Projects -->
      <div class="projects-section">
        <h3>&#x1F4C2; Recent Projects</h3>
        <div class="empty-state" id="emptyState">
          <div class="empty-icon">&#x1F3AC;</div>
          <p>No projects yet. Paste a YouTube URL above to get started!</p>
          <div class="quick-actions">
            <a href="/repurpose" class="btn btn-primary btn-sm">&#x1F504; Repurpose a Video</a>
            <a href="/shorts" class="btn btn-outline btn-sm">&#x2702;&#xFE0F; Create Shorts</a>
          </div>
        </div>
      </div>
    </main>
  </div>

  <div class="toast" id="toast">Copied to clipboard!</div>

  <script>
    ${getThemeScript()}

    async function processVideo() {
      const url = document.getElementById('youtubeUrl').value.trim();
      if (!url) { alert('Please paste a YouTube URL'); return; }

      const btn = document.getElementById('processBtn');
      btn.disabled = true; btn.innerHTML = 'Processing...';
      document.getElementById('loading').classList.add('show');
      document.getElementById('results').style.display = 'none';
      document.getElementById('platformTabs').innerHTML = '';
      document.getElementById('platformContents').innerHTML = '';
      let platformCount = 0;

      try {
        const res = await fetch('/repurpose/process-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, platforms: ['Instagram','Twitter','LinkedIn'], tone: 'Professional' })
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || 'Server error');
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const NL = String.fromCharCode(10);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const parts = buffer.split(NL);
          buffer = parts.pop();

          for (const line of parts) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              try {
                const data = JSON.parse(trimmed.slice(6));
                if (data.error) { alert(data.error); break; }
                if (data.done) continue;
                if (data.platform) {
                  document.getElementById('loading').classList.remove('show');
                  document.getElementById('results').style.display = 'block';
                  document.getElementById('emptyState').style.display = 'none';
                  if (platformCount === 0) {
                    document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                  addPlatformResult(data, platformCount === 0);
                  platformCount++;
                }
              } catch(e) { console.log('Parse error:', e); }
            }
          }
        }
        if (platformCount === 0) {
          alert('No content was generated. Try a different video.');
        }
      } catch (err) {
        alert(err.message || 'Processing failed. Please try again.');
      } finally {
        btn.disabled = false; btn.innerHTML = '&#x26A1; Repurpose';
        document.getElementById('loading').classList.remove('show');
      }
    }

    function addPlatformResult(output, isFirst) {
      const tabs = document.getElementById('platformTabs');
      const contents = document.getElementById('platformContents');
      const platform = output.platform || 'Content';
      const text = output.generated_content || '';
      const id = platform.toLowerCase().replace(/[^a-z]/g, '');

      const tab = document.createElement('button');
      tab.className = 'platform-tab' + (isFirst ? ' active' : '');
      tab.textContent = platform;
      tab.dataset.platform = id;
      tab.onclick = () => switchTab(id);
      tabs.appendChild(tab);

      const div = document.createElement('div');
      div.className = 'platform-content' + (isFirst ? ' show' : '');
      div.id = 'content-' + id;
      div.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">' +
          '<h3 style="font-size:1rem;font-weight:600;color:var(--primary)">' + platform + '</h3>' +
          '<span style="font-size:0.75rem;color:var(--text-muted)">' + text.length + ' chars</span>' +
        '</div>' +
        '<textarea class="content-textarea" id="textarea-' + id + '">' + text.replace(/</g, '&lt;') + '</textarea>' +
        '<div style="margin-top:0.5rem;display:flex;gap:0.5rem;">' +
          '<button class="btn btn-primary btn-sm" onclick="copyText(\\'' + id + '\\')">&#x1F4CB; Copy</button>' +
        '</div>';
      contents.appendChild(div);
    }

    function switchTab(id) {
      document.querySelectorAll('.platform-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.platform-content').forEach(c => c.classList.remove('show'));
      document.querySelector('[data-platform="' + id + '"]').classList.add('active');
      document.getElementById('content-' + id).classList.add('show');
    }

    function copyText(id) {
      const ta = document.getElementById('textarea-' + id);
      navigator.clipboard.writeText(ta.value).then(() => {
        const toast = document.getElementById('toast');
        toast.style.display = 'block';
        setTimeout(() => { toast.style.display = 'none'; }, 2000);
      });
    }

    // Clear autofilled email from URL input
    (function() {
      var u = document.getElementById('youtubeUrl');
      if (u) {
        setTimeout(function() {
          if (u.value && (u.value.includes('@') || !u.value.includes('http'))) u.value = '';
        }, 100);
        u.addEventListener('focus', function() {
          if (this.value && this.value.includes('@')) this.value = '';
        });
      }
    })();

    // Allow Enter key to trigger processing
    document.getElementById('youtubeUrl').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') processVideo();
    });
  </script>
</body>
</html>`;
  res.send(html);
});

module.exports = router;
