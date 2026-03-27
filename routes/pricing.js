const express = require('express');
const router = express.Router();

router.get('/pricing', (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pricing - RepurposeAI</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#x26A1;</text></svg>">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:wght@700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', sans-serif; background: #0a0a0f; color: #e0e0e0; min-height: 100vh; }
    nav { display: flex; justify-content: space-between; align-items: center; padding: 1.5rem 4rem; background: rgba(10,10,15,0.95); backdrop-filter: blur(20px); border-bottom: 1px solid rgba(139,92,246,0.1); position: sticky; top: 0; z-index: 100; }
    .logo { font-family: 'Playfair Display', serif; font-size: 1.5rem; color: #a855f7; text-decoration: none; }
    .logo::before { content: "\\26A1 "; }
    .nav-links { display: flex; gap: 2rem; align-items: center; }
    .nav-links a { color: #9ca3af; text-decoration: none; font-size: 0.9rem; transition: color 0.3s; }
    .nav-links a:hover { color: #a855f7; }
    .nav-links .btn-primary { background: linear-gradient(135deg, #a855f7, #6366f1); color: white; padding: 0.6rem 1.5rem; border-radius: 8px; font-weight: 500; }
    .pricing-page { max-width: 1200px; margin: 0 auto; padding: 4rem 2rem; text-align: center; }
    .page-header h1 { font-family: 'Playfair Display', serif; font-size: 3rem; margin-bottom: 1rem; background: linear-gradient(135deg, #a855f7, #6366f1); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .page-header p { color: #9ca3af; font-size: 1.2rem; margin-bottom: 3rem; }
    .plans-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2rem; margin-top: 2rem; }
    .plan-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(139,92,246,0.15); border-radius: 16px; padding: 2.5rem; text-align: left; transition: transform 0.3s, border-color 0.3s; }
    .plan-card:hover { transform: translateY(-4px); border-color: rgba(139,92,246,0.4); }
    .plan-card.featured { border-color: #a855f7; background: rgba(139,92,246,0.08); position: relative; }
    .plan-card.featured::before { content: "Most Popular"; position: absolute; top: -12px; left: 50%; transform: translateX(-50%); background: linear-gradient(135deg, #a855f7, #6366f1); color: white; padding: 0.3rem 1rem; border-radius: 20px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .plan-name { font-size: 1.3rem; font-weight: 600; color: #e0e0e0; margin-bottom: 0.5rem; }
    .plan-price { font-size: 3rem; font-weight: 700; color: #fff; margin-bottom: 0.5rem; }
    .plan-price span { font-size: 1rem; color: #9ca3af; font-weight: 400; }
    .plan-desc { color: #9ca3af; font-size: 0.9rem; margin-bottom: 1.5rem; padding-bottom: 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .plan-features { list-style: none; margin-bottom: 2rem; }
    .plan-features li { padding: 0.5rem 0; color: #c0c0c0; font-size: 0.9rem; }
    .plan-features li::before { content: "\\2713"; color: #a855f7; margin-right: 0.75rem; font-weight: 600; }
    .plan-btn { display: block; width: 100%; padding: 0.9rem; border-radius: 10px; font-size: 1rem; font-weight: 600; text-align: center; text-decoration: none; cursor: pointer; transition: all 0.3s; border: none; }
    .plan-btn.primary { background: linear-gradient(135deg, #a855f7, #6366f1); color: white; }
    .plan-btn.primary:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(139,92,246,0.3); }
    .plan-btn.secondary { background: rgba(255,255,255,0.05); color: #e0e0e0; border: 1px solid rgba(139,92,246,0.3); }
    .plan-btn.secondary:hover { background: rgba(139,92,246,0.1); }
    .faq-section { margin-top: 5rem; text-align: left; max-width: 700px; margin-left: auto; margin-right: auto; }
    .faq-section h2 { text-align: center; font-family: 'Playfair Display', serif; font-size: 2rem; margin-bottom: 2rem; color: #e0e0e0; }
    .faq-item { background: rgba(255,255,255,0.03); border: 1px solid rgba(139,92,246,0.1); border-radius: 12px; padding: 1.5rem; margin-bottom: 1rem; }
    .faq-item h3 { color: #e0e0e0; font-size: 1rem; font-weight: 600; margin-bottom: 0.5rem; }
    .faq-item p { color: #9ca3af; font-size: 0.9rem; line-height: 1.6; }
    @media (max-width: 768px) { nav { padding: 1rem 1.5rem; } .plans-grid { grid-template-columns: 1fr; } .page-header h1 { font-size: 2rem; } }
  </style>
</head>
<body>
  <nav>
    <a href="/" class="logo">RepurposeAI</a>
    <div class="nav-links">
      <a href="/#features">Features</a>
      <a href="/pricing">Pricing</a>
      <a href="/contact">Contact</a>
      <a href="/auth/login" class="btn-primary">Get Started</a>
    </div>
  </nav>
  <div class="pricing-page">
    <div class="page-header">
      <h1>Simple, Transparent Pricing</h1>
      <p>Choose the plan that fits your content creation needs</p>
    </div>
    <div class="plans-grid">
      <div class="plan-card">
        <div class="plan-name">Free</div>
        <div class="plan-price">\$0 <span>/month</span></div>
        <div class="plan-desc">Perfect for trying out AI-powered content repurposing</div>
        <ul class="plan-features">
          <li>3 repurposes per month</li>
          <li>YouTube video support</li>
          <li>7 platform formats</li>
          <li>Basic AI captions</li>
          <li>Content library</li>
          <li>Community support</li>
        </ul>
        <a href="/auth/register" class="plan-btn secondary">Get Started Free</a>
      </div>
      <div class="plan-card featured">
        <div class="plan-name">Pro</div>
        <div class="plan-price">\$29 <span>/month</span></div>
        <div class="plan-desc">For creators who need unlimited repurposing power</div>
        <ul class="plan-features">
          <li>Unlimited repurposes</li>
          <li>Smart Shorts AI analysis</li>
          <li>All 7 platform formats</li>
          <li>Advanced AI captions</li>
          <li>Up to 10 brand voices</li>
          <li>Content calendar</li>
          <li>Analytics dashboard</li>
          <li>Priority support</li>
        </ul>
        <a href="/auth/register" class="plan-btn primary">Start Pro Trial</a>
      </div>
      <div class="plan-card">
        <div class="plan-name">Enterprise</div>
        <div class="plan-price">\$99 <span>/month</span></div>
        <div class="plan-desc">For teams and agencies managing multiple brands</div>
        <ul class="plan-features">
          <li>Everything in Pro</li>
          <li>Unlimited brand voices</li>
          <li>Unlimited Smart Shorts</li>
          <li>Advanced analytics</li>
          <li>Dedicated account manager</li>
          <li>Priority email support</li>
          <li>Custom onboarding</li>
        </ul>
        <a href="/contact" class="plan-btn secondary">Contact Sales</a>
      </div>
    </div>
    <div class="faq-section">
      <h2>Frequently Asked Questions</h2>
      <div class="faq-item">
        <h3>Can I upgrade or downgrade at any time?</h3>
        <p>Yes! You can change your plan at any time. Upgrades take effect immediately, and downgrades apply at the end of your billing cycle.</p>
      </div>
      <div class="faq-item">
        <h3>What payment methods do you accept?</h3>
        <p>We accept all major credit cards through our secure payment processor, Stripe.</p>
      </div>
      <div class="faq-item">
        <h3>Is there a free trial for Pro?</h3>
        <p>Yes! Sign up for Pro and try it free for 7 days. Cancel anytime before the trial ends.</p>
      </div>
      <div class="faq-item">
        <h3>What counts as a repurpose?</h3>
        <p>Each time you submit a YouTube video URL and generate content for social platforms, that counts as one repurpose.</p>
      </div>
      <div class="faq-item">
        <h3>What is Smart Shorts?</h3>
        <p>Smart Shorts uses AI to analyze YouTube video transcripts and identify the most viral-worthy moments. It then generates platform-optimized scripts, hooks, captions, and hashtags for TikTok, Instagram Reels, and YouTube Shorts.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
  res.send(html);
});

module.exports = router;
