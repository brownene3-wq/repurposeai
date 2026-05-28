// routes/_publishMomentModal.js
//
// Shared "Publish This Moment" modal — the in-place publish UI for a
// single Smart Shorts moment. Used by both the Smart Shorts page and
// the My Clips page so the modal markup and the submit logic stay in
// lock-step. submitPublish() POSTs to /shorts/api/publish-moment.
//
// Two helpers:
//   getPublishMomentModalHTML() → the modal markup. Drop it once per
//     page (just before </main>) so the IDs it references are unique.
//   getPublishMomentModalJS() → the matching JS. Drop it inside any
//     <script> tag on the page. openPublishModal(analysisId, momentIdx,
//     defaults?) opens it; defaults = { title, caption } lets a caller
//     pre-fill values when window.lastAnalysisData isn't available
//     (e.g. on /shorts/clips where the moment lives in a saved clip
//     row rather than the current analysis state).

function getPublishMomentModalHTML() {
  return `
    <!-- Phase 2b — Publish Modal. Opened from each moment card's
         "Publish to..." button. Reads /api/connections to populate the
         account picker. Post Now hits the unified
         /shorts/api/publish-moment endpoint; Schedule for Later creates
         a calendar_entries row carrying the connection_id, which the
         existing schedulePublisher cron picks up. -->
    <div id="publishModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);z-index:9999;align-items:center;justify-content:center;padding:20px;" onclick="if(event.target===this)closePublishModal()">
      <div style="background:var(--surface);border:1px solid rgba(108,58,237,0.25);border-radius:16px;width:100%;max-width:520px;padding:24px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
        <h3 style="margin:0 0 4px;font-size:1.1rem;display:flex;align-items:center;gap:8px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>
          Publish This Moment
        </h3>
        <div id="publishSubtitle" style="color:var(--text-muted);font-size:0.82rem;margin-bottom:18px;">Pick a connected account.</div>
        <input type="hidden" id="publishMomentRef">

        <label style="display:block;font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Account</label>
        <select id="publishAccount" style="width:100%;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:var(--text);font-size:0.85rem;font-family:inherit;outline:none;margin-bottom:14px;">
          <option value="">Loading your connected accounts...</option>
        </select>
        <div id="publishNoAccounts" style="display:none;background:rgba(255,180,0,0.08);border:1px solid rgba(255,180,0,0.35);color:#ffd591;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:0.8rem;line-height:1.4;">
          You don't have any social accounts connected yet.
          <a href="/distribute/connections" style="display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;text-decoration:none;padding:0.4rem 0.9rem;border-radius:6px;font-weight:600;font-size:0.78rem;margin-top:8px;">
            Connect an account <span style="font-size:0.9em;">&rarr;</span>
          </a>
        </div>

        <label style="display:block;font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Title</label>
        <input type="text" id="publishTitle" maxlength="120" style="width:100%;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:var(--text);font-size:0.85rem;font-family:inherit;outline:none;margin-bottom:14px;">

        <label style="display:block;font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Caption / Description</label>
        <textarea id="publishCaption" rows="4" style="width:100%;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:var(--text);font-size:0.85rem;font-family:inherit;outline:none;margin-bottom:14px;resize:vertical;min-height:80px;"></textarea>

        <div style="display:flex;gap:8px;margin-bottom:14px;background:var(--dark);border-radius:10px;padding:4px;border:1px solid rgba(255,255,255,0.06);">
          <button id="publishTabNow" type="button" onclick="setPublishMode('now')" style="flex:1;background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;padding:8px 12px;border-radius:6px;font-weight:600;font-size:0.82rem;cursor:pointer;">Post now</button>
          <button id="publishTabLater" type="button" onclick="setPublishMode('later')" style="flex:1;background:transparent;color:var(--text-muted);border:none;padding:8px 12px;border-radius:6px;font-weight:600;font-size:0.82rem;cursor:pointer;">Schedule for later</button>
        </div>

        <div id="publishLaterFields" style="display:none;margin-bottom:14px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
            <div>
              <label style="display:block;font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Date</label>
              <input type="date" id="publishDate" style="width:100%;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:var(--text);font-size:0.85rem;font-family:inherit;outline:none;">
            </div>
            <div>
              <label style="display:block;font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Time</label>
              <input type="time" id="publishTime" value="12:00" style="width:100%;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:var(--text);font-size:0.85rem;font-family:inherit;outline:none;">
            </div>
          </div>

          <!-- Suggest peak time for the picked account's platform -->
          <button type="button" id="publishPeakBtn" onclick="publishSuggestPeakTime()" style="display:flex;align-items:center;gap:8px;width:100%;background:linear-gradient(135deg,rgba(108,58,237,0.10),rgba(236,72,153,0.06));border:1px solid rgba(108,58,237,0.30);border-radius:8px;padding:10px 12px;color:#a78bfa;cursor:pointer;font-family:inherit;font-size:0.82rem;font-weight:600;margin-bottom:14px;transition:all .15s">
            <span style="font-size:1em;">&#x2728;</span> Suggest peak time for this platform
            <span id="publishPeakHint" style="font-weight:400;color:var(--text-muted);font-size:0.75rem;margin-left:auto;text-align:right;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
          </button>

          <!-- Notification reminder -->
          <label style="display:block;font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Notification</label>
          <select id="publishReminder" style="width:100%;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:var(--text);font-size:0.85rem;font-family:inherit;outline:none;margin-bottom:10px;" onchange="publishToggleReminderEmail()">
            <option value="0">None</option>
            <option value="15">15 minutes before</option>
            <option value="60">1 hour before</option>
            <option value="1440">1 day before</option>
            <option value="2880">2 days before</option>
          </select>
          <input type="email" id="publishReminderEmail" placeholder="Email for reminder" style="display:none;width:100%;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:var(--text);font-size:0.85rem;font-family:inherit;outline:none;margin-bottom:14px;">
          <div id="publishReminderSpacer" style="margin-bottom:14px;"></div>

          <!-- Notes -->
          <label style="display:block;font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Notes</label>
          <textarea id="publishNotes" rows="4" placeholder="Any notes for this scheduled post" style="width:100%;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:var(--text);font-size:0.85rem;font-family:inherit;outline:none;resize:vertical;min-height:80px;"></textarea>
        </div>

        <div id="publishStatus" style="display:none;background:rgba(108,58,237,0.10);border:1px solid rgba(108,58,237,0.30);color:#c4b5fd;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:0.8rem;line-height:1.4;"></div>

        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button onclick="closePublishModal()" style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:var(--text);padding:0.5rem 1rem;border-radius:8px;font-weight:600;font-size:0.85rem;cursor:pointer;">Cancel</button>
          <button id="publishSubmitBtn" onclick="submitPublish()" style="background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;padding:0.5rem 1.2rem;border-radius:8px;font-weight:600;font-size:0.85rem;cursor:pointer;">Publish</button>
        </div>
      </div>
    </div>
  `;
}

function getPublishMomentModalJS() {
  return `
    var _publishConnections = [];
    var _publishMode = 'now';
    // openPublishModal(analysisId, momentIdx, defaults?)
    //   defaults = { title, caption } — used when the page doesn't have
    //   window.lastAnalysisData (e.g. /shorts/clips, where the clip's
    //   own momentTitle / videoTitle are passed in directly).
    async function openPublishModal(analysisId, momentIdx, defaults) {
      defaults = defaults || {};
      var analysis = window.lastAnalysisData || window.currentAnalysis;
      if (analysis && (analysis.id !== analysisId && analysis._id !== analysisId)) analysis = null;
      var moment = analysis && analysis.moments ? analysis.moments[momentIdx] : null;
      var fallbackTitle = moment ? (moment.title || ('Viral moment ' + (momentIdx + 1))) : ('Viral moment ' + (momentIdx + 1));
      var fallbackCaption = moment ? (moment.description || moment.reason || '') : '';
      var defaultTitle = defaults.title || fallbackTitle;
      var defaultCaption = defaults.caption != null ? defaults.caption : fallbackCaption;

      document.getElementById('publishMomentRef').value = analysisId + '|' + momentIdx;
      document.getElementById('publishTitle').value = String(defaultTitle).slice(0, 120);
      document.getElementById('publishCaption').value = defaultCaption;
      var now = new Date(); now.setMinutes(now.getMinutes() + 60);
      document.getElementById('publishDate').value = now.toISOString().slice(0, 10);
      document.getElementById('publishTime').value = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
      setPublishMode('now');
      document.getElementById('publishStatus').style.display = 'none';
      document.getElementById('publishModal').style.display = 'flex';

      // Pull live connections.
      var sel = document.getElementById('publishAccount');
      var noAcct = document.getElementById('publishNoAccounts');
      sel.innerHTML = '<option value="">Loading...</option>';
      try {
        var resp = await fetch('/api/connections', { credentials: 'same-origin' });
        var data = await resp.json();
        _publishConnections = (data && data.accounts) || [];
        // Filter to platforms where we can actually publish video.
        var supported = ['tiktok','instagram','youtube','facebook','twitter','linkedin','pinterest'];
        _publishConnections = _publishConnections.filter(function(c){ return supported.indexOf(c.platform) !== -1; });
        if (_publishConnections.length === 0) {
          sel.style.display = 'none';
          noAcct.style.display = 'block';
        } else {
          sel.style.display = '';
          noAcct.style.display = 'none';
          sel.innerHTML = _publishConnections.map(function(c) {
            var label = (c.platform.charAt(0).toUpperCase() + c.platform.slice(1)) +
              ' \\u2014 ' + (c.accountName || c.platformUsername || c.id);
            return '<option value="' + c.id + '" data-platform="' + c.platform + '">' + label + '</option>';
          }).join('');
        }
      } catch (e) {
        sel.innerHTML = '<option value="">Failed to load accounts</option>';
      }
    }
    function closePublishModal() {
      document.getElementById('publishModal').style.display = 'none';
    }
    function setPublishMode(mode) {
      _publishMode = mode;
      var nowBtn = document.getElementById('publishTabNow');
      var laterBtn = document.getElementById('publishTabLater');
      var laterFields = document.getElementById('publishLaterFields');
      var submitBtn = document.getElementById('publishSubmitBtn');
      if (mode === 'now') {
        nowBtn.style.background = 'linear-gradient(135deg,#6C3AED,#EC4899)'; nowBtn.style.color = '#fff';
        laterBtn.style.background = 'transparent'; laterBtn.style.color = 'var(--text-muted)';
        laterFields.style.display = 'none';
        submitBtn.textContent = 'Publish now';
      } else {
        laterBtn.style.background = 'linear-gradient(135deg,#6C3AED,#EC4899)'; laterBtn.style.color = '#fff';
        nowBtn.style.background = 'transparent'; nowBtn.style.color = 'var(--text-muted)';
        laterFields.style.display = 'block';
        submitBtn.textContent = 'Schedule';
      }
    }
    async function submitPublish() {
      var btn = document.getElementById('publishSubmitBtn');
      var statusEl = document.getElementById('publishStatus');
      var connectionId = document.getElementById('publishAccount').value;
      if (!connectionId) { statusEl.style.display = 'block'; statusEl.textContent = 'Pick an account first.'; return; }
      var ref = (document.getElementById('publishMomentRef').value || '').split('|');
      var payload = {
        analysisId: ref[0] || null,
        momentIndex: ref[1] != null && ref[1] !== '' ? Number(ref[1]) : null,
        connectionId: connectionId,
        title: document.getElementById('publishTitle').value.trim(),
        caption: document.getElementById('publishCaption').value.trim(),
        description: document.getElementById('publishCaption').value.trim()
      };
      if (_publishMode === 'later') {
        var d = document.getElementById('publishDate').value;
        var t = document.getElementById('publishTime').value || '12:00';
        if (!d) { statusEl.style.display = 'block'; statusEl.textContent = 'Pick a date and time.'; return; }
        payload.scheduledAt = d + 'T' + t + ':00';
        // Extra fields merged from the legacy 'Schedule This Moment' modal
        // so both flows now collect the same scheduling metadata.
        var remVal = parseInt(document.getElementById('publishReminder').value || '0', 10) || 0;
        var remEmail = document.getElementById('publishReminderEmail').value.trim();
        if (remVal > 0 && !remEmail) {
          statusEl.style.display = 'block';
          statusEl.textContent = 'Enter an email to receive the reminder.';
          return;
        }
        payload.reminderMinutes = remVal;
        payload.reminderEmail = remVal > 0 ? remEmail : '';
        payload.notes = document.getElementById('publishNotes').value;
      }
      btn.disabled = true; var orig = btn.textContent; btn.textContent = _publishMode === 'now' ? 'Publishing\\u2026' : 'Scheduling\\u2026';
      statusEl.style.display = 'block';
      statusEl.textContent = _publishMode === 'now' ? 'Rendering clip and posting\\u2026 this can take a moment.' : 'Scheduling the post\\u2026';
      try {
        var resp = await fetch('/shorts/api/publish-moment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = await resp.json();
        if (!resp.ok || !data.success) throw new Error(data.error || 'Failed');
        if (_publishMode === 'now') {
          statusEl.textContent = 'Posted! ' + (data.platform ? '\\u2014 ' + data.platform : '');
          if (typeof showToast === 'function') showToast('Published to ' + (data.platform || 'platform'));
        } else {
          statusEl.textContent = 'Scheduled for ' + (data.scheduledFor || payload.scheduledAt);
          if (typeof showToast === 'function') showToast('Scheduled');
        }
        setTimeout(closePublishModal, 1500);
      } catch (e) {
        statusEl.textContent = 'Error: ' + e.message;
      } finally {
        btn.disabled = false; btn.textContent = orig;
      }
    }

    // Peak-time suggestion for the publishModal — reads the picked
    // account's platform from the publishAccount select's data attribute
    // and fills in publishDate/publishTime.
    async function publishSuggestPeakTime() {
      var btn = document.getElementById('publishPeakBtn');
      var hint = document.getElementById('publishPeakHint');
      var sel = document.getElementById('publishAccount');
      var opt = sel && sel.selectedOptions && sel.selectedOptions[0];
      var platform = opt ? (opt.getAttribute('data-platform') || '') : '';
      if (!platform) {
        if (typeof showToast === 'function') showToast('Pick an account first.');
        return;
      }
      var orig = hint.textContent;
      hint.textContent = 'Thinking\\u2026';
      btn.disabled = true;
      try {
        var resp = await fetch('/dashboard/calendar/api/peak-time?platform=' + encodeURIComponent(platform));
        if (!resp.ok) throw new Error('Failed');
        var d = await resp.json();
        if (d.date) document.getElementById('publishDate').value = d.date;
        if (d.time) document.getElementById('publishTime').value = d.time;
        hint.textContent = d.date && d.time ? (d.date + ' \\u00b7 ' + d.time) : '';
        if (typeof showToast === 'function') showToast(d.reasoning || ('Peak time set: ' + d.date + ' ' + d.time));
      } catch (e) {
        hint.textContent = orig;
        if (typeof showToast === 'function') showToast('Peak time unavailable');
      } finally {
        btn.disabled = false;
      }
    }

    // Show/hide the reminder-email input depending on whether a non-zero
    // reminder window is picked.
    function publishToggleReminderEmail() {
      var v = parseInt(document.getElementById('publishReminder').value || '0', 10);
      var email = document.getElementById('publishReminderEmail');
      var spacer = document.getElementById('publishReminderSpacer');
      if (v > 0) {
        email.style.display = 'block';
        if (spacer) spacer.style.display = 'none';
      } else {
        email.style.display = 'none';
        email.value = '';
        if (spacer) spacer.style.display = 'block';
      }
    }
  `;
}

module.exports = { getPublishMomentModalHTML, getPublishMomentModalJS };
