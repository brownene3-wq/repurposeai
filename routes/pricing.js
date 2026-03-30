const express = require('express');
const router = express.Router();
const { optionalAuth } = require('../middleware/auth');
const { getBaseCSS, getHeadHTML, getThemeToggle, getThemeScript } = require('../utils/theme');

router.get('/', optionalAuth, (req, res) => {
  const html = `${getHeadHTML('Pricing - RepurposeAI')}
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&display=swap');
      ${getBaseCSS()}
      *{margin:0;padding:0;box-sizing:border-box}
      body{min-height:100vh;display:flex;flex-direction:column}
      .pricing-hero{text-align:center;padding:5rem 2rem 3rem}
      .pricing-hero h1{font-family:'Playfair Display',serif;font-size:3rem;font-weight:800;margin-bottom:1rem}
      .pricing-hero p{color:var(--text-muted);font-size:1.2rem;max-width:600px;margin:0 auto}
      .pricing-container{max-width:1100px;margin:0 auto;padding:0 2rem 5rem}
      .pricing-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:2rem;margin-bottom:4rem}
      .price-card{background:var(--surface);border-radius:20px;padding:2.5rem;border:1px solid var(--border-subtle);transition:all .3s;position:relative}
      .price-card.featured{border-color:var(--primary);box-shadow:0 0 60px rgba(108,58,237,0.2);transform:scale(1.05)}
      .price-card.featured::before{content:'MOST POPULAR';position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:var(--gradient-1);color:#fff;padding:.4rem 1.2rem;border-radius:20px;font-size:.75rem;font-weight:700;letter-spacing:.5px}
      .price-card h3{font-size:1.3rem;font-weight:700;margin-bottom:.5rem}
      .price-card .price{font-size:3rem;font-weight:800;margin:1rem 0}
      .price-card .price span{font-size:1rem;font-weight:400;color:var(--text-muted)}
      .price-card .desc{color:var(--text-muted);font-size:.95rem;margin-bottom:1.5rem;line-height:1.5}
      .features-list{list-style:none;margin-bottom:2rem}
      .features-list li{padding:.5rem 0;color:var(--text-muted);font-size:.9rem;display:flex;align-items:center;gap:.6rem}
      .features-list li::before{content:'\2713';color:var(--primary-light);font-weight:700;font-size:1rem}
      .features-list li.disabled{opacity:.4}
      .features-list li.disabled::before{content:'\2717';color:var(--text-muted)}
      .btn{display:inline-flex;align-items:center;justify-content:center;width:100%;padding:1rem;border-radius:50px;font-weight:700;font-size:1rem;cursor:pointer;border:none;transition:all .3s;text-decoration:none}
      .btn-primary{background:var(--gradient-1);color:#fff;box-shadow:0 4px 20px rgba(108,58,237,0.3)}
      .btn-primary:hover{transform:translateY(-2px);box-shadow:0 6px 25px rgba(108,58,237,0.4)}
      .btn-outline{background:transparent;color:var(--text);border:2px solid rgba(255,255,255,0.15)}
      .btn-outline:hover{border-color:var(--primary-light);color:var(--primary-light)}
      .faq-section{max-width:700px;margin:0 auto;padding:3rem 2rem}
      .faq-section h2{font-family:'Playfair Display',serif;font-size:2rem;text-align:center;margin-bottom:2rem}
      .faq-item{border-bottom:1px solid var(--border-subtle);padding:1.5rem 0}
      .faq-item h4{font-weight:600;margin-bottom:.5rem;font-size:1rem}
      .faq-item p{color:var(--text-muted);font-size:.9rem;line-height:1.6}
      .nav-bar{display:flex;justify-content:space-between;align-items:center;padding:1.5rem 3rem;max-width:1200px;margin:0 auto;width:100%}
      .nav-logo{font-family:'Playfair Display',serif;font-size:1.5rem;font-weight:800;color:var(--text);text-decoration:none}
      .nav-links{display:flex;gap:2rem;align-items:center}
      .nav-links a{color:var(--text-muted);text-decoration:none;font-size:.9rem;font-weight:500}
      .nav-links a:hover{color:var(--primary-light)}
      .nav-links .btn-sm{padding:.5rem 1.2rem;border-radius:25px;background:var(--gradient-1);color:#fff;font-weight:600}
      @media(max-width:768px){.pricing-grid{grid-template-columns:1fr}.price-card.featured{transform:none}.pricing-hero h1{font-size:2rem}.nav-bar{padding:1rem 1.5rem}}
    </style>
    </head>
    <body>
    <nav class="nav-bar">
      <a href="/" class="nav-logo">RepurposeAI</a>
      <div class="nav-links">
        <a href="/#features">Features</a>
        <a href="/pricing">Pricing</a>
        ${req.user ? '<a href="/dashboard" class="btn-sm">Dashboard</a>' : '<a href="/auth/login" class="btn-sm">Get Started</a>'}
      </div>
    </nav>
    ${getThemeToggle()}
    <div class="pricing-hero">
      <h1>Simple, Transparent Pricing</h1>
      <p>Start free. Upgrade when you are ready to grow. No hidden fees.</p>
    </div>
    <div class="pricing-container">
      <div class="pricing-grid">
        <div class="price-card">
          <h3>Free</h3>
          <div class="price">$0<span>/month</span></div>
          <p class="desc">Get started and see the magic of AI-powered content repurposing.</p>
          <ul class="features-list">
            <li>3 Smart Shorts/month</li>
            <li>5 content repurposes/month</li>
            <li>1 brand voice profile</li>
            <li>7-day content history</li>
            <li class="disabled">AI narrations</li>
            <li class="disabled">AI thumbnails</li>
            <li class="disabled">Analytics dashboard</li>
          </ul>
          <a href="/auth/register" class="btn btn-outline">Start Free</a>
        </div>
        <div class="price-card featured">
          <h3>Starter</h3>
          <div class="price">$19<span>/month</span></div>
          <p class="desc">Everything you need to consistently create and repurpose content.</p>
          <ul class="features-list">
            <li>15 Smart Shorts/month</li>
            <li>30 content repurposes/month</li>
            <li>3 brand voice profiles</li>
            <li>Unlimited AI narrations</li>
            <li>10 AI thumbnails/month</li>
            <li>5 video clips/month</li>
            <li>Analytics dashboard</li>
            <li>Brand kit and content calendar</li>
            <li>30-day history</li>
            <li>No watermark</li>
          </ul>
          <a href="/auth/register" class="btn btn-primary">Get Started</a>
        </div>
        <div class="price-card">
          <h3>Pro</h3>
          <div class="price">$39<span>/month</span></div>
          <p class="desc">Maximum power for creators serious about scaling their content.</p>
          <ul class="features-list">
            <li>50 Smart Shorts/month</li>
            <li>100 content repurposes/month</li>
            <li>10 brand voice profiles</li>
            <li>Unlimited AI narrations</li>
            <li>50 AI thumbnails/month</li>
            <li>25 video clips/month</li>
            <li>Batch content analysis</li>
            <li>A/B thumbnail testing</li>
            <li>Clips with B-roll</li>
            <li>Full analytics and calendar</li>
            <li>Unlimited history</li>
          </ul>
          <a href="/auth/register" class="btn btn-primary">Go Pro</a>
        </div>
      </div>
    </div>
    <div class="faq-section">
      <h2>Frequently Asked Questions</h2>
      <div class="faq-item">
        <h4>Can I cancel anytime?</h4>
        <p>Yes! You can cancel your subscription at any time. Your plan will remain active until the end of your billing period.</p>
      </div>
      <div class="faq-item">
        <h4>How do AI narrations work?</h4>
        <p>AI narrations are powered by ElevenLabs. You connect your own ElevenLabs API key and get access to premium AI voices for your content.</p>
      </div>
      <div class="faq-item">
        <h4>What happens when I hit my limit?</h4>
        <p>You will be notified when approaching your monthly limits. You can upgrade anytime to get more capacity, or wait for limits to reset at the start of each billing cycle.</p>
      </div>
      <div class="faq-item">
        <h4>Do you offer annual pricing?</h4>
        <p>Annual plans are coming soon with a significant discount. Sign up for our newsletter to be notified!</p>
      </div>
    </div>
    ${getThemeScript()}
    </body>
    </html>`;
  res.send(html);
});

module.exports = router;
