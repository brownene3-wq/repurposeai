// services/aiTipGenerator.js
//
// Generates personalized AI tips/suggestions/ideas for a given user and
// inserts them into the ai_notifications table. Shown on:
//   - /notifications  (the "AI Tips" section, top of the page)
//   - /dashboard      (a dismissible banner with the top tip)
//
// Throttle: at most one batch of tips per user per 24h, even if the
// user hits /notifications repeatedly. This prevents OpenAI spend
// runaway and keeps the user inbox from filling with stale advice.
//
// Failure modes are silent — if anything goes wrong (no API key, OpenAI
// 5xx, malformed JSON), we fall back to a curated static-tip set so the
// Notifications page is never empty.
//
// Public surface:
//   ensureFreshTips(userId, opts)   -> Promise<{ generated, reason, batchId, count }>
//   generateAndPersist(userId, opts)-> Promise<{ batchId, rows }>
//   getStaticFallbackTips(ctx)      -> [{title, body, action_label, action_url, priority, category}]

const { v4: uuidv4 } = require('uuid');

let pool, aiNotificationOps;
try {
  const db = require('../db/database');
  pool = db.pool;
  aiNotificationOps = db.aiNotificationOps;
} catch (_) {}

let _OpenAI = null;
try { _OpenAI = require('openai').OpenAI || require('openai'); } catch (_) {}

const THROTTLE_HOURS = 24;
const MAX_TIPS_PER_BATCH = 5;

// Pull a small bundle of user context the LLM can personalize on.
// Best-effort — any individual query failure is caught and treated as
// "no data" so we still produce SOMETHING.
async function collectUserContext(userId) {
  const ctx = {
    userId,
    connections: [],          // [{platform, account_name}]
    recentPosts: 0,           // calendar_entries in last 7 days
    lastPostDate: null,
    libraryRenders: 0,        // total user_renders rows
    librarySinceDays: null,   // days since last render
    activeWorkflows: 0,
    aiCaptionsUsed: 0,
    accountAgeDays: 0,
    plan: 'free'
  };
  if (!pool) return ctx;

  const q = async (sql, args) => {
    try { const r = await pool.query(sql, args); return r.rows; }
    catch (_) { return []; }
  };

  // user row
  const userRows = await q(
    `SELECT plan, created_at FROM users WHERE id = $1`,
    [userId]
  );
  if (userRows[0]) {
    ctx.plan = userRows[0].plan || 'free';
    const created = new Date(userRows[0].created_at);
    ctx.accountAgeDays = Math.max(0, Math.round((Date.now() - created.getTime()) / 86400000));
  }

  // connected accounts
  const connRows = await q(
    `SELECT platform, account_name FROM connected_accounts
      WHERE user_id = $1 AND is_active = true
      ORDER BY created_at DESC`,
    [userId]
  );
  ctx.connections = connRows.map(r => ({
    platform: r.platform,
    name: r.account_name
  }));

  // recent calendar entries (proxy for "user is actively posting")
  const calRows = await q(
    `SELECT scheduled_date FROM calendar_entries
      WHERE user_id = $1
        AND scheduled_date >= CURRENT_DATE - INTERVAL '7 days'
      ORDER BY scheduled_date DESC`,
    [userId]
  );
  ctx.recentPosts = calRows.length;
  if (calRows.length) ctx.lastPostDate = calRows[0].scheduled_date;

  // library activity
  const renderRows = await q(
    `SELECT COUNT(*) AS c, MAX(created_at) AS last_at
       FROM user_renders
      WHERE user_id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  if (renderRows[0]) {
    ctx.libraryRenders = parseInt(renderRows[0].c, 10) || 0;
    if (renderRows[0].last_at) {
      ctx.librarySinceDays = Math.round(
        (Date.now() - new Date(renderRows[0].last_at).getTime()) / 86400000
      );
    }
  }

  // active workflows
  const wfRows = await q(
    `SELECT COUNT(*) AS c FROM workflows
      WHERE user_id = $1 AND is_active = true AND auto_publish = true`,
    [userId]
  );
  if (wfRows[0]) ctx.activeWorkflows = parseInt(wfRows[0].c, 10) || 0;

  // AI captions specifically (feature_usage row for ai-captions)
  const fuRows = await q(
    `SELECT COALESCE(SUM(units), 0) AS c FROM feature_usage
      WHERE user_id = $1 AND feature = 'ai-captions'`,
    [userId]
  );
  if (fuRows[0]) ctx.aiCaptionsUsed = parseInt(fuRows[0].c, 10) || 0;

  return ctx;
}

// Static fallback set. Used when OPENAI_API_KEY is missing or any
// generation step fails. Deliberately platform-agnostic + actionable.
function getStaticFallbackTips(ctx = {}) {
  const tips = [];
  const haveConn = Array.isArray(ctx.connections) && ctx.connections.length > 0;
  const platforms = haveConn ? ctx.connections.map(c => c.platform) : [];

  // Always-on starter tips, ordered for new vs returning users.
  if (!haveConn) {
    tips.push({
      category: 'suggestion',
      priority: 1,
      title: 'Connect your first social account',
      body: 'Splicora can auto-publish to TikTok, Instagram, YouTube, LinkedIn, Twitter, Facebook, Threads, and Pinterest. Hook one up to start cross-posting in seconds.',
      action_label: 'Connect an account',
      action_url: '/distribute/connections'
    });
  } else if (platforms.length === 1) {
    tips.push({
      category: 'idea',
      priority: 1,
      title: 'Double your reach by adding a second platform',
      body: 'You’re connected on one platform. Most creators see a 2-3x reach lift just from adding one more destination. Pinterest and Threads are quick wins for short-form content.',
      action_label: 'Add another platform',
      action_url: '/distribute/connections'
    });
  }

  if ((ctx.activeWorkflows || 0) === 0 && haveConn) {
    tips.push({
      category: 'tip',
      priority: 2,
      title: 'Turn on Auto-Publish workflows',
      body: 'You can post once and have Splicora cross-publish to every connected destination on a delay you choose. Go to Repurpose → Workflows to set one up.',
      action_label: 'Create a workflow',
      action_url: '/distribute'
    });
  }

  if ((ctx.recentPosts || 0) === 0) {
    tips.push({
      category: 'suggestion',
      priority: 2,
      title: 'Schedule your next post on the Calendar',
      body: 'You haven’t scheduled anything in the past week. Even one post per week keeps your audience warm — set up a draft now and let Splicora remind you.',
      action_label: 'Open Calendar',
      action_url: '/dashboard/calendar'
    });
  }

  if ((ctx.aiCaptionsUsed || 0) < 3) {
    tips.push({
      category: 'idea',
      priority: 3,
      title: 'Add burned-in captions to boost watch time',
      body: 'Captioned shorts get 40% more completed views on average. Drop a clip into AI Captions and pick a style — the whole thing takes about a minute.',
      action_label: 'Try AI Captions',
      action_url: '/ai-captions'
    });
  }

  if ((ctx.librarySinceDays != null && ctx.librarySinceDays > 14) ||
      (ctx.libraryRenders || 0) === 0) {
    tips.push({
      category: 'tip',
      priority: 3,
      title: 'Repurpose an old long-form video into shorts',
      body: 'Drop a podcast, webinar, or interview into Smart Shorts. The AI will pick the highest-engagement 30-60 second moments and you can publish them straight from the result page.',
      action_label: 'Start Smart Shorts',
      action_url: '/shorts'
    });
  }

  tips.push({
    category: 'tip',
    priority: 4,
    title: 'Post at your audience’s peak hour',
    body: 'On every Calendar entry there’s a “Suggest peak time” button — it picks a time when your target platform sees the most engagement for your niche.',
    action_label: 'Open Calendar',
    action_url: '/dashboard/calendar'
  });

  // Ensure we never return more than the cap.
  return tips.slice(0, MAX_TIPS_PER_BATCH);
}

function buildPrompt(ctx) {
  const conns = (ctx.connections || []).map(c => '- ' + c.platform + (c.name ? ' (' + c.name + ')' : '')).join('\n') || '- none yet';
  return [
    'You are an expert social media growth coach embedded inside Splicora, a SaaS that helps creators repurpose long-form video into short-form posts and cross-publish across social platforms.',
    '',
    'Generate 3 short, personalized tips for the user described below. Each tip must be specific (not generic), actionable today, and tailored to what they have/haven’t done. Mix categories so we don’t produce three of the same thing.',
    '',
    'Available action URLs you may use (use null if no good fit):',
    '  /distribute/connections  - Add or manage connected social accounts',
    '  /distribute              - Create auto-publish workflows',
    '  /shorts                  - Smart Shorts (long-form -> shorts)',
    '  /ai-captions             - Burn captions onto a clip',
    '  /ai-thumbnail            - AI thumbnails',
    '  /ai-hook                 - AI hook video',
    '  /ai-reframe              - Reframe to vertical/square',
    '  /ai-broll                - AI B-roll insertion',
    '  /repurpose               - Create page (turn idea -> post)',
    '  /repurpose/history       - Library (every render and post)',
    '  /dashboard/calendar      - Content calendar + scheduling',
    '  /distribute/analytics    - Analytics',
    '  /settings                - Brand Voice / Brand Templates settings',
    '',
    'User context:',
    '  plan: ' + (ctx.plan || 'free'),
    '  account age: ' + ctx.accountAgeDays + ' days',
    '  connected platforms (' + (ctx.connections || []).length + '):',
    conns,
    '  recent calendar entries (last 7d): ' + ctx.recentPosts,
    '  total library renders: ' + ctx.libraryRenders,
    '  days since last render: ' + (ctx.librarySinceDays == null ? 'never rendered' : ctx.librarySinceDays),
    '  active auto-publish workflows: ' + ctx.activeWorkflows,
    '  AI Captions clips made: ' + ctx.aiCaptionsUsed,
    '',
    'Return a JSON object with this exact shape and nothing else:',
    '{ "tips": [ { "category": "tip"|"suggestion"|"idea", "priority": 1|2|3|4|5, "title": "...", "body": "...", "action_label": "..."|null, "action_url": "..."|null } ] }',
    '',
    'Rules:',
    '- 3 tips total.',
    '- title under 80 characters, body 1–2 sentences (max ~240 chars).',
    '- priority 1 means most important right now.',
    '- action_url must be one of the listed paths or null.',
    '- Vary categories across the 3 tips when possible.',
    '- Don’t mention any other product or service by name.'
  ].join('\n');
}

async function callOpenAI(ctx) {
  if (!_OpenAI || !process.env.OPENAI_API_KEY) return null;
  try {
    const client = new _OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 700,
      temperature: 0.6,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You output strict JSON only. No prose.' },
        { role: 'user', content: buildPrompt(ctx) }
      ]
    });
    const raw = resp && resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
    if (!raw) return null;
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { return null; }
    const tips = parsed && Array.isArray(parsed.tips) ? parsed.tips : null;
    if (!tips || !tips.length) return null;
    return tips
      .filter(t => t && t.title && t.body)
      .slice(0, MAX_TIPS_PER_BATCH)
      .map(t => ({
        category: ['tip','suggestion','idea','warning'].includes(t.category) ? t.category : 'tip',
        priority: Math.max(1, Math.min(5, Number(t.priority) || 3)),
        title: String(t.title).slice(0, 200),
        body: String(t.body).slice(0, 1000),
        action_label: t.action_label ? String(t.action_label).slice(0, 80) : null,
        action_url: t.action_url ? String(t.action_url).slice(0, 500) : null
      }));
  } catch (e) {
    console.warn('[aiTipGenerator] OpenAI call failed:', e.message);
    return null;
  }
}

// Insert tips for a user, all sharing one batch_id. Returns the created
// rows.
async function generateAndPersist(userId, opts = {}) {
  if (!userId || !aiNotificationOps) return { batchId: null, rows: [] };
  const ctx = await collectUserContext(userId);
  let tips = await callOpenAI(ctx);
  let usedFallback = false;
  if (!tips || !tips.length) {
    tips = getStaticFallbackTips(ctx);
    usedFallback = true;
  }
  if (!tips.length) return { batchId: null, rows: [] };

  const batchId = uuidv4();
  const rows = await aiNotificationOps.createMany(userId, batchId, tips.map(t => ({
    category: t.category,
    title: t.title,
    body: t.body,
    actionLabel: t.action_label,
    actionUrl: t.action_url,
    priority: t.priority,
    source: usedFallback ? 'static' : 'ai',
    metadata: { generator: usedFallback ? 'static-fallback' : 'gpt-4o-mini', ctxPlatforms: (ctx.connections || []).map(c => c.platform) }
  })));
  console.log('[aiTipGenerator] user=' + userId + ' batch=' + batchId + ' tips=' + rows.length + ' fallback=' + usedFallback);
  return { batchId, rows };
}

// Public entry — only generates if the user hasn't received a batch in
// the last THROTTLE_HOURS. Always resolves quickly so it can be awaited
// in a route handler.
//   opts.force     -> ignore the throttle window
async function ensureFreshTips(userId, opts = {}) {
  if (!userId || !aiNotificationOps) {
    return { generated: false, reason: 'no-ops', batchId: null, count: 0 };
  }
  if (!opts.force) {
    const last = await aiNotificationOps.lastBatchAt(userId);
    if (last) {
      const ageMs = Date.now() - last.getTime();
      if (ageMs < THROTTLE_HOURS * 3600 * 1000) {
        return { generated: false, reason: 'throttled', batchId: null, count: 0 };
      }
    }
  }
  const { batchId, rows } = await generateAndPersist(userId, opts);
  return { generated: rows.length > 0, reason: rows.length ? 'ok' : 'no-tips', batchId, count: rows.length };
}

module.exports = {
  ensureFreshTips,
  generateAndPersist,
  collectUserContext,
  getStaticFallbackTips
};
