const express = require('express');
const router = express.Router();
const { optionalAuth } = require('../middleware/auth');
let blogOps;
try { blogOps = require('../db/database').blogOps; } catch(e) { blogOps = null; }

const BRAND = { name: 'RepurposeAI' };

// Shared page shell (matches contact page styling)
function pageShell(title, user, content) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#x26A1;</text></svg>">
<title>${title} — ${BRAND.name}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#06060f;--bg2:#0c0c1d;--bg3:#11112a;--accent:#7c3aed;--accent2:#06b6d4;--accent3:#f472b6;--text:#f0f0ff;--text2:#a0a0c0;--text3:#6a6a8e;--border:rgba(124,58,237,0.15);--gradient:linear-gradient(135deg,#7c3aed,#06b6d4)}
body{font-family:'Inter',sans-serif;background:var(--bg);color:var(--text);line-height:1.7}
.bg-orb{position:fixed;border-radius:50%;filter:blur(120px);opacity:.3;pointer-events:none;animation:f 20s ease-in-out infinite}
.bg-orb--1{width:500px;height:500px;background:#7c3aed;top:-150px;right:-100px}
.bg-orb--2{width:400px;height:400px;background:#06b6d4;bottom:-100px;left:-100px;animation-delay:-7s}
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
  <a href="/" class="logo">Repurpose<span>AI</span></a>
  <div class="nav-links">
    <a href="/">Home</a>
    <a href="/pricing">Pricing</a>
    <a href="/contact">Contact</a>
    ${user ? '<a href="/dashboard" style="padding:10px 24px;border-radius:99px;background:linear-gradient(135deg,#7c3aed,#06b6d4);color:#fff;font-weight:600;font-size:.85rem">Dashboard</a>' : '<a href="/auth/login" style="color:var(--accent2);font-weight:600">Log In</a>'}
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
  <h1>About RepurposeAI</h1>
  <p class="subtitle">We're on a mission to help creators do more with less. One video, unlimited content — powered by AI.</p>

  <div class="card-grid">
    <div class="card">
      <div class="icon">&#x1F3AF;</div>
      <h3>Our Mission</h3>
      <p>Content creation shouldn't mean spending hours reformatting the same ideas for every platform. We built RepurposeAI to let creators focus on what they do best — creating — while AI handles the rest.</p>
    </div>
    <div class="card">
      <div class="icon">&#x26A1;</div>
      <h3>What We Do</h3>
      <p>RepurposeAI takes a single YouTube video and transforms it into platform-optimized content for Twitter/X, LinkedIn, Instagram, Facebook, TikTok, and more — in seconds, not hours.</p>
    </div>
    <div class="card">
      <div class="icon">&#x1F680;</div>
      <h3>Our Vision</h3>
      <p>We envision a world where every creator, from solo YouTubers to enterprise marketing teams, can maximize their reach without multiplying their workload.</p>
    </div>
  </div>

  <h2>Why Creators Choose Us</h2>
  <p>Thousands of content creators, marketers, and businesses trust RepurposeAI to save time, stay consistent, and grow their audience across platforms. Our AI understands tone, context, and platform best practices — so every piece of content feels native, not copy-pasted.</p>

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
    <a href="/auth/register" class="btn-cta">Join RepurposeAI &#x2192;</a>
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
        <p>Try RepurposeAI free and turn your videos into content for every platform.</p>
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
  <h1>Careers at RepurposeAI</h1>
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
    <p>Content you process through RepurposeAI (such as video URLs and generated text) is used solely to provide the service to you. We do not use your content to train AI models or share it with third parties without your consent.</p>

    <h2>6. Cookies</h2>
    <p>We use cookies and similar tracking technologies to track activity on our service and hold certain information. You can instruct your browser to refuse all cookies or to indicate when a cookie is being sent. See our Cookie Policy for more details.</p>

    <h2>7. Data Retention</h2>
    <p>We retain your personal data only for as long as necessary to fulfill the purposes for which it was collected, including to satisfy any legal, accounting, or reporting requirements.</p>

    <h2>8. Your Rights</h2>
    <p>You have the right to access, update, or delete your personal information at any time. You may also request a copy of the data we hold about you. To exercise these rights, please contact us at support@repurposeai.ai.</p>

    <h2>9. Changes to This Policy</h2>
    <p>We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new policy on this page and updating the "Last updated" date.</p>

    <h2>10. Contact Us</h2>
    <p>If you have any questions about this Privacy Policy, please contact us at <a href="/contact">our contact page</a> or email support@repurposeai.ai.</p>
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
    <p>By accessing or using RepurposeAI, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our services.</p>

    <h2>2. Description of Service</h2>
    <p>RepurposeAI is an AI-powered platform that helps users repurpose video content into text-based content optimized for various social media platforms. The service includes content generation, smart video clip extraction, analytics, and scheduling features.</p>

    <h2>3. User Accounts</h2>
    <p>You are responsible for safeguarding the password you use to access the service and for any activities or actions under your account. You must notify us immediately upon becoming aware of any breach of security or unauthorized use of your account.</p>

    <h2>4. Acceptable Use</h2>
    <p>You agree not to use RepurposeAI to generate content that is illegal, harmful, threatening, abusive, harassing, defamatory, or otherwise objectionable. You must not use the service to infringe upon the intellectual property rights of others.</p>

    <h2>5. Content Ownership</h2>
    <p>You retain all rights to the content you input into and generate through RepurposeAI. We do not claim ownership over your content. By using our service, you grant us a limited license to process your content solely for the purpose of providing the service.</p>

    <h2>6. Subscription and Billing</h2>
    <p>Some features of RepurposeAI require a paid subscription. Subscription fees are billed in advance on a monthly or annual basis. You may cancel your subscription at any time, and cancellation will take effect at the end of the current billing period.</p>

    <h2>7. Limitation of Liability</h2>
    <p>RepurposeAI is provided "as is" without warranties of any kind, either express or implied. In no event shall RepurposeAI be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use of or inability to use the service.</p>

    <h2>8. Modifications to Service</h2>
    <p>We reserve the right to modify or discontinue, temporarily or permanently, the service with or without notice. We shall not be liable to you or any third party for any modification, suspension, or discontinuance of the service.</p>

    <h2>9. Governing Law</h2>
    <p>These Terms shall be governed by and construed in accordance with the laws of the United States, without regard to its conflict of law provisions.</p>

    <h2>10. Contact</h2>
    <p>If you have any questions about these Terms, please contact us at <a href="/contact">our contact page</a> or email support@repurposeai.ai.</p>
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
    <p>RepurposeAI uses cookies for the following purposes:</p>
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
    <p>If you have questions about our use of cookies, please contact us at <a href="/contact">our contact page</a> or email support@repurposeai.ai.</p>
  </div>
`));
});

module.exports = router;
