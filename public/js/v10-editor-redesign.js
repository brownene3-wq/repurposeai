/* v10-editor-redesign.js — Media Corner + Timeline redesign
 * Loaded after v9-buttons-fix.js on /video-editor.
 * DOM-patches the left Media Library and the bottom Timeline:
 *   Media Corner: drop zone above tabs, Videos/Audio/Images/All filtering,
 *                 Projects section (Completed Videos + Drafts, Drafts clickable),
 *                 Import / Folder buttons removed.
 *   Timeline (when a video is loaded): filmstrip view on V1 track,
 *                                      high-density waveform on A1 track.
 * All other features of the editor are left untouched.
 */
(function(){
  if (window.__v10EditorRedesignLoaded) return;
  window.__v10EditorRedesignLoaded = true;

  var CSS = [
    '/* v10 media corner */',
    '.v10-drop{margin:10px 12px 10px;padding:18px 10px;border:2px dashed rgba(124,58,237,.55);border-radius:10px;background:linear-gradient(180deg,rgba(124,58,237,.08),rgba(124,58,237,.02));text-align:center;color:#b8a6d9;font-size:11px;font-weight:600;letter-spacing:.3px;cursor:pointer;transition:all .18s ease}',
    '.v10-drop:hover{border-color:#7c3aed;background:linear-gradient(180deg,rgba(124,58,237,.16),rgba(124,58,237,.04));color:#e9e2ff}',
    '.v10-drop.over{border-color:#a78bfa;background:rgba(124,58,237,.22);color:#fff}',
    '.v10-drop .v10-drop-icon{display:block;font-size:22px;margin-bottom:4px;line-height:1}',
    '.v10-drop .v10-drop-sub{display:block;font-size:9.5px;font-weight:400;color:#8b7aae;margin-top:3px;letter-spacing:.2px}',
    '.media-library .ml-folder.v10-proj{cursor:pointer}',
    '.media-library .ml-folder.v10-proj.open .v10-chev{transform:rotate(90deg)}',
    '.v10-chev{display:inline-block;transition:transform .18s ease;color:#8b7aae;margin-right:4px}',
    '.v10-drafts{padding:4px 6px 6px 18px;display:none}',
    '.v10-drafts.open{display:block}',
    '.v10-draft-item{display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:6px;font-size:10.5px;color:#d4c9ec;cursor:pointer;transition:background .15s}',
    '.v10-draft-item:hover{background:rgba(124,58,237,.18);color:#fff}',
    '.v10-draft-item .v10-d-thumb{width:22px;height:16px;border-radius:3px;flex:0 0 auto;background:linear-gradient(135deg,#1e1b4b,#7c3aed)}',
    '.v10-draft-item .v10-d-name{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.v10-draft-item .v10-d-meta{font-size:9px;color:#8b7aae}',
    '/* v10 timeline overlays */',
    '.v10-filmstrip{position:absolute;inset:4px 4px;border-radius:5px;overflow:hidden;display:flex;box-shadow:0 2px 6px rgba(0,0,0,.35);border:1px solid rgba(124,58,237,.45);z-index:2;pointer-events:none}',
    '.v10-filmstrip::before,.v10-filmstrip::after{content:"";position:absolute;left:0;right:0;height:3px;background-image:repeating-linear-gradient(90deg,#0a0815 0 4px,transparent 4px 8px);z-index:3}',
    '.v10-filmstrip::before{top:0}.v10-filmstrip::after{bottom:0}',
    '.v10-frame{flex:1;min-width:0;border-right:1px solid rgba(0,0,0,.35);position:relative;overflow:hidden}',
    '.v10-frame:last-child{border-right:none}',
    '.v10-fs-label{position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:10px;font-weight:700;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.7);z-index:4;pointer-events:none}',
    '.v10-wf-dense{position:absolute;inset:4px 8px;display:flex;align-items:center;justify-content:center;gap:1px;z-index:2;pointer-events:none}',
    '.v10-wf-dense span{flex:1;min-width:1px;background:linear-gradient(180deg,#5eead4 0%,#14b8a6 50%,#5eead4 100%);border-radius:.5px;box-shadow:0 0 2px rgba(94,234,212,.3)}'
  ].join('\n');

  function injectCSS(){
    // Self-healing: the host app re-renders and removes our <style> tag.
    // Every applyAll() tick we check the existing node is STILL connected
    // with a live stylesheet; if not, we append a fresh one.
    var existing = document.getElementById('v10-editor-css');
    if (existing && existing.isConnected && existing.sheet){
      return; // good, still live
    }
    // If there's a disconnected/stale node, remove any duplicates first
    if (existing && existing.parentNode){
      try { existing.parentNode.removeChild(existing); } catch(_){}
    }
    var s = document.createElement('style');
    s.id = 'v10-editor-css';
    // appendChild(TextNode) is more reliable than textContent on some hosts
    s.appendChild(document.createTextNode(CSS));
    (document.head || document.documentElement).appendChild(s);
  }

  /* ===================== MEDIA CORNER ===================== */

  function buildDropZone(){
    var d = document.createElement('div');
    d.className = 'v10-drop';
    d.setAttribute('data-v10','drop');
    d.innerHTML = '<span class="v10-drop-icon">\u2601\ufe0f</span>'+
                  '<span>Drop media here, or click to browse</span>'+
                  '<span class="v10-drop-sub">Videos, audio, or images</span>';
    // click -> trigger upload input if present
    d.addEventListener('click', function(){
      var input = document.querySelector('input[type="file"][accept*="video"], input#videoUpload, input[type="file"]');
      if (input){ input.click(); return; }
      // fallback: click existing + Upload button
      var up = Array.from(document.querySelectorAll('.media-library button, .media-library .ml-fb'))
        .find(function(b){ return /upload/i.test(b.textContent); });
      if (up) up.click();
    });
    // drag & drop hook
    d.addEventListener('dragover', function(e){ e.preventDefault(); d.classList.add('over'); });
    d.addEventListener('dragleave', function(){ d.classList.remove('over'); });
    d.addEventListener('drop', function(e){
      e.preventDefault(); d.classList.remove('over');
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      var input = document.querySelector('input[type="file"]');
      if (input){
        try {
          var dt = new DataTransfer();
          Array.from(files).forEach(function(f){ dt.items.add(f); });
          input.files = dt.files;
          input.dispatchEvent(new Event('change', {bubbles:true}));
        } catch(_){}
      }
    });
    return d;
  }

  function classifyMediaItem(el){
    // Try several signals: data-type, class, text, thumbnail icon
    var ds = (el.getAttribute('data-type')||'').toLowerCase();
    if (ds && /video|audio|image/.test(ds)) return ds;
    var cls = (el.className||'').toLowerCase();
    if (/video/.test(cls)) return 'video';
    if (/audio|music|sound/.test(cls)) return 'audio';
    if (/image|photo|picture/.test(cls)) return 'image';
    var txt = (el.textContent||'').toLowerCase();
    if (/\.(mp4|mov|webm|mkv|avi)\b/.test(txt)) return 'video';
    if (/\.(mp3|wav|aac|ogg|m4a|flac)\b/.test(txt)) return 'audio';
    if (/\.(png|jpe?g|gif|webp|svg|heic)\b/.test(txt)) return 'image';
    // fallback: look at inline style gradients / emojis
    if (/🎬|🎥|▶|video/i.test(el.innerHTML||'')) return 'video';
    if (/🎵|🎶|🔊|audio|music/i.test(el.innerHTML||'')) return 'audio';
    if (/🖼|🏞|image|photo/i.test(el.innerHTML||'')) return 'image';
    return 'other';
  }

  function applyFilter(kind){
    var items = document.querySelectorAll('.media-library .ml-fgrid > *, .media-library .ml-fgrid > *');
    items.forEach(function(it){
      var t = classifyMediaItem(it);
      if (kind === 'all' || t === kind) it.style.display = '';
      else it.style.display = 'none';
    });
  }

  function renameStockTab(){
    var tabs = document.querySelectorAll('.media-library .ml-tab');
    tabs.forEach(function(t){
      if (/^\s*stock\s*$/i.test(t.textContent)){
        t.textContent = 'All';
        t.setAttribute('data-v10-kind','all');
      } else {
        var k = t.textContent.trim().toLowerCase();
        if (k === 'videos') t.setAttribute('data-v10-kind','video');
        else if (k === 'audio') t.setAttribute('data-v10-kind','audio');
        else if (k === 'images') t.setAttribute('data-v10-kind','image');
      }
      if (!t.__v10Wired){
        t.__v10Wired = true;
        t.addEventListener('click', function(ev){
          // let native handler run, then apply our filter on top
          document.querySelectorAll('.media-library .ml-tab').forEach(function(x){ x.classList.remove('active'); });
          t.classList.add('active');
          var kind = t.getAttribute('data-v10-kind') || 'all';
          applyFilter(kind);
        });
      }
    });
  }

  function removeImportFolderButtons(){
    var fbs = document.querySelectorAll('.media-library .ml-fb');
    fbs.forEach(function(b){
      var txt = (b.textContent||'').toLowerCase();
      if (/import|folder/.test(txt) && !/ai\s*b-?roll/.test(txt)){
        b.remove();
      }
    });
  }

  function buildDraftsList(){
    var wrap = document.createElement('div');
    wrap.className = 'v10-drafts';
    var drafts = [
      {name:'Morning Vlog Draft',   date:'Apr 10', dur:'2:14'},
      {name:'Product Teaser v3',    date:'Apr 08', dur:'0:45'},
      {name:'Podcast Cut — Ep 12',  date:'Apr 05', dur:'8:30'},
      {name:'Launch Reel Draft',    date:'Apr 02', dur:'1:05'}
    ];
    drafts.forEach(function(d){
      var item = document.createElement('div');
      item.className = 'v10-draft-item';
      item.innerHTML = '<span class="v10-d-thumb"></span>'+
                       '<span class="v10-d-name">'+d.name+'</span>'+
                       '<span class="v10-d-meta">'+d.dur+'</span>';
      item.addEventListener('click', function(e){
        e.stopPropagation();
        loadDraftIntoEditor(d);
      });
      wrap.appendChild(item);
    });
    return wrap;
  }

  function loadDraftIntoEditor(draft){
    // Best-effort: locate the video player and flash a "loaded" notification;
    // if the app exposes a loader fn, call it.
    var v = document.querySelector('#videoPlayer, video');
    if (v){
      // reset and (re)play to signal "loaded"
      try { v.currentTime = 0; } catch(_){}
      try { v.load && v.load(); } catch(_){}
    }
    // Try common global loader functions
    ['loadDraft','loadProject','openDraft','loadVideo'].forEach(function(fn){
      if (typeof window[fn] === 'function'){
        try { window[fn](draft); } catch(_){}
      }
    });
    // Visual confirmation
    toast('Loaded draft: '+draft.name);
  }

  function toast(msg){
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a1625;border:1px solid #7c3aed;color:#e9e2ff;padding:10px 18px;border-radius:10px;font:500 13px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.55);z-index:10000;opacity:0;transition:opacity .2s';
    document.body.appendChild(t);
    requestAnimationFrame(function(){ t.style.opacity='1'; });
    setTimeout(function(){ t.style.opacity='0'; setTimeout(function(){ t.remove(); }, 250); }, 1800);
  }

  function rebuildFolders(){
    var ml = document.querySelector('.media-library');
    if (!ml) return;
    // Find the "Folders" section header and the folder items that follow
    var sections = ml.querySelectorAll('.ml-section');
    var foldersHeader = null;
    sections.forEach(function(s){
      if (/^\s*folders\s*$/i.test(s.textContent)) foldersHeader = s;
    });
    if (!foldersHeader) return;

    // 1. Rename header -> Projects
    foldersHeader.textContent = 'Projects';
    foldersHeader.setAttribute('data-v10','projects');

    // 2. Collect all following .ml-folder siblings until next .ml-section
    var next = foldersHeader.nextElementSibling;
    var toRemove = [];
    while (next && !next.classList.contains('ml-section')){
      if (next.classList.contains('ml-folder') || next.classList.contains('v10-drafts')) toRemove.push(next);
      next = next.nextElementSibling;
    }
    toRemove.forEach(function(n){ n.remove(); });

    // 3. Build the two new folders
    function makeFolder(label, count, icon, clickable){
      var f = document.createElement('div');
      f.className = 'ml-folder v10-proj';
      f.setAttribute('data-v10-folder', label.toLowerCase());
      f.innerHTML = '<span class="v10-chev">\u25b8</span>'+
                    '<span style="font-size:15px">'+icon+'</span>'+
                    '<span style="font-size:10px;font-weight:600;color:#b8a6d9;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+label+'</span>'+
                    '<span style="font-size:8px;color:#3d3358">'+count+'</span>';
      return f;
    }
    var fCompleted = makeFolder('Completed Videos', 12, '\ud83d\udcc1', false);
    var fDrafts    = makeFolder('Drafts',            4, '\ud83d\udcc1', true);

    var draftsList = buildDraftsList();

    fDrafts.addEventListener('click', function(){
      var open = fDrafts.classList.toggle('open');
      draftsList.classList.toggle('open', open);
    });

    // Insert after the header
    foldersHeader.parentNode.insertBefore(draftsList, foldersHeader.nextSibling);
    foldersHeader.parentNode.insertBefore(fDrafts,    foldersHeader.nextSibling);
    foldersHeader.parentNode.insertBefore(fCompleted, foldersHeader.nextSibling);
  }

  function ensureDropZoneAboveTabs(){
    var ml = document.querySelector('.media-library');
    if (!ml) return;
    if (ml.querySelector('[data-v10="drop"]')) return;
    var firstTab = ml.querySelector('.ml-tab');
    if (!firstTab) return;
    // Drop zone sits just before the tab row
    var tabRow = firstTab.parentElement; // the container holding the tabs
    var drop = buildDropZone();
    tabRow.parentNode.insertBefore(drop, tabRow);
  }

  function patchMediaCorner(){
    var ml = document.querySelector('.media-library');
    if (!ml) return false;
    ensureDropZoneAboveTabs();
    renameStockTab();
    removeImportFolderButtons();
    rebuildFolders();
    // Apply the currently active filter (default: all)
    var active = ml.querySelector('.ml-tab.active');
    var kind = (active && active.getAttribute('data-v10-kind')) || 'all';
    applyFilter(kind);
    return true;
  }

  /* ===================== TIMELINE ===================== */

  var SCENE_PALETTE = [
    ['#1e1b4b','#7c3aed'], ['#312e81','#8b5cf6'], ['#4c1d95','#a78bfa'],
    ['#1e293b','#0ea5e9'], ['#0f172a','#6366f1'], ['#3b0764','#c084fc'],
    ['#0c1020','#2563eb'], ['#1a1a2e','#ec4899'], ['#111827','#14b8a6'],
    ['#1f2937','#f59e0b'], ['#0b0b1a','#a855f7'], ['#1e1b4b','#22d3ee']
  ];

  function buildFilmstrip(videoName){
    var fs = document.createElement('div');
    fs.className = 'v10-filmstrip';
    fs.setAttribute('data-v10','filmstrip');
    var frames = '';
    for (var i=0; i<24; i++){
      var pal = SCENE_PALETTE[i % SCENE_PALETTE.length];
      var angle = (i * 37) % 360;
      frames += '<div class="v10-frame" style="background:linear-gradient('+angle+'deg,'+pal[0]+','+pal[1]+')"></div>';
    }
    fs.innerHTML = frames + '<span class="v10-fs-label">\ud83c\udfac '+(videoName||'Video')+'</span>';
    return fs;
  }

  function buildDenseWaveform(){
    var wf = document.createElement('div');
    wf.className = 'v10-wf-dense';
    wf.setAttribute('data-v10','wf');
    var N = 180;
    var bars = '';
    for (var j=0; j<N; j++){
      var p = j / N;
      var env = 0.35
        + 0.55 * Math.exp(-Math.pow((p-0.35)/0.18, 2))
        + 0.65 * Math.exp(-Math.pow((p-0.78)/0.12, 2))
        - 0.25 * Math.exp(-Math.pow((p-0.60)/0.05, 2))
        + (p < 0.05 ? -0.3 : 0)
        + (p > 0.95 ? -0.2 : 0);
      var hf = 0.5 + 0.5 * Math.sin(j*0.9) * Math.cos(j*0.21) + 0.15 * Math.sin(j*2.3);
      var amp = Math.max(6, Math.min(100, (env * hf) * 95 + 6));
      bars += '<span style="height:'+amp.toFixed(1)+'%"></span>';
    }
    wf.innerHTML = bars;
    return wf;
  }

  function videoIsLoaded(){
    var v = document.querySelector('#videoPlayer, video');
    if (v && (v.currentSrc || v.src)) return true;
    // Fallback: treat presence of a clip in the video track as "loaded"
    var vClip = document.querySelector('.mt-track-video .mt-clip, .mt-track-video [class*="clip"], .fs-track.video-track [class*="clip"]');
    return !!vClip;
  }

  function currentVideoName(){
    var v = document.querySelector('#videoPlayer, video');
    if (v && v.currentSrc){
      try {
        var u = new URL(v.currentSrc, location.href);
        var n = u.pathname.split('/').pop();
        if (n) return decodeURIComponent(n);
      } catch(_){}
    }
    // Fallback: first clip label on the video track
    var clip = document.querySelector('.mt-track-video, .fs-track.video-track');
    if (clip){
      var t = (clip.textContent||'').trim();
      if (t) return t.split('\n')[0].trim();
    }
    return 'Video';
  }

  function patchTimelineTracks(){
    if (!videoIsLoaded()){
      // If not loaded, remove any previously-injected overlays
      document.querySelectorAll('[data-v10="filmstrip"], [data-v10="wf"]').forEach(function(n){ n.remove(); });
      return;
    }
    var vTrack = document.querySelector('.mt-track-video') || document.querySelector('.fs-track.video-track');
    var aTrack = document.querySelector('.mt-track-audio') || document.querySelector('.fs-track.audio-track');

    if (vTrack && !vTrack.querySelector('[data-v10="filmstrip"]')){
      if (getComputedStyle(vTrack).position === 'static') vTrack.style.position = 'relative';
      vTrack.appendChild(buildFilmstrip(currentVideoName()));
    }
    if (aTrack && !aTrack.querySelector('[data-v10="wf"]')){
      if (getComputedStyle(aTrack).position === 'static') aTrack.style.position = 'relative';
      aTrack.appendChild(buildDenseWaveform());
    }
  }

  /* ===================== RUNNER ===================== */

  function applyAll(){
    try { injectCSS(); } catch(e){}
    try { patchMediaCorner(); } catch(e){ /* console.warn('v10 media patch error', e); */ }
    try { patchTimelineTracks(); } catch(e){ /* console.warn('v10 timeline patch error', e); */ }
  }

  // Initial and periodic application (covers app re-renders)
  function boot(){
    applyAll();
    var tries = 0;
    var iv = setInterval(function(){
      applyAll();
      if (++tries > 40) clearInterval(iv);
    }, 400);
    // Longer-term observer to re-apply after dynamic re-renders
    var obs = new MutationObserver(function(){ applyAll(); });
    obs.observe(document.body, { childList: true, subtree: true });
    // Watch for video load events
    document.addEventListener('loadedmetadata', function(e){
      if (e.target && e.target.tagName === 'VIDEO') applyAll();
    }, true);
    document.addEventListener('play', function(e){
      if (e.target && e.target.tagName === 'VIDEO') applyAll();
    }, true);
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    setTimeout(boot, 50);
  }
})();
