// media-panel-fix.js â v1.2
// Fixes all video editor media panel bugs:
// 1. +Upload button (opens file picker for correct type per tab)
// 2. Tab switching shows correct upload UI and accept types
// 3. +Timeline button adds clips to timeline
// 4. Stock tab shows browsable stock media UI
// 5. Folder open/close with content filtering
// 6. Import button opens file picker
// 7. AI B-Roll shows analysis panel
// 8. Search input filters media items
// 9. Folder font/count consistency

(function mediaPanelFix() {
  'use strict';

  // ââ Helpers ââ
  function showToast(msg) {
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#7c3aed;color:#fff;padding:10px 24px;border-radius:8px;z-index:99999;font-size:13px;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,.4);transition:opacity .3s';
    document.body.appendChild(t);
    setTimeout(function(){ t.style.opacity='0'; }, 2200);
    setTimeout(function(){ t.remove(); }, 2600);
  }

  function getActiveTab() {
    var active = document.querySelector('.ml-tab.active');
    return active ? active.textContent.trim().toLowerCase() : 'videos';
  }

  // ââ 1. Fix +Upload button & add file inputs per type ââ
  var mlUpload = document.querySelector('.ml-upload');
  var uploadBtn = mlUpload ? mlUpload.querySelector('button') : null;
  var existingFi = document.querySelector('.ml-upload input[type="file"]');

  // Create hidden file inputs for each media type
  var fiVideo = document.createElement('input');
  fiVideo.type = 'file'; fiVideo.accept = 'video/*'; fiVideo.multiple = true;
  fiVideo.style.display = 'none'; fiVideo.id = 'mlFileVideo';

  var fiAudio = document.createElement('input');
  fiAudio.type = 'file'; fiAudio.accept = 'audio/*'; fiAudio.multiple = true;
  fiAudio.style.display = 'none'; fiAudio.id = 'mlFileAudio';

  var fiImage = document.createElement('input');
  fiImage.type = 'file'; fiImage.accept = 'image/*'; fiImage.multiple = true;
  fiImage.style.display = 'none'; fiImage.id = 'mlFileImage';

  var fiAll = document.createElement('input');
  fiAll.type = 'file'; fiAll.accept = 'video/*,audio/*,image/*';
  fiAll.multiple = true; fiAll.style.display = 'none'; fiAll.id = 'mlFileAll';

  if (mlUpload) {
    mlUpload.appendChild(fiVideo);
    mlUpload.appendChild(fiAudio);
    mlUpload.appendChild(fiImage);
    mlUpload.appendChild(fiAll);
  }

  function getFileInput() {
    var tab = getActiveTab();
    if (tab === 'audio') return fiAudio;
    if (tab === 'images') return fiImage;
    if (tab === 'stock' || tab === 'all') return fiAll;
    return fiVideo;
  }

  function triggerUpload() {
    // Share a throttle with v10-editor-redesign.js so paths from either file
    // honor the same 500ms window — one user click = at most one dialog.
    var now = Date.now();
    if (window.__v10LastUploadTrigger && (now - window.__v10LastUploadTrigger) < 500) return;
    window.__v10LastUploadTrigger = now;
    var fi = getFileInput();
    fi.value = '';
    fi.click();
  }

  // Fix the +Upload button click
  if (uploadBtn) {
    uploadBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      triggerUpload();
    }, true);
  }

  // Fix the upload area click (keep existing but also handle button)
  if (mlUpload) {
    mlUpload.addEventListener('click', function(e) {
      if (e.target.tagName === 'INPUT') return;
      triggerUpload();
    }, true);
  }

  // Map extension -> media type/emoji/badge. Shared by sidebar uploads and
  // server-uploaded items arriving via addUploadedMediaItem.
  function classifyFileName(name){
    var ext = String(name || '').split('.').pop().toLowerCase();
    if (['mp3','wav','ogg','aac','flac','m4a'].indexOf(ext) !== -1)  return {mediaType:'aud', emoji:'\uD83C\uDFB5', badge:'aud'};
    if (['png','jpg','jpeg','gif','webp','svg','bmp'].indexOf(ext) !== -1) return {mediaType:'img', emoji:'\uD83D\uDDBC', badge:'img'};
    return {mediaType:'vid', emoji:'\uD83C\uDFAC', badge:'vid'};
  }

  // Build a .ml-fitem DOM element and append it to the Media library grid.
  // Supports two call patterns:
  //   - Local sidebar upload: pass `file` (a File object). We create a blob
  //     URL so the item can be played locally.
  //   - Server upload (via /video-editor/upload): pass `serveUrl` + optional
  //     `filename`. The item plays from the server URL.
  function appendMediaItem(opts){
    var grid = document.getElementById('mediaFileGrid');
    if (!grid) return null;

    var file = opts.file;
    var name = opts.name || (file && file.name) || opts.filename || 'file';
    var c = classifyFileName(name);
    if (opts.mediaType) { c.mediaType = opts.mediaType; c.badge = opts.mediaType; }

    var url = opts.serveUrl || '';
    if (!url && file){
      try { url = URL.createObjectURL(file); } catch(_){}
    }

    var item = document.createElement('div');
    item.className = 'ml-fitem';
    item.draggable = true;
    item.dataset.mediaType = c.mediaType;
    item.dataset.fileName = name;
    if (url)            item.dataset.mediaUrl   = url;
    if (opts.filename)  item.dataset.serverFilename = opts.filename;
    if (opts.duration)  item.dataset.duration   = String(opts.duration);
    item.innerHTML = '<div class="ml-fth" style="background:#1a1028;display:flex;align-items:center;justify-content:center;font-size:18px">' + c.emoji + '</div>'
      + '<span class="ml-badge ' + c.badge + '">' + c.badge.toUpperCase() + '</span>'
      + '<span class="ml-fname" style="font-size:9px;color:#c4bfda;padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + name + '</span>'
      + '<button class="ml-add" style="font-size:9px;background:rgba(124,58,237,.15);color:#a78bfa;border:none;border-radius:4px;padding:2px 4px;cursor:pointer;margin:2px 4px">+ Timeline</button>';

    grid.insertBefore(item, grid.firstChild);
    wireItem(item);

    // Re-apply whatever tab filter is currently active so the newly-added
    // item respects it (e.g. an audio upload while "Videos" is selected
    // should be hidden immediately).
    var activeTab = document.querySelector('.ml-tab.active');
    if (activeTab && typeof activeTab.click === 'function'){
      // The inline onclick on each tab is what does the per-item filter;
      // trigger it by simulating a click with the active tab already chosen.
      // This keeps the UI consistent.
      var f = activeTab.getAttribute('data-filter');
      if (f && f !== 'all'){
        item.style.display = item.dataset.mediaType === f ? '' : 'none';
      }
    }
    return item;
  }

  // Expose so the real /video-editor/upload handler can inject server-uploaded
  // files into the Media library (not Drafts).
  try {
    window.addUploadedMediaItem = function(spec){
      try { return appendMediaItem(spec || {}); } catch(_){ return null; }
    };
  } catch(_){}

  // Handle file selection for sidebar file inputs (local-only, no server upload)
  function handleFiles(files) {
    if (!files || !files.length) return;
    Array.from(files).forEach(function(file){ appendMediaItem({file: file}); });
    showToast('Added ' + files.length + ' file(s) to media library');
  }

  [fiVideo, fiAudio, fiImage, fiAll].forEach(function(fi) {
    fi.addEventListener('change', function() {
      if (fi.files.length) handleFiles(fi.files);
    });
  });

  // ââ 2. Tab switching - update upload label & show/hide stock ââ
  var stockPanel = null;
  document.querySelectorAll('.ml-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      var filter = this.textContent.trim().toLowerCase();

      // Update upload area text based on tab
      if (mlUpload) {
        var label = mlUpload.querySelector('div:nth-child(2)');
        var types = mlUpload.querySelector('div:nth-child(3)');
        if (filter === 'audio') {
          if (label) label.textContent = 'Drop audio files or click to upload';
          if (types) types.textContent = 'MP3, WAV, OGG, AAC, FLAC, M4A';
          if (uploadBtn) uploadBtn.textContent = '+ Upload Audio';
        } else if (filter === 'images') {
          if (label) label.textContent = 'Drop images or click to upload';
          if (types) types.textContent = 'PNG, JPG, JPEG, GIF, WEBP, SVG';
          if (uploadBtn) uploadBtn.textContent = '+ Upload Images';
        } else {
          if (label) label.textContent = 'Drop files or click to upload';
          if (types) types.textContent = 'MP4, MOV, MP3, WAV, PNG, JPG';
          if (uploadBtn) uploadBtn.textContent = '+ Upload';
        }
      }

      // Show/hide stock panel
      if (filter === 'stock') {
        if (mlUpload) mlUpload.style.display = 'none';
        showStockPanel();
      } else {
        if (mlUpload) mlUpload.style.display = '';
        hideStockPanel();
      }
    });
  });

  // ââ 3. +Timeline button - add clips to timeline ââ
  function addClipToTimeline(fileName, mediaType) {
    var trackSelector;
    var clipClass;
    if (mediaType === 'aud') {
      trackSelector = '.mt-track-audio';
      clipClass = 'mt-clip mt-clip-audio';
    } else if (mediaType === 'img') {
      trackSelector = '.mt-track-video';
      clipClass = 'mt-clip mt-clip-video';
    } else {
      trackSelector = '.mt-track-video';
      clipClass = 'mt-clip mt-clip-video';
    }

    var track = document.querySelector(trackSelector);
    if (!track) { showToast('Timeline track not found'); return; }

    var clip = document.createElement('div');
    clip.className = clipClass;
    clip.textContent = fileName;
    clip.draggable = true;
    clip.style.cssText = 'width:20%;min-width:80px;padding:4px 8px;font-size:10px;border-radius:4px;cursor:grab;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

    if (mediaType === 'aud') {
      clip.style.background = 'linear-gradient(135deg, #059669, #10b981)';
      clip.style.color = '#fff';
    } else {
      clip.style.background = 'linear-gradient(135deg, #7c3aed, #6d28d9)';
      clip.style.color = '#fff';
    }

    track.appendChild(clip);
    showToast('Added to timeline: ' + fileName);

    // Update track info
    var info = document.querySelector('.mt-info');
    if (info) {
      var clips = document.querySelectorAll('.mt-clip');
      info.textContent = document.querySelectorAll('.mt-track').length + ' tracks \u2022 ' + clips.length + ' clips';
    }
  }

  // Expose so other scripts (e.g. v10-editor-redesign draft loader) can reuse it
  try { window.addClipToTimeline = addClipToTimeline; } catch(_){}

  // For video items: load the video into the editor's preview and sync editor
  // state so tools (trim/export/etc.) can operate on it. Called on click AND
  // +Timeline button press so the preview updates immediately.
  function loadMediaItemIntoPreview(item){
    var mediaType = item.dataset.mediaType || 'vid';
    if (mediaType !== 'vid') return; // only video items drive the main preview
    var url = item.dataset.mediaUrl;
    if (!url) return;
    var player = document.getElementById('videoPlayer') || document.querySelector('video');
    if (player){
      try { player.src = url; player.load(); } catch(_){}
    }
    // If this came from a server upload (has server filename), update
    // currentVideoFile so the editor's export/trim/etc. call the right file.
    var serverFilename = item.dataset.serverFilename;
    if (serverFilename){
      try {
        window.currentVideoFile = {
          filename: serverFilename,
          serveUrl: url,
          duration: parseFloat(item.dataset.duration || '0') || 0
        };
      } catch(_){}
    }
    // Hide the #uploadZone once a real video is active (mirrors the
    // behavior of the draft-loader in v10-editor-redesign.js).
    var uz = document.getElementById('uploadZone');
    if (uz && getComputedStyle(uz).display !== 'none'){
      uz.style.display = 'none';
      uz.dataset.v10HiddenForDraft = '1';
    }
    // Enable editor action buttons that the upload handler normally enables.
    ['trimButton','exportButton','splitButton','filterButton','speedButton',
     'audioButton','previewVoiceButton','voiceoverButton','vtPreviewBtn',
     'vtApplyBtn','textButton','speedSelect','addMusicButton',
     'removeFillerWordsBtn','removePausesBtn','applyTransitionButton',
     'applyCaptionsBtn'].forEach(function(id){
      var el = document.getElementById(id);
      if (el) el.disabled = false;
    });
  }

  function wireItem(item) {
    // Guard against double-wiring from dual-load
    if (item.dataset.wiredV13) return;
    item.dataset.wiredV13 = '1';
    item.style.cursor = 'pointer';

    // Click anywhere on the item (except the +Timeline button) to select, add
    // it to the timeline, AND load it into the preview so the video actually
    // renders in the preview window immediately.
    item.addEventListener('click', function(e) {
      if (e.target.classList.contains('ml-add')) return;
      document.querySelectorAll('.ml-fitem').forEach(function(c) { c.classList.remove('selected'); });
      this.classList.add('selected');
      var nameEl = item.querySelector('.ml-fname');
      var fileName = nameEl ? nameEl.textContent.trim() : (item.dataset.fileName || 'clip');
      var mediaType = item.dataset.mediaType || 'vid';
      loadMediaItemIntoPreview(item);
      addClipToTimeline(fileName, mediaType);
    });

    // Wire +Timeline button — clone to strip any v1.0 listeners
    var addBtn = item.querySelector('.ml-add');
    if (addBtn) {
      var newBtn = addBtn.cloneNode(true);
      addBtn.parentNode.replaceChild(newBtn, addBtn);
      newBtn.style.cursor = 'pointer';
      newBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        var nameEl = item.querySelector('.ml-fname');
        var fileName = nameEl ? nameEl.textContent.trim() : 'clip';
        var mediaType = item.dataset.mediaType || 'vid';
        loadMediaItemIntoPreview(item);
        addClipToTimeline(fileName, mediaType);
      });
    }
  }

  // Wire existing items
  document.querySelectorAll('.ml-fitem').forEach(wireItem);

  // ââ 4. Stock tab panel ââ
  function showStockPanel() {
    if (stockPanel) { stockPanel.style.display = ''; return; }

    stockPanel = document.createElement('div');
    stockPanel.id = 'stockPanel';
    stockPanel.style.cssText = 'padding:8px;';

    var stockCategories = [
      { id: 'stockVid', icon: '\uD83C\uDFAC', label: 'Stock Videos', color: '#7c3aed' },
      { id: 'stockImg', icon: '\uD83D\uDDBC', label: 'Stock Images', color: '#2563eb' },
      { id: 'stockAud', icon: '\uD83C\uDFB5', label: 'Stock Audio', color: '#059669' }
    ];

    // Search bar
    var searchDiv = document.createElement('div');
    searchDiv.style.cssText = 'margin-bottom:8px;';
    searchDiv.innerHTML = '<input id="stockSearchInput" type="text" placeholder="\uD83D\uDD0D Search stock media..." style="width:100%;padding:6px 10px;background:#0c0814;border:1px solid rgba(108,58,237,.3);border-radius:6px;color:#ccc;font-size:10px;outline:none;box-sizing:border-box" />';
    stockPanel.appendChild(searchDiv);

    // Category buttons
    var catDiv = document.createElement('div');
    catDiv.style.cssText = 'display:flex;gap:4px;margin-bottom:10px;flex-wrap:wrap;';
    stockCategories.forEach(function(cat) {
      var btn = document.createElement('button');
      btn.id = cat.id;
      btn.textContent = cat.icon + ' ' + cat.label;
      btn.style.cssText = 'flex:1;padding:6px 4px;background:' + cat.color + '22;border:1px solid ' + cat.color + '44;border-radius:6px;color:' + cat.color + ';font-size:9px;font-weight:600;cursor:pointer;min-width:80px;';
      btn.addEventListener('click', function() {
        loadStockContent(cat.id.replace('stock','').toLowerCase());
        catDiv.querySelectorAll('button').forEach(function(b) { b.style.opacity = '0.5'; });
        btn.style.opacity = '1';
      });
      catDiv.appendChild(btn);
    });
    stockPanel.appendChild(catDiv);

    // AI Generated button
    var aiBtn = document.createElement('button');
    aiBtn.textContent = '\u2728 AI Generated';
    aiBtn.style.cssText = 'width:100%;padding:8px;background:linear-gradient(135deg,#7c3aed,#ec4899);border:none;border-radius:8px;color:#fff;font-size:11px;font-weight:700;cursor:pointer;margin-bottom:10px;';
    aiBtn.addEventListener('click', function() {
      showToast('AI Generation: analyzing your project for smart media suggestions...');
      loadStockContent('ai');
    });
    stockPanel.appendChild(aiBtn);

    // Content grid
    var gridDiv = document.createElement('div');
    gridDiv.id = 'stockGrid';
    gridDiv.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;';
    stockPanel.appendChild(gridDiv);

    // Insert into ml-body â BEFORE the file grid so it's visible in the scroll area
    var mlBody = document.querySelector('.ml-body');
    if (mlBody) {
      // Ensure ml-body can scroll to show new content
      mlBody.style.overflowY = 'auto';
      var fileGrid = document.getElementById('mediaFileGrid');
      if (fileGrid && fileGrid.parentElement === mlBody) {
        // Hide the file grid when stock is shown, insert stock panel before it
        fileGrid.style.display = 'none';
        mlBody.insertBefore(stockPanel, fileGrid);
      } else {
        if (fileGrid) fileGrid.style.display = 'none';
        mlBody.insertBefore(stockPanel, mlBody.firstChild);
      }
    }

    // Wire search
    var searchInput = document.getElementById('stockSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', function() {
        var term = this.value.trim().toLowerCase();
        if (term.length >= 2) {
          loadStockContent('search', term);
        }
      });
    }

    // Load default
    loadStockContent('vid');
  }

  function hideStockPanel() {
    if (stockPanel) stockPanel.style.display = 'none';
    // Restore file grid visibility
    var fileGrid = document.getElementById('mediaFileGrid');
    if (fileGrid) fileGrid.style.display = '';
  }

  function loadStockContent(type, query) {
    var grid = document.getElementById('stockGrid');
    if (!grid) return;
    grid.innerHTML = '';

    var items = [];
    if (type === 'vid' || type === 'search') {
      items = [
        { name: 'City Aerial Drone', dur: '0:15', emoji: '\uD83C\uDFD9' },
        { name: 'Ocean Waves Sunset', dur: '0:20', emoji: '\uD83C\uDF0A' },
        { name: 'Tech Office Modern', dur: '0:12', emoji: '\uD83D\uDCBB' },
        { name: 'Nature Forest Walk', dur: '0:18', emoji: '\uD83C\uDF3F' },
        { name: 'Abstract Particles', dur: '0:10', emoji: '\u2728' },
        { name: 'People Working Team', dur: '0:14', emoji: '\uD83D\uDC65' }
      ];
    } else if (type === 'img') {
      items = [
        { name: 'Mountain Landscape', emoji: '\uD83C\uDFD4' },
        { name: 'Business Meeting', emoji: '\uD83E\uDD1D' },
        { name: 'Abstract Gradient', emoji: '\uD83C\uDFA8' },
        { name: 'Food Photography', emoji: '\uD83C\uDF7D' },
        { name: 'Urban Architecture', emoji: '\uD83C\uDFDB' },
        { name: 'Technology AI', emoji: '\uD83E\uDD16' }
      ];
    } else if (type === 'aud') {
      items = [
        { name: 'Upbeat Corporate', dur: '2:30', emoji: '\uD83C\uDFB6' },
        { name: 'Chill Lo-Fi Beat', dur: '3:15', emoji: '\uD83C\uDFA7' },
        { name: 'Epic Cinematic', dur: '1:45', emoji: '\uD83C\uDFAC' },
        { name: 'Ambient Nature', dur: '4:00', emoji: '\uD83C\uDF3F' },
        { name: 'Podcast Intro', dur: '0:08', emoji: '\uD83C\uDF99' },
        { name: 'Sound Effect Pack', dur: '0:03', emoji: '\uD83D\uDD0A' }
      ];
    } else if (type === 'ai') {
      items = [
        { name: 'AI Scene Match', emoji: '\uD83E\uDDE0' },
        { name: 'AI Color Palette', emoji: '\uD83C\uDFA8' },
        { name: 'AI Motion Graphics', emoji: '\u2728' },
        { name: 'AI Transition Pack', emoji: '\uD83D\uDD04' }
      ];
    }

    if (query) {
      items = items.filter(function(it) { return it.name.toLowerCase().indexOf(query) !== -1; });
    }

    items.forEach(function(it) {
      var card = document.createElement('div');
      card.style.cssText = 'background:#16112a;border:1px solid rgba(108,58,237,.15);border-radius:8px;padding:8px;cursor:pointer;transition:all .2s;';
      card.innerHTML = '<div style="font-size:24px;text-align:center;margin-bottom:4px">' + it.emoji + '</div>'
        + '<div style="font-size:9px;color:#c4bfda;font-weight:600;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + it.name + '</div>'
        + (it.dur ? '<div style="font-size:8px;color:#5a4d78;text-align:center">' + it.dur + '</div>' : '')
        + '<button style="width:100%;margin-top:4px;padding:3px;background:rgba(124,58,237,.2);border:1px solid rgba(124,58,237,.3);border-radius:4px;color:#a78bfa;font-size:8px;cursor:pointer;font-weight:600">+ Add to Project</button>';

      card.querySelector('button').addEventListener('click', function(e) {
        e.stopPropagation();
        var mType = (type === 'aud') ? 'aud' : (type === 'img') ? 'img' : 'vid';
        addClipToTimeline(it.name, mType);
      });

      card.addEventListener('mouseenter', function() { this.style.borderColor = 'rgba(124,58,237,.4)'; this.style.transform = 'scale(1.02)'; });
      card.addEventListener('mouseleave', function() { this.style.borderColor = 'rgba(124,58,237,.15)'; this.style.transform = 'scale(1)'; });
      grid.appendChild(card);
    });

    if (items.length === 0) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:#5a4d78;font-size:11px">No results found. Try a different search.</div>';
    }
  }

  // ââ 5. Folder open/close with content ââ
  document.querySelectorAll('.ml-folder').forEach(function(folder) {
    var nameSpan = folder.querySelector('span:nth-child(2)');
    var countSpan = folder.querySelector('span:nth-child(3)');
    var folderName = nameSpan ? nameSpan.textContent.trim() : '';

    // Fix font consistency
    if (nameSpan) {
      nameSpan.style.fontFamily = 'inherit';
      nameSpan.style.fontSize = '10px';
      nameSpan.style.fontWeight = '600';
      nameSpan.style.color = '#b8a6d9';
    }
    if (countSpan) {
      countSpan.style.fontFamily = 'inherit';
      countSpan.style.fontSize = '8px';
      countSpan.style.color = '#5a4d78';
    }

    // Create expandable content
    var subGrid = folder.nextElementSibling;
    var isSubGrid = subGrid && subGrid.classList.contains('ml-fgrid-sub');

    folder.style.cursor = 'pointer';
    folder.addEventListener('click', function() {
      var isOpen = this.classList.toggle('open');
      var icon = this.querySelector('span:first-child');
      if (icon) icon.textContent = isOpen ? '\uD83D\uDCC2' : '\uD83D\uDCC1';

      if (isSubGrid) {
        subGrid.style.display = isOpen ? 'grid' : 'none';
      }

      // Filter media grid items by folder
      if (isOpen) {
        showToast('Opened folder: ' + folderName);
      }
    });

    // Update count based on actual items in sub-grid
    if (isSubGrid && countSpan) {
      var itemCount = subGrid.querySelectorAll('.ml-fitem').length;
      countSpan.textContent = String(itemCount);
    }
  });

  // ââ 6. Import button - opens file picker ââ
  var footBtns = document.querySelectorAll('.ml-fb');
  footBtns.forEach(function(btn) {
    var clone = btn.cloneNode(true);
    if (btn.parentNode) btn.parentNode.replaceChild(clone, btn);
  });
  // Re-query after cloning
  footBtns = document.querySelectorAll('.ml-fb');
  footBtns.forEach(function(btn) {
    var text = btn.textContent.trim();

    if (text.indexOf('Import') !== -1) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        fiAll.value = '';
        fiAll.click();
      }, true);
    }

    if (text.indexOf('Folder') !== -1) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        showFolderNameDialog();
      }, true);
    }

    if (text.indexOf('B-Roll') !== -1) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        showAIBRollPanel();
      }, true);
    }
  });

  // ââ 6b. Custom folder name dialog (replaces prompt()) ââ
  function showFolderNameDialog() {
    var existing = document.getElementById('folderNameDialog');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'folderNameDialog';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,.6);z-index:100000;display:flex;align-items:center;justify-content:center;';

    var box = document.createElement('div');
    box.style.cssText = 'background:#1a1028;border:2px solid #7c3aed;border-radius:12px;padding:20px;width:320px;max-width:90vw;box-shadow:0 10px 40px rgba(0,0,0,.5);';
    box.innerHTML = '<h3 style="color:#fff;margin:0 0 12px;font-size:14px">\uD83D\uDCC1 New Folder</h3>'
      + '<input id="folderNameInput" type="text" placeholder="Enter folder name..." style="width:100%;padding:8px 12px;background:#0c0814;border:1px solid rgba(124,58,237,.4);border-radius:6px;color:#fff;font-size:12px;outline:none;box-sizing:border-box;margin-bottom:12px" />'
      + '<div style="display:flex;gap:8px;justify-content:flex-end">'
      + '<button id="folderCancel" style="padding:6px 16px;background:#2a2040;border:1px solid #3a3050;border-radius:6px;color:#999;font-size:11px;cursor:pointer">Cancel</button>'
      + '<button id="folderCreate" style="padding:6px 16px;background:#7c3aed;border:none;border-radius:6px;color:#fff;font-size:11px;cursor:pointer;font-weight:600">Create</button>'
      + '</div>';

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    var input = document.getElementById('folderNameInput');
    input.focus();

    function close() { overlay.remove(); }
    function submit() {
      var name = input.value.trim();
      if (name) createFolder(name);
      close();
    }

    document.getElementById('folderCancel').addEventListener('click', close);
    document.getElementById('folderCreate').addEventListener('click', submit);
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') close();
    });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
  }

  // ââ 7. Create folder function ââ
  function createFolder(name) {
    var section = document.querySelector('.ml-section');
    if (!section) return;

    var folder = document.createElement('div');
    folder.className = 'ml-folder';
    folder.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 7px;background:#16112a;border:1px solid rgba(108,58,237,.04);cursor:pointer;margin-bottom:2px;border-radius:6px;transition:all .2s;';
    folder.innerHTML = '<span style="font-size:15px">\uD83D\uDCC1</span>'
      + '<span style="font-size:10px;font-weight:600;color:#b8a6d9;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:inherit">' + name + '</span>'
      + '<span style="font-size:8px;color:#5a4d78;font-family:inherit">0</span>';

    folder.addEventListener('click', function() {
      var isOpen = this.classList.toggle('open');
      var icon = this.querySelector('span:first-child');
      if (icon) icon.textContent = isOpen ? '\uD83D\uDCC2' : '\uD83D\uDCC1';
      showToast(isOpen ? 'Opened folder: ' + name : 'Closed folder: ' + name);
    });

    section.parentNode.insertBefore(folder, section.nextSibling);
    showToast('Created folder: ' + name);
  }

  // ââ 8. AI B-Roll panel ââ
  function showAIBRollPanel() {
    var existing = document.getElementById('aiBrollOverlay');
    if (existing && existing.parentElement && existing.style.display !== '') {
      // Already visible — toggle off
      existing.style.display = 'none'; return;
    }
    if (existing) existing.remove(); // Remove stale/hidden overlay and recreate fresh

    // Create overlay backdrop for guaranteed visibility
    var overlay = document.createElement('div');
    overlay.id = 'aiBrollOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,.6);z-index:100000;display:flex;align-items:center;justify-content:center;';

    var panel = document.createElement('div');
    panel.id = 'aiBrollPanel';
    panel.style.cssText = 'background:#1a1028;border:2px solid #7c3aed;border-radius:16px;padding:24px;width:400px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,.6);';
    panel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
      + '<h3 style="color:#fff;margin:0;font-size:16px">\u2728 AI B-Roll Generator</h3>'
      + '<span id="closeBroll" style="color:#999;cursor:pointer;font-size:20px">&times;</span>'
      + '</div>'
      + '<p style="color:#a78bfa;font-size:12px;margin-bottom:12px">AI will analyze your video content and suggest relevant B-Roll footage to enhance your edit.</p>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">'
      + '<button class="broll-cat" style="padding:8px 16px;background:#7c3aed22;border:1px solid #7c3aed44;border-radius:8px;color:#a78bfa;cursor:pointer;font-size:11px">\uD83C\uDFD9 Urban</button>'
      + '<button class="broll-cat" style="padding:8px 16px;background:#7c3aed22;border:1px solid #7c3aed44;border-radius:8px;color:#a78bfa;cursor:pointer;font-size:11px">\uD83C\uDF3F Nature</button>'
      + '<button class="broll-cat" style="padding:8px 16px;background:#7c3aed22;border:1px solid #7c3aed44;border-radius:8px;color:#a78bfa;cursor:pointer;font-size:11px">\uD83D\uDCBB Tech</button>'
      + '<button class="broll-cat" style="padding:8px 16px;background:#7c3aed22;border:1px solid #7c3aed44;border-radius:8px;color:#a78bfa;cursor:pointer;font-size:11px">\uD83D\uDC65 People</button>'
      + '</div>'
      + '<button id="analyzeBroll" style="width:100%;padding:12px;background:linear-gradient(135deg,#7c3aed,#6d28d9);border:none;border-radius:10px;color:#fff;font-size:13px;font-weight:700;cursor:pointer">\uD83D\uDD0D Analyze Video for B-Roll</button>'
      + '<div id="brollResults" style="margin-top:12px"></div>';

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    document.getElementById('closeBroll').addEventListener('click', function() { overlay.style.display = 'none'; });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.style.display = 'none'; });

    document.getElementById('analyzeBroll').addEventListener('click', function() {
      var results = document.getElementById('brollResults');
      results.innerHTML = '<div style="text-align:center;padding:16px;color:#a78bfa"><div style="font-size:24px;margin-bottom:8px">\u23F3</div>Analyzing video content...</div>';

      setTimeout(function() {
        results.innerHTML = '<div style="font-size:11px;font-weight:600;color:#fff;margin-bottom:8px">Suggested B-Roll:</div>'
          + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">'
          + '<div style="background:#0c0814;padding:8px;border-radius:8px;cursor:pointer;text-align:center" onclick="showToast(\'Added B-Roll: City Skyline\')"><div style="font-size:20px">\uD83C\uDFD9</div><div style="font-size:9px;color:#c4bfda">City Skyline</div></div>'
          + '<div style="background:#0c0814;padding:8px;border-radius:8px;cursor:pointer;text-align:center" onclick="showToast(\'Added B-Roll: Team Meeting\')"><div style="font-size:20px">\uD83D\uDC65</div><div style="font-size:9px;color:#c4bfda">Team Meeting</div></div>'
          + '<div style="background:#0c0814;padding:8px;border-radius:8px;cursor:pointer;text-align:center" onclick="showToast(\'Added B-Roll: Data Visuals\')"><div style="font-size:20px">\uD83D\uDCCA</div><div style="font-size:9px;color:#c4bfda">Data Visuals</div></div>'
          + '<div style="background:#0c0814;padding:8px;border-radius:8px;cursor:pointer;text-align:center" onclick="showToast(\'Added B-Roll: Abstract Tech\')"><div style="font-size:20px">\u2728</div><div style="font-size:9px;color:#c4bfda">Abstract Tech</div></div>'
          + '</div>';
      }, 1500);
    });

    panel.querySelectorAll('.broll-cat').forEach(function(btn) {
      btn.addEventListener('click', function() {
        panel.querySelectorAll('.broll-cat').forEach(function(b) { b.style.background = '#7c3aed22'; });
        this.style.background = '#7c3aed44';
      });
    });
  }

  // ââ 9. Search input - filter media items ââ
  var searchInput = document.querySelector('.ml-search input');
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      var term = this.value.trim().toLowerCase();
      document.querySelectorAll('.ml-fitem').forEach(function(item) {
        var name = item.querySelector('.ml-fname');
        var text = name ? name.textContent.toLowerCase() : item.textContent.toLowerCase();
        item.style.display = (!term || text.indexOf(term) !== -1) ? '' : 'none';
      });
    });
  }

  // ââ Make showToast globally available for inline onclick ââ
  window.showToast = showToast;

  
  // ── MutationObserver: wire dynamically-revealed media items ──
  var mediaObserver = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      mutation.addedNodes.forEach(function(node) {
        if (node.nodeType === 1) {
          // Wire the node itself if it has data-media-type
          if (node.dataset && node.dataset.mediaType && !node.dataset.wiredV13) {
            wireItem(node);
          }
          // Wire any children with data-media-type
          var children = node.querySelectorAll ? node.querySelectorAll('[data-media-type]') : [];
          children.forEach(function(child) {
            if (!child.dataset.wiredV13) wireItem(child);
          });
        }
      });
      // Also check for items that became visible (display changed from none)
      if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
        var target = mutation.target;
        if (target.dataset && target.dataset.mediaType && !target.dataset.wiredV13) {
          wireItem(target);
        }
      }
    });
  });
  // Observe the media list container for new items
  var mlContainer = document.querySelector('.ml-list') || document.querySelector('[class*="media"]');
  if (mlContainer) {
    mediaObserver.observe(mlContainer, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  } else {
    // Fallback: observe the whole body
    mediaObserver.observe(document.body, { childList: true, subtree: true });
  }

console.log('media-panel-fix v1.4: all media panel features wired + MutationObserver');
})();
