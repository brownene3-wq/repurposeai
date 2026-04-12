/* ===========================================
   Splicora Page Editor — GrapesJS Integration
   =========================================== */

var editor;
var isDirty = false;
var lastSavedAt = null;

// Toast notifications
function showToast(msg, type) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'editor-toast ' + (type || 'info') + ' show';
  setTimeout(function() { el.classList.remove('show'); }, 3000);
}

// Device switching
function setDevice(device) {
  editor.setDevice(device);
  document.querySelectorAll('.device-btns button').forEach(function(b) { b.classList.remove('active'); });
  if (device === 'Desktop') document.getElementById('deviceDesktop').classList.add('active');
  else if (device === 'Tablet') document.getElementById('deviceTablet').classList.add('active');
  else document.getElementById('deviceMobile').classList.add('active');
}

// Save draft
function saveDraft() {
  var data = {
    html: editor.getHtml(),
    css: editor.getCss(),
    components: JSON.stringify(editor.getComponents()),
    style: JSON.stringify(editor.getStyle()),
  };
  return fetch('/admin/api/page-content/' + PAGE_SLUG, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  .then(function(resp) { return resp.json(); })
  .then(function(result) {
    if (result.success) {
      isDirty = false;
      lastSavedAt = new Date();
      document.getElementById('statusDot').classList.add('saved');
      document.getElementById('saveStatus').textContent = 'Saved ' + lastSavedAt.toLocaleTimeString();
      showToast('Draft saved', 'success');
    } else {
      showToast('Save failed: ' + (result.error || 'Unknown'), 'error');
    }
  })
  .catch(function(err) {
    showToast('Save error: ' + err.message, 'error');
  });
}

// Publish
function publishPage() {
  if (!confirm('Publish this page? It will go live immediately.')) return;
  saveDraft().then(function() {
    return fetch('/admin/api/page-content/' + PAGE_SLUG + '/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  })
  .then(function(resp) { return resp.json(); })
  .then(function(result) {
    if (result.success) {
      showToast('Page published! Live now.', 'success');
    } else {
      showToast('Publish failed: ' + (result.error || 'Unknown'), 'error');
    }
  })
  .catch(function(err) {
    showToast('Publish error: ' + err.message, 'error');
  });
}

// Revert
function revertDraft() {
  if (!confirm('Discard all unsaved changes and revert to the published version?')) return;
  fetch('/admin/api/page-content/' + PAGE_SLUG + '/revert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  .then(function() {
    showToast('Draft reverted. Reloading...', 'info');
    setTimeout(function() { location.reload(); }, 800);
  })
  .catch(function(err) {
    showToast('Revert error: ' + err.message, 'error');
  });
}

// Preview
function previewPage() {
  var html = editor.getHtml();
  var css = editor.getCss();
  var previewWindow = window.open('', '_blank');
  previewWindow.document.write('<!DOCTYPE html><html><head><style>' + css + '</style></head><body>' + html + '</body></html>');
  previewWindow.document.close();
}

// Check if a URL points to a video file
function isVideoUrl(url) {
  if (!url) return false;
  var ext = url.split('.').pop().toLowerCase().split('?')[0];
  return (ext === 'mp4' || ext === 'webm' || ext === 'mov');
}

// Initialize GrapesJS
function initEditor() {
  var initialHtml = '';
  var initialCss = '';
  var initialComponents = null;
  var initialStyles = null;

  fetch('/admin/api/page-content/' + PAGE_SLUG + '?status=draft')
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
      if (data.content && data.content.content_components) {
        initialComponents = data.content.content_components;
        initialStyles = data.content.content_style;
      } else if (data.content && data.content.content_html) {
        initialHtml = data.content.content_html;
        initialCss = data.content.content_css || '';
      }
    })
    .catch(function(err) {
      console.warn('Could not load saved content:', err);
    })
    .then(function() {
      // If no saved content in DB, fetch the actual live homepage HTML
      if (!initialHtml && !initialComponents) {
        return fetch('/?raw=1')
          .then(function(resp) { return resp.text(); })
          .then(function(fullPage) {
            // Extract the <body> content and <style> content from the live page
            var bodyMatch = fullPage.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
            var styleMatches = fullPage.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
            if (bodyMatch && bodyMatch[1]) {
              // Remove <script> tags from body content (editor doesn't need JS)
              initialHtml = bodyMatch[1].replace(/<script[\s\S]*?<\/script>/gi, '').trim();
            }
            if (styleMatches) {
              initialCss = styleMatches.map(function(s) {
                return s.replace(/<\/?style[^>]*>/gi, '');
              }).join('\n');
            }
          })
          .catch(function(err) {
            console.warn('Could not fetch live homepage:', err);
          });
      }
    })
    .then(function() {
      buildEditor(initialHtml, initialCss, initialComponents, initialStyles);
    });
}

function buildEditor(initialHtml, initialCss, initialComponents, initialStyles) {
  // If still no content after trying DB and live page, show minimal fallback
  if (!initialHtml && !initialComponents) {
    initialHtml = '<section style="padding:80px 20px;text-align:center;max-width:1200px;margin:0 auto">' +
      '<h1 style="font-size:2rem;font-weight:800;margin-bottom:1rem;color:#888">No page content found</h1>' +
      '<p style="color:#666">Use the blocks panel on the right to start building your page.</p>' +
      '</section>';
  }

  var editorConfig = {
    container: '#gjs',
    height: '100%',
    width: 'auto',
    storageManager: false,
    deviceManager: {
      devices: [
        { name: 'Desktop', width: '' },
        { name: 'Tablet', width: '768px', widthMedia: '992px' },
        { name: 'Mobile portrait', width: '375px', widthMedia: '480px' },
      ]
    },
    panels: { defaults: [] },
    canvas: { styles: [] },
    layerManager: { appendTo: '#layers-container' },
    traitManager: { appendTo: '#traits-container' },
    selectorManager: { appendTo: '#styles-container' },
    assetManager: {
      uploadName: 'file',
      upload: '/admin/api/page-editor/upload',
      uploadFile: function(e) {
        var files = e.dataTransfer ? e.dataTransfer.files : e.target.files;
        var formData = new FormData();
        for (var i = 0; i < files.length; i++) {
          formData.append('file', files[i]);
        }
        fetch('/admin/api/page-editor/upload', {
          method: 'POST',
          body: formData,
        })
        .then(function(resp) { return resp.json(); })
        .then(function(data) {
          if (data.success) {
            var assetType = isVideoUrl(data.url) ? 'video' : 'image';
            editor.AssetManager.add({ src: data.url, type: assetType });
            showToast('File uploaded', 'success');
          }
        })
        .catch(function() {
          showToast('Upload failed', 'error');
        });
      },
      autoAdd: true,
    },
    styleManager: {
      appendTo: '#styles-container',
      sectors: [
        { name: 'Typography', open: true, properties: ['font-family','font-size','font-weight','letter-spacing','color','line-height','text-align','text-decoration','text-shadow'] },
        { name: 'Layout', properties: ['display','width','height','max-width','min-height','margin','padding'] },
        { name: 'Background', properties: ['background-color','background-image','background-repeat','background-position','background-size'] },
        { name: 'Border', properties: ['border-radius','border','box-shadow'] },
        { name: 'Extra', properties: ['opacity','transition','transform'] },
      ],
    },
    blockManager: {
      appendTo: '#blocks-container',
      blocks: [
        {
          id: 'text-block',
          label: 'Text Block',
          category: 'Content',
          content: '<div style="padding:20px"><h2 style="margin-bottom:12px">Heading</h2><p style="color:#a0aec0">Your paragraph text here. Click to edit.</p></div>',
          media: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>',
        },
        {
          id: 'image-block',
          label: 'Image',
          category: 'Content',
          content: '<div data-gjs-type="image-placeholder" style="width:100%;min-height:200px;background:rgba(108,58,237,0.1);border:2px dashed rgba(108,58,237,0.4);border-radius:12px;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:40px;text-align:center"><div style="color:rgba(108,58,237,0.7);font-size:14px"><div style="font-size:48px;margin-bottom:12px">&#128247;</div>Click to add image<br><span style="font-size:12px;opacity:0.7">or drag an image file here</span></div></div>',
          media: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
        },
        {
          id: 'video-block',
          label: 'Video',
          category: 'Content',
          content: '<div data-gjs-type="video-placeholder" style="width:100%;min-height:200px;background:rgba(236,72,153,0.1);border:2px dashed rgba(236,72,153,0.4);border-radius:12px;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:40px;text-align:center"><div style="color:rgba(236,72,153,0.7);font-size:14px"><div style="font-size:48px;margin-bottom:12px">&#127916;</div>Click to add video<br><span style="font-size:12px;opacity:0.7">YouTube, Vimeo, or direct .mp4 link</span></div></div>',
          media: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
        },
        {
          id: 'button-block',
          label: 'Button',
          category: 'Content',
          content: '<a style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border-radius:50px;text-decoration:none;font-weight:700;font-size:.95rem">Click Me</a>',
          media: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="8" width="18" height="8" rx="4"/></svg>',
        },
        {
          id: 'divider-block',
          label: 'Divider',
          category: 'Content',
          content: '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:32px 0">',
          media: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="3" y1="12" x2="21" y2="12"/></svg>',
        },
        {
          id: 'section-block',
          label: 'Section',
          category: 'Layout',
          content: '<section style="padding:60px 20px;max-width:1200px;margin:0 auto"><h2 style="font-size:2rem;font-weight:800;margin-bottom:1rem;text-align:center">New Section</h2><p style="text-align:center;color:#a0aec0;max-width:600px;margin:0 auto">Add your content here.</p></section>',
          media: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>',
        },
        {
          id: 'columns-2',
          label: '2 Columns',
          category: 'Layout',
          content: '<div style="display:flex;gap:24px;padding:20px"><div style="flex:1;padding:20px;background:rgba(255,255,255,0.03);border-radius:12px;border:1px solid rgba(255,255,255,0.08)"><p>Column 1</p></div><div style="flex:1;padding:20px;background:rgba(255,255,255,0.03);border-radius:12px;border:1px solid rgba(255,255,255,0.08)"><p>Column 2</p></div></div>',
          media: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="8" height="18" rx="1"/><rect x="13" y="3" width="8" height="18" rx="1"/></svg>',
        },
        {
          id: 'columns-3',
          label: '3 Columns',
          category: 'Layout',
          content: '<div style="display:flex;gap:20px;padding:20px"><div style="flex:1;padding:20px;background:rgba(255,255,255,0.03);border-radius:12px;border:1px solid rgba(255,255,255,0.08)"><p>Column 1</p></div><div style="flex:1;padding:20px;background:rgba(255,255,255,0.03);border-radius:12px;border:1px solid rgba(255,255,255,0.08)"><p>Column 2</p></div><div style="flex:1;padding:20px;background:rgba(255,255,255,0.03);border-radius:12px;border:1px solid rgba(255,255,255,0.08)"><p>Column 3</p></div></div>',
          media: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="5.5" height="18" rx="1"/><rect x="9.25" y="3" width="5.5" height="18" rx="1"/><rect x="16.5" y="3" width="5.5" height="18" rx="1"/></svg>',
        },
      ]
    },
  };

  // Load from components JSON if available (preserves full structure)
  if (initialComponents) {
    try {
      editorConfig.components = JSON.parse(initialComponents);
      editorConfig.style = JSON.parse(initialStyles || '[]');
    } catch (e) {
      editorConfig.components = initialHtml;
      if (initialCss) editorConfig.style = initialCss;
    }
  } else if (initialHtml) {
    editorConfig.components = initialHtml;
    if (initialCss) editorConfig.style = initialCss;
  }

  editor = grapesjs.init(editorConfig);

  // Build custom sidebar panel switcher
  var switcher = document.getElementById('panelSwitcher');
  var tabs = [
    { id: 'blocks-container', label: 'Blocks' },
    { id: 'styles-container', label: 'Style' },
    { id: 'layers-container', label: 'Layers' },
    { id: 'traits-container', label: 'Settings' },
  ];
  tabs.forEach(function(tab, idx) {
    var btn = document.createElement('button');
    btn.textContent = tab.label;
    btn.className = 'gjs-pn-btn' + (idx === 0 ? ' gjs-pn-active' : '');
    btn.addEventListener('click', function() {
      // Toggle active button
      switcher.querySelectorAll('.gjs-pn-btn').forEach(function(b) { b.classList.remove('gjs-pn-active'); });
      btn.classList.add('gjs-pn-active');
      // Toggle active panel
      var panels = document.querySelectorAll('.panel__content > div');
      panels.forEach(function(p) { p.classList.remove('active'); });
      document.getElementById(tab.id).classList.add('active');
    });
    switcher.appendChild(btn);
  });

  // --- FIX 1: Click-to-add blocks ---
  // GrapesJS only supports drag by default. Add click handler so clicking
  // a block inserts it near the selected component and scrolls to it.
  editor.on('block:drag:stop', function() {}); // keep default drag working
  var blocksEl = document.getElementById('blocks-container');
  if (blocksEl) {
    blocksEl.addEventListener('click', function(e) {
      var blockEl = e.target.closest('.gjs-block');
      if (!blockEl) return;
      // Find the block by matching the element's label text
      var label = blockEl.querySelector('.gjs-block-label');
      var labelText = label ? label.textContent.trim() : '';
      var allBlocks = editor.BlockManager.getAll();
      var matchedBlock = null;
      for (var i = 0; i < allBlocks.length; i++) {
        var b = allBlocks.models[i];
        if (b.get('label') === labelText) {
          matchedBlock = b;
          break;
        }
      }
      if (!matchedBlock) return;

      var content = matchedBlock.get('content');
      var selected = editor.getSelected();
      var added;

      // Insert after selected component, or at end of wrapper if nothing selected
      if (selected) {
        var parent = selected.parent();
        if (parent) {
          var idx = parent.components().indexOf(selected);
          added = parent.components().add(content, { at: idx + 1 });
        } else {
          added = editor.addComponents(content);
        }
      } else {
        added = editor.addComponents(content);
      }

      // Normalize added to a single component reference
      var newComp = Array.isArray(added) ? added[0] : (added && added.models ? added.models[0] : added);

      if (newComp) {
        // Select the newly added component
        editor.select(newComp);

        // Scroll into view in the canvas
        var el = newComp.getEl();
        if (el) {
          var frame = editor.Canvas.getFrameEl();
          if (frame && frame.contentWindow) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }

        // For image placeholder blocks, prompt for image URL or open asset manager
        var blockId = matchedBlock.get('id');
        if (blockId === 'image-block') {
          setTimeout(function() {
            var imgUrl = prompt('Enter image URL (paste a link to your image):');
            if (imgUrl && imgUrl.trim()) {
              // Replace placeholder with actual image
              var imgComp = newComp.parent().components().add(
                { type: 'image', src: imgUrl.trim(), style: { 'max-width': '100%', height: 'auto', 'border-radius': '12px' } },
                { at: newComp.parent().components().indexOf(newComp) }
              );
              newComp.remove();
              var addedImg = Array.isArray(imgComp) ? imgComp[0] : (imgComp.models ? imgComp.models[0] : imgComp);
              if (addedImg) editor.select(addedImg);
              showToast('Image added!', 'success');
            } else {
              showToast('Image placeholder added — double-click it or use Settings to set URL', 'info');
            }
          }, 200);
        }

        // For video placeholder blocks, prompt for video URL
        if (blockId === 'video-block') {
          setTimeout(function() {
            var videoUrl = prompt('Enter video URL (YouTube, Vimeo, or direct .mp4 link):');
            if (videoUrl && videoUrl.trim()) {
              videoUrl = videoUrl.trim();
              var videoContent;
              // Build appropriate embed based on URL type
              if (videoUrl.indexOf('youtube.com') !== -1 || videoUrl.indexOf('youtu.be') !== -1) {
                var ytId = extractYouTubeId(videoUrl);
                videoContent = '<div style="position:relative;width:100%;padding-bottom:56.25%;border-radius:12px;overflow:hidden"><iframe src="https://www.youtube.com/embed/' + ytId + '" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none" allowfullscreen></iframe></div>';
              } else if (videoUrl.indexOf('vimeo.com') !== -1) {
                var vimeoMatch = videoUrl.match(/vimeo\.com\/(\d+)/);
                var vimeoId = vimeoMatch ? vimeoMatch[1] : '';
                videoContent = '<div style="position:relative;width:100%;padding-bottom:56.25%;border-radius:12px;overflow:hidden"><iframe src="https://player.vimeo.com/video/' + vimeoId + '" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none" allowfullscreen></iframe></div>';
              } else {
                videoContent = '<video src="' + videoUrl + '" controls style="max-width:100%;border-radius:12px"></video>';
              }
              // Replace placeholder with actual video embed
              var vidComp = newComp.parent().components().add(videoContent, { at: newComp.parent().components().indexOf(newComp) });
              newComp.remove();
              var addedVid = Array.isArray(vidComp) ? vidComp[0] : (vidComp.models ? vidComp.models[0] : vidComp);
              if (addedVid) editor.select(addedVid);
              showToast('Video embedded!', 'success');
            } else {
              showToast('Video placeholder added — click it to set URL later', 'info');
            }
          }, 200);
        }
      }

      showToast('Added: ' + labelText, 'success');
    });
  }

  // Helper to extract YouTube video ID from various URL formats
  function extractYouTubeId(url) {
    var match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : '';
  }

  // --- FIX 2: Expand layers tree on load ---
  editor.on('load', function() {
    // Open all layer folders so the tree is visible
    setTimeout(function() {
      var layerToggles = document.querySelectorAll('#layers-container .gjs-layer-caret');
      layerToggles.forEach(function(toggle) { toggle.click(); });
    }, 500);
  });

  // --- FIX 2b: Handle double-click on placeholders inside the canvas ---
  editor.on('component:dblclick', function(component) {
    var el = component.getEl();
    if (!el) return;
    var attrType = el.getAttribute('data-gjs-type');
    if (attrType === 'image-placeholder') {
      var imgUrl = prompt('Enter image URL:');
      if (imgUrl && imgUrl.trim()) {
        var parent = component.parent();
        var idx = parent.components().indexOf(component);
        var imgComp = parent.components().add(
          { type: 'image', src: imgUrl.trim(), style: { 'max-width': '100%', height: 'auto', 'border-radius': '12px' } },
          { at: idx }
        );
        component.remove();
        var addedImg = Array.isArray(imgComp) ? imgComp[0] : (imgComp.models ? imgComp.models[0] : imgComp);
        if (addedImg) editor.select(addedImg);
        showToast('Image set!', 'success');
      }
    }
    if (attrType === 'video-placeholder') {
      var videoUrl = prompt('Enter video URL (YouTube, Vimeo, or .mp4):');
      if (videoUrl && videoUrl.trim()) {
        videoUrl = videoUrl.trim();
        var videoContent;
        if (videoUrl.indexOf('youtube.com') !== -1 || videoUrl.indexOf('youtu.be') !== -1) {
          var ytId = extractYouTubeId(videoUrl);
          videoContent = '<div style="position:relative;width:100%;padding-bottom:56.25%;border-radius:12px;overflow:hidden"><iframe src="https://www.youtube.com/embed/' + ytId + '" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none" allowfullscreen></iframe></div>';
        } else if (videoUrl.indexOf('vimeo.com') !== -1) {
          var vimeoMatch = videoUrl.match(/vimeo\.com\/(\d+)/);
          var vimeoId = vimeoMatch ? vimeoMatch[1] : '';
          videoContent = '<div style="position:relative;width:100%;padding-bottom:56.25%;border-radius:12px;overflow:hidden"><iframe src="https://player.vimeo.com/video/' + vimeoId + '" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none" allowfullscreen></iframe></div>';
        } else {
          videoContent = '<video src="' + videoUrl + '" controls style="max-width:100%;border-radius:12px"></video>';
        }
        var parent = component.parent();
        var idx = parent.components().indexOf(component);
        var vidComp = parent.components().add(videoContent, { at: idx });
        component.remove();
        var addedVid = Array.isArray(vidComp) ? vidComp[0] : (vidComp.models ? vidComp.models[0] : vidComp);
        if (addedVid) editor.select(addedVid);
        showToast('Video embedded!', 'success');
      }
    }
  });

  // --- FIX 3: Settings empty state ---
  var traitsC = document.getElementById('traits-container');
  if (traitsC) {
    var emptyMsg = document.createElement('div');
    emptyMsg.id = 'traits-empty-msg';
    emptyMsg.style.cssText = 'padding:24px 16px;text-align:center;color:#666;font-size:.85rem;';
    emptyMsg.innerHTML = 'Click an element on the canvas to see its settings here.';
    traitsC.appendChild(emptyMsg);
    // Show/hide empty message based on selection
    editor.on('component:selected', function() {
      var msg = document.getElementById('traits-empty-msg');
      if (msg) msg.style.display = 'none';
    });
    editor.on('component:deselected', function() {
      var msg = document.getElementById('traits-empty-msg');
      if (msg) msg.style.display = 'block';
    });
  }

  // Track changes
  editor.on('change:changesCount', function() {
    isDirty = true;
    document.getElementById('statusDot').classList.remove('saved');
    document.getElementById('saveStatus').textContent = 'Unsaved changes';
  });

  // Auto-save every 60 seconds if dirty
  setInterval(function() {
    if (isDirty) saveDraft();
  }, 60000);

  // Keyboard shortcut: Ctrl+S / Cmd+S to save
  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveDraft();
    }
  });

  // Hide loading
  document.getElementById('loading').style.display = 'none';
}

// Warn before leaving with unsaved changes
window.addEventListener('beforeunload', function(e) {
  if (isDirty) { e.preventDefault(); e.returnValue = ''; }
});

// Boot
initEditor();
