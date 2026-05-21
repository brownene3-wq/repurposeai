// public/js/splicora-publish.js
//
// Phase 2f — Shared Publish modal helper, reused by every Splicora
// feature whose output card / result panel needs a "Publish to..." button.
// One IIFE exposing window.Splicora.openPublish(opts).
//
// opts:
//   endpoint     (required) — POST URL on the server that performs the
//                             actual publish. Receives:
//                             { connectionId, title, caption, description,
//                               scheduledAt?, ...passthrough }
//   passthrough  (optional) — any extra fields to merge into the POST body
//                             (e.g. { filename, hookId, momentIndex })
//   title        (optional) — pre-fill for the title field
//   caption      (optional) — pre-fill for the caption / description
//   subtitle     (optional) — small text under the modal heading
//   platforms    (optional) — array of allowed platforms; defaults to all
//                             video-capable plus text-capable platforms
//
// The modal is created once and reused across opens.

(function(){
  if (window.Splicora && window.Splicora.openPublish) return; // idempotent

  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function(k){ e.setAttribute(k, attrs[k]); });
    if (html != null) e.innerHTML = html;
    return e;
  }

  var modal = null;
  var state = { mode: 'now', opts: null };

  function ensureModal(){
    if (modal) return modal;
    modal = el('div', { id: 'splicoraPublishModal', style: 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);z-index:99999;align-items:center;justify-content:center;padding:20px;' });
    modal.addEventListener('click', function(e){ if (e.target === modal) close(); });
    modal.innerHTML =
      '<div style="background:#16112a;border:1px solid rgba(108,58,237,0.30);border-radius:16px;width:100%;max-width:520px;padding:24px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.5);color:#e2e0f0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif">' +
      '  <h3 id="spPubTitle" style="margin:0 0 4px;font-size:1.1rem;display:flex;align-items:center;gap:8px;">✈️ Publish</h3>' +
      '  <div id="spPubSub" style="color:#8e87b0;font-size:0.82rem;margin-bottom:18px;">Pick a connected account.</div>' +
      '  <label style="display:block;font-size:0.72rem;color:#8e87b0;margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Account</label>' +
      '  <select id="spPubAccount" style="width:100%;background:#0f0a1f;border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:10px 12px;color:#e2e0f0;font-size:0.85rem;font-family:inherit;outline:none;margin-bottom:14px;"><option value="">Loading…</option></select>' +
      '  <div id="spPubNoAcct" style="display:none;background:rgba(255,180,0,0.08);border:1px solid rgba(255,180,0,0.35);color:#ffd591;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:0.8rem;line-height:1.4;">No connected accounts. <a href="/distribute/connections" target="_blank" style="background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;text-decoration:none;padding:0.4rem 0.9rem;border-radius:6px;font-weight:600;font-size:0.78rem;display:inline-block;margin-top:6px">Connect →</a></div>' +
      '  <label style="display:block;font-size:0.72rem;color:#8e87b0;margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Title</label>' +
      '  <input type="text" id="spPubTitleField" maxlength="120" style="width:100%;background:#0f0a1f;border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:10px 12px;color:#e2e0f0;font-size:0.85rem;font-family:inherit;outline:none;margin-bottom:14px;">' +
      '  <label style="display:block;font-size:0.72rem;color:#8e87b0;margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Caption / Description</label>' +
      '  <textarea id="spPubCaption" rows="4" style="width:100%;background:#0f0a1f;border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:10px 12px;color:#e2e0f0;font-size:0.85rem;font-family:inherit;outline:none;margin-bottom:14px;resize:vertical;min-height:80px;"></textarea>' +
      '  <div style="display:flex;gap:8px;margin-bottom:14px;background:#0f0a1f;border-radius:10px;padding:4px;border:1px solid rgba(255,255,255,0.06);">' +
      '    <button id="spPubTabNow" type="button" style="flex:1;background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;padding:8px 12px;border-radius:6px;font-weight:600;font-size:0.82rem;cursor:pointer;">Post now</button>' +
      '    <button id="spPubTabLater" type="button" style="flex:1;background:transparent;color:#8e87b0;border:none;padding:8px 12px;border-radius:6px;font-weight:600;font-size:0.82rem;cursor:pointer;">Schedule for later</button>' +
      '  </div>' +
      '  <div id="spPubLater" style="display:none;margin-bottom:14px;">' +
      '    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
      '      <div><label style="display:block;font-size:0.72rem;color:#8e87b0;margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Date</label><input type="date" id="spPubDate" style="width:100%;background:#0f0a1f;border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:10px 12px;color:#e2e0f0;font-size:0.85rem;outline:none;"></div>' +
      '      <div><label style="display:block;font-size:0.72rem;color:#8e87b0;margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Time</label><input type="time" id="spPubTime" value="12:00" style="width:100%;background:#0f0a1f;border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:10px 12px;color:#e2e0f0;font-size:0.85rem;outline:none;"></div>' +
      '    </div>' +
      '  </div>' +
      '  <div id="spPubStatus" style="display:none;background:rgba(108,58,237,0.10);border:1px solid rgba(108,58,237,0.30);color:#c4b5fd;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:0.8rem;line-height:1.4;"></div>' +
      '  <div style="display:flex;justify-content:flex-end;gap:8px;"><button id="spPubCancel" style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:#e2e0f0;padding:0.5rem 1rem;border-radius:8px;font-weight:600;font-size:0.85rem;cursor:pointer;">Cancel</button><button id="spPubSubmit" style="background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;padding:0.5rem 1.2rem;border-radius:8px;font-weight:600;font-size:0.85rem;cursor:pointer;">Publish</button></div>' +
      '</div>';
    document.body.appendChild(modal);

    document.getElementById('spPubCancel').addEventListener('click', close);
    document.getElementById('spPubTabNow').addEventListener('click', function(){ setMode('now'); });
    document.getElementById('spPubTabLater').addEventListener('click', function(){ setMode('later'); });
    document.getElementById('spPubSubmit').addEventListener('click', submit);
    return modal;
  }

  function setMode(mode){
    state.mode = mode;
    var now = document.getElementById('spPubTabNow');
    var later = document.getElementById('spPubTabLater');
    var laterFields = document.getElementById('spPubLater');
    var submit = document.getElementById('spPubSubmit');
    if (mode === 'now') {
      now.style.background = 'linear-gradient(135deg,#6C3AED,#EC4899)'; now.style.color = '#fff';
      later.style.background = 'transparent'; later.style.color = '#8e87b0';
      laterFields.style.display = 'none';
      submit.textContent = 'Publish now';
    } else {
      later.style.background = 'linear-gradient(135deg,#6C3AED,#EC4899)'; later.style.color = '#fff';
      now.style.background = 'transparent'; now.style.color = '#8e87b0';
      laterFields.style.display = 'block';
      submit.textContent = 'Schedule';
    }
  }

  function close(){ if (modal) modal.style.display = 'none'; }

  async function open(opts){
    ensureModal();
    state.opts = opts || {};
    document.getElementById('spPubTitleField').value = (opts.title || '').slice(0, 120);
    document.getElementById('spPubCaption').value = opts.caption || '';
    document.getElementById('spPubSub').textContent = opts.subtitle || 'Pick a connected account.';
    document.getElementById('spPubStatus').style.display = 'none';
    var d = new Date(); d.setMinutes(d.getMinutes() + 60);
    document.getElementById('spPubDate').value = d.toISOString().slice(0, 10);
    document.getElementById('spPubTime').value = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    setMode('now');
    modal.style.display = 'flex';

    // Load accounts and filter to opts.platforms if provided, else default
    // to the union of video + text capable platforms.
    var defaultSupported = ['tiktok','instagram','youtube','facebook','twitter','linkedin','pinterest'];
    var allowed = Array.isArray(opts.platforms) && opts.platforms.length ? opts.platforms : defaultSupported;
    var sel = document.getElementById('spPubAccount');
    var noAcct = document.getElementById('spPubNoAcct');
    sel.innerHTML = '<option value="">Loading…</option>';
    try {
      var r = await fetch('/api/connections', { credentials: 'same-origin' });
      var j = await r.json();
      var accounts = ((j && j.accounts) || []).filter(function(c){ return allowed.indexOf(c.platform) !== -1; });
      if (accounts.length === 0) {
        sel.style.display = 'none';
        noAcct.style.display = 'block';
      } else {
        sel.style.display = '';
        noAcct.style.display = 'none';
        sel.innerHTML = accounts.map(function(c){
          return '<option value="' + c.id + '">' + (c.platform.charAt(0).toUpperCase()+c.platform.slice(1)) + ' — ' + (c.accountName || c.platformUsername || c.id) + '</option>';
        }).join('');
      }
    } catch(e){
      sel.innerHTML = '<option value="">Failed to load accounts</option>';
    }
  }

  async function submit(){
    var opts = state.opts || {};
    var btn = document.getElementById('spPubSubmit');
    var statusEl = document.getElementById('spPubStatus');
    var connectionId = document.getElementById('spPubAccount').value;
    if (!connectionId) { statusEl.style.display = 'block'; statusEl.textContent = 'Pick an account first.'; return; }
    var payload = Object.assign({}, opts.passthrough || {}, {
      connectionId: connectionId,
      title: document.getElementById('spPubTitleField').value.trim(),
      caption: document.getElementById('spPubCaption').value.trim(),
      description: document.getElementById('spPubCaption').value.trim()
    });
    if (state.mode === 'later') {
      var d = document.getElementById('spPubDate').value;
      var t = document.getElementById('spPubTime').value || '12:00';
      if (!d) { statusEl.style.display = 'block'; statusEl.textContent = 'Pick a date and time.'; return; }
      payload.scheduledAt = d + 'T' + t + ':00';
    }
    btn.disabled = true; var orig = btn.textContent;
    btn.textContent = state.mode === 'now' ? 'Publishing…' : 'Scheduling…';
    statusEl.style.display = 'block';
    statusEl.textContent = state.mode === 'now' ? 'Uploading to platform…' : 'Saving the scheduled post…';
    try {
      var resp = await fetch(opts.endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var data = await resp.json();
      if (!resp.ok || !data.success) throw new Error(data.error || 'Failed');
      statusEl.textContent = state.mode === 'now'
        ? ('Posted to ' + (data.platform || 'platform'))
        : ('Scheduled for ' + (data.scheduledFor || payload.scheduledAt));
      if (typeof opts.onSuccess === 'function') { try { opts.onSuccess(data); } catch(_) {} }
      setTimeout(close, 1500);
    } catch(e){
      statusEl.textContent = 'Error: ' + e.message;
    } finally {
      btn.disabled = false; btn.textContent = orig;
    }
  }

  window.Splicora = window.Splicora || {};
  window.Splicora.openPublish = open;
  window.Splicora.closePublish = close;
})();
