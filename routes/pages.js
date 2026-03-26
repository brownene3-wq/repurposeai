const express = require('express');
const router = express.Router();

const BRAND = { name: 'RepurposeAI', tagline: 'Turn One Video Into Unlimited Content' };

function getStyles() {
  return `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Playfair+Display:wght@700;800;900&display=swap');
:root{--primary:#6C3AED;--primary-light:#8B5CF6;--primary-dark:#5B21B6;--accent:#F59E0B;--dark:#0F0F1A;--dark-2:#1A1A2E;--surface:#1E1E32;--surface-light:#2A2A40;--text:#FFF;--text-muted:#A0AEC0;--text-dim:#718096;--gradient-1:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);--gradient-2:linear-gradient(135deg,#F59E0B 0%,#EF4444 100%);--gradient-3:linear-gradient(135deg,#6C3AED 0%,#3B82F6 50%,#EC4899 100%);--shadow-glow:0 0 60px rgba(108,58,237,0.3);--border-subtle:1px solid rgba(255,255,255,0.06)}
[data-theme="light"]{--dark:#F8F9FC;--dark-2:#EDF0F7;--surface:#FFFFFF;--surface-light:#F1F5F9;--text:#1A1A2E;--text-muted:#4A5568;--text-dim:#718096;--border-subtle:1px solid rgba(0,0,0,0.08);--shadow-glow:0 0 60px rgba(108,58,237,0.15)}
*{margin:0;padding:0;box-sizing:border-box}html{scroll-behavior:smooth}
body{transition:background .3s,color .3s;font-family:'Inter',-apple-system,sans-serif;background:var(--dark);color:var(--text);overflow-x:hidden;line-height:1.6}
.nav{position:fixed;top:0;left:0;right:0;z-index:1000;padding:1.2rem 2rem;background:rgba(15,15,26,0.8);backdrop-filter:blur(20px);border-bottom:var(--border-subtle);transition:all .3s}
.nav-inner{max-width:1200px;margin:0 auto;display:flex;align-items:center;justify-content:space-between}
.nav-logo{font-family:'Playfair Display',serif;font-size:1.6rem;font-weight:800;background:var(--gradient-1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;text-decoration:none}
.nav-links{display:flex;align-items:center;gap:2rem}
.nav-links a{color:var(--text-muted);text-decoration:none;font-size:.9rem;font-weight:500;transition:color .3s}
.nav-links a:hover{color:var(--text)}
.btn{display:inline-flex;align-items:center;gap:.5rem;padding:.7rem 1.6rem;border-radius:50px;font-weight:600;font-size:.9rem;text-decoration:none;transition:all .3s;cursor:pointer;border:none}
.btn-primary{background:var(--gradient-1);color:#fff;box-shadow:0 4px 20px rgba(108,58,237,0.4)}
.btn-primary:hover{transform:translateY(-2px);box-shadow:0 6px 30px rgba(108,58,237,0.5)}
.btn-outline{background:transparent;color:var(--text);border:1px solid rgba(255,255,255,0.2)}
.btn-outline:hover{border-color:var(--primary-light);color:var(--primary-light)}
.btn-large{padding:1rem 2.4rem;font-size:1rem}
.hero{position:relative;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:8rem 2rem 4rem;overflow:hidden}
.hero-bg{position:absolute;inset:0;background:radial-gradient(ellipse at 30% 20%,rgba(108,58,237,0.15) 0%,transparent 60%),radial-gradient(ellipse at 70% 80%,rgba(236,72,153,0.1) 0%,transparent 60%)}
.hero-grid{position:absolute;inset:0;opacity:.03;background-image:linear-gradient(rgba(255,255,255,0.1) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.1) 1px,transparent 1px);background-size:60px 60px}
.hero-content{position:relative;max-width:900px;text-align:center;z-index:2}
.hero-badge{display:inline-flex;align-items:center;gap:.5rem;padding:.5rem 1.2rem;border-radius:50px;background:rgba(108,58,237,0.15);border:1px solid rgba(108,58,237,0.3);color:var(--primary-light);font-size:.85rem;font-weight:600;margin-bottom:2rem;letter-spacing:.05em}
.hero h1{font-family:'Playfair Display',serif;font-size:clamp(2.8rem,6vw,4.5rem);font-weight:900;line-height:1.1;margin-bottom:1.5rem}
.hero h1 .gradient-text{background:var(--gradient-3);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.hero p{font-size:1.2rem;color:var(--text-muted);max-width:600px;margin:0 auto 2.5rem;line-height:1.7}
.hero-cta{display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;margin-bottom:3rem}
.hero-stats{display:flex;gap:3rem;justify-content:center;margin-top:3rem;padding-top:3rem;border-top:var(--border-subtle)}
.hero-stat .number{font-size:2rem;font-weight:800;background:var(--gradient-1);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.hero-stat .label{font-size:.85rem;color:var(--text-dim);margin-top:.3rem}
section{padding:6rem 2rem}.section-inner{max-width:1200px;margin:0 auto}
.section-label{display:inline-block;font-size:.8rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--primary-light);margin-bottom:1rem}
.section-title{font-family:'Playfair Display',serif;font-size:clamp(2rem,4vw,3rem);font-weight:800;margin-bottom:1rem;line-height:1.2}
.section-subtitle{font-size:1.1rem;color:var(--text-muted);max-width:600px;line-height:1.7}
.section-header{text-align:center;margin-bottom:4rem}.section-header .section-subtitle{margin:0 auto}
.steps-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:2rem;margin-top:3rem}
.step-card{background:var(--surface);border-radius:20px;padding:2.5rem;border:var(--border-subtle);transition:all .4s}
.step-card:hover{transform:translateY(-4px);border-color:rgba(108,58,237,0.3)}
.step-number{width:50px;height:50px;border-radius:15px;background:var(--gradient-1);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.2rem;margin-bottom:1.5rem}
.step-card h3{font-size:1.2rem;font-weight:700;margin-bottom:.8rem}.step-card p{color:var(--text-muted);font-size:.95rem;line-height:1.6}
.step-icon{font-size:2rem;margin-bottom:1rem}
.features-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1.5rem}
.feature-card{background:var(--surface);border-radius:16px;padding:2rem;border:var(--border-subtle);transition:all .3s}
.feature-card:hover{border-color:rgba(108,58,237,0.3);transform:translateY(-2px)}
.feature-icon{width:48px;height:48px;border-radius:12px;background:rgba(108,58,237,0.15);display:flex;align-items:center;justify-content:center;font-size:1.4rem;margin-bottom:1.2rem}
.feature-card h3{font-size:1.05rem;font-weight:700;margin-bottom:.6rem}.feature-card p{color:var(--text-muted);font-size:.9rem;line-height:1.6}
.pricing-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:2rem;align-items:start}
.price-card{background:var(--surface);border-radius:20px;padding:2.5rem;border:var(--border-subtle);transition:all .3s;position:relative}
.price-card.featured{border-color:var(--primary);box-shadow:var(--shadow-glow);transform:scale(1.02)}
.price-card.featured::before{content:'MOST POPULAR';position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:var(--gradient-1);padding:.3rem 1.2rem;border-radius:50px;font-size:.7rem;font-weight:700;letter-spacing:.1em}
.price-card h3{font-size:1.2rem;font-weight:700;margin-bottom:.5rem}
.price-card .price{font-size:3rem;font-weight:800;margin:1rem 0}.price-card .price span{font-size:1rem;font-weight:400;color:var(--text-muted)}
.price-card .price-desc{color:var(--text-muted);font-size:.9rem;margin-bottom:1.5rem}
.price-features{list-style:none;margin-bottom:2rem}
.price-features li{padding:.5rem 0;color:var(--text-muted);font-size:.9rem;display:flex;align-items:center;gap:.7rem}
.price-features li::before{content:'✓';color:var(--primary-light);font-weight:700}
.price-card .btn{width:100%;justify-content:center}
.testimonials-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:2rem}
.testimonial-card{background:var(--surface);border-radius:16px;padding:2rem;border:var(--border-subtle)}
.testimonial-stars{color:var(--accent);margin-bottom:1rem;font-size:1.1rem}
.testimonial-card p{color:var(--text-muted);font-size:.95rem;line-height:1.7;margin-bottom:1.5rem;font-style:italic}
.testimonial-author{display:flex;align-items:center;gap:.8rem}
.testimonial-avatar{width:40px;height:40px;border-radius:50%;background:var(--gradient-1);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.9rem}
.testimonial-name{font-weight:600;font-size:.9rem}.testimonial-role{font-size:.8rem;color:var(--text-dim)}
.cta-section{text-align:center;padding:6rem 2rem;background:linear-gradient(180deg,transparent 0%,rgba(108,58,237,0.08) 50%,transparent 100%)}
.footer{padding:4rem 2rem 2rem;border-top:var(--border-subtle);background:var(--dark-2)}
.footer-grid{max-width:1200px;margin:0 auto;display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:3rem;margin-bottom:3rem}
.footer-brand p{color:var(--text-dim);font-size:.9rem;line-height:1.7;margin-top:1rem}
.footer h4{font-size:.85rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:1.2rem;color:var(--text-muted)}
.footer a{display:block;color:var(--text-dim);text-decoration:none;font-size:.9rem;padding:.3rem 0;transition:color .3s}.footer a:hover{color:var(--primary-light)}
.footer-bottom{max-width:1200px;margin:0 auto;padding-top:2rem;border-top:var(--border-subtle);display:flex;justify-content:space-between;align-items:center;font-size:.85rem;color:var(--text-dim)}
.demo-preview{max-width:900px;margin:4rem auto 0;background:var(--surface);border-radius:20px;border:var(--border-subtle);overflow:hidden;box-shadow:var(--shadow-glow)}
.demo-bar{display:flex;align-items:center;gap:.5rem;padding:1rem 1.5rem;background:var(--dark-2);border-bottom:var(--border-subtle)}
.demo-dot{width:10px;height:10px;border-radius:50%}
.demo-body{padding:2rem}.demo-input-group{display:flex;gap:1rem;margin-bottom:1.5rem}
.demo-input{flex:1;padding:1rem 1.2rem;background:var(--dark);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:var(--text);font-size:.95rem}
.demo-platforms{display:flex;gap:1rem;flex-wrap:wrap}
.demo-platform{padding:.8rem 1.2rem;border-radius:10px;background:rgba(108,58,237,0.1);border:1px solid rgba(108,58,237,0.2);font-size:.85rem;color:var(--primary-light)}
.theme-toggle{background:var(--surface);border:1px solid rgba(255,255,255,0.1);border-radius:50%;width:32px;height:32px;padding:0;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:.9rem;color:var(--text-muted);transition:all .3s;flex-shrink:0}[data-theme="light"] .theme-toggle{border-color:rgba(0,0,0,0.1)}.theme-toggle:hover{border-color:var(--primary-light);color:var(--text)}.theme-toggle .toggle-track{display:none}.theme-toggle .toggle-thumb{display:none}
@media(max-width:768px){.nav-links{display:none}.steps-grid,.features-grid,.pricing-grid,.testimonials-grid{grid-template-columns:1fr}.footer-grid{grid-template-columns:1fr 1fr}.hero-stats{flex-direction:column;gap:1.5rem}.hero h1{font-size:2.2rem}.price-card.featured{transform:none}.demo-input-group{flex-direction:column}}
`;
}

router.get('/', (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${BRAND.name} - ${BRAND.tagline}</title>
  <meta name="description" content="AI-powered content repurposing. Paste a YouTube link, get content for Instagram, TikTok, Facebook, LinkedIn, Twitter.">
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#x26A1;</text></svg>">
  <style>${getStyles()}</style>
</head>
<body>
 <nav class="nav"><div class="nav-inner">
    <a href="/" class="nav-logo">&#x26A1; ${BRAND.name}</a>
    <div class="nav-links">
      <a href="#how-it-works">How It Works</a>
      <a href="#features">Features</a>
      <a href="#pricing">Pricing</a>
      <a href="/auth/login" class="btn btn-outline">Log In</a>
      <a href="/auth/register" class="btn btn-primary">Start Free</a>
      <button class="theme-toggle" onclick="toggleTheme()">&#x1F319;</button>
    </div>
  </div></nav>

  <section class="hero">
    <div class="hero-bg"></div><div class="hero-grid"></div>
    <div class="hero-content">
      <div class="hero-badge">&#x2728; AI-Powered Content Engine</div>
      <h1>Turn One Video Into<br><span class="gradient-text">Unlimited Content</span></h1>
      <p>Paste a YouTube link. Our AI instantly creates optimized posts for every major platform. Save hours of work. Grow everywhere.</p>
      <div class="hero-cta">
        <a href="/auth/register" class="btn btn-primary btn-large">Get Started Free &#x2192;</a>
        <a href="#how-it-works" class="btn btn-outline btn-large">See How It Works</a>
      </div>
      <div class="demo-preview">
        <div class="demo-bar">
          <div class="demo-dot" style="background:#FF5F57"></div>
          <div class="demo-dot" style="background:#FEBC2E"></div>
          <div class="demo-dot" style="background:#28C840"></div>
        </div>
        <div class="demo-body">
          <div class="demo-input-group">
            <input class="demo-input" value="https://youtube.com/watch?v=your-video" readonly>
            <button class="btn btn-primary">Repurpose &#x26A1;</button>
          </div>
          <div class="demo-platforms">
            <div class="demo-platform">&#x1F4F7; Instagram Reel</div>
            <div class="demo-platform">&#x1F3B5; TikTok</div>
            <div class="demo-platform">&#x1F4D8; Facebook Post</div>
            <div class="demo-platform">&#x1F4BC; LinkedIn Article</div>
            <div class="demo-platform">&#x1F426; Twitter Thread</div>
          </div>
        </div>
      </div>
      <div class="hero-stats">
        <div class="hero-stat"><div class="number">10K+</div><div class="label">Videos Repurposed</div></div>
        <div class="hero-stat"><div class="number">50K+</div><div class="label">Posts Generated</div></div>
        <div class="hero-stat"><div class="number">5</div><div class="label">Platforms Supported</div></div>
      </div>
    </div>
  </section>

  <section id="how-it-works" style="background:var(--dark-2)">
    <div class="section-inner">
      <div class="section-header">
        <div class="section-label">How It Works</div>
        <h2 class="section-title">Three Steps to Everywhere</h2>
        <p class="section-subtitle">From YouTube to every platform in under 60 seconds. No editing skills required.</p>
      </div>
      <div class="steps-grid">
        <div class="step-card">
          <div class="step-number">1</div><div class="step-icon">&#x1F517;</div>
          <h3>Paste Your Link</h3>
          <p>Drop any YouTube video URL into RepurposeAI. We extract transcripts, key moments, and visual context automatically.</p>
        </div>
        <div class="step-card">
          <div class="step-number">2</div><div class="step-icon">&#x2728;</div>
          <h3>AI Creates Content</h3>
          <p>Our AI engine generates platform-optimized content: Instagram captions with hashtags, TikTok scripts, LinkedIn articles, tweet threads, and more.</p>
        </div>
        <div class="step-card">
          <div class="step-number">3</div><div class="step-icon">&#x1F680;</div>
          <h3>Publish Everywhere</h3>
          <p>Review, edit if needed, and download content for all platforms. Schedule posts or copy content for manual posting.</p>
        </div>
      </div>
    </div>
  </section>

  <section id="features">
    <div class="section-inner">
      <div class="section-header">
        <div class="section-label">Features</div>
        <h2 class="section-title">Everything You Need to Scale</h2>
        <p class="section-subtitle">Professional-grade tools designed for creators, agencies, and businesses.</p>
      </div>
      <div class="features-grid">
        <div class="feature-card"><div class="feature-icon">&#x1F9E0;</div><h3>Smart AI Engine</h3><p>Advanced AI understands context, tone, and audience to create platform-perfect content every time.</p></div>
        <div class="feature-card"><div class="feature-icon">&#x1F3A8;</div><h3>Platform Optimization</h3><p>Content is automatically tailored for each platform's format, character limits, and best practices.</p></div>
        <div class="feature-card"><div class="feature-icon">&#x23F0;</div><h3>Smart Scheduling</h3><p>Schedule content to publish at optimal times for maximum engagement on each platform.</p></div>
        <div class="feature-card"><div class="feature-icon">#&#xFE0F;&#x20E3;</div><h3>Hashtag Generator</h3><p>AI-generated hashtags tailored to your niche and trending topics for maximum reach.</p></div>
        <div class="feature-card"><div class="feature-icon">&#x1F4CA;</div><h3>Analytics Dashboard</h3><p>Track performance across all platforms with unified analytics and actionable insights.</p></div>
        <div class="feature-card"><div class="feature-icon">&#x1F504;</div><h3>Batch Processing</h3><p>Process multiple videos at once. Perfect for agencies managing multiple client accounts.</p></div>
      </div>
    </div>
  </section>

  <section id="pricing" style="background:var(--dark-2)">
    <div class="section-inner">
      <div class="section-header">
        <div class="section-label">Pricing</div>
        <h2 class="section-title">Simple, Transparent Pricing</h2>
        <p class="section-subtitle">Start free. Upgrade when you're ready to scale.</p>
      </div>
      <div class="pricing-grid">
        <div class="price-card">
          <h3>Starter</h3><div class="price">Free</div>
          <p class="price-desc">Perfect for trying out RepurposeAI</p>
          <ul class="price-features"><li>3 videos per month</li><li>3 platforms supported</li><li>Basic AI captions</li><li>Download content</li><li>Email support</li></ul>
          <a href="/auth/register" class="btn btn-outline">Get Started</a>
        </div>
        <div class="price-card featured">
          <h3>Pro</h3><div class="price">$29<span>/month</span></div>
          <p class="price-desc">For creators serious about growth</p>
          <ul class="price-features"><li>Unlimited videos</li><li>All 5 platforms</li><li>Advanced AI with tone control</li><li>Smart scheduling</li><li>Hashtag optimization</li><li>Analytics dashboard</li><li>Priority support</li></ul>
          <a href="/auth/register?plan=pro" class="btn btn-primary">Start Pro Trial</a>
        </div>
        <div class="price-card">
          <h3>Enterprise</h3><div class="price">$99<span>/month</span></div>
          <p class="price-desc">For agencies and teams</p>
          <ul class="price-features"><li>Everything in Pro</li><li>Batch processing (50+)</li><li>Team collaboration</li><li>White-label exports</li><li>API access</li><li>Custom AI training</li><li>Dedicated account manager</li></ul>
          <a href="/auth/register?plan=enterprise" class="btn btn-outline">Contact Sales</a>
        </div>
      </div>
    </div>
  </section>

  <section>
    <div class="section-inner">
      <div class="section-header">
        <div class="section-label">Testimonials</div>
        <h2 class="section-title">Loved by Creators</h2>
        <p class="section-subtitle">See what our users are saying about RepurposeAI.</p>
      </div>
      <div class="testimonials-grid">
        <div class="testimonial-card">
          <div class="testimonial-stars">&#x2B50;&#x2B50;&#x2B50;&#x2B50;&#x2B50;</div>
          <p>"RepurposeAI saves me 10+ hours every week. I paste my YouTube link and get perfect content for all my socials instantly."</p>
          <div class="testimonial-author"><div class="testimonial-avatar">JM</div><div><div class="testimonial-name">Jake Morrison</div><div class="testimonial-role">YouTube Creator, 500K subs</div></div></div>
        </div>
        <div class="testimonial-card">
          <div class="testimonial-stars">&#x2B50;&#x2B50;&#x2B50;&#x2B50;&#x2B50;</div>
          <p>"Our agency manages 20+ clients. RepurposeAI turned a 3-person job into something one person handles easily."</p>
          <div class="testimonial-author"><div class="testimonial-avatar">SR</div><div><div class="testimonial-name">Sarah Rodriguez</div><div class="testimonial-role">Digital Agency Owner</div></div></div>
        </div>
        <div class="testimonial-card">
          <div class="testimonial-stars">&#x2B50;&#x2B50;&#x2B50;&#x2B50;&#x2B50;</div>
          <p>"The AI understands my brand voice perfectly. The captions it generates get more engagement than what I wrote manually."</p>
          <div class="testimonial-author"><div class="testimonial-avatar">DK</div><div><div class="testimonial-name">David Kim</div><div class="testimonial-role">E-commerce Entrepreneur</div></div></div>
        </div>
      </div>
    </div>
  </section>

  <section class="cta-section">
    <div class="section-inner">
      <h2 class="section-title">Ready to Multiply Your Content?</h2>
      <p class="section-subtitle" style="margin:1rem auto 2rem">Join thousands of creators who save hours every week with AI-powered content repurposing.</p>
      <a href="/auth/register" class="btn btn-primary btn-large">Start Free Today &#x2192;</a>
    </div>
  </section>

  <footer class="footer">
    <div class="footer-grid">
      <div class="footer-brand">
        <a href="/" class="nav-logo">&#x26A1; ${BRAND.name}</a>
        <p>AI-powered content repurposing platform. Turn one YouTube video into optimized content for every major social platform.</p>
      </div>
      <div><h4>Product</h4><a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#how-it-works">How It Works</a><a href="/dashboard">Dashboard</a></div>
      <div><h4>Company</h4><a href="/contact">Contact</a><a href="#">About</a><a href="#">Blog</a><a href="#">Careers</a></div>
      <div><h4>Legal</h4><a href="#">Privacy Policy</a><a href="#">Terms of Service</a><a href="#">Cookie Policy</a></div>
    </div>
    <div class="footer-bottom">
      <span>&copy; 2024 ${BRAND.name}. All rights reserved.</span>
      <span>Built with &#x2764;&#xFE0F; and AI</span>
    </div>
  </footer>

  <script>
    function toggleTheme(){var h=document.documentElement;var c=h.getAttribute("data-theme");var n=c==="light"?"dark":"light";h.setAttribute("data-theme",n);localStorage.setItem("repurposeai-theme",n);var btn=document.querySelector('.theme-toggle');if(btn)btn.textContent=n==="light"?'☀️':'🌙'}(function(){var s=localStorage.getItem("repurposeai-theme");if(s==="light"){document.documentElement.setAttribute("data-theme","light");var btn=document.querySelector('.theme-toggle');if(btn)btn.textContent='☀️'}})();
 document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', e => { e.preventDefault(); const t = document.querySelector(a.getAttribute('href')); if(t) t.scrollIntoView({behavior:'smooth',block:'start'}); });
    });
    window.addEventListener('scroll', () => { document.querySelector('.nav').style.background = window.scrollY > 50 ? 'rgba(15,15,26,0.95)' : 'rgba(15,15,26,0.8)'; });
  </script>
</body>
</html>`;
  res.send(html);
});

module.exports = router;
