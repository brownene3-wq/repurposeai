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

  // Load metadata for a blob URL and return the media's duration via callback.
  // Images resolve with duration=0 immediately (no meaningful duration).
  function estimateMediaDuration(url, mediaType, cb){
    if (mediaType === 'img' || !url) { cb(0); return; }
    var el = mediaType === 'aud' ? new Audio() : document.createElement('video');
    el.preload = 'metadata';
    var done = false;
    var finish = function(v){ if (done) return; done = true; cb(isFinite(v) && v > 0 ? v : 0); };
    el.addEventListener('loadedmetadata', function(){ finish(el.duration); });
    el.addEventListener('error', function(){ finish(0); });
    setTimeout(function(){ finish(0); }, 4000); // safety timeout
    try { el.src = url; } catch(_){ finish(0); }
  }

  // Handle file selection for sidebar file inputs (local-only, no server upload).
  // Each picked file becomes a .ml-fitem in the Media library AND is auto-
  // placed on the correct timeline track (V1/A1) after any existing clips.
  function handleFiles(files) {
    if (!files || !files.length) return;
    Array.from(files).forEach(function(file){
      var item = appendMediaItem({file: file});
      if (!item) return;
      var url = item.dataset.mediaUrl;
      var mediaType = item.dataset.mediaType || 'vid';
      // Images go on V1 as a fixed-width placeholder (no real duration).
      if (mediaType === 'img'){
        try { addClipToTimeline(file.name, 'vid', 0, url); } catch(_){}
        return;
      }
      estimateMediaDuration(url, mediaType, function(dur){
        if (dur > 0) item.dataset.duration = String(dur);
        try { addClipToTimeline(file.name, mediaType, dur, url); } catch(_){}
      });
    });
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
  // Timeline clip sequencing + Select tool + Snap toggle.
  //
  // TIMELINE_PX_PER_SEC sets the visual time-scale. A 30s clip renders
  // 30*PX_PER_SEC wide. The tracks area has overflow-x:auto so longer
  // timelines scroll naturally.
  var TIMELINE_PX_PER_SEC = 10;
  // Default-on snap so edges magnetize out of the box.
  var _timelineState = { tool: 'razor', snap: true };

  function findRightmostClipEnd(trackEl){
    var maxEnd = 0;
    trackEl.querySelectorAll('.mt-clip').forEach(function(c){
      var l = parseFloat(c.style.left) || 0;
      var w = parseFloat(c.style.width) || 0;
      if (l + w > maxEnd) maxEnd = l + w;
    });
    return maxEnd;
  }

  // For now, new clicks from the Media panel always land on the FIRST track
  // of the matching type (V1 for video, A1 for audio). Once on the timeline,
  // the user can drag a clip onto A2/A3 if desired.
  function findTargetTrack(mediaType){
    var sel = mediaType === 'aud' ? '.mt-track-audio' : '.mt-track-video';
    return document.querySelector(sel);
  }

  function updateTimelineInfo(){
    var info = document.querySelector('.mt-info');
    if (!info) return;
    var tracks = document.querySelectorAll('.mt-track').length;
    var clips = document.querySelectorAll('.mt-clip').length;
    info.textContent = tracks + ' tracks \u2022 ' + clips + ' clips';
  }

  // Snap candidate positions: every other clip's left + right edge, plus the playhead.
  function collectSnapTargets(ignoreClip){
    var targets = [];
    document.querySelectorAll('.mt-clip').forEach(function(c){
      if (c === ignoreClip) return;
      var l = parseFloat(c.style.left) || 0;
      var w = parseFloat(c.style.width) || 0;
      targets.push(l, l + w);
    });
    var ph = document.getElementById('mtPlayhead');
    if (ph) targets.push(parseFloat(ph.style.left) || 0);
    return targets;
  }

  // Overlap helpers — used to prevent clips from occupying the same x-range
  // on a track. Two clips overlap if their [left, left+width] ranges intersect.
  function clipOverlaps(track, left, width, ignoreClip){
    var clips = track.querySelectorAll('.mt-clip');
    for (var i = 0; i < clips.length; i++){
      var c = clips[i];
      if (c === ignoreClip) continue;
      var l = parseFloat(c.style.left) || 0;
      var w = parseFloat(c.style.width) || 0;
      if (!(left + width <= l || left >= l + w)) return c;
    }
    return null;
  }
  // Clamp target position to the nearest non-overlapping spot on a track.
  // Picks left-or-right of the conflicting clip depending on drag direction.
  function clampAwayFromOverlap(track, targetLeft, width, ignoreClip){
    var overlap = clipOverlaps(track, targetLeft, width, ignoreClip);
    if (!overlap) return targetLeft;
    var oL = parseFloat(overlap.style.left) || 0;
    var oW = parseFloat(overlap.style.width) || 0;
    var targetCenter = targetLeft + width/2;
    var overlapCenter = oL + oW/2;
    var candidate;
    if (targetCenter < overlapCenter){
      candidate = Math.max(0, oL - width);
    } else {
      candidate = oL + oW;
    }
    if (candidate < 0) candidate = 0;
    // If the fallback also overlaps something else, give up and keep original.
    if (clipOverlaps(track, candidate, width, ignoreClip)) return targetLeft;
    return candidate;
  }
  // Look for another audio track (different from currentTrack) where this
  // clip would not overlap. Returns null if none exists.
  function findFreeAudioTrack(targetLeft, width, currentTrack, ignoreClip){
    var tracks = document.querySelectorAll('.mt-track-audio');
    for (var i = 0; i < tracks.length; i++){
      var t = tracks[i];
      if (t === currentTrack) continue;
      if (!clipOverlaps(t, targetLeft, width, ignoreClip)) return t;
    }
    return null;
  }

  function applySnap(candidateLeft, clipWidth, ignoreClip){
    if (!_timelineState.snap) return candidateLeft;
    // 20px feels magnetic without being sticky — user can still place a clip
    // freely by dragging it far from any neighbor.
    var threshold = 20;
    var targets = collectSnapTargets(ignoreClip);
    var edges = [
      {val: candidateLeft},
      {val: candidateLeft + clipWidth}
    ];
    var best = null;
    targets.forEach(function(t){
      edges.forEach(function(e){
        var d = Math.abs(t - e.val);
        if (d < threshold && (best === null || d < best.dist)){
          best = {dist: d, shift: t - e.val};
        }
      });
    });
    return best !== null ? candidateLeft + best.shift : candidateLeft;
  }

  // Split a clip at cutXInClip (in clip-local pixels) into two clips.
  // The right half inherits mediaUrl and stores sourceOffset so when played
  // it seeks to the correct point inside the original source.
  function razorSplit(clip, cutXInClip){
    var width = parseFloat(clip.style.width) || clip.offsetWidth || 0;
    // Ignore clicks within 6px of either edge — don't create tiny slivers.
    if (cutXInClip < 6 || cutXInClip > width - 6) return false;
    var left = parseFloat(clip.style.left) || 0;
    var sourceOffset = parseFloat(clip.dataset.sourceOffset) || 0;
    var dur = parseFloat(clip.dataset.duration) || (width / TIMELINE_PX_PER_SEC);
    var cutSec = cutXInClip / TIMELINE_PX_PER_SEC;
    var leftDur  = cutSec;
    var rightDur = dur - cutSec;
    if (leftDur <= 0 || rightDur <= 0) return false;

    // Shrink original (becomes the left half)
    clip.style.width = cutXInClip + 'px';
    clip.dataset.duration = String(leftDur);

    // Build the right half
    var right = document.createElement('div');
    right.className = clip.className.replace(/\s*selected\s*/, ' ');
    right.textContent = clip.dataset.fileName || '';
    right.dataset.fileName = clip.dataset.fileName || '';
    if (clip.dataset.mediaUrl)        right.dataset.mediaUrl = clip.dataset.mediaUrl;
    if (clip.dataset.serverFilename)  right.dataset.serverFilename = clip.dataset.serverFilename;
    right.dataset.duration = String(rightDur);
    right.dataset.sourceOffset = String(sourceOffset + cutSec);
    // Position + style — match original
    right.style.left = (left + cutXInClip) + 'px';
    right.style.width = (width - cutXInClip) + 'px';
    right.style.padding = '4px 8px';
    right.style.fontSize = '10px';
    right.style.overflow = 'hidden';
    right.style.textOverflow = 'ellipsis';
    right.style.whiteSpace = 'nowrap';
    right.style.userSelect = 'none';
    right.style.background = clip.style.background;
    right.style.color = clip.style.color;
    clip.parentNode.insertBefore(right, clip.nextSibling);
    makeClipInteractive(right);

    updateTimelineInfo();
    // Split changed which clip is under the playhead — refresh preview.
    _lastPreviewUrl = null;
    try { syncPreviewToPlayhead(); } catch(_){}
    if (_timelineState.snap && clip.classList.contains('mt-clip-video')){ compactVideoTrack(); }
    pushTimelineHistory();
    showToast('Clip split');
    return true;
  }

  function makeClipInteractive(clip){
    if (clip.dataset.interactive) return;
    clip.dataset.interactive = '1';

    // Tool-aware click behaviour:
    //   - Razor: split this clip at the click x position.
    //   - Select: select it (add .selected highlight).
    //   - Otherwise (default): let the timeline-area click handler run to
    //     move the playhead.
    clip.addEventListener('click', function(e){
      if (_timelineState.tool === 'razor'){
        e.stopPropagation();
        var rect = clip.getBoundingClientRect();
        razorSplit(clip, e.clientX - rect.left);
        return;
      }
      if (_timelineState.tool !== 'select') return;
      e.stopPropagation();
      document.querySelectorAll('.mt-clip.selected').forEach(function(c){ c.classList.remove('selected'); });
      clip.classList.add('selected');
    });

    // Drag to move — only when Select tool active.
    clip.addEventListener('mousedown', function(e){
      if (_timelineState.tool !== 'select') return;
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      var startX = e.clientX;
      var startLeft = parseFloat(clip.style.left) || 0;
      var width = parseFloat(clip.style.width) || clip.offsetWidth || 100;
      document.querySelectorAll('.mt-clip.selected').forEach(function(c){ c.classList.remove('selected'); });
      clip.classList.add('selected');
      function onMove(ev){
        var target = Math.max(0, startLeft + (ev.clientX - startX));
        target = applySnap(target, width, clip);
        var currentTrack = clip.parentElement;
        var isAudio = clip.classList.contains('mt-clip-audio');
        if (clipOverlaps(currentTrack, target, width, clip)){
          if (isAudio){
            // Audio: try to hop the clip to another audio track that has room.
            // If no free track exists, fall back to clamping so clips still
            // don't overlap.
            var freeTrack = findFreeAudioTrack(target, width, currentTrack, clip);
            if (freeTrack){
              freeTrack.appendChild(clip);
              currentTrack = freeTrack;
            } else {
              target = clampAwayFromOverlap(currentTrack, target, width, clip);
            }
          } else {
            // Video: never allow overlap — clamp to the nearest edge.
            target = clampAwayFromOverlap(currentTrack, target, width, clip);
          }
        }
        clip.style.left = target + 'px';
      }
      function onUp(){
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        // If Snap is on and this was a video clip, close any gap created
        // by the drag (keeps V1 side-by-side per Albert's requirement).
        if (_timelineState.snap && clip.classList.contains('mt-clip-video')){ compactVideoTrack(); }
        _lastPreviewUrl = null;
        try { syncPreviewToPlayhead(); } catch(_){}
        pushTimelineHistory();
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function addClipToTimeline(fileName, mediaType, duration, mediaUrl) {
    var track = findTargetTrack(mediaType);
    if (!track) { showToast('Timeline track not found'); return; }

    // Images default to 5 seconds when no explicit duration is provided
    // (no real duration on an image file). Videos/audio use the passed
    // duration or fall back to a 200px placeholder if unknown.
    var secs = parseFloat(duration) || 0;
    if (mediaType === 'img' && secs <= 0) secs = 5;
    var width = secs > 0 ? Math.max(40, secs * TIMELINE_PX_PER_SEC) : 200;
    var leftPos = findRightmostClipEnd(track);

    var clip = document.createElement('div');
    clip.className = 'mt-clip ' + (mediaType === 'aud' ? 'mt-clip-audio' : 'mt-clip-video');
    clip.textContent = fileName;
    clip.dataset.fileName = fileName;
    clip.dataset.clipType = mediaType; // 'vid' | 'aud' | 'img'
    if (secs > 0)    clip.dataset.duration = String(secs);
    if (mediaUrl)    clip.dataset.mediaUrl = mediaUrl;
    // position:absolute + top:3px + height:30px come from the base .mt-clip rule in CSS.
    clip.style.left = leftPos + 'px';
    clip.style.width = width + 'px';
    clip.style.padding = '4px 8px';
    clip.style.fontSize = '10px';
    clip.style.overflow = 'hidden';
    clip.style.textOverflow = 'ellipsis';
    clip.style.whiteSpace = 'nowrap';
    clip.style.userSelect = 'none';
    if (mediaType === 'aud') {
      clip.style.background = 'linear-gradient(135deg, #059669, #10b981)';
      clip.style.color = '#fff';
    } else if (mediaType === 'img') {
      // Distinct green/teal gradient so image clips are visually recognizable
      // against video clips on the same track.
      clip.style.background = 'linear-gradient(135deg, #22c55e, #06b6d4)';
      clip.style.color = '#fff';
    } else {
      clip.style.background = 'linear-gradient(135deg, #7c3aed, #6d28d9)';
      clip.style.color = '#fff';
    }

    track.appendChild(clip);
    makeClipInteractive(clip);
    updateTimelineInfo();
    // If Snap is on, enforce no-gap invariant for video clips.
    if (mediaType !== 'aud' && _timelineState.snap){ compactVideoTrack(); }
    pushTimelineHistory();
    showToast('Added to timeline: ' + fileName);
  }

  // Toolbar: Razor / Select (mutually exclusive) + Snap (independent boolean).
  function setActiveTool(tool){
    _timelineState.tool = tool;
    document.body.dataset.timelineTool = tool;
    var razor = document.getElementById('mtRazorBtn');
    var sel   = document.getElementById('mtSelectBtn');
    if (razor) razor.classList.toggle('active', tool === 'razor');
    if (sel)   sel.classList.toggle('active',   tool === 'select');
    if (tool !== 'select'){
      // Leaving select clears any highlighted clips.
      document.querySelectorAll('.mt-clip.selected').forEach(function(c){ c.classList.remove('selected'); });
    }
  }

  function setSnapEnabled(on){
    _timelineState.snap = !!on;
    var btn = document.getElementById('mtSnapBtn');
    if (btn) btn.classList.toggle('active', !!on);
  }

  // ── Timeline history (Undo / Redo) ─────────────────────────────
  // Full-snapshot history of all tracks' clips. Pushed after every
  // mutation (add / delete / move / split / compact). Undo pops back one
  // snapshot; Redo advances forward. Cap at 50 entries so we don't leak
  // memory on long sessions.
  var _tlHistory = [];
  var _tlHistoryIndex = -1;
  var _tlRestoring = false; // suppress history push while restoring
  var HISTORY_LIMIT = 50;

  function snapshotTimelineHistory(){
    var tracksAll = Array.from(document.querySelectorAll('#mtTracksArea .mt-track'));
    return tracksAll.map(function(track){
      return {
        type: track.getAttribute('data-type') || '',
        cls:  track.className,
        clips: Array.from(track.querySelectorAll('.mt-clip')).map(function(c){
          return {
            className: c.className,
            text: c.textContent,
            left: c.style.left,
            width: c.style.width,
            bg: c.style.background,
            color: c.style.color,
            fileName: c.dataset.fileName || '',
            mediaUrl: c.dataset.mediaUrl || '',
            serverFilename: c.dataset.serverFilename || '',
            duration: c.dataset.duration || '',
            sourceOffset: c.dataset.sourceOffset || ''
          };
        })
      };
    });
  }
  function restoreTimelineSnapshot(snap){
    if (!snap) return;
    _tlRestoring = true;
    try {
      var tracksArea = document.getElementById('mtTracksArea');
      var labelsArea = document.querySelector('.mt-labels');
      if (!tracksArea) return;
      // Remove any audio tracks beyond A1 that aren't in the snapshot —
      // simplest way to match user-added-track deletions.
      var desiredAudioCount = snap.filter(function(t){ return t.type === 'audio'; }).length;
      var existingAudioTracks = tracksArea.querySelectorAll('.mt-track-audio');
      while (existingAudioTracks.length > desiredAudioCount){
        var last = existingAudioTracks[existingAudioTracks.length - 1];
        last.remove();
        existingAudioTracks = tracksArea.querySelectorAll('.mt-track-audio');
      }
      var existingAudioLabels = labelsArea ? labelsArea.querySelectorAll('.mt-label-audio') : [];
      while (existingAudioLabels.length > desiredAudioCount){
        existingAudioLabels[existingAudioLabels.length - 1].remove();
        existingAudioLabels = labelsArea.querySelectorAll('.mt-label-audio');
      }
      // Recreate any missing audio tracks (beyond A1) — call Add Track repeatedly
      while (tracksArea.querySelectorAll('.mt-track-audio').length < desiredAudioCount){
        var addBtn = document.querySelector('.mt-add-track-btn');
        if (addBtn) addBtn.click();
        else break;
      }
      // Clear all clips
      tracksArea.querySelectorAll('.mt-clip').forEach(function(c){ c.remove(); });
      // Map snapshot tracks to actual tracks and rebuild clips
      var allTracks = tracksArea.querySelectorAll('.mt-track');
      snap.forEach(function(trackSpec, i){
        var track = allTracks[i];
        if (!track) return;
        trackSpec.clips.forEach(function(spec){
          var c = document.createElement('div');
          c.className = spec.className;
          c.textContent = spec.text;
          c.style.left = spec.left;
          c.style.width = spec.width;
          c.style.padding = '4px 8px';
          c.style.fontSize = '10px';
          c.style.overflow = 'hidden';
          c.style.textOverflow = 'ellipsis';
          c.style.whiteSpace = 'nowrap';
          c.style.userSelect = 'none';
          if (spec.bg)    c.style.background = spec.bg;
          if (spec.color) c.style.color = spec.color;
          if (spec.fileName)       c.dataset.fileName = spec.fileName;
          if (spec.mediaUrl)       c.dataset.mediaUrl = spec.mediaUrl;
          if (spec.serverFilename) c.dataset.serverFilename = spec.serverFilename;
          if (spec.duration)       c.dataset.duration = spec.duration;
          if (spec.sourceOffset)   c.dataset.sourceOffset = spec.sourceOffset;
          track.appendChild(c);
          makeClipInteractive(c);
        });
      });
      updateTimelineInfo();
      _lastPreviewUrl = null;
      try { syncPreviewToPlayhead(); } catch(_){}
    } finally { _tlRestoring = false; }
  }
  function pushTimelineHistory(){
    if (_tlRestoring) return;
    _tlHistory = _tlHistory.slice(0, _tlHistoryIndex + 1);
    _tlHistory.push(snapshotTimelineHistory());
    if (_tlHistory.length > HISTORY_LIMIT){
      _tlHistory.shift();
    }
    _tlHistoryIndex = _tlHistory.length - 1;
  }
  function tlUndo(){
    if (_tlHistoryIndex <= 0){ showToast('Nothing to undo'); return; }
    _tlHistoryIndex--;
    restoreTimelineSnapshot(_tlHistory[_tlHistoryIndex]);
    showToast('Undo');
  }
  function tlRedo(){
    if (_tlHistoryIndex >= _tlHistory.length - 1){ showToast('Nothing to redo'); return; }
    _tlHistoryIndex++;
    restoreTimelineSnapshot(_tlHistory[_tlHistoryIndex]);
    showToast('Redo');
  }
  // Capture initial empty state so first undo has somewhere to go.
  setTimeout(pushTimelineHistory, 200);

  // ── Snap compaction (no-gap enforcement on V1 when Snap ON) ────
  function compactVideoTrack(){
    var track = document.querySelector('.mt-track-video');
    if (!track) return;
    var clips = Array.from(track.querySelectorAll('.mt-clip'))
      .sort(function(a, b){ return (parseFloat(a.style.left)||0) - (parseFloat(b.style.left)||0); });
    var cursor = 0;
    clips.forEach(function(c){
      c.style.left = cursor + 'px';
      cursor += (parseFloat(c.style.width) || 0);
    });
  }

  // ── Program Monitor simulation ──────────────────────────────────
  // A toggleable <canvas> overlay that COMPOSITES the timeline frame-by-frame.
  // Unlike the main <video> element (which only ever plays one source), the
  // PGM canvas reads the clip at the current playhead position every frame
  // and renders it — so cuts between clips, razor splits, image clips, and
  // gaps all show up on a single output surface the way they would in a
  // program monitor.
  //
  // Limits of this simulation (flagged in the watermark):
  //   - Audio is not mixed: the main <video>'s own audio still plays.
  //   - No transitions / effects / layering — just the topmost clip.
  //   - Image sources are drawn statically; video sources seek to the right
  //     frame each RAF tick using video.currentTime = offsetSec.
  var _progEnabled = false;
  var _progRAF = null;
  var _progMediaCache = {};        // key = 'type|url' -> <video>|<img>
  var _progSeekPending = {};       // suppress redundant seeks
  function getOrCreateProgSource(url, type){
    if (!url) return null;
    var key = type + '|' + url;
    if (_progMediaCache[key]) return _progMediaCache[key];
    var el;
    if (type === 'img'){
      el = new Image();
      el.crossOrigin = 'anonymous';
      el.src = url;
    } else {
      el = document.createElement('video');
      el.muted = true;
      el.playsInline = true;
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      el.src = url;
      // Hidden source — we draw it onto the canvas, it never renders on-page.
      el.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none';
      document.body.appendChild(el);
    }
    _progMediaCache[key] = el;
    return el;
  }
  function progDrawContain(ctx, src, W, H, sW, sH){
    if (!sW || !sH) return;
    var srcAspect = sW / sH;
    var dstAspect = W / H;
    var dw, dh;
    if (srcAspect > dstAspect){ dw = W; dh = W / srcAspect; }
    else                     { dh = H; dw = H * srcAspect; }
    ctx.drawImage(src, (W - dw)/2, (H - dh)/2, dw, dh);
  }
  function ensureProgramMonitor(){
    var existing = document.getElementById('tlProgMonitor');
    if (existing instanceof HTMLCanvasElement && existing.isConnected) return existing;
    var player = document.getElementById('videoPlayer') || document.querySelector('video');
    if (!(player instanceof Element)) return null;
    var container = player.parentElement;
    if (!(container instanceof Element)) return null;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    var canvas = (existing instanceof HTMLCanvasElement) ? existing : document.createElement('canvas');
    canvas.id = 'tlProgMonitor';
    canvas.width  = 1280;
    canvas.height = 720;
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;background:#000;z-index:7;display:none;pointer-events:none';
    try { container.appendChild(canvas); } catch(_){ return null; }
    return canvas;
  }
  function ensureProgramToggleBtn(){
    var existing = document.getElementById('tlProgBtn');
    if (existing instanceof HTMLButtonElement && existing.isConnected) return existing;
    var player = document.getElementById('videoPlayer') || document.querySelector('video');
    if (!(player instanceof Element)) return null;
    var container = player.parentElement;
    if (!(container instanceof Element)) return null;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    var btn = (existing instanceof HTMLButtonElement) ? existing : document.createElement('button');
    btn.id = 'tlProgBtn';
    btn.type = 'button';
    btn.title = 'Program Monitor — composited preview of the full timeline';
    btn.textContent = 'PGM';
    btn.style.cssText = 'position:absolute;top:10px;right:10px;z-index:8;padding:5px 11px;font-size:10px;font-weight:800;letter-spacing:.6px;color:#e2e0f0;background:rgba(15,10,30,.75);border:1px solid rgba(139,92,246,.55);border-radius:6px;cursor:pointer;backdrop-filter:blur(4px)';
    if (!btn.dataset.v14){
      btn.dataset.v14 = '1';
      btn.addEventListener('click', toggleProgramMonitor);
    }
    try { container.appendChild(btn); } catch(_){ return null; }
    return btn;
  }
  function progLoop(){
    if (!_progEnabled) { if (_progRAF){ cancelAnimationFrame(_progRAF); _progRAF = null; } return; }
    var canvas = ensureProgramMonitor();
    if (!canvas){ _progRAF = requestAnimationFrame(progLoop); return; }
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;

    // Clear to black (this is also what shows during gaps).
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    var ph = document.getElementById('mtPlayhead');
    var phX = ph ? (parseFloat(ph.style.left) || 0) : 0;
    var hit = getClipAtPlayheadX(phX);
    if (hit){
      var clip = hit.clip;
      var type = clip.dataset.clipType || (clip.classList.contains('mt-clip-audio') ? 'aud' : 'vid');
      var url  = clip.dataset.mediaUrl;
      if (type === 'aud'){
        // Audio-only clip at V1's range would not happen (audio clips live on
        // .mt-track-audio). Find the topmost video/image on V1 for visuals and
        // fall back to black here.
      } else if (type === 'img' && url){
        var img = getOrCreateProgSource(url, 'img');
        if (img && img.complete && img.naturalWidth > 0){
          progDrawContain(ctx, img, W, H, img.naturalWidth, img.naturalHeight);
        }
      } else if (url){
        var vid = getOrCreateProgSource(url, 'vid');
        var sourceOffset = parseFloat(clip.dataset.sourceOffset) || 0;
        var seekSec = sourceOffset + (hit.offsetPx / TIMELINE_PX_PER_SEC);
        if (vid){
          // Seek only when drift > 0.1s (avoid spamming currentTime on every RAF).
          if (vid.readyState >= 1 && Math.abs((vid.currentTime||0) - seekSec) > 0.1){
            var pkey = 'vid|'+url;
            if (!_progSeekPending[pkey]){
              _progSeekPending[pkey] = true;
              try { vid.currentTime = Math.max(0, seekSec); } catch(_){}
              var clear = function(){ _progSeekPending[pkey] = false; vid.removeEventListener('seeked', clear); };
              vid.addEventListener('seeked', clear, {once:true});
              setTimeout(function(){ _progSeekPending[pkey] = false; }, 300);
            }
          }
          if (vid.readyState >= 2 && vid.videoWidth){
            progDrawContain(ctx, vid, W, H, vid.videoWidth, vid.videoHeight);
          } else {
            // Still loading — draw a subtle loading indicator
            ctx.fillStyle = 'rgba(139,92,246,.3)';
            ctx.fillRect(0, H - 2, W, 2);
          }
        }
      }
    }

    // Watermark so the user knows this is a simulation — NOT the final export.
    ctx.fillStyle = 'rgba(139,92,246,.95)';
    ctx.font = 'bold 14px -apple-system,system-ui,sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText('PGM \u00B7 simulation', 12, 12);
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.font = '11px -apple-system,system-ui,sans-serif';
    ctx.fillText('not final export (audio / transitions not rendered)', 12, 30);

    _progRAF = requestAnimationFrame(progLoop);
  }
  function toggleProgramMonitor(){
    _progEnabled = !_progEnabled;
    var canvas = ensureProgramMonitor();
    var btn = ensureProgramToggleBtn();
    if (canvas) canvas.style.display = _progEnabled ? 'block' : 'none';
    if (btn){
      btn.textContent = _progEnabled ? 'PGM \u25CF' : 'PGM';
      btn.style.background = _progEnabled ? 'rgba(139,92,246,.85)' : 'rgba(15,10,30,.75)';
      btn.style.color = _progEnabled ? '#fff' : '#e2e0f0';
    }
    if (_progEnabled){
      progLoop();
      showToast('Program Monitor on \u2014 composited timeline preview');
    } else {
      if (_progRAF){ cancelAnimationFrame(_progRAF); _progRAF = null; }
      showToast('Program Monitor off');
    }
  }
  // Create the toggle button as soon as the video player is reachable.
  (function retryWireProgBtn(){
    if (ensureProgramToggleBtn()) return;
    var tries = 0;
    var iv = setInterval(function(){
      tries++;
      if (ensureProgramToggleBtn() || tries > 40) clearInterval(iv);
    }, 250);
  })();

  // ── Black overlay + continuous playback through gaps ───────────
  function ensureBlackOverlay(){
    var existing = document.getElementById('tlBlackOverlay');
    if (existing instanceof Element && existing.isConnected) return existing;
    var player = document.getElementById('videoPlayer') || document.querySelector('video');
    if (!(player instanceof Element)) return null;
    var container = player.parentElement;
    if (!(container instanceof Element)) return null;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    var overlay = (existing instanceof Element) ? existing : document.createElement('div');
    overlay.id = 'tlBlackOverlay';
    overlay.style.cssText = 'position:absolute;inset:0;background:#000;z-index:5;pointer-events:none;display:none';
    try { container.appendChild(overlay); } catch(_){ return null; }
    return overlay;
  }
  // Image preview: an <img> overlay layered above the video element for when
  // the playhead is over an image clip (HTML <video> can't render images).
  function ensureImageOverlay(){
    var existing = document.getElementById('tlImageOverlay');
    if (existing && existing.isConnected && existing.tagName === 'IMG') return existing;
    var player = document.getElementById('videoPlayer') || document.querySelector('video');
    if (!player || !(player instanceof Element)) return null;
    var container = player.parentElement;
    if (!container || !(container instanceof Element)) return null;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    // If there's a stale non-IMG element holding that id, replace it.
    if (existing && existing.tagName !== 'IMG'){
      try { existing.remove(); } catch(_){}
      existing = null;
    }
    var img;
    if (existing instanceof Element && existing.tagName === 'IMG'){
      img = existing;
    } else {
      img = document.createElement('img');
    }
    img.id = 'tlImageOverlay';
    img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;z-index:6;pointer-events:none;display:none';
    try { container.appendChild(img); } catch(_){ return null; }
    return img;
  }
  function showImagePreview(url){
    var img = ensureImageOverlay();
    if (!img) return;
    if (img.src !== url) img.src = url;
    img.style.display = 'block';
  }
  function hideImagePreview(){
    var img = document.getElementById('tlImageOverlay');
    if (img) img.style.display = 'none';
  }
  function showBlackPreview(){
    var o = ensureBlackOverlay();
    if (o) o.style.display = 'block';
  }
  function hideBlackPreview(){
    var o = document.getElementById('tlBlackOverlay');
    if (o) o.style.display = 'none';
  }

  // Animate the playhead across an empty gap, then auto-play the next clip.
  var _gapTimer = null;
  function advancePlayheadThroughGap(startX){
    var ph = document.getElementById('mtPlayhead');
    if (!ph) return;
    var clips = Array.from(document.querySelectorAll('.mt-track-video .mt-clip'))
      .sort(function(a,b){ return (parseFloat(a.style.left)||0)-(parseFloat(b.style.left)||0); });
    var next = null;
    for (var i = 0; i < clips.length; i++){
      var l = parseFloat(clips[i].style.left)||0;
      if (l > startX + 0.5) { next = clips[i]; break; }
    }
    if (!next){
      showBlackPreview();
      return;
    }
    showBlackPreview();
    var endX = parseFloat(next.style.left);
    var gapPx = endX - startX;
    if (gapPx <= 1){
      loadAndPlayClipAt(next, 0);
      return;
    }
    var gapMs = (gapPx / TIMELINE_PX_PER_SEC) * 1000;
    var tStart = Date.now();
    if (_gapTimer) clearInterval(_gapTimer);
    _gapTimer = setInterval(function(){
      var elapsed = Date.now() - tStart;
      if (elapsed >= gapMs){
        clearInterval(_gapTimer); _gapTimer = null;
        ph.style.left = endX + 'px';
        loadAndPlayClipAt(next, 0);
        return;
      }
      ph.style.left = (startX + (elapsed / gapMs) * gapPx) + 'px';
    }, 33);
  }
  function loadAndPlayClipAt(clip, offsetPx){
    if (!clip) return;
    var url = clip.dataset.mediaUrl;
    var player = document.getElementById('videoPlayer') || document.querySelector('video');
    if (!player) return;
    var sourceOffset = parseFloat(clip.dataset.sourceOffset) || 0;
    var seekSec = sourceOffset + (offsetPx / TIMELINE_PX_PER_SEC);
    hideBlackPreview();
    var normalizedCurrent = player.src;
    var normalizedTarget = url ? normalizeUrl(url) : '';
    if (url && normalizedCurrent !== normalizedTarget){
      _lastPreviewUrl = url;
      player.src = url;
      player.load();
      player.addEventListener('loadedmetadata', function once(){
        player.removeEventListener('loadedmetadata', once);
        try { player.currentTime = seekSec; } catch(_){}
        try { player.play(); } catch(_){}
      }, {once:true});
    } else {
      try { player.currentTime = seekSec; } catch(_){}
      try { player.play(); } catch(_){}
    }
  }

  // Proxy used only as a fallback in case the direct timeline undo/redo
  // hasn't been set up yet (shouldn't happen in practice).
  function clickIfExists(id){
    var el = document.getElementById(id);
    if (el) el.click();
    else if (typeof showToast === 'function') showToast('Nothing to do');
  }

  function wireTimelineTools(){
    var razor = document.getElementById('mtRazorBtn');
    var sel   = document.getElementById('mtSelectBtn');
    var snap  = document.getElementById('mtSnapBtn');
    var undo  = document.getElementById('mtUndoBtn');
    var redo  = document.getElementById('mtRedoBtn');
    var snapshot = document.getElementById('mtSnapshotBtn');
    var linkTracks = document.getElementById('mtLinkTracksBtn');
    if (razor && !razor.dataset.v14){
      razor.dataset.v14 = '1';
      razor.addEventListener('click', function(){ setActiveTool('razor'); showToast('Razor tool'); });
    }
    if (sel && !sel.dataset.v14){
      sel.dataset.v14 = '1';
      sel.addEventListener('click', function(){
        // Toggle behaviour: click Select when active to switch back to Razor.
        if (_timelineState.tool === 'select') {
          setActiveTool('razor');
          showToast('Select tool off');
        } else {
          setActiveTool('select');
          showToast('Select tool \u2014 click a clip to highlight, drag to move');
        }
      });
    }
    // ESC also deactivates Select (maps to Razor, which is the default).
    if (!document.body.dataset.v14Esc) {
      document.body.dataset.v14Esc = '1';
      document.addEventListener('keydown', function(e){
        if (e.key === 'Escape' && _timelineState.tool === 'select'){
          setActiveTool('razor');
        }
      });
    }
    if (snap && !snap.dataset.v14){
      snap.dataset.v14 = '1';
      snap.addEventListener('click', function(){
        _timelineState.snap = !_timelineState.snap;
        setSnapEnabled(_timelineState.snap);
        showToast('Snap ' + (_timelineState.snap ? 'on' : 'off'));
        if (_timelineState.snap){
          // When Snap toggles ON, immediately close all gaps on V1 so clips
          // are side-by-side (Albert's "Gap Management" requirement).
          compactVideoTrack();
          _lastPreviewUrl = null;
          try { syncPreviewToPlayhead(); } catch(_){}
          pushTimelineHistory();
        }
      });
    }
    if (undo && !undo.dataset.v14){
      undo.dataset.v14 = '1';
      // Use the timeline history stack so Undo reverts clip add/move/
      // delete/split. The editor's own undo (inside the tools-section) is
      // still reachable via its original #undoBtn button.
      undo.addEventListener('click', tlUndo);
    }
    if (redo && !redo.dataset.v14){
      redo.dataset.v14 = '1';
      redo.addEventListener('click', tlRedo);
    }
    if (snapshot && !snapshot.dataset.v14){
      snapshot.dataset.v14 = '1';
      snapshot.addEventListener('click', function(){
        var player = document.getElementById('videoPlayer') || document.querySelector('video');
        if (!player || !player.videoWidth || !player.videoHeight){
          showToast('Cannot snapshot \u2014 no video loaded');
          return;
        }
        try {
          var canvas = document.createElement('canvas');
          canvas.width  = player.videoWidth;
          canvas.height = player.videoHeight;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(player, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(function(blob){
            if (!blob){ showToast('Snapshot failed'); return; }
            var url = URL.createObjectURL(blob);
            // Counter persists across snapshots in this page session so the
            // filenames increment sequentially (screenshot_01, _02, ...).
            window.__snapshotCounter = (window.__snapshotCounter || 0) + 1;
            var n = window.__snapshotCounter;
            var name = 'screenshot_' + (n < 10 ? '0' + n : n) + '.png';
            // Push to Media library via the shared helper — this makes the
            // new image show up under both Images and All tabs immediately
            // AND auto-place on V1 (same flow as a regular upload).
            if (typeof window.addUploadedMediaItem === 'function'){
              var item = window.addUploadedMediaItem({
                name: name,
                filename: name,
                serveUrl: url,
                mediaType: 'img'
              });
              // Also auto-place on V1 as a 5s clip.
              try { addClipToTimeline(name, 'img', 5, url); } catch(_){}
            }
            showToast('Snapshot saved: ' + name);
          }, 'image/png');
        } catch(err){
          showToast('Snapshot failed: ' + (err && err.message || 'unknown error'));
        }
      });
    }
    if (linkTracks && !linkTracks.dataset.v14){
      linkTracks.dataset.v14 = '1';
      linkTracks.addEventListener('click', function(){
        linkTracks.classList.toggle('active');
        showToast('Tracks ' + (linkTracks.classList.contains('active') ? 'linked' : 'unlinked'));
      });
    }
    // Apply initial visual state (Razor active, Snap on by default).
    setActiveTool(_timelineState.tool);
    setSnapEnabled(_timelineState.snap);
  }
  wireTimelineTools();

  // Save as Draft button — serialize timeline state into the Drafts localStorage
  // store (window.addDraftEntry, already defined in v10-editor-redesign.js).
  // The Projects UI that renders drafts is hidden for now per Albert's earlier
  // request, but the data still persists so it can be restored when a Drafts
  // view is added back.
  function snapshotTimelineState(){
    var clips = Array.from(document.querySelectorAll('.mt-clip')).map(function(c){
      var track = c.parentElement;
      return {
        track:        (track && track.getAttribute('data-type')) || 'video',
        trackIndex:   track ? Array.from(track.parentElement.querySelectorAll('.mt-track')).indexOf(track) : 0,
        left:         c.style.left,
        width:        c.style.width,
        duration:     c.dataset.duration || '',
        sourceOffset: c.dataset.sourceOffset || '0',
        mediaUrl:     c.dataset.mediaUrl || '',
        filename:     c.dataset.fileName || ''
      };
    });
    var current = (typeof window.currentVideoFile === 'object' && window.currentVideoFile) || null;
    var firstVid = clips.find(function(c){ return c.track === 'video'; });
    return {
      id:       'd_' + Date.now(),
      name:     (current && current.filename) || (firstVid && firstVid.filename) || 'Untitled draft',
      filename: current && current.filename,
      serveUrl: current && current.serveUrl,
      duration: current && current.duration,
      date:     new Date().toLocaleDateString(undefined, {month:'short', day:'numeric'}),
      timelineClips: clips
    };
  }
  function wireSaveAsDraft(){
    var btn = document.getElementById('saveAsDraftBtn');
    if (!btn || btn.dataset.v14) return;
    btn.dataset.v14 = '1';
    btn.addEventListener('click', function(){
      var state = snapshotTimelineState();
      if (!state.timelineClips.length && !state.filename){
        showToast('Nothing to save yet \u2014 add a clip or upload a video first');
        return;
      }
      if (typeof window.addDraftEntry === 'function'){
        try { window.addDraftEntry(state); } catch(_){}
      }
      showToast('Draft saved (' + state.timelineClips.length + ' clip' + (state.timelineClips.length === 1 ? '' : 's') + ')');
    });
  }
  wireSaveAsDraft();

  // Keyboard: Delete / Backspace removes selected clips from the timeline.
  // Only fires when the user is NOT typing in a real input — so the backspace
  // doesn't delete a clip while someone edits a text field.
  if (!document.body.dataset.v14Del){
    document.body.dataset.v14Del = '1';
    document.addEventListener('keydown', function(e){
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      var t = e.target;
      var tag = (t && t.tagName) || '';
      var isTyping = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (t && t.isContentEditable);
      if (isTyping) return;
      var selected = document.querySelectorAll('.mt-clip.selected');
      if (!selected.length) return;
      e.preventDefault();
      var removedVideo = Array.from(selected).some(function(c){ return c.classList.contains('mt-clip-video'); });
      selected.forEach(function(c){ c.remove(); });
      updateTimelineInfo();
      if (removedVideo && _timelineState.snap){ compactVideoTrack(); }
      _lastPreviewUrl = null;
      try { syncPreviewToPlayhead(); } catch(_){}
      pushTimelineHistory();
      showToast(selected.length === 1 ? 'Clip removed' : (selected.length + ' clips removed'));
    });
  }

  // Expose so v10 draft loader and other callers reuse the sequenced version.
  try { window.addClipToTimeline = addClipToTimeline; } catch(_){}

  // Active preview: when the playhead is over a video clip, load that clip's
  // media into the preview window at the correct time offset. This makes the
  // playhead a real scrub bar across the whole sequence rather than being
  // stuck on the first uploaded clip.
  var _lastPreviewUrl = null;
  function getClipAtPlayheadX(phX){
    var clips = document.querySelectorAll('.mt-track-video .mt-clip');
    for (var i = 0; i < clips.length; i++){
      var c = clips[i];
      var l = parseFloat(c.style.left) || 0;
      var w = parseFloat(c.style.width) || 0;
      if (phX >= l && phX <= l + w) return {clip: c, offsetPx: phX - l};
    }
    return null;
  }
  function syncPreviewToPlayhead(){
    var ph = document.getElementById('mtPlayhead');
    if (!ph) return;
    var phX = parseFloat(ph.style.left) || 0;
    var hit = getClipAtPlayheadX(phX);
    if (!hit){
      // Playhead is over a gap — show black overlay.
      hideImagePreview();
      showBlackPreview();
      return;
    }
    hideBlackPreview();
    var clip = hit.clip;
    var url = clip.dataset.mediaUrl;
    // Image clips render as an <img> overlay above the video preview.
    if (clip.dataset.clipType === 'img'){
      if (url) showImagePreview(url);
      return;
    }
    hideImagePreview();
    if (!url) return;
    var player = document.getElementById('videoPlayer') || document.querySelector('video');
    if (!player) return;
    // Respect the source-offset stored on razor-split pieces so each half
    // plays from the correct point inside the original source.
    var sourceOffset = parseFloat(clip.dataset.sourceOffset) || 0;
    var seekTime = sourceOffset + (hit.offsetPx / TIMELINE_PX_PER_SEC);
    if (_lastPreviewUrl !== url){
      _lastPreviewUrl = url;
      try { player.src = url; player.load(); } catch(_){}
      var trySeek = function(){
        try { player.currentTime = Math.max(0, Math.min((player.duration||seekTime), seekTime)); } catch(_){}
      };
      player.addEventListener('loadedmetadata', trySeek, {once:true});
      trySeek();
      try {
        window.currentVideoFile = {
          filename: clip.dataset.serverFilename || clip.dataset.fileName,
          serveUrl: url,
          duration: parseFloat(clip.dataset.duration) || 0
        };
      } catch(_){}
    } else {
      try { player.currentTime = Math.max(0, Math.min((player.duration||seekTime), seekTime)); } catch(_){}
    }
  }
  try { window.syncPreviewToPlayhead = syncPreviewToPlayhead; } catch(_){}

  // Reverse sync: as the video plays, walk the playhead across the timeline
  // so the user can visually track where they are in the sequence. Matches
  // the loaded video.src back to a clip on V1 by dataset.mediaUrl, then
  // positions the playhead at clip.left + currentTime * PX_PER_SEC.
  // HTMLMediaElement.src is always absolute; dataset.mediaUrl may be a
  // relative path like '/uploads/abc.mp4'. Normalize both to compare.
  function normalizeUrl(u){
    try { return new URL(u, location.href).href; } catch(_){ return u; }
  }
  function findClipForPlayer(video){
    if (!video || !video.src) return null;
    var src = video.src;
    var clips = document.querySelectorAll('.mt-track-video .mt-clip');
    var ct = video.currentTime || 0;
    // Prefer a clip whose source range [sourceOffset, sourceOffset+duration]
    // contains the current video time — this matters for razor-split pieces
    // that share the same mediaUrl but represent different slices.
    for (var i = 0; i < clips.length; i++){
      var c = clips[i];
      if (!c.dataset.mediaUrl) continue;
      if (normalizeUrl(c.dataset.mediaUrl) !== src) continue;
      var srcOff = parseFloat(c.dataset.sourceOffset) || 0;
      var dur    = parseFloat(c.dataset.duration)    || 0;
      if (ct >= srcOff - 0.01 && ct <= srcOff + dur + 0.01) return c;
    }
    // Fallback: first clip with matching src.
    for (var j = 0; j < clips.length; j++){
      if (clips[j].dataset.mediaUrl && normalizeUrl(clips[j].dataset.mediaUrl) === src) return clips[j];
    }
    return null;
  }
  function syncPlayheadToVideo(){
    var video = document.getElementById('videoPlayer') || document.querySelector('video');
    if (!video) return;
    var clip = findClipForPlayer(video);
    if (!clip) return;
    var clipLeft = parseFloat(clip.style.left) || 0;
    var srcOff   = parseFloat(clip.dataset.sourceOffset) || 0;
    var timeInClip = (video.currentTime || 0) - srcOff;
    var x = clipLeft + Math.max(0, timeInClip) * TIMELINE_PX_PER_SEC;
    var ph = document.getElementById('mtPlayhead');
    if (ph) ph.style.left = x + 'px';
  }
  function wireVideoPlayheadSync(){
    var video = document.getElementById('videoPlayer') || document.querySelector('video');
    if (!video || video.dataset.v14PlayheadSync) return;
    video.dataset.v14PlayheadSync = '1';
    video.addEventListener('timeupdate', syncPlayheadToVideo);
    video.addEventListener('seeked',     syncPlayheadToVideo);
    video.addEventListener('play',       syncPlayheadToVideo);
    // Continuous playback: when this clip ends, auto-advance through any
    // gap to the next video clip and resume. If the playhead is already at
    // the end of the sequence, just show the black overlay.
    video.addEventListener('ended', function(){
      var ph = document.getElementById('mtPlayhead');
      if (!ph) return;
      // Align playhead exactly to the end of the currently-playing clip.
      var clips = document.querySelectorAll('.mt-track-video .mt-clip');
      var src = video.src;
      var endedClip = null;
      for (var i = 0; i < clips.length; i++){
        var c = clips[i];
        if (!c.dataset.mediaUrl) continue;
        if (normalizeUrl(c.dataset.mediaUrl) !== src) continue;
        var srcOff = parseFloat(c.dataset.sourceOffset) || 0;
        var dur    = parseFloat(c.dataset.duration)    || 0;
        // Pick the clip whose range we were playing
        if (video.duration && Math.abs(video.currentTime - (srcOff + dur)) < 0.6){ endedClip = c; break; }
      }
      var startX;
      if (endedClip){
        startX = (parseFloat(endedClip.style.left)||0) + (parseFloat(endedClip.style.width)||0);
      } else {
        startX = parseFloat(ph.style.left) || 0;
      }
      ph.style.left = startX + 'px';
      advancePlayheadThroughGap(startX);
    });
  }
  wireVideoPlayheadSync();
  // If the <video> element is injected/replaced later, re-wire once it exists.
  var _playheadSyncTries = 0;
  var _playheadSyncInterval = setInterval(function(){
    wireVideoPlayheadSync();
    _playheadSyncTries++;
    if (_playheadSyncTries > 40) clearInterval(_playheadSyncInterval); // 40 * 250ms = 10s
  }, 250);

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
      addClipToTimeline(fileName, mediaType, item.dataset.duration);
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
        addClipToTimeline(fileName, mediaType, item.dataset.duration, item.dataset.mediaUrl);
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
