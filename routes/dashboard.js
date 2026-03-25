const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard - RepurposeAI</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#x26A1;</text></svg>">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    :root{--primary:#6C3AED;--primary-light:#8B5CF6;--dark:#0F0F1A;--dark-2:#1A1A2E;--surface:#1E1E32;--surface-light:#2A2A40;--text:#FFF;--text-muted:#A0AEC0;--text-dim:#718096;--gradient-1:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);--border-subtle:1px solid rgba(255,255,255,0.06);--success:#10B981;--warning:#F59E0B;--error:#EF4444}
 [data-theme="light"]{--dark:#F8F9FC;--dark-2:#EDF0F7;--surface:#FFFFFF;--surface-light:#F1F5F9;--text:#1A1A2E;--text-muted:#4A5568;--text-dim:#718096;--border-subtle:1px solid rgba(0,0,0,0.08);--success:#10B981;--warning:#F59E0B;--error:#EF4444}
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',sans-serif;background:var(--dark);color:var(--text);min-height:100vh;transition:background .3s,color .3s}
    .dashboard{display:flex;min-height:100vh}
    .sidebar{width:260px;background:var(--dark-2);border-right:var(--border-subtle);padding:1.5rem;display:flex;flex-direction:column;position:fixed;top:0;bottom:0}
    .sidebar-logo{font-size:1.4rem;font-weight:800;background:var(--gradient-1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;text-decoration:none;margin-bottom:2rem;display:block}
    .sidebar-nav{flex:1}
    .sidebar-nav a{display:flex;align-items:center;gap:.8rem;padding:.8rem 1rem;border-radius:10px;color:var(--text-muted);text-decoration:none;font-size:.9rem;font-weight:500;transition:all .2s;margin-bottom:.3rem}
    .sidebar-nav a:hover,.sidebar-nav a.active{background:rgba(108,58,237,0.15);color:var(--text)}
    .sidebar-nav a.active{color:var(--primary-light)}
    .sidebar-user{padding:1rem;background:var(--surface);border-radius:12px;display:flex;align-items:center;gap:.8rem}
    .sidebar-avatar{width:36px;height:36px;border-radius:50%;background:var(--gradient-1);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.85rem}
    .sidebar-username{font-size:.85rem;font-weight:600}
    .sidebar-email{font-size:.75rem;color:var(--text-dim)}
    .main-content{flex:1;margin-left:260px;padding:2rem}
    .page-header{margin-bottom:2rem}
    .page-header h1{font-size:1.8rem;font-weight:800;margin-bottom:.5rem}
    .page-header p{color:var(--text-muted);font-size:.95rem}
    .repurpose-card{background:var(--surface);border-radius:16px;padding:2rem;border:var(--border-subtle);margin-bottom:2rem}
    .input-group{display:flex;gap:1rem;margin-bottom:1rem}
    .url-input{flex:1;padding:1rem 1.2rem;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:var(--text);font-size:1rem;font-family:'Inter',sans-serif;outline:none;transition:border-color .3s}
    .url-input:focus{border-color:var(--primary)}
    .url-input::placeholder{color:var(--text-dim)}
    .btn{display:inline-flex;align-items:center;gap:.5rem;padding:.8rem 1.8rem;border-radius:50px;font-weight:600;font-size:.9rem;cursor:pointer;border:none;transition:all .3s;font-family:'Inter',sans-serif}
    .btn-primary{background:var(--gradient-1);color:#fff;box-shadow:0 4px 20px rgba(108,58,237,0.4)}
    .btn-primary:hover{transform:translateY(-1px);box-shadow:0 6px 30px rgba(108,58,237,0.5)}
    .btn-primary:disabled{opacity:.5;cursor:not-allowed;transform:none}
    .btn-sm{padding:.5rem 1rem;font-size:.8rem}
    .btn-outline{background:transparent;color:var(--text);border:1px solid rgba(255,255,255,0.2)}
    .btn-outline:hover{border-color:var(--primary-light);color:var(--primary-light)}
    .video-preview{display:none;background:var(--dark);border-radius:12px;padding:1.5rem;margin-top:1.5rem;border:var(--border-subtle)}
    .video-preview.show{display:block}
    .video-info{display:flex;gap:1.5rem;align-items:start}
    .video-thumb{width:200px;height:112px;border-radius:8px;object-fit:cover;background:var(--surface-light)}
    .video-meta h3{font-size:1.1rem;font-weight:700;margin-bottom:.5rem}
    .video-meta p{color:var(--text-muted);font-size:.85rem}
    .results-section{display:none}
    .results-section.show{display:block}
    .platform-tabs{display:flex;gap:.5rem;margin-bottom:1.5rem;flex-wrap:wrap}
    .platform-tab{padding:.6rem 1.2rem;border-radius:10px;background:var(--surface);border:var(--border-subtle);color:var(--text-muted);cursor:pointer;font-size:.85rem;font-weight:500;transition:all .2s;font-family:'Inter',sans-serif}
    .platform-tab:hover,.platform-tab.active{background:rgba(108,58,237,0.2);color:var(--primary-light);border-color:rgba(108,58,237,0.3)}
    .platform-content{background:var(--dark);border-radius:12px;padding:1.5rem;border:var(--border-subtle);display:none}
    .platform-content.show{display:block}
    .platform-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem}
    .platform-header h3{font-size:1rem;font-weight:700;display:flex;align-items:center;gap:.5rem}
    .platform-type{font-size:.75rem;color:var(--text-dim);background:var(--surface);padding:.3rem .8rem;border-radius:50px}
    .content-textarea{width:100%;min-height:200px;background:var(--surface);border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:var(--text);padding:1rem;font-size:.9rem;font-family:'Inter',sans-serif;line-height:1.6;resize:vertical;outline:none}
    .content-textarea:focus{border-color:var(--primary)}
    .content-actions{display:flex;gap:.8rem;margin-top:1rem;flex-wrap:wrap}
    .char-count{font-size:.75rem;color:var(--text-dim);margin-top:.5rem}
    .loading-spinner{display:none;text-align:center;padding:3rem}
    .loading-spinner.show{display:block}
    .spinner{width:40px;height:40px;border:3px solid var(--surface);border-top-color:var(--primary);border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 1rem}
    @keyframes spin{to{transform:rotate(360deg)}}
    .stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:2rem}
    .stat-card{background:var(--surface);border-radius:12px;padding:1.5rem;border:var(--border-subtle)}
    .stat-card .stat-value{font-size:1.8rem;font-weight:800;background:var(--gradient-1);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .stat-card .stat-label{font-size:.8rem;color:var(--text-dim);margin-top:.3rem}
    .toast{position:fixed;bottom:2rem;right:2rem;background:var(--success);color:#fff;padding:1rem 1.5rem;border-radius:10px;font-size:.9rem;font-weight:500;display:none;z-index:9999;animation:slideUp .3s ease}
    @keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
    [data-theme="light"] .url-input{border-color:rgba(0,0,0,0.12);background:#F8F9FC}[data-theme="light"] .content-textarea{background:#F8F9FC;border-color:rgba(0,0,0,0.08)}.theme-toggle{position:fixed;top:1.5rem;right:1.5rem;z-index:1001;background:var(--surface);border:1px solid rgba(255,255,255,0.1);border-radius:50px;padding:.5rem .8rem;cursor:pointer;display:flex;align-items:center;gap:.5rem;font-size:.85rem;color:var(--text-muted);transition:all .3s;font-family:'Inter',sans-serif}[data-theme="light"] .theme-toggle{border-color:rgba(0,0,0,0.1)}.theme-toggle:hover{border-color:var(--primary-light);color:var(--text)}.theme-toggle .toggle-track{width:44px;height:24px;background:var(--dark-2);border-radius:12px;position:relative;transition:background .3s}[data-theme="light"] .theme-toggle .toggle-track{background:#D1D5DB}.theme-toggle .toggle-thumb{width:20px;height:20px;background:var(--gradient-1);border-radius:50%;position:absolute;top:2px;left:2px;transition:transform .3s}[data-theme="light"] .theme-toggle .toggle-thumb{transform:translateX(20px)}
 @media(max-width:768px){.sidebar{display:none}.main-content{margin-left:0}.stats-grid{grid-template-columns:repeat(2,1fr)}.input-group{flex-direction:column}.video-info{flex-direction:column}.video-thumb{width:100%;height:auto}}
  </style>
</head>
<body>
  <button class="theme-toggle" onclick="toggleTheme()"><span>&#x1F319;</span><div class="toggle-track"><div class="toggle-thumb"></div></div><span>&#x2600;&#xFE0F;</span></button>
 <div class="dashboard">
    <aside class="sidebar">
      <a href="/" class="sidebar-logo">&#x26A1; RepurposeAI</a>
      <nav class="sidebar-nav">
        <a href="/dashboard" class="active">&#x1F3AC; Dashboard</a>
        <a href="/repurpose">&#x1F504; Repurpose</a>
        <a href="/dashboard/analytics">&#x1F4CA; Analytics</a>
        <a href="/dashboard/scheduled">&#x23F0; Scheduled</a>
        <a href="/billing">&#x1F4B3; Billing</a>
        <a href="/contact">&#x1F4E7; Support</a>
      </nav>
      <div class="sidebar-user">
        <div class="sidebar-avatar">${(req.user.email || 'U')[0].toUpperCase()}</div>
        <div><div class="sidebar-username">${req.user.email ? req.user.email.split('@')[0] : 'User'}</div><div class="sidebar-email">${req.user.email || ''}</div></div>
      </div>
    </aside>

    <main class="main-content">
      <div class="page-header">
        <h1>&#x1F3AC; Content Studio</h1>
        <p>Paste a YouTube link and let AI create content for every platform.</p>
      </div>

      <div class="stats-grid">
        <div class="stat-card"><div class="stat-value">0</div><div class="stat-label">Videos Processed</div></div>
        <div class="stat-card"><div class="stat-value">0</div><div class="stat-label">Posts Generated</div></div>
        <div class="stat-card"><div class="stat-value">5</div><div class="stat-label">Platforms</div></div>
        <div class="stat-card"><div class="stat-value">Free</div><div class="stat-label">Current Plan</div></div>
      </div>

      <div class="repurpose-card">
        <h2 style="font-size:1.2rem;font-weight:700;margin-bottom:1rem">&#x1F680; Repurpose a Video</h2>
        <div class="input-group">
          <input type="text" class="url-input" id="youtubeUrl" placeholder="Paste YouTube URL here... (e.g. https://youtube.com/watch?v=...)">
          <button class="btn btn-primary" id="processBtn" onclick="processVideo()">&#x26A1; Repurpose</button>
        </div>

        <div class="loading-spinner" id="loading">
          <div class="spinner"></div>
          <p style="color:var(--text-muted)">AI is analyzing your video and generating content...</p>
        </div>

        <div class="video-preview" id="videoPreview">
          <div class="video-info">
            <img class="video-thumb" id="videoThumb" src="" alt="Video thumbnail">
            <div class="video-meta">
              <h3 id="videoTitle"></h3>
              <p id="videoAuthor"></p>
            </div>
          </div>
        </div>
      </div>

      <div class="results-section" id="results">
        <h2 style="font-size:1.2rem;font-weight:700;margin-bottom:1rem">&#x2728; Generated Content</h2>
        <div class="platform-tabs" id="platformTabs"></div>
        <div id="platformContents"></div>
      </div>
    </main>
  </div>

  <div class="toast" id="toast">Copied to clipboard!</div>

  <script>
    function toggleTheme(){var h=document.documentElement;var c=h.getAttribute("data-theme");var n=c==="light"?"dark":"light";h.setAttribute("data-theme",n);localStorage.setItem("repurposeai-theme",n)}(function(){var s=localStorage.getItem("repurposeai-theme");if(s==="light")document.documentElement.setAttribute("data-theme","light")})();
 let currentContent = null;
    let currentVideo = null;

    async function processVideo() {
      const url = document.getElementById('youtubeUrl').value.trim();
      if (!url) { alert('Please paste a YouTube URL'); return; }

      const btn = document.getElementById('processBtn');
      btn.disabled = true; btn.innerHTML = 'Processing...';
      document.getElementById('loading').classList.add('show');
      document.getElementById('results').classList.remove('show');
      document.getElementById('videoPreview').classList.remove('show');

      try {
        const res = await fetch('/repurpose/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Processing failed');

        currentVideo = data.video;
        currentContent = data.content;

        // Show video preview
        document.getElementById('videoThumb').src = data.video.thumbnail;
        document.getElementById('videoTitle').textContent = data.video.title;
        document.getElementById('videoAuthor').textContent = 'by ' + data.video.author;
        document.getElementById('videoPreview').classList.add('show');

        renderPlatforms(data.content);
        document.getElementById('results').classList.add('show');
      } catch (err) {
        alert(err.message);
      } finally {
        btn.disabled = false; btn.innerHTML = '&#x26A1; Repurpose';
        document.getElementById('loading').classList.remove('show');
      }
    }

    function renderPlatforms(content) {
      const tabs = document.getElementById('platformTabs');
      const contents = document.getElementById('platformContents');
      tabs.innerHTML = ''; contents.innerHTML = '';
      let first = true;
      for (const [key, platform] of Object.entries(content)) {
        const tab = document.createElement('button');
        tab.className = 'platform-tab' + (first ? ' active' : '');
        tab.innerHTML = platform.icon + ' ' + platform.name;
        tab.onclick = () => switchPlatform(key);
        tab.dataset.platform = key;
        tabs.appendChild(tab);

        const div = document.createElement('div');
        div.className = 'platform-content' + (first ? ' show' : '');
        div.id = 'content-' + key;
        div.innerHTML = '<div class="platform-header"><h3>' + platform.icon + ' ' + platform.name + '</h3><span class="platform-type">' + platform.type + '</span></div>' +
          '<textarea class="content-textarea" id="textarea-' + key + '">' + platform.caption.replace(/</g, '&lt;') + '</textarea>' +
          '<div class="char-count"><span id="chars-' + key + '">' + platform.caption.length + '</span> / ' + platform.charLimit + ' characters</div>' +
          '<div class="content-actions">' +
          '<button class="btn btn-primary btn-sm" onclick="copyContent(\\'' + key + '\\')">&#x1F4CB; Copy</button>' +
          '<button class="btn btn-outline btn-sm" onclick="downloadContent(\\'' + key + '\\')">&#x2B07; Download</button>' +
          '</div>';
        contents.appendChild(div);

        const ta = div.querySelector('textarea');
        ta.addEventListener('input', () => { document.getElementById('chars-' + key).textContent = ta.value.length; });
        first = false;
      }
    }

    function switchPlatform(key) {
      document.querySelectorAll('.platform-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.platform-content').forEach(c => c.classList.remove('show'));
      document.querySelector('[data-platform="' + key + '"]').classList.add('active');
      document.getElementById('content-' + key).classList.add('show');
    }

    function copyContent(key) {
      const textarea = document.getElementById('textarea-' + key);
      navigator.clipboard.writeText(textarea.value).then(() => {
        const toast = document.getElementById('toast');
        toast.style.display = 'block';
        setTimeout(() => { toast.style.display = 'none'; }, 2000);
      });
    }

    function downloadContent(key) {
      const textarea = document.getElementById('textarea-' + key);
      const blob = new Blob([textarea.value], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = key + '-content.txt';
      a.click();
    }

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
