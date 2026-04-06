const express = require('express');
const router = express.Router();
const { optionalAuth } = require('../middleware/auth');
let blogOps;
try { blogOps = require('../db/database').blogOps; } catch(e) { blogOps = null; }

const BRAND = { name: 'Splicora' };

// Shared page shell (matches contact page styling)
function pageShell(title, user, content) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#x26A1;</text></svg>">
<title>${title} â ${BRAND.name}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#06060f;--bg2:#0c0c1d;--bg3:#11112a;--accent:#7c3aed;--accent2:#EC4899;--accent3:#f472b6;--text:#f0f0ff;--text2:#a0a0c0;--text3:#6a6a8e;--border:rgba(124,58,237,0.15);--gradient:linear-gradient(135deg,#7c3aed,#EC4899)}
body{font-family:'Inter',sans-serif;background:var(--bg);color:var(--text);line-height:1.7}
.bg-orb{position:fixed;border-radius:50%;filter:blur(120px);opacity:.3;pointer-events:none;animation:f 20s ease-in-out infinite}
.bg-orb--1{width:500px;height:500px;background:#7c3aed;top:-150px;right:-100px}
.bg-orb--2{width:400px;height:400px;background:#EC4899;bottom:-100px;left:-100px;animation-delay:-7s}
@keyframes f{0%,100%{transform:translate(0,0)}50%{transform:translate(20px,-20px)}}
nav{position:fixed;top:0;left:0;right:0;z-index:100;padding:16px 0;background:rgba(6,6,15,.85);backdrop-filter:blur(20px);border-bottom:1px solid var(--border)}
.nav-inner{max-width:1200px;margin:0 auto;padding:0 24px;display:flex;justify-content:space-between;align-items:center}
.logo{font-size:1.4rem;font-weight:800;background:var(--gradient);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.logo span{font-weight:400;-webkit-text-fill-color:var(--text2)}
.nav-links{display:flex;gap:24px;align-items:center}
.nav-links a{font-size:.9rem;color:var(--text2);text-decoration:none;transition:color .3s}
.nav-links a:hover{color:var(--text)}
.container{max-width:900px;margin:0 auto;padding:0 24px}

.page-content{padding:140px 0 80px;position:relative;z-index:1}
.page-content h1{font-size:clamp(2rem,4vw,2.8rem);font-weight:800;letter-spacing:-1px;margin-bottom:16px;background:var(--gradient);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.page-content h2{font-size:1.4rem;font-weight:700;margin:2rem 0 1rem;color:var(--text)}
.page-content h3{font-size:1.1rem;font-weight:600;margin:1.5rem 0 .75rem;color:var(--text)}
.page-content p{color:var(--text2);font-size:1rem;line-height:1.8;margin-bottom:1rem}
.page-content ul{color:var(--text2);font-size:1rem;line-height:1.8;margin-bottom:1rem;padding-left:1.5rem}
.page-content li{margin-bottom:.5rem}
.page-content a{color:var(--accent2);text-decoration:none;transition:color .3s}
.page-content a:hover{color:var(--accent)}
.page-content .subtitle{color:var(--text2);font-size:1.05rem;line-height:1.8;margin-bottom:2rem}

.card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px;margin:2rem 0}
.card{padding:28px;background:var(--bg3);border:1px solid var(--border);border-radius:16px;transition:all .3s}
.card:hover{border-color:rgba(124,58,237,.3);transform:translateY(-2px)}
.card h3{margin-top:0;font-size:1.1rem}
.card p{font-size:.95rem;margin-bottom:0}
.card .icon{font-size:2rem;margin-bottom:12px}

.blog-card{padding:28px;background:var(--bg3);border:1px solid var(--border);border-radius:16px;margin-bottom:20px;transition:all .3s}
.blog-card:hover{border-color:rgba(124,58,237,.3);transform:translateY(-2px)}
.blog-card .tag{display:inline-block;background:rgba(124,58,237,.15);color:var(--accent);font-size:.75rem;font-weight:600;padding:4px 10px;border-radius:20px;margin-bottom:10px}
.blog-card h3{font-size:1.15rem;margin:0 0 8px}
.blog-card p{font-size:.92rem;margin-bottom:8px}
.blog-card .meta{font-size:.8rem;color:var(--text3)}

.legal-section{background:var(--bg3);border:1px solid var(--border);border-radius:20px;padding:40px;margin-top:2rem}
.legal-section h2{margin-top:1.5rem}
.legal-section h2:first-child{margin-top:0}

.cta-box{margin-top:3rem;padding:40px;background:var(--bg3);border:1px solid var(--border);border-radius:20px;text-align:center}
.cta-box h2{font-size:1.3rem;margin-bottom:8px;-webkit-text-fill-color:var(--text)}
.cta-box p{margin-bottom:20px}
.btn-cta{display:inline-block;padding:14px 32px;border-radius:99px;background:var(--gradient);color:#fff;font-size:1rem;font-weight:700;text-decoration:none;transition:all .3s;box-shadow:0 4px 20px rgba(124,58,237,.4)}
.btn-cta:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(124,58,237,.5);color:#fff}

@media(max-width:768px){.card-grid{grid-template-columns:1fr}}
</style></head><body>
<div class="bg-orb bg-orb--1"></div><div class="bg-orb bg-orb--2"></div>
<nav><div class="nav-inner">
  <a href="/" class="logo">Splicora</a>
  <div class="nav-links">
    <a href="/">Home</a>
    <a href="/pricing">Pricing</a>
    <a href="/contact">Contact</a>
    ${user ? '<a href="/dashboard" style="padding:10px 24px;border-radius:99px;background:linear-gradient(135deg,#7c3aed,#EC4899);color:#fff;font-weight:600;font-size:.85rem">Dashboard</a>' : '<a href="/auth/login" style="color:var(--accent2);font-weight:600">Log In</a>'}
  </div>
</div></nav>

<section class="page-content"><div class="container">
${content}
</div></section>
</body></html>`;
}

// ======== ABOUT PAGE ========
router.get('/about', optionalAuth, (req, res) => {
  res.send(pageShell('About', req.user, `
  <h1>About Splicora</h1>
  <p class="subtitle">We're on a mission to help creators do more with less. One video, unlimited content â powered by AI.</p>

  <div class="card-grid">
    <div class="card">
      <div class="icon">&#x1F3AF;</div>
      <h3>Our Mission</h3>
      <p>Content creation shouldn't mean spending hours reformatting the same ideas for every platform. We built Splicora to let creators focus on what they do best â creating â while AI handles the rest.</p>
    </div>
    <div class="card">
      <div class="icon">&#x26A1;</div>
      <h3>What We Do</h3>
      <p>Splicora takes a single YouTube video and transforms it into platform-optimized content for Twitter/X, LinkedIn, Instagram, Facebook, TikTok, and more â in seconds, not hours.</p>
    </div>
    <div class="card">
      <div class="icon">&#x1F680;</div>
      <h3>Our Vision</h3>
      <p>We envision a world where every creator, from solo YouTubers to enterprise marketing teams, can maximize their reach without multiplying their workload.</p>
    </div>
  </div>

  <h2>Why Creators Choose Us</h2>
  <p>Thousands of content creators, marketers, and businesses trust Splicora to save time, stay consistent, and grow their audience across platforms. Our AI understands tone, context, and platform best practices â so every piece of content feels native, not copy-pasted.</p>

  <div class="card-grid">
    <div class="card">
      <div class="icon">&#x1F551;</div>
      <h3>Save 10+ Hours/Week</h3>
      <p>Stop manually rewriting content for each platform. Let AI handle the heavy lifting.</p>
    </div>
    <div class="card">
      <div class="icon">&#x1F399;</div>
      <h3>Brand Voice AI</h3>
      <p>Our AI learns your unique voice and style, ensuring every post sounds authentically you.</p>
    </div>
    <div class="card">
      <div class="icon">&#x2702;&#xFE0F;</div>
      <h3>Smart Shorts</h3>
      <p>Automatically extract the most engaging moments from your videos as short-form clips.</p>
    </div>
  </div>

  <div class="cta-box">
    <h2>Ready to supercharge your content?</h2>
    <p>Join thousands of creators who save hours every week with AI-powered content repurposing.</p>
    <a href="/auth/register" class="btn-cta">Get Started Free &#x2192;</a>
  </div>
`));
});

// ======== BLOG PAGE (dynamic from DB) ========
router.get('/blog', optionalAuth, async (req, res) => {
  let posts = [];
  try { if (blogOps) posts = await blogOps.getPublished(20, 0); } catch(e) { /* fallback to empty */ }

  const postCards = posts.length > 0
    ? posts.map(p => {
        const date = p.published_at ? new Date(p.published_at).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' }) : '';
        return `<a href="/blog/${p.slug}" class="blog-card" style="display:block;text-decoration:none;color:inherit">
          <span class="tag">${p.tag || 'General'}</span>
          <h3>${p.title}</h3>
          <p>${p.excerpt || ''}</p>
          <div class="meta">${date}${p.author_name ? ' &middot; ' + p.author_name : ''}</div>
        </a>`;
      }).join('')
    : `<div style="text-align:center;padding:3rem 0;color:var(--text2)">
        <div style="font-size:2.5rem;margin-bottom:1rem">&#x270D;&#xFE0F;</div>
        <p>Blog posts coming soon! Check back later for tips, strategies, and product updates.</p>
      </div>`;

  res.send(pageShell('Blog', req.user, `
  <h1>Blog</h1>
  <p class="subtitle">Tips, strategies, and insights to help you create better content and grow your audience.</p>
  ${postCards}
  <div class="cta-box">
    <h2>Never miss an update</h2>
    <p>Follow us for the latest tips and product updates to level up your content game.</p>
    <a href="/auth/register" class="btn-cta">Join Splicora &#x2192;</a>
  </div>
`));
});

// ======== INDIVIDUAL BLOG POST PAGE ========
router.get('/blog/:slug', optionalAuth, async (req, res) => {
  try {
    if (!blogOps) return res.status(404).send('Not found');
    const post = await blogOps.getBySlug(req.params.slug);
    if (!post) return res.redirect('/blog');
    const date = post.published_at ? new Date(post.published_at).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' }) : '';
    res.send(pageShell(post.title, req.user, `
      <div style="margin-bottom:1.5rem">
        <a href="/blog" style="color:var(--accent2);text-decoration:none;font-size:.9rem">&larr; Back to Blog</a>
      </div>
      ${post.cover_image ? '<img src="' + post.cover_image + '" alt="" style="width:100%;border-radius:16px;margin-bottom:2rem;max-height:400px;object-fit:cover">' : ''}
      <span class="tag" style="display:inline-block;background:rgba(124,58,237,0.15);color:#7c3aed;font-size:.75rem;font-weight:600;padding:4px 10px;border-radius:20px;margin-bottom:1rem">${post.tag || 'General'}</span>
      <h1>${post.title}</h1>
      <div style="color:var(--text3);font-size:.85rem;margin-bottom:2rem">${date}${post.author_name ? ' &middot; ' + post.author_name : ''}</div>
      <div class="blog-body" style="color:var(--text2);line-height:1.9;font-size:1.02rem">${post.content}</div>
      <div class="cta-box" style="margin-top:3rem">
        <h2>Enjoyed this post?</h2>
        <p>Try Splicora free and turn your videos into content for every platform.</p>
        <a href="/auth/register" class="btn-cta">Get Started Free &#x2192;</a>
      </div>
    `));
  } catch(e) {
    console.error('Blog post error:', e);
    res.redirect('/blog');
  }
});

// ======== CAREERS PAGE ========
router.get('/careers', optionalAuth, (req, res) => {
  res.send(pageShell('Careers', req.user, `
  <h1>Careers at Splicora</h1>
  <p class="subtitle">We're building the future of content creation. Come help us empower creators worldwide.</p>

  <div class="card-grid">
    <div class="card">
      <div class="icon">&#x1F30D;</div>
      <h3>Remote First</h3>
      <p>Work from anywhere in the world. We believe great talent isn't limited by geography.</p>
    </div>
    <div class="card">
      <div class="icon">&#x1F4AA;</div>
      <h3>Small Team, Big Impact</h3>
      <p>Every person on our team makes a meaningful difference. No bureaucracy, just building.</p>
    </div>
    <div class="card">
      <div class="icon">&#x1F31F;</div>
      <h3>Competitive Benefits</h3>
      <p>Competitive salary, equity, unlimited PTO, health benefits, and a $1,000 home office stipend.</p>
    </div>
  </div>

  <h2>Open Positions</h2>
  <p>We're always looking for talented people who are passionate about AI, content, and building great products. We don't have open roles right now, but we'd love to hear from you.</p>

  <div class="cta-box">
    <h2>Don't see a role that fits?</h2>
    <p>We're always interested in hearing from exceptional people. Send us a message and tell us how you'd contribute.</p>
    <a href="/contact" class="btn-cta">Get In Touch &#x2192;</a>
  </div>
`));
});

// ======== PRIVACY POLICY PAGE ========
router.get('/privacy', optionalAuth, (req, res) => {
  res.send(pageShell('Privacy Policy', req.user, `
  <h1>Privacy Policy</h1>
  <p class="subtitle">Last updated: January 1, 2025</p>

  <div class="legal-section">
    <h2>1. Information We Collect</h2>
    <p>We collect information you provide directly to us, such as when you create an account, use our services, or contact us for support. This includes your name, email address, and usage data related to content repurposing activities.</p>

    <h2>2. How We Use Your Information</h2>
    <p>We use the information we collect to provide, maintain, and improve our services, process transactions, send you technical notices and support messages, and respond to your comments and questions.</p>

    <h2>3. Information Sharing</h2>
    <p>We do not sell, trade, or rent your personal information to third parties. We may share information with service providers who assist us in operating our platform, conducting our business, or servicing you, so long as those parties agree to keep this information confidential.</p>

    <h2>4. Data Security</h2>
    <p>We implement appropriate technical and organizational security measures to protect your personal data against unauthorized access, alteration, disclosure, or destruction. All data is encrypted in transit and at rest.</p>

    <h2>5. Your Content</h2>
    <p>Content you process through Splicora (such as video URLs and generated text) is used solely to provide the service to you. We do not use your content to train AI models or share it with third parties without your consent.</p>

    <h2>6. Cookies</h2>
    <p>We use cookies and similar tracking technologies to track activity on our service and hold certain information. You can instruct your browser to refuse all cookies or to indicate when a cookie is being sent. See our Cookie Policy for more details.</p>

    <h2>7. Data Retention</h2>
    <p>We retain your personal data only for as long as necessary to fulfill the purposes for which it was collected, including to satisfy any legal, accounting, or reporting requirements.</p>

    <h2>8. Your Rights</h2>
    <p>You have the right to access, update, or delete your personal information at any time. You may also request a copy of the data we hold about you. To exercise these rights, please contact us at support@splicora.ai.</p>

    <h2>9. Changes to This Policy</h2>
    <p>We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new policy on this page and updating the "Last updated" date.</p>

    <h2>10. Contact Us</h2>
    <p>If you have any questions about this Privacy Policy, please contact us at <a href="/contact">our contact page</a> or email support@splicora.ai.</p>
  </div>
`));
});

// ======== TERMS OF SERVICE PAGE ========
router.get('/terms', optionalAuth, (req, res) => {
  res.send(pageShell('Terms of Service', req.user, `
  <h1>Terms of Service</h1>
  <p class="subtitle">Last updated: January 1, 2025</p>

  <div class="legal-section">
    <h2>1. Acceptance of Terms</h2>
    <p>By accessing or using Splicora, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our services.</p>

    <h2>2. Description of Service</h2>
    <p>Splicora is an AI-powered platform that helps users transform video content into text-based content optimized for various social media platforms. The service includes content generation, smart video clip extraction, analytics, and scheduling features.</p>

    <h2>3. User Accounts</h2>
    <p>You are responsible for safeguarding the password you use to access the service and for any activities or actions under your account. You must notify us immediately upon becoming aware of any breach of security or unauthorized use of your account.</p>

    <h2>4. Acceptable Use</h2>
    <p>You agree not to use Splicora to generate content that is illegal, harmful, threatening, abusive, harassing, defamatory, or otherwise objectionable. You must not use the service to infringe upon the intellectual property rights of others.</p>

    <h2>5. Content Ownership</h2>
    <p>You retain all rights to the content you input into and generate through Splicora. We do not claim ownership over your content. By using our service, you grant us a limited license to process your content solely for the purpose of providing the service.</p>

    <h2>6. Subscription and Billing</h2>
    <p>Some features of Splicora require a paid subscription. Subscription fees are billed in advance on a monthly or annual basis. You may cancel your subscription at any time, and cancellation will take effect at the end of the current billing period.</p>

    <h2>7. Limitation of Liability</h2>
    <p>Splicora is provided "as is" without warranties of any kind, either express or implied. In no event shall Splicora be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use of or inability to use the service.</p>

    <h2>8. Modifications to Service</h2>
    <p>We reserve the right to modify or discontinue, temporarily or permanently, the service with or without notice. We shall not be liable to you or any third party for any modification, suspension, or discontinuance of the service.</p>

    <h2>9. Governing Law</h2>
    <p>These Terms shall be governed by and construed in accordance with the laws of the United States, without regard to its conflict of law provisions.</p>

    <h2>10. Contact</h2>
    <p>If you have any questions about these Terms, please contact us at <a href="/contact">our contact page</a> or email support@splicora.ai.</p>
  </div>
`));
});

// ======== COOKIE POLICY PAGE ========
router.get('/cookies', optionalAuth, (req, res) => {
  res.send(pageShell('Cookie Policy', req.user, `
  <h1>Cookie Policy</h1>
  <p class="subtitle">Last updated: January 1, 2025</p>

  <div class="legal-section">
    <h2>1. What Are Cookies</h2>
    <p>Cookies are small text files that are placed on your device when you visit a website. They are widely used to make websites work more efficiently and to provide information to the owners of the site.</p>

    <h2>2. How We Use Cookies</h2>
    <p>Splicora uses cookies for the following purposes:</p>
    <ul>
      <li><strong>Essential Cookies:</strong> These are necessary for the website to function properly. They enable core functionality such as security, account authentication, and session management.</li>
      <li><strong>Preference Cookies:</strong> These remember your settings and preferences, such as your chosen theme (light/dark mode) and language preferences.</li>
      <li><strong>Analytics Cookies:</strong> These help us understand how visitors interact with our website by collecting and reporting information anonymously.</li>
    </ul>

    <h2>3. Cookies We Use</h2>
    <p>Here are the main cookies used on our platform:</p>
    <ul>
      <li><strong>Session Cookie:</strong> Keeps you logged in during your visit. Expires when you close your browser or after your session ends.</li>
      <li><strong>Theme Preference:</strong> Stores your light/dark mode preference locally. Does not expire.</li>
      <li><strong>Authentication Token:</strong> Securely identifies your account. Expires after 30 days.</li>
    </ul>

    <h2>4. Third-Party Cookies</h2>
    <p>We minimize the use of third-party cookies. Any third-party services we integrate with (such as payment processors) may set their own cookies, which are governed by their respective privacy policies.</p>

    <h2>5. Managing Cookies</h2>
    <p>Most web browsers allow you to control cookies through their settings. You can set your browser to refuse cookies or to alert you when cookies are being sent. However, disabling cookies may affect the functionality of our service.</p>

    <h2>6. Changes to This Policy</h2>
    <p>We may update this Cookie Policy from time to time. Any changes will be posted on this page with an updated revision date.</p>

    <h2>7. Contact Us</h2>
    <p>If you have questions about our use of cookies, please contact us at <a href="/contact">our contact page</a> or email support@splicora.ai.</p>
  </div>
`));
});

// ======== HELP CENTER ========
const helpArticles = [
  {
    id: 'getting-started',
    icon: '🚀',
    category: 'Getting Started',
    title: 'Getting Started with Splicora',
    summary: 'Learn how to sign up, navigate the dashboard, and create content from your first video.',
    content: `
      <h2>Creating Your Account</h2>
      <p>Visit <a href="/auth/register">splicora.ai/register</a> and sign up using Google OAuth (one-click) or create an account with your email and password. Once registered, you'll land on your Dashboard.</p>

      <h2>Navigating the Dashboard</h2>
      <p>Your Dashboard is the central hub. You'll see an <strong>AI Tools grid</strong> with quick access to every feature: Create, Smart Shorts, AI Hooks, AI Reframe, Caption Presets, Speech Enhance, Video Editor, Brand Voice, Analytics, and Calendar. The sidebar also has links to all major sections.</p>

      <h2>Repurposing Your First Video</h2>
      <p>Go to the <strong>Create</strong> page, paste any YouTube video URL, select the platforms you want content for (Instagram, TikTok, Twitter/X, LinkedIn, Facebook, YouTube, Blog), choose a tone, and click <strong>Create Now</strong>. Content is generated in seconds — just copy and post!</p>

      <h2>Tips</h2>
      <p>Make sure your YouTube video has captions/subtitles enabled for best results. Longer videos give the AI more material to work with. Try creating a Brand Voice first to keep your content consistent.</p>
    `
  },
  {
    id: 'create',
    icon: '🔄',
    category: 'Core Features',
    title: 'How to Create Content from a YouTube Video',
    summary: 'Turn any YouTube video into optimized social media posts for 7+ platforms.',
    content: `
      <h2>Step 1: Paste Your Link</h2>
      <p>Go to the <strong>Create</strong> page from the sidebar or Dashboard. Paste any YouTube video URL — regular videos and YouTube Shorts both work.</p>

      <h2>Step 2: Choose Your Platforms</h2>
      <p>Select which platforms you want content for: Instagram, TikTok, Twitter/X, LinkedIn, Facebook, YouTube descriptions, and Blog posts. Each platform gets content tailored to its format.</p>

      <h2>Step 3: Set Your Tone</h2>
      <p>Choose from Professional, Casual, Humorous, Inspirational, or Educational tone. You can also select a Brand Voice you've created for consistent messaging.</p>

      <h2>Step 4: Generate & Copy</h2>
      <p>Click <strong>Create Now</strong> and your content is generated in seconds. Each platform gets unique, optimized content — hashtags for Instagram, thread-style for Twitter, professional tone for LinkedIn, etc. Copy any piece with one click.</p>

      <h2>How It Works</h2>
      <p>The AI extracts the video transcript, analyzes the content, and creates platform-specific posts. The video must have captions enabled on YouTube for transcript extraction.</p>
    `
  },
  {
    id: 'smart-shorts',
    icon: '🎬',
    category: 'Core Features',
    title: 'Using Smart Shorts to Create Viral Clips',
    summary: 'Analyze videos to find the best moments, generate clips with captions and narration.',
    content: `
      <h2>Mode 1: Viral Moments Analysis</h2>
      <p>Go to <strong>Smart Shorts</strong> from the sidebar. Paste a YouTube video URL and click <strong>Analyze Video</strong>. The AI identifies viral-worthy moments with timestamps, titles, and virality scores displayed as colored badges with visual bars.</p>

      <h2>Generating Individual Clips</h2>
      <p>Each clip card has a toolbar with buttons: Preview, Generate Clip, Captions, Translate, and Narrate. Select a clip, choose your caption style, and click <strong>Generate Clip</strong>. The clip is created with burned-in captions in a TikTok/Reels style. Download the finished MP4 when ready, or use <strong>Export All</strong> to download everything at once.</p>

      <h2>Mode 2: Auto-Generate Shorts ⚡</h2>
      <p>Click the <strong>Auto-Generate</strong> tool card (⚡ icon) in the premium tools grid. This lets you create multiple shorts from one long video automatically — similar to Opus Clip.</p>
      <ul>
        <li>Paste a YouTube URL</li>
        <li>Choose how many shorts you want (1 to 20) using the slider</li>
        <li>Select duration for each short: 30s, 45s, 60s, 90s, or Custom</li>
        <li>Configure clip style, captions, and language</li>
        <li>Click <strong>Generate Shorts</strong> and watch real-time progress</li>
        <li>Download individual clips or <strong>Download All as ZIP</strong></li>
      </ul>

      <h2>Tool Panel Features</h2>
      <p>At the top of Smart Shorts, you'll find 6 quick-access tool cards:</p>
      <ul>
        <li><strong>Quick Narrate</strong> — Add AI voiceover to any video using ElevenLabs voices</li>
        <li><strong>Workflow Templates</strong> — Save and reuse your favorite editing workflows</li>
        <li><strong>Batch Analyze</strong> — Analyze multiple YouTube videos at once</li>
        <li><strong>Brand Kit</strong> — Set brand colors, fonts, and styles for consistent branding</li>
        <li><strong>Settings</strong> — Configure your Smart Shorts preferences</li>
        <li><strong>Auto-Generate</strong> — Create multiple shorts from one video instantly</li>
      </ul>

      <h2>Additional Features</h2>
      <p>Caption translation to 20+ languages, B-roll suggestions, and virality analysis are all available within Smart Shorts. For standalone thumbnail creation, visit the dedicated <a href="/ai-thumbnail">AI Thumbnails</a> page.</p>
    `
  },
  {
    id: 'video-editor',
    icon: '✂️',
    category: 'Tools',
    title: 'Video Editor — Trim, Adjust & Export',
    summary: 'Upload videos to trim, adjust colors, change speed, add text, and export at up to 4K.',
    content: `
      <h2>Uploading a Video</h2>
      <p>Open the <strong>Video Editor</strong> from the Dashboard AI Tools grid. Click the upload area or drag-and-drop a video file. Your video loads into the preview player.</p>

      <h2>Trimming</h2>
      <p>Click <strong>Trim</strong> to set start and end points. Use the time inputs to specify exact timestamps, then apply the trim.</p>

      <h2>Color Adjustments</h2>
      <p>Use the Brightness, Contrast, and Saturation sliders (0–200 range, 100 = no change). Changes preview in real-time before export.</p>

      <h2>Other Tools</h2>
      <ul>
        <li><strong>Speed</strong> — Speed up or slow down your video (0.25x to 4x)</li>
        <li><strong>Text Overlay</strong> — Add custom text on top of your video</li>
        <li><strong>Audio</strong> — Volume, fade in/out, bass/treble EQ, noise reduction, audio ducking</li>
        <li><strong>AI Voice</strong> — Generate AI voiceover from a script using ElevenLabs voices</li>
        <li><strong>Voice Transform</strong> — Change the voice in your video to any AI voice using ElevenLabs Speech-to-Speech. Extract audio from the video or upload a separate audio file, pick a target voice, and the AI transforms it while keeping the same words and pacing. Great for faceless YouTube channels.</li>
      </ul>

      <h2>Exporting</h2>
      <p>Click <strong>Export</strong> and choose your resolution: 720p, 1080p, or 4K. The editor preserves your video's original aspect ratio — portrait videos stay portrait. Exported videos use the universal yuv420p format compatible with all players.</p>
    `
  },
  {
    id: 'ai-hooks',
    icon: '🪝',
    category: 'Tools',
    title: 'AI Hooks — Generate Viral Opening Lines',
    summary: 'Create attention-grabbing hooks for YouTube intros, TikTok openings, and social posts.',
    content: `
      <h2>How to Generate Hooks</h2>
      <p>Open <strong>AI Hooks</strong> from the Dashboard. Enter your topic or paste a video description. Choose a hook style: Question, Bold Statement, Story, Statistic, or Controversial.</p>

      <h2>Using Your Hooks</h2>
      <p>The AI generates multiple hook variations. Copy any hook with one click and use it as your YouTube intro, TikTok opening, Instagram caption opener, or any content that needs a strong first line.</p>

      <h2>Tips</h2>
      <p>Try generating hooks in different styles for the same topic — you might be surprised which style resonates best. Question hooks tend to drive curiosity, while Bold Statements create authority.</p>
    `
  },
  {
    id: 'ai-reframe',
    icon: '📐',
    category: 'Tools',
    title: 'AI Reframe — Resize Videos for Any Platform',
    summary: 'Convert landscape videos to vertical, square, or any aspect ratio with smart AI cropping.',
    content: `
      <h2>How to Reframe</h2>
      <p>Open <strong>AI Reframe</strong> from the Dashboard. Paste a YouTube URL or upload a video file. Select your target formats: 9:16 (TikTok/Reels), 1:1 (Instagram Square), 4:5 (Instagram Portrait), or 16:9 (YouTube). You can select multiple at once.</p>

      <h2>Crop Modes</h2>
      <p>Choose between two crop modes:</p>
      <ul>
        <li><strong>🎯 Center Crop</strong> — Fast, takes the center strip of the frame. Best when subjects are already centered.</li>
        <li><strong>🧠 AI Face Tracking</strong> — Uses computer vision to detect faces and dynamically follow them as the video plays. Perfect for interviews, podcasts, and talking-head videos. The crop window smoothly follows the speaker so nobody gets cut off.</li>
      </ul>

      <h2>Output</h2>
      <p>Download each reframed video as an MP4. AI Face Tracking takes longer because it analyzes the video first, but produces much better results for videos with people.</p>
    `
  },
  {
    id: 'caption-presets',
    icon: '💬',
    category: 'Tools',
    title: 'AI Caption Presets — Trendy Subtitle Styles',
    summary: 'Browse and apply trending caption styles like Karaoke, Bold, Neon, and more.',
    content: `
      <h2>Choosing a Style</h2>
      <p>Open <strong>Caption Presets</strong> from the Dashboard. Browse the available styles: Karaoke (highlighted word-by-word), Bold, Minimal, Neon, and more. Each style shows a preview.</p>

      <h2>Applying Captions</h2>
      <p>Select a preset to apply it to your video clips. Captions are automatically generated from the video transcript and timed to match spoken words.</p>

      <h2>Tips</h2>
      <p>Karaoke-style captions (where words highlight as they're spoken) tend to get the highest engagement on TikTok and Instagram Reels.</p>
    `
  },
  {
    id: 'ai-thumbnails',
    icon: '🖼️',
    category: 'Tools',
    title: 'AI Thumbnails — Create Professional Thumbnails',
    summary: 'Extract frames from any video and apply professional style presets for eye-catching thumbnails.',
    content: `
      <h2>Getting Started</h2>
      <p>Go to <strong>AI Thumbnails</strong> from the sidebar (🖼️ icon). You can input a YouTube URL or upload a video file directly.</p>

      <h2>Extracting Frames</h2>
      <p>Click <strong>Extract Frames</strong> and the AI will pull key frames from throughout your video. You'll see a grid of frames under "Select a Frame to Style".</p>

      <h2>Styling Your Thumbnail</h2>
      <p>Click on any frame you like, then choose from 6 professional style presets:</p>
      <ul>
        <li><strong>Gradient Overlay</strong> — Stylish gradient effect</li>
        <li><strong>Dark Cinematic</strong> — Dark, moody look with vignette</li>
        <li><strong>Bold Border</strong> — Colorful borders that pop</li>
        <li><strong>Split Design</strong> — Split-screen style layout</li>
        <li><strong>Text Focus</strong> — Optimized for adding text</li>
        <li><strong>Clean Minimal</strong> — Simple and professional</li>
      </ul>

      <h2>Downloading</h2>
      <p>After styling, download your thumbnail at high resolution. Perfect for YouTube thumbnails, social media previews, and blog headers.</p>
    `
  },
  {
    id: 'speech-enhance',
    icon: '🎙️',
    category: 'Tools',
    title: 'Speech Enhancement — Clean Up Audio with AI',
    summary: 'Remove background noise and enhance vocal clarity in your videos.',
    content: `
      <h2>How It Works</h2>
      <p>Open <strong>Speech Enhance</strong> from the Dashboard. Upload a video with noisy or unclear audio. The AI processes the audio to reduce background noise and enhance vocal clarity.</p>

      <h2>When to Use It</h2>
      <p>Use Speech Enhancement for videos recorded in noisy environments, interviews with background chatter, or any content where the speaker's voice needs to be clearer.</p>

      <h2>Output</h2>
      <p>Download your video with enhanced audio. The video quality remains unchanged — only the audio is improved.</p>
    `
  },
  {
    id: 'brand-voice',
    icon: '🎤',
    category: 'Content',
    title: 'Brand Voice — Keep Your Tone Consistent',
    summary: 'Create custom voice profiles so all created content matches your brand style.',
    content: `
      <h2>Creating a Brand Voice</h2>
      <p>Go to <strong>Brand Voice</strong> from the sidebar. Enter a voice name, select a tone (Professional, Casual, Humorous, Inspirational, Educational), write a description of the style, and paste example content that represents the voice. Click <strong>Create Voice</strong>.</p>

      <h2>Using Your Brand Voice</h2>
      <p>When repurposing content, select your brand voice from the dropdown. The AI will match that style across all generated content, ensuring every post sounds authentically like your brand.</p>

      <h2>Managing Voices</h2>
      <p>You can create multiple brand voices for different brands, clients, or content types. Edit or delete any voice at any time from the Brand Voice page.</p>
    `
  },
  {
    id: 'analytics-calendar',
    icon: '📊',
    category: 'Content',
    title: 'Analytics & Content Calendar',
    summary: 'Track your content generation stats and plan your posting schedule.',
    content: `
      <h2>Analytics</h2>
      <p>Access <strong>Analytics</strong> from the sidebar to see statistics on how many pieces of content you've generated, broken down by platform and content type. Monitor your usage patterns over time.</p>

      <h2>Content Calendar</h2>
      <p>Access the <strong>Calendar</strong> from the sidebar. View all your generated content organized by date on a monthly calendar. Click any date to see content created that day. Use it to plan and track your posting schedule.</p>
    `
  },
  {
    id: 'billing',
    icon: '💳',
    category: 'Account',
    title: 'Billing, Plans & Pricing',
    summary: 'Understand the Free, Starter, Pro, and Teams plans and how to upgrade.',
    content: `
      <h2>Available Plans</h2>
      <ul>
        <li><strong>Free ($0/month)</strong> — 3 videos/month, 5 creations, 1 brand voice, 7-day history</li>
        <li><strong>Starter ($19/month)</strong> — 15 videos, 30 creations, 3 brand voices, Quick Narrate, 10 AI thumbnails, 30 clips, analytics, no watermark</li>
        <li><strong>Pro ($39/month)</strong> — 50 videos, 100 creations, 10 brand voices, unlimited narrations, 50 thumbnails, 150 clips, A/B testing, batch analysis, unlimited history</li>
        <li><strong>Teams ($79/month)</strong> — 200 videos, 500 creations, 25 brand voices, 150 thumbnails, 500 clips, 5 team seats, priority processing</li>
      </ul>

      <h2>Upgrading</h2>
      <p>Go to <strong>Billing</strong> from the sidebar. Click the upgrade button on the plan you want. Payments are processed securely through Stripe. You can upgrade, downgrade, or cancel at any time.</p>

      <h2>Features by Plan</h2>
      <p>All plans include access to Create, Smart Shorts, AI Hooks, AI Reframe, Caption Presets, Speech Enhancement, Video Editor, Brand Voice, Analytics, and Calendar. Higher plans unlock greater usage limits and premium features like batch analysis and A/B testing.</p>
    `
  },
  {
    id: 'troubleshooting',
    icon: '🔧',
    category: 'Support',
    title: 'Troubleshooting Common Issues',
    summary: 'Solutions for content generation errors, video issues, and other common problems.',
    content: `
      <h2>Content Generation Fails</h2>
      <p>Make sure the YouTube video has captions/subtitles enabled. YouTube Shorts may not always have auto-generated captions — try a regular YouTube video instead. If the transcript is empty, the video needs spoken content with captions.</p>

      <h2>Video Editor Issues</h2>
      <p>If exported video has distorted colors, re-export with default brightness/contrast/saturation (100 each). If trim shows no preview, refresh the page and re-upload the video.</p>

      <h2>Smart Shorts Processing</h2>
      <p>Longer processing times are normal for longer clips. If thumbnails fail, the system automatically falls back to the YouTube thumbnail.</p>

      <h2>AI Thumbnails Issues</h2>
      <p>If you see "No frames extracted from video," try a different YouTube URL or upload the video file directly. The video must be accessible and at least a few seconds long. If using a YouTube URL, make sure it's a valid, public video.</p>

      <h2>Auto-Generate Shorts Issues</h2>
      <p>If clip generation stalls, try reducing the number of shorts or using a shorter source video. The video must have spoken content with captions/subtitles for the AI analysis to work. Processing time increases with more clips and longer durations.</p>

      <h2>General Tips</h2>
      <ul>
        <li>Make sure you're logged in to access all features</li>
        <li>Clear your browser cache if the interface seems unresponsive</li>
        <li>AI Reframe processing time depends on video length</li>
        <li>Use the chat assistant (bottom-right corner) for instant help</li>
      </ul>
    `
  }
];

router.get('/help', optionalAuth, (req, res) => {
  const categories = {};
  helpArticles.forEach(a => {
    if (!categories[a.category]) categories[a.category] = [];
    categories[a.category].push(a);
  });

  let cardsHtml = '';
  Object.keys(categories).forEach(cat => {
    cardsHtml += '<h2 style="margin-top:2.5rem;margin-bottom:1rem">' + cat + '</h2><div class="card-grid">';
    categories[cat].forEach(a => {
      cardsHtml += '<a href="/help/' + a.id + '" class="card" style="text-decoration:none;color:inherit"><div class="icon">' + a.icon + '</div><h3>' + a.title + '</h3><p>' + a.summary + '</p></a>';
    });
    cardsHtml += '</div>';
  });

  res.send(pageShell('Help Center', req.user, `
    <h1>Help Center</h1>
    <p class="subtitle">Step-by-step guides for every feature in Splicora. Can't find what you need? Use the chat assistant in the bottom-right corner for instant help.</p>
    ${cardsHtml}
    <div class="cta-box">
      <h2>Still need help?</h2>
      <p>Our AI assistant is available 24/7 to answer your questions.</p>
      <a href="/contact" class="btn-cta">Contact Us</a>
    </div>
  `));
});

router.get('/help/:id', optionalAuth, (req, res) => {
  const article = helpArticles.find(a => a.id === req.params.id);
  if (!article) return res.redirect('/help');

  res.send(pageShell(article.title, req.user, `
    <p style="margin-bottom:1.5rem"><a href="/help" style="color:var(--accent2);text-decoration:none">&larr; Back to Help Center</a></p>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px"><span style="font-size:2.2rem">${article.icon}</span><span style="font-size:.8rem;font-weight:600;background:rgba(124,58,237,.15);color:var(--accent);padding:4px 12px;border-radius:20px">${article.category}</span></div>
    <h1>${article.title}</h1>
    <div class="legal-section" style="margin-top:2rem">
      ${article.content}
    </div>
    <div class="cta-box">
      <h2>Need more help?</h2>
      <p>Click the chat bubble in the bottom-right corner for instant AI assistance.</p>
      <a href="/help" class="btn-cta">Browse All Articles</a>
    </div>
  `));
});

module.exports = router;
