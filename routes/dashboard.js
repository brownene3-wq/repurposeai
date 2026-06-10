const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { contentOps, outputOps, shortsOps, creditOps, storageOps, clipRenderOps, userRenderOps } = require('../db/database');
const { capFor } = require('../middleware/credits');
const { capForPlan: storageCapBytes, formatBytes, graceActive: storageGraceActive } = require('../middleware/storage');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');

router.get('/', requireAuth, async (req, res) => {
  // Fire-and-forget: kick off an AI tip generation pass on every
  // dashboard load. ensureFreshTips() self-throttles to one batch per
  // 24h, so this is cheap and idempotent. The page-side banner JS
  // polls /notifications/api/ai-tips on load + every 5 min, so the
  // fresh batch shows up the moment the OpenAI call returns.
  try {
    const tipGen = require('../services/aiTipGenerator');
    if (tipGen && tipGen.ensureFreshTips) {
      setImmediate(function(){
        tipGen.ensureFreshTips(req.user.id).catch(function(){});
      });
    }
  } catch (_) {}

  // Fetch real stats
  let videosProcessed = 0, postsGenerated = 0;
  try {
    videosProcessed = await contentOps.countByUserIdThisMonth(req.user.id);
    postsGenerated = await outputOps.countByUserId(req.user.id);
  } catch (e) { console.error('Dashboard stats error:', e); }

  // Phase 5: precompute time-saved-this-month for the headline tile.
  // The constants here MUST stay in sync with TIME_SAVED_MIN below.
  const TIME_SAVED_MIN_INIT = {
    'smart-shorts': 30, 'ai-reframe': 15, 'enhance-audio': 20,
    'ai-captions': 15, 'ai-thumbnail': 10, 'ai-hook': 5
  };
  let timeSavedMinutes = 0;
  try {
    const { pool } = require('../db/database');
    const rows = (await pool.query(
      `SELECT feature_key, COUNT(*)::int AS uses
         FROM credit_transactions
        WHERE user_id = $1
          AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)
        GROUP BY feature_key`,
      [req.user.id]
    )).rows;
    for (const r of rows) {
      timeSavedMinutes += (r.uses || 0) * (TIME_SAVED_MIN_INIT[r.feature_key] || 0);
    }
  } catch (e) { console.error('Dashboard time-saved init error:', e); }
  // Display formatter — "4h 30m" if >= 1h, else "35 min", or "0" with empty footnote.
  function formatTimeSavedShort(mins) {
    if (!mins || mins <= 0) return '0';
    if (mins < 60) return mins + ' min';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? (h + 'h ' + m + 'm') : (h + 'h');
  }
  const timeSavedDisplay = formatTimeSavedShort(timeSavedMinutes);

  // Recent Smart Shorts (read-only preview)
  function extractYouTubeId(url) {
    if (!url) return null;
    const m = String(url).match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
  }
  function escapeAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  let recentShorts = [];
  try {
    recentShorts = await shortsOps.getByUserId(req.user.id, 4, 0) || [];
  } catch (e) { console.error('Dashboard recent shorts error:', e); }
  const recentShortsHtml = recentShorts.length === 0 ? '' : recentShorts.map(s => {
    const vid = extractYouTubeId(s.video_url);
    // Pick the right thumbnail source for this project:
    //   • YouTube URL  → public mqdefault.jpg
    //   • upload://    → our /shorts/upload-thumbnail/:id endpoint, which
    //     serves the persisted JPEG from smart_shorts.thumbnail_jpeg
    //     (with a live-extract fallback). Survives Railway /tmp wipes.
    //   • anything else → fallback icon
    let thumb = '';
    if (vid) {
      thumb = `https://img.youtube.com/vi/${vid}/mqdefault.jpg`;
    } else if (typeof s.video_url === 'string' && s.video_url.startsWith('upload://')) {
      thumb = `/shorts/upload-thumbnail/${encodeURIComponent(s.id)}`;
    }
    const title = (s.video_title || 'Untitled project').slice(0, 80);
    let clipCount = 0;
    if (s.moments) {
      try { const arr = typeof s.moments === 'string' ? JSON.parse(s.moments) : s.moments; clipCount = Array.isArray(arr) ? arr.length : 0; } catch (e) {}
    }
    const subParts = [];
    if (clipCount > 0) subParts.push(clipCount + ' clip' + (clipCount === 1 ? '' : 's'));
    if (s.status && s.status !== 'completed') subParts.push(s.status);
    const subLine = subParts.join(' · ') || 'Smart Shorts';
    const target = '/shorts?openAnalysis=' + encodeURIComponent(s.id);
    return `
        <a href="${escapeAttr(target)}" class="recent-card" aria-label="${escapeAttr('Open ' + title + ' on Smart Shorts')}" title="Open on Smart Shorts">
          <div class="recent-thumb"${thumb ? ` style="background-image:url('${escapeAttr(thumb)}')"` : ''}>
            ${thumb ? '' : '<span class="recent-thumb-fallback"><img src="/images/section-icons/A-88.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"></span>'}
            <div class="recent-thumb-hover"><span>▶ Open on Smart Shorts</span></div>
          </div>
          <div class="recent-meta">
            <div class="recent-title">${escapeAttr(title)}</div>
            <div class="recent-sub">${escapeAttr(subLine)}</div>
          </div>
        </a>`;
  }).join('');

  // Canonical plan labels (matches PRICE_MAP in routes/billing.js).
  const PLAN_LABELS = { free: 'Free', starter: 'Starter', pro: 'Pro', teams: 'Teams' };
  const planLabel = PLAN_LABELS[req.user.plan] || (req.user.plan ? (req.user.plan.charAt(0).toUpperCase() + req.user.plan.slice(1)) : 'Free');
  // Phase 1: real credit metering. Falls back to 0/cap if the read fails so the UI never breaks.
  let creditsUsed = 0;
  try {
    const usage = await creditOps.getOrResetUsage(req.user.id);
    if (usage) creditsUsed = usage.used || 0;
  } catch (e) { console.error('Dashboard credits read error:', e); }
  const creditsTotal = capFor(req.user.plan);
  // Storage card = total bytes the user currently has on file, summed
  // across all three places renders + uploads land:
  //   clip_renders.file_size   — Library Clips tab (R2-backed)
  //   user_renders.file_size   — Library Edited/Captioned/Hook/
  //                              Reframed/B-Roll/Thumbnails tabs
  //   users.storage_bytes_used — the running counter that
  //                              trackUploadBytes() middleware
  //                              maintains for every raw file uploaded
  //                              to Smart Shorts / Video Editor /
  //                              Enhance Speech / AI Captions / AI
  //                              Hooks / AI Reframe / AI Thumbnails.
  //                              Decremented on file deletion via
  //                              storageOps.subBytes().
  //
  // Adding all three is correct because they represent different files
  // (an uploaded source + a rendered output are two distinct bytes on
  // disk). Grace banner expiry continues to read storage_grace_until,
  // which the overage workflow sets independently.
  let storageBytes = 0, storageCap = storageCapBytes(req.user.plan), graceUntilStr = null, graceActiveNow = false;
  try {
    const [clipS, libS, su] = await Promise.all([
      clipRenderOps.totalStorageBytes(req.user.id).catch(() => ({ total: 0 })),
      userRenderOps.totalStorageBytes(req.user.id, 'all').catch(() => ({ total: 0 })),
      storageOps.getUsage(req.user.id).catch(() => null)
    ]);
    storageBytes = Number(clipS.total || 0)
                 + Number(libS.total || 0)
                 + Number((su && su.bytes) || 0);
    if (su && su.graceUntil) {
      graceActiveNow = storageGraceActive(su.graceUntil);
      if (graceActiveNow) graceUntilStr = new Date(su.graceUntil).toLocaleDateString();
    }
  } catch (e) { console.error('Dashboard library storage read error:', e); }
  const storageUsed = formatBytes(storageBytes);
  const storageTotal = formatBytes(storageCap);
  const storagePct = storageCap > 0 ? Math.min((storageBytes / storageCap) * 100, 100) : 0;
  const storageOverCap = storageBytes >= storageCap;

  const html = `${getHeadHTML('Dashboard')}
  <style>
    ${getBaseCSS()}
    /* Hero Input Section */
    .hero-input{background:var(--surface);border-radius:20px;padding:2.5rem;border:1px solid rgba(108,58,237,0.15);margin-bottom:2rem;text-align:center}
    .hero-input h2{font-size:1.6rem;font-weight:800;margin-bottom:.5rem;background:var(--gradient-1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
    .hero-input p{color:var(--text-muted);font-size:.9rem;margin-bottom:1.5rem}
    .input-row{display:flex;gap:.8rem;max-width:700px;margin:0 auto 1rem}
    .url-input{flex:1;padding:1rem 1.2rem;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:14px;color:var(--text);font-size:1rem;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;outline:none;transition:border-color .3s}
    .url-input:focus{border-color:var(--primary)}
    .url-input::placeholder{color:var(--text-dim)}
    .or-divider{display:flex;align-items:center;gap:1rem;max-width:700px;margin:0 auto 1rem;color:var(--text-dim);font-size:.8rem}
    .or-divider::before,.or-divider::after{content:'';flex:1;height:1px;background:rgba(255,255,255,0.08)}
    .import-btns{display:flex;gap:.8rem;justify-content:center;flex-wrap:wrap}
    .import-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.7rem 1.4rem;border-radius:12px;background:var(--dark);border:1px solid rgba(255,255,255,0.08);color:var(--text-muted);font-size:.85rem;font-weight:500;cursor:pointer;transition:all .2s;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
    .import-btn:hover{border-color:var(--primary);color:var(--primary-light);background:rgba(108,58,237,0.08)}
    .import-btn svg{width:18px;height:18px}

    /* Tool Icons Grid */
    .tools-section{margin-bottom:2rem}
    .tools-section h3{font-size:1.1rem;font-weight:700;margin-bottom:1rem;color:var(--text)}
    .tools-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:1rem}
    .tool-card{background:var(--surface);border:1px solid rgba(108,58,237,0.1);border-radius:16px;padding:1.5rem 1rem;text-align:center;cursor:pointer;transition:all .25s;text-decoration:none;color:var(--text);position:relative;overflow:hidden}
    .tool-card:hover{transform:translateY(-3px);box-shadow:0 8px 30px rgba(108,58,237,0.15);border-color:rgba(108,58,237,0.3)}
    .tool-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:var(--gradient-1);opacity:0;transition:opacity .25s}
    .tool-card:hover::before{opacity:1}
    .tool-icon{font-size:2rem;margin-bottom:.6rem;display:block}.tool-icon img{width:40px;height:40px;object-fit:contain}
    .tool-label{font-size:.8rem;font-weight:600;color:var(--text-muted)}
    .tool-badge{position:absolute;top:.6rem;right:.6rem;font-size:.55rem;font-weight:700;background:var(--gradient-1);color:#fff;padding:2px 6px;border-radius:50px;text-transform:uppercase;letter-spacing:.5px}

    /* Stats Row */
    .stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:2rem}
    .stat-card{background:var(--surface);border-radius:16px;padding:1.3rem;border:1px solid rgba(108,58,237,0.12);position:relative;overflow:hidden}
    .stat-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px}
    .stat-card:nth-child(1)::before{background:linear-gradient(90deg,#6C3AED,#EC4899)}
    .stat-card:nth-child(2)::before{background:linear-gradient(90deg,#0EA5E9,#6366F1)}
    .stat-card:nth-child(3)::before{background:linear-gradient(90deg,#F59E0B,#EF4444)}
    .stat-card:nth-child(4)::before{background:linear-gradient(90deg,#10B981,#06B6D4)}
    .stat-value{font-size:1.6rem;font-weight:800;background:var(--gradient-1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
    .stat-label{font-size:.78rem;color:var(--text-dim);margin-top:.2rem}
    .stat-bar{margin-top:.6rem;height:4px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:hidden}
    .stat-bar-fill{height:100%;border-radius:4px;transition:width .5s ease}
    /* Phase 4: clickable cards + modal */
    .stat-card.clickable{cursor:pointer;transition:transform .15s ease, border-color .15s ease, box-shadow .15s ease}
    .stat-card.clickable:hover{transform:translateY(-2px);border-color:rgba(108,58,237,0.35);box-shadow:0 6px 20px rgba(108,58,237,0.18)}
    .stat-card.clickable::after{content:'›';position:absolute;top:.7rem;right:.9rem;color:rgba(255,255,255,0.25);font-size:1.1rem;font-weight:700;transition:color .15s ease, transform .15s ease}
    .stat-card.clickable:hover::after{color:rgba(255,255,255,0.7);transform:translateX(2px)}
    body.light .stat-card.clickable::after,html.light .stat-card.clickable::after{color:rgba(0,0,0,0.3)}
    body.light .stat-card.clickable:hover::after,html.light .stat-card.clickable:hover::after{color:rgba(0,0,0,0.7)}
    .breakdown-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;z-index:9999;opacity:0;transition:opacity .18s ease}
    .breakdown-modal-backdrop.open{display:flex;opacity:1}
    .breakdown-modal{background:var(--surface);border:1px solid rgba(108,58,237,0.25);border-radius:18px;padding:1.6rem 1.8rem;width:min(520px,92vw);max-height:88vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,0.5);transform:translateY(8px);transition:transform .2s ease}
    .breakdown-modal-backdrop.open .breakdown-modal{transform:translateY(0)}
    .breakdown-head{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.4rem}
    .breakdown-title{font-size:1.2rem;font-weight:800;background:var(--gradient-1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
    .breakdown-close{background:transparent;border:none;color:var(--text-muted);cursor:pointer;font-size:1.4rem;line-height:1;padding:.2rem .5rem;border-radius:8px;transition:background .15s ease, color .15s ease}
    .breakdown-close:hover{background:rgba(255,255,255,0.06);color:var(--text)}
    .breakdown-summary{display:flex;justify-content:space-between;gap:1rem;padding:.9rem 1rem;background:rgba(108,58,237,0.08);border-radius:12px;margin:1rem 0 1.2rem;font-size:.88rem}
    .breakdown-summary div{display:flex;flex-direction:column;gap:.15rem}
    .breakdown-summary .label{font-size:.7rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.04em}
    .breakdown-summary .value{font-weight:800;font-size:1.05rem}
    .breakdown-list{display:flex;flex-direction:column;gap:.55rem}
    .breakdown-row{display:flex;align-items:center;justify-content:space-between;padding:.7rem .9rem;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);font-size:.92rem}
    body.light .breakdown-row,html.light .breakdown-row{background:rgba(0,0,0,0.02);border-color:rgba(0,0,0,0.06)}
    .breakdown-row.zero{opacity:.5}
    .breakdown-row .feature-name{font-weight:600}
    .breakdown-row .feature-amount{font-variant-numeric:tabular-nums;font-weight:700;color:var(--primary-light)}
    .breakdown-grace{font-size:.78rem;color:#F59E0B;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);padding:.55rem .8rem;border-radius:10px;margin-top:1rem;font-weight:600}
    .breakdown-cta{margin-top:1.4rem;display:flex;justify-content:flex-end}
    .breakdown-cta a{padding:.7rem 1.3rem;background:var(--gradient-1);color:#fff;text-decoration:none;border-radius:12px;font-weight:700;font-size:.9rem;transition:transform .15s ease, box-shadow .15s ease}
    .breakdown-cta a:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(108,58,237,0.4)}
    .breakdown-empty{text-align:center;padding:1.4rem 0;color:var(--text-muted);font-size:.88rem}
    .breakdown-loading{text-align:center;padding:1.4rem 0;color:var(--text-muted);font-size:.88rem}

    /* Recent Projects */
    .projects-section{margin-bottom:2rem}
    .projects-section .section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;gap:1rem}
    .projects-section h3{font-size:1.1rem;font-weight:700;margin:0}
    .projects-section .see-more{color:var(--primary-light);font-size:.85rem;font-weight:600;text-decoration:none;padding:.4rem .8rem;border-radius:8px;transition:background .15s}
    .projects-section .see-more:hover{background:rgba(108,58,237,0.08)}
    .recent-shorts-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:1rem;margin-bottom:1.5rem}
    .recent-card{background:var(--surface);border:1px solid rgba(255,255,255,0.06);border-radius:12px;overflow:hidden;cursor:pointer;user-select:none;color:inherit;text-decoration:none;display:block;transition:transform .15s ease,border-color .15s ease,box-shadow .15s ease}
    .recent-card:hover{transform:translateY(-2px);border-color:rgba(108,58,237,0.40);box-shadow:0 10px 30px rgba(108,58,237,0.18)}
    .recent-card:hover .recent-thumb-hover{opacity:1}
    .recent-thumb{aspect-ratio:16/9;background:#0a0a0f;background-size:cover;background-position:center;position:relative}
    .recent-thumb-fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.3);font-size:1.6rem}
    .recent-thumb-hover{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,rgba(108,58,237,0.10),rgba(0,0,0,0.55));color:#fff;font-size:0.82rem;font-weight:700;letter-spacing:.02em;opacity:0;transition:opacity .15s ease;pointer-events:none}
    .recent-thumb-hover span{padding:6px 12px;border-radius:999px;background:rgba(108,58,237,0.85);box-shadow:0 6px 24px rgba(108,58,237,0.35)}
    .recent-meta{padding:.65rem .9rem .8rem}
    .recent-title{font-size:.85rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3}
    .recent-sub{color:var(--text-dim);font-size:.7rem;margin-top:4px}
    .quick-actions-cta{display:flex;align-items:center;gap:.8rem;flex-wrap:wrap;justify-content:center}
    body.light .recent-card,html.light .recent-card{border-color:rgba(0,0,0,0.06)}
    body.light .recent-thumb,html.light .recent-thumb{background:#e5e7eb}
    .empty-state{background:var(--surface);border:1px dashed rgba(255,255,255,0.1);border-radius:16px;padding:3rem;text-align:center;color:var(--text-dim)}
    .empty-state .empty-icon{font-size:3rem;margin-bottom:1rem;opacity:.5}
    .empty-state p{font-size:.9rem;margin-bottom:1rem}

    /* Quick Actions */
    .quick-actions{display:flex;gap:.8rem;justify-content:center;flex-wrap:wrap;margin-top:1rem}

    /* Loading */
    .loading-spinner{display:none;text-align:center;padding:3rem}
    .loading-spinner.show{display:block}
    .spinner{width:40px;height:40px;border:3px solid var(--surface);border-top-color:var(--primary);border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 1rem}
    @keyframes spin{to{transform:rotate(360deg)}}
    .results-section{display:none}
    .results-section.show{display:block}
    .platform-tabs{display:flex;gap:.5rem;margin-bottom:1.5rem;flex-wrap:wrap}
    .platform-tab{padding:.6rem 1.2rem;border-radius:10px;background:var(--surface);border:var(--border-subtle);color:var(--text-muted);cursor:pointer;font-size:.85rem;font-weight:500;transition:all .2s;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
    .platform-tab:hover,.platform-tab.active{background:linear-gradient(135deg,rgba(108,58,237,0.15),rgba(236,72,153,0.1));color:var(--primary-light);border-color:rgba(108,58,237,0.3)}
    .platform-content{background:var(--dark);border-radius:12px;padding:1.5rem;border:var(--border-subtle);display:none}
    .platform-content.show{display:block}
    .content-textarea{width:100%;min-height:200px;background:var(--surface);border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:var(--text);padding:1rem;font-size:.9rem;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;resize:vertical;outline:none}
    .content-textarea:focus{border-color:var(--primary)}

    /* Light theme overrides */
    body.light .hero-input,html.light .hero-input{border-color:rgba(108,58,237,0.12);box-shadow:0 2px 12px rgba(108,58,237,0.06)}
    body.light .url-input,html.light .url-input{background:#F8F9FC;border-color:rgba(0,0,0,0.1)}
    body.light .import-btn,html.light .import-btn{background:#F8F9FC;border-color:rgba(0,0,0,0.08);color:#4A5568}
    body.light .import-btn:hover,html.light .import-btn:hover{background:rgba(108,58,237,0.06)}
    body.light .or-divider::before,body.light .or-divider::after,html.light .or-divider::before,html.light .or-divider::after{background:rgba(0,0,0,0.08)}
    body.light .tool-card,html.light .tool-card{border-color:rgba(108,58,237,0.08);box-shadow:0 2px 8px rgba(108,58,237,0.04)}
    body.light .tool-card:hover,html.light .tool-card:hover{box-shadow:0 8px 24px rgba(108,58,237,0.1)}
    body.light .stat-card,html.light .stat-card{border-color:rgba(108,58,237,0.08);box-shadow:0 2px 8px rgba(0,0,0,0.04)}
    body.light .stat-bar,html.light .stat-bar{background:rgba(0,0,0,0.06)}
    body.light .empty-state,html.light .empty-state{border-color:rgba(0,0,0,0.1)}
    body.light .content-textarea,html.light .content-textarea{background:#F8F9FC;border-color:rgba(0,0,0,0.08)}

    @media(max-width:768px){
      .stats-row{grid-template-columns:repeat(2,1fr)}
      .tools-grid{grid-template-columns:repeat(auto-fill,minmax(100px,1fr))}
      .tool-card{padding:1rem .7rem}
      .tool-icon{font-size:1.6rem}.tool-icon img{width:32px;height:32px}
      .tool-label{font-size:.72rem}
      .input-row{flex-direction:column}
      .hero-input{padding:1.5rem}
      .hero-input h2{font-size:1.2rem}
    }
    @media(max-width:480px){
      .stats-row{grid-template-columns:1fr 1fr}
      .tools-grid{grid-template-columns:repeat(3,1fr)}
    }
  </style>
</head>
<body>
 <div class="dashboard">
    ${getSidebar('dashboard', req.user, req.teamPermissions)}

    <main class="main-content">
      ${getThemeToggle()}
      ${req.query.restricted === '1' ? '<div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:12px;padding:1rem 1.5rem;margin-bottom:1.5rem;color:#EF4444;font-size:.9rem;">You don\'t have permission to access that page. Contact your team admin to request access.</div>' : ''}

      <div class="page-header">
        <h1><img src="/images/section-icons/A-21.png" alt="" style="height:36px;width:36px;vertical-align:middle;margin-right:8px;border-radius:8px;display:inline-block">Content Studio</h1>
        <p>Transform your content into viral posts for every platform</p>
      </div>

      <!-- AI Tip Banner. Loaded by initAiTipBanner() on dashboard load.
           Shows the top-priority unread AI tip with a CTA. Hidden when
           there are no unread tips. Dismissable in place — full list
           always remains on /notifications. -->
      <div id="aiTipBanner" hidden style="display:flex;align-items:flex-start;gap:14px;background:linear-gradient(135deg,rgba(108,58,237,0.18),rgba(236,72,153,0.10));border:1px solid rgba(108,58,237,0.55);border-radius:14px;padding:14px 18px;margin-bottom:1.4rem;position:relative;box-shadow:0 8px 28px -16px rgba(108,58,237,0.55);">
        <div id="aiTipBannerIcon" style="flex-shrink:0;width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.1rem;font-weight:800">&#10024;</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px">
            <span id="aiTipBannerCat" style="font-size:.62rem;font-weight:800;letter-spacing:.10em;text-transform:uppercase;color:#a78bfa;background:rgba(108,58,237,0.14);padding:3px 8px;border-radius:999px">Tip</span>
            <span id="aiTipBannerMore" style="font-size:.72rem;color:var(--text-muted)"></span>
          </div>
          <div id="aiTipBannerTitle" style="font-size:1rem;font-weight:800;color:var(--text);line-height:1.3;margin-bottom:4px"></div>
          <div id="aiTipBannerBody" style="color:var(--text-muted);font-size:.88rem;line-height:1.5"></div>
          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <a id="aiTipBannerCta" href="#" style="display:none;align-items:center;gap:6px;background:linear-gradient(135deg,#6C3AED,#EC4899);color:#fff;text-decoration:none;padding:7px 14px;border-radius:8px;font-weight:700;font-size:.82rem;box-shadow:0 4px 14px -6px rgba(108,58,237,0.50)"></a>
            <a href="/notifications" style="font-size:.78rem;color:#a78bfa;text-decoration:none;font-weight:600">See all tips &rarr;</a>
          </div>
        </div>
        <button id="aiTipBannerDismiss" title="Dismiss" style="position:absolute;top:8px;right:10px;background:transparent;border:none;color:var(--text-muted);width:26px;height:26px;border-radius:6px;cursor:pointer;font-size:1.1rem;line-height:1;display:flex;align-items:center;justify-content:center;opacity:.6">&times;</button>
      </div>

      <!-- Stats Row -->
      <div class="stats-row">
        <div class="stat-card clickable" data-modal="credits" role="button" tabindex="0" aria-label="Open credits breakdown">
          <div class="stat-value">${creditsUsed}/${creditsTotal}</div>
          <div class="stat-label">Credits Used</div>
          <div class="stat-bar"><div class="stat-bar-fill" style="width:${Math.min((creditsUsed/creditsTotal)*100,100)}%;background:linear-gradient(90deg,#6C3AED,#EC4899)"></div></div>
        </div>
        <div class="stat-card clickable" data-modal="time-saved" role="button" tabindex="0" aria-label="Open time saved breakdown">
          <div class="stat-value">${timeSavedDisplay}</div>
          <div class="stat-label">Time Saved This Month</div>
          <div class="stat-bar"><div class="stat-bar-fill" style="width:${Math.min((timeSavedMinutes/600)*100,100)}%;background:linear-gradient(90deg,#0EA5E9,#6366F1)"></div></div>
        </div>
        <div class="stat-card clickable" data-modal="storage" role="button" tabindex="0" aria-label="Open storage breakdown">
          <div class="stat-value">${storageUsed}</div>
          <div class="stat-label">Storage (${storageTotal})</div>
          <div class="stat-bar"><div class="stat-bar-fill" style="width:${storagePct}%;background:linear-gradient(90deg,#F59E0B,#EF4444)"></div></div>
          ${graceActiveNow ? `<div style="font-size:.7rem;color:#F59E0B;margin-top:.4rem;font-weight:600">⚠ Over cap. Grace until ${graceUntilStr}</div>` : ''}
        </div>
        <a href="/billing" class="stat-card clickable" aria-label="Open billing — currently on ${planLabel} plan" title="Manage your subscription on the Billing page" style="text-decoration:none;color:inherit;display:block;">
          <div class="stat-value">${planLabel}</div>
          <div class="stat-label">Current Plan</div>
          <div class="stat-bar"><div class="stat-bar-fill" style="width:100%;background:linear-gradient(90deg,#10B981,#06B6D4)"></div></div>
        </a>
      </div>

      <!-- Hero Input -->
      <div class="hero-input" ${req.isTeamMember && (!req.teamPermissions || !req.teamPermissions.use_repurpose) ? 'style="display:none"' : ''}>
        <h2><img src="/images/splicora-app-icon.png?v=5" alt="" style="height:28px;width:28px;vertical-align:middle;margin-right:6px;display:inline-block"> Start Creating</h2>
        <p>Paste a YouTube link, upload a file, or import from cloud storage</p>
        <div class="input-row">
          <input type="url" class="url-input" id="youtubeUrl" name="yt_dashboard_url" autocomplete="one-time-code" data-form-type="other" data-lpignore="true" placeholder="Paste YouTube URL here...">
          <button class="btn btn-primary" id="processBtn" onclick="processVideo()">Repurpose</button>
        </div>
        <div class="or-divider"><span>or import from</span></div>
        <div class="import-btns">
          <button class="import-btn" onclick="alert('Google Drive import coming soon!')">
            <img src="/images/section-icons/A-74.png" alt="" style="height:20px;width:20px;vertical-align:middle">
            Google Drive
          </button>
          <button class="import-btn" onclick="alert('Dropbox import coming soon!')">
            <img src="/images/section-icons/A-75.png" alt="" style="height:20px;width:20px;vertical-align:middle">
            Dropbox
          </button>
          <label class="import-btn" style="cursor:pointer">
            <img src="/images/section-icons/A-59.png" alt="" style="height:20px;width:20px;vertical-align:middle">
            Upload File
            <input type="file" accept="video/*,audio/*" style="display:none" onchange="processUploadedFile(this.files[0])">
          </label>
        </div>
      </div>

      <!-- Loading State -->
      <div class="loading-spinner" id="loading">
        <div class="spinner"></div>
        <p style="color:var(--text-muted)">AI is analyzing your video and generating content...</p>
      </div>

      <!-- Results (immediately after input so user sees them right away) -->
      <div class="results-section" id="results" style="display:none;">
        <h2 style="font-size:1.2rem;font-weight:700;margin-bottom:1rem"><img src="/images/section-icons/A-42.png" alt="" style="height:22px;width:22px;vertical-align:middle;border-radius:5px;margin-right:6px">Generated Content</h2>
        <div class="platform-tabs" id="platformTabs"></div>
        <div id="platformContents"></div>
        <p style="margin-top:1rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">Want all 7 platforms? <a href="/repurpose" style="color:var(--primary);">Go to Repurpose</a></p>
      </div>

      <!-- AI Tools Grid -->
      <div class="tools-section">
        <h3><img src="/images/section-icons/A-21.png" alt="" style="width:24px;height:24px;vertical-align:middle;margin-right:6px;border-radius:6px"> AI Tools</h3>
        <div class="tools-grid">
          <a href="/repurpose" class="tool-card">
            <span class="tool-icon"><img src="/images/section-icons/A-101.png" alt="Create"></span>
            <span class="tool-label">Create</span>
          </a>
          <a href="/shorts" class="tool-card">
            <span class="tool-icon"><img src="/images/section-icons/A-1.png" alt="Smart Shorts"></span>
            <span class="tool-label">Smart Shorts</span>
          </a>
          <a href="/video-editor" class="tool-card">
            <span class="tool-icon"><img src="/images/section-icons/A-2.png" alt="Video Editor"></span>
            <span class="tool-label">Video Editor</span>
          </a>
          <a href="/ai-captions" class="tool-card">
            <span class="tool-icon"><img src="/images/section-icons/A-3.png" alt="AI Captions"></span>
            <span class="tool-label">AI Captions</span>
            <span class="tool-badge">New</span>
          </a>
          <a href="/caption-presets" class="tool-card">
            <span class="tool-icon"><img src="/images/section-icons/A-4.png" alt="Caption Styles"></span>
            <span class="tool-label">Caption Styles</span>
          </a>
          <a href="/ai-hook" class="tool-card">
            <span class="tool-icon"><img src="/images/section-icons/A-5.png" alt="AI Hooks"></span>
            <span class="tool-label">AI Hooks</span>
          </a>
          <a href="/ai-reframe" class="tool-card">
            <span class="tool-icon"><img src="/images/section-icons/A-6.png" alt="AI Reframe"></span>
            <span class="tool-label">AI Reframe</span>
          </a>
          <a href="/ai-thumbnail" class="tool-card">
            <span class="tool-icon"><img src="/images/section-icons/A-103.png" alt="AI Thumbnails"></span>
            <span class="tool-label">AI Thumbnails</span>
          </a>
          <a href="/ai-broll" class="tool-card">
            <span class="tool-icon"><img src="/images/section-icons/A-7.png" alt="AI B-Roll"></span>
            <span class="tool-label">AI B-Roll</span>
            <span class="tool-badge">New</span>
          </a>
          <a href="/enhance-speech" class="tool-card">
            <span class="tool-icon"><img src="/images/section-icons/A-113.png" alt="Enhance Audio"></span>
            <span class="tool-label">Enhance Audio</span>
          </a>
          <a href="/brand-voice" class="tool-card">
            <span class="tool-icon"><img src="/images/section-icons/A-117.png" alt="Brand Voice"></span>
            <span class="tool-label">Brand Voice</span>
          </a>
          <a href="/settings?section=brandtemplates" class="tool-card">
            <span class="tool-icon"><img src="/images/section-icons/A-118.png" alt="Brand Templates"></span>
            <span class="tool-label">Brand Templates</span>
            <span class="tool-badge">New</span>
          </a>
          <a href="/dashboard/calendar" class="tool-card">
            <span class="tool-icon"><img src="/images/section-icons/A-8.png" alt="Calendar"></span>
            <span class="tool-label">Calendar</span>
          </a>
          <a href="/dashboard/analytics" class="tool-card">
            <span class="tool-icon"><img src="/images/section-icons/A-50.png" alt="Analytics"></span>
            <span class="tool-label">Analytics</span>
          </a>
        </div>
      </div>

      <!-- Recent Projects -->
      <div class="projects-section">
        <div class="section-head">
          <h3><img src="/images/section-icons/A-112.png" alt="" style="width:24px;height:24px;vertical-align:middle;margin-right:6px;border-radius:6px"> Recent Projects</h3>
          ${recentShorts.length > 0 ? '<a href="/shorts" class="see-more">See more &rarr;</a>' : ''}
        </div>
        ${recentShorts.length > 0 ? `
          <div class="recent-shorts-grid" aria-label="Recent Smart Shorts (preview)">${recentShortsHtml}</div>
          <div class="quick-actions-cta">
            <a href="/repurpose" class="btn btn-primary btn-sm"><img src="/images/section-icons/A-12.png" alt="" style="height:18px;width:18px;vertical-align:middle;border-radius:4px;margin-right:4px"> Repurpose a Video</a>
            <a href="/shorts" class="btn btn-outline btn-sm"><img src="/images/section-icons/A-1.png" alt="" style="height:18px;width:18px;vertical-align:middle;border-radius:4px;margin-right:4px"> Create Shorts</a>
          </div>
        ` : `
          <div class="empty-state" id="emptyState">
            <div class="empty-icon"><img src="/images/section-icons/A-42.png" alt="" style="height:48px;width:48px;border-radius:10px"></div>
            <p>No projects yet. Paste a YouTube URL above to get started!</p>
            <div class="quick-actions">
              <a href="/repurpose" class="btn btn-primary btn-sm"><img src="/images/section-icons/A-12.png" alt="" style="height:18px;width:18px;vertical-align:middle;border-radius:4px;margin-right:4px"> Repurpose a Video</a>
              <a href="/shorts" class="btn btn-outline btn-sm"><img src="/images/section-icons/A-1.png" alt="" style="height:18px;width:18px;vertical-align:middle;border-radius:4px;margin-right:4px"> Create Shorts</a>
            </div>
          </div>
        `}
      </div>
    </main>
  </div>

  <div class="toast" id="toast">Copied to clipboard!</div>

  <script>
    ${getThemeScript()}

    async function processUploadedFile(file) {
      if (!file) return;
      const maxSize = 200 * 1024 * 1024;
      if (file.size > maxSize) {
        alert('File is too large. Maximum size is 200MB.');
        return;
      }

      const btn = document.getElementById('processBtn');
      btn.disabled = true; btn.innerHTML = '<img src="/images/section-icons/A-89.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Analyzing…';
      showAnalyzeNotice('Uploading file…');

      try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/shorts/analyze-upload', { method: 'POST', body: formData });

        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const data = await res.json();
          throw new Error(data.error || 'Analysis failed');
        }
        if (!res.ok) throw new Error('Analysis failed. Please try again.');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        const NL = String.fromCharCode(10);
        let analysisId = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split(NL);
          buf = parts.pop() || '';
          for (const line of parts) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            let data;
            try { data = JSON.parse(trimmed.slice(6)); } catch (_) { continue; }
            if (data.status === 'completed') {
              analysisId = data.analysisId;
              setAnalyzeStep('Analysis complete! Redirecting…');
            } else if (data.status === 'error') {
              throw new Error(data.message || 'Analysis failed');
            } else if (data.message) {
              setAnalyzeStep(data.message);
            }
          }
        }

        if (analysisId) {
          hideAnalyzeNotice();
          location.href = '/shorts?openAnalysis=' + encodeURIComponent(analysisId);
          return;
        }
        hideAnalyzeNotice();
        location.href = '/shorts';
      } catch (err) {
        hideAnalyzeNotice();
        alert(err.message || 'Analysis failed. Please try again.');
      } finally {
        btn.disabled = false; btn.innerHTML = '&#x26A1; Repurpose';
      }
    }

    function showAnalyzeNotice(initialMsg){
      var n = document.getElementById('analyzeNotice');
      if (!n) {
        n = document.createElement('div');
        n.id = 'analyzeNotice';
        n.setAttribute('role', 'status');
        n.style.cssText = 'position:fixed;inset:0;background:rgba(8,6,18,0.78);backdrop-filter:blur(6px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px';
        n.innerHTML =
          '<div style="background:linear-gradient(180deg,var(--surface),rgba(108,58,237,0.06));border:1px solid rgba(108,58,237,0.45);border-radius:16px;padding:28px;width:100%;max-width:480px;text-align:center;box-shadow:0 0 0 1px rgba(108,58,237,0.20),0 20px 60px rgba(108,58,237,0.25)">' +
            '<div style="display:inline-flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#6C3AED,#EC4899);margin-bottom:16px;animation:noticePulse 1.6s ease-in-out infinite">' +
              '<div style="width:28px;height:28px;border:3px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:noticeSpin 1s linear infinite"></div>' +
            '</div>' +
            '<h3 style="margin:0 0 6px;font-size:1.15rem;font-weight:800;background:linear-gradient(135deg,#6C3AED,#EC4899);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent">Analyzing your video</h3>' +
            '<div id="analyzeStep" style="font-size:0.92rem;color:var(--text);margin-bottom:14px;font-weight:600">Starting…</div>' +
            '<div style="font-size:0.82rem;color:var(--text-muted);line-height:1.5;background:rgba(108,58,237,0.08);border:1px dashed rgba(108,58,237,0.30);border-radius:10px;padding:10px 14px;text-align:left">' +
              '<strong style="color:#a78bfa">Please wait while AI analyzes your video.</strong><br>' +
              'Don&#39;t switch tabs, close the window, or perform any other actions on the page until the process is complete.' +
            '</div>' +
          '</div>' +
          '<style>@keyframes noticeSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}@keyframes noticePulse{0%,100%{box-shadow:0 0 0 0 rgba(108,58,237,0.4)}50%{box-shadow:0 0 0 14px rgba(108,58,237,0)}}</style>';
        document.body.appendChild(n);
        // Discourage accidental navigation while analyzing
        n.__beforeUnload = function(e){ e.preventDefault(); e.returnValue = ''; return ''; };
        window.addEventListener('beforeunload', n.__beforeUnload);
      }
      n.style.display = 'flex';
      var step = n.querySelector('#analyzeStep');
      if (step && initialMsg) step.textContent = initialMsg;
    }
    function setAnalyzeStep(msg){
      var s = document.getElementById('analyzeStep');
      if (s && msg) s.textContent = msg;
    }
    function hideAnalyzeNotice(){
      var n = document.getElementById('analyzeNotice');
      if (n) {
        n.style.display = 'none';
        if (n.__beforeUnload) {
          window.removeEventListener('beforeunload', n.__beforeUnload);
          n.__beforeUnload = null;
        }
      }
    }

    async function processVideo() {
      const url = document.getElementById('youtubeUrl').value.trim();
      if (!url) { alert('Please paste a YouTube URL'); return; }

      const btn = document.getElementById('processBtn');
      btn.disabled = true; btn.innerHTML = '<img src="/images/section-icons/A-89.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Analyzing…';
      showAnalyzeNotice('Starting…');

      try {
        const res = await fetch('/shorts/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl: url })
        });

        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          // Pre-SSE error (e.g. duplicate / invalid URL / quota)
          const data = await res.json();
          throw new Error(data.error || 'Analysis failed');
        }
        if (!res.ok) throw new Error('Analysis failed. Please try again.');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        const NL = String.fromCharCode(10);
        let analysisId = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split(NL);
          buf = parts.pop() || '';
          for (const line of parts) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            let data;
            try { data = JSON.parse(trimmed.slice(6)); } catch (_) { continue; }
            if (data.status === 'completed') {
              analysisId = data.analysisId;
              setAnalyzeStep('Analysis complete! Redirecting…');
            } else if (data.status === 'error') {
              throw new Error(data.message || 'Analysis failed');
            } else if (data.message) {
              setAnalyzeStep(data.message);
            }
          }
        }

        // Redirect to Smart Shorts with the analysis open
        if (analysisId) {
          // Remove beforeunload before navigating so the browser doesn't prompt
          hideAnalyzeNotice();
          location.href = '/shorts?openAnalysis=' + encodeURIComponent(analysisId);
          return;
        }
        // Fallback: just go to /shorts
        hideAnalyzeNotice();
        location.href = '/shorts';
      } catch (err) {
        hideAnalyzeNotice();
        alert(err.message || 'Analysis failed. Please try again.');
      } finally {
        btn.disabled = false; btn.innerHTML = '&#x26A1; Repurpose';
      }
    }

    function addPlatformResult(output, isFirst) {
      const tabs = document.getElementById('platformTabs');
      const contents = document.getElementById('platformContents');
      const platform = output.platform || 'Content';
      const text = output.generated_content || '';
      const id = platform.toLowerCase().replace(/[^a-z]/g, '');

      const tab = document.createElement('button');
      tab.className = 'platform-tab' + (isFirst ? ' active' : '');
      tab.textContent = platform;
      tab.dataset.platform = id;
      tab.onclick = () => switchTab(id);
      tabs.appendChild(tab);

      const div = document.createElement('div');
      div.className = 'platform-content' + (isFirst ? ' show' : '');
      div.id = 'content-' + id;
      div.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">' +
          '<h3 style="font-size:1rem;font-weight:600;color:var(--primary)">' + platform + '</h3>' +
          '<span style="font-size:0.75rem;color:var(--text-muted)">' + text.length + ' chars</span>' +
        '</div>' +
        '<textarea class="content-textarea" id="textarea-' + id + '">' + text.replace(/</g, '&lt;') + '</textarea>' +
        '<div style="margin-top:0.5rem;display:flex;gap:0.5rem;">' +
          '<button class="btn btn-primary btn-sm" onclick="copyText(\\'' + id + '\\')"><img src="/images/section-icons/A-84.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Copy</button>' +
        '</div>';
      contents.appendChild(div);
    }

    function switchTab(id) {
      document.querySelectorAll('.platform-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.platform-content').forEach(c => c.classList.remove('show'));
      document.querySelector('[data-platform="' + id + '"]').classList.add('active');
      document.getElementById('content-' + id).classList.add('show');
    }

    function copyText(id) {
      const ta = document.getElementById('textarea-' + id);
      navigator.clipboard.writeText(ta.value).then(() => {
        const toast = document.getElementById('toast');
        toast.style.display = 'block';
        setTimeout(() => { toast.style.display = 'none'; }, 2000);
      });
    }

    // Clear autofilled email from URL input
    (function() {
      var u = document.getElementById('youtubeUrl');
      if (u) {
        setTimeout(function() {
          if (u.value && (u.value.includes('@') || !u.value.includes('http'))) u.value = '';
        }, 100);
        u.addEventListener('focus', function() {
          if (this.value && this.value.includes('@')) this.value = '';
        });
      }
    })();

    // Allow Enter key to trigger processing
    document.getElementById('youtubeUrl').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') processVideo();
    });
  </script>
<!-- Phase 4: breakdown modal -->
<div class="breakdown-modal-backdrop" id="breakdownBackdrop" role="dialog" aria-modal="true" aria-labelledby="breakdownTitle">
  <div class="breakdown-modal" id="breakdownModal" role="document">
    <div class="breakdown-head">
      <div class="breakdown-title" id="breakdownTitle">Loading…</div>
      <button class="breakdown-close" id="breakdownClose" aria-label="Close">×</button>
    </div>
    <div class="breakdown-summary" id="breakdownSummary"></div>
    <div class="breakdown-list" id="breakdownList"></div>
    <div id="breakdownGrace"></div>
    <div class="breakdown-cta">
      <a href="/billing" id="breakdownUpgrade">Upgrade your plan</a>
    </div>
  </div>
</div>
<script>
(function(){
  const backdrop = document.getElementById('breakdownBackdrop');
  const titleEl = document.getElementById('breakdownTitle');
  const summaryEl = document.getElementById('breakdownSummary');
  const listEl = document.getElementById('breakdownList');
  const graceEl = document.getElementById('breakdownGrace');
  const upgradeEl = document.getElementById('breakdownUpgrade');
  const closeBtn = document.getElementById('breakdownClose');

  function open(){ backdrop.classList.add('open'); document.body.style.overflow='hidden'; }
  function close(){ backdrop.classList.remove('open'); document.body.style.overflow=''; }

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && backdrop.classList.contains('open')) close(); });

  function setLoading(label){
    titleEl.textContent = label;
    summaryEl.innerHTML = '';
    listEl.innerHTML = '<div class="breakdown-loading">Loading…</div>';
    graceEl.innerHTML = '';
  }

  function renderSummary(items){
    summaryEl.innerHTML = items.map(it =>
      '<div><span class="label">'+it.label+'</span><span class="value">'+it.value+'</span></div>'
    ).join('');
  }

  function renderRows(rows, formatter){
    if (!rows || rows.length === 0 || rows.every(r => formatter(r) === '0' || formatter(r) === '0 B')){
      listEl.innerHTML = '<div class="breakdown-empty">No usage this month yet. Run a feature and the breakdown will fill in.</div>';
      return;
    }
    listEl.innerHTML = rows.map(r => {
      const amount = formatter(r);
      const zero = (amount === '0' || amount === '0 B') ? ' zero' : '';
      return '<div class="breakdown-row'+zero+'"><span class="feature-name">'+r.label+'</span><span class="feature-amount">'+amount+'</span></div>';
    }).join('');
  }

  async function loadCredits(){
    setLoading('Credits this month');
    try {
      const r = await fetch('/dashboard/api/credits-breakdown', { headers: {'Accept':'application/json'} });
      if (!r.ok) throw new Error('http '+r.status);
      const data = await r.json();
      titleEl.textContent = 'Credits this month';
      renderSummary([
        { label: 'Used',      value: data.used + ' / ' + data.cap },
        { label: 'Remaining', value: data.remaining }
      ]);
      renderRows(data.breakdown, r => String(r.credits || 0));
      graceEl.innerHTML = '';
    } catch (err) {
      console.error(err);
      listEl.innerHTML = '<div class="breakdown-empty">Could not load credits breakdown. Try refreshing.</div>';
    }
  }

  async function loadStorage(){
    setLoading('Storage usage');
    try {
      const r = await fetch('/dashboard/api/storage-breakdown', { headers: {'Accept':'application/json'} });
      if (!r.ok) throw new Error('http '+r.status);
      const data = await r.json();
      titleEl.textContent = 'Storage usage';
      renderSummary([
        { label: 'Used',      value: data.usedFormatted + ' / ' + data.capFormatted },
        { label: 'Remaining', value: data.remainingFormatted }
      ]);
      renderRows(data.breakdown, r => r.formatted || '0 B');
      if (data.graceUntil) {
        const until = new Date(data.graceUntil);
        if (until.getTime() > Date.now()) {
          graceEl.innerHTML = '<div class="breakdown-grace">⚠ You are over your cap. Grace period ends '+until.toLocaleDateString()+'.</div>';
        } else {
          graceEl.innerHTML = '';
        }
      } else {
        graceEl.innerHTML = '';
      }
    } catch (err) {
      console.error(err);
      listEl.innerHTML = '<div class="breakdown-empty">Could not load storage breakdown. Try refreshing.</div>';
    }
  }

  function fmtMins(m){
    if (!m || m <= 0) return '0';
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60), mm = m % 60;
    return mm > 0 ? (h + 'h ' + mm + 'm') : (h + 'h');
  }

  async function loadTimeSaved(){
    setLoading('Time saved this month');
    try {
      const r = await fetch('/dashboard/api/time-saved', { headers: {'Accept':'application/json'} });
      if (!r.ok) throw new Error('http ' + r.status);
      const data = await r.json();
      titleEl.textContent = 'Time saved this month';
      const delta = data.deltaMinutes;
      const arrow = delta > 0 ? '↑' : (delta < 0 ? '↓' : '');
      const deltaColor = delta > 0 ? '#10B981' : (delta < 0 ? '#EF4444' : 'var(--text-muted)');
      const deltaText = delta === 0 ? 'same as last month'
        : (arrow + ' ' + fmtMins(Math.abs(delta)) + ' vs last month');
      summaryEl.innerHTML =
        '<div><span class="label">Saved this month</span><span class="value">' + fmtMins(data.thisMonthMinutes) + '</span></div>'
      + '<div><span class="label">Vs last month</span><span class="value" style="color:' + deltaColor + '">' + deltaText + '</span></div>';

      // Per-feature rows: "AI Hooks    3 uses × 5 min      15 min"
      if (!data.breakdown || data.breakdown.every(r => r.totalMinutes === 0)){
        listEl.innerHTML = '<div class="breakdown-empty">No time saved yet this month.<br>Run any feature and it starts adding up.</div>';
      } else {
        listEl.innerHTML = data.breakdown.map(r => {
          const zero = r.totalMinutes === 0 ? ' zero' : '';
          const middle = r.uses > 0
            ? '<span style="font-size:.78rem;color:var(--text-dim);margin-right:.6rem">' + r.uses + ' use' + (r.uses === 1 ? '' : 's') + ' × ' + r.minutesPer + ' min</span>'
            : '<span style="font-size:.78rem;color:var(--text-dim);margin-right:.6rem">~' + r.minutesPer + ' min each</span>';
          return '<div class="breakdown-row' + zero + '"><span class="feature-name">' + r.label + '</span><span style="display:flex;align-items:center">' + middle + '<span class="feature-amount">' + fmtMins(r.totalMinutes) + '</span></span></div>';
        }).join('');
      }

      // Equivalent + methodology + spotlight CTA — replace the grace slot.
      let extra = '';
      if (data.equivalent) {
        extra += '<div style="margin-top:1rem;padding:.7rem .9rem;border-radius:10px;background:rgba(14,165,233,0.08);border:1px solid rgba(14,165,233,0.25);font-size:.85rem;color:var(--text-muted)">⏱ ' + data.equivalent + '</div>';
      }
      extra += '<div style="margin-top:.6rem;font-size:.72rem;color:var(--text-dim);font-style:italic">Estimates based on average manual effort: transcribing, cutting, captioning, writing. Your mileage may vary.</div>';
      if (data.spotlight) {
        extra += '<div style="margin-top:1rem;padding:.85rem 1rem;border-radius:12px;background:linear-gradient(135deg,rgba(108,58,237,0.15),rgba(236,72,153,0.12));border:1px solid rgba(108,58,237,0.3)">'
              + '<div style="font-size:.8rem;color:var(--text-muted);margin-bottom:.4rem"><img src="/images/section-icons/A-80.png" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:2px"> Tip</div>'
              + '<div style="font-size:.88rem;margin-bottom:.7rem">' + data.spotlight.message + '</div>'
              + '<a href="' + data.spotlight.href + '" style="display:inline-block;padding:.5rem 1rem;background:var(--gradient-1);color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:.82rem">Open ' + data.spotlight.label + '</a>'
              + '</div>';
      }
      graceEl.innerHTML = extra;
      // Hide the generic Upgrade CTA on this modal — we have a more specific one.
      document.querySelector('.breakdown-cta').style.display = 'none';
    } catch (err) {
      console.error(err);
      listEl.innerHTML = '<div class="breakdown-empty">Could not load time saved. Try refreshing.</div>';
    }
  }

  // Restore the Upgrade CTA when the user opens credits/storage modals
  // (loadTimeSaved hides it; subsequent opens need it back).
  const origLoadCredits = loadCredits, origLoadStorage = loadStorage;
  loadCredits = async function(){ document.querySelector('.breakdown-cta').style.display = ''; await origLoadCredits(); };
  loadStorage = async function(){ document.querySelector('.breakdown-cta').style.display = ''; await origLoadStorage(); };

  function attach(card){
    const trigger = () => {
      const which = card.getAttribute('data-modal');
      open();
      if (which === 'credits') loadCredits();
      else if (which === 'storage') loadStorage();
      else if (which === 'time-saved') loadTimeSaved();
    };
    card.addEventListener('click', trigger);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger(); }
    });
  }
  document.querySelectorAll('.stat-card.clickable[data-modal]').forEach(attach);
})();

// ---- AI Tip Banner ----
// Show the top unread AI tip front-and-centre on dashboard load so the
// user sees today's recommendation immediately. Dismiss = mark this
// specific tip "read", banner re-renders with the next unread tip (or
// hides if none left).
(function(){
  var BANNER_CAT_ICON = { tip: '\u2728', suggestion: '\u{1F4A1}', idea: '\u{1F680}', warning: '\u26A0' };
  function el(id){ return document.getElementById(id); }
  var banner = el('aiTipBanner');
  if (!banner) return;

  function hideBanner(){
    banner.setAttribute('hidden','');
    banner.style.display = 'none';
  }
  function showBanner(){
    banner.removeAttribute('hidden');
    banner.style.display = 'flex';
  }

  function applyTip(tip, remaining){
    if (!tip){ hideBanner(); return; }
    var cat = String(tip.category || 'tip').toLowerCase();
    el('aiTipBannerIcon').innerHTML = BANNER_CAT_ICON[cat] || '\u2728';
    el('aiTipBannerCat').textContent = cat.charAt(0).toUpperCase() + cat.slice(1);
    el('aiTipBannerTitle').textContent = tip.title || '';
    el('aiTipBannerBody').textContent = tip.body || '';
    var more = remaining > 1 ? ('+' + (remaining - 1) + ' more tip' + (remaining > 2 ? 's' : '') + ' waiting') : '';
    el('aiTipBannerMore').textContent = more;
    var cta = el('aiTipBannerCta');
    if (tip.action_url && tip.action_label){
      cta.href = tip.action_url;
      cta.textContent = tip.action_label + ' \u2192';
      cta.style.display = 'inline-flex';
      cta.onclick = function(){ markReadAndRefresh(tip.id, false); };
    } else {
      cta.style.display = 'none';
      cta.onclick = null;
    }
    banner.dataset.tipId = tip.id;
    showBanner();
  }

  function loadBanner(){
    fetch('/notifications/api/ai-tips?ts=' + Date.now(), { credentials: 'same-origin' })
      .then(function(r){ return r.ok ? r.json() : { tips: [] }; })
      .then(function(data){
        var tips = (data && Array.isArray(data.tips)) ? data.tips : [];
        var unread = tips.filter(function(t){ return t.status === 'unread'; });
        applyTip(unread[0], unread.length);
      })
      .catch(function(){ hideBanner(); });
  }

  function markReadAndRefresh(id, reloadBanner){
    if (!id) return;
    fetch('/notifications/api/ai-tips/mark-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ id: id })
    }).then(function(){ if (reloadBanner) loadBanner(); }).catch(function(){});
  }

  // X = "close the whole banner". We:
  //   1. Hide the banner with a tiny fade.
  //   2. Mark the currently-shown tip as read on the server (best
  //      effort — the badge count and /notifications page stay
  //      accurate).
  //   3. Set bannerClosed=true and skip every subsequent loadBanner()
  //      call for the rest of this page lifetime. The /notifications
  //      page still has the full list — this only closes the banner
  //      surface on the dashboard.
  // The previous behavior advanced to the next tip, which is why the
  // banner could only be removed by exhausting every unread tip.
  var bannerClosed = false;

  function closeBannerForever(){
    bannerClosed = true;
    banner.style.opacity = '0';
    banner.style.transition = 'opacity .2s';
    setTimeout(function(){
      hideBanner();
      banner.style.opacity = '';
      banner.style.transition = '';
    }, 180);
  }

  var dismissBtn = el('aiTipBannerDismiss');
  if (dismissBtn){
    dismissBtn.addEventListener('click', function(){
      var id = banner.dataset.tipId;
      // Mark the displayed tip read so the unread badge updates, but
      // do NOT call loadBanner() afterwards — that's what made it
      // cycle.
      if (id) markReadAndRefresh(id, false);
      closeBannerForever();
    });
  }

  function loadBannerIfOpen(){
    if (bannerClosed) return;
    loadBanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadBannerIfOpen);
  } else {
    loadBannerIfOpen();
  }
  // Quietly refresh in case a tip was added in another tab, but only
  // while the banner is still open on this page.
  setInterval(loadBannerIfOpen, 300000);
})();
</script>
</body>
</html>`;
  res.send(html);
});

// ─── Phase 4: breakdown endpoints for the dashboard modals ───────────────────
// Friendly names that the modal renders directly.
const FEATURE_LABELS = {
  'smart-shorts':  'Smart Shorts',
  'ai-reframe':    'AI Reframe',
  'enhance-audio': 'Enhance Audio',
  'ai-captions':   'AI Captions',
  'ai-thumbnail':  'AI Thumbnails',
  'ai-hook':       'AI Hooks',
  'ai-broll': 'AI B-Roll'
};

router.get('/api/credits-breakdown', requireAuth, async (req, res) => {
  try {
    const usage = await creditOps.getOrResetUsage(req.user.id);
    const used = usage ? (usage.used || 0) : 0;
    const cap = capFor(req.user.plan);
    const rows = await creditOps.breakdownThisMonth(req.user.id);
    // Always include all 6 features (zero-fill the ones with no charges yet).
    const known = new Map(rows.map(r => [r.feature, r.credits]));
    const breakdown = Object.keys(FEATURE_LABELS).map(key => ({
      key,
      label: FEATURE_LABELS[key],
      credits: known.get(key) || 0
    }));
    res.json({ used, cap, remaining: Math.max(0, cap - used), breakdown });
  } catch (e) {
    console.error('credits-breakdown error:', e);
    res.status(500).json({ error: 'Failed to load credits breakdown' });
  }
});

router.get('/api/storage-breakdown', requireAuth, async (req, res) => {
  try {
    const su = await storageOps.getUsage(req.user.id);
    const usedBytes = su ? su.bytes : 0;
    const capBytes = storageCapBytes(req.user.plan);
    const rows = await storageOps.breakdownAllTime(req.user.id);
    const known = new Map(rows.map(r => [r.feature, r.bytes]));
    const breakdown = Object.keys(FEATURE_LABELS).map(key => ({
      key,
      label: FEATURE_LABELS[key],
      bytes: known.get(key) || 0,
      formatted: formatBytes(known.get(key) || 0)
    }));
    res.json({
      usedBytes,
      capBytes,
      usedFormatted: formatBytes(usedBytes),
      capFormatted: formatBytes(capBytes),
      remainingFormatted: formatBytes(Math.max(0, capBytes - usedBytes)),
      graceUntil: su && su.graceUntil ? su.graceUntil : null,
      breakdown
    });
  } catch (e) {
    console.error('storage-breakdown error:', e);
    res.status(500).json({ error: 'Failed to load storage breakdown' });
  }
});

// ─── Phase 5: Time Saved widget — endpoint ───────────────────────────────────
// Conservative per-feature minute estimates for a manual workflow.
// Sources: industry averages for transcription, video cutting, copywriting,
// audio cleanup. Numbers picked on the lower end so the metric stays defensible.
const TIME_SAVED_MIN = {
  'smart-shorts':  30,
  'ai-reframe':    15,
  'enhance-audio': 20,
  'ai-captions':   15,
  'ai-thumbnail':  10,
  'ai-hook':        5
};

// Tool URLs for the spotlight CTA.
const FEATURE_ROUTES = {
  'smart-shorts':  '/shorts',
  'ai-reframe':    '/ai-reframe',
  'enhance-audio': '/enhance-speech',
  'ai-captions':   '/ai-captions',
  'ai-thumbnail':  '/ai-thumbnail',
  'ai-hook':       '/ai-hook'
};

function pickEquivalent(minutes) {
  const h = minutes / 60;
  if (h < 1)   return 'about as long as a movie trailer';
  if (h < 3)   return 'about a feature-length film';
  if (h < 8)   return 'roughly a full work day';
  if (h < 20)  return 'a couple of work days';
  if (h < 40)  return 'a full work week';
  return 'more than a full work week';
}

function pickSpotlight(usageMap) {
  // Find the highest-value feature the user hasn't used this month.
  // Order by minutesPer descending so we recommend the biggest time-savers first.
  const ordered = Object.keys(TIME_SAVED_MIN)
    .sort((a, b) => TIME_SAVED_MIN[b] - TIME_SAVED_MIN[a]);
  for (const key of ordered) {
    if (!usageMap.has(key) || usageMap.get(key) === 0) {
      return {
        key,
        label: FEATURE_LABELS[key],
        minutes: TIME_SAVED_MIN[key],
        href: FEATURE_ROUTES[key],
        message: `You haven't used ${FEATURE_LABELS[key]} this month — could save you ~${TIME_SAVED_MIN[key]} min per use.`
      };
    }
  }
  // Everyone used everything — recommend the lowest-usage one.
  let leastKey = ordered[0], leastCount = Infinity;
  for (const key of ordered) {
    const c = usageMap.get(key) || 0;
    if (c < leastCount) { leastCount = c; leastKey = key; }
  }
  return {
    key: leastKey,
    label: FEATURE_LABELS[leastKey],
    minutes: TIME_SAVED_MIN[leastKey],
    href: FEATURE_ROUTES[leastKey],
    message: `${FEATURE_LABELS[leastKey]} is your least-used tool this month — try leaning on it more.`
  };
}

router.get('/api/time-saved', requireAuth, async (req, res) => {
  try {
    const { pool } = require('../db/database');
    // Use counts (rows), not credit sums — each transaction is one feature use.
    const thisMonthRows = (await pool.query(
      `SELECT feature_key, COUNT(*)::int AS uses
         FROM credit_transactions
        WHERE user_id = $1
          AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)
        GROUP BY feature_key`,
      [req.user.id]
    )).rows;

    const lastMonthRows = (await pool.query(
      `SELECT feature_key, COUNT(*)::int AS uses
         FROM credit_transactions
        WHERE user_id = $1
          AND created_at >= date_trunc('month', CURRENT_TIMESTAMP) - INTERVAL '1 month'
          AND created_at <  date_trunc('month', CURRENT_TIMESTAMP)
        GROUP BY feature_key`,
      [req.user.id]
    )).rows;

    const usageMap = new Map(thisMonthRows.map(r => [r.feature_key, r.uses]));
    let thisMonthMinutes = 0;
    const breakdown = Object.keys(FEATURE_LABELS).map(key => {
      const uses = usageMap.get(key) || 0;
      const per = TIME_SAVED_MIN[key] || 0;
      const total = uses * per;
      thisMonthMinutes += total;
      return { key, label: FEATURE_LABELS[key], uses, minutesPer: per, totalMinutes: total };
    });

    let lastMonthMinutes = 0;
    for (const r of lastMonthRows) {
      lastMonthMinutes += (r.uses || 0) * (TIME_SAVED_MIN[r.feature_key] || 0);
    }

    res.json({
      thisMonthMinutes,
      lastMonthMinutes,
      deltaMinutes: thisMonthMinutes - lastMonthMinutes,
      breakdown,
      equivalent: thisMonthMinutes > 0 ? pickEquivalent(thisMonthMinutes) : null,
      spotlight: pickSpotlight(usageMap)
    });
  } catch (e) {
    console.error('time-saved error:', e);
    res.status(500).json({ error: 'Failed to load time saved' });
  }
});

module.exports = router;
