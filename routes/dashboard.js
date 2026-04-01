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
  const html = `${getHeadHTML('Dashboard')}
  <style>
    ${getBaseCSS()}
    .repurpose-card{background:var(--surface);border-radius:16px;padding:2rem;border:1px solid rgba(108,58,237,0.15);margin-bottom:2rem}
    body.light .repurpose-card{border-color:rgba(108,58,237,0.12);box-shadow:0 2px 12px rgba(108,58,237,0.06)}
    .input-group{display:flex;gap:1rem;margin-bottom:1rem}
    .url-input{flex:1;padding:1rem 1.2rem;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:var(--text);font-size:1rem;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;outline:none;transition:border-color .3s}
    .url-input:focus{border-color:var(--primary)}
    .url-input::placeholder{color:var(--text-dim)}
    .video-preview{display:none;background:var(--dark);border-radius:12px;padding:1.5rem;margin-top:1.5rem;border:var(--border-subtle)}
    .video-preview.show{display:block}
    .video-info{display:flex;gap:1.5rem;align-items:start}
    .video-thumb{width:200px;height:112px;border-radius:8px;object-fit:cover;background:var(--surface-light)}
    .video-meta h3{font-size:1.1rem;font-weight:700;margin-bottom:.5rem}
    .video-meta p{color:var(--text-muted);font-size:.85rem}
    .results-section{display:none}
    .results-section.show{display:block}
    .platform-tabs{display:flex;gap:.5rem;margin-bottom:1.5rem;flex-wrap:wrap}
    .platform-tab{padding:.6rem 1.2rem;border-radius:10px;background:var(--surface);border:var(--border-subtle);color:var(--text-muted);cursor:pointer;font-size:.85rem;font-weight:500;transition:all .2s;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif}
    .platform-tab:hover,.platform-tab.active{background:linear-gradient(135deg,rgba(108,58,237,0.15),rgba(236,72,153,0.1));color:var(--primary-light);border-color:rgba(108,58,237,0.3)}
    .platform-content{background:var(--dark);border-radius:12px;padding:1.5rem;border:var(--border-subtle);display:none}
    .platform-content.show{display:block}
    .platform-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem}
    .platform-header h3{font-size:1rem;font-weight:700;display:flex;align-items:center;gap:.5rem}
    .platform-type{font-size:.75rem;color:var(--text-dim);background:var(--surface);padding:.3rem .8rem;border-radius:50px}
    .content-textarea{width:100%;min-height:200px;background:var(--surface);border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:var(--text);padding:1rem;font-size:.9rem;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;line-height:1.6;resize:vertical;outline:none}
    .content-textarea:focus{border-color:var(--primary)}
    .content-actions{display:flex;gap:.8rem;margin-top:1rem;flex-wrap:wrap}
    .char-count{font-size:.75rem;color:var(--text-dim);margin-top:.5rem}
    .loading-spinner{display:none;text-align:center;padding:3rem}
    .loading-spinner.show{display:block}
    .spinner{width:40px;height:40px;border:3px solid var(--surface);border-top-color:var(--primary);border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 1rem}
    @keyframes spin{to{transform:rotate(360deg)}}
    .stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:2rem}
    .stat-card{background:var(--surface);border-radius:16px;padding:1.5rem;border:1px solid rgba(108,58,237,0.12);position:relative;overflow:hidden;transition:transform 0.2s,box-shadow 0.2s}
    .stat-card:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(108,58,237,0.12)}
    .stat-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px}
    .stat-card:nth-child(1)::before{background:linear-gradient(90deg,#6C3AED,#EC4899)}
    .stat-card:nth-child(2)::before{background:linear-gradient(90deg,#0EA5E9,#6366F1)}
    .stat-card:nth-child(3)::before{background:linear-gradient(90deg,#F59E0B,#EF4444)}
    .stat-card:nth-child(4)::before{background:linear-gradient(90deg,#10B981,#06B6D4)}
    .stat-card .stat-value{font-size:1.8rem;font-weight:800;background:var(--gradient-1);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .stat-card .stat-label{font-size:.8rem;color:var(--text-dim);margin-top:.3rem}
    body.light .stat-card{border-color:rgba(108,58,237,0.1);box-shadow:0 2px 12px rgba(108,58,237,0.06)}
    body.light .stat-card:hover{box-shadow:0 8px 24px rgba(108,58,237,0.12)}
    @media(max-width:768px){.stats-grid{grid-template-columns:repeat(2,1fr)}.input-group{flex-direction:column}.video-info{flex-direction:column}.video-thumb{width:100%;height:auto}}
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
        <p>Paste a YouTube link and let AI create content for every platform.</p>
      </div>

      <div class="stats-grid">
        <div class="stat-card"><div class="stat-value">${videosProcessed}</div><div class="stat-label">Videos This Month</div></div>
        <div class="stat-card"><div class="stat-value">${postsGenerated}</div><div class="stat-label">Posts Generated</div></div>
        <div class="stat-card"><div class="stat-value">7</div><div class="stat-label">Platforms</div></div>
        <div class="stat-card"><div class="stat-value">${planLabel}</div><div class="stat-label">Current Plan</div></div>
      </div>

      <div class="repurpose-card" ${req.isTeamMember && (!req.teamPermissions || !req.teamPermissions.use_repurpose) ? 'style="display:none"' : ''}>
        <h2 style="font-size:1.2rem;font-weight:700;margin-bottom:1rem">&#x1F680; Repurpose a Video</h2>
        <div class="input-group">
          <input type="url" class="url-input" id="youtubeUrl" name="yt_dashboard_url" autocomplete="one-time-code" data-form-type="other" data-lpignore="true" placeholder="Paste YouTube URL here... (e.g. https://youtube.com/watch?v=...)">
          <button class="btn btn-primary" id="processBtn" onclick="processVideo()">&#x26A1; Repurpose</button>
        </div>

        <div class="loading-spinner" id="loading">
          <div class="spinner"></div>
          <p style="color:var(--text-muted)">AI is analyzing your video and generating content...</p>
        </div>
      </div>

      <div class="results-section" id="results" style="display:none;">
        <h2 style="font-size:1.2rem;font-weight:700;margin-bottom:1rem">&#x2728; Generated Content</h2>
        <div class="platform-tabs" id="platformTabs"></div>
        <div id="platformContents"></div>
        <p style="margin-top:1rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">Want all 7 platforms? <a href="/repurpose" style="color:var(--primary);">Go to Repurpose</a></p>
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
          '<textarea class="content-textarea" id="textarea-' + id + '" style="width:100%;min-height:200px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:0.9rem;resize:vertical;">' + text.replace(/</g, '&lt;') + '</textarea>' +
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
