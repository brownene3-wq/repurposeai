const express = require('express');
const router = express.Router();
const { requireAuth, getPlanLimits, checkPlanLimit } = require('../middleware/auth');
const { contentOps, outputOps } = require('../db/database');

// GET /dashboard
router.get('/dashboard', requireAuth, (req, res) => {
  const user = req.user;
  const limits = getPlanLimits(user.plan);
  const contentItems = contentOps.findByUser(user.id, 20);
  const stats = outputOps.getStats(user.id);
  const contentCount = contentOps.countByUser(user.id);
  const recentOutputs = outputOps.findByUser(user.id, 10);

  res.send(renderDashboard(user, limits, contentItems, stats, contentCount, recentOutputs));
});

// POST /api/content/repurpose
router.post('/api/content/repurpose', requireAuth, checkPlanLimit, (req, res) => {
  try {
    const { title, sourceType, content: sourceContent, url, platforms } = req.body;

    if (!title || !sourceType) {
      return res.status(400).json({ error: 'Title and source type are required' });
    }

    const item = contentOps.create(req.user.id, title, sourceType, sourceContent, url);

    // Simulate AI repurposing with realistic outputs
    const selectedPlatforms = platforms || ['twitter', 'linkedin', 'instagram'];
    const outputs = [];

    const generators = {
      twitter: () => ({
        platform: 'twitter', format: 'Thread',
        content: generateTwitterThread(title, sourceContent)
      }),
      linkedin: () => ({
        platform: 'linkedin', format: 'Post',
        content: generateLinkedInPost(title, sourceContent)
      }),
      instagram: () => ({
        platform: 'instagram', format: 'Caption',
        content: generateInstagramCaption(title, sourceContent)
      }),
      email: () => ({
        platform: 'email', format: 'Newsletter',
        content: generateNewsletter(title, sourceContent)
      }),
      tiktok: () => ({
        platform: 'tiktok', format: 'Script',
        content: generateTikTokScript(title, sourceContent)
      }),
      blog: () => ({
        platform: 'blog', format: 'Summary Post',
        content: generateBlogSummary(title, sourceContent)
      })
    };

    for (const platform of selectedPlatforms) {
      if (generators[platform]) {
        const gen = generators[platform]();
        const output = outputOps.create(item.id, req.user.id, gen.platform, gen.format, gen.content);
        outputs.push(output);
      }
    }

    contentOps.updateStatus(item.id, 'completed');

    res.json({ success: true, contentItem: item, outputs });
  } catch (err) {
    console.error('Repurpose error:', err);
    res.status(500).json({ error: 'Failed to repurpose content' });
  }
});

// GET /api/content/:id
router.get('/api/content/:id', requireAuth, (req, res) => {
  const item = contentOps.findById(req.params.id);
  if (!item || item.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Content not found' });
  }
  const outputs = outputOps.findByContent(item.id);
  res.json({ contentItem: item, outputs });
});

// PUT /api/outputs/:id
router.put('/api/outputs/:id', requireAuth, (req, res) => {
  const { content, status } = req.body;
  if (content) outputOps.updateContent(req.params.id, req.user.id, content);
  if (status) outputOps.updateStatus(req.params.id, req.user.id, status);
  res.json({ success: true });
});

// DELETE /api/content/:id
router.delete('/api/content/:id', requireAuth, (req, res) => {
  contentOps.delete(req.params.id, req.user.id);
  res.json({ success: true });
});

// Content generators
function generateTwitterThread(title, content) {
  const topic = title || 'this topic';
  return `🧵 Thread: ${topic}

1/ Most people get content creation wrong. They create one piece and move on. Here's why that's leaving 90% of your reach on the table ↓

2/ The secret? Repurposing. One blog post can become 15+ pieces of content across different platforms.

3/ Here's the framework I use:
→ Extract 3-5 key insights
→ Match each to a platform format
→ Adapt the tone & hook
→ Schedule across the week

4/ The result? 10x content output with 0 extra research time.

5/ Want to try it yourself? Start with your best-performing piece from last month and break it into:
- 3 tweet-sized insights
- 1 LinkedIn story
- 1 carousel visual
- 1 email newsletter

The ROI is unreal. 🚀`;
}

function generateLinkedInPost(title, content) {
  const topic = title || 'content strategy';
  return `I spent 6 months testing every content repurposing strategy out there.

Here's what actually works (and what's a waste of time):

The biggest mistake I see creators make? Treating each platform as a completely separate content machine.

Instead, try the "Content Waterfall" method:

→ Start with one deep piece (blog, podcast, video)
→ Extract the core insights
→ Reshape for each platform's native format
→ Maintain your voice, adapt the delivery

The result? We went from publishing 3 pieces/week to 25+ — without hiring anyone new.

Three things I learned:
1. Hooks matter more than length
2. Each platform has its own "language"
3. Consistency beats perfection every time

What's your biggest challenge with content repurposing? Drop it in the comments — I'll share what worked for us.

#ContentStrategy #Marketing #CreatorEconomy #Repurposing`;
}

function generateInstagramCaption(title, content) {
  const topic = title || 'content creation';
  return `Stop creating content from scratch every single day. 🛑

Here's the framework that 10x'd our output:

1️⃣ Create ONE cornerstone piece per week
2️⃣ Break it into micro-content
3️⃣ Adapt format for each platform
4️⃣ Schedule and automate

The result? More content, less burnout, better engagement.

Save this for later ➡️ and share with a creator who needs this!

.
.
.
#contentcreation #contentmarketing #digitalmarketing #socialmediatips #creatoreconomy #marketingtips #contentrepurposing #growthhacking`;
}

function generateNewsletter(title, content) {
  const topic = title || 'Content Repurposing';
  return `Subject: The "Create Once, Publish Everywhere" Framework

Hey there,

Quick question: How many hours do you spend creating content each week?

If the answer is "too many," you're not alone. But here's the thing — the best creators aren't creating MORE content. They're creating SMARTER.

I want to share a framework that changed everything for us:

THE CONTENT WATERFALL METHOD
━━━━━━━━━━━━━━━━━━━━━━━━━

Step 1: Create one high-value piece (30-60 min)
Step 2: Extract 5-7 key insights (10 min)
Step 3: Transform into platform-native formats (15 min)
Step 4: Schedule across the week (5 min)

Total time: ~1 hour
Total output: 15-25 pieces of content

That's a 15x multiplier on your effort.

Here's what this looks like in practice:
• Blog post → Twitter thread + LinkedIn post + Instagram carousel
• Podcast episode → Audiogram + Quote cards + Newsletter
• YouTube video → Shorts + Reels + Blog summary

The key insight? Don't copy-paste. ADAPT. Each platform has its own language.

Want to try it yourself? Start with your best-performing piece from last month and run it through this framework.

Talk soon,
The RepurposeAI Team

P.S. Our AI does all of this automatically. Try it free at repurposeai.com`;
}

function generateTikTokScript(title, content) {
  return `🎬 TikTok Script: "${title || 'Content Repurposing Hack'}"

[HOOK - First 2 seconds]
"This one hack saves me 20 hours every week"

[SETUP - 3-5 seconds]
"I used to spend ALL day creating content for different platforms..."

[CONTENT - 15-20 seconds]
"Now I create ONE piece of content and turn it into 15+ posts automatically.

Here's how:
1. Write one blog post or record one video
2. Pull out the key points
3. Reshape for Twitter, LinkedIn, Instagram, TikTok
4. Schedule everything in advance

[CTA - 3 seconds]
"Follow for more creator hacks — link in bio for the free tool!"

---
📝 Notes:
- Use text overlay for the numbered list
- Fast-paced editing, trending audio
- Duration: ~30 seconds
- Add captions for accessibility`;
}

function generateBlogSummary(title, content) {
  return `# ${title || 'How to 10x Your Content Output Without Burning Out'}

**TL;DR:** Stop creating content from scratch for every platform. Use the Content Waterfall method to repurpose one cornerstone piece into 15+ platform-native assets.

## The Problem

Most creators and marketers spend 80% of their time creating content and 20% distributing it. The smartest ones flip that ratio.

## The Solution: Content Waterfall Method

1. **Create One Cornerstone Piece** — Invest your best thinking into one in-depth blog post, video, or podcast episode.

2. **Extract Key Insights** — Pull out 5-7 standalone ideas, quotes, or frameworks.

3. **Transform Into Native Formats** — Reshape each insight for its target platform: threads for X, stories for LinkedIn, carousels for Instagram, scripts for short-form video.

4. **Schedule & Automate** — Use a tool like RepurposeAI to handle the transformation and scheduling automatically.

## The Results

Teams using this framework report:
- 10-15x more content published per week
- 40% increase in engagement rates
- 20+ hours saved per week
- Consistent brand voice across platforms

## Getting Started

Pick your best-performing piece from last month and run it through these four steps. The results will speak for themselves.`;
}


function renderDashboard(user, limits, contentItems, stats, contentCount, recentOutputs) {
  const initials = user.name.split(' ').map(n => n[0]).join('').toUpperCase();
  const planBadge = { starter: 'Starter', pro: 'Pro', enterprise: 'Enterprise' }[user.plan];
  const planColor = { starter: '#6a6a8e', pro: '#7c3aed', enterprise: '#f59e0b' }[user.plan];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dashboard — RepurposeAI</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#06060f;--bg2:#0c0c1d;--bg3:#11112a;--bg4:#181842;--accent:#7c3aed;--accent2:#06b6d4;--accent3:#f472b6;--text:#f0f0ff;--text2:#a0a0c0;--text3:#6a6a8e;--border:rgba(124,58,237,0.15);--green:#34d399;--red:#f87171;--yellow:#f59e0b;--gradient:linear-gradient(135deg,#7c3aed,#06b6d4);--radius:16px;--radius-sm:10px}
body{font-family:'Inter',sans-serif;background:var(--bg);color:var(--text);line-height:1.6;min-height:100vh}
a{text-decoration:none;color:inherit}

/* Sidebar */
.layout{display:flex;min-height:100vh}
.sidebar{width:260px;background:var(--bg2);border-right:1px solid var(--border);padding:24px 16px;display:flex;flex-direction:column;position:fixed;top:0;bottom:0;left:0;z-index:100}
.sidebar__logo{font-size:1.3rem;font-weight:800;padding:0 8px 24px;background:var(--gradient);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.sidebar__logo span{font-weight:400;-webkit-text-fill-color:var(--text2)}
.sidebar__nav{display:flex;flex-direction:column;gap:4px;flex:1}
.sidebar__link{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:var(--radius-sm);font-size:0.9rem;font-weight:500;color:var(--text2);transition:all .2s;cursor:pointer}
.sidebar__link:hover{background:rgba(124,58,237,0.08);color:var(--text)}
.sidebar__link.active{background:rgba(124,58,237,0.12);color:var(--text);font-weight:600}
.sidebar__link .icon{width:20px;text-align:center;font-size:1rem}
.sidebar__divider{height:1px;background:var(--border);margin:12px 0}
.sidebar__plan{margin-top:auto;padding:16px;background:rgba(124,58,237,0.06);border:1px solid var(--border);border-radius:var(--radius-sm)}
.sidebar__plan-label{font-size:0.75rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px}
.sidebar__plan-name{font-size:1rem;font-weight:700;margin:4px 0}
.sidebar__plan-bar{height:4px;background:rgba(255,255,255,0.06);border-radius:2px;margin:8px 0}
.sidebar__plan-bar-fill{height:100%;border-radius:2px;background:var(--gradient);transition:width .3s}
.sidebar__plan-text{font-size:0.8rem;color:var(--text3)}
.sidebar__plan-upgrade{display:inline-block;margin-top:10px;font-size:0.8rem;color:var(--accent2);font-weight:600}

/* Main */
.main{flex:1;margin-left:260px;padding:32px 40px}
.main__header{display:flex;justify-content:space-between;align-items:center;margin-bottom:36px}
.main__greeting h1{font-size:1.6rem;font-weight:800;letter-spacing:-0.5px}
.main__greeting p{color:var(--text2);font-size:0.9rem;margin-top:2px}
.main__user{display:flex;align-items:center;gap:12px}
.main__avatar{width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.9rem;color:#fff}
.main__user-info{text-align:right}
.main__user-name{font-size:0.9rem;font-weight:600}
.main__user-plan{font-size:0.75rem;padding:2px 10px;border-radius:99px;font-weight:600}

/* Stats */
.stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;margin-bottom:36px}
.stat-card{background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:24px;transition:all .3s}
.stat-card:hover{border-color:rgba(124,58,237,0.3);transform:translateY(-2px)}
.stat-card__label{font-size:0.8rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
.stat-card__value{font-size:2rem;font-weight:800;letter-spacing:-1px}
.stat-card__value.purple{background:var(--gradient);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.stat-card__change{font-size:0.8rem;margin-top:4px;display:flex;align-items:center;gap:4px}
.stat-card__change.up{color:var(--green)} .stat-card__change.down{color:var(--red)}

/* Repurpose Modal */
.repurpose-section{background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:32px;margin-bottom:32px}
.repurpose-section h2{font-size:1.2rem;font-weight:700;margin-bottom:20px;display:flex;align-items:center;gap:10px}
.form-row{display:flex;gap:16px;margin-bottom:16px}
.form-col{flex:1;display:flex;flex-direction:column;gap:6px}
.form-col label{font-size:0.8rem;font-weight:600;color:var(--text2)}
.form-col input,.form-col textarea,.form-col select{width:100%;padding:12px 14px;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:0.9rem;font-family:inherit;outline:none;transition:all .3s;resize:vertical}
.form-col input:focus,.form-col textarea:focus,.form-col select:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(124,58,237,0.1)}
.form-col select option{background:var(--bg3)}

.platform-chips{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}
.platform-chip{padding:8px 16px;border-radius:99px;font-size:0.8rem;font-weight:600;border:1px solid var(--border);background:rgba(255,255,255,0.03);cursor:pointer;transition:all .2s;user-select:none}
.platform-chip.selected{background:rgba(124,58,237,0.15);border-color:var(--accent);color:var(--accent)}
.platform-chip:hover{border-color:rgba(124,58,237,0.4)}

.btn{display:inline-flex;align-items:center;gap:8px;padding:12px 28px;border-radius:99px;font-size:0.9rem;font-weight:600;border:none;cursor:pointer;transition:all .3s;font-family:inherit}
.btn--primary{background:var(--gradient);color:#fff;box-shadow:0 4px 20px rgba(124,58,237,0.4)}
.btn--primary:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(124,58,237,0.5)}
.btn--primary:disabled{opacity:0.5;cursor:not-allowed;transform:none}
.btn--outline{background:transparent;color:var(--text);border:1px solid var(--border)}
.btn--outline:hover{border-color:var(--accent);background:rgba(124,58,237,0.05)}
.btn--sm{padding:8px 18px;font-size:0.8rem}
.btn--danger{background:rgba(239,68,68,0.1);color:var(--red);border:1px solid rgba(239,68,68,0.2)}

/* Content History */
.history-section h2{font-size:1.2rem;font-weight:700;margin-bottom:20px}
.history-table{width:100%;border-collapse:collapse}
.history-table th{text-align:left;padding:12px 16px;font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;color:var(--text3);border-bottom:1px solid var(--border)}
.history-table td{padding:14px 16px;font-size:0.9rem;border-bottom:1px solid rgba(124,58,237,0.06)}
.history-table tr:hover td{background:rgba(124,58,237,0.03)}
.status{padding:4px 12px;border-radius:99px;font-size:0.75rem;font-weight:600}
.status--completed{background:rgba(52,211,153,0.12);color:var(--green)}
.status--processing{background:rgba(124,58,237,0.12);color:var(--accent)}
.status--draft{background:rgba(100,100,130,0.12);color:var(--text3)}

/* Output preview modal */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);z-index:1000;display:none;align-items:center;justify-content:center;padding:20px}
.modal-overlay.active{display:flex}
.modal{background:var(--bg3);border:1px solid var(--border);border-radius:20px;width:100%;max-width:700px;max-height:85vh;overflow-y:auto;padding:36px}
.modal__header{display:flex;justify-content:space-between;align-items:start;margin-bottom:24px}
.modal__title{font-size:1.2rem;font-weight:700}
.modal__close{width:36px;height:36px;border-radius:50%;border:1px solid var(--border);background:none;color:var(--text);font-size:1.2rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s}
.modal__close:hover{background:rgba(239,68,68,0.1);border-color:rgba(239,68,68,0.3);color:var(--red)}
.modal__content{background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:var(--radius-sm);padding:20px;white-space:pre-wrap;font-size:0.9rem;line-height:1.8;color:var(--text2);max-height:400px;overflow-y:auto}
.modal__actions{display:flex;gap:12px;margin-top:20px;justify-content:flex-end}
.modal__platform{display:inline-block;padding:4px 12px;border-radius:99px;font-size:0.75rem;font-weight:600;background:rgba(124,58,237,0.12);color:var(--accent);margin-bottom:12px}

.empty-state{text-align:center;padding:60px 20px;color:var(--text3)}
.empty-state__icon{font-size:3rem;margin-bottom:16px;opacity:0.4}
.empty-state__text{font-size:1rem;margin-bottom:8px;color:var(--text2)}
.empty-state__sub{font-size:0.85rem}

.toast{position:fixed;top:24px;right:24px;padding:14px 24px;border-radius:var(--radius-sm);font-size:0.9rem;font-weight:500;z-index:2000;transform:translateX(120%);transition:transform .4s cubic-bezier(0.16,1,0.3,1);max-width:360px}
.toast.visible{transform:translateX(0)}
.toast--success{background:rgba(52,211,153,0.15);border:1px solid rgba(52,211,153,0.3);color:var(--green)}
.toast--error{background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:var(--red)}

@media(max-width:968px){
  .sidebar{display:none}
  .main{margin-left:0}
  .stats-grid{grid-template-columns:repeat(2,1fr)}
  .form-row{flex-direction:column}
}
@media(max-width:600px){
  .stats-grid{grid-template-columns:1fr}
  .main{padding:20px 16px}
}
</style>
</head>
<body>
<div class="layout">
  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="sidebar__logo">Repurpose<span>AI</span></div>
    <nav class="sidebar__nav">
      <a class="sidebar__link active" href="/dashboard"><span class="icon">&#9776;</span> Dashboard</a>
      <a class="sidebar__link" href="#" onclick="document.getElementById('repurposeSection').scrollIntoView({behavior:'smooth'})"><span class="icon">&#9889;</span> New Repurpose</a>
      <a class="sidebar__link" href="#" onclick="document.getElementById('historySection').scrollIntoView({behavior:'smooth'})"><span class="icon">&#128196;</span> Content Library</a>
      <a class="sidebar__link" href="#"><span class="icon">&#128197;</span> Scheduler</a>
      <a class="sidebar__link" href="#"><span class="icon">&#128200;</span> Analytics</a>
      <div class="sidebar__divider"></div>
      <a class="sidebar__link" href="#"><span class="icon">&#9881;</span> Settings</a>
      <a class="sidebar__link" href="/contact"><span class="icon">&#128172;</span> Support</a>
      <a class="sidebar__link" href="/logout"><span class="icon">&#8594;</span> Log Out</a>
    </nav>
    <div class="sidebar__plan">
      <div class="sidebar__plan-label">Current Plan</div>
      <div class="sidebar__plan-name" style="color:${planColor}">${planBadge}</div>
      ${limits.repurposes !== Infinity ? `
      <div class="sidebar__plan-bar"><div class="sidebar__plan-bar-fill" style="width:${Math.min(100, (contentCount/limits.repurposes)*100)}%"></div></div>
      <div class="sidebar__plan-text">${contentCount} / ${limits.repurposes} repurposes used</div>` : `
      <div class="sidebar__plan-text" style="margin-top:8px">Unlimited repurposes</div>`}
      ${user.plan === 'starter' ? '<a href="/pricing" class="sidebar__plan-upgrade">Upgrade Plan &rarr;</a>' : ''}
    </div>
  </aside>

  <!-- Main Content -->
  <main class="main">
    <div class="main__header">
      <div class="main__greeting">
        <h1>Welcome back, ${user.name.split(' ')[0]}</h1>
        <p>Here's what's happening with your content</p>
      </div>
      <div class="main__user">
        <div class="main__user-info">
          <div class="main__user-name">${user.name}</div>
          <span class="main__user-plan" style="background:${planColor}22;color:${planColor}">${planBadge}</span>
        </div>
        <div class="main__avatar" style="background:${user.avatar_color}">${initials}</div>
      </div>
    </div>

    <!-- Stats -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-card__label">Total Outputs</div>
        <div class="stat-card__value purple">${stats.total}</div>
        <div class="stat-card__change up">&#9650; Content generated</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">Published</div>
        <div class="stat-card__value">${stats.published}</div>
        <div class="stat-card__change up">&#9650; Live pieces</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">Drafts</div>
        <div class="stat-card__value">${stats.drafts}</div>
        <div class="stat-card__change">Ready to publish</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">Sources</div>
        <div class="stat-card__value">${contentCount}</div>
        <div class="stat-card__change">Content items</div>
      </div>
    </div>

    <!-- Repurpose Section -->
    <div class="repurpose-section" id="repurposeSection">
      <h2>&#9889; Repurpose New Content</h2>
      <form id="repurposeForm" onsubmit="handleRepurpose(event)">
        <div class="form-row">
          <div class="form-col">
            <label>Content Title</label>
            <input type="text" name="title" placeholder="e.g. My Latest Blog Post About AI Trends" required>
          </div>
          <div class="form-col" style="max-width:200px">
            <label>Source Type</label>
            <select name="sourceType">
              <option value="blog">Blog Post</option>
              <option value="video">Video / YouTube</option>
              <option value="podcast">Podcast</option>
              <option value="article">Article</option>
              <option value="transcript">Transcript</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-col">
            <label>Source URL (optional)</label>
            <input type="url" name="url" placeholder="https://yourblog.com/post-title">
          </div>
        </div>
        <div class="form-row">
          <div class="form-col">
            <label>Source Content (paste your content)</label>
            <textarea name="content" rows="5" placeholder="Paste your blog post, transcript, or content here..."></textarea>
          </div>
        </div>
        <div>
          <label style="font-size:0.8rem;font-weight:600;color:var(--text2)">Target Platforms</label>
          <div class="platform-chips" id="platformChips">
            <span class="platform-chip selected" data-platform="twitter">&#120143; X / Twitter</span>
            <span class="platform-chip selected" data-platform="linkedin">&#128188; LinkedIn</span>
            <span class="platform-chip selected" data-platform="instagram">&#128247; Instagram</span>
            <span class="platform-chip" data-platform="email">&#9993; Email</span>
            <span class="platform-chip" data-platform="tiktok">&#127916; TikTok</span>
            <span class="platform-chip" data-platform="blog">&#128221; Blog Summary</span>
          </div>
        </div>
        <div style="display:flex;gap:12px;margin-top:8px">
          <button type="submit" class="btn btn--primary" id="repurposeBtn">&#9889; Generate Content</button>
        </div>
      </form>
    </div>

    <!-- Content History -->
    <div class="history-section" id="historySection">
      <h2>Content Library</h2>
      ${contentItems.length > 0 ? `
      <table class="history-table">
        <thead>
          <tr><th>Title</th><th>Type</th><th>Status</th><th>Outputs</th><th>Created</th><th></th></tr>
        </thead>
        <tbody>
          ${contentItems.map(item => {
            const itemOutputs = outputOps.findByContent(item.id);
            return `<tr>
              <td style="font-weight:600">${item.title}</td>
              <td style="text-transform:capitalize">${item.source_type}</td>
              <td><span class="status status--${item.status}">${item.status}</span></td>
              <td>${itemOutputs.length} pieces</td>
              <td style="color:var(--text3);font-size:0.85rem">${new Date(item.created_at).toLocaleDateString()}</td>
              <td>
                <button class="btn btn--outline btn--sm" onclick="viewOutputs('${item.id}')">View</button>
                <button class="btn btn--danger btn--sm" onclick="deleteContent('${item.id}')" style="margin-left:4px">&#128465;</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>` : `
      <div class="empty-state">
        <div class="empty-state__icon">&#128196;</div>
        <p class="empty-state__text">No content yet</p>
        <p class="empty-state__sub">Create your first repurpose above to get started!</p>
      </div>`}
    </div>
  </main>
</div>

<!-- Output Modal -->
<div class="modal-overlay" id="outputModal">
  <div class="modal">
    <div class="modal__header">
      <h3 class="modal__title" id="modalTitle">Generated Outputs</h3>
      <button class="modal__close" onclick="closeModal()">&times;</button>
    </div>
    <div id="modalBody"></div>
  </div>
</div>

<!-- Toast -->
<div class="toast" id="toast"></div>

<script>
// Platform chip selection
document.querySelectorAll('.platform-chip').forEach(chip => {
  chip.addEventListener('click', () => chip.classList.toggle('selected'));
});

// Toast
function showToast(message, type='success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast toast--' + type + ' visible';
  setTimeout(() => toast.classList.remove('visible'), 3000);
}

// Repurpose form
async function handleRepurpose(e) {
  e.preventDefault();
  const btn = document.getElementById('repurposeBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Generating...';

  const form = document.getElementById('repurposeForm');
  const formData = new FormData(form);
  const platforms = [...document.querySelectorAll('.platform-chip.selected')].map(c => c.dataset.platform);

  try {
    const res = await fetch('/api/content/repurpose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: formData.get('title'),
        sourceType: formData.get('sourceType'),
        content: formData.get('content'),
        url: formData.get('url'),
        platforms
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');

    showToast('Content repurposed successfully! ' + data.outputs.length + ' outputs generated.');
    setTimeout(() => window.location.reload(), 1000);
  } catch (err) {
    showToast(err.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '&#9889; Generate Content';
  }
}

// View outputs
async function viewOutputs(contentId) {
  try {
    const res = await fetch('/api/content/' + contentId);
    const data = await res.json();
    const modal = document.getElementById('outputModal');
    const body = document.getElementById('modalBody');
    const title = document.getElementById('modalTitle');

    title.textContent = data.contentItem.title + ' — Outputs';

    if (data.outputs.length === 0) {
      body.innerHTML = '<div class="empty-state"><p>No outputs generated yet.</p></div>';
    } else {
      body.innerHTML = data.outputs.map(out => \`
        <div style="margin-bottom:20px">
          <span class="modal__platform">\${out.platform} — \${out.format}</span>
          <span class="status status--\${out.status}" style="margin-left:8px">\${out.status}</span>
          <div class="modal__content">\${out.content}</div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn btn--outline btn--sm" onclick="copyToClipboard(this)" data-content="\${encodeURIComponent(out.content)}">&#128203; Copy</button>
            <button class="btn btn--outline btn--sm" onclick="markPublished('\${out.id}',this)">&#10003; Mark Published</button>
          </div>
        </div>
      \`).join('');
    }

    modal.classList.add('active');
  } catch (err) {
    showToast('Failed to load outputs', 'error');
  }
}

function closeModal() {
  document.getElementById('outputModal').classList.remove('active');
}
document.getElementById('outputModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});

function copyToClipboard(btn) {
  const text = decodeURIComponent(btn.dataset.content);
  navigator.clipboard.writeText(text).then(() => {
    btn.innerHTML = '&#10003; Copied!';
    setTimeout(() => btn.innerHTML = '&#128203; Copy', 2000);
  });
}

async function markPublished(id, btn) {
  await fetch('/api/outputs/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'published' })
  });
  btn.innerHTML = '&#10003; Published!';
  btn.disabled = true;
  showToast('Marked as published');
}

async function deleteContent(id) {
  if (!confirm('Delete this content and all its outputs?')) return;
  await fetch('/api/content/' + id, { method: 'DELETE' });
  showToast('Content deleted');
  setTimeout(() => window.location.reload(), 800);
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
</script>
</body>
</html>`;
}

module.exports = router;
