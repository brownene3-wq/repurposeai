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
      buildEditor(initialHtml, initialCss, initialComponents, initialStyles);
    });
}

function buildEditor(initialHtml, initialCss, initialComponents, initialStyles) {
  // If no saved content, start with a starter template
  if (!initialHtml && !initialComponents) {
    initialHtml = '<section style="padding:80px 20px;text-align:center;max-width:1200px;margin:0 auto">' +
      '<h1 style="font-size:3rem;font-weight:800;margin-bottom:1rem;background:linear-gradient(135deg,#6C3AED,#EC4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent">Your Homepage</h1>' +
      '<p style="font-size:1.1rem;color:#a0aec0;max-width:600px;margin:0 auto 2rem">Click any text to edit it. Drag blocks from the right panel to add new content. Use Save Draft to save your work, and Publish to make it live.</p>' +
      '<a style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#6C3AED,#8B5CF6);color:#fff;border-radius:50px;text-decoration:none;font-weight:700;font-size:1rem">Get Started</a>' +
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
          content: { type: 'image', style: { 'max-width': '100%', height: 'auto', 'border-radius': '12px' }, activeOnRender: 1 },
          media: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
        },
        {
          id: 'video-block',
          label: 'Video',
          category: 'Content',
          content: { type: 'video', src: '', style: { 'max-width': '100%', 'border-radius': '12px' } },
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
  // a block appends it to the canvas at the end.
  editor.on('block:drag:stop', function() {}); // keep default drag working
  var blocksEl = document.getElementById('blocks-container');
  if (blocksEl) {
    blocksEl.addEventListener('click', function(e) {
      var blockEl = e.target.closest('.gjs-block');
      if (!blockEl) return;
      var blockId = blockEl.getAttribute('data-gjs-type') || '';
      // Find the block by matching the element's title or label text
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
      if (matchedBlock) {
        var content = matchedBlock.get('content');
        editor.addComponents(content);
        showToast('Added: ' + labelText, 'success');
      }
    });
  }

  // --- FIX 2: Expand layers tree on load ---
  editor.on('load', function() {
    // Open all layer folders so the tree is visible
    setTimeout(function() {
      var layerToggles = document.querySelectorAll('#layers-container .gjs-layer-caret');
      layerToggles.forEach(function(toggle) { toggle.click(); });
    }, 500);
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
