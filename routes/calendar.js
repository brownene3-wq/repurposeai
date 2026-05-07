const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { calendarOps, outputOps } = require('../db/database');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');

router.get('/', requireAuth, (req, res) => {
  res.send(`${getHeadHTML('Calendar')}
  <style>
    ${getBaseCSS()}
    .calendar-page{padding:32px}
    .cal-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;gap:16px;flex-wrap:wrap}
    .cal-header h1{font-size:1.8rem;font-weight:800;margin:0;background:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
    .cal-header p{color:var(--text-muted);font-size:.9rem;margin:.4rem 0 0}
    .cal-nav{display:flex;align-items:center;gap:10px}
    .cal-nav button{background:var(--surface);border:1px solid rgba(255,255,255,0.08);color:var(--text);width:36px;height:36px;border-radius:8px;cursor:pointer;font-size:14px}
    .cal-nav button:hover{border-color:#6C3AED;color:#a78bfa}
    .cal-nav .month-label{font-weight:700;font-size:1.1rem;min-width:200px;text-align:center}
    .cal-actions{display:flex;gap:10px}
    .add-entry-btn{background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;padding:.55rem 1rem;border-radius:8px;font-weight:600;font-size:.85rem;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
    .add-entry-btn:hover{transform:translateY(-1px);box-shadow:0 6px 24px rgba(108,58,237,0.35)}
    .cal-grid-wrap{background:var(--surface);border:1px solid rgba(255,255,255,0.06);border-radius:14px;overflow:hidden}
    body.light .cal-grid-wrap,html.light .cal-grid-wrap{border-color:rgba(0,0,0,0.06)}
    .cal-legend{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px;padding:14px 16px;background:var(--surface);border:1px solid rgba(255,255,255,0.06);border-radius:12px}
    body.light .cal-legend,html.light .cal-legend{border-color:rgba(0,0,0,0.06)}
    .cal-legend-label{font-size:.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;font-weight:700;align-self:center;margin-right:4px}
    .legend-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;font-size:.75rem;font-weight:600;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);transition:opacity .15s,transform .15s,background .15s,border-color .15s;color:var(--text);cursor:pointer;user-select:none}
    .legend-chip:hover{background:rgba(255,255,255,0.08);border-color:rgba(108,58,237,0.30)}
    body.light .legend-chip,html.light .legend-chip{background:rgba(0,0,0,0.03);border-color:rgba(0,0,0,0.06)}
    body.light .legend-chip:hover,html.light .legend-chip:hover{background:rgba(0,0,0,0.05);border-color:rgba(108,58,237,0.30)}
    .legend-chip .legend-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;box-shadow:0 0 0 2px rgba(255,255,255,0.05)}
    .legend-chip .legend-emoji{font-size:.85rem}
    .legend-chip .legend-count{margin-left:4px;font-size:.7rem;font-weight:700;padding:1px 7px;border-radius:999px;background:rgba(255,255,255,0.08);color:var(--text)}
    body.light .legend-chip .legend-count,html.light .legend-chip .legend-count{background:rgba(0,0,0,0.06)}
    .legend-chip.empty{opacity:0.45}
    .legend-chip.empty .legend-count{background:transparent;color:var(--text-dim)}
    .legend-chip.active{background:linear-gradient(135deg,rgba(108,58,237,0.25),rgba(236,72,153,0.18));border-color:#6C3AED;box-shadow:0 0 0 1px rgba(108,58,237,0.40),0 4px 14px rgba(108,58,237,0.18);color:#fff;opacity:1}
    .legend-chip.active .legend-count{background:rgba(108,58,237,0.35);color:#fff}
    .legend-chip.dimmed{opacity:0.30}
    .legend-clear{margin-left:auto;font-size:.72rem;font-weight:600;color:#a78bfa;cursor:pointer;padding:5px 10px;border-radius:999px;background:transparent;border:none;transition:background .15s}
    .legend-clear:hover{background:rgba(108,58,237,0.10)}
    .legend-clear[hidden]{display:none}
    .cal-day-headers{display:grid;grid-template-columns:repeat(7,1fr);background:rgba(255,255,255,0.03);border-bottom:1px solid rgba(255,255,255,0.06)}
    body.light .cal-day-headers,html.light .cal-day-headers{background:rgba(0,0,0,0.02);border-bottom-color:rgba(0,0,0,0.06)}
    .cal-day-header{padding:10px;text-align:center;font-size:11px;color:var(--text-muted);font-weight:600;letter-spacing:.04em;text-transform:uppercase}
    .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:rgba(255,255,255,0.04)}
    body.light .cal-grid,html.light .cal-grid{background:rgba(0,0,0,0.05)}
    .cal-cell{background:var(--dark-2);min-height:110px;padding:8px;cursor:pointer;transition:background .15s;display:flex;flex-direction:column;gap:4px}
    .cal-cell:hover{background:rgba(108,58,237,0.06)}
    .cal-cell.empty{background:rgba(255,255,255,0.02);cursor:default}
    body.light .cal-cell.empty,html.light .cal-cell.empty{background:rgba(0,0,0,0.02)}
    .cal-cell.today{background:rgba(108,58,237,0.10);border-top:2px solid #6C3AED;padding-top:6px}
    .cal-cell-date{font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:2px}
    .cal-cell.today .cal-cell-date{color:#a78bfa}
    .cal-entry{font-size:11px;padding:3px 6px;border-radius:5px;color:#fff;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;display:flex;align-items:center;gap:4px}
    .cal-entry:hover{filter:brightness(1.15)}
    .cal-cell-overflow{font-size:10px;color:var(--text-muted);font-weight:600;margin-top:2px}
    .cal-modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);z-index:1000;align-items:center;justify-content:center;padding:20px}
    .cal-modal-overlay.show{display:flex}
    .cal-modal{background:var(--surface);border:1px solid rgba(255,255,255,0.08);border-radius:16px;width:100%;max-width:520px;padding:24px;max-height:90vh;overflow-y:auto}
    body.light .cal-modal,html.light .cal-modal{border-color:rgba(0,0,0,0.08)}
    .cal-modal h3{margin:0 0 4px;font-size:1.1rem}
    .cal-modal .modal-sub{color:var(--text-muted);font-size:.82rem;margin-bottom:20px}
    .cal-modal label{display:block;font-size:.75rem;color:var(--text-muted);margin-bottom:6px;font-weight:600;letter-spacing:.03em}
    .cal-modal input,.cal-modal select,.cal-modal textarea{width:100%;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:var(--text);font-size:.85rem;font-family:inherit;outline:none;margin-bottom:14px}
    body.light .cal-modal input,body.light .cal-modal select,body.light .cal-modal textarea,html.light .cal-modal input,html.light .cal-modal select,html.light .cal-modal textarea{background:var(--dark-2);border-color:rgba(0,0,0,0.1)}
    .cal-modal input:focus,.cal-modal select:focus,.cal-modal textarea:focus{border-color:#6C3AED}
    .cal-modal textarea{resize:vertical;min-height:70px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.10) transparent}
    .cal-modal textarea::-webkit-scrollbar{width:6px}
    .cal-modal textarea::-webkit-scrollbar-track{background:transparent}
    .cal-modal textarea::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:3px}
    .cal-modal textarea::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.16)}
    body.light .cal-modal textarea,html.light .cal-modal textarea{scrollbar-color:rgba(0,0,0,0.15) transparent}
    body.light .cal-modal textarea::-webkit-scrollbar-thumb,html.light .cal-modal textarea::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.15)}
    .cal-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .cal-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px;flex-wrap:wrap}
    .btn-secondary{background:transparent;border:1px solid rgba(255,255,255,0.15);color:var(--text);padding:.5rem 1rem;border-radius:8px;font-weight:600;font-size:.85rem;cursor:pointer}
    .btn-secondary:hover{border-color:#6C3AED;color:#a78bfa}
    .btn-danger{background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.4);color:#ef4444;padding:.5rem 1rem;border-radius:8px;font-weight:600;font-size:.85rem;cursor:pointer;margin-right:auto}
    .btn-danger:hover{background:rgba(239,68,68,0.18)}
    .btn-save{background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;border:none;padding:.5rem 1.2rem;border-radius:8px;font-weight:600;font-size:.85rem;cursor:pointer}
    .btn-save:hover{transform:translateY(-1px)}
    .cal-toast{position:fixed;bottom:24px;right:24px;background:var(--surface);border:1px solid rgba(108,58,237,0.4);color:var(--text);padding:12px 18px;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.4);font-size:.85rem;z-index:9999;display:none}
    .cal-toast.show{display:block}
  </style>
  </head>
  <body>
    <div class="dashboard">
      ${getSidebar('calendar', req.user, req.teamPermissions)}
      ${getThemeToggle()}
      <main class="main-content">
        <div class="calendar-page">
          <div class="cal-header">
            <div>
              <h1>📅 Content Calendar</h1>
              <p>Plan your posts across platforms — click any day to schedule.</p>
            </div>
            <div class="cal-nav">
              <button onclick="changeMonth(-1)" title="Previous month">‹</button>
              <div class="month-label" id="monthLabel">—</div>
              <button onclick="changeMonth(1)" title="Next month">›</button>
              <button onclick="goToToday()" title="Today" style="width:auto;padding:0 12px;font-weight:600">Today</button>
            </div>
            <div class="cal-actions">
              <button class="add-entry-btn" onclick="openCreate()">+ Add Entry</button>
            </div>
          </div>
          <div class="cal-legend" id="calLegend" aria-label="Platforms scheduled this month"></div>
          <div class="cal-grid-wrap">
            <div class="cal-day-headers">
              <div class="cal-day-header">Sun</div>
              <div class="cal-day-header">Mon</div>
              <div class="cal-day-header">Tue</div>
              <div class="cal-day-header">Wed</div>
              <div class="cal-day-header">Thu</div>
              <div class="cal-day-header">Fri</div>
              <div class="cal-day-header">Sat</div>
            </div>
            <div class="cal-grid" id="calGrid"></div>
          </div>
        </div>
      </main>
    </div>
    <div class="cal-modal-overlay" id="entryModal" onclick="if(event.target===this)closeModal()">
      <div class="cal-modal">
        <h3 id="modalTitle">New Entry</h3>
        <div class="modal-sub" id="modalDate">—</div>
        <input type="hidden" id="entryId">
        <label>Title</label>
        <input type="text" id="entryTitleInput" placeholder="e.g. Launch announcement" maxlength="120">
        <div class="cal-row">
          <div>
            <label>Platform</label>
            <select id="entryPlatform">
              <option value="tiktok">TikTok</option>
              <option value="instagram">Instagram</option>
              <option value="shorts">YouTube Shorts</option>
              <option value="youtube">YouTube</option>
              <option value="twitter">Twitter / X</option>
              <option value="linkedin">LinkedIn</option>
              <option value="facebook">Facebook</option>
              <option value="blog">Blog Post</option>
              <option value="newsletter">Newsletter</option>
            </select>
          </div>
          <div>
            <label>Status</label>
            <select id="entryStatus">
              <option value="planned">Planned</option>
              <option value="drafted">Drafted</option>
              <option value="ready">Ready</option>
              <option value="published">Published</option>
            </select>
          </div>
        </div>
        <div class="cal-row">
          <div>
            <label>Date</label>
            <input type="date" id="entryDate">
          </div>
          <div>
            <label>Time</label>
            <input type="time" id="entryTime">
          </div>
        </div>
        <button type="button" id="peakTimeBtn" onclick="suggestPeakTime()" style="display:flex;align-items:center;gap:8px;width:100%;background:linear-gradient(135deg,rgba(108,58,237,0.10),rgba(236,72,153,0.06));border:1px solid rgba(108,58,237,0.30);border-radius:8px;padding:10px 12px;color:#a78bfa;cursor:pointer;font-family:inherit;font-size:0.82rem;font-weight:600;margin-bottom:14px;transition:all .15s">
          <span style="font-size:1em;">✨</span> Suggest peak time for this platform
          <span id="peakTimeHint" style="font-weight:400;color:var(--text-muted);font-size:0.75rem;margin-left:auto;text-align:right;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
        </button>
        <label>Notification</label>
        <select id="entryReminder">
          <option value="0">None</option>
          <option value="15">15 minutes before</option>
          <option value="60">1 hour before</option>
          <option value="1440">1 day before</option>
          <option value="2880">2 days before</option>
        </select>
        <label>Notes</label>
        <textarea id="entryNotes" placeholder="Hook ideas, hashtags, links..."></textarea>
        <div id="clipDlBlock" style="display:none;background:rgba(108,58,237,0.08);border:1px solid rgba(108,58,237,0.25);border-radius:10px;padding:10px 12px;margin-bottom:12px;display:none;">
          <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:6px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;">From Smart Shorts</div>
          <a id="clipDlLink" href="#" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;color:#a78bfa;text-decoration:none;font-weight:600;font-size:.85rem;">
            <span style="font-size:1.1em;">▶</span> Show Clip
          </a>
          <div style="font-size:.7rem;color:var(--text-dim);margin-top:4px;">Opens Smart Shorts to this clip so you can preview and download it.</div>
        </div>
        <div class="cal-modal-actions">
          <button class="btn-danger" id="deleteBtn" onclick="deleteEntry()" style="display:none">Delete</button>
          <button class="btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn-save" id="saveBtn" onclick="saveEntry()">Save</button>
        </div>
      </div>
    </div>
    <div class="cal-toast" id="toast"></div>
    <script>
      ${getThemeScript()}
      const PLATFORM_META = {
        tiktok:{color:'#25F4EE',emoji:'🎵',label:'TikTok'},
        instagram:{color:'#E4405F',emoji:'📷',label:'Instagram'},
        shorts:{color:'#FF0000',emoji:'▶️',label:'YT Shorts'},
        youtube:{color:'#FF0000',emoji:'📺',label:'YouTube'},
        twitter:{color:'#1DA1F2',emoji:'🐦',label:'Twitter'},
        linkedin:{color:'#0077B5',emoji:'💼',label:'LinkedIn'},
        facebook:{color:'#1877F2',emoji:'👥',label:'Facebook'},
        blog:{color:'#10B981',emoji:'✏️',label:'Blog'},
        newsletter:{color:'#F59E0B',emoji:'✉️',label:'Newsletter'}
      };
      let calMonth=new Date().getMonth();
      let calYear=new Date().getFullYear();
      let entries=[];
      // Active platform filter — Set of platform keys. Empty = no filter (show all).
      let activeFilters = new Set();
      function ymd(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
      function rangeForMonth(){
        return {start:ymd(new Date(calYear,calMonth,1)),end:ymd(new Date(calYear,calMonth+1,0))};
      }
      async function loadEntries(){
        const r=rangeForMonth();
        try {
          const resp=await fetch('/dashboard/calendar/api/entries?start='+r.start+'&end='+r.end);
          const data=await resp.json();
          entries=Array.isArray(data.entries)?data.entries:[];
        } catch(e){entries=[];}
        renderGrid();
      }
      async function suggestPeakTime(){
        var btn = document.getElementById('peakTimeBtn');
        var hint = document.getElementById('peakTimeHint');
        var platform = document.getElementById('entryPlatform').value;
        var orig = hint.textContent;
        hint.textContent = 'Thinking…';
        btn.disabled = true;
        try {
          var resp = await fetch('/dashboard/calendar/api/peak-time?platform=' + encodeURIComponent(platform));
          if (!resp.ok) throw new Error('Failed');
          var d = await resp.json();
          if (d.date) document.getElementById('entryDate').value = d.date;
          if (d.time) document.getElementById('entryTime').value = d.time;
          hint.textContent = d.reasoning ? (d.date + ' · ' + d.time) : '';
          showToast(d.reasoning || ('Peak time set: ' + d.date + ' ' + d.time));
        } catch (e) {
          hint.textContent = orig;
          showToast('Peak time unavailable');
        } finally {
          btn.disabled = false;
        }
      }
      function changeMonth(delta){
        calMonth+=delta;
        if(calMonth>11){calMonth=0;calYear++;}
        if(calMonth<0){calMonth=11;calYear--;}
        loadEntries();
      }
      function goToToday(){
        const t=new Date();
        calMonth=t.getMonth();calYear=t.getFullYear();
        loadEntries();
      }
      function renderLegend(byDate){
        const counts={};
        Object.keys(PLATFORM_META).forEach(k=>counts[k]=0);
        for(const dateKey in byDate){
          for(const e of byDate[dateKey]){
            if(counts.hasOwnProperty(e.platform))counts[e.platform]++;
          }
        }
        const order=['tiktok','instagram','shorts','youtube','twitter','linkedin','facebook','blog','newsletter'];
        const filterActive = activeFilters.size > 0;
        let html='<span class="cal-legend-label">Platforms</span>';
        for(const k of order){
          const m=PLATFORM_META[k];
          const c=counts[k]||0;
          const empty=c===0?' empty':'';
          const isOn = activeFilters.has(k);
          const klass = 'legend-chip' + empty + (isOn ? ' active' : '') + (filterActive && !isOn ? ' dimmed' : '');
          const titleAttr=isOn?('Filtering by ' + m.label + ' — click to clear'):(c===0?('Click to filter by ' + m.label):('Click to filter by ' + m.label + ' (' + c + ' scheduled)'));
          html+='<span class="'+klass+'" data-platform="'+k+'" onclick="togglePlatformFilter(\\''+k+'\\')" title="'+titleAttr+'">';
          html+='<span class="legend-dot" style="background:'+m.color+'"></span>';
          html+='<span class="legend-emoji">'+m.emoji+'</span>';
          html+=m.label;
          html+='<span class="legend-count">'+c+'</span>';
          html+='</span>';
        }
        html += '<button class="legend-clear" onclick="clearPlatformFilters()"' + (filterActive ? '' : ' hidden') + '>Clear filters</button>';
        document.getElementById('calLegend').innerHTML=html;
      }
      function togglePlatformFilter(platform){
        if (activeFilters.has(platform)) activeFilters.delete(platform);
        else activeFilters.add(platform);
        renderGrid();
      }
      function clearPlatformFilters(){
        activeFilters.clear();
        renderGrid();
      }

      function renderGrid(){
        const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
        document.getElementById('monthLabel').textContent=months[calMonth]+' '+calYear;
        const firstDay=new Date(calYear,calMonth,1).getDay();
        const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
        const todayStr=ymd(new Date());
        const byDate={};
        const allByDate={};
        for(const e of entries){
          const k=e.scheduled_date?String(e.scheduled_date).slice(0,10):null;
          if(!k)continue;
          (allByDate[k]=allByDate[k]||[]).push(e);
          // Filter: if filters are active, only include matching platforms
          if(activeFilters.size > 0 && !activeFilters.has(e.platform)) continue;
          (byDate[k]=byDate[k]||[]).push(e);
        }
        let html='';
        for(let i=0;i<firstDay;i++)html+='<div class="cal-cell empty"></div>';
        for(let d=1;d<=daysInMonth;d++){
          const dateStr=calYear+'-'+String(calMonth+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
          const dayEntries=byDate[dateStr]||[];
          const isToday=dateStr===todayStr;
          html+='<div class="cal-cell'+(isToday?' today':'')+'" onclick="onCellClick(\\''+dateStr+'\\',event)">';
          html+='<div class="cal-cell-date">'+d+'</div>';
          dayEntries.slice(0,3).forEach(e=>{
            const meta=PLATFORM_META[e.platform]||{color:e.color||'#6c5ce7',emoji:'•',label:e.platform};
            const titleEsc=String(e.title||'Untitled').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
            html+='<div class="cal-entry" style="background:'+meta.color+'" onclick="event.stopPropagation();editEntry(\\''+e.id+'\\')" title="'+titleEsc+'">';
            html+='<span>'+meta.emoji+'</span>'+titleEsc;
            html+='</div>';
          });
          if(dayEntries.length>3)html+='<div class="cal-cell-overflow">+'+(dayEntries.length-3)+' more</div>';
          html+='</div>';
        }
        document.getElementById('calGrid').innerHTML=html;
        renderLegend(allByDate);
      }
      function onCellClick(dateStr){openCreate(dateStr);}
      function openCreate(dateStr){
        if(!dateStr)dateStr=ymd(new Date());
        document.getElementById('modalTitle').textContent='New Entry';
        document.getElementById('modalDate').textContent=formatDateLabel(dateStr);
        document.getElementById('entryId').value='';
        document.getElementById('entryTitleInput').value='';
        document.getElementById('entryPlatform').value='tiktok';
        document.getElementById('entryStatus').value='planned';
        document.getElementById('entryDate').value=dateStr;
        document.getElementById('entryTime').value='12:00';
        document.getElementById('entryNotes').value='';
        document.getElementById('entryReminder').value='0';
        var dl=document.getElementById('clipDlBlock'); if(dl) dl.style.display='none';
        document.getElementById('deleteBtn').style.display='none';
        document.getElementById('saveBtn').textContent='Save';
        document.getElementById('entryModal').classList.add('show');
        document.getElementById('entryTitleInput').focus();
      }
      function editEntry(id){
        const e=entries.find(x=>String(x.id)===String(id));
        if(!e)return;
        document.getElementById('modalTitle').textContent='Edit Entry';
        document.getElementById('modalDate').textContent=formatDateLabel(String(e.scheduled_date).slice(0,10));
        document.getElementById('entryId').value=e.id;
        document.getElementById('entryTitleInput').value=e.title||'';
        document.getElementById('entryPlatform').value=e.platform||'tiktok';
        document.getElementById('entryStatus').value=e.status||'planned';
        document.getElementById('entryDate').value=String(e.scheduled_date).slice(0,10);
        document.getElementById('entryTime').value=(e.scheduled_time||'12:00').slice(0,5);
        document.getElementById('entryNotes').value=e.notes||'';
        document.getElementById('entryReminder').value=String(e.reminder_minutes||0);
        // Show clip link when this entry came from a Smart Shorts moment
        var dl = document.getElementById('clipDlBlock');
        if(e.analysis_id && (e.moment_index !== null && e.moment_index !== undefined)){
          dl.style.display='block';
          var url='/shorts?dlAnalysis='+encodeURIComponent(e.analysis_id)+'&dlMoment='+encodeURIComponent(e.moment_index);
          document.getElementById('clipDlLink').href=url;
        } else {
          dl.style.display='none';
        }
        document.getElementById('deleteBtn').style.display='inline-block';
        document.getElementById('saveBtn').textContent='Update';
        document.getElementById('entryModal').classList.add('show');
      }
      function closeModal(){document.getElementById('entryModal').classList.remove('show');}
      function formatDateLabel(s){
        const [y,m,d]=s.split('-').map(Number);
        return new Date(y,m-1,d).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});
      }
      async function saveEntry(){
        const id=document.getElementById('entryId').value;
        const payload={
          title:document.getElementById('entryTitleInput').value.trim(),
          platform:document.getElementById('entryPlatform').value,
          status:document.getElementById('entryStatus').value,
          scheduledDate:document.getElementById('entryDate').value,
          scheduledTime:document.getElementById('entryTime').value||'12:00',
          notes:document.getElementById('entryNotes').value,
          reminderMinutes:parseInt(document.getElementById('entryReminder').value||'0',10)||0
        };
        if(!payload.title){showToast('Title is required');return;}
        if(!payload.scheduledDate){showToast('Date is required');return;}
        try {
          const resp=await fetch('/dashboard/calendar/api/entries'+(id?'/'+id:''),{
            method:id?'PUT':'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(payload)
          });
          if(!resp.ok){const err=await resp.json().catch(()=>({}));throw new Error(err.error||'Save failed');}
          closeModal();
          showToast(id?'Entry updated':'Entry created');
          await loadEntries();
        } catch(e){showToast(e.message);}
      }
      async function deleteEntry(){
        const id=document.getElementById('entryId').value;
        if(!id)return;
        if(!confirm('Delete this entry?'))return;
        try {
          const resp=await fetch('/dashboard/calendar/api/entries/'+id,{method:'DELETE'});
          if(!resp.ok)throw new Error('Delete failed');
          closeModal();
          showToast('Entry deleted');
          await loadEntries();
        } catch(e){showToast(e.message);}
      }
      function showToast(msg){
        const t=document.getElementById('toast');
        t.textContent=msg;t.classList.add('show');
        setTimeout(()=>t.classList.remove('show'),2200);
      }
      document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
      loadEntries();
    </script>
  </body>
</html>`);
});

router.get('/api/entries', requireAuth, async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'start and end required (YYYY-MM-DD)' });
    const entries = await calendarOps.getByUserId(req.user.id, start, end);
    res.json({ entries });
  } catch (error) {
    console.error('Calendar list error:', error);
    res.status(500).json({ error: 'Failed to load entries' });
  }
});

router.post('/api/entries', requireAuth, async (req, res) => {
  try {
    const entry = await calendarOps.create({
      userId: req.user.id,
      title: req.body.title,
      platform: req.body.platform,
      scheduledDate: req.body.scheduledDate,
      scheduledTime: req.body.scheduledTime,
      status: req.body.status,
      contentText: req.body.contentText || '',
      notes: req.body.notes || '',
      color: req.body.color,
      analysisId: req.body.analysisId || null,
      momentIndex: req.body.momentIndex != null ? req.body.momentIndex : null,
      reminderMinutes: parseInt(req.body.reminderMinutes, 10) || 0
    });
    res.json({ entry });
  } catch (error) {
    console.error('Calendar create error:', error);
    res.status(500).json({ error: 'Failed to create entry' });
  }
});

router.put('/api/entries/:id', requireAuth, async (req, res) => {
  try {
    const entry = await calendarOps.update(req.params.id, req.user.id, {
      title: req.body.title,
      platform: req.body.platform,
      scheduledDate: req.body.scheduledDate,
      scheduledTime: req.body.scheduledTime,
      status: req.body.status,
      contentText: req.body.contentText,
      notes: req.body.notes,
      color: req.body.color,
      reminderMinutes: parseInt(req.body.reminderMinutes, 10) || 0
    });
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    res.json({ entry });
  } catch (error) {
    console.error('Calendar update error:', error);
    res.status(500).json({ error: 'Failed to update entry' });
  }
});

router.delete('/api/entries/:id', requireAuth, async (req, res) => {
  try {
    await calendarOps.delete(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Calendar delete error:', error);
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

router.get('/api/data', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const outputs = await outputOps.getByUserId(userId, 500, 0);
    const calendarData = {};
    for (const output of outputs) {
      const date = new Date(output.created_at);
      const dateKey = date.toISOString().split('T')[0];
      if (!calendarData[dateKey]) calendarData[dateKey] = [];
      const platform = output.platform || 'Unknown';
      if (!calendarData[dateKey].includes(platform)) calendarData[dateKey].push(platform);
    }
    res.json(calendarData);
  } catch (error) {
    console.error('Calendar data error:', error);
    res.status(500).json({ error: 'Failed to fetch calendar data' });
  }
});


// API: AI-powered peak-time suggestion. Uses platform-specific industry
// posting-windows research; returns the next occurrence of the recommended
// day+time as YYYY-MM-DD / HH:MM in the user's local time. Optionally future:
// enrich with content themes via OpenAI.
router.get('/api/peak-time', requireAuth, (req, res) => {
  try {
    const platform = String(req.query.platform || 'tiktok').toLowerCase();
    const recommendations = {
      tiktok:    { days: [2,4],     hour: 19, label: 'TikTok engagement peaks Tue & Thu evenings around 7 PM, when scrollers are most active.' },
      instagram: { days: [3],       hour: 11, label: 'Instagram traffic peaks midweek mornings — Wednesday at 11 AM converts feed and Reels well.' },
      shorts:    { days: [6],       hour: 10, label: 'YouTube Shorts surges Saturday mornings; 10 AM catches global weekend viewers.' },
      youtube:   { days: [6],       hour: 9,  label: 'YouTube long-form lands best Saturday 9 AM, riding the weekend search spike.' },
      twitter:   { days: [3,5],     hour: 9,  label: 'Twitter / X engagement peaks Wed & Fri at 9 AM during commute and morning scrolls.' },
      linkedin:  { days: [2,3,4],   hour: 8,  label: 'LinkedIn rewards Tue / Wed / Thu at 8 AM — professionals catching up before their day starts.' },
      facebook:  { days: [3],       hour: 13, label: 'Facebook lunch-break window: Wednesday at 1 PM gets the highest reach.' },
      blog:      { days: [3],       hour: 10, label: 'Blog posts perform best Wed at 10 AM — search and newsletter funnels both spike.' },
      newsletter:{ days: [2],       hour: 10, label: 'Newsletters open rates peak Tue at 10 AM, after Monday inbox cleanup.' }
    };
    const rec = recommendations[platform] || recommendations.tiktok;
    // Find the next occurrence of any preferred day at the given hour
    const now = new Date();
    let best = null;
    for (let offset = 0; offset < 14; offset++) {
      const d = new Date(now);
      d.setDate(now.getDate() + offset);
      d.setHours(rec.hour, 0, 0, 0);
      if (rec.days.includes(d.getDay()) && d.getTime() > now.getTime()) {
        best = d;
        break;
      }
    }
    if (!best) {
      best = new Date(now);
      best.setDate(now.getDate() + 1);
      best.setHours(rec.hour, 0, 0, 0);
    }
    const yyyy = best.getFullYear();
    const mm = String(best.getMonth() + 1).padStart(2, '0');
    const dd = String(best.getDate()).padStart(2, '0');
    const hh = String(best.getHours()).padStart(2, '0');
    const mi = String(best.getMinutes()).padStart(2, '0');
    res.json({
      platform,
      date: `${yyyy}-${mm}-${dd}`,
      time: `${hh}:${mi}`,
      reasoning: rec.label
    });
  } catch (error) {
    console.error('Peak-time error:', error);
    res.status(500).json({ error: 'Failed to compute peak time' });
  }
});

module.exports = router;
