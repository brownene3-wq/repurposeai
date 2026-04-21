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
      // Images go on V1 with a 5-second default duration (addClipToTimeline
      // applies the 5s fallback when duration is 0 for image clips).
      if (mediaType === 'img'){
        try { addClipToTimeline(file.name, 'img', 0, url); } catch(_){}
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
  var _timelineState = { tool: 'select', snap: true };

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
      if (e.shiftKey){
        // Shift+click toggles this clip in/out of the selection without
        // disturbing the other selected clips \u2014 enables additive
        // multi-select so broadcast edits can target a curated set.
        clip.classList.toggle('selected');
      } else {
        document.querySelectorAll('.mt-clip.selected').forEach(function(c){ c.classList.remove('selected'); });
        clip.classList.add('selected');
      }
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

    attachTrimHandles(clip);
    refreshKeyframeMarkers(clip);
  }

  // ── Trim handles ────────────────────────────────────────────────
  // Left and right 8px grip zones inside each clip. Hidden at rest,
  // visible on clip hover (or while it's selected). Drag behaviors:
  //   • Left handle:  shifts `left` + shrinks `width` + advances
  //                   `sourceOffset` so the clip's right edge stays
  //                   anchored to the same source frame.
  //   • Right handle: adjusts `width` only (trims the tail).
  // Both clamp to a 15px minimum, respect track boundaries, prevent
  // overlap with neighbors, respect the source's remaining length for
  // media clips, and apply timeline snap when enabled.
  function attachTrimHandles(clip){
    if (clip.querySelector('.mt-clip-trim')) return;

    var lh = document.createElement('div');
    lh.className = 'mt-clip-trim mt-trim-l';
    var rh = document.createElement('div');
    rh.className = 'mt-clip-trim mt-trim-r';
    clip.appendChild(lh);
    clip.appendChild(rh);

    // Prevent clicks on handles from propagating to clip (razor/select)
    ['click','dblclick'].forEach(function(ev){
      lh.addEventListener(ev, function(e){ e.stopPropagation(); });
      rh.addEventListener(ev, function(e){ e.stopPropagation(); });
    });

    function startTrim(side, e){
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      var startX      = e.clientX;
      var startLeft   = parseFloat(clip.style.left)  || 0;
      var startWidth  = parseFloat(clip.style.width) || clip.offsetWidth || 100;
      var startSrcOff = parseFloat(clip.dataset.sourceOffset) || 0;
      var srcDur      = parseFloat(clip.dataset.duration)     || 0;
      var clipType    = clip.dataset.clipType || '';
      var isMedia     = (clipType === 'vid' || clipType === 'aud');
      var track       = clip.parentElement;
      var MIN_W       = 15;
      clip.classList.add('mt-trimming');

      function onMove(ev){
        var dx = ev.clientX - startX;

        if (side === 'l'){
          var newLeft   = startLeft + dx;
          var newWidth  = startWidth - dx;
          var newSrcOff = startSrcOff + dx / TIMELINE_PX_PER_SEC;

          // Clamp: min width (clamps dx via reverse-computation)
          if (newWidth < MIN_W){
            dx = startWidth - MIN_W;
            newLeft = startLeft + dx;
            newWidth = MIN_W;
            newSrcOff = startSrcOff + dx / TIMELINE_PX_PER_SEC;
          }
          // Clamp: can't expose source content before time 0
          if (isMedia && newSrcOff < 0){
            dx = -startSrcOff * TIMELINE_PX_PER_SEC;
            newLeft = startLeft + dx;
            newWidth = startWidth - dx;
            newSrcOff = 0;
          }
          // Clamp: track boundary
          if (newLeft < 0){
            var boundaryDx = -startLeft;
            newLeft = 0;
            newWidth = startWidth - boundaryDx;
            newSrcOff = startSrcOff + boundaryDx / TIMELINE_PX_PER_SEC;
          }
          // Snap left edge (if snap is on)
          var snappedLeft = applySnap(newLeft, newWidth, clip);
          if (snappedLeft !== newLeft){
            var snapDx = snappedLeft - startLeft;
            newLeft   = snappedLeft;
            newWidth  = startWidth - snapDx;
            newSrcOff = startSrcOff + snapDx / TIMELINE_PX_PER_SEC;
            if (newWidth < MIN_W){ newLeft = startLeft + (startWidth - MIN_W); newWidth = MIN_W; }
          }
          // Overlap with neighbors
          if (clipOverlaps(track, newLeft, newWidth, clip)) return;

          clip.style.left  = newLeft  + 'px';
          clip.style.width = newWidth + 'px';
          clip.dataset.sourceOffset = newSrcOff.toFixed(3);
          // For NON-media clips (text/image/motion) keep duration in sync
          // with timeline width since they don't track a source length.
          if (!isMedia) clip.dataset.duration = (newWidth / TIMELINE_PX_PER_SEC).toFixed(3);
        } else {
          // Right handle: width = startWidth + dx
          var newW = startWidth + dx;
          if (newW < MIN_W) newW = MIN_W;
          // Clamp: max width = remaining source
          if (isMedia && srcDur > 0){
            var maxW = (srcDur - startSrcOff) * TIMELINE_PX_PER_SEC;
            if (maxW > 0 && newW > maxW) newW = maxW;
          }
          // Overlap with right neighbor
          if (clipOverlaps(track, startLeft, newW, clip)) return;

          clip.style.width = newW + 'px';
          if (!isMedia) clip.dataset.duration = (newW / TIMELINE_PX_PER_SEC).toFixed(3);
        }
      }

      function onUp(){
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        clip.classList.remove('mt-trimming');
        _lastPreviewUrl = null;
        try { syncPreviewToPlayhead(); } catch(_){}
        if (_timelineState.snap && clip.classList.contains('mt-clip-video')){ compactVideoTrack(); }
        // Keyframe markers are positioned as % of clip width; refresh
        // their placement now that the width may have changed.
        try { refreshKeyframeMarkers(clip); } catch(_){}
        pushTimelineHistory();
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    lh.addEventListener('mousedown', function(e){ startTrim('l', e); });
    rh.addEventListener('mousedown', function(e){ startTrim('r', e); });
  }

  // Retrofit trim handles onto clips that existed before this code loaded
  // (e.g. restored-from-snapshot clips). Re-run on every snapshot restore
  // via the existing makeClipInteractive path.
  try {
    document.querySelectorAll('.mt-clip').forEach(attachTrimHandles);
  } catch(_){}

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
    // Auto-enable the Program Monitor the first time the user adds any
    // content to the timeline — makes PGM the default view for uploads.
    if (!_progAutoEnabledOnce && !_progEnabled){
      _progAutoEnabledOnce = true;
      try { toggleProgramMonitor(); } catch(_){}
    }
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
            sourceOffset: c.dataset.sourceOffset || '',
            clipType: c.dataset.clipType || '',
            textContent: c.dataset.textContent || '',
            fontSize: c.dataset.fontSize || '',
            textColor: c.dataset.textColor || '',
            position: c.dataset.position || '',
            motionEffect: c.dataset.motionEffect || '',
            scale: c.dataset.scale || '',
            rotate: c.dataset.rotate || '',
            flipH: c.dataset.flipH || '',
            flipV: c.dataset.flipV || '',
            offsetX: c.dataset.offsetX || '',
            offsetY: c.dataset.offsetY || '',
            speed: c.dataset.speed || '',
            reverse: c.dataset.reverse || '',
            loop: c.dataset.loop || '',
            freeze: c.dataset.freeze || '',
            trimIn: c.dataset.trimIn || '',
            trimOut: c.dataset.trimOut || '',
            crop: c.dataset.crop || '',
            fxBrightness: c.dataset.fxBrightness || '',
            fxContrast:   c.dataset.fxContrast   || '',
            fxSaturate:   c.dataset.fxSaturate   || '',
            fxBlur:       c.dataset.fxBlur       || '',
            fxHue:        c.dataset.fxHue        || '',
            fxColorGrade: c.dataset.fxColorGrade || '',
            fxGlow:       c.dataset.fxGlow       || '',
            fxVignette:   c.dataset.fxVignette   || '',
            fxGrain:      c.dataset.fxGrain      || '',
            fxSharpen:    c.dataset.fxSharpen    || '',
            fxChromatic:  c.dataset.fxChromatic  || '',
            fxPixelate:   c.dataset.fxPixelate   || '',
            volume:       c.dataset.volume       || '',
            muted:        c.dataset.muted        || '',
            solo:         c.dataset.solo         || '',
            preSoloMuted: c.dataset.preSoloMuted || '',
            fadeIn:         c.dataset.fadeIn         || '',
            fadeOut:        c.dataset.fadeOut        || '',
            audioDenoise:   c.dataset.audioDenoise   || '',
            audioNormalize: c.dataset.audioNormalize || '',
            keyframes:      c.dataset.keyframes      || ''
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
          if (spec.clipType)       c.dataset.clipType = spec.clipType;
          if (spec.textContent)    c.dataset.textContent = spec.textContent;
          if (spec.fontSize)       c.dataset.fontSize = spec.fontSize;
          if (spec.textColor)      c.dataset.textColor = spec.textColor;
          if (spec.position)       c.dataset.position = spec.position;
          if (spec.motionEffect)   c.dataset.motionEffect = spec.motionEffect;
          if (spec.scale)          c.dataset.scale   = spec.scale;
          if (spec.rotate)         c.dataset.rotate  = spec.rotate;
          if (spec.flipH)          c.dataset.flipH   = spec.flipH;
          if (spec.flipV)          c.dataset.flipV   = spec.flipV;
          if (spec.offsetX)        c.dataset.offsetX = spec.offsetX;
          if (spec.offsetY)        c.dataset.offsetY = spec.offsetY;
          if (spec.speed)          c.dataset.speed   = spec.speed;
          if (spec.reverse)        c.dataset.reverse = spec.reverse;
          if (spec.loop)           c.dataset.loop    = spec.loop;
          if (spec.freeze)         c.dataset.freeze  = spec.freeze;
          if (spec.trimIn)         c.dataset.trimIn  = spec.trimIn;
          if (spec.trimOut)        c.dataset.trimOut = spec.trimOut;
          if (spec.crop)           c.dataset.crop    = spec.crop;
          if (spec.fxBrightness)   c.dataset.fxBrightness = spec.fxBrightness;
          if (spec.fxContrast)     c.dataset.fxContrast   = spec.fxContrast;
          if (spec.fxSaturate)     c.dataset.fxSaturate   = spec.fxSaturate;
          if (spec.fxBlur)         c.dataset.fxBlur       = spec.fxBlur;
          if (spec.fxHue)          c.dataset.fxHue        = spec.fxHue;
          if (spec.fxColorGrade)   c.dataset.fxColorGrade = spec.fxColorGrade;
          if (spec.fxGlow)         c.dataset.fxGlow       = spec.fxGlow;
          if (spec.fxVignette)     c.dataset.fxVignette   = spec.fxVignette;
          if (spec.fxGrain)        c.dataset.fxGrain      = spec.fxGrain;
          if (spec.fxSharpen)      c.dataset.fxSharpen    = spec.fxSharpen;
          if (spec.fxChromatic)    c.dataset.fxChromatic  = spec.fxChromatic;
          if (spec.fxPixelate)     c.dataset.fxPixelate   = spec.fxPixelate;
          if (spec.volume)         c.dataset.volume       = spec.volume;
          if (spec.muted)          c.dataset.muted        = spec.muted;
          if (spec.solo)           c.dataset.solo         = spec.solo;
          if (spec.preSoloMuted)   c.dataset.preSoloMuted = spec.preSoloMuted;
          if (spec.fadeIn)         c.dataset.fadeIn         = spec.fadeIn;
          if (spec.fadeOut)        c.dataset.fadeOut        = spec.fadeOut;
          if (spec.audioDenoise)   c.dataset.audioDenoise   = spec.audioDenoise;
          if (spec.audioNormalize) c.dataset.audioNormalize = spec.audioNormalize;
          if (spec.keyframes)      c.dataset.keyframes      = spec.keyframes;
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
  var _progHasFrame = false;       // keep last frame while a seek is loading
  var _progLastClipKey = null;     // identity of last-rendered clip — clear on transition
  var _progAutoEnabledOnce = false; // auto-turn PGM on the first time content arrives

  // ── Audio system: master bus + AnalyserNode for the PGM meter ──
  // Master GainNode ── Analyser ── destination
  //   ↑                ↑
  //   <video> source   scheduled AudioBufferSources (audio clips on A1+)
  //
  // All audio paths route through _audioMaster so the PGM meter (and the
  // user's speakers) hear the SUM of the video's own audio + any audio
  // clips scheduled on the timeline.
  var _audioCtx = null;
  var _audioMaster = null;        // GainNode — master mix bus
  var _audioAnalyser = null;
  var _audioSourceEl = null;      // the <video> we connected via createMediaElementSource
  var _audioTimeBuf = null;
  var _audioBufferCache = {};     // mediaUrl -> decoded AudioBuffer (Promise<AudioBuffer>)
  var _audioActiveSources = [];   // currently-playing AudioBufferSourceNodes (audio clips)

  function ensureAudioSystem(){
    var video = document.getElementById('videoPlayer') || document.querySelector('video');
    try {
      if (!_audioCtx){
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        _audioMaster = _audioCtx.createGain();
        _audioMaster.gain.value = 1.0;
        _audioAnalyser = _audioCtx.createAnalyser();
        _audioAnalyser.fftSize = 512;
        _audioAnalyser.smoothingTimeConstant = 0.6;
        _audioTimeBuf = new Uint8Array(_audioAnalyser.fftSize);
        _audioMaster.connect(_audioAnalyser);
        _audioAnalyser.connect(_audioCtx.destination);
      }
      // Hook the <video>'s audio into the master bus exactly once per element.
      if (video instanceof HTMLMediaElement && _audioSourceEl !== video){
        try {
          var src = _audioCtx.createMediaElementSource(video);
          src.connect(_audioMaster);
          _audioSourceEl = video;
        } catch(_){ /* may already be connected by a prior session */ }
      }
      if (_audioCtx.state === 'suspended'){
        _audioCtx.resume().catch(function(){});
      }
      return _audioCtx;
    } catch(_){
      return null;
    }
  }
  // Backward-compatible name used by the PGM meter draw fn.
  function ensureAudioAnalyser(){ ensureAudioSystem(); return _audioAnalyser; }

  // Decode and cache an audio file (returns Promise<AudioBuffer>).
  function loadAudioBuffer(url){
    if (!url) return Promise.reject(new Error('no url'));
    if (_audioBufferCache[url]) return _audioBufferCache[url];
    var p = fetch(url, { credentials: 'include' })
      .then(function(r){
        if (!r.ok) throw new Error('fetch ' + r.status);
        return r.arrayBuffer();
      })
      .then(function(buf){
        return new Promise(function(resolve, reject){
          _audioCtx.decodeAudioData(buf, resolve, reject);
        });
      })
      .catch(function(err){
        delete _audioBufferCache[url]; // allow retry
        throw err;
      });
    _audioBufferCache[url] = p;
    return p;
  }

  // Schedule every audio clip on every audio track, starting from
  // startPlayheadSec. Each clip's source is decoded (or pulled from cache)
  // and an AudioBufferSourceNode is created at the right time on the
  // master bus.
  function startAudioMixing(startPlayheadSec){
    if (!ensureAudioSystem()) return;
    stopAudioMixing(); // clear any prior schedule
    var clips = Array.from(document.querySelectorAll('.mt-track-audio .mt-clip'));
    var t0 = _audioCtx.currentTime;
    clips.forEach(function(clip){
      var url = clip.dataset.mediaUrl;
      if (!url) return;
      var leftSec  = (parseFloat(clip.style.left)  || 0) / TIMELINE_PX_PER_SEC;
      var widthSec = (parseFloat(clip.style.width) || 0) / TIMELINE_PX_PER_SEC;
      var srcOff   = parseFloat(clip.dataset.sourceOffset) || 0;
      var clipEndSec = leftSec + widthSec;
      if (clipEndSec <= startPlayheadSec) return; // already past this clip
      var scheduleDelay, offsetInSource, playDur;
      if (startPlayheadSec <= leftSec){
        scheduleDelay  = leftSec - startPlayheadSec;
        offsetInSource = srcOff;
        playDur        = widthSec;
      } else {
        var into = startPlayheadSec - leftSec;
        scheduleDelay  = 0;
        offsetInSource = srcOff + into;
        playDur        = widthSec - into;
      }
      if (playDur <= 0) return;
      // Respect per-clip Mute + Volume from the AUDIO sidebar.
      if (clip.dataset.muted === 'true') return;
      var volRaw = parseFloat(clip.dataset.volume);
      var vol = isFinite(volRaw) ? Math.max(0, volRaw / 100) : 1;
      loadAudioBuffer(url).then(function(buffer){
        if (!_transport || !_transport.playing) return;
        var src = _audioCtx.createBufferSource();
        src.buffer = buffer;
        // Per-clip GainNode so volume + mute are honoured at scheduling
        // time. vol is capped at 2.0 in the UI (slider max 200%).
        var gainNode = _audioCtx.createGain();
        var targetVol = Math.min(2, vol);
        // Fade-in / fade-out via gain automation. Fades are relative to
        // the CLIP window (not the source), so when entering mid-clip we
        // interpolate the starting gain to match where we'd be on the
        // fade-in curve. For export, the same fades run via afade.
        var fadeIn  = Math.max(0, parseFloat(clip.dataset.fadeIn)  || 0);
        var fadeOut = Math.max(0, parseFloat(clip.dataset.fadeOut) || 0);
        var playStart = t0 + scheduleDelay;
        var playEnd   = playStart + playDur;
        // Position in the clip where playback starts (0 when scheduleDelay>0,
        // >0 when we entered mid-clip).
        var clipEnter = (startPlayheadSec > leftSec) ? (startPlayheadSec - leftSec) : 0;

        if (fadeIn > 0 && clipEnter < fadeIn){
          // Still inside the fade-in region at playback start
          var startGain    = targetVol * (clipEnter / fadeIn);
          var fadeInRemain = Math.min(fadeIn - clipEnter, playDur);
          gainNode.gain.setValueAtTime(startGain, playStart);
          gainNode.gain.linearRampToValueAtTime(targetVol, playStart + fadeInRemain);
        } else {
          gainNode.gain.setValueAtTime(targetVol, playStart);
        }
        if (fadeOut > 0){
          var fadeOutDur  = Math.min(fadeOut, playDur);
          var fadeOutStart = playEnd - fadeOutDur;
          if (fadeOutStart > playStart){
            // Pin gain at targetVol right before fade-out so the ramp
            // starts from the correct level.
            gainNode.gain.setValueAtTime(targetVol, fadeOutStart);
          }
          gainNode.gain.linearRampToValueAtTime(0, playEnd);
        }

        src.connect(gainNode);
        gainNode.connect(_audioMaster);
        try { src.start(t0 + scheduleDelay, offsetInSource, playDur); } catch(_){}
        _audioActiveSources.push(src);
        src.addEventListener('ended', function(){
          var idx = _audioActiveSources.indexOf(src);
          if (idx >= 0) _audioActiveSources.splice(idx, 1);
          try { gainNode.disconnect(); } catch(_){}
        });
      }).catch(function(){ /* quiet skip */ });
    });
  }
  function stopAudioMixing(){
    _audioActiveSources.forEach(function(src){
      try { src.stop(); } catch(_){}
      try { src.disconnect(); } catch(_){}
    });
    _audioActiveSources = [];
  }

  // ── Transport (Play/Pause) ──
  var _transport = { playing: false, startTimestamp: 0, startPlayheadSec: 0, raf: null };
  function getTimelineEndSec(){
    var maxEnd = 0;
    document.querySelectorAll('.mt-clip').forEach(function(c){
      var l = parseFloat(c.style.left)  || 0;
      var w = parseFloat(c.style.width) || 0;
      if (l + w > maxEnd) maxEnd = l + w;
    });
    return maxEnd / TIMELINE_PX_PER_SEC;
  }
  function tlIsPlaying(){ return !!_transport.playing; }
  function tlPlay(){
    if (_transport.playing) return;
    ensureAudioSystem(); // user-gesture context
    var ph = document.getElementById('mtPlayhead');
    var phSec = ph ? ((parseFloat(ph.style.left) || 0) / TIMELINE_PX_PER_SEC) : 0;
    var endSec = getTimelineEndSec();
    if (phSec >= endSec - 0.05) {
      // Wrap to start so pressing play at the end replays from 0
      phSec = 0;
      if (ph) ph.style.left = '0px';
    }
    _transport.playing         = true;
    _transport.startPlayheadSec = phSec;
    _transport.startTimestamp   = performance.now();
    startAudioMixing(phSec);
    // Drive whatever's at the playhead right now — video plays itself
    // (its audio path is already on the master bus); image overlay shows
    // for image clips; black for gaps.
    transportTickAndRender(phSec);
    _transport.raf = requestAnimationFrame(tlTransportRAF);
    updateTransportBtnUI();
  }
  function tlPause(){
    if (!_transport.playing) return;
    _transport.playing = false;
    stopAudioMixing();
    var video = document.getElementById('videoPlayer');
    if (video){
      if (!video.paused){ try { video.pause(); } catch(_){} }
      // Reset transport-owned playback flags so a Speed / Loop / Freeze
      // from the last-played clip doesn't leak into manual playback.
      try { video.playbackRate = 1; } catch(_){}
      try { video.loop = false; } catch(_){}
    }
    if (_transport.raf){ cancelAnimationFrame(_transport.raf); _transport.raf = null; }
    updateTransportBtnUI();
  }
  function tlTogglePlay(){ if (_transport.playing) tlPause(); else tlPlay(); }

  function transportTickAndRender(phSec){
    var ph = document.getElementById('mtPlayhead');
    if (ph) ph.style.left = (phSec * TIMELINE_PX_PER_SEC) + 'px';
    var phPx = phSec * TIMELINE_PX_PER_SEC;
    var hit = getClipAtPlayheadX(phPx);
    var video = document.getElementById('videoPlayer');
    var clipType = hit ? (hit.clip.dataset.clipType || (hit.clip.classList.contains('mt-clip-audio') ? 'aud' : 'vid')) : null;
    if (!hit || clipType === 'aud'){
      // No video clip here — gap (or audio-only). Pause video, show black.
      if (video && !video.paused){ try { video.pause(); } catch(_){} }
      hideImagePreview();
      showBlackPreview();
      return;
    }
    if (clipType === 'img'){
      if (video && !video.paused){ try { video.pause(); } catch(_){} }
      hideBlackPreview();
      if (hit.clip.dataset.mediaUrl) showImagePreview(hit.clip.dataset.mediaUrl);
      return;
    }
    // Video clip — keep the <video> element pointed at the right src and time
    hideImagePreview();
    hideBlackPreview();
    if (!video) return;
    var clip = hit.clip;
    var url = clip.dataset.mediaUrl;
    if (!url) return;
    var srcOff = parseFloat(clip.dataset.sourceOffset) || 0;
    var offIn  = hit.offsetPx / TIMELINE_PX_PER_SEC;

    // Timing flags from the EDIT-tab Timing section
    var speed  = parseFloat(clip.dataset.speed);
    if (!isFinite(speed) || speed <= 0) speed = 1;
    var freeze = clip.dataset.freeze === 'true';
    var loop   = clip.dataset.loop   === 'true';

    // Speed scales source playback inside the clip's fixed timeline width:
    // when wall-clock advances 1s, source advances `speed` seconds.
    var wantSec = freeze ? srcOff : (srcOff + offIn * speed);

    var normCurrent = video.src;
    var normTarget  = normalizeUrl(url);
    if (normCurrent !== normTarget){
      _lastPreviewUrl = url;
      try { video.src = url; video.load(); } catch(_){}
      var playSeek = function(){
        try { video.currentTime = Math.max(0, wantSec); } catch(_){}
        try { video.playbackRate = freeze ? 1 : speed; } catch(_){}
        try { video.loop = !!loop; } catch(_){}
        if (freeze){
          try { video.pause(); } catch(_){}
        } else if (_transport.playing){
          try { video.play(); } catch(_){}
        }
      };
      video.addEventListener('loadedmetadata', playSeek, {once:true});
    } else {
      // Sync playbackRate + loop flag each frame (cheap)
      try { if (video.playbackRate !== (freeze ? 1 : speed)) video.playbackRate = freeze ? 1 : speed; } catch(_){}
      try { if (video.loop !== !!loop) video.loop = !!loop; } catch(_){}
      // Drift correction. With freeze we ALWAYS want the exact srcOff frame.
      var drift = Math.abs((video.currentTime || 0) - wantSec);
      if (drift > 0.3 || (freeze && drift > 0.05)){
        try { video.currentTime = wantSec; } catch(_){}
      }
      if (freeze){
        if (!video.paused){ try { video.pause(); } catch(_){} }
      } else if (_transport.playing && video.paused){
        try { video.play(); } catch(_){}
      }
    }
  }

  function tlTransportRAF(){
    if (!_transport.playing){ _transport.raf = null; return; }
    var elapsed = (performance.now() - _transport.startTimestamp) / 1000;
    var phSec = _transport.startPlayheadSec + elapsed;
    var endSec = getTimelineEndSec();
    if (phSec > endSec){
      // Stop at the end of the sequence (and snap playhead exactly).
      var ph = document.getElementById('mtPlayhead');
      if (ph) ph.style.left = (endSec * TIMELINE_PX_PER_SEC) + 'px';
      tlPause();
      return;
    }
    transportTickAndRender(phSec);
    _transport.raf = requestAnimationFrame(tlTransportRAF);
  }

  function ensureTransportBtn(){
    var existing = document.getElementById('tlTransportBtn');
    if (existing instanceof HTMLButtonElement && existing.isConnected) return existing;
    var player = document.getElementById('videoPlayer') || document.querySelector('video');
    if (!(player instanceof Element)) return null;
    var container = player.parentElement;
    if (!(container instanceof Element)) return null;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    var btn = (existing instanceof HTMLButtonElement) ? existing : document.createElement('button');
    btn.id = 'tlTransportBtn';
    btn.type = 'button';
    btn.title = 'Play / pause the timeline (Space)';
    btn.textContent = '\u25B6 Play';
    btn.style.cssText = 'position:absolute;top:10px;right:74px;z-index:8;padding:5px 11px;font-size:10px;font-weight:800;letter-spacing:.6px;color:#e2e0f0;background:rgba(15,10,30,.75);border:1px solid rgba(34,197,94,.55);border-radius:6px;cursor:pointer;backdrop-filter:blur(4px)';
    if (!btn.dataset.v14){
      btn.dataset.v14 = '1';
      btn.addEventListener('click', function(){ tlTogglePlay(); });
    }
    try { container.appendChild(btn); } catch(_){ return null; }
    return btn;
  }
  function updateTransportBtnUI(){
    var btn = ensureTransportBtn();
    if (!btn) return;
    if (_transport.playing){
      btn.textContent = '\u275A\u275A Pause';
      btn.style.background = 'rgba(239,68,68,.85)';
      btn.style.color = '#fff';
      btn.style.borderColor = 'rgba(239,68,68,.55)';
    } else {
      btn.textContent = '\u25B6 Play';
      btn.style.background = 'rgba(15,10,30,.75)';
      btn.style.color = '#e2e0f0';
      btn.style.borderColor = 'rgba(34,197,94,.55)';
    }
  }
  // Spacebar shortcut
  if (!document.body.dataset.v14Space){
    document.body.dataset.v14Space = '1';
    document.addEventListener('keydown', function(e){
      if (e.code !== 'Space' && e.key !== ' ') return;
      var t = e.target;
      var tag = (t && t.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (t && t.isContentEditable)) return;
      if (e.target instanceof HTMLButtonElement) return;
      e.preventDefault();
      tlTogglePlay();
    });
  }
  // Lazily mount the button (waits for the player to exist).
  (function retryMountTransport(){
    if (ensureTransportBtn()) { updateTransportBtnUI(); return; }
    var tries = 0;
    var iv = setInterval(function(){
      tries++;
      if (ensureTransportBtn()){ updateTransportBtnUI(); clearInterval(iv); }
      else if (tries > 40) clearInterval(iv);
    }, 250);
  })();
  // Expose for other scripts / debugging
  try { window.tlPlay = tlPlay; window.tlPause = tlPause; window.tlTogglePlay = tlTogglePlay; } catch(_){}
  function progDrawAudioMeters(ctx, W, H){
    var analyser = ensureAudioAnalyser();
    if (!analyser || !_audioTimeBuf) return;
    analyser.getByteTimeDomainData(_audioTimeBuf);
    var buf = _audioTimeBuf;
    // Peak + RMS on time-domain
    var peak = 0, sumSq = 0;
    for (var i = 0; i < buf.length; i++){
      var v = Math.abs(buf[i] - 128);
      if (v > peak) peak = v;
      sumSq += v * v;
    }
    var peakN = Math.min(1, peak / 128);
    var rmsN  = Math.min(1, Math.sqrt(sumSq / buf.length) / 128);

    // Waveform: bottom strip spanning near-full width
    var wfPad = 20;
    var wfW = W - wfPad * 2;
    var wfH = 46;
    var wfX = wfPad;
    var wfY = H - 92;
    // Backdrop
    ctx.fillStyle = 'rgba(8,6,18,.55)';
    ctx.fillRect(wfX - 6, wfY - 6, wfW + 12, wfH + 12);
    ctx.strokeStyle = 'rgba(139,92,246,.95)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    var step = wfW / buf.length;
    for (var j = 0; j < buf.length; j++){
      var norm = (buf[j] - 128) / 128;
      var px = wfX + j * step;
      var py = wfY + wfH/2 + norm * (wfH/2 - 2);
      if (j === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Level meter + peak indicator under the waveform
    var mW = Math.min(280, W - wfPad * 2);
    var mH = 14;
    var mX = W - wfPad - mW;
    var mY = H - 36;
    ctx.fillStyle = 'rgba(8,6,18,.7)';
    ctx.fillRect(mX - 2, mY - 2, mW + 4, mH + 4);
    var rmsW = rmsN * mW;
    var color = rmsN < 0.7 ? '#22c55e' : (rmsN < 0.9 ? '#fbbf24' : '#ef4444');
    ctx.fillStyle = color;
    ctx.fillRect(mX, mY, rmsW, mH);
    // Peak hold line
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(mX + Math.min(mW - 2, peakN * mW), mY, 2, mH);
    // Label
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.font = 'bold 10px -apple-system,system-ui,sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('A1 · ' + Math.round(rmsN * 100) + '%  peak ' + Math.round(peakN * 100) + '%', mX, mY - 4);
  }
  function getOrCreateProgSource(url, type){
    if (!url) return null;
    var key = type + '|' + url;
    if (_progMediaCache[key]) return _progMediaCache[key];
    var el;
    if (type === 'img'){
      // No crossOrigin — we only DRAW to the canvas, never read pixels out.
      // Setting crossOrigin='anonymous' causes servers without CORS headers
      // to fail the load entirely, which was painting the canvas black.
      el = new Image();
      el.src = url;
    } else {
      el = document.createElement('video');
      el.muted = true;
      el.playsInline = true;
      el.preload = 'auto';
      el.src = url;
      el.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none';
      document.body.appendChild(el);
    }
    _progMediaCache[key] = el;
    return el;
  }
  function progContainRect(W, H, sW, sH){
    if (!sW || !sH) return null;
    var srcAspect = sW / sH;
    var dstAspect = W / H;
    var dw, dh;
    if (srcAspect > dstAspect){ dw = W; dh = W / srcAspect; }
    else                     { dh = H; dw = H * srcAspect; }
    return { dx: (W - dw) / 2, dy: (H - dh) / 2, dw: dw, dh: dh };
  }
  function progDrawContain(ctx, src, W, H, sW, sH){
    var r = progContainRect(W, H, sW, sH);
    if (!r) return;
    ctx.drawImage(src, r.dx, r.dy, r.dw, r.dh);
  }
  // Draw a source (video or image) through a motion offset transform, with
  // the drawing region CLIPPED to the source's letterbox-fit rect. Motion
  // pans/zooms/rotates inside that rect; any pixels that would fall into
  // the pillar/letter boxes are clipped away, leaving the pre-painted
  // black fill visible in those regions. Returns the motion state so the
  // caller can draw the 'Motion queued' badge on top of the unclipped canvas.
  function progDrawWithMotion(ctx, src, W, H, sW, sH, activeMotion, clip, clipTimeSec){
    var r = progContainRect(W, H, sW, sH);
    if (!r) return null;
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.dx, r.dy, r.dw, r.dh);
    ctx.clip();
    // Resolve the effective FX for this clip at the current playhead
    // position — merges the V1 clip's own dataset with any FX-track
    // clips whose time range overlaps the playhead (user drags an FX
    // clip across multiple V1 clips to broadcast the effect).
    var ph_ = document.getElementById('mtPlayhead');
    var phXNow = ph_ ? (parseFloat(ph_.style.left) || 0) : 0;
    var fxD = resolveEffectiveFx(clip, phXNow);
    var fxFilter = progBuildClipFilter(clip, fxD);
    if (fxFilter) ctx.filter = fxFilter;
    progApplyClipTransforms(ctx, W, H, clip, clipTimeSec);
    var state = progApplyMotion(ctx, W, H, activeMotion);
    // Crop support: when clip.dataset.crop is 'x,y,w,h' percent, use
    // drawImage's 9-arg source-rect form so only that region of the
    // source is rendered — scaled to fill the letterbox rect.
    var hasCrop = clip && clip.dataset.crop;
    var cropArgs = null;
    if (hasCrop){
      var cp = String(clip.dataset.crop).split(',').map(function(s){ return parseFloat(s); });
      if (cp.length === 4 && cp.every(function(v){ return isFinite(v); })){
        cropArgs = {
          sx: Math.max(0, Math.min(sW, sW * cp[0] / 100)),
          sy: Math.max(0, Math.min(sH, sH * cp[1] / 100)),
          sw: Math.max(1, Math.min(sW - 0, sW * cp[2] / 100)),
          sh: Math.max(1, Math.min(sH - 0, sH * cp[3] / 100))
        };
      }
    }
    var pixelate = fxD && fxD.fxPixelate === 'true';
    if (pixelate){
      // Downsample source to a tiny offscreen canvas then blit back at
      // target size with smoothing off. Creates a blocky pixel look.
      if (!window._v10PixOSC) window._v10PixOSC = document.createElement('canvas');
      var osc = window._v10PixOSC;
      var block = 10;
      osc.width  = Math.max(4, Math.floor(r.dw / block));
      osc.height = Math.max(4, Math.floor(r.dh / block));
      var octx = osc.getContext('2d');
      octx.imageSmoothingEnabled = false;
      octx.clearRect(0, 0, osc.width, osc.height);
      if (cropArgs){
        octx.drawImage(src, cropArgs.sx, cropArgs.sy, cropArgs.sw, cropArgs.sh, 0, 0, osc.width, osc.height);
      } else {
        octx.drawImage(src, 0, 0, osc.width, osc.height);
      }
      var prevSmooth = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(osc, r.dx, r.dy, r.dw, r.dh);
      ctx.imageSmoothingEnabled = prevSmooth;
    } else if (cropArgs){
      ctx.drawImage(src, cropArgs.sx, cropArgs.sy, cropArgs.sw, cropArgs.sh, r.dx, r.dy, r.dw, r.dh);
    } else {
      ctx.drawImage(src, r.dx, r.dy, r.dw, r.dh);
    }
    // Chromatic aberration: overlay the frame TWICE at small horizontal
    // offsets through red/cyan tint filters using 'lighter' composite.
    // Not true RGB channel shift (canvas doesn't expose that cheaply) but
    // visually gives the fringing effect. Real rgbashift runs on export.
    if (fxD && fxD.fxChromatic === 'true'){
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35;
      // Red fringe — shift +3px
      ctx.filter = 'sepia(1) saturate(6) hue-rotate(-50deg)';
      if (cropArgs) ctx.drawImage(src, cropArgs.sx, cropArgs.sy, cropArgs.sw, cropArgs.sh, r.dx + 3, r.dy, r.dw, r.dh);
      else ctx.drawImage(src, r.dx + 3, r.dy, r.dw, r.dh);
      // Cyan fringe — shift -3px
      ctx.filter = 'sepia(1) saturate(6) hue-rotate(150deg)';
      if (cropArgs) ctx.drawImage(src, cropArgs.sx, cropArgs.sy, cropArgs.sw, cropArgs.sh, r.dx - 3, r.dy, r.dw, r.dh);
      else ctx.drawImage(src, r.dx - 3, r.dy, r.dw, r.dh);
      ctx.restore();
    }
    progExitMotionTransform(ctx, state);
    if (fxFilter) ctx.filter = 'none';
    progDrawClipPostFX(ctx, W, H, r, clip, fxD);
    ctx.restore();
    return state;
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
    // LAYER STACK RESET: force the canvas transform back to identity and
    // alpha to 1 at the top of every frame. This is the BASE layer — the
    // video's default position (centered) and original size are rendered
    // through this identity transform. Any motion effect from M1 is
    // layered ON TOP via save/transform/restore inside progApplyMotion,
    // so it can only ever offset the rendered pixels — never the clip's
    // underlying data. If a prior frame accidentally left a transform
    // dangling, this line rolls it back.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    // Sync internal buffer to CSS-rendered size so drawing isn't stretched
    // by CSS's 100%×100% sizing of the canvas.
    var rect = canvas.getBoundingClientRect();
    var targetW = Math.max(320, Math.round(rect.width  || 1280));
    var targetH = Math.max(180, Math.round(rect.height || 720));
    if (canvas.width !== targetW || canvas.height !== targetH){
      canvas.width  = targetW;
      canvas.height = targetH;
    }
    var W = canvas.width, H = canvas.height;

    // Figure out what to render first (before clearing) so that if the
    // source isn't ready we keep the previous frame on screen instead of
    // flashing black.
    var ph = document.getElementById('mtPlayhead');
    var phX = ph ? (parseFloat(ph.style.left) || 0) : 0;
    var hit = getClipAtPlayheadX(phX);

    // Active motion effects on M1 at this instant (if any). We wrap the
    // visual draw in save/restore so the transform only affects V1 pixels.
    var activeMotion = getActiveMotionEffectsAtPlayheadX(phX);

    var drawn = false;
    if (hit){
      var clip = hit.clip;
      var type = clip.dataset.clipType || (clip.classList.contains('mt-clip-audio') ? 'aud' : 'vid');
      var url  = clip.dataset.mediaUrl;
      // Clip-local time (0 at clip left edge) — drives keyframe interpolation
      var clipTimeSec = hit.offsetPx / TIMELINE_PX_PER_SEC;
      if (type === 'aud'){
        // On V1 we don't expect audio-only clips; fall through.
      } else if (type === 'img' && url){
        var img = getOrCreateProgSource(url, 'img');
        if (img && img.complete && img.naturalWidth > 0){
          ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
          var moState1 = progDrawWithMotion(ctx, img, W, H, img.naturalWidth, img.naturalHeight, activeMotion, clip, clipTimeSec);
          progDrawMotionBadge(ctx, moState1);
          drawn = true;
        }
      } else if (url){
        // Prefer the MAIN <video> when it's already loaded with this clip's
        // source — avoids double decoding and keeps the canvas perfectly in
        // sync with what the video element is playing.
        var mainVideo = document.getElementById('videoPlayer');
        var mainUsable = mainVideo && mainVideo.readyState >= 2
          && mainVideo.videoWidth > 0 && mainVideo.src
          && normalizeUrl(mainVideo.src) === normalizeUrl(url);
        if (mainUsable){
          ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
          var moState2 = progDrawWithMotion(ctx, mainVideo, W, H, mainVideo.videoWidth, mainVideo.videoHeight, activeMotion, clip, clipTimeSec);
          progDrawMotionBadge(ctx, moState2);
          drawn = true;
        } else {
          var vid = getOrCreateProgSource(url, 'vid');
          var sourceOffset = parseFloat(clip.dataset.sourceOffset) || 0;
          var seekSec = sourceOffset + (hit.offsetPx / TIMELINE_PX_PER_SEC);
          if (vid){
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
              ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
              var moState3 = progDrawWithMotion(ctx, vid, W, H, vid.videoWidth, vid.videoHeight, activeMotion, clip, clipTimeSec);
              progDrawMotionBadge(ctx, moState3);
              drawn = true;
            }
          }
        }
      }
    }

    // Transition detection: keyed on the clip's filename + url so undo /
    // redo / drag-to-reorder all register as a "new" clip when appropriate.
    var currentClipKey = hit
      ? ((hit.clip.dataset.fileName || '') + '|' + (hit.clip.dataset.mediaUrl || '') + '|' + (hit.clip.dataset.clipType || ''))
      : null;
    var transitioned = currentClipKey !== _progLastClipKey;

    if (!drawn){
      // We're showing a gap OR the new clip's source hasn't loaded yet.
      // Clear to black when:
      //   - we've never drawn a frame, OR
      //   - we're in a gap (hit is null/undefined), OR
      //   - the clip under the playhead just changed (don't keep painting
      //     the previous clip's last frame on top of a new clip).
      // Otherwise (same clip, brief seek in flight): keep the last frame.
      if (!_progHasFrame || !hit || transitioned){
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
      }
    } else {
      _progHasFrame = true;
    }
    _progLastClipKey = currentClipKey;

    // Text overlays (from T1 clips) draw on top of the current visual.
    try { progDrawTextOverlays(ctx, W, H, phX); } catch(_){}

    // Watermark so the user knows this is a simulation — NOT the final export.
    ctx.fillStyle = 'rgba(139,92,246,.95)';
    ctx.font = 'bold 14px -apple-system,system-ui,sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText('PGM \u00B7 simulation', 12, 12);
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.font = '11px -apple-system,system-ui,sans-serif';
    ctx.fillText('not final export (audio / transitions not rendered)', 12, 30);

    // Live audio metering — waveform + level meter for whatever is playing
    // through the main <video>. Skips cleanly if WebAudio is unavailable or
    // the source hasn't been attached yet.
    try { progDrawAudioMeters(ctx, W, H); } catch(_){}

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
      // User-gesture-initiated: OK to create / resume the AudioContext here.
      ensureAudioAnalyser();
      _progHasFrame = false; // force a proper first-frame clear
      progLoop();
      showToast('Program Monitor on \u2014 composited timeline preview');
    } else {
      if (_progRAF){ cancelAnimationFrame(_progRAF); _progRAF = null; }
      _progHasFrame = false;
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
  try { window.pushTimelineHistory = pushTimelineHistory; } catch(_){}
  try { window.TIMELINE_PX_PER_SEC = TIMELINE_PX_PER_SEC; } catch(_){}

  // ── Timeline zoom ──────────────────────────────────────────────
  // Rescales every clip's left/width and the playhead in pixels while
  // keeping all second-domain data (sourceOffset, keyframes, fades,
  // motion clip times) untouched. factor > 1 zooms in, factor < 1
  // zooms out. Cumulative zoom is clamped so pxPerSec stays in
  // [1, 200] — more than enough for frame-level editing at 30fps.
  var MIN_PX_PER_SEC = 1;
  var MAX_PX_PER_SEC = 200;
  function setTimelineZoom(factor){
    if (!isFinite(factor) || factor <= 0) return;
    var current = TIMELINE_PX_PER_SEC;
    var target  = current * factor;
    target = Math.max(MIN_PX_PER_SEC, Math.min(MAX_PX_PER_SEC, target));
    var ratio = target / current;
    if (Math.abs(ratio - 1) < 0.001) return;
    TIMELINE_PX_PER_SEC = target;
    try { window.TIMELINE_PX_PER_SEC = TIMELINE_PX_PER_SEC; } catch(_){}
    // Rescale every clip
    Array.from(document.querySelectorAll('.mt-clip')).forEach(function(c){
      var l = parseFloat(c.style.left)  || 0;
      var w = parseFloat(c.style.width) || 0;
      c.style.left  = (l * ratio) + 'px';
      c.style.width = (w * ratio) + 'px';
      try { refreshKeyframeMarkers(c); } catch(_){}
    });
    // Rescale the playhead x-position
    var ph = document.getElementById('mtPlayhead');
    if (ph){
      var phLeft = parseFloat(ph.style.left) || 0;
      ph.style.left = (phLeft * ratio) + 'px';
    }
    try { updateTimelineInfo(); } catch(_){}
    try { syncPreviewToPlayhead(); } catch(_){}
    showToast('Zoom: ' + Math.round(target) + 'px/s');
  }
  try { window.setTimelineZoom = setTimelineZoom; } catch(_){}

  // ── Marquee selection ─────────────────────────────────────────
  // Drag on an empty area of the tracks to rubber-band select all
  // overlapping clips. Shift adds to the existing selection; without
  // Shift the previous selection is cleared on mousedown.
  (function wireMarquee(){
    var tracksArea = document.getElementById('mtTracksArea');
    if (!tracksArea || tracksArea.dataset.v14Marquee) return;
    tracksArea.dataset.v14Marquee = '1';

    var marq = null;
    var start = null;

    tracksArea.addEventListener('mousedown', function(e){
      // Only start marquee when the pointer isn't on a clip, handle,
      // playhead, or track label — and only in Select tool mode.
      if (_timelineState.tool !== 'select') return;
      if (e.button !== 0) return;
      if (e.target !== tracksArea && !e.target.classList.contains('mt-track')) return;

      var rect = tracksArea.getBoundingClientRect();
      start = {
        x: e.clientX - rect.left + tracksArea.scrollLeft,
        y: e.clientY - rect.top  + tracksArea.scrollTop
      };

      if (!e.shiftKey){
        Array.from(document.querySelectorAll('.mt-clip.selected'))
          .forEach(function(c){ c.classList.remove('selected'); });
      }

      marq = document.createElement('div');
      marq.className = 'mt-marquee';
      marq.style.left   = start.x + 'px';
      marq.style.top    = start.y + 'px';
      marq.style.width  = '0px';
      marq.style.height = '0px';
      tracksArea.appendChild(marq);
      e.preventDefault();

      function onMove(ev){
        if (!marq || !start) return;
        var r = tracksArea.getBoundingClientRect();
        var cx = ev.clientX - r.left + tracksArea.scrollLeft;
        var cy = ev.clientY - r.top  + tracksArea.scrollTop;
        var x = Math.min(start.x, cx);
        var y = Math.min(start.y, cy);
        var w = Math.abs(cx - start.x);
        var h = Math.abs(cy - start.y);
        marq.style.left   = x + 'px';
        marq.style.top    = y + 'px';
        marq.style.width  = w + 'px';
        marq.style.height = h + 'px';
      }
      function onUp(){
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (!marq){ return; }
        // Select every clip whose bounding box overlaps the marquee
        var mx = parseFloat(marq.style.left)   || 0;
        var my = parseFloat(marq.style.top)    || 0;
        var mw = parseFloat(marq.style.width)  || 0;
        var mh = parseFloat(marq.style.height) || 0;
        var taBB = tracksArea.getBoundingClientRect();
        Array.from(document.querySelectorAll('.mt-clip')).forEach(function(c){
          var bb = c.getBoundingClientRect();
          var cx1 = bb.left - taBB.left + tracksArea.scrollLeft;
          var cy1 = bb.top  - taBB.top  + tracksArea.scrollTop;
          var cx2 = cx1 + bb.width;
          var cy2 = cy1 + bb.height;
          var mx2 = mx + mw, my2 = my + mh;
          var overlaps = !(cx2 < mx || cx1 > mx2 || cy2 < my || cy1 > my2);
          if (overlaps && mw > 4 && mh > 4){
            c.classList.add('selected');
          }
        });
        // Only swallow the click if the marquee was more than a tiny
        // drag — otherwise it's just a click on empty timeline area
        // which should move the playhead (handled elsewhere).
        if (mw > 4 || mh > 4){
          // Prevent the subsequent click from firing on the tracks area
          var swallow = function(ev2){
            ev2.stopPropagation();
            document.removeEventListener('click', swallow, true);
          };
          document.addEventListener('click', swallow, true);
        }
        if (marq.parentNode) marq.parentNode.removeChild(marq);
        marq = null;
        start = null;
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  })();

  // ── Text clips ──
  // Text lives on T1 (.mt-track-text). It's rendered as an overlay on top
  // of whatever visual clip is below it on V1. Text clips behave like any
  // other .mt-clip — draggable (Select tool), deletable (Delete key), and
  // recorded in the undo history.
  function addTextClipToTimeline(text, opts){
    opts = opts || {};
    var track = document.querySelector('.mt-track-text');
    if (!track){ showToast('Text track not found'); return null; }
    var safeText = String(text || '').slice(0, 200) || 'Text';
    var dur = parseFloat(opts.duration) || 5;
    if (dur < 1) dur = 1;
    // opts.left / opts.width (strings like '120px') let callers drop a
    // text clip at a specific timeline position — used by the inline
    // captions flow to align each phrase to its transcript time.
    var explicitWidth = parseFloat(opts.width);
    var width = isFinite(explicitWidth) && explicitWidth > 0
      ? explicitWidth
      : Math.max(40, dur * TIMELINE_PX_PER_SEC);
    var explicitLeft = parseFloat(opts.left);
    var leftPos = isFinite(explicitLeft) && explicitLeft >= 0
      ? explicitLeft
      : findRightmostClipEnd(track);
    var clip = document.createElement('div');
    clip.className = 'mt-clip mt-clip-text';
    clip.textContent = safeText.slice(0, 30);
    clip.dataset.fileName    = safeText;
    clip.dataset.clipType    = 'text';
    clip.dataset.textContent = safeText;
    clip.dataset.duration    = String(dur);
    if (opts.fontSize)  clip.dataset.fontSize  = String(opts.fontSize);
    if (opts.textColor) clip.dataset.textColor = opts.textColor;
    if (opts.position)  clip.dataset.position  = opts.position;
    clip.style.left = leftPos + 'px';
    clip.style.width = width + 'px';
    clip.style.padding = '4px 8px';
    clip.style.fontSize = '10px';
    clip.style.overflow = 'hidden';
    clip.style.textOverflow = 'ellipsis';
    clip.style.whiteSpace = 'nowrap';
    clip.style.userSelect = 'none';
    clip.style.background = 'linear-gradient(135deg, #facc15, #eab308)';
    clip.style.color = '#0b0816';
    clip.style.fontWeight = '700';
    track.appendChild(clip);
    makeClipInteractive(clip);
    updateTimelineInfo();
    pushTimelineHistory();
    // Auto-enable PGM on first clip (same behaviour as addClipToTimeline).
    if (!_progAutoEnabledOnce && !_progEnabled){
      _progAutoEnabledOnce = true;
      try { toggleProgramMonitor(); } catch(_){}
    }
    showToast('Text added: ' + safeText.slice(0, 30));
    return clip;
  }
  try { window.addTextClipToTimeline = addTextClipToTimeline; } catch(_){}

  // ── Motion effects on M1 ──
  // A "motion effect" is a time-varying transform applied to whatever V1
  // visual is at the playhead: zoom, pan, fade, rotate, shake, etc. Each
  // motion effect lives as its own clip on the .mt-track-music row (M1)
  // so the user can place / drag / delete them like any other clip.
  var MOTION_EFFECTS = {
    'zoom-in':    { label: 'Zoom In',    icon: '\ud83d\udd0d' },
    'zoom-out':   { label: 'Zoom Out',   icon: '\ud83d\udd0e' },
    'pan-left':   { label: 'Pan Left',   icon: '\u2b05\ufe0f' },
    'pan-right':  { label: 'Pan Right',  icon: '\u27a1\ufe0f' },
    'fade-in':    { label: 'Fade In',    icon: '\ud83c\udf11' },
    'fade-out':   { label: 'Fade Out',   icon: '\ud83c\udf15' },
    'shake':      { label: 'Shake',      icon: '\ud83c\udf00' },
    'rotate':     { label: 'Rotate',     icon: '\ud83d\udd04' }
  };

  function addMotionClipToTimeline(effectKey, opts){
    opts = opts || {};
    var effect = MOTION_EFFECTS[effectKey];
    if (!effect){ showToast('Unknown motion effect'); return null; }
    var track = document.querySelector('.mt-track-music');
    if (!track){ showToast('Motion track not found'); return null; }
    var dur = parseFloat(opts.duration) || 3;
    if (dur < 0.5) dur = 0.5;
    var width = Math.max(40, dur * TIMELINE_PX_PER_SEC);
    var leftPos = findRightmostClipEnd(track);
    var clip = document.createElement('div');
    clip.className = 'mt-clip mt-clip-motion';
    clip.textContent = effect.icon + ' ' + effect.label;
    clip.dataset.fileName     = effect.label;
    clip.dataset.clipType     = 'motion';
    clip.dataset.motionEffect = effectKey;
    clip.dataset.duration     = String(dur);
    clip.style.left = leftPos + 'px';
    clip.style.width = width + 'px';
    clip.style.padding = '4px 8px';
    clip.style.fontSize = '10px';
    clip.style.overflow = 'hidden';
    clip.style.textOverflow = 'ellipsis';
    clip.style.whiteSpace = 'nowrap';
    clip.style.userSelect = 'none';
    clip.style.background = 'linear-gradient(135deg, #ec4899, #f472b6)';
    clip.style.color = '#fff';
    clip.style.fontWeight = '700';
    track.appendChild(clip);
    makeClipInteractive(clip);
    updateTimelineInfo();
    pushTimelineHistory();
    if (!_progAutoEnabledOnce && !_progEnabled){
      _progAutoEnabledOnce = true;
      try { toggleProgramMonitor(); } catch(_){}
    }
    showToast('Motion: ' + effect.label);
    return clip;
  }
  try { window.addMotionClipToTimeline = addMotionClipToTimeline; } catch(_){}

  // ── FX track clips ─────────────────────────────────────────────
  // When the user toggles a Visual Effect (Vignette/Glow/Grain/Sharpen/
  // Chromatic/Pixelate) or picks a Color Grade preset, we ALSO drop a
  // labeled clip onto the .mt-track-fx row so the effect is visible on
  // the timeline. The actual effect still rides on the V1 clip's dataset
  // (that's what the render + export pipelines read); the FX-track clip
  // is purely an indicator the user can drag, delete, etc.
  function addFxIndicatorClip(label, icon, opts){
    opts = opts || {};
    var track = document.querySelector('.mt-track-fx');
    if (!track) return null;
    // Span the ACTIVE clip's time range when possible (so the FX marker
    // visually aligns with the V1 clip the effect applies to).
    var active = opts.active || getActiveClip();
    var leftPos, width;
    if (active){
      leftPos = parseFloat(active.style.left)  || 0;
      width   = parseFloat(active.style.width) || (3 * TIMELINE_PX_PER_SEC);
    } else {
      width   = Math.max(40, (opts.duration || 3) * TIMELINE_PX_PER_SEC);
      leftPos = findRightmostClipEnd(track);
    }
    var clip = document.createElement('div');
    clip.className = 'mt-clip mt-clip-fx';
    clip.textContent = (icon ? icon + ' ' : '') + label;
    clip.dataset.fileName = label;
    clip.dataset.clipType = 'fx';
    clip.dataset.fxLabel  = label;
    // fxKey / fxValue carry the actual dataset flag this clip represents
    // so preview + export can apply the effect to every V1 clip whose
    // time range overlaps this FX-track clip (drag it to span multiple
    // V1 clips to broadcast the effect).
    if (opts.fxKey)   clip.dataset.fxKey   = opts.fxKey;
    if (opts.fxValue) clip.dataset.fxValue = String(opts.fxValue);
    clip.dataset.duration = String(width / TIMELINE_PX_PER_SEC);
    clip.style.left = leftPos + 'px';
    clip.style.width = width + 'px';
    clip.style.padding = '4px 8px';
    clip.style.fontSize = '10px';
    clip.style.overflow = 'hidden';
    clip.style.textOverflow = 'ellipsis';
    clip.style.whiteSpace = 'nowrap';
    clip.style.userSelect = 'none';
    clip.style.background = 'linear-gradient(135deg, #34d399, #10b981)';
    clip.style.color = '#0b0816';
    clip.style.fontWeight = '700';
    track.appendChild(clip);
    makeClipInteractive(clip);
    updateTimelineInfo();
    return clip;
  }
  try { window.addFxIndicatorClip = addFxIndicatorClip; } catch(_){}

  // ── Clip-scope actions for the EDIT sidebar ──
  // Every EDIT tool operates on the "active clip" — preference order:
  //   1. The .mt-clip.selected on any track (from the Select tool).
  //   2. The clip under the playhead on V1.
  // If neither exists, the tool shows a friendly "Select a clip first" toast.
  function getActiveClip(){
    var sel = document.querySelector('.mt-clip.selected');
    if (sel) return sel;
    var ph = document.getElementById('mtPlayhead');
    if (!ph) return null;
    var phX = parseFloat(ph.style.left) || 0;
    var hit = getClipAtPlayheadX(phX);
    return hit ? hit.clip : null;
  }
  // Multi-clip target: every .selected clip; falls back to the single
  // clip under the playhead so single-clip workflows keep working when
  // nothing is explicitly selected.
  function getActiveClips(){
    var sels = Array.from(document.querySelectorAll('.mt-clip.selected'));
    if (sels.length) return sels;
    var one = getActiveClip();
    return one ? [one] : [];
  }
  function withActiveClip(successMsg, fn){
    // Single-clip path preserved for handlers that contain their own
    // prompt() calls — broadcasting an interactive prompt N times is
    // worse UX than editing one clip. Handlers that WANT multi-clip
    // broadcast should call promptToActiveClips / toggleDatasetForAll
    // directly (see e.g. clipActionFxBlur, toggleClipFlag).
    var clip = getActiveClip();
    if (!clip){ showToast('Select a clip first'); return null; }
    fn(clip);
    pushTimelineHistory();
    _lastPreviewUrl = null;
    try { syncPreviewToPlayhead(); } catch(_){}
    if (successMsg) showToast(successMsg);
    return clip;
  }
  // Prompt-once helper: gathers ONE input from the user (using the first
  // active clip's current value as the default), then applies the
  // resulting value to every selected clip via applyFn(clip, value).
  // Used by all numeric / preset handlers so the user isn't asked the
  // same question N times when broadcasting an edit.
  function promptToActiveClips(promptFn, applyFn, successFmt){
    var clips = getActiveClips();
    if (!clips.length){ showToast('Select a clip first'); return; }
    var value = promptFn(clips[0]);
    if (value === null || value === undefined) return;
    clips.forEach(function(c){ try { applyFn(c, value); } catch(_){} });
    pushTimelineHistory();
    _lastPreviewUrl = null;
    try { syncPreviewToPlayhead(); } catch(_){}
    if (successFmt){
      var msg = String(successFmt).replace('{val}', value);
      var suffix = clips.length > 1 ? ' \u00b7 ' + clips.length + ' clips' : '';
      showToast(msg + suffix);
    }
  }
  // Flip sign / toggle helpers
  function boolDatasetToggle(clip, key){
    var cur = clip.dataset[key] === 'true';
    clip.dataset[key] = cur ? 'false' : 'true';
    return !cur;
  }
  // Multi-clip toggle: target state is the opposite of the FIRST clip's
  // current state (predictable "turn this on for everyone" behaviour).
  function toggleDatasetForAll(clips, key){
    if (!clips.length) return false;
    var first = clips[0];
    var on = first.dataset[key] !== 'true';
    clips.forEach(function(c){ c.dataset[key] = on ? 'true' : 'false'; });
    return on;
  }

  // ── Clip Tools ──
  function clipActionTrim(){
    withActiveClip(null, function(clip){
      var curIn  = parseFloat(clip.dataset.trimIn)  || 0;
      var curOut = parseFloat(clip.dataset.trimOut) || parseFloat(clip.dataset.duration) || 0;
      var input = prompt('Trim in/out in seconds (e.g. 2,10 — leave blank to reset)',
        curIn + ',' + curOut);
      if (input === null) return;
      if (!input.trim()){ delete clip.dataset.trimIn; delete clip.dataset.trimOut; showToast('Trim reset'); return; }
      var parts = input.split(',').map(function(s){ return parseFloat(s.trim()); });
      if (!isFinite(parts[0]) || !isFinite(parts[1]) || parts[1] <= parts[0]){
        showToast('Invalid trim values'); return;
      }
      clip.dataset.trimIn  = String(parts[0]);
      clip.dataset.trimOut = String(parts[1]);
      showToast('Trim ' + parts[0] + 's \u2192 ' + parts[1] + 's');
    });
  }
  function clipActionSplit(){
    var clip = getActiveClip();
    if (!clip){ showToast('Select a clip first'); return; }
    var ph = document.getElementById('mtPlayhead');
    if (!ph) return;
    var phX = parseFloat(ph.style.left) || 0;
    var l = parseFloat(clip.style.left) || 0;
    var w = parseFloat(clip.style.width) || 0;
    if (phX <= l + 6 || phX >= l + w - 6){
      showToast('Move the playhead into the clip to split');
      return;
    }
    razorSplit(clip, phX - l);
  }
  function clipActionSpeed(){
    promptToActiveClips(
      function(c){
        var cur = parseFloat(c.dataset.speed) || 1;
        var input = prompt('Playback speed (1.0 = normal, 0.5 = half, 2.0 = 2x)', String(cur));
        if (input === null) return null;
        var val = parseFloat(input);
        if (!isFinite(val) || val <= 0){ showToast('Invalid speed'); return null; }
        return val;
      },
      function(c, v){ c.dataset.speed = String(v); },
      'Speed {val}x'
    );
  }
  function clipActionCrop(){
    promptToActiveClips(
      function(c){
        var input = prompt('Crop as x,y,w,h percent (0-100) \u2014 blank to reset',
          c.dataset.crop || '0,0,100,100');
        if (input === null) return null;
        if (!input.trim()) return 'reset';
        var parts = input.split(',').map(function(s){ return parseFloat(s.trim()); });
        if (parts.length !== 4 || parts.some(function(v){ return !isFinite(v); })){
          showToast('Invalid crop'); return null;
        }
        return parts.join(',');
      },
      function(c, v){
        if (v === 'reset') delete c.dataset.crop;
        else c.dataset.crop = v;
      },
      'Crop {val}'
    );
  }
  // ── Transform ──
  function clipActionResize(){
    promptToActiveClips(
      function(c){
        var cur = parseFloat(c.dataset.scale) || 1;
        var input = prompt('Scale (1.0 = original)', String(cur));
        if (input === null) return null;
        var val = parseFloat(input);
        if (!isFinite(val) || val <= 0){ showToast('Invalid scale'); return null; }
        return val;
      },
      function(c, v){ c.dataset.scale = String(v); },
      'Scale {val}x'
    );
  }
  function clipActionRotate(){
    // Relative 90\u00B0 step \u2014 each clip rotates by +90 from its own
    // current value (rather than all set to the same absolute degree).
    var clips = getActiveClips();
    if (!clips.length){ showToast('Select a clip first'); return; }
    clips.forEach(function(c){
      var cur = parseFloat(c.dataset.rotate) || 0;
      c.dataset.rotate = String((cur + 90) % 360);
    });
    pushTimelineHistory();
    _lastPreviewUrl = null;
    try { syncPreviewToPlayhead(); } catch(_){}
    showToast('Rotated 90\u00B0' + (clips.length > 1 ? ' \u00b7 ' + clips.length + ' clips' : ''));
  }
  function clipActionFlip(){
    var clips = getActiveClips();
    if (!clips.length){ showToast('Select a clip first'); return; }
    // All clips flip to the inverse of the FIRST clip's current state
    var on = toggleDatasetForAll(clips, 'flipH');
    pushTimelineHistory();
    _lastPreviewUrl = null;
    try { syncPreviewToPlayhead(); } catch(_){}
    showToast('Flipped' + (clips.length > 1 ? ' \u00b7 ' + clips.length + ' clips' : ''));
  }
  function clipActionPosition(){
    promptToActiveClips(
      function(c){
        var cx = parseFloat(c.dataset.offsetX) || 0;
        var cy = parseFloat(c.dataset.offsetY) || 0;
        var input = prompt('X, Y offset in pixels (e.g. 50,-30)', cx + ',' + cy);
        if (input === null) return null;
        var parts = input.split(',').map(function(s){ return parseFloat(s.trim()); });
        if (parts.length !== 2 || !isFinite(parts[0]) || !isFinite(parts[1])){
          showToast('Invalid position'); return null;
        }
        return parts;
      },
      function(c, parts){
        c.dataset.offsetX = String(parts[0]);
        c.dataset.offsetY = String(parts[1]);
      },
      'Offset set'
    );
  }
  // ── Text clip editors ──
  // Target selection rules:
  //   • If 2+ text clips are .selected, edit ALL of them.
  //   • Else if exactly 1 text clip is .selected, edit just it.
  //   • Else (nothing selected), confirm before applying to EVERY text
  //     clip on T1 — useful for styling an entire caption run at once.
  function withTextClipsTarget(fn){
    var selAll = Array.from(document.querySelectorAll('.mt-clip.mt-clip-text.selected'));
    var all    = Array.from(document.querySelectorAll('.mt-track-text .mt-clip'));
    if (selAll.length >= 1){ fn(selAll); return; }
    if (all.length === 0){ showToast('Add a text clip first'); return; }
    if (confirm('No text clip is selected. Apply to ALL ' + all.length + ' text clips on T1?')){
      fn(all);
    }
  }
  function clipActionTextFontSize(){
    withTextClipsTarget(function(clips){
      var first = clips[0];
      var cur = parseInt(first.dataset.fontSize, 10) || 10;
      var input = prompt('Font size in pixels (8-200)', String(cur));
      if (input === null) return;
      var v = parseInt(input, 10);
      if (!isFinite(v) || v < 8 || v > 200){
        showToast('Enter a number between 8 and 200');
        return;
      }
      clips.forEach(function(c){ c.dataset.fontSize = String(v); });
      try { syncPreviewToPlayhead(); } catch(_){}
      pushTimelineHistory();
      showToast('Font size: ' + v + 'px' + (clips.length > 1 ? ' \u00b7 ' + clips.length + ' clips' : ''));
    });
  }
  function clipActionTextColor(){
    withTextClipsTarget(function(clips){
      var first = clips[0];
      var cur = first.dataset.textColor || '#ffffff';
      var input = prompt('Text color (hex, e.g. #ffffff, #ffcc00)', cur);
      if (input === null) return;
      var v = String(input).trim();
      if (!/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(v)){
        showToast('Invalid color \u2014 use #rgb or #rrggbb');
        return;
      }
      clips.forEach(function(c){ c.dataset.textColor = v; });
      try { syncPreviewToPlayhead(); } catch(_){}
      pushTimelineHistory();
      showToast('Text color: ' + v + (clips.length > 1 ? ' \u00b7 ' + clips.length + ' clips' : ''));
    });
  }
  function clipActionTextPosition(){
    withTextClipsTarget(function(clips){
      var first = clips[0];
      var cur = first.dataset.position || 'bottom';
      var input = prompt('Text position (top / center / bottom)', cur);
      if (input === null) return;
      var v = String(input).trim().toLowerCase();
      if (['top','center','bottom'].indexOf(v) === -1){
        showToast('Use top, center, or bottom');
        return;
      }
      clips.forEach(function(c){ c.dataset.position = v; });
      try { syncPreviewToPlayhead(); } catch(_){}
      pushTimelineHistory();
      showToast('Text position: ' + v + (clips.length > 1 ? ' \u00b7 ' + clips.length + ' clips' : ''));
    });
  }
  // ── Timing ──
  function clipActionReverse(){
    withActiveClip(null, function(clip){
      var now = boolDatasetToggle(clip, 'reverse');
      showToast('Reverse ' + (now ? 'on' : 'off'));
    });
  }
  function clipActionLoop(){
    withActiveClip(null, function(clip){
      var now = boolDatasetToggle(clip, 'loop');
      showToast('Loop ' + (now ? 'on' : 'off'));
    });
  }
  function clipActionFreeze(){
    withActiveClip(null, function(clip){
      var now = boolDatasetToggle(clip, 'freeze');
      showToast('Freeze ' + (now ? 'on' : 'off'));
    });
  }
  // ── Keyframes ───────────────────────────────────────────────────
  // Per-clip animation of scale / offsetX / offsetY over clip-local time.
  // Keyframes live on clip.dataset.keyframes as a JSON array:
  //   [{ t: number, scale?, offsetX?, offsetY? }, ...]
  // where t is seconds from the clip's left edge. Any property absent
  // from a keyframe is ignored for that keyframe (not animated).
  //
  // At clip-time `tnow`:
  //   • 0 KFs for prop  → use the clip's static dataset value
  //   • 1 KF  for prop  → constant = that KF's value
  //   • surrounded by 2 → linear interpolation between bracketing KFs
  //   • before first    → use first KF's value
  //   • after  last     → use last  KF's value
  //
  // Export is preview-only for now — keyframes would need per-clip
  // filter expressions in Stage A. That's a follow-up.
  function readClipKeyframes(clip){
    if (!clip || !clip.dataset.keyframes) return [];
    try {
      var arr = JSON.parse(clip.dataset.keyframes);
      if (!Array.isArray(arr)) return [];
      return arr.filter(function(k){ return k && isFinite(k.t); })
                .sort(function(a,b){ return a.t - b.t; });
    } catch(_){ return []; }
  }
  function writeClipKeyframes(clip, arr){
    if (!arr || !arr.length){ delete clip.dataset.keyframes; return; }
    clip.dataset.keyframes = JSON.stringify(arr);
  }
  function interpolateKeyframeProp(keyframes, prop, tnow, fallback){
    var kfs = keyframes.filter(function(k){ return typeof k[prop] !== 'undefined' && k[prop] !== null && isFinite(k[prop]); });
    if (kfs.length === 0) return fallback;
    if (kfs.length === 1) return kfs[0][prop];
    if (tnow <= kfs[0].t) return kfs[0][prop];
    if (tnow >= kfs[kfs.length - 1].t) return kfs[kfs.length - 1][prop];
    for (var i = 0; i < kfs.length - 1; i++){
      var a = kfs[i], b = kfs[i+1];
      if (tnow >= a.t && tnow <= b.t){
        var span = b.t - a.t;
        if (span <= 0) return a[prop];
        var p = (tnow - a.t) / span;
        return a[prop] + (b[prop] - a[prop]) * p;
      }
    }
    return fallback;
  }
  // Draw yellow keyframe markers along the top of each clip element. Called
  // whenever the keyframes change or a clip is restored from a snapshot.
  function refreshKeyframeMarkers(clip){
    if (!clip) return;
    Array.from(clip.querySelectorAll('.mt-kf-marker')).forEach(function(m){ m.remove(); });
    var kfs = readClipKeyframes(clip);
    if (kfs.length === 0) return;
    var width = parseFloat(clip.style.width) || clip.offsetWidth || 1;
    var clipDurSec = width / TIMELINE_PX_PER_SEC;
    if (clipDurSec <= 0) return;
    kfs.forEach(function(k){
      var m = document.createElement('div');
      m.className = 'mt-kf-marker';
      var leftPct = Math.max(0, Math.min(1, k.t / clipDurSec)) * 100;
      m.style.left = leftPct + '%';
      clip.appendChild(m);
    });
  }
  function clipActionKeyframe(){
    var clip = getActiveClip();
    if (!clip){ showToast('Select a clip first'); return; }
    if (clip.classList.contains('mt-clip-audio')){ showToast('Keyframes not supported on audio'); return; }
    // Determine current playhead time within the clip
    var ph = document.getElementById('mtPlayhead');
    var phX = ph ? (parseFloat(ph.style.left) || 0) : 0;
    var clipLeft = parseFloat(clip.style.left) || 0;
    var clipW    = parseFloat(clip.style.width) || 1;
    var tnowPx   = phX - clipLeft;
    if (tnowPx < 0 || tnowPx > clipW){
      showToast('Move playhead over this clip first');
      return;
    }
    var tnow = tnowPx / TIMELINE_PX_PER_SEC;
    // Capture current static values (Scale / Position) as a keyframe.
    // User-driven values come from the Resize / Position prompts.
    var scale  = parseFloat(clip.dataset.scale)   || 1;
    var offX   = parseFloat(clip.dataset.offsetX) || 0;
    var offY   = parseFloat(clip.dataset.offsetY) || 0;
    var kfs = readClipKeyframes(clip);
    var menu = prompt(
      'Keyframes at t=' + tnow.toFixed(2) + 's on this clip.\n\n' +
      'Existing keyframes: ' + (kfs.length === 0 ? '(none)' :
        kfs.map(function(k){
          var bits = [];
          if (typeof k.scale   === 'number') bits.push('scale='  + k.scale.toFixed(2));
          if (typeof k.offsetX === 'number') bits.push('x='      + k.offsetX.toFixed(0));
          if (typeof k.offsetY === 'number') bits.push('y='      + k.offsetY.toFixed(0));
          return 't=' + k.t.toFixed(2) + ' [' + bits.join(', ') + ']';
        }).join('\n  ')
      ) + '\n\n' +
      'Actions:\n' +
      '  add    — capture current Scale/Position at playhead\n' +
      '  del    — remove keyframe at playhead (±0.2s)\n' +
      '  clear  — remove ALL keyframes on this clip',
      'add'
    );
    if (menu === null) return;
    var action = menu.trim().toLowerCase();
    if (action === 'add'){
      // Replace any existing KF within 0.05s of tnow, else append
      var replaced = false;
      for (var i = 0; i < kfs.length; i++){
        if (Math.abs(kfs[i].t - tnow) < 0.05){
          kfs[i] = { t: tnow, scale: scale, offsetX: offX, offsetY: offY };
          replaced = true;
          break;
        }
      }
      if (!replaced) kfs.push({ t: tnow, scale: scale, offsetX: offX, offsetY: offY });
      kfs.sort(function(a,b){ return a.t - b.t; });
      writeClipKeyframes(clip, kfs);
      refreshKeyframeMarkers(clip);
      pushTimelineHistory();
      showToast('Keyframe ' + (replaced ? 'updated' : 'added') + ' at ' + tnow.toFixed(2) + 's');
    } else if (action === 'del'){
      var kept = kfs.filter(function(k){ return Math.abs(k.t - tnow) >= 0.2; });
      if (kept.length === kfs.length){ showToast('No keyframe within 0.2s of playhead'); return; }
      writeClipKeyframes(clip, kept);
      refreshKeyframeMarkers(clip);
      pushTimelineHistory();
      showToast('Keyframe removed');
    } else if (action === 'clear'){
      writeClipKeyframes(clip, []);
      refreshKeyframeMarkers(clip);
      pushTimelineHistory();
      showToast('All keyframes cleared');
    } else {
      showToast('Unknown action: ' + action);
    }
  }

  // Solo this audio clip by muting every OTHER audio clip. Toggling solo
  // off restores previous mute states (stored on each clip's dataset.preSoloMuted).
  function clipActionSolo(){
    var clip = getActiveClip();
    if (!clip){ showToast('Select an audio clip first'); return; }
    if (!clip.classList.contains('mt-clip-audio')){
      showToast('Solo works on audio clips');
      return;
    }
    var allAudio = Array.from(document.querySelectorAll('.mt-track-audio .mt-clip'));
    var wasSolo = clip.dataset.solo === 'true';
    if (wasSolo){
      // Un-solo: restore previous mute states
      allAudio.forEach(function(c){
        if (c.dataset.preSoloMuted !== undefined){
          if (c.dataset.preSoloMuted === 'true') c.dataset.muted = 'true';
          else delete c.dataset.muted;
          delete c.dataset.preSoloMuted;
        }
      });
      delete clip.dataset.solo;
      showToast('Un-soloed');
    } else {
      // Solo: remember current mute states, mute everything except this clip
      allAudio.forEach(function(c){
        c.dataset.preSoloMuted = (c.dataset.muted === 'true') ? 'true' : 'false';
        if (c === clip) delete c.dataset.muted;
        else c.dataset.muted = 'true';
      });
      clip.dataset.solo = 'true';
      showToast('Soloed: ' + (clip.dataset.fileName || 'clip'));
    }
    pushTimelineHistory();
  }
  try { window.clipActionSolo = clipActionSolo; } catch(_){}

  // ── FX: Visual Effects (toggles) ──
  // When a visual effect toggles ON, also drop an indicator clip onto
  // the .mt-track-fx row so the user can see what FX are active and
  // when they apply. The underlying effect still lives on the V1 clip's
  // dataset; the FX-track clip is a visual marker only.
  var FX_TOGGLE_LABELS = {
    fxGlow:       { label: 'Glow',       icon: '\u2728' },
    fxVignette:   { label: 'Vignette',   icon: '\ud83d\udd06' },
    fxGrain:      { label: 'Film Grain', icon: '\ud83d\udcfa' },
    fxSharpen:    { label: 'Sharpen',    icon: '\ud83d\udd2a' },
    fxChromatic:  { label: 'Chromatic',  icon: '\ud83c\udf08' },
    fxPixelate:   { label: 'Pixelate',   icon: '\ud83d\udd32' },
    fxNoise:      { label: 'Noise',      icon: '\ud83d\udcfd\ufe0f' }
  };
  function toggleClipFlag(label, key){
    var clips = getActiveClips();
    if (!clips.length){ showToast('Select a clip first'); return; }
    var on = toggleDatasetForAll(clips, key);
    // Drop an indicator clip on the FX track when toggling ON, tagged
    // with the dataset key so preview/export pick up the effect for any
    // V1 clip the FX clip overlaps (users can drag it across multiple
    // V1 clips to broadcast the effect).
    if (on && FX_TOGGLE_LABELS[key]){
      var meta = FX_TOGGLE_LABELS[key];
      addFxIndicatorClip(meta.label, meta.icon, {
        active: clips[0],
        fxKey: key,
        fxValue: 'true'
      });
    }
    pushTimelineHistory();
    _lastPreviewUrl = null;
    try { syncPreviewToPlayhead(); } catch(_){}
    var suffix = clips.length > 1 ? ' \u00b7 ' + clips.length + ' clips' : '';
    showToast(label + ' ' + (on ? 'on' : 'off') + suffix);
  }
  function clipActionFxBlur(){
    var wasJustEnabled = false;
    var activeSnapshot = null;
    promptToActiveClips(
      function(c){
        activeSnapshot = c;
        var cur = parseFloat(c.dataset.fxBlur) || 0;
        var input = prompt('Blur amount in px (0 = off)', String(cur || 5));
        if (input === null) return null;
        var v = parseFloat(input);
        if (!isFinite(v) || v < 0){ showToast('Invalid value'); return null; }
        wasJustEnabled = (v > 0);
        return v;
      },
      function(c, v){
        if (v === 0) delete c.dataset.fxBlur;
        else c.dataset.fxBlur = String(v);
      },
      'Blur {val}px'
    );
    if (wasJustEnabled){
      addFxIndicatorClip('Blur', '\ud83c\udf2b\ufe0f', {
        active: activeSnapshot,
        fxKey: 'fxBlur',
        fxValue: activeSnapshot ? (activeSnapshot.dataset.fxBlur || '') : ''
      });
    }
  }
  function clipActionFxGlow(){     toggleClipFlag('Glow',     'fxGlow');     }
  function clipActionFxVignette(){ toggleClipFlag('Vignette', 'fxVignette'); }
  function clipActionFxGrain(){    toggleClipFlag('Film grain','fxGrain');   }
  function clipActionFxSharpen(){  toggleClipFlag('Sharpen',             'fxSharpen');   }
  function clipActionFxChromatic(){toggleClipFlag('Chromatic aberration','fxChromatic'); }
  function clipActionFxPixelate(){ toggleClipFlag('Pixelate',            'fxPixelate');  }
  function clipActionFxNoise(){    toggleClipFlag('Noise',    'fxGrain');    } // alias for grain

  // ── FX: Color ──
  function promptColorProp(key, cur, label){
    return function(){
      promptToActiveClips(
        function(c){
          var curVal = parseFloat(c.dataset[key]) || 1;
          var input = prompt(label, String(curVal));
          if (input === null) return null;
          var v = parseFloat(input);
          if (!isFinite(v) || v < 0){ showToast('Invalid'); return null; }
          return v;
        },
        function(c, v){
          if (v === 1) delete c.dataset[key];
          else c.dataset[key] = String(v);
        },
        cur + ' {val}'
      );
    };
  }
  var clipActionFxBrightness = promptColorProp('fxBrightness', 'Brightness',
    'Brightness multiplier (1.0 = neutral, 0.5 dim, 1.5 bright)');
  var clipActionFxContrast = promptColorProp('fxContrast',   'Contrast',
    'Contrast multiplier (1.0 = neutral)');
  var clipActionFxSaturation = promptColorProp('fxSaturate', 'Saturation',
    'Saturation (1.0 = neutral, 0 = B&W, 2 = vivid)');
  function clipActionFxColorGrade(){
    var gradeApplied = null;
    var activeSnapshot = null;
    promptToActiveClips(
      function(c){
        activeSnapshot = c;
        var cur = c.dataset.fxColorGrade || '';
        var input = prompt(
          'Color grade preset (warm, cool, vintage, bw, punch, or blank to clear)',
          cur);
        if (input === null) return null;
        var v = (input || '').trim().toLowerCase();
        if (!v) return 'clear';
        if (['warm','cool','vintage','bw','punch'].indexOf(v) === -1){
          showToast('Unknown preset'); return null;
        }
        gradeApplied = v;
        return v;
      },
      function(c, v){
        if (v === 'clear') delete c.dataset.fxColorGrade;
        else c.dataset.fxColorGrade = v;
      },
      'Grade: {val}'
    );
    if (gradeApplied){
      var pretty = gradeApplied.charAt(0).toUpperCase() + gradeApplied.slice(1);
      addFxIndicatorClip('Grade: ' + pretty, '\ud83c\udfa8', {
        active: activeSnapshot,
        fxKey: 'fxColorGrade',
        fxValue: gradeApplied
      });
    }
  }

  try {
    window.clipActionFxBlur       = clipActionFxBlur;
    window.clipActionFxGlow       = clipActionFxGlow;
    window.clipActionFxVignette   = clipActionFxVignette;
    window.clipActionFxGrain      = clipActionFxGrain;
    window.clipActionFxSharpen    = clipActionFxSharpen;
    window.clipActionFxChromatic  = clipActionFxChromatic;
    window.clipActionFxPixelate   = clipActionFxPixelate;
    window.clipActionFxNoise      = clipActionFxNoise;
    window.clipActionFxBrightness = clipActionFxBrightness;
    window.clipActionFxContrast   = clipActionFxContrast;
    window.clipActionFxSaturation = clipActionFxSaturation;
    window.clipActionFxColorGrade = clipActionFxColorGrade;
  } catch(_){}

  // Expose so v10-editor-redesign.js EDIT-tab buttons can call them.
  try {
    window.clipActionTrim     = clipActionTrim;
    window.clipActionSplit    = clipActionSplit;
    window.clipActionSpeed    = clipActionSpeed;
    window.clipActionCrop     = clipActionCrop;
    window.clipActionResize   = clipActionResize;
    window.clipActionRotate   = clipActionRotate;
    window.clipActionFlip     = clipActionFlip;
    window.clipActionPosition = clipActionPosition;
    window.clipActionReverse  = clipActionReverse;
    window.clipActionLoop     = clipActionLoop;
    window.clipActionFreeze   = clipActionFreeze;
    window.clipActionKeyframe = clipActionKeyframe;
    window.clipActionTextFontSize = clipActionTextFontSize;
    window.clipActionTextColor    = clipActionTextColor;
    window.clipActionTextPosition = clipActionTextPosition;
  } catch(_){}

  // Merge the clip's own FX dataset with any FX-track clips whose time
  // range overlaps `playheadPx`. Returns a plain object the render
  // functions read from (instead of reading clip.dataset directly) so a
  // single FX-track clip dragged across multiple V1 clips broadcasts
  // its effect to every V1 clip it covers.
  function resolveEffectiveFx(clip, playheadPx){
    var eff = {};
    if (clip){
      eff.fxBrightness = clip.dataset.fxBrightness;
      eff.fxContrast   = clip.dataset.fxContrast;
      eff.fxSaturate   = clip.dataset.fxSaturate;
      eff.fxBlur       = clip.dataset.fxBlur;
      eff.fxHue        = clip.dataset.fxHue;
      eff.fxColorGrade = clip.dataset.fxColorGrade;
      eff.fxSharpen    = clip.dataset.fxSharpen;
      eff.fxVignette   = clip.dataset.fxVignette;
      eff.fxGlow       = clip.dataset.fxGlow;
      eff.fxGrain      = clip.dataset.fxGrain;
      eff.fxChromatic  = clip.dataset.fxChromatic;
      eff.fxPixelate   = clip.dataset.fxPixelate;
    }
    if (!isFinite(playheadPx)) return eff;
    Array.from(document.querySelectorAll('.mt-track-fx .mt-clip')).forEach(function(fx){
      var l = parseFloat(fx.style.left)  || 0;
      var w = parseFloat(fx.style.width) || 0;
      if (playheadPx < l || playheadPx > l + w) return;
      var key = fx.dataset.fxKey;
      var val = fx.dataset.fxValue;
      if (!key) return;
      // Only override if the FX-track clip has a meaningful value
      if (val === undefined || val === '' || val === 'false') return;
      eff[key] = val;
    });
    return eff;
  }
  try { window.resolveEffectiveFx = resolveEffectiveFx; } catch(_){}

  // Build a ctx.filter CSS-filter string from the active clip's FX flags.
  // Returns '' when no filters are active so the caller can skip setting.
  // `fxFlags` is optional — when provided it overrides clip.dataset so
  // callers can inject FX-track effects that apply to this clip.
  function progBuildClipFilter(clip, fxFlags){
    if (!clip) return '';
    var d = fxFlags || clip.dataset;
    var parts = [];
    var b = parseFloat(d.fxBrightness);
    var c = parseFloat(d.fxContrast);
    var s = parseFloat(d.fxSaturate);
    var blur = parseFloat(d.fxBlur);
    var hue = parseFloat(d.fxHue);
    var grad = d.fxColorGrade;
    if (isFinite(b) && b !== 1) parts.push('brightness(' + b + ')');
    if (isFinite(c) && c !== 1) parts.push('contrast(' + c + ')');
    if (isFinite(s) && s !== 1) parts.push('saturate(' + s + ')');
    if (isFinite(blur) && blur > 0) parts.push('blur(' + blur + 'px)');
    if (isFinite(hue) && hue !== 0) parts.push('hue-rotate(' + hue + 'deg)');
    if (d.fxSharpen === 'true') parts.push('contrast(1.15)', 'saturate(1.05)');
    if (grad === 'warm')       parts.push('sepia(.25)','saturate(1.15)','hue-rotate(-10deg)');
    else if (grad === 'cool')  parts.push('saturate(1.1)','hue-rotate(8deg)','brightness(.97)');
    else if (grad === 'vintage') parts.push('sepia(.45)','contrast(1.05)','saturate(.85)');
    else if (grad === 'bw')    parts.push('grayscale(1)','contrast(1.1)');
    else if (grad === 'punch') parts.push('contrast(1.18)','saturate(1.25)');
    return parts.join(' ');
  }
  // Post-draw FX overlays (vignette / grain / pixelate-indicator / glow
  // ring) that can't be expressed as ctx.filter. Drawn INSIDE the clip
  // rect so they never bleed into pillar/letterboxes.
  function progDrawClipPostFX(ctx, W, H, rect, clip, fxFlags){
    if (!clip || !rect) return;
    var d = fxFlags || clip.dataset;
    // Vignette: radial gradient overlay centered on the video rect
    if (d.fxVignette === 'true'){
      var cx = rect.dx + rect.dw/2, cy = rect.dy + rect.dh/2;
      var rMax = Math.max(rect.dw, rect.dh) * 0.75;
      var grad = ctx.createRadialGradient(cx, cy, rMax * 0.45, cx, cy, rMax);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.72)');
      ctx.fillStyle = grad;
      ctx.fillRect(rect.dx, rect.dy, rect.dw, rect.dh);
    }
    // Film grain: pepper the rect with tiny random translucent dots
    if (d.fxGrain === 'true'){
      ctx.save();
      ctx.globalAlpha = 0.12;
      for (var i = 0; i < 180; i++){
        var rx = rect.dx + Math.random() * rect.dw;
        var ry = rect.dy + Math.random() * rect.dh;
        ctx.fillStyle = Math.random() < 0.5 ? '#ffffff' : '#000000';
        ctx.fillRect(rx, ry, 1, 1);
      }
      ctx.restore();
    }
    // Glow: purple rim glow inside the rect edges
    if (d.fxGlow === 'true'){
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var g = ctx.createLinearGradient(rect.dx, rect.dy, rect.dx + rect.dw, rect.dy + rect.dh);
      g.addColorStop(0, 'rgba(139,92,246,0.15)');
      g.addColorStop(1, 'rgba(236,72,153,0.15)');
      ctx.fillStyle = g;
      ctx.fillRect(rect.dx, rect.dy, rect.dw, rect.dh);
      ctx.restore();
    }
  }

  // Per-clip transform offsets composed UNDER motion in the render stack.
  // Applied inside the video-rect clip so pillar/letterboxes stay black.
  // If the clip has keyframes and clipTimeSec is provided, scale/offsetX/
  // offsetY interpolate from the keyframe track at that time.
  function progApplyClipTransforms(ctx, W, H, clip, clipTimeSec){
    if (!clip) return;
    var scale = parseFloat(clip.dataset.scale)   || 1;
    var rot   = parseFloat(clip.dataset.rotate)  || 0;
    var flipH = clip.dataset.flipH === 'true';
    var flipV = clip.dataset.flipV === 'true';
    var offX  = parseFloat(clip.dataset.offsetX) || 0;
    var offY  = parseFloat(clip.dataset.offsetY) || 0;
    // Keyframe interpolation overrides statics for scale / offsetX / offsetY
    var kfs = readClipKeyframes(clip);
    if (kfs.length > 0 && isFinite(clipTimeSec)){
      scale = interpolateKeyframeProp(kfs, 'scale',   clipTimeSec, scale);
      offX  = interpolateKeyframeProp(kfs, 'offsetX', clipTimeSec, offX);
      offY  = interpolateKeyframeProp(kfs, 'offsetY', clipTimeSec, offY);
    }
    if (scale === 1 && rot === 0 && !flipH && !flipV && offX === 0 && offY === 0) return;
    var cx = W/2, cy = H/2;
    ctx.translate(cx + offX, cy + offY);
    if (rot)   ctx.rotate(rot * Math.PI / 180);
    if (scale !== 1) ctx.scale(scale, scale);
    if (flipH || flipV) ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    ctx.translate(-cx, -cy);
  }

  // Find motion clips on M1 whose timeline range contains playhead x,
  // and return {clip, progress 0..1 across clip} for each.
  function getActiveMotionEffectsAtPlayheadX(phX){
    var out = [];
    document.querySelectorAll('.mt-track-music .mt-clip').forEach(function(c){
      if (c.dataset.clipType !== 'motion') return;
      var l = parseFloat(c.style.left)  || 0;
      var w = parseFloat(c.style.width) || 0;
      if (phX >= l && phX <= l + w){
        out.push({ clip: c, progress: (phX - l) / Math.max(1, w) });
      }
    });
    return out;
  }

  // Given an array of active motion effects, apply the combined transform +
  // alpha to ctx BEFORE drawing the visual. Returns the alpha value to use
  // (so fades work correctly) and whether we wrapped ctx in a save/restore.
  // Callers must call progExitMotion(ctx, state) after drawing the visual.
  // Motion effects are render-time TRANSFORM OFFSETS composed on top of
  // the video's base state. The underlying data model never mutates:
  //   - The video element is always centered at its original size.
  //   - The clip's "position" and "scale" properties stay at default.
  // Each RAF we ctx.save() → apply offsets (translate/scale/rotate/alpha)
  // → draw video → ctx.restore() so the canvas transform returns to
  // identity. The offsets animate via sin(progress·π) so the effect
  // peaks in the middle and returns to 0-offset at both clip endpoints
  // (clean entry + exit, no permanent shift).
  //
  // progExitMotion additionally paints a compact badge naming the active
  // motion(s) — useful feedback on long timelines when the viewer might
  // otherwise miss a subtle pan / shake / rotate starting up.
  function progApplyMotion(ctx, W, H, active){
    if (!active || !active.length) return null;
    ctx.save();
    var alpha = 1;
    var cx = W / 2, cy = H / 2;
    var effects = [];
    active.forEach(function(mo){
      var key  = mo.clip.dataset.motionEffect;
      if (key) effects.push(key);
      var p    = Math.max(0, Math.min(1, mo.progress));
      // Pulse: 0 → 1 → 0 across the clip. Offsets start and end at zero.
      var pulse = Math.sin(p * Math.PI);
      if (key === 'zoom-in'){
        var s = 1 + 0.3 * pulse;      // scale offset: +30% at midpoint
        ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy);
      } else if (key === 'zoom-out'){
        var s2 = 1 - 0.2 * pulse;      // scale offset: -20% at midpoint
        ctx.translate(cx, cy); ctx.scale(s2, s2); ctx.translate(-cx, -cy);
      } else if (key === 'pan-left'){
        ctx.translate(-W * 0.2 * pulse, 0);
      } else if (key === 'pan-right'){
        ctx.translate( W * 0.2 * pulse, 0);
      } else if (key === 'fade-in'){
        // Linear one-way — alpha 0 → 1 (base state at clip end is 1).
        alpha *= p;
      } else if (key === 'fade-out'){
        // Linear one-way — alpha 1 → 0 (base state at clip start is 1).
        alpha *= (1 - p);
      } else if (key === 'shake'){
        var amp = 6 * pulse;
        ctx.translate((Math.random()*2-1)*amp, (Math.random()*2-1)*amp);
      } else if (key === 'rotate'){
        var deg = 10 * pulse;          // rotation offset: 10° at midpoint
        ctx.translate(cx, cy); ctx.rotate(deg * Math.PI/180); ctx.translate(-cx, -cy);
      }
    });
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    return { active: true, effects: effects };
  }
  // Transform-only restore — used inside the clipped region before the
  // outer clip save/restore unwinds. Separated from badge-draw so the
  // badge can paint on the unclipped canvas AFTER the outer restore.
  function progExitMotionTransform(ctx, state){
    if (state && state.active) ctx.restore();
  }
  function progDrawMotionBadge(ctx, state){
    if (!state || !state.effects || !state.effects.length) return;
    var W = ctx.canvas.width;
    var names = state.effects.map(function(k){
      return ({
        'zoom-in':'Zoom In', 'zoom-out':'Zoom Out',
        'pan-left':'Pan Left', 'pan-right':'Pan Right',
        'fade-in':'Fade In', 'fade-out':'Fade Out',
        'shake':'Shake', 'rotate':'Rotate'
      })[k] || k;
    }).filter(Boolean);
    if (!names.length) return;
    var label = names.join(' + ');
    ctx.save();
    ctx.font = '600 11px -apple-system,system-ui,sans-serif';
    ctx.textBaseline = 'top';
    var padX = 8, padY = 5;
    var textW = ctx.measureText(label).width;
    var badgeW = textW + padX * 2;
    var badgeH = 11 + padY * 2;
    var bx = W - badgeW - 14;
    var by = 50;
    ctx.fillStyle = 'rgba(236,72,153,.85)';
    ctx.beginPath();
    var r = 5;
    ctx.moveTo(bx + r, by);
    ctx.arcTo(bx + badgeW, by, bx + badgeW, by + badgeH, r);
    ctx.arcTo(bx + badgeW, by + badgeH, bx, by + badgeH, r);
    ctx.arcTo(bx, by + badgeH, bx, by, r);
    ctx.arcTo(bx, by, bx + badgeW, by, r);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(label, bx + padX, by + padY);
    ctx.restore();
  }

  // Return every text clip whose timeline range contains playhead x.
  function getTextClipsAtPlayheadX(phX){
    var out = [];
    document.querySelectorAll('.mt-track-text .mt-clip').forEach(function(c){
      var l = parseFloat(c.style.left)  || 0;
      var w = parseFloat(c.style.width) || 0;
      if (phX >= l && phX <= l + w) out.push(c);
    });
    return out;
  }

  // Draw text overlays from T1 clips on top of the PGM canvas.
  function progDrawTextOverlays(ctx, W, H, phX){
    var clips = getTextClipsAtPlayheadX(phX);
    if (!clips.length) return;
    clips.forEach(function(clip){
      var text = clip.dataset.textContent || clip.dataset.fileName || '';
      if (!text) return;
      var size  = parseInt(clip.dataset.fontSize, 10) || Math.round(H * 0.08);
      var color = clip.dataset.textColor || '#ffffff';
      var pos   = clip.dataset.position || 'center';
      ctx.save();
      ctx.font = '700 ' + size + 'px -apple-system,system-ui,"Segoe UI",Roboto,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = color;
      // Soft drop shadow for readability over any background.
      ctx.shadowColor = 'rgba(0,0,0,.65)';
      ctx.shadowBlur = size * 0.4;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = Math.round(size * 0.08);
      var x = W / 2;
      var y;
      if (pos === 'top')         y = Math.round(H * 0.15) + size;
      else if (pos === 'bottom') y = H - Math.round(H * 0.12);
      else                        y = Math.round(H / 2 + size / 3);
      // Wrap long text to ≤90% canvas width
      var maxW = W * 0.9;
      var words = String(text).split(/\s+/);
      var lines = [];
      var current = '';
      words.forEach(function(w){
        var test = current ? (current + ' ' + w) : w;
        if (ctx.measureText(test).width > maxW && current){
          lines.push(current); current = w;
        } else { current = test; }
      });
      if (current) lines.push(current);
      // Paint lines centered around y
      var lineH = Math.round(size * 1.15);
      var totalH = lineH * lines.length;
      var startY = y - totalH / 2 + lineH / 2;
      lines.forEach(function(ln, i){
        ctx.fillText(ln, x, startY + i * lineH);
      });
      ctx.restore();
    });
  }

  // Small modal for entering text + choosing size / color / duration / position.
  function openTextInputModal(cb){
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(8,6,18,.72);z-index:100000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
    overlay.innerHTML = ''+
      '<div style="background:#1a1028;border:1px solid rgba(139,92,246,.5);border-radius:14px;padding:18px 18px 14px;width:360px;max-width:92vw;color:#e2e0f0;font-family:-apple-system,system-ui,sans-serif">'+
        '<h3 style="margin:0 0 12px;font-size:15px;font-weight:800;letter-spacing:.3px">Add Text</h3>'+
        '<label style="display:block;font-size:10px;font-weight:700;color:#a78bfa;margin-bottom:4px">TEXT</label>'+
        '<textarea id="mtTxtIn" rows="3" placeholder="Type your text here..." style="width:100%;background:#0c0814;border:1px solid rgba(108,58,237,.35);border-radius:7px;color:#fff;padding:8px 10px;font-size:13px;resize:vertical;box-sizing:border-box"></textarea>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">'+
          '<div><label style="display:block;font-size:10px;font-weight:700;color:#a78bfa;margin-bottom:4px">DURATION (s)</label>'+
          '<input id="mtTxtDur" type="number" min="1" max="120" value="5" style="width:100%;background:#0c0814;border:1px solid rgba(108,58,237,.35);border-radius:7px;color:#fff;padding:6px 8px;font-size:13px;box-sizing:border-box"/></div>'+
          '<div><label style="display:block;font-size:10px;font-weight:700;color:#a78bfa;margin-bottom:4px">FONT SIZE (px)</label>'+
          '<input id="mtTxtSize" type="number" min="8" max="200" value="10" style="width:100%;background:#0c0814;border:1px solid rgba(108,58,237,.35);border-radius:7px;color:#fff;padding:6px 8px;font-size:13px;box-sizing:border-box"/></div>'+
        '</div>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">'+
          '<div><label style="display:block;font-size:10px;font-weight:700;color:#a78bfa;margin-bottom:4px">COLOR</label>'+
          '<input id="mtTxtColor" type="color" value="#ffffff" style="width:100%;height:34px;background:#0c0814;border:1px solid rgba(108,58,237,.35);border-radius:7px;padding:2px;cursor:pointer"/></div>'+
          '<div><label style="display:block;font-size:10px;font-weight:700;color:#a78bfa;margin-bottom:4px">POSITION</label>'+
          '<select id="mtTxtPos" style="width:100%;background:#0c0814;border:1px solid rgba(108,58,237,.35);border-radius:7px;color:#fff;padding:7px 8px;font-size:13px"><option value="top">Top</option><option value="center">Center</option><option value="bottom" selected>Bottom</option></select></div>'+
        '</div>'+
        '<div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">'+
          '<button id="mtTxtCancel" style="padding:7px 14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);border-radius:7px;color:#e2e0f0;cursor:pointer;font-weight:600">Cancel</button>'+
          '<button id="mtTxtOk" style="padding:7px 16px;background:linear-gradient(135deg,#7c3aed,#a855f7);border:0;border-radius:7px;color:#fff;cursor:pointer;font-weight:700">Add</button>'+
        '</div>'+
      '</div>';
    document.body.appendChild(overlay);
    var ta = overlay.querySelector('#mtTxtIn');
    var durI = overlay.querySelector('#mtTxtDur');
    var sizeI = overlay.querySelector('#mtTxtSize');
    var colorI = overlay.querySelector('#mtTxtColor');
    var posI = overlay.querySelector('#mtTxtPos');
    var ok = overlay.querySelector('#mtTxtOk');
    var cancel = overlay.querySelector('#mtTxtCancel');
    setTimeout(function(){ try { ta.focus(); } catch(_){} }, 50);
    function close(){ try { overlay.remove(); } catch(_){} }
    cancel.addEventListener('click', close);
    overlay.addEventListener('click', function(e){ if (e.target === overlay) close(); });
    ok.addEventListener('click', function(){
      var text = (ta.value || '').trim();
      if (!text){ ta.focus(); return; }
      var spec = {
        duration:  Math.max(1, Math.min(120, parseInt(durI.value, 10) || 5)),
        fontSize:  Math.max(8, Math.min(200, parseInt(sizeI.value, 10) || 10)),
        textColor: colorI.value || '#ffffff',
        position:  posI.value || 'bottom'
      };
      close();
      if (typeof cb === 'function') cb(text, spec);
    });
    // ESC closes, Ctrl/Cmd+Enter submits
    overlay.addEventListener('keydown', function(e){
      if (e.key === 'Escape'){ e.stopPropagation(); close(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter'){ e.preventDefault(); ok.click(); }
    });
    return overlay;
  }
  try { window.openTextInputModal = openTextInputModal; } catch(_){}

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
    // Transport owns the playhead when it's playing — skip passive sync
    // so wall-clock and video-driven updates don't fight each other.
    if (_transport && _transport.playing) return;
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
      // Transport manages sequencing during its own playback — don't
      // double up the gap animation.
      if (_transport && _transport.playing) return;
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

  // Load a clicked Media item into the main preview so the user sees it
  // IMMEDIATELY upon placement — without waiting for the playhead to cross
  // into its range on the timeline.
  //
  //   video → set videoPlayer.src + mount editor state (existing behavior)
  //   image → show the image overlay on the preview window
  //   audio → skip (no visual to show)
  function loadMediaItemIntoPreview(item){
    var mediaType = item.dataset.mediaType || 'vid';
    var url = item.dataset.mediaUrl;
    if (!url) return;
    if (mediaType === 'img'){
      // Image overlay takes over the preview; hide black if it was showing.
      hideBlackPreview();
      showImagePreview(url);
      // If the PGM canvas is on, it's already drawing the image per-frame
      // via the RAF loop — nothing more needed.
      return;
    }
    if (mediaType !== 'vid') return; // audio: no visual change
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
      addClipToTimeline(fileName, mediaType, item.dataset.duration, item.dataset.mediaUrl);
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
