/* v10-editor-redesign.js — Media Corner + Timeline redesign (V3 parity)
 * Loaded after v9-buttons-fix.js on /video-editor.
 *
 * Brings the live Splicora editor into visual + behavioural parity with the
 * V3 simulation (video-editor-v3.html):
 *   - Drop zone above the filter tabs with cloud icon, format line, + Upload btn
 *   - Videos / Audio / Images / All tab filtering of .ml-fitem entries
 *   - Search bar below the tab row (name-based filter)
 *   - Media items restyled with colored thumb + VID/AUD/IMG badge
 *   - "Folders" section renamed to "Projects"
 *   - Completed Videos folder (3 items) expandable, read-only, with footnote
 *   - Drafts folder (3 items) open by default, each draft has date/size/dur
 *     metadata and a LOAD hint; click hides the upload panel and drops in
 *     a "DRAFT LOADED" preview frame
 *   - Import / Folder buttons removed
 *   - Timeline V1 track: continuous filmstrip of 24 scene thumbnails
 *   - Timeline A1 track: 180-bar dense waveform with Gaussian envelope
 * All other editor features are left untouched.
 */
(function(){
  if (window.__v10EditorRedesignLoaded) return;
  window.__v10EditorRedesignLoaded = true;

  var CSS = [
    '/* v10 media corner */',
    '.v10-drop{margin:10px 12px 10px;padding:18px 12px;border:2px dashed #2a2545;border-radius:10px;background:rgba(255,255,255,.015);text-align:center;cursor:pointer;transition:all .2s}',
    '.v10-drop:hover{border-color:#8b5cf6;background:rgba(139,92,246,.05)}',
    '.v10-drop.over{border-color:#a78bfa;background:rgba(139,92,246,.18)}',
    '.v10-drop .v10-drop-cloud{display:block;font-size:22px;margin-bottom:6px;opacity:.7}',
    '.v10-drop .v10-drop-txt{display:block;font-size:11px;color:#e2e0f0;margin-bottom:3px}',
    '.v10-drop .v10-drop-fmt{display:block;font-size:9px;color:#5c5a70;margin-bottom:10px;letter-spacing:.3px}',
    '.v10-drop .v10-drop-btn{padding:5px 14px;border-radius:6px;border:none;background:#8b5cf6;color:#fff;font-size:11px;font-weight:600;cursor:pointer}',
    '.v10-drop .v10-drop-btn:hover{background:#a78bfa}',
    '/* v10 search bar */',
    '.v10-search{padding:8px 12px}',
    '.v10-search-wrap{display:flex;align-items:center;gap:8px;background:#0d0b1a;border-radius:8px;padding:6px 10px;border:1px solid #2a2545}',
    '.v10-search-wrap input{background:none;border:none;outline:none;color:#e2e0f0;font-size:12px;flex:1;font-family:inherit}',
    '.v10-search-wrap .v10-search-ico{color:#8886a0;font-size:12px}',
    '/* v10 media items (restyled wrapper around existing .ml-fitem) */',
    '.media-library .ml-fitem.v10-styled{display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:7px;background:rgba(255,255,255,.02);border:1px solid #2a2545;margin-bottom:5px;cursor:pointer;transition:all .15s}',
    '.media-library .ml-fitem.v10-styled:hover{border-color:#8b5cf6;background:rgba(139,92,246,.06)}',
    '.v10-mi-thumb{width:38px;height:28px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:13px;color:#fff;flex-shrink:0}',
    '.v10-mi-thumb.vid{background:linear-gradient(135deg,#7c3aed,#ec4899)}',
    '.v10-mi-thumb.aud{background:linear-gradient(135deg,#3b82f6,#06b6d4)}',
    '.v10-mi-thumb.img{background:linear-gradient(135deg,#22c55e,#06b6d4)}',
    '.v10-mi-info{flex:1;min-width:0}',
    '.v10-mi-info h5{font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0 0 1px 0;color:#e2e0f0}',
    '.v10-mi-info small{font-size:9px;color:#5c5a70}',
    '.v10-mi-badge{font-size:8px;padding:2px 5px;border-radius:3px;font-weight:700;letter-spacing:.3px}',
    '.v10-mi-badge.vid{background:rgba(124,58,237,.18);color:#a78bfa}',
    '.v10-mi-badge.aud{background:rgba(59,130,246,.18);color:#60a5fa}',
    '.v10-mi-badge.img{background:rgba(34,197,94,.18);color:#4ade80}',
    '/* v10 project folders */',
    '.media-library .ml-folder.v10-proj{cursor:pointer;display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(255,255,255,.02);border:1px solid #2a2545;border-radius:7px;margin-bottom:5px;font-size:12px;font-weight:600;color:#e2e0f0}',
    '.media-library .ml-folder.v10-proj:hover{border-color:#8b5cf6;background:rgba(139,92,246,.05)}',
    '.v10-proj .v10-proj-ico{font-size:14px;flex:0 0 auto}',
    '.v10-proj .v10-proj-name{flex:1;font-weight:600}',
    '.v10-proj .v10-proj-count{font-size:10px;color:#8886a0;background:#0d0b1a;padding:2px 7px;border-radius:10px}',
    '.v10-proj .v10-chev{font-size:9px;color:#5c5a70;transition:transform .2s;margin-left:4px}',
    '.v10-proj.open .v10-chev{transform:rotate(90deg)}',
    '.v10-folder-list{margin:4px 0 8px 12px;padding-left:8px;border-left:2px solid rgba(139,92,246,.18);display:none}',
    '.v10-folder-list.open{display:block}',
    '.v10-folder-item{display:flex;align-items:center;gap:8px;padding:5px 7px;border-radius:5px;margin-bottom:2px;background:rgba(255,255,255,.02);font-size:11px;color:#e2e0f0}',
    '.v10-folder-item.clickable{cursor:pointer}',
    '.v10-folder-item.clickable:hover{background:rgba(139,92,246,.08)}',
    '.v10-folder-item.readonly{cursor:default}',
    '.v10-folder-item .v10-fi-ico{font-size:12px;flex:0 0 auto}',
    '.v10-folder-item .v10-fi-body{flex:1;min-width:0}',
    '.v10-folder-item .v10-fi-name{font-size:11px;color:#e2e0f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.v10-folder-item .v10-fi-meta{display:block;font-size:9px;color:#5c5a70}',
    '.v10-folder-item .v10-fi-hint{font-size:8px;color:#8b5cf6;font-weight:700;letter-spacing:.4px;margin-left:auto}',
    '.v10-folder-note{font-size:9px;color:#5c5a70;font-style:italic;padding:4px 6px}',
    '/* v10 timeline overlays */',
    '.v10-filmstrip{position:absolute;inset:4px 4px;border-radius:5px;overflow:hidden;display:flex;box-shadow:0 2px 6px rgba(0,0,0,.35);border:1px solid rgba(124,58,237,.45);z-index:2;pointer-events:none}',
    '.v10-filmstrip::before,.v10-filmstrip::after{content:"";position:absolute;left:0;right:0;height:3px;background-image:repeating-linear-gradient(90deg,#0a0815 0 4px,transparent 4px 8px);z-index:3}',
    '.v10-filmstrip::before{top:0}.v10-filmstrip::after{bottom:0}',
    '.v10-frame{flex:1;min-width:0;border-right:1px solid rgba(0,0,0,.35);position:relative;overflow:hidden}',
    '.v10-frame:last-child{border-right:none}',
    '.v10-fs-label{position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:10px;font-weight:700;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.7);z-index:4;pointer-events:none}',
    '.v10-wf-dense{position:absolute;inset:4px 8px;display:flex;align-items:center;justify-content:center;gap:1px;z-index:2;pointer-events:none}',
    '.v10-wf-dense span{flex:1;min-width:1px;background:linear-gradient(180deg,#5eead4 0%,#14b8a6 50%,#5eead4 100%);border-radius:.5px;box-shadow:0 0 2px rgba(94,234,212,.3)}',
    /* draft-loaded preview overlay */
    '.v10-preview-frame{width:100%;max-width:780px;aspect-ratio:16/9;background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460);border-radius:8px;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;margin:0 auto}',
    '.v10-preview-frame::before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 30% 40%,rgba(139,92,246,.12),transparent 60%)}',
    '.v10-preview-frame::after{content:"";position:absolute;inset:0;background:radial-gradient(circle at 70% 60%,rgba(236,72,153,.08),transparent 50%)}',
    '.v10-preview-frame .v10-pf-content{position:relative;z-index:1;text-align:center;color:rgba(255,255,255,.85)}',
    '.v10-preview-frame .v10-pf-play{font-size:32px;margin-bottom:8px}',
    '.v10-preview-frame .v10-pf-name{font-size:13px;font-weight:600}',
    '.v10-preview-frame .v10-pf-badge{font-size:10px;margin-top:4px;color:#a78bfa;font-weight:700;letter-spacing:.4px}'
  ].join('\n');

  function injectCSS(){
    // Self-healing: the host app re-renders and removes our <style> tag.
    var existing = document.getElementById('v10-editor-css');
    if (existing && existing.isConnected && existing.sheet){
      return;
    }
    if (existing && existing.parentNode){
      try { existing.parentNode.removeChild(existing); } catch(_){}
    }
    var s = document.createElement('style');
    s.id = 'v10-editor-css';
    s.appendChild(document.createTextNode(CSS));
    (document.head || document.documentElement).appendChild(s);
  }

  /* ===================== MEDIA CORNER ===================== */

  function buildDropZone(){
    var d = document.createElement('div');
    d.className = 'v10-drop';
    d.setAttribute('data-v10','drop');
    d.innerHTML =
      '<span class="v10-drop-cloud">\u2601\ufe0f</span>'+
      '<span class="v10-drop-txt">Drop files or click to upload</span>'+
      '<span class="v10-drop-fmt">MP4, MOV, MP3, WAV, PNG, JPG</span>'+
      '<button class="v10-drop-btn" type="button">+ Upload</button>';

    function triggerUpload(){
      var input = document.querySelector('input[type="file"][accept*="video"], input#videoUpload, input[type="file"]');
      if (input){ input.click(); return; }
      var up = Array.from(document.querySelectorAll('.media-library button, .media-library .ml-fb'))
        .find(function(b){ return /upload/i.test(b.textContent||''); });
      if (up) up.click();
    }
    d.addEventListener('click', triggerUpload);
    d.querySelector('.v10-drop-btn').addEventListener('click', function(e){
      e.stopPropagation();
      triggerUpload();
    });
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

  function ensureDropZoneAboveTabs(){
    var ml = document.querySelector('.media-library');
    if (!ml) return;
    if (ml.querySelector('[data-v10="drop"]')) return;
    var firstTab = ml.querySelector('.ml-tab');
    if (!firstTab) return;
    var tabRow = firstTab.parentElement;
    var drop = buildDropZone();
    tabRow.parentNode.insertBefore(drop, tabRow);
  }

  function ensureSearchBar(){
    var ml = document.querySelector('.media-library');
    if (!ml) return;
    if (ml.querySelector('[data-v10="search"]')) return;
    var firstTab = ml.querySelector('.ml-tab');
    if (!firstTab) return;
    var tabRow = firstTab.parentElement;
    var wrap = document.createElement('div');
    wrap.className = 'v10-search';
    wrap.setAttribute('data-v10','search');
    wrap.innerHTML =
      '<div class="v10-search-wrap">'+
        '<span class="v10-search-ico">\ud83d\udd0d</span>'+
        '<input type="text" placeholder="Search media...">'+
      '</div>';
    var input = wrap.querySelector('input');
    input.addEventListener('input', function(){ applySearch(input.value); });
    // Insert AFTER tab row
    tabRow.parentNode.insertBefore(wrap, tabRow.nextSibling);
  }

  function applySearch(term){
    var q = (term||'').trim().toLowerCase();
    var items = document.querySelectorAll('.media-library .ml-fitem');
    items.forEach(function(it){
      if (it.style.display === 'none' && !q) return; // skip tab-hidden items
      var name = (it.getAttribute('data-search-name') || (it.textContent||'')).toLowerCase();
      // Only filter within currently-visible items; set .v10-search-hit for filtered out
      if (!q){
        if (it.dataset.v10SearchHidden === '1'){
          it.dataset.v10SearchHidden = '';
          var wasTabHidden = it.dataset.v10TabHidden === '1';
          it.style.display = wasTabHidden ? 'none' : '';
        }
      } else {
        if (name.indexOf(q) === -1){
          it.dataset.v10SearchHidden = '1';
          it.style.display = 'none';
        } else {
          it.dataset.v10SearchHidden = '';
          var wasTabHidden2 = it.dataset.v10TabHidden === '1';
          it.style.display = wasTabHidden2 ? 'none' : '';
        }
      }
    });
  }

  function classifyMediaItem(el){
    var ds = (el.getAttribute('data-media-type')||el.getAttribute('data-type')||'').toLowerCase();
    if (ds){
      if (/vid/.test(ds)) return 'video';
      if (/aud|mus/.test(ds)) return 'audio';
      if (/img|photo|pic/.test(ds)) return 'image';
    }
    var cls = (el.className||'').toLowerCase();
    if (/video/.test(cls)) return 'video';
    if (/audio|music|sound/.test(cls)) return 'audio';
    if (/image|photo|picture/.test(cls)) return 'image';
    var txt = (el.textContent||'').toLowerCase();
    if (/\.(mp4|mov|webm|mkv|avi)\b/.test(txt)) return 'video';
    if (/\.(mp3|wav|aac|ogg|m4a|flac)\b/.test(txt)) return 'audio';
    if (/\.(png|jpe?g|gif|webp|svg|heic)\b/.test(txt)) return 'image';
    if (/🎬|🎥|▶/i.test(el.innerHTML||'')) return 'video';
    if (/🎵|🎶|🔊/i.test(el.innerHTML||'')) return 'audio';
    if (/🖼|🏞/i.test(el.innerHTML||'')) return 'image';
    return 'other';
  }

  function applyFilter(kind){
    var items = document.querySelectorAll('.media-library .ml-fitem');
    items.forEach(function(it){
      var t = classifyMediaItem(it);
      if (kind === 'all' || t === kind){
        it.dataset.v10TabHidden = '';
        if (it.dataset.v10SearchHidden !== '1') it.style.display = '';
      } else {
        it.dataset.v10TabHidden = '1';
        it.style.display = 'none';
      }
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
        else if (k === 'all') t.setAttribute('data-v10-kind','all');
      }
      if (!t.__v10Wired){
        t.__v10Wired = true;
        t.addEventListener('click', function(){
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

  function parseMediaItemText(it){
    // Expected format like "🎬VID2:21+ Timeline0314(1).mp4" — extract name + dur
    var text = (it.textContent||'').replace(/\s+/g,' ').trim();
    // Try to pull out the filename (last thing with an extension)
    var nameMatch = text.match(/([A-Za-z0-9 _().\-]+\.(mp4|mov|webm|mp3|wav|png|jpg|jpeg|gif))/i);
    var name = nameMatch ? nameMatch[1] : text.slice(-30);
    var durMatch = text.match(/\b(\d+:\d{2})\b/);
    var dur = durMatch ? durMatch[1] : '';
    return { name: name, dur: dur };
  }

  function restyleMediaItems(){
    var items = document.querySelectorAll('.media-library .ml-fitem');
    items.forEach(function(it){
      if (it.dataset.v10Styled === '1') return;
      it.dataset.v10Styled = '1';
      var t = classifyMediaItem(it);
      var cls = t === 'video' ? 'vid' : (t === 'audio' ? 'aud' : 'img');
      var icon = t === 'video' ? '\u25b6' : (t === 'audio' ? '\u266a' : '\ud83d\uddbc');
      var label = t === 'video' ? 'VID' : (t === 'audio' ? 'AUD' : 'IMG');
      var parsed = parseMediaItemText(it);
      it.setAttribute('data-search-name', parsed.name.toLowerCase());
      // Build restyled content
      var size = '';
      // Try to pull size string like "42 MB" from original
      var sizeMatch = (it.textContent||'').match(/(\d+(\.\d+)?\s?(KB|MB|GB))/i);
      if (sizeMatch) size = sizeMatch[1];
      var subtitle = size ? (parsed.dur ? (size + ' \u00b7 ' + parsed.dur) : size) : (parsed.dur || '');
      it.classList.add('v10-styled');
      it.innerHTML =
        '<div class="v10-mi-thumb '+cls+'">'+icon+'</div>'+
        '<div class="v10-mi-info">'+
          '<h5>'+escapeHtml(parsed.name)+'</h5>'+
          (subtitle ? '<small>'+escapeHtml(subtitle)+'</small>' : '')+
        '</div>'+
        '<span class="v10-mi-badge '+cls+'">'+label+'</span>';
    });
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  /* ===================== PROJECT FOLDERS ===================== */

  var COMPLETED = [
    { name: 'Brand Intro Final.mp4',   date: 'Apr 10', size: '124 MB' },
    { name: 'Product Demo v2.mp4',     date: 'Apr 8',  size: '89 MB'  },
    { name: 'Social Ad - Summer.mp4',  date: 'Apr 5',  size: '45 MB'  }
  ];
  var DRAFTS = [
    { id:'d1', name:'Landing Page Promo (WIP)', date:'Apr 12', size:'62 MB',  dur:'0:45' },
    { id:'d2', name:'Spring Launch Teaser',     date:'Apr 11', size:'34 MB',  dur:'0:22' },
    { id:'d3', name:'Q2 Investor Update',       date:'Apr 9',  size:'118 MB', dur:'2:05' }
  ];

  function buildProjFolder(opts){
    // opts: { label, count, icon, openByDefault, buildList }
    var wrap = document.createElement('div');
    wrap.setAttribute('data-v10-folder', opts.label.toLowerCase());

    var row = document.createElement('div');
    row.className = 'ml-folder v10-proj';
    row.innerHTML =
      '<span class="v10-proj-ico" style="color:'+(opts.iconColor||'#a78bfa')+'">'+opts.icon+'</span>'+
      '<span class="v10-proj-name">'+opts.label+'</span>'+
      '<span class="v10-proj-count">'+opts.count+'</span>'+
      '<span class="v10-chev">\u25b6</span>';

    var list = document.createElement('div');
    list.className = 'v10-folder-list';
    if (typeof opts.buildList === 'function') opts.buildList(list);

    row.addEventListener('click', function(){
      var open = row.classList.toggle('open');
      list.classList.toggle('open', open);
    });

    if (opts.openByDefault){
      row.classList.add('open');
      list.classList.add('open');
    }

    wrap.appendChild(row);
    wrap.appendChild(list);
    return wrap;
  }

  function buildCompletedList(list){
    COMPLETED.forEach(function(v){
      var item = document.createElement('div');
      item.className = 'v10-folder-item readonly';
      item.innerHTML =
        '<span class="v10-fi-ico" style="color:#f59e0b">\ud83c\udfac</span>'+
        '<div class="v10-fi-body">'+
          '<div class="v10-fi-name">'+escapeHtml(v.name)+'</div>'+
          '<span class="v10-fi-meta">'+escapeHtml(v.date+' \u00b7 '+v.size)+'</span>'+
        '</div>';
      list.appendChild(item);
    });
    var note = document.createElement('div');
    note.className = 'v10-folder-note';
    note.textContent = 'Read-only archive of finished projects';
    list.appendChild(note);
  }

  function buildDraftsListInto(list){
    DRAFTS.forEach(function(d){
      var item = document.createElement('div');
      item.className = 'v10-folder-item clickable';
      item.innerHTML =
        '<span class="v10-fi-ico" style="color:#8b5cf6">\ud83c\udf9e\ufe0f</span>'+
        '<div class="v10-fi-body">'+
          '<div class="v10-fi-name">'+escapeHtml(d.name)+'</div>'+
          '<span class="v10-fi-meta">'+escapeHtml(d.date+' \u00b7 '+d.size+' \u00b7 '+d.dur)+'</span>'+
        '</div>'+
        '<span class="v10-fi-hint">LOAD</span>';
      item.addEventListener('click', function(e){
        e.stopPropagation();
        loadDraftIntoEditor(d);
      });
      list.appendChild(item);
    });
    var note = document.createElement('div');
    note.className = 'v10-folder-note';
    note.textContent = 'Click a draft to load it in the editor';
    list.appendChild(note);
  }

  function rebuildFolders(){
    var ml = document.querySelector('.media-library');
    if (!ml) return;
    // Find the "Folders" or already-renamed "Projects" section header
    var sections = ml.querySelectorAll('.ml-section');
    var header = null;
    sections.forEach(function(s){
      if (/^\s*(folders|projects)\s*$/i.test(s.textContent)) header = s;
    });
    if (!header) return;

    header.textContent = 'Projects';
    header.setAttribute('data-v10','projects');

    // Remove any existing folder rows / v10 wrappers between header and next section
    var next = header.nextElementSibling;
    var toRemove = [];
    while (next && !next.classList.contains('ml-section')){
      if (next.classList.contains('ml-folder') ||
          next.hasAttribute('data-v10-folder') ||
          next.classList.contains('v10-drafts') ||
          next.classList.contains('v10-folder-list')) {
        toRemove.push(next);
      }
      next = next.nextElementSibling;
    }
    toRemove.forEach(function(n){ n.remove(); });

    var completedFolder = buildProjFolder({
      label: 'Completed Videos',
      count: COMPLETED.length,
      icon: '\ud83d\udce6',
      iconColor: '#f59e0b',
      openByDefault: false,
      buildList: buildCompletedList
    });
    var draftsFolder = buildProjFolder({
      label: 'Drafts',
      count: DRAFTS.length,
      icon: '\ud83d\udcdd',
      iconColor: '#8b5cf6',
      openByDefault: true,
      buildList: buildDraftsListInto
    });

    // Insert drafts immediately after completed
    header.parentNode.insertBefore(completedFolder, header.nextSibling);
    completedFolder.parentNode.insertBefore(draftsFolder, completedFolder.nextSibling);
  }

  /* ===================== DRAFT LOAD ===================== */

  function loadDraftIntoEditor(draft){
    // Hide the upload panel (production DOM uses various selectors; we try them all)
    var uploadPanelSelectors = [
      '#uploadPanel', '.upload-panel', '.video-upload-panel', '.vu-panel',
      '.upload-container', '.preview-upload', '[class*="upload-panel"]'
    ];
    var hiddenPanel = null;
    uploadPanelSelectors.forEach(function(sel){
      document.querySelectorAll(sel).forEach(function(el){
        if (!hiddenPanel) hiddenPanel = el;
        el.style.display = 'none';
        el.dataset.v10HiddenForDraft = '1';
      });
    });

    // Find the preview container (central area)
    var previewWrap =
      document.querySelector('.preview-wrap') ||
      document.querySelector('#previewWrap') ||
      document.querySelector('.video-preview-wrap') ||
      document.querySelector('.preview-container') ||
      document.querySelector('.vp-wrap') ||
      document.querySelector('.editor-main .preview') ||
      (hiddenPanel && hiddenPanel.parentNode);

    if (previewWrap){
      // Remove any previous draft frame
      previewWrap.querySelectorAll('[data-v10="preview-frame"]').forEach(function(n){ n.remove(); });
      var frame = document.createElement('div');
      frame.className = 'v10-preview-frame';
      frame.setAttribute('data-v10','preview-frame');
      frame.innerHTML =
        '<div class="v10-pf-content">'+
          '<div class="v10-pf-play">\u25b6</div>'+
          '<div class="v10-pf-name">'+escapeHtml(draft.name)+'.mp4</div>'+
          '<div class="v10-pf-badge">DRAFT LOADED</div>'+
        '</div>';
      previewWrap.appendChild(frame);
    }

    // Also best-effort: poke real video loader if exposed
    ['loadDraft','loadProject','openDraft','loadVideo'].forEach(function(fn){
      if (typeof window[fn] === 'function'){
        try { window[fn](draft); } catch(_){}
      }
    });

    toast('Loaded draft: '+draft.name);
  }

  function toast(msg){
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%) translateY(-20px);background:#8b5cf6;color:#fff;padding:10px 24px;border-radius:10px;font:600 13px -apple-system,system-ui,sans-serif;box-shadow:0 8px 30px rgba(139,92,246,.4);z-index:10000;opacity:0;transition:transform .3s ease,opacity .3s ease;pointer-events:none';
    document.body.appendChild(t);
    requestAnimationFrame(function(){
      t.style.opacity = '1';
      t.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(function(){
      t.style.opacity = '0';
      setTimeout(function(){ t.remove(); }, 300);
    }, 2200);
  }

  function patchMediaCorner(){
    var ml = document.querySelector('.media-library');
    if (!ml) return false;
    ensureDropZoneAboveTabs();
    renameStockTab();
    ensureSearchBar();
    removeImportFolderButtons();
    restyleMediaItems();
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
    ['#831843','#ec4899'], ['#be185d','#f472b6'], ['#7c2d12','#f59e0b'],
    ['#78350f','#fbbf24'], ['#134e4a','#14b8a6'], ['#0c4a6e','#0ea5e9'],
    ['#1e3a8a','#3b82f6'], ['#581c87','#a855f7'], ['#164e63','#06b6d4']
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
    fs.innerHTML = frames + '<span class="v10-fs-label">\ud83c\udfac '+escapeHtml(videoName||'Video')+'</span>';
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
    var vClip = document.querySelector('.mt-track-video .mt-clip, .mt-track-video [class*="clip"], .fs-track.video-track [class*="clip"]');
    if (vClip) return true;
    // Also treat "draft loaded" frame as video-loaded for timeline overlays
    if (document.querySelector('[data-v10="preview-frame"]')) return true;
    return false;
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
    var draft = document.querySelector('[data-v10="preview-frame"] .v10-pf-name');
    if (draft) return draft.textContent;
    var clip = document.querySelector('.mt-track-video, .fs-track.video-track');
    if (clip){
      var t = (clip.textContent||'').trim();
      if (t) return t.split('\n')[0].trim();
    }
    return 'Video';
  }

  function patchTimelineTracks(){
    if (!videoIsLoaded()){
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
    try { patchMediaCorner(); } catch(e){}
    try { patchTimelineTracks(); } catch(e){}
  }

  function boot(){
    applyAll();
    var tries = 0;
    var iv = setInterval(function(){
      applyAll();
      if (++tries > 60) clearInterval(iv);
    }, 400);
    var obs = new MutationObserver(function(){ applyAll(); });
    obs.observe(document.body, { childList: true, subtree: true });
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
