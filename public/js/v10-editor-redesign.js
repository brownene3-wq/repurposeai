/* v10-editor-redesign.js â Media Corner + Timeline redesign (V3 parity)
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
    '/* v10 timeline empty state */',
    '.v10-tl-empty .mt-toolbar{display:none!important}',
    '.v10-tl-empty .mt-timeline-body{display:none!important}',
    '.v10-tl-empty .timeline-scroll{display:none!important}',
    '.v10-tl-empty{display:flex;align-items:center;justify-content:center;background:#0a0815}',
    '.v10-tl-placeholder{text-align:center;color:#5c5a70;font-size:12px;user-select:none}',
    '.v10-tl-placeholder svg{display:block;margin:0 auto 8px;opacity:.35}',
    '/* v10 hide native filmstrip-wrap (mini-timeline) — consolidated into multi-track */',
    '.filmstrip-wrap{display:none!important}',
    '/* v10 enhanced multi-track timeline */',
    '.mt-track-video,.mt-track-audio{height:52px!important;min-height:52px!important}',
    '.mt-track-video .mt-clip,.mt-track-audio .mt-clip{height:100%!important}',
    '.mt-tracks-area{cursor:pointer}',
    '/* v10 track-label alignment \u2014 match label height to track height */',
    '.mt-label-video,.mt-label-audio{height:52px!important;min-height:52px!important;display:flex!important;align-items:center!important}',
    '.mt-label-music,.mt-label-text,.mt-label-fx{height:36px!important;min-height:36px!important;display:flex!important;align-items:center!important}',
    '/* v10 timeline overlays */',
    '.v10-filmstrip{position:absolute;inset:4px 4px;border-radius:5px;overflow:hidden;display:flex;box-shadow:0 2px 6px rgba(0,0,0,.35);border:1px solid rgba(124,58,237,.45);z-index:2;pointer-events:none}',
    '.v10-filmstrip::before,.v10-filmstrip::after{content:"";position:absolute;left:0;right:0;height:3px;background-image:repeating-linear-gradient(90deg,#0a0815 0 4px,transparent 4px 8px);z-index:3}',
    '.v10-filmstrip::before{top:0}.v10-filmstrip::after{bottom:0}',
    '.v10-frame{flex:1;min-width:0;border-right:1px solid rgba(0,0,0,.35);position:relative;overflow:hidden;background-size:cover;background-position:center;background-repeat:no-repeat}',
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
    '.v10-preview-frame .v10-pf-sub{font-size:11px;color:rgba(255,255,255,.55);margin-top:2px}',
    '.v10-preview-frame .v10-pf-badge{font-size:10px;margin-top:6px;color:#a78bfa;font-weight:700;letter-spacing:.4px}',
    '.v10-preview-frame .v10-pf-close{position:absolute;top:8px;right:10px;z-index:3;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff;width:28px;height:28px;border-radius:50%;font-size:14px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}',
    '.v10-preview-frame .v10-pf-close:hover{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.25)}',
    '.v10-preview-frame .v10-pf-replace{margin-top:14px;padding:7px 16px;border-radius:6px;border:1px solid rgba(139,92,246,.5);background:rgba(139,92,246,.12);color:#e2e0f0;font-size:11px;font-weight:600;cursor:pointer}',
    '.v10-preview-frame .v10-pf-replace:hover{background:rgba(139,92,246,.25);border-color:#a78bfa}',
    '/* v10 hide native sidebar duplicates */',
    '.media-library .ml-search{display:none!important}',
    '.media-library .ml-body>.ml-upload{display:none!important}',
    '.media-library .ml-body>.ml-section:not([data-v10]){display:none!important}',
    /* Folders disabled for now — Projects section removed per request */
    '.media-library .ml-folder{display:none!important}',
    '.media-library [data-v10-folder]{display:none!important}',
    /* #mediaFileGrid (.ml-fgrid) is the container where sidebar uploads land
       (media-panel-fix.js appendMediaItem) and where the real /video-editor/
       upload handler injects items via window.addUploadedMediaItem. Keep it
       visible so uploaded files actually appear in the Media library. */
    '.media-library .ml-body>.ml-fgrid{display:flex;flex-direction:column;gap:5px;padding:4px 12px 8px}',
    '.media-library .ml-body>.ml-fgrid:empty{display:none}',
    '/* v10 full-height media library sidebar */',
    '.editor-container .media-library{grid-row:2/4!important;overflow-y:hidden;display:flex;flex-direction:column}',
    '.editor-container .media-library .ml-body{flex:1 1 0;overflow-y:auto;min-height:0}',
    '.editor-container .timeline-container{grid-column:2/3!important}',
    '/* v10 full-height editor sidebar */',
    '.editor-container .editor-sidebar{grid-row:2/4!important;overflow-y:hidden;display:flex;flex-direction:column}',
    '/* v10 virtual media items */',
    '.v10-media-list{padding:0 12px 4px;overflow-y:auto}',
    '.v10-mi{display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:7px;background:rgba(255,255,255,.02);border:1px solid #2a2545;margin-bottom:5px;cursor:pointer;transition:all .15s}',
    '.v10-mi:hover{border-color:#8b5cf6;background:rgba(139,92,246,.06)}',
    '.v10-mi-thumb{width:38px;height:28px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:13px;color:#fff;flex-shrink:0}',
    '/* v10 right panel override */',
    '.editor-sidebar .t-body.v10-hidden{display:none!important}',
    '.editor-sidebar .tool-panel.v10-hidden{display:none!important}',
    '.v10-rp-content{flex:1 1 0;overflow-y:auto;padding:14px;min-height:0}',
    '.v10-rp-content.v10-rp-hidden{display:none!important}',
    '.v10-rp-section-title{font-size:10px;font-weight:800;color:#8886a0;letter-spacing:.6px;margin-bottom:8px;padding-top:6px}',
    '.v10-rp-section-title:first-child{padding-top:0}',
    '.v10-rp-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px}',
    '.v10-rp-btn{padding:12px 10px;background:rgba(255,255,255,.03);border:1px solid #2a2545;border-radius:8px;color:#e2e0f0;font-size:12px;font-weight:500;display:flex;align-items:center;gap:7px;cursor:pointer;transition:all .15s}',
    '.v10-rp-btn:hover{border-color:#8b5cf6;background:rgba(139,92,246,.06)}',
    '.v10-rp-btn .v10-rp-ic{font-size:14px}',
    '.v10-rp-btn.active{background:rgba(139,92,246,.12);border-color:#8b5cf6}',
    '/* v10 right panel tab override */',
    '.cat-tabs-new .cat-btn.v10-on{background:linear-gradient(135deg,rgba(139,92,246,.15),rgba(236,72,153,.1))!important;color:#8b5cf6!important}',
    '.cat-tabs-new .cat-btn.v10-off{background:transparent!important;color:#8886a0!important}',
    '/* v10 audio cards */',
    '.v10-audio-card{margin-bottom:10px;padding:10px;background:rgba(255,255,255,.03);border-radius:8px;border:1px solid #2a2545}',
    '.v10-audio-card .v10-ac-head{display:flex;align-items:center;gap:6px;margin-bottom:8px}',
    '.v10-audio-card .v10-ac-dot{width:8px;height:8px;border-radius:4px}',
    '.v10-audio-card .v10-ac-head h5{font-size:11px;font-weight:600;color:#e2e0f0;margin:0}',
    '.v10-audio-card .v10-ac-vol{display:flex;align-items:center;gap:6px;margin-bottom:6px}',
    '.v10-audio-card .v10-ac-volbar{flex:1;height:5px;background:#0d0b1a;border-radius:3px;overflow:hidden}',
    '.v10-audio-card .v10-ac-volfill{height:100%;border-radius:3px}',
    '.v10-audio-card .v10-ac-voltxt{font-size:10px;color:#5c5a70}',
    '.v10-audio-card .v10-ac-btns{display:flex;gap:4px}',
    '.v10-audio-card .v10-ac-btns button{flex:1;padding:4px 6px;font-size:9px;background:rgba(255,255,255,.05);border:1px solid #2a2545;border-radius:4px;color:#5c5a70;cursor:pointer;transition:all .15s}',
    '.v10-audio-card .v10-ac-btns button:hover{border-color:#8b5cf6;color:#8b5cf6}',
    '/* v10 fx buttons */',
    '.v10-fx-btn{display:block;width:100%;padding:10px 12px;margin-bottom:6px;background:rgba(255,255,255,.03);border:1px solid #2a2545;border-radius:8px;color:#e2e0f0;font-size:11px;font-weight:500;text-align:left;cursor:pointer;transition:all .15s}',
    '.v10-fx-btn:hover{border-color:#8b5cf6;background:rgba(139,92,246,.06)}'
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

    function pickAllMediaInput(){
      // Prefer an input that accepts ALL media types so the picker matches the drop zone's promise.
      return document.getElementById('mlFileAll')
          || document.getElementById('mediaFileInput')
          || document.getElementById('fileInput')
          || document.getElementById('mlFileVideo')
          || document.querySelector('input[type="file"][accept*="video"][accept*="audio"]')
          || document.querySelector('input[type="file"]');
    }
    function pickInputForFile(file){
      var t = (file && file.type) || '';
      if (/^video\//.test(t)) return document.getElementById('mlFileVideo') || pickAllMediaInput();
      if (/^audio\//.test(t)) return document.getElementById('mlFileAudio') || pickAllMediaInput();
      if (/^image\//.test(t)) return document.getElementById('mlFileImage') || pickAllMediaInput();
      return pickAllMediaInput();
    }
    function triggerUpload(){
      // Throttle: if another upload was just triggered in the last 500ms,
      // ignore this call. Prevents a second file dialog opening when the
      // click path fires more than once for a single user click.
      var now = Date.now();
      if (window.__v10LastUploadTrigger && (now - window.__v10LastUploadTrigger) < 500) return;
      window.__v10LastUploadTrigger = now;
      var input = pickAllMediaInput();
      if (input){ try { input.click(); } catch(_){} return; }
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
      // Route by MIME type of the first dropped file so V9's per-type handlers run correctly.
      var input = pickInputForFile(files[0]);
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
      var name = (it.getAttribute('data-search-name') || (it.textContent||'')).toLowerCase();
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
    // Also filter project folder items (Completed Videos / Drafts)
    var fitems = document.querySelectorAll('.media-library .v10-folder-item');
    fitems.forEach(function(fi){
      var nmEl = fi.querySelector('.v10-fi-name');
      var nm = (nmEl ? nmEl.textContent : fi.textContent || '').toLowerCase();
      if (!q){
        if (fi.dataset.v10SearchHidden === '1'){
          fi.dataset.v10SearchHidden = '';
          fi.style.display = fi.dataset.v10TabHidden === '1' ? 'none' : '';
        }
      } else {
        if (nm.indexOf(q) === -1){
          fi.dataset.v10SearchHidden = '1';
          fi.style.display = 'none';
        } else {
          fi.dataset.v10SearchHidden = '';
          fi.style.display = fi.dataset.v10TabHidden === '1' ? 'none' : '';
        }
      }
    });
    // Auto-expand folders that contain a search hit; hide folders where all
    // items got filtered out. An empty folder (0 items, only an empty-state
    // note) stays visible — same rule as applyFilter.
    document.querySelectorAll('.media-library [data-v10-folder]').forEach(function(wrap){
      var header = wrap.querySelector('.ml-folder.v10-proj');
      var list = wrap.querySelector('.v10-folder-list');
      if (!header || !list) return;
      var allItems = list.querySelectorAll('.v10-folder-item');
      var visible = Array.from(allItems).filter(function(e){
        return e.style.display !== 'none';
      }).length;
      var isEmptyFolder = allItems.length === 0;
      if (q){
        if (isEmptyFolder || visible > 0){
          wrap.style.display = '';
          if (visible > 0){
            // Auto-expand while searching so hits are visible
            header.classList.add('open');
            list.classList.add('open');
          }
        } else {
          wrap.style.display = 'none';
        }
      } else {
        wrap.style.display = '';
      }
    });
    // Sync all search inputs so both bars show the same term
    document.querySelectorAll('.media-library .v10-search input, .media-library .ml-search input').forEach(function(inp){
      if (inp.value !== (term||'')) inp.value = (term||'');
    });
  }

  function wireOrphanSearchInputs(){
    // V9 has its own .ml-search input at the top of the panel. Wire it so it
    // searches the same library (both folder items and recent items). The v10
    // bar is already wired in ensureSearchBar().
    document.querySelectorAll('.media-library .ml-search input').forEach(function(inp){
      if (inp.__v10SearchWired) return;
      inp.__v10SearchWired = true;
      inp.addEventListener('input', function(){ applySearch(inp.value); });
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
    if (/ð¬|ð¥|ð|ðï¸|â¶/i.test(el.innerHTML||'')) return 'video';
    if (/ðµ|ð¶|ð/i.test(el.innerHTML||'')) return 'audio';
    if (/ð¼|ð/i.test(el.innerHTML||'')) return 'image';
    // Folder items in Completed/Drafts are all video by design
    if (el.classList && el.classList.contains('v10-folder-item')) return 'video';
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
    // Also apply to project folder items (Completed Videos / Drafts)
    var fitems = document.querySelectorAll('.media-library .v10-folder-item');
    fitems.forEach(function(fi){
      var t = classifyMediaItem(fi);
      if (kind === 'all' || t === kind){
        fi.dataset.v10TabHidden = '';
        if (fi.dataset.v10SearchHidden !== '1') fi.style.display = '';
      } else {
        fi.dataset.v10TabHidden = '1';
        fi.style.display = 'none';
      }
    });
    // Hide whole folder only if it has real items that are all filtered out.
    // Folders that are truly empty (showing just an empty-state note) should
    // stay visible so the user can see the section header.
    document.querySelectorAll('.media-library [data-v10-folder]').forEach(function(wrap){
      var list = wrap.querySelector('.v10-folder-list');
      if (!list) return;
      var allItems = list.querySelectorAll('.v10-folder-item');
      var visible = Array.from(allItems).filter(function(e){
        return e.style.display !== 'none';
      }).length;
      var isEmptyFolder = allItems.length === 0;
      wrap.style.display = (isEmptyFolder || visible > 0) ? '' : 'none';
    });
    // Also filter v10 virtual media items
    filterMediaList(kind);
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
          filterMediaList(kind);
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

  // Media library starts empty — only genuine user uploads populate it
  // (via media-panel-fix.js handleFiles / the real upload flow).
  var MEDIA_LIB = { videos: [], audio: [], images: [] };

  function buildMediaItemEl(m, type){
    var cls = type==='vid'?'vid':(type==='aud'?'aud':'img');
    var icon = type==='vid'?'\u25b6':(type==='aud'?'\u266a':'\ud83d\uddbc');
    var label = type==='vid'?'VID':(type==='aud'?'AUD':'IMG');
    var sub = m.size + (m.dur && m.dur !== '\u2014' ? ' \u00b7 '+m.dur : '');
    var el = document.createElement('div');
    el.className = 'v10-mi';
    el.setAttribute('data-v10-media-type', type);
    el.setAttribute('data-search-name', m.name.toLowerCase());
    el.innerHTML =
      '<div class="v10-mi-thumb '+cls+'">'+icon+'</div>'+
      '<div class="v10-mi-info"><h5>'+escapeHtml(m.name)+'</h5><small>'+escapeHtml(sub)+'</small></div>'+
      '<span class="v10-mi-badge '+cls+'">'+label+'</span>';
    el.addEventListener('click', function(){
      // Route through the shared addClipToTimeline if available so this item
      // actually lands on the timeline (not just a toast).
      var kind = type === 'vid' ? 'vid' : (type === 'aud' ? 'aud' : 'img');
      if (typeof window.addClipToTimeline === 'function'){
        try { window.addClipToTimeline(m.name, kind); return; } catch(_){}
      }
      toast('Selected: '+m.name);
    });
    return el;
  }

  function injectMediaItems(){
    var ml = document.querySelector('.media-library');
    if (!ml) return;
    if (ml.querySelector('[data-v10="media-list"]')) return;
    var mlBody = ml.querySelector('.ml-body');
    if (!mlBody) return;
    var projectsHeader = mlBody.querySelector('.ml-section[data-v10="projects"]');
    var list = document.createElement('div');
    list.className = 'v10-media-list';
    list.setAttribute('data-v10', 'media-list');
    // Insert before the projects header
    if (projectsHeader){
      mlBody.insertBefore(list, projectsHeader);
    } else {
      mlBody.insertBefore(list, mlBody.firstChild);
    }
    // Populate with all media items
    MEDIA_LIB.videos.forEach(function(m){ list.appendChild(buildMediaItemEl(m,'vid')); });
    MEDIA_LIB.audio.forEach(function(m){ list.appendChild(buildMediaItemEl(m,'aud')); });
    MEDIA_LIB.images.forEach(function(m){ list.appendChild(buildMediaItemEl(m,'img')); });
  }

  function filterMediaList(kind){
    var items = document.querySelectorAll('.v10-media-list .v10-mi');
    items.forEach(function(el){
      var t = el.getAttribute('data-v10-media-type');
      var match = kind === 'all' ||
        (kind === 'video' && t === 'vid') ||
        (kind === 'audio' && t === 'aud') ||
        (kind === 'image' && t === 'img');
      el.style.display = match ? '' : 'none';
    });
  }

  function parseMediaItemText(it){
    // Expected format like "ð¬VID2:21+ Timeline0314(1).mp4" â extract name + dur
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
      // Prefer the clean filename stored on the dataset (set by
      // media-panel-fix.js appendMediaItem). Fall back to parsing the
      // textContent for legacy/server-rendered items.
      var parsed = parseMediaItemText(it);
      var displayName = it.dataset.fileName || parsed.name;
      it.setAttribute('data-search-name', String(displayName || '').toLowerCase());
      // Build restyled content
      var size = '';
      var sizeMatch = (it.textContent||'').match(/(\d+(\.\d+)?\s?(KB|MB|GB))/i);
      if (sizeMatch) size = sizeMatch[1];
      var durFromDs = '';
      if (it.dataset.duration){
        var d = parseFloat(it.dataset.duration);
        if (d > 0) durFromDs = Math.floor(d/60) + ':' + String(Math.floor(d%60)).padStart(2,'0');
      }
      var dur = durFromDs || parsed.dur;
      var subtitle = size ? (dur ? (size + ' \u00b7 ' + dur) : size) : (dur || '');
      it.classList.add('v10-styled');
      it.innerHTML =
        '<div class="v10-mi-thumb '+cls+'">'+icon+'</div>'+
        '<div class="v10-mi-info">'+
          '<h5>'+escapeHtml(displayName)+'</h5>'+
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

  /* Projects are persisted per-user in localStorage. They start empty
   * and are populated by the real upload / export flows (see
   * window.addDraftEntry / window.addCompletedEntry below). */
  var DRAFTS_KEY    = 'v10_projects_drafts_v1';
  var COMPLETED_KEY = 'v10_projects_completed_v1';

  function readStore(key){
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch(_){ return []; }
  }
  function writeStore(key, arr){
    try { localStorage.setItem(key, JSON.stringify(arr || [])); } catch(_){}
  }

  function getDrafts(){ return readStore(DRAFTS_KEY); }
  function getCompleted(){ return readStore(COMPLETED_KEY); }

  function addDraft(entry){
    if (!entry || !entry.name) return;
    var list = getDrafts();
    // dedupe on filename (server-side filename is unique per upload)
    var filtered = list.filter(function(d){ return d.filename !== entry.filename; });
    filtered.unshift(entry);
    writeStore(DRAFTS_KEY, filtered);
    try { rebuildFolders(); } catch(_){}
  }
  function removeDraftByFilename(filename){
    if (!filename) return;
    var list = getDrafts().filter(function(d){ return d.filename !== filename; });
    writeStore(DRAFTS_KEY, list);
    try { rebuildFolders(); } catch(_){}
  }
  function addCompleted(entry){
    if (!entry || !entry.name) return;
    var list = getCompleted();
    list.unshift(entry);
    writeStore(COMPLETED_KEY, list);
    try { rebuildFolders(); } catch(_){}
  }

  // Expose so the real upload/export handlers (in routes/video-editor.js)
  // can feed real data into the Projects section.
  window.addDraftEntry = addDraft;
  window.removeDraftByFilename = removeDraftByFilename;
  window.addCompletedEntry = addCompleted;

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
    var completed = getCompleted();
    if (completed.length === 0){
      var empty = document.createElement('div');
      empty.className = 'v10-folder-note';
      empty.textContent = 'No exported videos yet. Your exports will appear here.';
      list.appendChild(empty);
      return;
    }
    completed.forEach(function(v){
      var item = document.createElement('div');
      item.className = 'v10-folder-item clickable';
      var meta = [v.date, v.size].filter(Boolean).join(' \u00b7 ');
      item.innerHTML =
        '<span class="v10-fi-ico" style="color:#f59e0b">\ud83c\udfac</span>'+
        '<div class="v10-fi-body">'+
          '<div class="v10-fi-name">'+escapeHtml(v.name)+'</div>'+
          (meta ? '<span class="v10-fi-meta">'+escapeHtml(meta)+'</span>' : '')+
        '</div>'+
        '<span class="v10-fi-hint">OPEN</span>';
      item.addEventListener('click', function(e){
        e.stopPropagation();
        loadDraftIntoEditor({
          name: v.name, date: v.date, size: v.size,
          filename: v.filename, serveUrl: v.serveUrl || v.downloadUrl,
          kind: 'completed'
        });
      });
      list.appendChild(item);
    });
  }

  function buildDraftsListInto(list){
    var drafts = getDrafts();
    if (drafts.length === 0){
      var empty = document.createElement('div');
      empty.className = 'v10-folder-note';
      empty.textContent = 'No drafts yet. Uploaded projects will appear here until you export them.';
      list.appendChild(empty);
      return;
    }
    drafts.forEach(function(d){
      var item = document.createElement('div');
      item.className = 'v10-folder-item clickable';
      var meta = [d.date, d.size, d.dur].filter(Boolean).join(' \u00b7 ');
      item.innerHTML =
        '<span class="v10-fi-ico" style="color:#8b5cf6">\ud83c\udf9e\ufe0f</span>'+
        '<div class="v10-fi-body">'+
          '<div class="v10-fi-name">'+escapeHtml(d.name)+'</div>'+
          (meta ? '<span class="v10-fi-meta">'+escapeHtml(meta)+'</span>' : '')+
        '</div>'+
        '<span class="v10-fi-hint">LOAD</span>';
      item.addEventListener('click', function(e){
        e.stopPropagation();
        loadDraftIntoEditor(d);
      });
      list.appendChild(item);
    });
  }

  function rebuildFolders(){
    var ml = document.querySelector('.media-library');
    if (!ml) return;
    // Find the "Folders" or already-renamed "Projects" section header
    var sections = ml.querySelectorAll('.ml-section');
    var header = null;
    sections.forEach(function(s){
      if (/^\s*(folders|projects|all files)\s*$/i.test(s.textContent)) header = s;
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

    var completedCount = getCompleted().length;
    var draftsCount    = getDrafts().length;

    var completedFolder = buildProjFolder({
      label: 'Completed Videos',
      count: completedCount,
      icon: '\ud83d\udce6',
      iconColor: '#f59e0b',
      openByDefault: false,
      buildList: buildCompletedList
    });
    var draftsFolder = buildProjFolder({
      label: 'Drafts',
      count: draftsCount,
      icon: '\ud83d\udcdd',
      iconColor: '#8b5cf6',
      openByDefault: draftsCount > 0,
      buildList: buildDraftsListInto
    });

    // Insert drafts immediately after completed
    header.parentNode.insertBefore(completedFolder, header.nextSibling);
    completedFolder.parentNode.insertBefore(draftsFolder, completedFolder.nextSibling);
  }

  /* ===================== DRAFT LOAD ===================== */

  function closeDraftPreview(){
    // Restore upload panel(s) we hid
    document.querySelectorAll('[data-v10-hidden-for-draft="1"]').forEach(function(el){
      el.style.display = '';
      el.dataset.v10HiddenForDraft = '';
    });
    // Remove any preview frame we injected
    document.querySelectorAll('[data-v10="preview-frame"]').forEach(function(n){ n.remove(); });
  }

  function loadDraftIntoEditor(draft){
    // If this draft has a real server-uploaded file, load it into the
    // real video player / editor state instead of the fake preview overlay.
    var realUrl = draft && (draft.serveUrl || draft.downloadUrl);
    if (realUrl){
      var player = document.getElementById('videoPlayer') || document.querySelector('video');
      if (player){
        try { player.src = realUrl; player.load(); } catch(_){}
      }
      // Wire the editor's currentVideoFile so export / tools can operate on it
      if (draft.filename){
        try {
          window.currentVideoFile = {
            filename: draft.filename,
            serveUrl: realUrl,
            duration: draft.duration || 0
          };
        } catch(_){}
      }
      // Hide the upload zone now that there's a real video loaded
      var uz = document.getElementById('uploadZone');
      if (uz){
        uz.style.display = 'none';
        uz.dataset.v10HiddenForDraft = '1';
      }
      // Enable editor buttons the upload flow normally enables
      ['trimButton','exportButton','splitButton','filterButton','speedButton',
       'audioButton','previewVoiceButton','voiceoverButton','vtPreviewBtn',
       'vtApplyBtn','textButton','speedSelect','addMusicButton',
       'removeFillerWordsBtn','removePausesBtn','applyTransitionButton',
       'applyCaptionsBtn'].forEach(function(id){
        var el = document.getElementById(id);
        if (el) el.disabled = false;
      });
      // Drop the video onto the timeline as a clip, using the real duration
      // so it takes up the right amount of track width AND the serveUrl so
      // the playhead-follow logic can swap the preview to this clip.
      if (typeof window.addClipToTimeline === 'function'){
        try { window.addClipToTimeline(draft.name, 'vid', draft.duration, realUrl); } catch(_){}
      }
      toast('Loaded '+(draft.kind === 'completed' ? 'export' : 'draft')+': '+draft.name);
      return;
    }

    // Fallback (e.g. a completed export with only metadata): show preview overlay
    // Hide the REAL V9 upload panel (the "Upload Your Video" card).
    // Primary selector is #uploadZone on the live site; keep legacy fallbacks for resilience.
    var uploadPanelSelectors = [
      '#uploadZone', '.upload-zone',
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

    // Find the preview container â prefer V9's real container.
    var previewWrap =
      document.querySelector('.video-container') ||
      document.getElementById('videoPreviewArea') ||
      document.querySelector('.preview-wrap') ||
      document.querySelector('#previewWrap') ||
      document.querySelector('.video-preview-wrap') ||
      document.querySelector('.preview-container') ||
      document.querySelector('.vp-wrap') ||
      document.querySelector('.editor-main .preview') ||
      (hiddenPanel && hiddenPanel.parentNode);

    if (previewWrap){
      // Remove any previous draft frame
      document.querySelectorAll('[data-v10="preview-frame"]').forEach(function(n){ n.remove(); });
      var frame = document.createElement('div');
      frame.className = 'v10-preview-frame';
      frame.setAttribute('data-v10','preview-frame');
      var subtitleBits = [];
      if (draft.date) subtitleBits.push(draft.date);
      if (draft.size) subtitleBits.push(draft.size);
      if (draft.dur)  subtitleBits.push(draft.dur);
      var subtitle = subtitleBits.join(' \u00b7 ');
      frame.innerHTML =
        '<button type="button" class="v10-pf-close" aria-label="Close preview">\u2715</button>'+
        '<div class="v10-pf-content">'+
          '<div class="v10-pf-play">\u25b6</div>'+
          '<div class="v10-pf-name">'+escapeHtml(draft.name)+'</div>'+
          (subtitle ? '<div class="v10-pf-sub">'+escapeHtml(subtitle)+'</div>' : '')+
          '<div class="v10-pf-badge">'+escapeHtml((draft.kind||'DRAFT').toUpperCase()+' LOADED')+'</div>'+
          '<button type="button" class="v10-pf-replace">Upload a video to edit</button>'+
        '</div>';
      previewWrap.appendChild(frame);

      // Close button restores the upload panel
      var closeBtn = frame.querySelector('.v10-pf-close');
      if (closeBtn) closeBtn.addEventListener('click', function(e){
        e.stopPropagation();
        closeDraftPreview();
        toast('Closed draft preview');
      });
      // "Upload a video" button restores panel AND opens the picker
      var replaceBtn = frame.querySelector('.v10-pf-replace');
      if (replaceBtn) replaceBtn.addEventListener('click', function(e){
        e.stopPropagation();
        closeDraftPreview();
        var input = document.getElementById('mlFileAll') || document.getElementById('fileInput');
        if (input) try { input.click(); } catch(_){}
      });
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
    wireOrphanSearchInputs();
    removeImportFolderButtons();
    restyleMediaItems();
    // Projects section (Completed Videos + Drafts folders) intentionally not
    // rendered right now — Albert wants uploaded files to live in the area
    // between the search bar and where Projects was. rebuildFolders() and
    // injectMediaItems() are left defined so a future iteration can re-enable
    // the Projects section as a separate, opt-in feature. The window hooks
    // (addDraftEntry, addCompletedEntry, removeDraftByFilename) still work;
    // they just won't render anything until the section is re-enabled.
    // Apply the currently active filter (default: all)
    var active = ml.querySelector('.ml-tab.active');
    var kind = (active && active.getAttribute('data-v10-kind')) || 'all';
    applyFilter(kind);
    // Re-apply any existing search term
    var existingSearch = document.querySelector('.media-library .v10-search input, .media-library .ml-search input');
    if (existingSearch && existingSearch.value) applySearch(existingSearch.value);
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
      frames += '<div class="v10-frame" data-frame-idx="'+i+'" style="background:linear-gradient('+angle+'deg,'+pal[0]+','+pal[1]+')"></div>';
    }
    fs.innerHTML = frames + '<span class="v10-fs-label">\ud83c\udfac '+escapeHtml(videoName||'Video')+'</span>';
    return fs;
  }


  /* Capture real video frames and apply them to the filmstrip */
  var _captureInProgress = false;
  var _lastCapturedSrc = '';

  function captureVideoFrames(){
    var video = document.querySelector('#videoPlayer, video');
    if (!video || !video.currentSrc || video.readyState < 2 || video.duration <= 0) return;
    if (_captureInProgress) return;
    if (_lastCapturedSrc === video.currentSrc) return;
    var filmstrip = document.querySelector('[data-v10="filmstrip"]');
    if (!filmstrip) return;
    var frameEls = filmstrip.querySelectorAll('.v10-frame');
    if (!frameEls.length) return;

    _captureInProgress = true;
    var numFrames = frameEls.length;
    var duration = video.duration;
    var canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 68;
    var ctx = canvas.getContext('2d');
    var savedTime = video.currentTime;
    var frameIdx = 0;

    function onSeeked(){
      try {
        /* Cover-style draw: maintain aspect ratio, crop to fill canvas */
        var vw = video.videoWidth || canvas.width;
        var vh = video.videoHeight || canvas.height;
        var cw = canvas.width;
        var ch = canvas.height;
        var videoRatio = vw / vh;
        var canvasRatio = cw / ch;
        var sx, sy, sw, sh;
        if (videoRatio > canvasRatio) {
          /* Video is wider — crop sides */
          sh = vh; sw = vh * canvasRatio;
          sx = (vw - sw) / 2; sy = 0;
        } else {
          /* Video is taller (portrait) — crop top/bottom */
          sw = vw; sh = vw / canvasRatio;
          sx = 0; sy = (vh - sh) / 2;
        }
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.6);
        if (frameEls[frameIdx]){
          frameEls[frameIdx].style.background = 'url(' + dataUrl + ') center/cover no-repeat';
        }
      } catch(e){ /* cross-origin — keep gradient */ }
      frameIdx++;
      if (frameIdx >= numFrames){
        video.removeEventListener('seeked', onSeeked);
        clearTimeout(safetyTimeout);
        video.currentTime = savedTime;
        _captureInProgress = false;
        _lastCapturedSrc = video.currentSrc;
        return;
      }
      var t = (frameIdx + 0.5) / numFrames * duration;
      video.currentTime = t;
    }

    var safetyTimeout = setTimeout(function(){
      video.removeEventListener('seeked', onSeeked);
      video.currentTime = savedTime;
      _captureInProgress = false;
    }, 15000);

    video.addEventListener('seeked', onSeeked);
    var t = (0 + 0.5) / numFrames * duration;
    video.currentTime = t;
  }

  var WF_BARS = 180;

  function buildDenseWaveform(){
    var wf = document.createElement('div');
    wf.className = 'v10-wf-dense';
    wf.setAttribute('data-v10','wf');
    var bars = '';
    for (var j=0; j<WF_BARS; j++){
      var p = j / WF_BARS;
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

  /* Capture real audio waveform from the loaded video */
  var _waveformCaptureInProgress = false;
  var _lastWaveformSrc = '';

  function captureAudioWaveform(){
    var video = document.querySelector('#videoPlayer, video');
    if (!video || !video.currentSrc || video.readyState < 2 || video.duration <= 0) return;
    if (_waveformCaptureInProgress) return;
    if (_lastWaveformSrc === video.currentSrc) return;
    var wfEl = document.querySelector('[data-v10="wf"]');
    if (!wfEl) return;

    _waveformCaptureInProgress = true;

    /* Fetch the video as an ArrayBuffer and decode its audio */
    fetch(video.currentSrc).then(function(res){
      if (!res.ok) throw new Error('fetch failed');
      return res.arrayBuffer();
    }).then(function(buf){
      var ac = new (window.AudioContext || window.webkitAudioContext)();
      return ac.decodeAudioData(buf).then(function(audioBuf){
        ac.close();
        return audioBuf;
      });
    }).then(function(audioBuf){
      /* Downsample to WF_BARS RMS amplitudes */
      var raw = audioBuf.getChannelData(0);
      var len = raw.length;
      var segSize = Math.floor(len / WF_BARS);
      var peaks = [];
      var maxPeak = 0;
      for (var i = 0; i < WF_BARS; i++){
        var start = i * segSize;
        var end = Math.min(start + segSize, len);
        var sum = 0;
        for (var s = start; s < end; s++){
          sum += raw[s] * raw[s];
        }
        var rms = Math.sqrt(sum / (end - start));
        peaks.push(rms);
        if (rms > maxPeak) maxPeak = rms;
      }
      /* Normalize and apply to the waveform bars */
      var spans = wfEl.querySelectorAll('span');
      for (var b = 0; b < Math.min(spans.length, WF_BARS); b++){
        var norm = maxPeak > 0 ? peaks[b] / maxPeak : 0;
        var h = Math.max(6, Math.min(100, norm * 94 + 6));
        spans[b].style.height = h.toFixed(1) + '%';
      }
      _lastWaveformSrc = video.currentSrc;
      _waveformCaptureInProgress = false;
    }).catch(function(){
      /* On error (CORS, decode failure) keep the placeholder waveform */
      _waveformCaptureInProgress = false;
    });
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

  function isUploadPanelVisible(){
    var uz = document.querySelector('.upload-zone');
    if (uz && uz.offsetHeight > 0 && getComputedStyle(uz).display !== 'none') return true;
    var v = document.querySelector('#videoPlayer, video');
    if (v && !v.currentSrc && !v.src && v.readyState === 0) return true;
    return false;
  }

  function patchTimelineVisibility(){
    // Timeline is now ALWAYS visible — users want to place clips / preview
    // the timeline even before uploading a video. Defensive cleanup of any
    // leftover empty-state class/placeholder from earlier sessions.
    var tc = document.querySelector('.timeline-container');
    if (!tc) return;
    tc.classList.remove('v10-tl-empty');
    var ph = tc.querySelector('.v10-tl-placeholder');
    if (ph) ph.remove();
  }

  function patchTimelineTracks(){
    // Track-level filmstrip/waveform was placed inside .mt-track-video /
    // .mt-track-audio with inset:4px 4px — it spanned the ENTIRE track and
    // visually masked every individual clip on it. Albert wants each clip
    // to have its own preview. For now we just ensure the old overlay is
    // removed so clips are visible individually. (Real per-clip thumbnails
    // can be layered back in a later iteration.)
    document.querySelectorAll('[data-v10="filmstrip"], [data-v10="wf"]').forEach(function(n){ n.remove(); });
    _lastCapturedSrc = '';
    _lastWaveformSrc = '';
  }

  /* ===================== RIGHT PANEL ===================== */

  /* ========== RIGHT PANEL TAB CONTENT BUILDERS ========== */

  function buildRPButtons(items){
    return items.map(function(pair){
      return '<button class="v10-rp-btn"><span class="v10-rp-ic">'+pair[0]+'</span>'+pair[1]+'</button>';
    }).join('');
  }

  function buildEditContent(){
    var div = document.createElement('div');
    div.className = 'v10-rp-content';
    div.setAttribute('data-v10', 'rp-edit');

    // Every button here operates on the currently-SELECTED clip (fallback:
    // the clip under the playhead). Data-v10-clip-action attribute routes
    // to window.clipAction* on click.
    //
    // ic | label             | data-v10-clip-action
    function rpBtn(ic, label, action){
      return '<button class="v10-rp-btn" data-v10-clip-action="' + action +
        '"><span class="v10-rp-ic">' + ic + '</span>' + label + '</button>';
    }

    // Inline font-size slider + number input (replaces the prompt).
    // Updates clip.dataset.fontSize on every drag/input, applies to
    // all selected text clips via window.clipActionTextFontSizeApply.
    var textControls =
      '<div class="v10-rp-inline" style="padding:8px 6px;background:rgba(108,58,237,.05);border-radius:8px;margin-top:6px">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">' +
          '<span style="font-size:10px;color:#8886a0;flex:1;letter-spacing:.3px">FONT SIZE</span>' +
          '<input type="number" id="v10TextSizeNum" min="8" max="200" value="10" ' +
            'style="width:52px;background:#0c0814;border:1px solid rgba(108,58,237,.35);color:#fff;font-size:11px;padding:3px 5px;border-radius:4px"/>' +
          '<span style="font-size:10px;color:#8886a0">px</span>' +
        '</div>' +
        '<input type="range" id="v10TextSizeSlider" min="8" max="200" value="10" ' +
          'style="width:100%;accent-color:#a78bfa"/>' +
      '</div>' +
      '<div class="v10-rp-inline" style="padding:8px 6px;background:rgba(108,58,237,.05);border-radius:8px;margin-top:6px">' +
        '<div style="font-size:10px;color:#8886a0;letter-spacing:.3px;margin-bottom:6px">TEXT COLOR</div>' +
        '<div id="v10TextColorGrid" style="display:grid;grid-template-columns:repeat(8,1fr);gap:4px"></div>' +
      '</div>';

    // Inline speed slider — 0.25x to 4x
    var speedControl =
      '<div class="v10-rp-inline" style="padding:8px 6px;background:rgba(108,58,237,.05);border-radius:8px;margin-top:6px">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">' +
          '<span style="font-size:10px;color:#8886a0;flex:1;letter-spacing:.3px">SPEED</span>' +
          '<input type="number" id="v10SpeedNum" min="0.25" max="4" step="0.05" value="1" ' +
            'style="width:52px;background:#0c0814;border:1px solid rgba(108,58,237,.35);color:#fff;font-size:11px;padding:3px 5px;border-radius:4px"/>' +
          '<span style="font-size:10px;color:#8886a0">x</span>' +
        '</div>' +
        '<input type="range" id="v10SpeedSlider" min="25" max="400" step="5" value="100" ' +
          'style="width:100%;accent-color:#a78bfa"/>' +
      '</div>';

    div.innerHTML =
      '<div class="v10-rp-section-title">TEXT</div>'+
      '<div class="v10-rp-grid">'+
        '<button class="v10-rp-btn" data-v10-action="add-text"><span class="v10-rp-ic">\ud83c\udd97</span>Add Text</button>'+
        '<button class="v10-rp-btn" data-v10-action="add-title"><span class="v10-rp-ic">\ud83d\udcdd</span>Add Title</button>'+
        rpBtn('\ud83d\udccd','Text Position','TextPosition')+
      '</div>'+
      textControls +
      '<div class="v10-rp-section-title">CLIP TOOLS <span id="v10ClipToolsHint" style="font-weight:400;color:#8886a0;font-size:10px;margin-left:8px">select a V1 clip</span></div>'+
      '<div class="v10-rp-grid" data-v10-clip-tools-group>'+
        rpBtn('\u2702\ufe0f','Trim','Trim')+
        rpBtn('\u27a1\ufe0f','Slip','SlipEdit')+
        rpBtn('\ud83d\udd2a','Split','Split')+
        rpBtn('\u2b1c','Crop','Crop')+
      '</div>'+
      speedControl +
      '<div class="v10-rp-section-title">TRANSFORM</div>'+
      '<div class="v10-rp-grid">'+
        rpBtn('\ud83d\udcd0','Resize','Resize')+
        rpBtn('\ud83d\udcf1','Smart Resize','SmartResize')+
        rpBtn('\ud83d\udd04','Rotate','Rotate')+
        rpBtn('\ud83e\ude9e','Flip','Flip')+
        rpBtn('\ud83d\udccd','Position','Position')+
      '</div>'+
      '<div class="v10-rp-section-title">TIMING</div>'+
      // Loop removed per product decision — created more confusion than
      // value and Freeze + Trim cover the same use-cases.
      '<div class="v10-rp-grid">'+
        rpBtn('\u23ea','Reverse','Reverse')+
        rpBtn('\u2744\ufe0f','Freeze','Freeze')+
        rpBtn('\ud83c\udfaf','Keyframe','Keyframe')+
      '</div>';

    // Wire all clip-action buttons FIRST so wireRPToast doesn't overwrite
    // them with the generic toast handler.
    Array.from(div.querySelectorAll('[data-v10-clip-action]')).forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.preventDefault();
        e.stopPropagation();
        var act = btn.getAttribute('data-v10-clip-action');
        var fn  = window['clipAction' + act];
        if (typeof fn === 'function'){ fn(); }
        else { toast(act + ' not wired'); }
      }, true); // capture phase so wireRPToast's bubble handler is pre-empted
    });

    // ── Inline font-size slider + number ──────────────────────────
    // Drag OR type to update the selected text clip(s). Falls back to
    // all text clips on T1 when nothing specific is selected — same
    // targeting rule as the old prompt-based clipActionTextFontSize.
    var fsSlider = div.querySelector('#v10TextSizeSlider');
    var fsNum    = div.querySelector('#v10TextSizeNum');
    function getTargetTextClips(){
      var selected = Array.from(document.querySelectorAll('.mt-clip.mt-clip-text.selected'));
      if (selected.length) return selected;
      return Array.from(document.querySelectorAll('.mt-track-text .mt-clip'));
    }
    function applyFontSize(v){
      var clips = getTargetTextClips();
      if (!clips.length) return;
      clips.forEach(function(c){ c.dataset.fontSize = String(v); });
      try { if (typeof window.syncPreviewToPlayhead === 'function') window.syncPreviewToPlayhead(); } catch(_){}
      if (typeof window.pushTimelineHistory === 'function'){
        try { window.pushTimelineHistory(); } catch(_){}
      }
    }
    if (fsSlider && fsNum){
      // Keep slider + number in lockstep
      fsSlider.addEventListener('input', function(){
        fsNum.value = fsSlider.value;
        applyFontSize(parseInt(fsSlider.value, 10));
      });
      fsNum.addEventListener('input', function(){
        var v = parseInt(fsNum.value, 10);
        if (!isFinite(v)) return;
        v = Math.max(8, Math.min(200, v));
        fsSlider.value = String(v);
        applyFontSize(v);
      });
      // Reflect the first selected text clip's current size on panel
      // entry so the slider isn't lying about the state.
      var tc = document.querySelector('.mt-clip.mt-clip-text.selected')
            || document.querySelector('.mt-track-text .mt-clip');
      if (tc && tc.dataset.fontSize){
        var cur = parseInt(tc.dataset.fontSize, 10);
        if (isFinite(cur)){ fsSlider.value = cur; fsNum.value = cur; }
      }
    }

    // ── Inline text color grid ─────────────────────────────────────
    var COLOR_SWATCHES = [
      '#ffffff', '#000000', '#ef4444', '#f59e0b',
      '#facc15', '#10b981', '#06b6d4', '#3b82f6',
      '#8b5cf6', '#ec4899', '#f97316', '#14b8a6',
      '#a855f7', '#64748b', '#78716c', '#92400e'
    ];
    var colorGrid = div.querySelector('#v10TextColorGrid');
    if (colorGrid){
      COLOR_SWATCHES.forEach(function(hex){
        var sw = document.createElement('button');
        sw.type = 'button';
        sw.style.cssText =
          'width:22px;height:22px;border-radius:4px;cursor:pointer;' +
          'background:' + hex + ';' +
          'border:1px solid rgba(255,255,255,0.15);padding:0';
        sw.title = hex;
        sw.addEventListener('click', function(e){
          e.preventDefault(); e.stopPropagation();
          var clips = getTargetTextClips();
          if (!clips.length){ toast('Add a text clip first'); return; }
          clips.forEach(function(c){ c.dataset.textColor = hex; });
          try { window.syncPreviewToPlayhead && window.syncPreviewToPlayhead(); } catch(_){}
          if (typeof window.pushTimelineHistory === 'function'){
            try { window.pushTimelineHistory(); } catch(_){}
          }
          toast('Text color: ' + hex + (clips.length > 1 ? ' \u00b7 ' + clips.length + ' clips' : ''));
        });
        colorGrid.appendChild(sw);
      });
    }

    // ── Inline speed slider + number ──────────────────────────────
    // Applies to every active (selected or under-playhead) clip via
    // the same multi-clip broadcast pattern as other edits.
    var spSlider = div.querySelector('#v10SpeedSlider');
    var spNum    = div.querySelector('#v10SpeedNum');
    function applySpeed(v){
      if (typeof window.getActiveClips !== 'function') return;
      var clips = window.getActiveClips();
      if (!clips || !clips.length) return;
      clips.forEach(function(c){
        if (c.classList.contains('mt-clip-text') || c.classList.contains('mt-clip-fx')) return;
        // Visually shorten (or lengthen) the clip width to match the
        // new playback rate. We don't cache a "base" width — we recover
        // the 1×-speed width from (currentWidth × currentSpeed) each
        // time, so the math is correct regardless of timeline zoom or
        // prior speed adjustments.
        var curW = parseFloat(c.style.width) || 0;
        var prevSpeed = parseFloat(c.dataset.speed) || 1;
        var oneXWidth = curW * prevSpeed;
        c.dataset.speed = String(v);
        var newW = oneXWidth / v;
        if (newW < 20) newW = 20; // keep clip visible
        c.style.width = newW + 'px';
        // Force a filmstrip/waveform re-render at the new width so the
        // preview reflects the new timeline footprint.
        try { if (typeof window.attachFilmstripOrWaveform === 'function') window.attachFilmstripOrWaveform(c); } catch(_){}
      });
      try { if (typeof window.updateTimelineInfo === 'function') window.updateTimelineInfo(); } catch(_){}
      try { window.syncPreviewToPlayhead && window.syncPreviewToPlayhead(); } catch(_){}
      if (typeof window.pushTimelineHistory === 'function'){
        try { window.pushTimelineHistory(); } catch(_){}
      }
    }
    if (spSlider && spNum){
      spSlider.addEventListener('input', function(){
        var v = parseInt(spSlider.value, 10) / 100;
        spNum.value = v.toFixed(2);
        applySpeed(v);
      });
      spNum.addEventListener('input', function(){
        var v = parseFloat(spNum.value);
        if (!isFinite(v) || v <= 0) return;
        v = Math.max(0.25, Math.min(4, v));
        spSlider.value = String(Math.round(v * 100));
        applySpeed(v);
      });
    }

    // Wire the Add Text / Add Title buttons (same as before).
    Array.from(div.querySelectorAll('[data-v10-action="add-text"],[data-v10-action="add-title"]'))
      .forEach(function(btn){
        var isTitle = btn.getAttribute('data-v10-action') === 'add-title';
        btn.addEventListener('click', function(e){
          e.preventDefault();
          e.stopPropagation();
          if (typeof window.openTextInputModal !== 'function'){ toast('Text tool not ready'); return; }
          window.openTextInputModal(function(text, opts){
            opts = opts || {};
            if (isTitle && !opts.fontSize) opts.fontSize = 84;
            if (isTitle && !opts.position) opts.position = 'top';
            if (typeof window.addTextClipToTimeline === 'function'){
              window.addTextClipToTimeline(text, opts);
            }
          });
        }, true);
      });

    wireRPToast(div);

    // ── Selection-driven gating of Clip Tools ────────────────────
    // Trim / Split / Crop + Speed slider are only meaningful on a V1
    // video clip. Grey them out until the user has one selected (or
    // the playhead sits over one). Observe the timeline's .selected
    // changes + playhead moves to flip enabled/disabled state.
    var clipToolsGroup = div.querySelector('[data-v10-clip-tools-group]');
    var speedInline   = div.querySelector('#v10SpeedSlider') && div.querySelector('#v10SpeedSlider').closest('.v10-rp-inline');
    var hintEl        = div.querySelector('#v10ClipToolsHint');
    function hasV1Target(){
      var sel = document.querySelector('.mt-track-video .mt-clip.selected');
      if (sel) return true;
      // Fallback: clip under playhead on V1
      var ph = document.getElementById('mtPlayhead');
      var phX = ph ? (parseFloat(ph.style.left) || 0) : 0;
      var v1Clips = document.querySelectorAll('.mt-track-video .mt-clip');
      for (var i = 0; i < v1Clips.length; i++){
        var c = v1Clips[i];
        var l = parseFloat(c.style.left)  || 0;
        var w = parseFloat(c.style.width) || 0;
        if (phX >= l && phX <= l + w) return true;
      }
      return false;
    }
    function updateClipToolsState(){
      var enabled = hasV1Target();
      [clipToolsGroup, speedInline].forEach(function(el){
        if (!el) return;
        el.style.opacity = enabled ? '' : '0.45';
        el.style.pointerEvents = enabled ? '' : 'none';
      });
      if (hintEl){
        hintEl.style.display = enabled ? 'none' : '';
      }
    }
    updateClipToolsState();
    // Watch timeline DOM for selection + playhead changes
    try {
      var ta = document.getElementById('mtTracksArea');
      if (ta){
        var mo = new MutationObserver(function(){
          updateClipToolsState();
        });
        mo.observe(ta, { subtree: true, childList: true, attributes: true,
          attributeFilter: ['class', 'style'] });
      }
    } catch(_){}

    return div;
  }

  // ── One-click denoise / normalize via server FFmpeg ─────────────
  // Takes a list of audio clip elements, POSTs each to
  // /video-editor/process-audio-clip, replaces clip.dataset.mediaUrl
  // with the returned processed file. Shows an indeterminate progress
  // bar while the fleet is processing.
  async function applyOneClickEnhancement(action, clips, btn){
    if (!clips || !clips.length){ toast('No audio clip selected'); return; }
    var pretty = action === 'denoise' ? 'Denoise' : 'Normalize';
    var bar = showInlineProgress(btn, 'Processing ' + pretty + '\u2026');
    try {
      for (var i = 0; i < clips.length; i++){
        var clip = clips[i];
        bar.setLabel('Processing ' + pretty + ' (' + (i+1) + '/' + clips.length + ')\u2026');
        var mediaUrl = clip.dataset.mediaUrl;
        if (!mediaUrl){ continue; }
        // Pre-upload blob URLs so the server can resolve them
        if (mediaUrl.indexOf('blob:') === 0){
          try {
            var blob = await (await fetch(mediaUrl)).blob();
            var fd = new FormData();
            fd.append('file', blob, (clip.dataset.fileName || 'clip') + '.bin');
            var upResp = await fetch('/video-editor/upload-blob', { method:'POST', body: fd, credentials:'same-origin' });
            var upData = await upResp.json();
            if (upResp.ok && upData.success){
              mediaUrl = upData.serveUrl;
              clip.dataset.mediaUrl = mediaUrl;
            }
          } catch (upErr){ console.warn('[enhance] blob upload failed', upErr); }
        }
        // Process via server
        try {
          var resp = await fetch('/video-editor/process-audio-clip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mediaUrl: mediaUrl, action: action })
          });
          var data = await resp.json();
          if (!resp.ok || !data.success){
            throw new Error((data && data.error) || (pretty + ' failed'));
          }
          clip.dataset.mediaUrl = data.serveUrl;
          // Re-render waveform at new URL
          try { if (typeof window.attachFilmstripOrWaveform === 'function') window.attachFilmstripOrWaveform(clip); } catch(_){}
        } catch (procErr){
          console.warn('[enhance]', procErr);
          toast(pretty + ' error: ' + (procErr.message || procErr));
        }
      }
      bar.complete();
      toast(pretty + ' applied \u2014 ' + clips.length + ' clip' + (clips.length === 1 ? '' : 's'));
      if (typeof window.pushTimelineHistory === 'function') window.pushTimelineHistory();
    } catch (err){
      bar.complete();
      toast(pretty + ' failed: ' + (err.message || err));
    }
  }

  // Small inline progress strip attached above a button. Used by the
  // one-click enhancement + voice-over recording. Returns
  // { setLabel, complete } for the caller to drive.
  function showInlineProgress(anchorBtn, label){
    var host = anchorBtn && anchorBtn.parentElement && anchorBtn.parentElement.parentElement;
    if (!host) return { setLabel: function(){}, complete: function(){} };
    var bar = document.createElement('div');
    bar.className = 'v10-inline-progress';
    bar.style.cssText =
      'margin:6px 0;padding:8px 10px;background:rgba(124,58,237,.12);' +
      'border:1px solid rgba(139,92,246,.4);border-radius:8px;' +
      'font-size:11px;color:#e2e0f0;display:flex;align-items:center;gap:8px';
    bar.innerHTML =
      '<span class="v10-spinner" style="width:12px;height:12px;border:2px solid rgba(167,139,250,.3);border-top-color:#a78bfa;border-radius:50%;animation:v10spin 0.7s linear infinite;flex-shrink:0"></span>' +
      '<span class="v10-ip-lbl">' + label + '</span>';
    // One-shot keyframes for the spinner
    if (!document.getElementById('v10SpinKF')){
      var s = document.createElement('style');
      s.id = 'v10SpinKF';
      s.textContent = '@keyframes v10spin { to { transform: rotate(360deg); } }';
      document.head.appendChild(s);
    }
    host.insertBefore(bar, host.firstChild);
    return {
      setLabel: function(t){ var el = bar.querySelector('.v10-ip-lbl'); if (el) el.textContent = t; },
      complete: function(){ try { bar.remove(); } catch(_){} }
    };
  }

  // ── Voice Over recording ────────────────────────────────────────
  var _voLive = null; // active recorder instance
  async function startVoiceOverRecording(btn){
    if (_voLive){
      // Second click stops the recording
      try { _voLive.stop(); } catch(_){}
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      toast('This browser does not support microphone access');
      return;
    }
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      var mime = ['audio/webm;codecs=opus','audio/webm','audio/mp4']
        .find(function(m){ return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m); });
      var rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      var chunks = [];
      rec.ondataavailable = function(e){ if (e.data && e.data.size) chunks.push(e.data); };
      // Visually flag the button as recording
      var origLabel = btn.innerHTML;
      btn.style.background = 'rgba(239,68,68,.85)';
      btn.style.color = '#fff';
      btn.innerHTML = '<span class="v10-rp-ic">\u23fa\ufe0f</span>Stop';
      rec.onstop = function(){
        btn.innerHTML = origLabel;
        btn.style.background = '';
        btn.style.color = '';
        try { stream.getTracks().forEach(function(t){ t.stop(); }); } catch(_){}
        _voLive = null;
        var blob = new Blob(chunks, { type: mime || 'audio/webm' });
        var url = URL.createObjectURL(blob);
        // Drop a clip onto A1 at the current playhead
        var ph = document.getElementById('mtPlayhead');
        var PX_PER_SEC = (typeof window.TIMELINE_PX_PER_SEC === 'number') ? window.TIMELINE_PX_PER_SEC : 10;
        var phX = ph ? (parseFloat(ph.style.left) || 0) : 0;
        // Duration estimation — use recorded time
        var recDurSec = rec._recDurSec || 3;
        if (typeof window.addClipToTimeline === 'function'){
          window.addClipToTimeline('voiceover.webm', 'aud', recDurSec, url);
          // addClipToTimeline places at the rightmost; move it to phX
          var audioTracks = document.querySelectorAll('.mt-track-audio');
          var newest = null;
          audioTracks.forEach(function(trk){
            var clips = trk.querySelectorAll('.mt-clip');
            if (clips.length) newest = clips[clips.length - 1];
          });
          if (newest){
            newest.style.left = phX + 'px';
          }
        }
        toast('Voice-over added at ' + (phX / PX_PER_SEC).toFixed(2) + 's');
      };
      _voLive = rec;
      var startTs = performance.now();
      rec.start(200);
      // Track duration
      var tick = setInterval(function(){
        if (!_voLive){ clearInterval(tick); return; }
        rec._recDurSec = (performance.now() - startTs) / 1000;
      }, 500);
    } catch (err){
      toast('Voice-over error: ' + (err.message || err));
    }
  }

  // ── Music upload (local files) ──────────────────────────────────
  function openMusicUpload(){
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function(){
      var f = input.files && input.files[0];
      if (f && typeof window.addClipToTimeline === 'function'){
        var url = URL.createObjectURL(f);
        // Estimate duration via an <audio> metadata load
        var a = new Audio();
        a.preload = 'metadata';
        a.src = url;
        a.addEventListener('loadedmetadata', function(){
          var dur = isFinite(a.duration) ? a.duration : 30;
          window.addClipToTimeline(f.name, 'aud', dur, url);
        }, { once: true });
        a.addEventListener('error', function(){
          window.addClipToTimeline(f.name, 'aud', 30, url);
        }, { once: true });
      }
      try { input.remove(); } catch(_){}
    });
    input.click();
  }

  function buildAudioContent(){
    var div = document.createElement('div');
    div.className = 'v10-rp-content';
    div.setAttribute('data-v10', 'rp-audio');
    function escAudio(s){
      return String(s).replace(/[&<>"']/g, function(c){
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
      });
    }
    function renderLayers(){
      var clips = Array.from(document.querySelectorAll('.mt-track-audio .mt-clip'));
      var vClips = Array.from(document.querySelectorAll('.mt-track-video .mt-clip'));
      var html = '<div class="v10-rp-section-title">AUDIO LAYERS</div>';
      if (!clips.length){
        html += '<div style="padding:12px 4px;color:#8886a0;font-size:12px;line-height:1.5">No audio clips on the timeline yet. Upload an audio file or click an audio item in the Media panel to add one.</div>';
      } else {
        clips.forEach(function(clip, i){
          var name  = clip.dataset.fileName || ('Audio ' + (i + 1));
          var vol   = parseFloat(clip.dataset.volume); if (!isFinite(vol)) vol = 100;
          var muted = clip.dataset.muted === 'true';
          var color = ['#06b6d4','#3b82f6','#8b5cf6','#ec4899','#22c55e'][i % 5];
          html +=
            '<div class="v10-audio-card" data-clip-idx="' + i + '">'+
              '<div class="v10-ac-head"><div class="v10-ac-dot" style="background:' + color + '"></div><h5>' + escAudio(name) + '</h5></div>'+
              '<div class="v10-ac-vol"><span>\ud83d\udd0a</span>'+
                '<input type="range" min="0" max="200" value="' + vol + '" class="v10-ac-volrange" style="flex:1;margin:0 6px;accent-color:' + color + '"/>'+
                '<span class="v10-ac-voltxt">' + Math.round(vol) + '%</span>'+
              '</div>'+
              '<div class="v10-ac-btns">'+
                // Solo and Fade hidden per product decision; Mute is the
                // only per-clip toggle in the card.
                '<button data-ac-action="mute"' + (muted ? ' style="background:rgba(239,68,68,.85);color:#fff"' : '') + '>' + (muted ? 'Unmute' : 'Mute') + '</button>'+
              '</div>'+
            '</div>';
        });
      }
      // VIDEO AUDIO — embedded audio from V1 clips. Each V1 video clip has
      // its own muxed audio track; the export pipeline already reads
      // clip.dataset.volume / muted for every .mt-clip regardless of track,
      // so we just expose the same controls here. Volume slider applies
      // live to the <video> element when the clip is currently loaded.
      if (vClips.length){
        html += '<div class="v10-rp-section-title" style="margin-top:14px">VIDEO AUDIO <span style="color:#8886a0;font-weight:400;margin-left:6px">(V1 embedded)</span></div>';
        vClips.forEach(function(clip, i){
          var name  = clip.dataset.fileName || ('Video ' + (i + 1));
          var vol   = parseFloat(clip.dataset.volume); if (!isFinite(vol)) vol = 100;
          var muted = clip.dataset.muted === 'true';
          var color = '#a78bfa'; // violet to distinguish from A1 cards
          html +=
            '<div class="v10-audio-card" data-video-idx="' + i + '">'+
              '<div class="v10-ac-head"><div class="v10-ac-dot" style="background:' + color + '"></div><h5>\ud83c\udfac ' + escAudio(name) + '</h5></div>'+
              '<div class="v10-ac-vol"><span>\ud83d\udd0a</span>'+
                '<input type="range" min="0" max="200" value="' + vol + '" class="v10-vc-volrange" style="flex:1;margin:0 6px;accent-color:' + color + '"/>'+
                '<span class="v10-vc-voltxt">' + Math.round(vol) + '%</span>'+
              '</div>'+
              '<div class="v10-ac-btns">'+
                '<button data-vc-action="mute"' + (muted ? ' style="background:rgba(239,68,68,.85);color:#fff"' : '') + '>' + (muted ? 'Unmute' : 'Mute') + '</button>'+
              '</div>'+
            '</div>';
        });
      }
      // AUDIO TOOLS — Voice Over + Music are placeholders (routed to toast
      // via wireRPToast); Denoise + Normalize toggle per-selected-audio-clip
      // dataset flags that bake into the export.
      function afxBtn(ic, label, fx){
        return '<button class="v10-rp-btn" data-audio-fx="' + fx + '"><span class="v10-rp-ic">' + ic + '</span>' + label + '</button>';
      }
      html +=
        '<div class="v10-rp-section-title" style="margin-top:14px">AUDIO TOOLS</div>'+
        '<div class="v10-rp-grid">'+
          '<button class="v10-rp-btn" data-v10-audio-tool="voiceover"><span class="v10-rp-ic">\ud83c\udfa4</span>Voice Over</button>'+
          '<button class="v10-rp-btn" data-v10-audio-tool="music-upload"><span class="v10-rp-ic">\ud83c\udfb5</span>Music</button>'+
          afxBtn('\ud83d\udd07', 'Denoise',   'denoise')+
          afxBtn('\ud83d\udcc8', 'Normalize', 'normalize')+
        '</div>'+
        '<div class="v10-rp-section-title">MIXING</div>'+
        // Inline fade sliders — replace the old prompt('Fade-in duration')
        // flow with a drag-to-set range (0-5s, 0.1s step). Applies to the
        // currently-targeted audio clip (selected > first on timeline).
        // The numeric readout updates live and the value is baked into
        // clip.dataset.fadeIn / fadeOut on 'input' so preview + export
        // pick it up immediately.
        (function(){
          // Read current values from the target audio clip, if any
          // #24 — Fade sliders read from any selected A1/V1 clip or the
          // first A1 clip (fallback) or first V1 clip (final fallback).
          var tgt =
            document.querySelector('.mt-track-audio .mt-clip.selected') ||
            document.querySelector('.mt-track-video .mt-clip.selected') ||
            document.querySelector('.mt-track-audio .mt-clip') ||
            document.querySelector('.mt-track-video .mt-clip');
          var curIn  = tgt ? (parseFloat(tgt.dataset.fadeIn)  || 0) : 0;
          var curOut = tgt ? (parseFloat(tgt.dataset.fadeOut) || 0) : 0;
          function fadeRow(lbl, fx, val, icon){
            return '<div style="padding:10px;background:rgba(255,255,255,.03);border:1px solid #2a2545;border-radius:8px;margin-bottom:6px">' +
              '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">' +
                '<span>' + icon + '</span>' +
                '<span style="font-size:11px;font-weight:500;flex:1">' + lbl + '</span>' +
                '<span class="v10-fade-val" data-fx="' + fx + '" style="font-size:11px;font-weight:600;color:#fde047;min-width:36px;text-align:right">' + val.toFixed(1) + 's</span>' +
              '</div>' +
              '<input type="range" min="0" max="5" step="0.1" value="' + val.toFixed(1) +
                '" data-audio-fx-slider="' + fx + '" style="width:100%;accent-color:#a78bfa"/>' +
            '</div>';
          }
          return fadeRow('Fade In',  'fadein',  curIn,  '\ud83c\udfda\ufe0f') +
                 fadeRow('Fade Out', 'fadeout', curOut, '\ud83c\udf05');
        })() +
        '<div class="v10-rp-grid" style="margin-top:4px">'+
          '<button class="v10-rp-btn" data-audio-mix="link"><span class="v10-rp-ic">\ud83d\udd17</span>Link Audio</button>'+
          '<button class="v10-rp-btn" data-audio-mix="split"><span class="v10-rp-ic">\u2702\ufe0f</span>Split Audio</button>'+
        '</div>';
      div.innerHTML = html;

      Array.from(div.querySelectorAll('.v10-audio-card')).forEach(function(card){
        var idx = parseInt(card.getAttribute('data-clip-idx'), 10);
        var clip = document.querySelectorAll('.mt-track-audio .mt-clip')[idx];
        if (!clip) return;
        var range = card.querySelector('.v10-ac-volrange');
        var label = card.querySelector('.v10-ac-voltxt');
        // Reach into the live <audio> element for this URL so volume /
        // mute changes take effect IMMEDIATELY (not just on next play).
        //
        // Task #28 — Uploaded local audio files get stored in the
        // _a1AudioEls URL-keyed cache in media-panel-fix.js. The cache
        // lookup via window.__v10GetA1Audio() is 100% reliable because
        // it uses the same URL string the caller stored. The old
        // CSS.escape-based querySelector was unreliable for blob: URLs
        // (browser normalizes them) and its `|| querySelector('[data-v10-a1]')`
        // fallback returned an ARBITRARY audio element, silently applying
        // volume changes to the wrong clip.
        function getLiveAudio(){
          var url = clip.dataset.mediaUrl;
          if (!url) return null;
          if (typeof window.__v10GetA1Audio === 'function'){
            var hit = window.__v10GetA1Audio(url);
            if (hit) return hit;
          }
          // Secondary: exact src match on audio elements (only as a safety
          // net for clips created before the cache existed).
          try {
            var bySrc = document.querySelector('audio[data-v10-a1][src="' + CSS.escape(url) + '"]');
            if (bySrc) return bySrc;
          } catch(_){}
          return null; // no ambiguous fallback — don't touch random clips
        }
        if (range){
          range.addEventListener('input', function(){
            var v = parseInt(range.value, 10);
            clip.dataset.volume = String(v);
            if (label) label.textContent = v + '%';
            // Apply to the currently-playing audio element (if any)
            var live = getLiveAudio();
            if (live){ live.volume = Math.min(1, Math.max(0, v / 100)); }
            // Task #30 — envelope viz scales with volume
            if (typeof window.refreshClipFadeOverlay === 'function'){
              try { window.refreshClipFadeOverlay(clip); } catch(_){}
            }
          });
        }
        Array.from(card.querySelectorAll('[data-ac-action]')).forEach(function(btn){
          btn.addEventListener('click', function(e){
            e.preventDefault();
            var act = btn.getAttribute('data-ac-action');
            if (act === 'mute'){
              var wasMuted = clip.dataset.muted === 'true';
              var nowMuted = !wasMuted;
              clip.dataset.muted = nowMuted ? 'true' : 'false';
              btn.textContent = nowMuted ? 'Unmute' : 'Mute';
              btn.style.background = nowMuted ? 'rgba(239,68,68,.85)' : '';
              btn.style.color      = nowMuted ? '#fff' : '';
              // Kill / restore the signal on the live <audio> element
              var live = getLiveAudio();
              if (live){
                live.muted = nowMuted;
                if (nowMuted){ try { live.pause(); } catch(_){} }
              }
              toast((nowMuted ? 'Muted' : 'Unmuted') + ': ' + (clip.dataset.fileName || 'clip'));
              if (typeof window.refreshClipFadeOverlay === 'function'){
                try { window.refreshClipFadeOverlay(clip); } catch(_){}
              }
            } else if (act === 'solo'){
              // Select this clip so clipActionSolo operates on it
              document.querySelectorAll('.mt-clip.selected').forEach(function(c){ c.classList.remove('selected'); });
              clip.classList.add('selected');
              if (typeof window.clipActionSolo === 'function') window.clipActionSolo();
              setTimeout(renderLayers, 50); // re-render card states
            } else if (act === 'fade'){
              toast('Fade — drag the slider to taper volume');
            }
          });
        });
      });

      // VIDEO AUDIO cards — wire volume/mute for embedded V1 audio. The
      // dataset writes are always authoritative for export; the live
      // <video> element is updated only when the card's clip is the one
      // currently loaded in the Program Monitor.
      function getVideoPlayer(){
        return document.getElementById('videoPlayer') || document.querySelector('video');
      }
      function normalizeUrlLocal(u){
        if (!u) return '';
        try { return new URL(u, window.location.href).href; } catch(_){ return String(u); }
      }
      function isClipLoaded(clip){
        var p = getVideoPlayer();
        if (!p || !clip) return false;
        var src = p.currentSrc || p.src;
        return !!src && normalizeUrlLocal(src) === normalizeUrlLocal(clip.dataset.mediaUrl || '');
      }
      Array.from(div.querySelectorAll('[data-video-idx]')).forEach(function(card){
        var idx = parseInt(card.getAttribute('data-video-idx'), 10);
        var clip = document.querySelectorAll('.mt-track-video .mt-clip')[idx];
        if (!clip) return;
        var range = card.querySelector('.v10-vc-volrange');
        var label = card.querySelector('.v10-vc-voltxt');
        if (range){
          range.addEventListener('input', function(){
            var v = parseInt(range.value, 10);
            clip.dataset.volume = String(v);
            if (label) label.textContent = v + '%';
            if (isClipLoaded(clip)){
              var p = getVideoPlayer();
              if (p) p.volume = Math.min(1, Math.max(0, v / 100));
            }
          });
          range.addEventListener('change', function(){
            if (typeof window.pushTimelineHistory === 'function') window.pushTimelineHistory();
          });
        }
        Array.from(card.querySelectorAll('[data-vc-action]')).forEach(function(btn){
          btn.addEventListener('click', function(e){
            e.preventDefault();
            var act = btn.getAttribute('data-vc-action');
            if (act === 'mute'){
              var wasMuted = clip.dataset.muted === 'true';
              var nowMuted = !wasMuted;
              clip.dataset.muted = nowMuted ? 'true' : 'false';
              btn.textContent = nowMuted ? 'Unmute' : 'Mute';
              btn.style.background = nowMuted ? 'rgba(239,68,68,.85)' : '';
              btn.style.color      = nowMuted ? '#fff' : '';
              if (isClipLoaded(clip)){
                var p = getVideoPlayer();
                if (p) p.muted = nowMuted;
              }
              toast((nowMuted ? 'Muted' : 'Unmuted') + ': ' + (clip.dataset.fileName || 'clip'));
              if (typeof window.pushTimelineHistory === 'function') window.pushTimelineHistory();
            }
          });
        });
      });

      // Hook the <video> element so whenever it swaps to a new V1 clip's
      // src (via loadAndPlayClipAt) it picks up that clip's saved
      // dataset.volume / muted state. Installed once per page.
      (function installV1AudioHydrator(){
        var p = getVideoPlayer();
        if (!p || p.__v1AudioHooked) return;
        p.__v1AudioHooked = true;
        function hydrate(){
          var src = p.currentSrc || p.src;
          if (!src) return;
          var norm = normalizeUrlLocal(src);
          var vcs = document.querySelectorAll('.mt-track-video .mt-clip');
          for (var i = 0; i < vcs.length; i++){
            var c = vcs[i];
            if (normalizeUrlLocal(c.dataset.mediaUrl || '') === norm){
              var vol = parseFloat(c.dataset.volume);
              if (isFinite(vol)) p.volume = Math.min(1, Math.max(0, vol / 100));
              p.muted = (c.dataset.muted === 'true');
              return;
            }
          }
        }
        p.addEventListener('loadedmetadata', hydrate);
        p.addEventListener('play', hydrate);
      })();

      // AUDIO FX handlers — operate on the currently selected audio clip,
      // or fall back to the first audio clip on A1. Wired BEFORE wireRPToast
      // (capture phase) so the generic toast handler doesn't fire first.
      // Task #24 — Audio FX scope extends to V1 video clips too. Denoise,
      // Normalize, Fade In, Fade Out, Link/Split all accept any .mt-clip
      // that carries embedded audio (V1) or dedicated audio (A1). Priority
      // for target resolution:
      //   1. Any SELECTED audio-or-video clips on the timeline
      //   2. If none selected: the first A1 clip (legacy default)
      //   3. If no A1 clips at all: the first V1 clip
      function getTargetAudioClip(){
        var selAny = document.querySelector('.mt-track-audio .mt-clip.selected, .mt-track-video .mt-clip.selected');
        if (selAny) return selAny;
        var firstA1 = document.querySelector('.mt-track-audio .mt-clip');
        if (firstA1) return firstA1;
        return document.querySelector('.mt-track-video .mt-clip') || null;
      }
      function getAudioFXTargets(){
        // Every selected clip on EITHER audio or video tracks counts as
        // an audio FX target. Broadcast-style: one prompt, applies to all.
        var selAny = Array.from(document.querySelectorAll(
          '.mt-track-audio .mt-clip.selected, .mt-track-video .mt-clip.selected'
        ));
        if (selAny.length) return selAny;
        var one = getTargetAudioClip();
        return one ? [one] : [];
      }
      Array.from(div.querySelectorAll('[data-audio-fx]')).forEach(function(btn){
        btn.addEventListener('click', function(e){
          e.preventDefault();
          e.stopPropagation();
          var fx = btn.getAttribute('data-audio-fx');
          var targets = getAudioFXTargets();
          if (!targets.length){
            toast('No audio clip on timeline');
            return;
          }
          if (fx === 'denoise' || fx === 'normalize'){
            // One-click: actually PROCESS the audio now (not just a
            // flag for export). Uses /video-editor/process-audio-clip
            // which runs afftdn / loudnorm and returns a new URL. Swap
            // the clip's mediaUrl on success so the preview + export
            // both pick up the processed file.
            applyOneClickEnhancement(fx, targets, btn);
            return;
          }
          if (typeof window.pushTimelineHistory === 'function') window.pushTimelineHistory();
        }, true);
      });

      // FADE SLIDERS — live drag sets clip.dataset.fadeIn / fadeOut on each
      // 'input' event and updates the numeric readout. Multi-clip: broadcast
      // the same value across all selected audio clips (or first-A1 fallback).
      // 'change' at the end pushes a single history snapshot.
      Array.from(div.querySelectorAll('[data-audio-fx-slider]')).forEach(function(slider){
        var fx = slider.getAttribute('data-audio-fx-slider'); // fadein | fadeout
        var readout = div.querySelector('.v10-fade-val[data-fx="' + fx + '"]');
        function apply(live){
          var v = parseFloat(slider.value);
          if (!isFinite(v) || v < 0) v = 0;
          var targets = getAudioFXTargets();
          targets.forEach(function(c){
            if (fx === 'fadein'){
              if (v === 0) delete c.dataset.fadeIn;
              else c.dataset.fadeIn = String(v);
            } else {
              if (v === 0) delete c.dataset.fadeOut;
              else c.dataset.fadeOut = String(v);
            }
            // Task #30 — refresh the volume-envelope visualization on
            // each target clip (A1 or V1) so the ramp line updates live.
            if (typeof window.refreshClipFadeOverlay === 'function'){
              try { window.refreshClipFadeOverlay(c); } catch(_){}
            }
          });
          if (readout) readout.textContent = v.toFixed(1) + 's';
        }
        slider.addEventListener('input', function(){ apply(true); });
        slider.addEventListener('change', function(){
          apply(false);
          if (typeof window.pushTimelineHistory === 'function') window.pushTimelineHistory();
        });
      });

      // LINK / SPLIT AUDIO — Link tags every selected audio clip with a shared
      // audioGroup id so operations (fade, volume, mute) can broadcast across
      // them in the future; Split clears the group tag. Visual marker is a
      // cyan ring on grouped clips (added via CSS class below).
      Array.from(div.querySelectorAll('[data-audio-mix]')).forEach(function(btn){
        btn.addEventListener('click', function(e){
          e.preventDefault();
          e.stopPropagation();
          var mode = btn.getAttribute('data-audio-mix');
          var sel = Array.from(document.querySelectorAll('.mt-track-audio .mt-clip.selected'));
          if (mode === 'link'){
            if (sel.length < 2){
              toast('Select 2+ audio clips to link (Shift-click on timeline)');
              return;
            }
            var gid = 'ag_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e4).toString(36);
            sel.forEach(function(c){
              c.dataset.audioGroup = gid;
              c.classList.add('audio-linked');
            });
            toast('Linked ' + sel.length + ' audio clips');
          } else if (mode === 'split'){
            // Split: clear audioGroup on selected clips (or all if none selected)
            var targets = sel.length ? sel : Array.from(document.querySelectorAll('.mt-track-audio .mt-clip[data-audio-group]'));
            if (!targets.length){
              toast('No linked audio clips to split');
              return;
            }
            targets.forEach(function(c){
              delete c.dataset.audioGroup;
              c.classList.remove('audio-linked');
            });
            toast('Split ' + targets.length + ' audio clip' + (targets.length === 1 ? '' : 's'));
          }
          if (typeof window.pushTimelineHistory === 'function') window.pushTimelineHistory();
        }, true);
      });

      // Voice Over + Music Upload handlers
      Array.from(div.querySelectorAll('[data-v10-audio-tool]')).forEach(function(btn){
        btn.addEventListener('click', function(e){
          e.preventDefault(); e.stopPropagation();
          var tool = btn.getAttribute('data-v10-audio-tool');
          if (tool === 'voiceover'){
            startVoiceOverRecording(btn);
          } else if (tool === 'music-upload'){
            openMusicUpload();
          }
        }, true);
      });

      wireRPToast(div);
      // Task #30 — repaint the volume-envelope overlay on every A1/V1
      // clip so existing fades are visible when the panel renders.
      if (typeof window.refreshAllFadeOverlays === 'function'){
        try { window.refreshAllFadeOverlays(); } catch(_){}
      }
    }
    renderLayers();

    // Re-render when the timeline's clips change, OR when selection
    // flips (Task #23). Without the attribute watch, selecting an A1
    // clip wouldn't retarget the MIXING fade sliders + Link/Split /
    // V1 embedded-audio cards — they'd stay bound to whichever clip
    // was first in DOM, making the controls feel unresponsive.
    var timer = null;
    var mo = new MutationObserver(function(mutations){
      // Ignore mutations caused by our own re-render of div.innerHTML
      // (which the outer tracksArea observer doesn't see anyway), but
      // also debounce bursty selection drags.
      if (timer) clearTimeout(timer);
      timer = setTimeout(renderLayers, 120);
    });
    var ta = document.getElementById('mtTracksArea');
    if (ta){
      mo.observe(ta, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'data-muted', 'data-volume']
      });
    }
    return div;
  }

  function buildAITabContent(){
    var div = document.createElement('div');
    div.className = 'v10-rp-content';
    div.setAttribute('data-v10', 'rp-ai');
    // Each button maps to a dedicated tool URL (existing full-page routes
    // in the app). 'route' = URL to open in a new tab. A few don't have
    // dedicated pages yet — those get a helpful toast.
    var aiTools = [
      { g:'AI GENERATION', ic:'\u2728',        label:'Enhance Audio', route:'/enhance-speech' },
      { g:'AI GENERATION', ic:'\ud83d\udcac',  label:'Captions',      route:'/ai-captions' },
      { g:'AI GENERATION', ic:'\ud83c\udfa3',  label:'AI Hook',       route:'/ai-hook' },
      { g:'AI GENERATION', ic:'\ud83c\udfa8',  label:'Brand Kit',     route:'/brand-kits' },
      // Transcript removed (Task #36) — redundant with Captions
      { g:'AI ANALYSIS',   ic:'\ud83c\udfac',  label:'B-Roll',        route:'/ai-broll' },
      { g:'AI ANALYSIS',   ic:'\u2702',        label:'Smart Cut',     route:'#smart-cut' },
      { g:'AI ANALYSIS',   ic:'\ud83d\udd0d',  label:'Scene Detect',  route:'#scene-detect' },
      // Tasks #50-#53 — AI Creative tools wired to real inline modals
      { g:'AI CREATIVE',   ic:'\ud83e\ude84',  label:'Style Transfer',route:'#style-transfer' },
      { g:'AI CREATIVE',   ic:'\ud83d\uddbc',  label:'BG Remove',     route:'#bg-remove' },
      { g:'AI CREATIVE',   ic:'\ud83c\udfa4',  label:'AI Voice',      route:'#ai-voice' },
      { g:'AI CREATIVE',   ic:'\ud83c\udf10',  label:'Translate',     route:'#translate' }
    ];
    var html = '';
    var lastGroup = '';
    aiTools.forEach(function(t, i){
      if (t.g !== lastGroup){
        if (lastGroup) html += '</div>';
        html += '<div class="v10-rp-section-title"' +
          (i === 0 ? '' : ' style="margin-top:14px"') + '>' + t.g + '</div>' +
          '<div class="v10-rp-grid">';
        lastGroup = t.g;
      }
      html += '<button class="v10-rp-btn" data-v10-ai-route="' + (t.route || '') + '" data-v10-ai-label="' + t.label + '"><span class="v10-rp-ic">' + t.ic + '</span>' + t.label + '</button>';
    });
    html += '</div>';
    div.innerHTML = html;

    // AI wiring:
    //   Enhance / Captions — DIRECT inline actions (no navigation at all)
    //     • Enhance: runs afftdn+highpass+EQ on the selected clip's audio,
    //                drops the cleaned-up audio onto A1 as a new clip
    //     • Captions: transcribes the active video with Whisper and drops
    //                 phrase-chunked text clips onto T1 at matching times
    //   AI Hook / Brand Kit — still iframe-modal (those tools need a UI)
    //   AI ANALYSIS / AI CREATIVE — new tab if route, toast otherwise
    // Task #31 — AI Hook runs inline (no new window). Timeline content is
    // summarized, TTS + title-card video rendered server-side, and the
    // resulting clip is inserted at the START of V1 (shifting existing
    // clips right by the hook's duration).
    var DIRECT_ACTIONS = { 'Enhance Audio': 'enhance', 'Captions': 'captions', 'AI Hook': 'aihook' };
    var MODAL_LABELS   = { 'Brand Kit': 1 };
    // Labels that trigger inline modals built into v10-editor-redesign.js
    // (no new tab, no iframe).
    var INLINE_MODAL_LABELS = {
      'B-Roll': 1, 'Smart Cut': 1, 'Scene Detect': 1,
      // Tasks #50-#53 — AI Creative tools
      'AI Voice': 1, 'Translate': 1, 'BG Remove': 1, 'Style Transfer': 1
    };
    // Actions that require a selected clip with a server-side mediaUrl.
    // AI Voice is the exception — user types text, no clip needed.
    var REQUIRES_CLIP = {
      'Enhance Audio': 1, 'Captions': 1, 'AI Hook': 1, 'B-Roll': 1,
      'Smart Cut': 1, 'Scene Detect': 1,
      'Translate': 1, 'BG Remove': 1, 'Style Transfer': 1
    };

    // Task #33 — Gate clip-dependent AI buttons. Disables + dims them
    // whenever there's no clip selected / on the timeline. Re-evaluates
    // on every timeline mutation + selection change.
    function updateAIButtonStates(){
      var hasSelectedVideo = !!document.querySelector('.mt-track-video .mt-clip.selected');
      var hasAnyVideo      = !!document.querySelector('.mt-track-video .mt-clip');
      Array.from(div.querySelectorAll('[data-v10-ai-label]')).forEach(function(b){
        var lbl = b.getAttribute('data-v10-ai-label');
        if (!REQUIRES_CLIP[lbl]) return;
        // AI Hook can run with an empty timeline (summary falls back).
        // Enhance Audio, Captions, B-Roll all need a real clip.
        var needsSelection = (lbl !== 'AI Hook');
        var ok = needsSelection ? (hasSelectedVideo || hasAnyVideo) : true;
        // Prefer SELECTED, but allow any V1 as long as something exists.
        // If absolutely nothing on V1, keep it disabled.
        if (!hasAnyVideo) ok = (lbl === 'AI Hook');
        b.disabled = !ok;
        b.style.opacity = ok ? '' : '0.45';
        b.style.cursor  = ok ? '' : 'not-allowed';
        b.title = ok ? '' : 'Select a V1 clip first';
      });
    }
    // Kick off an initial pass + watch the tracks for changes
    updateAIButtonStates();
    try {
      var ta = document.getElementById('mtTracksArea');
      if (ta && !ta.__v10AIBtnObs){
        ta.__v10AIBtnObs = new MutationObserver(function(){
          updateAIButtonStates();
        });
        ta.__v10AIBtnObs.observe(ta, {
          subtree: true, childList: true,
          attributes: true, attributeFilter: ['class', 'data-media-url']
        });
      }
    } catch(_){}

    Array.from(div.querySelectorAll('[data-v10-ai-route]')).forEach(function(btn){
      btn.addEventListener('click', function(e){
        // Task #33 — aggressive event containment so no downstream or
        // same-target handler can trigger a navigation side-effect.
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function'){
          try { e.stopImmediatePropagation(); } catch(_){}
        }
        if (btn.disabled){
          toast('Select a V1 clip on the timeline first');
          return;
        }
        var route = btn.getAttribute('data-v10-ai-route');
        var label = btn.getAttribute('data-v10-ai-label');
        if (DIRECT_ACTIONS[label]){
          // Pre-flight validation: require a real clip with a server-side
          // mediaUrl (no blob:) for enhance / captions / aihook. This
          // prevents the 400-from-server fallback path that Albert saw
          // trigger a redirect on newly-added clips.
          if (label !== 'AI Hook'){
            var probe = pickSourceClipForAI(DIRECT_ACTIONS[label]);
            if (!probe){
              toast('Add a V1 video clip to the timeline first');
              return;
            }
            var mu = probe.dataset.mediaUrl || '';
            if (!mu){
              toast('This clip has no server media yet \u2014 wait for upload to finish');
              return;
            }
            if (mu.indexOf('blob:') === 0){
              toast('Upload this file via the sidebar first, then try again');
              return;
            }
          }
          runInlineAIAction(DIRECT_ACTIONS[label], btn);
          return;
        }
        if (!route){
          toast(label + ' \u2014 not available yet');
          return;
        }
        if (MODAL_LABELS[label]){
          openAIToolModal(label, route);
        } else if (INLINE_MODAL_LABELS[label]){
          // Tasks #37-#39, #50-#53 — inline modals (no new tab, no iframe)
          if (label === 'B-Roll'){
            if (typeof openBRollModal === 'function') openBRollModal(btn);
          } else if (label === 'Smart Cut'){
            if (typeof openSmartCutModal === 'function') openSmartCutModal();
          } else if (label === 'Scene Detect'){
            var tgt = pickSourceClipForAI('scene');
            if (!tgt){ toast('Select a V1 clip first'); return; }
            if (typeof runSmartCut === 'function'){
              runSmartCut(tgt, 'silence', 1.0, /* splitOnly */ true);
            }
          } else if (label === 'AI Voice'){
            if (typeof openAIVoiceModal === 'function') openAIVoiceModal();
          } else if (label === 'Translate'){
            if (typeof openTranslateModal === 'function') openTranslateModal();
          } else if (label === 'BG Remove'){
            if (typeof openBGRemoveModal === 'function') openBGRemoveModal();
          } else if (label === 'Style Transfer'){
            if (typeof openStyleTransferModal === 'function') openStyleTransferModal();
          }
        } else {
          try { window.open(route, '_blank'); } catch(_){ location.href = route; }
          toast('Opening ' + label + ' \u2026');
        }
      }, true);
    });
    return div;
  }

  // ── Direct inline AI actions ──────────────────────────────────────
  // Picks the right clip for the action, POSTs to the inline endpoint,
  // integrates the result back into the timeline.
  function pickSourceClipForAI(action){
    // Prefer selected clip if it has a media URL
    var sel = document.querySelector('.mt-clip.selected');
    if (sel && sel.dataset.mediaUrl && sel.dataset.clipType !== 'text' && sel.dataset.clipType !== 'motion'){
      return sel;
    }
    // Otherwise prefer clip under playhead on V1
    var ph = document.getElementById('mtPlayhead');
    var phX = ph ? (parseFloat(ph.style.left) || 0) : 0;
    var v1Clips = Array.from(document.querySelectorAll('.mt-track-video .mt-clip'));
    for (var i = 0; i < v1Clips.length; i++){
      var c = v1Clips[i];
      var l = parseFloat(c.style.left) || 0;
      var w = parseFloat(c.style.width) || 0;
      if (phX >= l && phX <= l + w && c.dataset.mediaUrl) return c;
    }
    // Fallback: first V1 clip with media URL
    var first = v1Clips.find(function(c){ return !!c.dataset.mediaUrl; });
    if (first) return first;
    // Final fallback for Enhance: first A1 clip
    if (action === 'enhance'){
      var a1 = document.querySelector('.mt-track-audio .mt-clip');
      if (a1 && a1.dataset.mediaUrl) return a1;
    }
    return null;
  }

  function setAIButtonLoading(btn, loading, labelOverride){
    if (!btn) return;
    if (loading){
      btn.dataset.v10AiBusy = '1';
      btn.dataset.v10AiLabel = btn.innerHTML;
      btn.disabled = true;
      btn.style.opacity = '0.7';
      btn.innerHTML = '<span class="v10-rp-ic">\u23f3</span>' + (labelOverride || 'Working\u2026');
    } else {
      btn.disabled = false;
      btn.style.opacity = '';
      if (btn.dataset.v10AiLabel){
        btn.innerHTML = btn.dataset.v10AiLabel;
        delete btn.dataset.v10AiLabel;
      }
      delete btn.dataset.v10AiBusy;
    }
  }

  async function runInlineAIAction(action, btn){
    if (btn && btn.dataset.v10AiBusy === '1') return;  // re-entrancy guard

    var clip = pickSourceClipForAI(action);
    if (!clip){
      toast('Add a video clip to the timeline first');
      return;
    }
    var mediaUrl = clip.dataset.mediaUrl;
    if (!mediaUrl){
      toast('This clip has no server-side media to process');
      return;
    }
    if (mediaUrl.indexOf('blob:') === 0){
      toast('Upload this file via the sidebar first, then try again');
      return;
    }

    if (action === 'enhance'){
      setAIButtonLoading(btn, true, 'Enhancing\u2026');
      toast('Enhancing audio\u2026');
      try {
        var resp = await fetch('/video-editor/ai-enhance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mediaUrl: mediaUrl, noiseLevel: '2', voiceBoost: true })
        });
        var data = await resp.json();
        if (!resp.ok || !data.success){
          throw new Error(data.error || 'Enhance failed');
        }
        // Preferred path: server re-muxed the enhanced audio back into
        // the source video. Swap the V1 clip's mediaUrl in place so the
        // same clip now plays with the cleaned audio. No new A1 clip.
        if (data.enhancedVideoUrl){
          var oldUrl = clip.dataset.mediaUrl;
          clip.dataset.mediaUrl = data.enhancedVideoUrl;
          clip.dataset.audioEnhanced = 'true';
          clip.dataset.serverFilename = (data.enhancedVideoUrl.split('/').pop() || '');

          // If this clip is currently loaded in the Program Monitor, swap
          // the <video> element's src and resume at the same time offset.
          var player = document.getElementById('videoPlayer') || document.querySelector('video');
          if (player && oldUrl){
            var curSrc = player.currentSrc || player.src || '';
            if (curSrc.indexOf(oldUrl.split('?')[0].split('/').pop()) !== -1){
              var t = player.currentTime;
              var wasPlaying = !player.paused;
              player.src = data.enhancedVideoUrl;
              player.load();
              player.addEventListener('loadedmetadata', function once(){
                player.removeEventListener('loadedmetadata', once);
                try { player.currentTime = t; } catch(_){}
                if (wasPlaying){ try { player.play(); } catch(_){} }
              }, { once: true });
            }
          }

          // Refresh the filmstrip from the new URL (frames are visually
          // identical but the URL-keyed cache needs re-seeding).
          if (typeof window.buildClipFilmstrip === 'function'){
            // Remove old filmstrip + label first
            var oldFS = clip.querySelector('.v10-filmstrip');
            var oldLb = clip.querySelector('.v10-fs-label');
            if (oldFS) oldFS.remove();
            if (oldLb) oldLb.remove();
            try {
              window.buildClipFilmstrip(clip, data.enhancedVideoUrl,
                parseFloat(clip.dataset.duration) || parseFloat(clip.dataset.srcDuration) || 0);
            } catch(_){}
          }
          if (typeof window.pushTimelineHistory === 'function') window.pushTimelineHistory();
          toast('\u2728 Audio enhanced \u2014 original clip updated');
        } else {
          // Fallback: server couldn't re-mux (e.g., source is audio-only
          // or ffmpeg copy failed). Drop the cleaned audio on A1 so the
          // user still gets the enhancement.
          if (typeof window.addClipToTimeline === 'function'){
            window.addClipToTimeline(data.filename || 'Enhanced audio', 'aud', data.duration || 0, data.enhancedUrl);
            toast('Enhanced audio added to A1 (couldn\u2019t re-mux into video)');
          } else {
            toast('Enhanced audio saved: ' + data.filename);
          }
        }
      } catch (err){
        toast('Enhance error: ' + (err.message || err));
      } finally {
        setAIButtonLoading(btn, false);
      }
      return;
    }

    if (action === 'captions'){
      setAIButtonLoading(btn, true, 'Transcribing\u2026');
      toast('Transcribing video\u2026 (this can take a moment)');
      try {
        var respC = await fetch('/video-editor/ai-captions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mediaUrl: mediaUrl })
        });
        var dataC = await respC.json();
        if (!respC.ok || !dataC.success){
          throw new Error(dataC.error || 'Transcription failed');
        }
        var chunks = Array.isArray(dataC.chunks) ? dataC.chunks : [];
        if (chunks.length === 0){
          toast('No speech detected in this clip');
          return;
        }
        // Anchor captions to the V1 clip's left edge on the timeline so
        // the text's timeline-t matches the clip's playback time.
        //
        // Task #22 — Proper sync math:
        //   Whisper timestamps are seconds from the start of the AUDIO
        //   the server extracted (full source file, not trimmed). If the
        //   clip is trimmed (sourceOffset > 0), captions whose ch.start
        //   lands before sourceOffset are out of view and those after
        //   must be shifted left by sourceOffset.
        //
        //   Plus: window.__captionLeadSec is a developer-tunable lead
        //   (in seconds) that nudges all captions earlier. Defaults to 0
        //   since the server-side FFmpeg fix (-avoid_negative_ts make_zero
        //   + aresample first_pts=0) should eliminate the systemic 2s lag
        //   on most containers. Can be set live from the console.
        var clipLeftPx = parseFloat(clip.style.left) || 0;
        var clipWidthPx= parseFloat(clip.style.width) || 0;
        var clipRightPx= clipLeftPx + clipWidthPx;  // T1 must not extend past this (#34)
        var PX_PER_SEC = (typeof window.TIMELINE_PX_PER_SEC === 'number') ? window.TIMELINE_PX_PER_SEC : 10;
        var sourceOffset = parseFloat(clip.dataset.sourceOffset) || 0;
        // Task #42 — Default captions 0.2s earlier than Whisper says to
        // compensate for the remaining transcription drift. User can
        // override via window.__captionLeadSec from the console.
        var leadSec = parseFloat(window.__captionLeadSec);
        if (!isFinite(leadSec)) leadSec = 0.2;
        var added = 0, truncated = 0, droppedPastEnd = 0;
        chunks.forEach(function(ch){
          if (!ch.text || !isFinite(ch.start) || !isFinite(ch.end)) return;
          // Shift by sourceOffset and subtract the lead. Drop chunks that
          // now land before the clip's left edge (pre-trim speech).
          var adjStart = ch.start - sourceOffset - leadSec;
          var adjEnd   = ch.end   - sourceOffset - leadSec;
          if (adjEnd <= 0) return;
          if (adjStart < 0) adjStart = 0;
          var leftPx  = clipLeftPx + Math.round(adjStart * PX_PER_SEC);
          var widthPx = Math.max(20, Math.round((adjEnd - adjStart) * PX_PER_SEC));
          // Task #34 — T1 must never extend past V1's right edge. Drop
          // captions that start past the clip, and truncate widths for
          // captions that span the end boundary.
          if (leftPx >= clipRightPx){ droppedPastEnd++; return; }
          if (leftPx + widthPx > clipRightPx){
            widthPx = Math.max(20, clipRightPx - leftPx);
            truncated++;
          }
          if (typeof window.addTextClipToTimeline === 'function'){
            window.addTextClipToTimeline(ch.text, {
              left:  leftPx + 'px',
              width: widthPx + 'px',
              fontSize: 48,
              textColor: '#ffffff',
              position: 'bottom'
            });
            added++;
          }
        });
        if (droppedPastEnd){
          console.log('[ai-captions] ' + droppedPastEnd + ' caption(s) dropped (past V1 end)');
        }
        if (truncated){
          console.log('[ai-captions] ' + truncated + ' caption(s) truncated at V1 end');
        }
        toast('Captions added: ' + added + ' phrase' + (added === 1 ? '' : 's'));
      } catch (err){
        toast('Captions error: ' + (err.message || err));
      } finally {
        setAIButtonLoading(btn, false);
      }
      return;
    }

    // ─── Task #31: AI Hook inline pipeline ──────────────────────────
    // 1. Summarize timeline content (T1 captions + V1 filenames + duration)
    // 2. Show BLOCKING progress modal (+ beforeunload guard)
    // 3. POST /ai-hook/generate → returns {hookText, audioUrl}
    // 4. POST /ai-hook/compose-clip → returns {mediaUrl, duration}
    // 5. Shift all V1 clips right by hook duration (in px)
    // 6. Insert hook clip at the start of V1
    if (action === 'aihook'){
      var hookBusy = showBlockingProgressModal('AI Hook', [
        'Reading timeline\u2026',
        'Writing hook text\u2026',
        'Generating voiceover\u2026',
        'Rendering clip\u2026',
        'Inserting into V1\u2026'
      ]);
      var beforeUnload = function(e){ e.preventDefault(); e.returnValue = ''; return ''; };
      window.addEventListener('beforeunload', beforeUnload);
      try {
        hookBusy.advance(0);
        // Summarize timeline: concatenate T1 captions + V1 filenames
        var t1Texts = Array.from(document.querySelectorAll('.mt-track-text .mt-clip'))
          .map(function(c){ return (c.dataset.textContent || '').trim(); })
          .filter(Boolean);
        var v1Clips = Array.from(document.querySelectorAll('.mt-track-video .mt-clip'));
        var v1Names = v1Clips.map(function(c){ return c.dataset.fileName || ''; }).filter(Boolean);
        var summary = (t1Texts.join(' ') || v1Names.join(', ') || 'video content')
          .slice(0, 1000);

        hookBusy.advance(1);
        var gFd = new FormData();
        gFd.append('inputType', 'text');
        gFd.append('transcript', summary);
        gFd.append('style', 'bold');
        gFd.append('voice', 'free_alloy');
        gFd.append('platform', 'youtube');
        var genR = await fetch('/ai-hook/generate', { method: 'POST', body: gFd });
        var genD = await genR.json();
        if (!genR.ok) throw new Error(genD.error || 'Hook generation failed');

        hookBusy.advance(2); // voiceover in progress on server (already included in /generate)
        hookBusy.advance(3);
        // Task #35 — Match hook resolution to the FIRST V1 clip's native
        // video dimensions so the hook composites cleanly with no
        // letterbox / scale mismatch. Priority:
        //   1) <video> element's videoWidth/Height (if first V1 clip
        //      has been loaded in the Program Monitor at least once)
        //   2) window.__exportWidth/__exportHeight (from Smart Resize)
        //   3) 1280×720 fallback
        var W, H;
        var firstV1 = v1Clips[0];
        var mainVid = document.getElementById('videoPlayer') || document.querySelector('video');
        if (mainVid && mainVid.videoWidth && mainVid.videoHeight){
          W = mainVid.videoWidth;
          H = mainVid.videoHeight;
        } else if (firstV1 && firstV1.dataset.srcWidth && firstV1.dataset.srcHeight){
          W = parseInt(firstV1.dataset.srcWidth,  10);
          H = parseInt(firstV1.dataset.srcHeight, 10);
        } else if (window.__exportWidth && window.__exportHeight){
          W = window.__exportWidth;
          H = window.__exportHeight;
        } else {
          W = 1280; H = 720;
        }
        // Clamp to something reasonable + keep even dims (H.264 requirement)
        W = Math.max(320, Math.min(3840, W));
        H = Math.max(240, Math.min(2160, H));
        if (W % 2) W += 1;
        if (H % 2) H += 1;
        var compR = await fetch('/ai-hook/compose-clip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hookText: genD.hookText,
            audioUrl: genD.audioUrl,
            width: W, height: H,
            // Task #41 — forward the cinematic spec
            impactWords:    genD.impactWords    || [],
            sfx:            genD.sfx            || 'whoosh',
            visualStyle:    genD.visualStyle    || 'cinematic_warm',
            cameraMovement: genD.cameraMovement || 'fast_zoom_in'
          })
        });
        var compD = await compR.json();
        if (!compR.ok || !compD.success) throw new Error(compD.error || 'Hook compose failed');

        hookBusy.advance(4);
        // Task #44 — Shift EVERY timeline clip right by the hook's
        // duration so the user's V1 + A1 + T1 + M1 + FX assets all
        // stay aligned with each other. The new hook clip gets left=0
        // on V1 and nothing else is buried.
        var PPS = (typeof window.TIMELINE_PX_PER_SEC === 'number') ? window.TIMELINE_PX_PER_SEC : 10;
        var shiftPx = Math.round(compD.duration * PPS);
        Array.from(document.querySelectorAll('.mt-clip')).forEach(function(c){
          var l = parseFloat(c.style.left) || 0;
          c.style.left = (l + shiftPx) + 'px';
        });

        // Insert the hook clip at V1 left=0. addClipToTimeline appends to
        // the rightmost end — we need to force left=0 and re-add instead.
        // Simplest: use a direct DOM create that matches addClipToTimeline's
        // output schema, then call makeClipInteractive if exposed.
        var track = document.querySelector('.mt-track-video');
        if (track){
          var hookClip = document.createElement('div');
          hookClip.className = 'mt-clip mt-clip-video';
          hookClip.style.position = 'absolute';
          hookClip.style.left  = '0px';
          hookClip.style.width = shiftPx + 'px';
          hookClip.style.top   = '3px';
          hookClip.dataset.fileName = 'AI Hook';
          hookClip.dataset.clipType = 'vid';
          hookClip.dataset.mediaUrl = compD.mediaUrl;
          hookClip.dataset.duration = String(compD.duration);
          hookClip.dataset.sourceOffset = '0';
          hookClip.dataset.srcDuration = String(compD.duration);
          hookClip.dataset.aiHook = '1';
          // Task #49 — creation-order stamp
          hookClip.dataset.addedAt = String(Date.now() * 1000);
          hookClip.style.zIndex = '950';
          hookClip.style.background = 'linear-gradient(135deg, #7c3aed, #6d28d9)';
          hookClip.style.color = '#fff';
          hookClip.style.overflow = 'hidden';
          track.appendChild(hookClip);
          // Build a filmstrip for the hook clip
          if (typeof window.buildClipFilmstrip === 'function'){
            try { window.buildClipFilmstrip(hookClip, compD.mediaUrl, compD.duration); } catch(_){}
          }
          if (typeof window.pushTimelineHistory === 'function') window.pushTimelineHistory();
        }

        hookBusy.finish('Hook inserted \u2014 "' + (genD.hookText || '').slice(0, 48) + '\u2026"');
      } catch (err){
        hookBusy.fail(err.message || String(err));
      } finally {
        window.removeEventListener('beforeunload', beforeUnload);
        setAIButtonLoading(btn, false);
      }
      return;
    }
  }

  // Task #31 — Blocking progress modal for long-running AI ops.
  // Renders a non-dismissible overlay with a step list + spinner.
  // advance(i) lights up step i, finish(msg)/fail(msg) close the modal.
  // ═════════════════════════════════════════════════════════════════
  // Task #37 — B-Roll inline modal (Stock search + AI-Generated).
  // Opens a modal with two tabs:
  //   • "Stock"     — user types a query, server searches Pixabay, grid
  //                   of previewable clips shown. Click to insert.
  //   • "AI Search" — server runs Whisper on the selected V1 clip, picks
  //                   top keywords, auto-searches Pixabay with them.
  // Selected clip gets downloaded server-side to the editor's upload dir,
  // then added as a NEW V1 clip positioned after the currently-selected
  // clip (shifting all following clips right to make room).
  // ═════════════════════════════════════════════════════════════════
  function openBRollModal(triggerBtn){
    var existing = document.getElementById('v10BRollModal');
    if (existing instanceof Element){ try { existing.remove(); } catch(_){} }

    var target = pickSourceClipForAI('broll');
    if (!target){
      toast('Add a V1 video clip to the timeline first');
      return;
    }

    var bk = document.createElement('div');
    bk.id = 'v10BRollModal';
    bk.style.cssText = 'position:fixed;inset:0;z-index:99998;' +
      'background:rgba(8,6,18,.75);display:flex;align-items:center;' +
      'justify-content:center;backdrop-filter:blur(4px)';

    var panel = document.createElement('div');
    panel.style.cssText = 'background:#0c0814;border:1px solid rgba(124,58,237,.35);' +
      'border-radius:14px;width:min(760px,95vw);height:min(640px,88vh);' +
      'display:flex;flex-direction:column;box-shadow:0 30px 80px rgba(0,0,0,.6);' +
      'overflow:hidden;color:#e2e0f0;font-family:system-ui,sans-serif';

    panel.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;padding:14px 20px;' +
        'background:linear-gradient(90deg,rgba(124,58,237,.18),rgba(236,72,153,.08));' +
        'border-bottom:1px solid rgba(124,58,237,.28)">' +
        '<span style="font-size:18px">\ud83c\udfac</span>' +
        '<span style="font-weight:600;font-size:14px">B-Roll Library</span>' +
        '<span style="flex:1"></span>' +
        '<button id="broClose" style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);' +
          'border-radius:6px;color:#e2e0f0;padding:5px 10px;font-size:12px;cursor:pointer">Close</button>' +
      '</div>' +
      '<div style="display:flex;gap:4px;padding:10px 16px 0">' +
        '<button class="broTab on" data-bro-tab="stock" style="flex:none;padding:8px 16px;background:rgba(139,92,246,.25);border:1px solid rgba(139,92,246,.5);border-radius:6px 6px 0 0;color:#fff;font-size:12px;font-weight:600;cursor:pointer">\ud83d\udd0d Stock</button>' +
        '<button class="broTab"    data-bro-tab="ai"    style="flex:none;padding:8px 16px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:6px 6px 0 0;color:#a78bfa;font-size:12px;font-weight:600;cursor:pointer">\u2728 AI Search</button>' +
      '</div>' +
      '<div style="padding:0 16px 10px;border-bottom:1px solid rgba(124,58,237,.2);display:flex;gap:8px">' +
        '<input id="broQuery" type="text" placeholder="Search stock footage\u2026" ' +
          'style="flex:1;padding:8px 12px;background:#160f2a;border:1px solid rgba(124,58,237,.3);' +
          'border-radius:6px;color:#e2e0f0;font-size:13px;outline:none"/>' +
        '<button id="broGo" style="padding:8px 16px;background:linear-gradient(135deg,#7c3aed,#a855f7);' +
          'border:none;border-radius:6px;color:#fff;font-size:12px;font-weight:600;cursor:pointer">Search</button>' +
      '</div>' +
      '<div id="broGrid" style="flex:1;overflow-y:auto;padding:14px 16px;' +
        'display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px">' +
        '<div style="grid-column:1/-1;color:#5c5a70;font-size:12px;text-align:center;padding:40px 0">' +
          'Type a search term (e.g. \u201cocean sunset\u201d) and hit Search, or switch to AI Search to auto-pick from your clip.' +
        '</div>' +
      '</div>';

    bk.appendChild(panel);
    document.body.appendChild(bk);

    bk.addEventListener('click', function(e){ if (e.target === bk) bk.remove(); });
    panel.querySelector('#broClose').addEventListener('click', function(){ bk.remove(); });
    var grid = panel.querySelector('#broGrid');
    var query = panel.querySelector('#broQuery');
    var goBtn = panel.querySelector('#broGo');

    function renderLoading(msg){
      grid.innerHTML = '<div style="grid-column:1/-1;color:#a78bfa;font-size:12px;text-align:center;padding:40px 0">' +
        '<span style="display:inline-block;width:14px;height:14px;border:2px solid #a78bfa;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;margin-right:8px;vertical-align:middle"></span>' +
        (msg || 'Searching\u2026') +
      '</div>';
    }
    function renderError(msg){
      grid.innerHTML = '<div style="grid-column:1/-1;color:#ef4444;font-size:12px;text-align:center;padding:40px 20px">' + msg + '</div>';
    }
    function renderResults(results){
      if (!results.length){
        renderError('No results. Try a different search term.');
        return;
      }
      grid.innerHTML = results.map(function(r){
        var thumb = r.thumbnailUrl || '';
        var preview = r.previewUrl || '';
        var dur = r.duration ? Math.round(r.duration) + 's' : '';
        return '<div class="broCard" data-download="' + encodeURIComponent(r.downloadUrl) + '" ' +
            'data-name="' + (r.name || 'broll').replace(/"/g, '') + '" ' +
            'data-duration="' + (r.duration || 0) + '" ' +
            'style="background:#160f2a;border:1px solid rgba(124,58,237,.2);border-radius:8px;overflow:hidden;cursor:pointer;transition:transform .15s,border-color .15s;position:relative">' +
          '<div style="aspect-ratio:16/10;background:#0a0815;position:relative;overflow:hidden">' +
            (preview
              ? '<video src="' + preview + '" muted loop playsinline preload="metadata" style="width:100%;height:100%;object-fit:cover" onmouseenter="this.play()" onmouseleave="this.pause()"></video>'
              : ('<img src="' + thumb + '" style="width:100%;height:100%;object-fit:cover"/>')
            ) +
            (dur ? '<span style="position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,.7);color:#fff;font-size:10px;padding:2px 6px;border-radius:3px">' + dur + '</span>' : '') +
          '</div>' +
          '<div style="padding:6px 8px;font-size:11px;color:#e2e0f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
            (r.name || 'B-Roll') +
          '</div>' +
        '</div>';
      }).join('');
      Array.from(grid.querySelectorAll('.broCard')).forEach(function(card){
        card.addEventListener('click', function(){ pickBRoll(card, target, bk); });
        card.addEventListener('mouseenter', function(){ card.style.borderColor = '#a78bfa'; card.style.transform = 'translateY(-2px)'; });
        card.addEventListener('mouseleave', function(){ card.style.borderColor = ''; card.style.transform = ''; });
      });
    }

    async function doSearch(q){
      if (!q || !q.trim()){ toast('Enter a search term'); return; }
      renderLoading('Searching Pixabay\u2026');
      try {
        var r = await fetch('/ai-broll/search-inline', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q })
        });
        var d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Search failed');
        renderResults(d.results || []);
      } catch (err){ renderError(err.message || 'Search error'); }
    }

    goBtn.addEventListener('click', function(){ doSearch(query.value); });
    query.addEventListener('keydown', function(e){ if (e.key === 'Enter') doSearch(query.value); });
    setTimeout(function(){ query.focus(); }, 50);

    // AI Search tab — runs Whisper on the selected clip to get keywords
    Array.from(panel.querySelectorAll('.broTab')).forEach(function(t){
      t.addEventListener('click', async function(){
        Array.from(panel.querySelectorAll('.broTab')).forEach(function(o){
          o.classList.remove('on');
          o.style.background = 'rgba(255,255,255,.05)';
          o.style.borderColor = 'rgba(255,255,255,.1)';
          o.style.color = '#a78bfa';
        });
        t.classList.add('on');
        t.style.background = 'rgba(139,92,246,.25)';
        t.style.borderColor = 'rgba(139,92,246,.5)';
        t.style.color = '#fff';
        var kind = t.getAttribute('data-bro-tab');
        if (kind === 'ai'){
          renderLoading('Analyzing your clip\u2026');
          try {
            var cR = await fetch('/video-editor/ai-captions', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mediaUrl: target.dataset.mediaUrl })
            });
            var cD = await cR.json();
            if (!cR.ok) throw new Error(cD.error || 'Analysis failed');
            var text = (cD.chunks || []).map(function(c){ return c.text; }).join(' ');
            // Trivial keyword extraction: unique words > 4 chars, drop stopwords
            var STOP = /^(the|and|that|with|this|have|from|they|your|been|will|about|would|could|should|which|there|their)$/i;
            var words = text.toLowerCase().match(/[a-z]{5,}/g) || [];
            var uniq = [];
            for (var w of words){
              if (STOP.test(w)) continue;
              if (uniq.indexOf(w) === -1) uniq.push(w);
              if (uniq.length >= 3) break;
            }
            var q = uniq.join(' ') || 'abstract background';
            query.value = q;
            await doSearch(q);
          } catch (err){ renderError('AI search: ' + err.message); }
        }
      });
    });
  }

  async function pickBRoll(card, targetClip, modalEl){
    var url = decodeURIComponent(card.getAttribute('data-download') || '');
    var name = card.getAttribute('data-name') || 'broll';
    var dur  = parseFloat(card.getAttribute('data-duration')) || 0;
    if (!url){ toast('This clip has no downloadable URL'); return; }
    card.style.opacity = '0.5';
    card.style.pointerEvents = 'none';
    var spinner = document.createElement('div');
    spinner.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);font-size:11px;color:#fff';
    spinner.textContent = 'Downloading\u2026';
    card.appendChild(spinner);
    try {
      var r = await fetch('/ai-broll/download-inline', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: url, name: name })
      });
      var d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || 'Download failed');
      // Insert the b-roll clip into V1 AFTER the currently-selected target.
      // Shift any V1 clips that follow, so we don't overlap.
      var PPS = (typeof window.TIMELINE_PX_PER_SEC === 'number') ? window.TIMELINE_PX_PER_SEC : 10;
      var insertDur = parseFloat(d.duration) || dur || 5;
      var insertWidthPx = Math.max(60, Math.round(insertDur * PPS));
      var targetLeft = parseFloat(targetClip.style.left) || 0;
      var targetWidth= parseFloat(targetClip.style.width) || 0;
      var insertLeftPx = targetLeft + targetWidth;

      // Shift any V1 clips at or after insertLeftPx rightward
      Array.from(document.querySelectorAll('.mt-track-video .mt-clip')).forEach(function(c){
        var l = parseFloat(c.style.left) || 0;
        if (l >= insertLeftPx){ c.style.left = (l + insertWidthPx) + 'px'; }
      });

      // Build the new clip inline (matching addClipToTimeline's schema)
      var v1Track = document.querySelector('.mt-track-video');
      var nc = document.createElement('div');
      nc.className = 'mt-clip mt-clip-video';
      nc.style.position = 'absolute';
      nc.style.left  = insertLeftPx + 'px';
      nc.style.width = insertWidthPx + 'px';
      nc.style.top   = '3px';
      nc.dataset.fileName = '\ud83c\udfac ' + name;
      nc.dataset.clipType = 'vid';
      nc.dataset.mediaUrl = d.mediaUrl;
      nc.dataset.duration = String(insertDur);
      nc.dataset.sourceOffset = '0';
      nc.dataset.srcDuration = String(insertDur);
      nc.dataset.broll = '1';
      // Task #49 — latest clip wins overlap, so b-rolls layer on top
      nc.dataset.addedAt = String(Date.now() * 1000);
      nc.style.zIndex = '900';
      nc.style.background = 'linear-gradient(135deg,#06b6d4,#0ea5e9)';
      nc.style.color = '#fff';
      nc.style.overflow = 'hidden';
      v1Track.appendChild(nc);
      if (typeof window.buildClipFilmstrip === 'function'){
        try { window.buildClipFilmstrip(nc, d.mediaUrl, insertDur); } catch(_){}
      }
      if (typeof window.pushTimelineHistory === 'function') window.pushTimelineHistory();
      toast('B-Roll added: ' + name + ' (' + insertDur.toFixed(1) + 's)');
      if (modalEl && modalEl.isConnected) modalEl.remove();
    } catch (err){
      spinner.textContent = 'Error';
      card.style.opacity = '';
      card.style.pointerEvents = '';
      setTimeout(function(){ spinner.remove(); }, 1800);
      toast('B-Roll error: ' + err.message);
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // Task #50 — AI Voice inline modal
  // User types text, picks a voice, adjusts speed, server synthesizes
  // the voiceover via OpenAI TTS and the resulting MP3 is dropped on A1
  // at the playhead (or appended after the current A1 end if playhead
  // is past the current A1 content).
  // ═════════════════════════════════════════════════════════════════
  function openAIVoiceModal(){
    var existing = document.getElementById('v10AiVoiceModal');
    if (existing instanceof Element){ try { existing.remove(); } catch(_){} }

    var bk = document.createElement('div');
    bk.id = 'v10AiVoiceModal';
    bk.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(8,6,18,.75);' +
      'display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
    var panel = document.createElement('div');
    panel.style.cssText = 'background:#1a1230;border:1px solid rgba(124,58,237,.4);border-radius:12px;' +
      'padding:18px;width:min(480px,92vw);color:#e2e0f0;font-family:system-ui,sans-serif';
    panel.innerHTML =
      '<div style="font-size:13px;font-weight:700;color:#fde047;margin-bottom:6px">\ud83c\udfa4 AI VOICE</div>' +
      '<div style="font-size:11px;color:#8886a0;margin-bottom:12px">Type text \u2014 OpenAI TTS synthesizes a natural voiceover and drops it on A1.</div>' +
      '<textarea id="avText" rows="5" placeholder="Enter text for the voiceover\u2026" ' +
        'style="width:100%;padding:10px;background:#0c0814;border:1px solid rgba(124,58,237,.3);' +
        'border-radius:6px;color:#e2e0f0;font-size:13px;font-family:inherit;outline:none;resize:vertical;box-sizing:border-box"></textarea>' +
      '<div style="font-size:10px;color:#a78bfa;font-weight:600;margin:10px 0 4px">VOICE</div>' +
      '<div id="avVoices" style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px"></div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:11px">' +
        '<span style="color:#8886a0;flex:none">Speed</span>' +
        '<input id="avSpeed" type="range" min="0.5" max="2" step="0.05" value="1" style="flex:1;accent-color:#a78bfa"/>' +
        '<span id="avSpeedVal" style="color:#fde047;font-weight:600;min-width:40px;text-align:right">1.00x</span>' +
      '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">' +
        '<button id="avCancel" style="padding:8px 14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:6px;color:#e2e0f0;font-size:12px;cursor:pointer">Cancel</button>' +
        '<button id="avRun"    style="padding:8px 18px;background:linear-gradient(135deg,#7c3aed,#a855f7);border:none;border-radius:6px;color:#fff;font-size:12px;font-weight:600;cursor:pointer">Generate \u2192</button>' +
      '</div>';
    bk.appendChild(panel);
    document.body.appendChild(bk);

    var VOICES = [
      { id:'alloy',   label:'Alloy',   desc:'Balanced, neutral' },
      { id:'echo',    label:'Echo',    desc:'Warm, friendly' },
      { id:'fable',   label:'Fable',   desc:'British, narrative' },
      { id:'onyx',    label:'Onyx',    desc:'Deep, authoritative' },
      { id:'nova',    label:'Nova',    desc:'Bright, expressive' },
      { id:'shimmer', label:'Shimmer', desc:'Soft, gentle' }
    ];
    var selectedVoice = 'alloy';
    var voiceGrid = panel.querySelector('#avVoices');
    VOICES.forEach(function(v){
      var b = document.createElement('button');
      b.dataset.voice = v.id;
      b.style.cssText = 'padding:8px 6px;background:' + (v.id === selectedVoice ? 'rgba(139,92,246,.25)' : 'rgba(255,255,255,.04)') +
        ';border:1px solid ' + (v.id === selectedVoice ? '#a78bfa' : 'rgba(255,255,255,.1)') +
        ';border-radius:6px;color:#e2e0f0;font-size:10px;cursor:pointer;text-align:center';
      b.innerHTML = '<b style="font-size:11px">' + v.label + '</b><br><span style="color:#8886a0;font-size:9px">' + v.desc + '</span>';
      b.addEventListener('click', function(){
        selectedVoice = v.id;
        Array.from(voiceGrid.querySelectorAll('button')).forEach(function(o){
          var on = o.dataset.voice === selectedVoice;
          o.style.background  = on ? 'rgba(139,92,246,.25)' : 'rgba(255,255,255,.04)';
          o.style.borderColor = on ? '#a78bfa' : 'rgba(255,255,255,.1)';
        });
      });
      voiceGrid.appendChild(b);
    });

    var speed = panel.querySelector('#avSpeed');
    var speedVal = panel.querySelector('#avSpeedVal');
    speed.addEventListener('input', function(){ speedVal.textContent = parseFloat(speed.value).toFixed(2) + 'x'; });
    panel.querySelector('#avCancel').addEventListener('click', function(){ bk.remove(); });
    bk.addEventListener('click', function(e){ if (e.target === bk) bk.remove(); });
    setTimeout(function(){ panel.querySelector('#avText').focus(); }, 50);

    panel.querySelector('#avRun').addEventListener('click', async function(){
      var text = panel.querySelector('#avText').value.trim();
      if (!text){ toast('Enter some text first'); return; }
      var sp = parseFloat(speed.value) || 1;
      bk.remove();
      var prog = showBlockingProgressModal('AI Voice', ['Synthesizing voice\u2026', 'Adding to A1\u2026']);
      var beforeUnload = function(e){ e.preventDefault(); e.returnValue = ''; return ''; };
      window.addEventListener('beforeunload', beforeUnload);
      try {
        prog.advance(0);
        var r = await fetch('/video-editor/ai-voice', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text, voice: selectedVoice, speed: sp })
        });
        var d = await r.json();
        if (!r.ok || !d.success) throw new Error(d.error || 'TTS failed');
        prog.advance(1);
        if (typeof window.addClipToTimeline === 'function'){
          window.addClipToTimeline('AI Voice (' + selectedVoice + ')', 'aud', d.duration, d.mediaUrl);
        }
        prog.finish('Voiceover added (' + d.duration.toFixed(1) + 's)');
      } catch (err){ prog.fail(err.message || String(err)); }
      finally { window.removeEventListener('beforeunload', beforeUnload); }
    });
  }

  // ═════════════════════════════════════════════════════════════════
  // Task #51 — Translate modal
  // Whispers the selected V1 clip, translates each caption phrase into
  // the target language, drops the translated phrases onto T1 at the
  // matching timestamps (same positioning logic as Captions).
  // ═════════════════════════════════════════════════════════════════
  function openTranslateModal(){
    var existing = document.getElementById('v10TranslateModal');
    if (existing instanceof Element){ try { existing.remove(); } catch(_){} }
    var target = pickSourceClipForAI('translate');
    if (!target || !target.dataset.mediaUrl || target.dataset.mediaUrl.indexOf('blob:') === 0){
      toast('Select a V1 clip with a server-uploaded source first');
      return;
    }

    var bk = document.createElement('div');
    bk.id = 'v10TranslateModal';
    bk.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(8,6,18,.75);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
    var panel = document.createElement('div');
    panel.style.cssText = 'background:#1a1230;border:1px solid rgba(124,58,237,.4);border-radius:12px;padding:18px;width:min(480px,92vw);color:#e2e0f0;font-family:system-ui,sans-serif';

    var LANGS = [
      ['es','\ud83c\uddea\ud83c\uddf8 Spanish'], ['fr','\ud83c\uddeb\ud83c\uddf7 French'],
      ['de','\ud83c\udde9\ud83c\uddea German'],  ['pt','\ud83c\uddf5\ud83c\uddf9 Portuguese'],
      ['it','\ud83c\uddee\ud83c\uddf9 Italian'], ['nl','\ud83c\uddf3\ud83c\uddf1 Dutch'],
      ['pl','\ud83c\uddf5\ud83c\uddf1 Polish'],  ['ru','\ud83c\uddf7\ud83c\uddfa Russian'],
      ['tr','\ud83c\uddf9\ud83c\uddf7 Turkish'], ['ar','\ud83c\uddf8\ud83c\udde6 Arabic'],
      ['hi','\ud83c\uddee\ud83c\uddf3 Hindi'],   ['vi','\ud83c\uddfb\ud83c\uddf3 Vietnamese'],
      ['id','\ud83c\uddee\ud83c\udde9 Indonesian'], ['ja','\ud83c\uddef\ud83c\uddf5 Japanese'],
      ['ko','\ud83c\uddf0\ud83c\uddf7 Korean'],  ['zh','\ud83c\udde8\ud83c\uddf3 Chinese (Simplified)']
    ];
    panel.innerHTML =
      '<div style="font-size:13px;font-weight:700;color:#fde047;margin-bottom:6px">\ud83c\udf10 TRANSLATE CAPTIONS</div>' +
      '<div style="font-size:11px;color:#8886a0;margin-bottom:12px">Transcribes the selected V1 clip, translates each phrase, drops translated captions onto T1.</div>' +
      '<div style="font-size:10px;color:#a78bfa;font-weight:600;margin-bottom:4px">TARGET LANGUAGE</div>' +
      '<div id="trLangs" style="display:grid;grid-template-columns:repeat(2,1fr);gap:4px;max-height:220px;overflow-y:auto"></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">' +
        '<button id="trCancel" style="padding:8px 14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:6px;color:#e2e0f0;font-size:12px;cursor:pointer">Cancel</button>' +
        '<button id="trRun"    style="padding:8px 18px;background:linear-gradient(135deg,#7c3aed,#a855f7);border:none;border-radius:6px;color:#fff;font-size:12px;font-weight:600;cursor:pointer" disabled>Translate \u2192</button>' +
      '</div>';
    bk.appendChild(panel);
    document.body.appendChild(bk);
    var selectedLang = null;
    var grid = panel.querySelector('#trLangs');
    LANGS.forEach(function(pair){
      var code = pair[0], label = pair[1];
      var b = document.createElement('button');
      b.dataset.code = code;
      b.style.cssText = 'padding:8px 10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:6px;color:#e2e0f0;font-size:11px;text-align:left;cursor:pointer';
      b.textContent = label;
      b.addEventListener('click', function(){
        selectedLang = code;
        Array.from(grid.querySelectorAll('button')).forEach(function(o){
          var on = o.dataset.code === code;
          o.style.background  = on ? 'rgba(139,92,246,.25)' : 'rgba(255,255,255,.04)';
          o.style.borderColor = on ? '#a78bfa' : 'rgba(255,255,255,.1)';
        });
        panel.querySelector('#trRun').disabled = false;
        panel.querySelector('#trRun').style.opacity = '1';
      });
      grid.appendChild(b);
    });
    panel.querySelector('#trCancel').addEventListener('click', function(){ bk.remove(); });
    bk.addEventListener('click', function(e){ if (e.target === bk) bk.remove(); });

    panel.querySelector('#trRun').addEventListener('click', async function(){
      if (!selectedLang){ toast('Pick a language first'); return; }
      bk.remove();
      var prog = showBlockingProgressModal('Translate', [
        'Transcribing audio\u2026', 'Translating phrases\u2026', 'Placing T1 captions\u2026'
      ]);
      var beforeUnload = function(e){ e.preventDefault(); e.returnValue = ''; return ''; };
      window.addEventListener('beforeunload', beforeUnload);
      try {
        prog.advance(0);
        var r = await fetch('/video-editor/translate-captions', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mediaUrl: target.dataset.mediaUrl, targetLang: selectedLang })
        });
        var d = await r.json();
        if (!r.ok || !d.success) throw new Error(d.error || 'Translate failed');
        prog.advance(1);
        prog.advance(2);
        if (!d.chunks || !d.chunks.length){
          prog.finish('No speech detected in this clip.');
          return;
        }
        var clipLeftPx = parseFloat(target.style.left) || 0;
        var clipWidthPx= parseFloat(target.style.width) || 0;
        var clipRightPx= clipLeftPx + clipWidthPx;
        var PPS = (typeof window.TIMELINE_PX_PER_SEC === 'number') ? window.TIMELINE_PX_PER_SEC : 10;
        var srcOff = parseFloat(target.dataset.sourceOffset) || 0;
        var leadSec = parseFloat(window.__captionLeadSec); if (!isFinite(leadSec)) leadSec = 0.2;
        var added = 0;
        d.chunks.forEach(function(ch){
          if (!ch.text || !isFinite(ch.start) || !isFinite(ch.end)) return;
          var adjS = ch.start - srcOff - leadSec;
          var adjE = ch.end   - srcOff - leadSec;
          if (adjE <= 0) return;
          if (adjS < 0) adjS = 0;
          var leftPx = clipLeftPx + Math.round(adjS * PPS);
          var widthPx = Math.max(20, Math.round((adjE - adjS) * PPS));
          if (leftPx >= clipRightPx) return;
          if (leftPx + widthPx > clipRightPx) widthPx = Math.max(20, clipRightPx - leftPx);
          if (typeof window.addTextClipToTimeline === 'function'){
            window.addTextClipToTimeline(ch.text, {
              left: leftPx + 'px', width: widthPx + 'px',
              fontSize: 48, textColor: '#ffffff', position: 'bottom'
            });
            added++;
          }
        });
        prog.finish('Added ' + added + ' ' + (d.languageName || selectedLang) + ' caption' + (added === 1 ? '' : 's'));
      } catch (err){ prog.fail(err.message || String(err)); }
      finally { window.removeEventListener('beforeunload', beforeUnload); }
    });
  }

  // ═════════════════════════════════════════════════════════════════
  // Task #52 — BG Remove modal
  // Chroma-key via FFmpeg colorkey. Server swaps the V1 clip's mediaUrl
  // in place (same pattern as Enhance Audio).
  // ═════════════════════════════════════════════════════════════════
  function openBGRemoveModal(){
    var existing = document.getElementById('v10BGRemoveModal');
    if (existing instanceof Element){ try { existing.remove(); } catch(_){} }
    var target = pickSourceClipForAI('bgremove');
    if (!target || !target.dataset.mediaUrl || target.dataset.mediaUrl.indexOf('blob:') === 0){
      toast('Select a V1 clip with a server-uploaded source first');
      return;
    }
    var bk = document.createElement('div');
    bk.id = 'v10BGRemoveModal';
    bk.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(8,6,18,.75);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
    var panel = document.createElement('div');
    panel.style.cssText = 'background:#1a1230;border:1px solid rgba(124,58,237,.4);border-radius:12px;padding:18px;width:min(480px,92vw);color:#e2e0f0;font-family:system-ui,sans-serif';
    panel.innerHTML =
      '<div style="font-size:13px;font-weight:700;color:#fde047;margin-bottom:6px">\ud83d\uddbc\ufe0f BACKGROUND REMOVAL</div>' +
      '<div style="font-size:11px;color:#8886a0;margin-bottom:12px">Chroma-key your footage \u2014 picks a background color and replaces it with a solid fill. Best for green/blue-screen or uniform backgrounds.</div>' +
      '<div style="font-size:10px;color:#a78bfa;font-weight:600;margin-bottom:4px">BACKGROUND COLOR</div>' +
      '<div id="bgPresets" style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-bottom:10px"></div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:11px">' +
        '<span style="color:#8886a0;flex:none;min-width:82px">Similarity</span>' +
        '<input id="bgSim" type="range" min="0.05" max="0.5" step="0.01" value="0.25" style="flex:1;accent-color:#a78bfa"/>' +
        '<span id="bgSimVal" style="color:#fde047;font-weight:600;min-width:48px;text-align:right">0.25</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:11px">' +
        '<span style="color:#8886a0;flex:none;min-width:82px">Edge blend</span>' +
        '<input id="bgBlend" type="range" min="0" max="0.3" step="0.01" value="0.10" style="flex:1;accent-color:#a78bfa"/>' +
        '<span id="bgBlendVal" style="color:#fde047;font-weight:600;min-width:48px;text-align:right">0.10</span>' +
      '</div>' +
      '<div style="font-size:10px;color:#a78bfa;font-weight:600;margin-bottom:4px">REPLACE WITH</div>' +
      '<div id="bgReplace" style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-bottom:4px"></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">' +
        '<button id="bgCancel" style="padding:8px 14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:6px;color:#e2e0f0;font-size:12px;cursor:pointer">Cancel</button>' +
        '<button id="bgRun"    style="padding:8px 18px;background:linear-gradient(135deg,#7c3aed,#a855f7);border:none;border-radius:6px;color:#fff;font-size:12px;font-weight:600;cursor:pointer">Remove \u2192</button>' +
      '</div>';
    bk.appendChild(panel);
    document.body.appendChild(bk);
    var keyPreset = 'green';
    var replaceColor = '0x000000';
    var PRESETS = [
      { id:'green', label:'\ud83d\udfe9 Green',  bg:'#2fa644' },
      { id:'blue',  label:'\ud83d\udfe6 Blue',   bg:'#3478d3' },
      { id:'dark',  label:'\u26ab Dark',         bg:'#151515' },
      { id:'light', label:'\u26aa Light',        bg:'#f0f0f0' }
    ];
    var REPLACE_OPTIONS = [
      { hex:'0x000000', label:'Black', bg:'#000' },
      { hex:'0xffffff', label:'White', bg:'#fff' },
      { hex:'0x7c3aed', label:'Brand', bg:'#7c3aed' },
      { hex:'0x22c55e', label:'Green screen', bg:'#22c55e' }
    ];
    var pRow = panel.querySelector('#bgPresets');
    PRESETS.forEach(function(p){
      var b = document.createElement('button');
      b.dataset.id = p.id;
      b.style.cssText = 'padding:10px 6px;background:' + p.bg + ';border:2px solid ' + (p.id === keyPreset ? '#a78bfa' : 'transparent') +
        ';border-radius:6px;color:#fff;font-size:10px;font-weight:600;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.6)';
      b.textContent = p.label;
      b.addEventListener('click', function(){
        keyPreset = p.id;
        Array.from(pRow.querySelectorAll('button')).forEach(function(o){
          o.style.borderColor = o.dataset.id === keyPreset ? '#a78bfa' : 'transparent';
        });
      });
      pRow.appendChild(b);
    });
    var rRow = panel.querySelector('#bgReplace');
    REPLACE_OPTIONS.forEach(function(r){
      var b = document.createElement('button');
      b.dataset.hex = r.hex;
      b.style.cssText = 'padding:8px 6px;background:' + r.bg + ';border:2px solid ' + (r.hex === replaceColor ? '#a78bfa' : 'transparent') +
        ';border-radius:6px;color:' + (r.bg === '#fff' ? '#000' : '#fff') + ';font-size:10px;font-weight:600;cursor:pointer';
      b.textContent = r.label;
      b.addEventListener('click', function(){
        replaceColor = r.hex;
        Array.from(rRow.querySelectorAll('button')).forEach(function(o){
          o.style.borderColor = o.dataset.hex === replaceColor ? '#a78bfa' : 'transparent';
        });
      });
      rRow.appendChild(b);
    });
    var sim = panel.querySelector('#bgSim'), simV = panel.querySelector('#bgSimVal');
    var blend = panel.querySelector('#bgBlend'), blendV = panel.querySelector('#bgBlendVal');
    sim.addEventListener('input',   function(){ simV.textContent   = parseFloat(sim.value).toFixed(2); });
    blend.addEventListener('input', function(){ blendV.textContent = parseFloat(blend.value).toFixed(2); });
    panel.querySelector('#bgCancel').addEventListener('click', function(){ bk.remove(); });
    bk.addEventListener('click', function(e){ if (e.target === bk) bk.remove(); });
    panel.querySelector('#bgRun').addEventListener('click', async function(){
      bk.remove();
      var prog = showBlockingProgressModal('Remove Background', [
        'Processing footage\u2026', 'Swapping into V1\u2026'
      ]);
      var beforeUnload = function(e){ e.preventDefault(); e.returnValue = ''; return ''; };
      window.addEventListener('beforeunload', beforeUnload);
      try {
        prog.advance(0);
        var r = await fetch('/video-editor/bg-remove', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mediaUrl: target.dataset.mediaUrl,
            preset: keyPreset,
            replaceColor: replaceColor,
            similarity: parseFloat(sim.value),
            blend: parseFloat(blend.value)
          })
        });
        var d = await r.json();
        if (!r.ok || !d.success) throw new Error(d.error || 'BG remove failed');
        prog.advance(1);
        // Swap in place (like Enhance Audio does)
        target.dataset.mediaUrl = d.mediaUrl;
        target.dataset.bgRemoved = '1';
        var player = document.getElementById('videoPlayer') || document.querySelector('video');
        if (player){ try { player.src = d.mediaUrl; player.load(); } catch(_){} }
        if (typeof window.buildClipFilmstrip === 'function'){
          var oldFS = target.querySelector('.v10-filmstrip');
          var oldLb = target.querySelector('.v10-fs-label');
          if (oldFS) oldFS.remove();
          if (oldLb) oldLb.remove();
          try { window.buildClipFilmstrip(target, d.mediaUrl, d.duration); } catch(_){}
        }
        if (typeof window.pushTimelineHistory === 'function') window.pushTimelineHistory();
        prog.finish('Background removed \u2014 V1 clip updated');
      } catch (err){ prog.fail(err.message || String(err)); }
      finally { window.removeEventListener('beforeunload', beforeUnload); }
    });
  }

  // ═════════════════════════════════════════════════════════════════
  // Task #53 — Style Transfer modal
  // Picks a preset look; server bakes an FFmpeg filter chain that
  // approximates it (EQ + curves + noise + hue/saturation combos).
  // Output replaces the V1 clip's mediaUrl in place.
  // ═════════════════════════════════════════════════════════════════
  function openStyleTransferModal(){
    var existing = document.getElementById('v10StyleModal');
    if (existing instanceof Element){ try { existing.remove(); } catch(_){} }
    var target = pickSourceClipForAI('style');
    if (!target || !target.dataset.mediaUrl || target.dataset.mediaUrl.indexOf('blob:') === 0){
      toast('Select a V1 clip with a server-uploaded source first');
      return;
    }
    var bk = document.createElement('div');
    bk.id = 'v10StyleModal';
    bk.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(8,6,18,.75);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
    var panel = document.createElement('div');
    panel.style.cssText = 'background:#1a1230;border:1px solid rgba(124,58,237,.4);border-radius:12px;padding:18px;width:min(520px,92vw);color:#e2e0f0;font-family:system-ui,sans-serif';
    var STYLES = [
      { id:'cyberpunk',    label:'Cyberpunk',    bg:'linear-gradient(135deg,#ec4899,#7c3aed,#22d3ee)' },
      { id:'film_noir',    label:'Film Noir',    bg:'linear-gradient(135deg,#1f2937,#111827)' },
      { id:'oil_painting', label:'Oil Painting', bg:'linear-gradient(135deg,#92400e,#f59e0b,#b91c1c)' },
      { id:'watercolor',   label:'Watercolor',   bg:'linear-gradient(135deg,#dbeafe,#93c5fd,#ddd6fe)' },
      { id:'comic',        label:'Comic Book',   bg:'linear-gradient(135deg,#fbbf24,#ef4444,#3b82f6)' },
      { id:'neon',         label:'Neon',         bg:'linear-gradient(135deg,#06b6d4,#7c3aed,#ec4899)' },
      { id:'vintage_film', label:'Vintage Film', bg:'linear-gradient(135deg,#a16207,#b45309,#78350f)' },
      { id:'sepia',        label:'Sepia',        bg:'linear-gradient(135deg,#a16207,#d97706,#fbbf24)' }
    ];
    panel.innerHTML =
      '<div style="font-size:13px;font-weight:700;color:#fde047;margin-bottom:6px">\ud83e\ude84 STYLE TRANSFER</div>' +
      '<div style="font-size:11px;color:#8886a0;margin-bottom:12px">Bakes a cinematic look into the selected V1 clip via a preset FFmpeg filter chain. Not neural style transfer, but works in seconds and no API key needed.</div>' +
      '<div id="styleGrid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px"></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">' +
        '<button id="stCancel" style="padding:8px 14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:6px;color:#e2e0f0;font-size:12px;cursor:pointer">Cancel</button>' +
        '<button id="stRun"    style="padding:8px 18px;background:linear-gradient(135deg,#7c3aed,#a855f7);border:none;border-radius:6px;color:#fff;font-size:12px;font-weight:600;cursor:pointer" disabled>Apply \u2192</button>' +
      '</div>';
    bk.appendChild(panel);
    document.body.appendChild(bk);
    var selectedStyle = null;
    var grid = panel.querySelector('#styleGrid');
    STYLES.forEach(function(s){
      var b = document.createElement('button');
      b.dataset.id = s.id;
      b.style.cssText = 'padding:14px 6px;background:' + s.bg + ';border:2px solid transparent' +
        ';border-radius:8px;color:#fff;font-size:11px;font-weight:700;cursor:pointer;text-shadow:0 1px 3px rgba(0,0,0,.8);min-height:60px';
      b.textContent = s.label;
      b.addEventListener('click', function(){
        selectedStyle = s.id;
        Array.from(grid.querySelectorAll('button')).forEach(function(o){
          o.style.borderColor = o.dataset.id === selectedStyle ? '#fde047' : 'transparent';
        });
        panel.querySelector('#stRun').disabled = false;
      });
      grid.appendChild(b);
    });
    panel.querySelector('#stCancel').addEventListener('click', function(){ bk.remove(); });
    bk.addEventListener('click', function(e){ if (e.target === bk) bk.remove(); });
    panel.querySelector('#stRun').addEventListener('click', async function(){
      if (!selectedStyle){ toast('Pick a style first'); return; }
      bk.remove();
      var prog = showBlockingProgressModal('Style Transfer', [
        'Rendering style\u2026', 'Updating V1 clip\u2026'
      ]);
      var beforeUnload = function(e){ e.preventDefault(); e.returnValue = ''; return ''; };
      window.addEventListener('beforeunload', beforeUnload);
      try {
        prog.advance(0);
        var r = await fetch('/video-editor/style-transfer', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mediaUrl: target.dataset.mediaUrl, style: selectedStyle })
        });
        var d = await r.json();
        if (!r.ok || !d.success) throw new Error(d.error || 'Style transfer failed');
        prog.advance(1);
        target.dataset.mediaUrl = d.mediaUrl;
        target.dataset.styleTransfer = selectedStyle;
        var player = document.getElementById('videoPlayer') || document.querySelector('video');
        if (player){ try { player.src = d.mediaUrl; player.load(); } catch(_){} }
        if (typeof window.buildClipFilmstrip === 'function'){
          var oldFS = target.querySelector('.v10-filmstrip');
          var oldLb = target.querySelector('.v10-fs-label');
          if (oldFS) oldFS.remove();
          if (oldLb) oldLb.remove();
          try { window.buildClipFilmstrip(target, d.mediaUrl, d.duration); } catch(_){}
        }
        if (typeof window.pushTimelineHistory === 'function') window.pushTimelineHistory();
        prog.finish('Style applied \u2014 ' + selectedStyle.replace(/_/g, ' '));
      } catch (err){ prog.fail(err.message || String(err)); }
      finally { window.removeEventListener('beforeunload', beforeUnload); }
    });
  }

  // ═════════════════════════════════════════════════════════════════
  // Task #38 — Smart Cut (silence / filler / scene) + #39 Scene Detect
  // Opens a small mode-picker modal, POSTs to /video-editor/smart-cut,
  // then razors the selected V1 clip at the returned cut boundaries.
  // • silence + filler modes — razor into pieces, delete the cut ranges
  // • scene mode — razor only (keeps all pieces)
  // • sceneDetectOnly=true — same as scene mode, no deletion
  // ═════════════════════════════════════════════════════════════════
  function openSmartCutModal(initialMode){
    var existing = document.getElementById('v10SmartCutModal');
    if (existing instanceof Element){ try { existing.remove(); } catch(_){} }
    var target = pickSourceClipForAI('enhance');
    if (!target || !target.dataset.mediaUrl){
      toast('Select a V1 clip first');
      return;
    }
    if ((target.dataset.mediaUrl || '').indexOf('blob:') === 0){
      toast('Upload this file via the sidebar first');
      return;
    }
    var bk = document.createElement('div');
    bk.id = 'v10SmartCutModal';
    bk.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(8,6,18,.75);' +
      'display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
    var panel = document.createElement('div');
    panel.style.cssText = 'background:#1a1230;border:1px solid rgba(124,58,237,.4);border-radius:12px;' +
      'padding:18px;width:min(460px,92vw);color:#e2e0f0;font-family:system-ui,sans-serif';
    panel.innerHTML =
      '<div style="font-size:13px;font-weight:700;color:#fde047;margin-bottom:6px">\u2702\ufe0f SMART CUT</div>' +
      '<div style="font-size:11px;color:#8886a0;margin-bottom:12px">Choose a mode \u2014 Smart Cut will analyze and edit the selected V1 clip.</div>' +
      '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">' +
        '<label style="display:flex;align-items:flex-start;gap:8px;padding:10px;background:rgba(139,92,246,.08);border:1px solid rgba(139,92,246,.25);border-radius:8px;cursor:pointer">' +
          '<input type="radio" name="scMode" value="silence" ' + (initialMode === 'filler' ? '' : 'checked') + ' style="margin-top:3px;accent-color:#a78bfa"/>' +
          '<span><b>Remove silences</b><br><span style="font-size:10px;color:#8886a0">Whisper finds pauses longer than the threshold, razors + deletes them.</span></span>' +
        '</label>' +
        '<label style="display:flex;align-items:flex-start;gap:8px;padding:10px;background:rgba(139,92,246,.08);border:1px solid rgba(139,92,246,.25);border-radius:8px;cursor:pointer">' +
          '<input type="radio" name="scMode" value="filler" ' + (initialMode === 'filler' ? 'checked' : '') + ' style="margin-top:3px;accent-color:#a78bfa"/>' +
          '<span><b>Remove filler words</b><br><span style="font-size:10px;color:#8886a0">Cuts out "uh, um, like, you know" and similar.</span></span>' +
        '</label>' +
        '<label style="display:flex;align-items:flex-start;gap:8px;padding:10px;background:rgba(139,92,246,.08);border:1px solid rgba(139,92,246,.25);border-radius:8px;cursor:pointer">' +
          '<input type="radio" name="scMode" value="scene" style="margin-top:3px;accent-color:#a78bfa"/>' +
          '<span><b>Split at scene changes</b><br><span style="font-size:10px;color:#8886a0">Uses perceptual diff to razor the clip at visual cuts (keeps all content).</span></span>' +
        '</label>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;font-size:11px" id="scThreshRow">' +
        '<span style="color:#8886a0;flex:none">Silence threshold</span>' +
        '<input id="scThresh" type="range" min="0.5" max="3" step="0.1" value="1" style="flex:1;accent-color:#a78bfa"/>' +
        '<span id="scThreshVal" style="color:#fde047;font-weight:600;min-width:32px;text-align:right">1.0s</span>' +
      '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end">' +
        '<button id="scCancel" style="padding:8px 14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:6px;color:#e2e0f0;font-size:12px;cursor:pointer">Cancel</button>' +
        '<button id="scRun"    style="padding:8px 18px;background:linear-gradient(135deg,#7c3aed,#a855f7);border:none;border-radius:6px;color:#fff;font-size:12px;font-weight:600;cursor:pointer">Run \u2192</button>' +
      '</div>';
    bk.appendChild(panel);
    document.body.appendChild(bk);

    var thresh = panel.querySelector('#scThresh');
    var threshVal = panel.querySelector('#scThreshVal');
    thresh.addEventListener('input', function(){ threshVal.textContent = parseFloat(thresh.value).toFixed(1) + 's'; });
    panel.querySelector('#scCancel').addEventListener('click', function(){ bk.remove(); });
    bk.addEventListener('click', function(e){ if (e.target === bk) bk.remove(); });
    panel.querySelector('#scRun').addEventListener('click', async function(){
      var mode = panel.querySelector('input[name="scMode"]:checked').value;
      bk.remove();
      await runSmartCut(target, mode, parseFloat(thresh.value) || 1.0, false);
    });
  }

  async function runSmartCut(clip, mode, thresholdSec, splitOnly){
    var prog = showBlockingProgressModal(splitOnly ? 'Scene Detect' : 'Smart Cut', [
      'Analyzing audio / video\u2026',
      'Finding cut points\u2026',
      'Applying edits\u2026'
    ]);
    var beforeUnload = function(e){ e.preventDefault(); e.returnValue = ''; return ''; };
    window.addEventListener('beforeunload', beforeUnload);
    try {
      prog.advance(0);
      var r = await fetch('/video-editor/smart-cut', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaUrl: clip.dataset.mediaUrl, mode: mode, thresholdSec: thresholdSec })
      });
      var d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || 'Smart cut failed');

      prog.advance(1);
      var cuts = (d.cuts || []).slice().sort(function(a,b){ return a.start - b.start; });
      if (!cuts.length){
        prog.finish('No ' + mode + ' moments found in this clip.');
        return;
      }

      prog.advance(2);
      // Convert each cut's seconds to px-within-clip, adjusting for the
      // clip's sourceOffset. Discard cuts that fall outside the visible
      // clip range.
      var PPS = (typeof window.TIMELINE_PX_PER_SEC === 'number') ? window.TIMELINE_PX_PER_SEC : 10;
      var srcOff = parseFloat(clip.dataset.sourceOffset) || 0;
      var clipDur= parseFloat(clip.dataset.duration) || (parseFloat(clip.style.width) / PPS);
      var srcDur = parseFloat(clip.dataset.srcDuration) || (clipDur + srcOff);

      // Build a working list of (startPx, endPx) relative to the clip's left edge
      var cutPx = cuts.map(function(c){
        var s = Math.max(0, c.start - srcOff);
        var e = Math.max(0, c.end   - srcOff);
        // Clamp to the clip's visible duration
        if (s > clipDur) return null;
        if (e > clipDur) e = clipDur;
        return { startPx: s * PPS, endPx: e * PPS, reason: c.reason };
      }).filter(Boolean);
      if (!cutPx.length){
        prog.finish('No cut points fall within this clip.');
        return;
      }

      if (mode === 'scene' || splitOnly){
        // Razor-only mode — split at each start, keep all pieces.
        // Walk in reverse so earlier cuts don't invalidate later offsets.
        cutPx.slice().reverse().forEach(function(cp){
          // After each reverse iteration, clip may have been split; the
          // piece we care about is whichever one contains cp.startPx.
          var curClip = clip;
          var curLeft = parseFloat(curClip.style.left) || 0;
          if (cp.startPx > 0 && cp.startPx < parseFloat(curClip.style.width)){
            try { window.razorSplit(curClip, cp.startPx); } catch(_){}
          }
        });
        prog.finish('Split at ' + cutPx.length + ' scene boundary' + (cutPx.length === 1 ? '' : 'ies'));
        return;
      }

      // silence / filler — razor at each cut's start + end, then delete the
      // middle segment. Iterate reverse order so pixel offsets remain valid.
      var originalLeft = parseFloat(clip.style.left) || 0;
      var totalRemovedPx = 0;
      // Map cut ranges sorted ascending
      var rangesAsc = cutPx.slice().sort(function(a,b){ return a.startPx - b.startPx; });

      // For clean multi-cut handling, rebuild the clip as a sequence of
      // KEEP segments (the inverse of the cut ranges). Then replace the
      // clip with N new clips.
      var keepRanges = [];
      var cursor = 0;
      rangesAsc.forEach(function(cp){
        if (cp.startPx > cursor + 4) keepRanges.push([cursor, cp.startPx]);
        cursor = Math.max(cursor, cp.endPx);
      });
      var clipEndPx = parseFloat(clip.style.width) || (clipDur * PPS);
      if (cursor < clipEndPx - 4) keepRanges.push([cursor, clipEndPx]);

      if (!keepRanges.length){
        prog.fail('The entire clip would be removed. Widen the threshold.');
        return;
      }

      // Replace the original clip with keep-range children
      var parent = clip.parentNode;
      var baseAttrs = {
        fileName: clip.dataset.fileName,
        mediaUrl: clip.dataset.mediaUrl,
        clipType: clip.dataset.clipType || 'vid',
        srcDuration: clip.dataset.srcDuration || ''
      };
      // Shift any clips that were to the RIGHT of the original clip LEFT
      // by the total removed duration (so the timeline stays compact).
      var totalRemovedSec = 0;
      rangesAsc.forEach(function(cp){ totalRemovedSec += (cp.endPx - cp.startPx) / PPS; });
      var origRight = originalLeft + clipEndPx;
      Array.from(document.querySelectorAll('.mt-track-video .mt-clip')).forEach(function(c){
        if (c === clip) return;
        var l = parseFloat(c.style.left) || 0;
        if (l >= origRight){ c.style.left = (l - totalRemovedSec * PPS) + 'px'; }
      });

      // Remove the original
      clip.remove();
      // Insert the keep-range clips at their compact positions
      var writeCursor = originalLeft;
      keepRanges.forEach(function(k){
        var segStartPx = k[0], segEndPx = k[1];
        var segW = segEndPx - segStartPx;
        if (segW < 4) return;
        var seg = document.createElement('div');
        seg.className = 'mt-clip mt-clip-video';
        seg.style.position = 'absolute';
        seg.style.top = '3px';
        seg.style.left = writeCursor + 'px';
        seg.style.width = segW + 'px';
        seg.style.overflow = 'hidden';
        seg.style.background = 'linear-gradient(135deg, #7c3aed, #6d28d9)';
        seg.style.color = '#fff';
        seg.dataset.fileName = baseAttrs.fileName;
        seg.dataset.mediaUrl = baseAttrs.mediaUrl;
        seg.dataset.clipType = baseAttrs.clipType;
        seg.dataset.duration = String(segW / PPS);
        seg.dataset.sourceOffset = String(srcOff + segStartPx / PPS);
        if (baseAttrs.srcDuration) seg.dataset.srcDuration = baseAttrs.srcDuration;
        parent.appendChild(seg);
        if (typeof window.buildClipFilmstrip === 'function'){
          try { window.buildClipFilmstrip(seg, baseAttrs.mediaUrl, segW / PPS); } catch(_){}
        }
        writeCursor += segW;
      });

      if (typeof window.pushTimelineHistory === 'function') window.pushTimelineHistory();
      var removedLabel = mode === 'filler' ? 'filler word' : 'silence';
      prog.finish('Removed ' + cutPx.length + ' ' + removedLabel + (cutPx.length === 1 ? '' : 's') +
                  ' \u00b7 saved ' + totalRemovedSec.toFixed(1) + 's');
    } catch (err){
      prog.fail(err.message || String(err));
    } finally {
      window.removeEventListener('beforeunload', beforeUnload);
    }
  }

  function showBlockingProgressModal(title, steps){
    var old = document.getElementById('v10BlockingProgress');
    if (old instanceof Element) old.remove();
    var bk = document.createElement('div');
    bk.id = 'v10BlockingProgress';
    bk.style.cssText = 'position:fixed;inset:0;z-index:99999;' +
      'background:rgba(8,6,18,.82);display:flex;align-items:center;' +
      'justify-content:center;backdrop-filter:blur(6px)';
    var panel = document.createElement('div');
    panel.style.cssText = 'background:#1a1230;border:1px solid rgba(124,58,237,.45);' +
      'border-radius:14px;padding:22px 26px;width:min(440px,92vw);color:#e2e0f0;' +
      'font-family:system-ui,sans-serif;box-shadow:0 30px 80px rgba(0,0,0,.6)';
    var stepsHtml = steps.map(function(s, i){
      return '<div data-step="' + i + '" style="display:flex;align-items:center;gap:10px;' +
        'padding:6px 0;color:#8886a0;font-size:12px">' +
          '<span class="v10-bp-dot" style="width:10px;height:10px;border-radius:50%;' +
            'background:#2a2545;flex:none"></span>' +
          '<span class="v10-bp-txt">' + s + '</span>' +
        '</div>';
    }).join('');
    panel.innerHTML =
      '<div style="font-size:13px;font-weight:700;color:#fde047;margin-bottom:6px">\u2728 ' + title + '</div>' +
      '<div style="font-size:11px;color:#8886a0;margin-bottom:14px">Please wait — don\u2019t close this window.</div>' +
      '<div>' + stepsHtml + '</div>';
    bk.appendChild(panel);
    document.body.appendChild(bk);
    // Task #43 — Swallow clicks on the BACKDROP only (not its children).
    // The previous version captured every click on bk and its subtree,
    // which meant the Close button (inside the panel) was never hearing
    // its own click. e.target === bk isolates true backdrop clicks.
    bk.addEventListener('click', function(e){
      if (e.target === bk){ e.preventDefault(); e.stopPropagation(); }
    }, true);
    // Swallow Escape key
    function killKey(e){ if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); } }
    document.addEventListener('keydown', killKey, true);

    return {
      advance: function(i){
        Array.from(panel.querySelectorAll('[data-step]')).forEach(function(row){
          var idx = parseInt(row.getAttribute('data-step'), 10);
          var dot = row.querySelector('.v10-bp-dot');
          var txt = row.querySelector('.v10-bp-txt');
          if (idx < i){
            dot.style.background = '#22c55e';
            row.style.color = '#e2e0f0';
          } else if (idx === i){
            dot.style.background = '#a78bfa';
            dot.style.boxShadow = '0 0 8px rgba(167,139,250,.8)';
            row.style.color = '#fff';
            row.style.fontWeight = '600';
          } else {
            dot.style.background = '#2a2545';
            dot.style.boxShadow = '';
            row.style.color = '#8886a0';
            row.style.fontWeight = '';
          }
        });
      },
      finish: function(msg){
        document.removeEventListener('keydown', killKey, true);
        panel.innerHTML =
          '<div style="font-size:13px;font-weight:700;color:#22c55e;margin-bottom:6px">\u2713 Done</div>' +
          '<div style="font-size:11px;color:#c2e4d3;margin-bottom:14px">' + msg + '</div>' +
          '<button id="v10BpClose" style="width:100%;padding:8px;background:linear-gradient(135deg,#7c3aed,#a855f7);' +
            'border:none;border-radius:6px;color:#fff;font-size:12px;font-weight:600;cursor:pointer">Close</button>';
        panel.querySelector('#v10BpClose').addEventListener('click', function(){ bk.remove(); });
        setTimeout(function(){ if (bk.isConnected) bk.remove(); }, 3500);
      },
      fail: function(msg){
        document.removeEventListener('keydown', killKey, true);
        panel.innerHTML =
          '<div style="font-size:13px;font-weight:700;color:#ef4444;margin-bottom:6px">\u26A0 Error</div>' +
          '<div style="font-size:11px;color:#fca5a5;margin-bottom:14px;word-break:break-word">' + msg + '</div>' +
          '<button id="v10BpClose" style="width:100%;padding:8px;background:rgba(255,255,255,.08);' +
            'border:1px solid rgba(255,255,255,.2);border-radius:6px;color:#e2e0f0;font-size:12px;cursor:pointer">Close</button>';
        panel.querySelector('#v10BpClose').addEventListener('click', function(){ bk.remove(); });
      }
    };
  }

  // ── AI Tool Modal ─────────────────────────────────────────────────
  // Overlay the editor with an iframe'd AI tool page so the user can
  // work on captions / enhance / hooks / brand kits without navigating
  // away. Dismissible via close button, Escape key, or backdrop click.
  function openAIToolModal(label, route){
    // Re-use existing modal if already open
    var existing = document.getElementById('v10AiModal');
    if (existing) existing.remove();

    var backdrop = document.createElement('div');
    backdrop.id = 'v10AiModal';
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:9998;' +
      'background:rgba(8,6,18,.75);display:flex;align-items:center;' +
      'justify-content:center;backdrop-filter:blur(4px);animation:v10AiFade .16s ease';

    var panel = document.createElement('div');
    panel.style.cssText = 'background:#0c0814;border:1px solid rgba(124,58,237,.35);' +
      'border-radius:14px;width:min(1180px,95vw);height:min(860px,92vh);' +
      'display:flex;flex-direction:column;box-shadow:0 30px 80px rgba(0,0,0,.6);' +
      'overflow:hidden';

    var head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 18px;' +
      'background:linear-gradient(90deg,rgba(124,58,237,.15),rgba(236,72,153,.08));' +
      'border-bottom:1px solid rgba(124,58,237,.25);color:#e8e0ff;font-weight:600;font-size:14px';
    head.innerHTML =
      '<span style="font-size:18px">\u2728</span>' +
      '<span>' + label + '</span>' +
      '<span style="flex:1"></span>' +
      '<a href="' + route + '" target="_blank" rel="noopener" ' +
        'style="color:#a78bfa;text-decoration:none;font-size:12px;padding:6px 10px;' +
        'border:1px solid rgba(167,139,250,.35);border-radius:6px">Open in new tab \u2197</a>' +
      '<button id="v10AiCloseBtn" title="Close" ' +
        'style="background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.4);' +
        'color:#f87171;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:13px">\u2715 Close</button>';

    var body = document.createElement('div');
    body.style.cssText = 'flex:1;position:relative;background:#050308';
    var iframe = document.createElement('iframe');
    iframe.src = route;
    iframe.style.cssText = 'width:100%;height:100%;border:0;display:block';
    iframe.setAttribute('title', label);
    body.appendChild(iframe);

    panel.appendChild(head);
    panel.appendChild(body);
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    function close(){
      document.removeEventListener('keydown', onKey);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }
    function onKey(e){ if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);

    backdrop.addEventListener('click', function(e){
      // Only close when the backdrop itself is clicked — not when the
      // click bubbled up from the panel/iframe.
      if (e.target === backdrop) close();
    });
    head.querySelector('#v10AiCloseBtn').addEventListener('click', close);

    // Inject the fade keyframes once
    if (!document.getElementById('v10AiModalStyles')){
      var s = document.createElement('style');
      s.id = 'v10AiModalStyles';
      s.textContent = '@keyframes v10AiFade{from{opacity:0}to{opacity:1}}';
      document.head.appendChild(s);
    }
  }

  function buildFXContent(){
    var div = document.createElement('div');
    div.className = 'v10-rp-content';
    div.setAttribute('data-v10', 'rp-fx');

    // Motion menu — each button drops a 3-second motion clip onto M1 that
    // the Program Monitor canvas animates over its duration.
    var motions = [
      {k:'zoom-in',    ic:'\ud83d\udd0d', label:'Zoom In'},
      {k:'zoom-out',   ic:'\ud83d\udd0e', label:'Zoom Out'},
      {k:'pan-left',   ic:'\u2b05\ufe0f', label:'Pan Left'},
      {k:'pan-right',  ic:'\u27a1\ufe0f', label:'Pan Right'},
      {k:'fade-in',    ic:'\ud83c\udf11', label:'Fade In'},
      {k:'fade-out',   ic:'\ud83c\udf15', label:'Fade Out'},
      {k:'shake',      ic:'\ud83c\udf00', label:'Shake'},
      {k:'rotate',     ic:'\ud83d\udd04', label:'Rotate'}
    ];
    var motionHtml = '<div class="v10-rp-section-title">MOTION</div><div class="v10-rp-grid">';
    motions.forEach(function(m){
      motionHtml += '<button class="v10-rp-btn" data-v10-motion="' + m.k +
        '"><span class="v10-rp-ic">' + m.ic + '</span>' + m.label + '</button>';
    });
    motionHtml += '</div>';

    // Visual Effects: each button maps to a clipAction*. Blur is a prompt
    // (numeric), the rest are toggles that the PGM render honours via
    // ctx.filter or post-FX overlays.
    var fxButtons = [
      {a:'FxBlur',      label:'Blur'},
      {a:'FxGlow',      label:'Glow'},
      {a:'FxVignette',  label:'Vignette'},
      {a:'FxGrain',     label:'Film Grain'},
      {a:'FxSharpen',   label:'Sharpen'},
      {a:'FxChromatic', label:'Chromatic'},
      {a:'FxPixelate',  label:'Pixelate'},
      {a:'FxNoise',     label:'Noise'}
    ];
    var html = motionHtml + '<div class="v10-rp-section-title" style="margin-top:14px">VISUAL EFFECTS</div>';
    fxButtons.forEach(function(b){
      html += '<button class="v10-fx-btn" data-v10-clip-action="' + b.a + '">' + b.label + '</button>';
    });
    var colorButtons = [
      {ic:'\ud83c\udfa8', label:'Color Grade', a:'FxColorGrade'},
      {ic:'\u2600\ufe0f', label:'Brightness',  a:'FxBrightness'},
      {ic:'\ud83c\udf17', label:'Contrast',    a:'FxContrast'},
      {ic:'\ud83d\udca7', label:'Saturation',  a:'FxSaturation'}
    ];
    html += '<div class="v10-rp-section-title" style="margin-top:14px">COLOR</div><div class="v10-rp-grid">';
    colorButtons.forEach(function(b){
      html += '<button class="v10-rp-btn" data-v10-clip-action="' + b.a + '"><span class="v10-rp-ic">' + b.ic + '</span>' + b.label + '</button>';
    });
    html += '</div>';
    div.innerHTML = html;

    // Wire motion buttons (drops a motion clip onto M1)
    Array.from(div.querySelectorAll('[data-v10-motion]')).forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.preventDefault(); e.stopPropagation();
        var key = btn.getAttribute('data-v10-motion');
        if (typeof window.addMotionClipToTimeline === 'function'){
          window.addMotionClipToTimeline(key, {duration: 3});
        } else {
          toast('Motion tool not ready');
        }
      }, true);
    });

    // Wire every clip-action button (Visual Effects + Color). These call
    // window.clipActionFx* defined in media-panel-fix.js, which operate
    // on the currently selected clip / fallback to clip under playhead.
    Array.from(div.querySelectorAll('[data-v10-clip-action]')).forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.preventDefault(); e.stopPropagation();
        var act = btn.getAttribute('data-v10-clip-action');
        var fn  = window['clipAction' + act];
        if (typeof fn === 'function') fn();
        else toast(act + ' not wired');
      }, true);
    });

    wireRPToast(div);
    return div;
  }

  function wireRPToast(container){
    container.querySelectorAll('.v10-rp-btn').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.preventDefault();
        var name = btn.textContent.trim();
        toast(name + ' running...');
      });
    });
  }

  /* ========== RIGHT PANEL TAB SWITCHING ========== */

  var _rpActiveTab = 'AI'; // default

  function identifyTab(btn){
    var txt = (btn.textContent || '').trim().toUpperCase();
    if (txt.indexOf('AUDIO') !== -1) return 'AUDIO';
    if (txt.indexOf('EDIT') !== -1) return 'EDIT';
    if (txt.indexOf('FX') !== -1) return 'FX';
    if (txt.indexOf('AI') !== -1) return 'AI';
    return '';
  }

  function switchRPTab(tabName, es){
    if (!es) es = document.querySelector('.editor-sidebar');
    if (!es) return;
    _rpActiveTab = tabName;

    // Update tab button highlights
    var catTabs = es.querySelector('.cat-tabs-new');
    if (catTabs){
      catTabs.querySelectorAll('.cat-btn').forEach(function(btn){
        var id = identifyTab(btn);
        if (id === tabName){
          btn.classList.add('v10-on');
          btn.classList.remove('v10-off');
          btn.classList.add('on');
        } else {
          btn.classList.add('v10-off');
          btn.classList.remove('v10-on');
          btn.classList.remove('on');
        }
      });
    }

    // Hide native panels
    var tBody = es.querySelector('.t-body');
    if (tBody) tBody.classList.add('v10-hidden');
    es.querySelectorAll('.tool-panel').forEach(function(p){ p.classList.add('v10-hidden'); });

    // Show/hide v10 content panels
    var panels = es.querySelectorAll('.v10-rp-content');
    panels.forEach(function(p){
      var panelTab = (p.getAttribute('data-v10') || '').replace('rp-','').toUpperCase();
      if (panelTab === tabName){
        p.classList.remove('v10-rp-hidden');
      } else {
        p.classList.add('v10-rp-hidden');
      }
    });

    // Export section is always visible — the user can export from any
    // tab without having to switch to AI first.
    var expSec = es.querySelector('.exp-section');
    if (expSec){
      expSec.style.display = '';
    }
  }

  function patchRightPanel(){
    var es = document.querySelector('.editor-sidebar');
    if (!es) return;
    if (es.getAttribute('data-v10-rp-patched') === '1') {
      // Already patched â just ensure correct tab is active
      switchRPTab(_rpActiveTab, es);
      return;
    }
    es.setAttribute('data-v10-rp-patched', '1');

    // Build all 4 tab content panels
    var editContent = buildEditContent();
    var audioContent = buildAudioContent();
    var aiContent = buildAITabContent();
    var fxContent = buildFXContent();

    // Insert before exp-section
    var expSec = es.querySelector('.exp-section');
    var panels = [editContent, audioContent, aiContent, fxContent];
    panels.forEach(function(panel){
      if (expSec){
        es.insertBefore(panel, expSec);
      } else {
        es.appendChild(panel);
      }
    });

    // Hook into tab click events
    var catTabs = es.querySelector('.cat-tabs-new');
    if (catTabs){
      catTabs.querySelectorAll('.cat-btn').forEach(function(btn){
        btn.addEventListener('click', function(e){
          e.preventDefault();
          e.stopPropagation();
          var tabName = identifyTab(btn);
          if (tabName) switchRPTab(tabName, es);
        }, true);
      });
    }

    // Set initial state to AI
    switchRPTab('AI', es);
  }

  /* ===================== RUNNER ===================== */

  var _applying = false;
  var _scheduled = false;

  function applyAll(){
    if (_applying) return;
    _applying = true;
    try { injectCSS(); } catch(e){}
    try { patchMediaCorner(); } catch(e){}
    try { patchTimelineVisibility(); } catch(e){}
    try { patchTimelineTracks(); } catch(e){}
    try { patchRightPanel(); } catch(e){}
    _applying = false;
  }

  function scheduleApply(){
    if (_scheduled || _applying) return;
    _scheduled = true;
    setTimeout(function(){ _scheduled = false; applyAll(); }, 250);
  }

  function boot(){
    applyAll();
    var tries = 0;
    var iv = setInterval(function(){
      applyAll();
      if (++tries > 60) clearInterval(iv);
    }, 600);
    var obs = new MutationObserver(scheduleApply);
    obs.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('loadedmetadata', function(e){
      if (e.target && e.target.tagName === 'VIDEO') scheduleApply();
    }, true);
    document.addEventListener('loadeddata', function(e){
      if (e.target && e.target.tagName === 'VIDEO'){
        scheduleApply();
        setTimeout(captureVideoFrames, 500);
        setTimeout(captureAudioWaveform, 600);
      }
    }, true);
    document.addEventListener('play', function(e){
      if (e.target && e.target.tagName === 'VIDEO') scheduleApply();
    }, true);
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    setTimeout(boot, 50);
  }
})();





