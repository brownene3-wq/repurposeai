const express = require('express');
const router = express.Router();
const { optionalAuth } = require('../middleware/auth');

router.get('/', optionalAuth, (req, res) => {
  res.send(renderLandingPage(req.user));
});

function renderLandingPage(user) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>RepurposeAI — Transform One Piece of Content Into Dozens</title>
<meta name="description" content="AI-powered content repurposing platform. Transform blog posts, videos, and podcasts into threads, reels, newsletters, and more in seconds.">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#06060f;--bg2:#0c0c1d;--bg3:#11112a;--bg4:#181842;--a1:#7c3aed;--a2:#06b6d4;--a3:#f472b6;--g1:linear-gradient(135deg,#7c3aed,#06b6d4);--g2:linear-gradient(135deg,#06b6d4,#7c3aed);--g3:linear-gradient(135deg,#f472b6,#7c3aed);--t1:#f0f0ff;--t2:#a0a0c0;--t3:#6a6a8e;--br:rgba(124,58,237,.15);--r:16px;--rs:10px;--rf:9999px}
html{scroll-behavior:smooth}
body{font-family:'Inter',-apple-system,sans-serif;background:var(--bg);color:var(--t1);line-height:1.7;overflow-x:hidden;-webkit-font-smoothing:antialiased}
a{text-decoration:none;color:inherit}ul{list-style:none}
.container{max-width:1200px;margin:0 auto;padding:0 24px}

.bg-grid{position:fixed;inset:0;z-index:0;pointer-events:none;background-image:linear-gradient(rgba(124,58,237,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(124,58,237,.03) 1px,transparent 1px);background-size:60px 60px}
.bg-orb{position:fixed;border-radius:50%;filter:blur(120px);opacity:.4;pointer-events:none;z-index:0;animation:orbF 20s ease-in-out infinite}
.bg-orb--1{width:600px;height:600px;background:var(--a1);top:-200px;right:-200px}
.bg-orb--2{width:500px;height:500px;background:var(--a2);bottom:-100px;left:-200px;animation-delay:-7s}
.bg-orb--3{width:400px;height:400px;background:var(--a3);top:50%;left:50%;transform:translate(-50%,-50%);animation-delay:-14s;opacity:.15}
@keyframes orbF{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(30px,-30px) scale(1.05)}66%{transform:translate(-20px,20px) scale(.95)}}

/* Nav */
.nav{position:fixed;top:0;left:0;right:0;z-index:1000;padding:16px 0;transition:all .4s}
.nav.scrolled{background:rgba(6,6,15,.85);backdrop-filter:blur(20px) saturate(180%);border-bottom:1px solid var(--br)}
.nav__inner{display:flex;align-items:center;justify-content:space-between;max-width:1200px;margin:0 auto;padding:0 24px}
.nav__logo{font-size:1.5rem;font-weight:800;letter-spacing:-.5px;background:var(--g1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.nav__logo span{font-weight:400;opacity:.7;-webkit-text-fill-color:var(--t2)}
.nav__links{display:flex;gap:28px;align-items:center}
.nav__links a{font-size:.9rem;font-weight:500;color:var(--t2);transition:color .3s;position:relative}
.nav__links a:hover{color:var(--t1)}
.nav__links a::after{content:'';position:absolute;bottom:-4px;left:0;width:0;height:2px;background:var(--g1);transition:width .3s}
.nav__links a:hover::after{width:100%}

.btn{display:inline-flex;align-items:center;gap:8px;padding:12px 28px;border-radius:var(--rf);font-size:.9rem;font-weight:600;border:none;cursor:pointer;transition:all .3s;position:relative;overflow:hidden;font-family:inherit}
.btn--p{background:var(--g1);color:#fff;box-shadow:0 4px 20px rgba(124,58,237,.4)}
.btn--p:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(124,58,237,.5)}
.btn--o{background:transparent;color:var(--t1);border:1px solid var(--br)}
.btn--o:hover{border-color:var(--a1);background:rgba(124,58,237,.08)}
.btn--l{padding:16px 36px;font-size:1rem}
.btn--g{background:transparent;color:var(--a2);padding:12px 20px}

.nav__mob{display:none;background:none;border:none;color:var(--t1);font-size:1.5rem;cursor:pointer}

/* Hero */
.hero{position:relative;z-index:1;padding:160px 0 100px;text-align:center;min-height:100vh;display:flex;align-items:center}
.hero__badge{display:inline-flex;align-items:center;gap:8px;background:rgba(124,58,237,.1);border:1px solid rgba(124,58,237,.25);padding:8px 20px;border-radius:var(--rf);font-size:.85rem;color:var(--a2);margin-bottom:32px;animation:fU .8s ease}
.hero__badge .pulse{width:8px;height:8px;background:#34d399;border-radius:50%;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.hero__title{font-size:clamp(2.8rem,6vw,5rem);font-weight:900;line-height:1.1;letter-spacing:-2px;margin-bottom:24px;animation:fU .8s ease .1s both}
.hero__title .gt{background:var(--g1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.hero__sub{font-size:clamp(1.1rem,2vw,1.3rem);color:var(--t2);max-width:620px;margin:0 auto 40px;line-height:1.8;animation:fU .8s ease .2s both}
.hero__actions{display:flex;gap:16px;justify-content:center;flex-wrap:wrap;animation:fU .8s ease .3s both}
.hero__stats{display:flex;gap:48px;justify-content:center;margin-top:64px;animation:fU .8s ease .4s both}
.hero__stat{text-align:center}
.hero__stat-val{font-size:2rem;font-weight:800;background:var(--g1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.hero__stat-lbl{font-size:.85rem;color:var(--t3);margin-top:4px}

/* Demo preview */
.hero__preview{margin-top:64px;position:relative;animation:fU .8s ease .5s both}
.hero__preview-inner{background:var(--bg3);border:1px solid var(--br);border-radius:20px;overflow:hidden;box-shadow:0 40px 80px rgba(0,0,0,.4)}
.preview-bar{display:flex;align-items:center;gap:8px;padding:14px 20px;background:rgba(0,0,0,.3);border-bottom:1px solid var(--br)}
.preview-dot{width:12px;height:12px;border-radius:50%;background:var(--t3);opacity:.3}
.preview-dot:nth-child(1){background:#f87171}.preview-dot:nth-child(2){background:#f59e0b}.preview-dot:nth-child(3){background:#34d399}
.preview-body{padding:32px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
.preview-card{background:rgba(255,255,255,.03);border:1px solid var(--br);border-radius:12px;padding:20px}
.preview-card__head{display:flex;align-items:center;gap:8px;margin-bottom:12px}
.preview-card__icon{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:.8rem}
.preview-card__platform{font-size:.8rem;font-weight:600;color:var(--t2)}
.preview-card__line{height:8px;border-radius:4px;margin-bottom:8px;opacity:.15}
.preview-card__line:nth-child(1){width:90%;background:var(--a1)}.preview-card__line:nth-child(2){width:70%;background:var(--a2)}.preview-card__line:nth-child(3){width:80%;background:var(--a3)}.preview-card__line:nth-child(4){width:50%;background:var(--a1)}

@keyframes fU{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}

/* Logos */
.logos{position:relative;z-index:1;padding:60px 0;border-top:1px solid var(--br);border-bottom:1px solid var(--br)}
.logos__lbl{text-align:center;font-size:.8rem;text-transform:uppercase;letter-spacing:3px;color:var(--t3);margin-bottom:32px}
.logos__grid{display:flex;justify-content:center;align-items:center;gap:48px;flex-wrap:wrap;opacity:.5}
.logos__item{font-size:1.2rem;font-weight:700;color:var(--t2);letter-spacing:1px}

/* Sections */
.section{position:relative;z-index:1;padding:120px 0}
.section__lbl{display:inline-flex;align-items:center;gap:8px;font-size:.8rem;text-transform:uppercase;letter-spacing:3px;color:var(--a2);margin-bottom:16px}
.section__title{font-size:clamp(2rem,4vw,3rem);font-weight:800;letter-spacing:-1px;line-height:1.2;margin-bottom:16px}
.section__sub{font-size:1.1rem;color:var(--t2);max-width:560px;line-height:1.8}
.section__hdr{text-align:center;margin-bottom:64px}
.section__hdr .section__sub{margin:0 auto}

/* Features */
.features__grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
.fc{background:var(--bg3);border:1px solid var(--br);border-radius:var(--r);padding:36px;transition:all .4s;position:relative;overflow:hidden}
.fc::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(124,58,237,.05),transparent);opacity:0;transition:opacity .4s}
.fc:hover{transform:translateY(-4px);border-color:rgba(124,58,237,.3)}.fc:hover::before{opacity:1}
.fc__icon{width:56px;height:56px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;margin-bottom:20px;position:relative;z-index:1}
.fc__icon--p{background:rgba(124,58,237,.15);color:var(--a1)}
.fc__icon--c{background:rgba(6,182,212,.15);color:var(--a2)}
.fc__icon--k{background:rgba(244,114,182,.15);color:var(--a3)}
.fc__t{font-size:1.15rem;font-weight:700;margin-bottom:10px;position:relative;z-index:1}
.fc__d{font-size:.95rem;color:var(--t2);line-height:1.7;position:relative;z-index:1}

/* Steps */
.steps{display:flex;flex-direction:column;gap:0;position:relative}
.steps::before{content:'';position:absolute;left:32px;top:40px;bottom:40px;width:2px;background:linear-gradient(to bottom,var(--a1),var(--a2),var(--a3));opacity:.3}
.step{display:flex;gap:32px;align-items:flex-start;padding:32px 0;position:relative}
.step__num{min-width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.3rem;font-weight:800;position:relative;z-index:2;font-family:'JetBrains Mono',monospace}
.step:nth-child(1) .step__num{background:rgba(124,58,237,.2);color:var(--a1);border:2px solid rgba(124,58,237,.4)}
.step:nth-child(2) .step__num{background:rgba(6,182,212,.2);color:var(--a2);border:2px solid rgba(6,182,212,.4)}
.step:nth-child(3) .step__num{background:rgba(244,114,182,.2);color:var(--a3);border:2px solid rgba(244,114,182,.4)}
.step__content{padding-top:8px}
.step__title{font-size:1.3rem;font-weight:700;margin-bottom:8px}
.step__desc{color:var(--t2);font-size:1rem;line-height:1.8;max-width:500px}

/* Testimonials */
.test-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
.tc{background:var(--bg3);border:1px solid var(--br);border-radius:var(--r);padding:32px;transition:all .3s}
.tc:hover{border-color:rgba(124,58,237,.3)}
.tc__stars{color:#f59e0b;font-size:.9rem;margin-bottom:16px;letter-spacing:2px}
.tc__text{font-size:.95rem;color:var(--t2);line-height:1.8;margin-bottom:24px;font-style:italic}
.tc__author{display:flex;align-items:center;gap:12px}
.tc__avatar{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.9rem}
.tc__name{font-size:.9rem;font-weight:600}
.tc__role{font-size:.8rem;color:var(--t3)}

/* FAQ */
.faq__list{max-width:720px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
.fi{background:var(--bg3);border:1px solid var(--br);border-radius:var(--rs);overflow:hidden;transition:border-color .3s}
.fi.active{border-color:rgba(124,58,237,.4)}
.fi__q{width:100%;padding:20px 24px;display:flex;align-items:center;justify-content:space-between;background:none;border:none;color:var(--t1);font-size:1rem;font-weight:600;cursor:pointer;font-family:inherit;text-align:left;transition:color .3s}
.fi__q:hover{color:var(--a2)}
.fi__icon{font-size:1.2rem;transition:transform .3s;color:var(--a1);flex-shrink:0}
.fi.active .fi__icon{transform:rotate(45deg)}
.fi__a{max-height:0;overflow:hidden;transition:max-height .4s ease,padding .4s ease}
.fi.active .fi__a{max-height:300px}
.fi__a-inner{padding:0 24px 20px;font-size:.95rem;color:var(--t2);line-height:1.8}

/* CTA */
.cta{position:relative;z-index:1;padding:120px 0}
.cta__box{background:linear-gradient(135deg,rgba(124,58,237,.15),rgba(6,182,212,.1));border:1px solid rgba(124,58,237,.25);border-radius:24px;padding:80px 60px;text-align:center;position:relative;overflow:hidden}
.cta__box::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 50% 0%,rgba(124,58,237,.2),transparent 70%)}
.cta__title{font-size:clamp(2rem,4vw,2.8rem);font-weight:800;letter-spacing:-1px;margin-bottom:16px;position:relative;z-index:1}
.cta__sub{font-size:1.1rem;color:var(--t2);margin-bottom:32px;max-width:500px;margin-left:auto;margin-right:auto;position:relative;z-index:1}
.cta__actions{position:relative;z-index:1;display:flex;gap:16px;justify-content:center;flex-wrap:wrap}

/* Footer */
.footer{position:relative;z-index:1;padding:60px 0 30px;border-top:1px solid var(--br)}
.footer__grid{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:48px;margin-bottom:48px}
.footer__brand-desc{color:var(--t3);font-size:.9rem;margin-top:12px;max-width:300px;line-height:1.7}
.footer__col-title{font-size:.8rem;text-transform:uppercase;letter-spacing:2px;color:var(--t3);margin-bottom:20px;font-weight:600}
.footer__link{display:block;padding:6px 0;font-size:.9rem;color:var(--t2);transition:color .3s}
.footer__link:hover{color:var(--t1)}
.footer__bottom{display:flex;justify-content:space-between;align-items:center;padding-top:30px;border-top:1px solid var(--br);font-size:.8rem;color:var(--t3)}
.footer__socials{display:flex;gap:16px}
.footer__social{width:36px;height:36px;border-radius:50%;border:1px solid var(--br);display:flex;align-items:center;justify-content:center;font-size:.85rem;color:var(--t2);transition:all .3s}
.footer__social:hover{border-color:var(--a1);color:var(--a1);background:rgba(124,58,237,.1)}

.reveal{opacity:0;transform:translateY(40px);transition:all .8s cubic-bezier(.16,1,.3,1)}
.reveal.visible{opacity:1;transform:translateY(0)}

@media(max-width:968px){
  .features__grid,.test-grid{grid-template-columns:1fr;max-width:480px;margin:0 auto}
  .footer__grid{grid-template-columns:1fr 1fr;gap:32px}
  .hero__stats{gap:32px}.nav__links{display:none}.nav__mob{display:block}
  .nav__links.open{display:flex;flex-direction:column;position:absolute;top:70px;left:16px;right:16px;background:var(--bg2);border:1px solid var(--br);border-radius:var(--r);padding:24px;gap:16px}
  .preview-body{grid-template-columns:1fr}
  .steps::before{left:28px}
}
@media(max-width:600px){
  .hero__stats{flex-direction:column;gap:20px}
  .footer__grid{grid-template-columns:1fr}
  .footer__bottom{flex-direction:column;gap:16px}
  .cta__box{padding:48px 24px}
}
</style>
</head>
<body>

<div class="bg-grid"></div>
<div class="bg-orb bg-orb--1"></div>
<div class="bg-orb bg-orb--2"></div>
<div class="bg-orb bg-orb--3"></div>

<!-- NAV -->
<nav class="nav" id="nav">
  <div class="nav__inner">
    <a href="/" class="nav__logo">Repurpose<span>AI</span></a>
    <div class="nav__links" id="navLinks">
      <a href="#features">Features</a>
      <a href="#how-it-works">How It Works</a>
      <a href="/pricing">Pricing</a>
      <a href="#testimonials">Reviews</a>
      <a href="/contact">Contact</a>
      ${user
        ? `<a href="/dashboard" class="btn btn--p">Dashboard</a>`
        : `<a href="/login" style="color:var(--a2);font-weight:600">Log In</a><a href="/signup" class="btn btn--p">Get Started Free</a>`}
    </div>
    <button class="nav__mob" id="mobToggle" aria-label="Menu">&#9776;</button>
  </div>
</nav>

<!-- HERO -->
<section class="hero">
  <div class="container">
    <div class="hero__badge"><span class="pulse"></span>Now powered by GPT-4o & Claude 4</div>
    <h1 class="hero__title">One Piece of Content.<br><span class="gt">Infinite Possibilities.</span></h1>
    <p class="hero__sub">Transform a single blog post, video, or podcast into dozens of high-performing assets — threads, reels, newsletters, carousels, and more — in seconds.</p>
    <div class="hero__actions">
      <a href="${user ? '/dashboard' : '/signup'}" class="btn btn--p btn--l">Start Repurposing Free &rarr;</a>
      <a href="#how-it-works" class="btn btn--o btn--l">See How It Works</a>
    </div>
    <div class="hero__stats">
      <div class="hero__stat"><div class="hero__stat-val">12,000+</div><div class="hero__stat-lbl">Creators & Marketers</div></div>
      <div class="hero__stat"><div class="hero__stat-val">2.4M+</div><div class="hero__stat-lbl">Assets Generated</div></div>
      <div class="hero__stat"><div class="hero__stat-val">50+</div><div class="hero__stat-lbl">Output Formats</div></div>
    </div>

    <!-- App Preview -->
    <div class="hero__preview">
      <div class="hero__preview-inner">
        <div class="preview-bar"><span class="preview-dot"></span><span class="preview-dot"></span><span class="preview-dot"></span><span style="flex:1"></span><span style="font-size:.75rem;color:var(--t3)">repurposeai.com/dashboard</span></div>
        <div class="preview-body">
          <div class="preview-card">
            <div class="preview-card__head"><div class="preview-card__icon" style="background:rgba(29,161,242,.15);color:#1da1f2">&#120143;</div><span class="preview-card__platform">X / Twitter Thread</span></div>
            <div class="preview-card__line"></div><div class="preview-card__line"></div><div class="preview-card__line"></div><div class="preview-card__line"></div>
          </div>
          <div class="preview-card">
            <div class="preview-card__head"><div class="preview-card__icon" style="background:rgba(0,119,181,.15);color:#0077b5">in</div><span class="preview-card__platform">LinkedIn Post</span></div>
            <div class="preview-card__line"></div><div class="preview-card__line"></div><div class="preview-card__line"></div><div class="preview-card__line"></div>
          </div>
          <div class="preview-card">
            <div class="preview-card__head"><div class="preview-card__icon" style="background:rgba(225,48,108,.15);color:#e1306c">&#128247;</div><span class="preview-card__platform">Instagram Caption</span></div>
            <div class="preview-card__line"></div><div class="preview-card__line"></div><div class="preview-card__line"></div><div class="preview-card__line"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- LOGOS -->
<section class="logos">
  <div class="container">
    <p class="logos__lbl">Trusted by teams at</p>
    <div class="logos__grid">
      <span class="logos__item">Shopify</span><span class="logos__item">HubSpot</span><span class="logos__item">Notion</span><span class="logos__item">Vercel</span><span class="logos__item">Stripe</span><span class="logos__item">Linear</span>
    </div>
  </div>
</section>

<!-- FEATURES -->
<section class="section" id="features">
  <div class="container">
    <div class="section__hdr reveal">
      <p class="section__lbl">&#9830; Features</p>
      <h2 class="section__title">Everything You Need to<br>10x Your Content Output</h2>
      <p class="section__sub">Powered by the latest AI models, fine-tuned specifically for content repurposing across every major platform.</p>
    </div>
    <div class="features__grid">
      <div class="fc reveal"><div class="fc__icon fc__icon--p">&#9889;</div><h3 class="fc__t">Instant Multi-Format</h3><p class="fc__d">Drop in any content — blog, video transcript, podcast — and get threads, carousels, reels scripts, emails, and more in one click.</p></div>
      <div class="fc reveal"><div class="fc__icon fc__icon--c">&#127912;</div><h3 class="fc__t">Brand Voice AI</h3><p class="fc__d">Train the AI on your unique tone, vocabulary, and style. Every output sounds authentically you — not like a robot wrote it.</p></div>
      <div class="fc reveal"><div class="fc__icon fc__icon--k">&#128200;</div><h3 class="fc__t">Platform Optimization</h3><p class="fc__d">Auto-optimized for each platform's algorithm — character limits, hashtags, hooks, and formatting handled automatically.</p></div>
      <div class="fc reveal"><div class="fc__icon fc__icon--c">&#128197;</div><h3 class="fc__t">Smart Scheduling</h3><p class="fc__d">Built-in scheduler with AI-recommended posting times. Publish across LinkedIn, X, Instagram, TikTok, and newsletters from one dashboard.</p></div>
      <div class="fc reveal"><div class="fc__icon fc__icon--p">&#128301;</div><h3 class="fc__t">Visual Asset Generator</h3><p class="fc__d">Auto-generate carousel images, quote cards, and video thumbnails that match your brand guidelines and color palette.</p></div>
      <div class="fc reveal"><div class="fc__icon fc__icon--k">&#128640;</div><h3 class="fc__t">Team Collaboration</h3><p class="fc__d">Invite your team, manage approval workflows, leave comments, and track performance — all in one workspace.</p></div>
    </div>
  </div>
</section>

<!-- HOW IT WORKS -->
<section class="section" id="how-it-works" style="background:var(--bg2)">
  <div class="container">
    <div class="section__hdr reveal">
      <p class="section__lbl">&#9881; Process</p>
      <h2 class="section__title">Three Steps. Zero Effort.</h2>
      <p class="section__sub">Go from one piece of content to a full week's content calendar in under 60 seconds.</p>
    </div>
    <div class="steps">
      <div class="step reveal"><div class="step__num">01</div><div class="step__content"><h3 class="step__title">Drop Your Content</h3><p class="step__desc">Paste a URL, upload a file, or connect your CMS. We support blog posts, YouTube videos, podcast episodes, webinar recordings, and more.</p></div></div>
      <div class="step reveal"><div class="step__num">02</div><div class="step__content"><h3 class="step__title">Choose Your Formats</h3><p class="step__desc">Select which platforms and formats you want — X threads, LinkedIn posts, Instagram carousels, email newsletters, short-form video scripts, or let AI pick the best mix.</p></div></div>
      <div class="step reveal"><div class="step__num">03</div><div class="step__content"><h3 class="step__title">Review & Publish</h3><p class="step__desc">Edit in our beautiful visual editor, refine with AI suggestions, then schedule or publish directly. Track engagement across all platforms in one dashboard.</p></div></div>
    </div>
  </div>
</section>

<!-- TESTIMONIALS -->
<section class="section" id="testimonials" style="background:var(--bg2)">
  <div class="container">
    <div class="section__hdr reveal">
      <p class="section__lbl">&#11088; Testimonials</p>
      <h2 class="section__title">Loved by 12,000+ Creators</h2>
      <p class="section__sub">See why content creators and marketing teams are switching to RepurposeAI.</p>
    </div>
    <div class="test-grid">
      <div class="tc reveal"><div class="tc__stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div><p class="tc__text">"I used to spend 6 hours repurposing a single podcast episode. Now it takes me 5 minutes. RepurposeAI literally gave me my weekends back."</p><div class="tc__author"><div class="tc__avatar" style="background:rgba(124,58,237,.2);color:var(--a1)">SR</div><div><p class="tc__name">Sarah Rodriguez</p><p class="tc__role">Content Strategist, TechFlow</p></div></div></div>
      <div class="tc reveal"><div class="tc__stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div><p class="tc__text">"The brand voice feature is insane. Our CEO's LinkedIn posts sound exactly like him — and we're publishing 5x more content than before."</p><div class="tc__author"><div class="tc__avatar" style="background:rgba(6,182,212,.2);color:var(--a2)">MK</div><div><p class="tc__name">Marcus Kim</p><p class="tc__role">Head of Marketing, ScaleUp</p></div></div></div>
      <div class="tc reveal"><div class="tc__stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div><p class="tc__text">"We replaced 3 tools and 2 freelancers with RepurposeAI. The ROI is unreal. Best investment our agency has made this year."</p><div class="tc__author"><div class="tc__avatar" style="background:rgba(244,114,182,.2);color:var(--a3)">AL</div><div><p class="tc__name">Aisha Larsson</p><p class="tc__role">Founder, ContentLab Agency</p></div></div></div>
    </div>
  </div>
</section>

<!-- FAQ -->
<section class="section" id="faq">
  <div class="container">
    <div class="section__hdr reveal"><p class="section__lbl">&#10067; FAQ</p><h2 class="section__title">Frequently Asked Questions</h2><p class="section__sub">Everything you need to know about RepurposeAI.</p></div>
    <div class="faq__list">
      <div class="fi reveal"><button class="fi__q">What types of content can I repurpose?<span class="fi__icon">+</span></button><div class="fi__a"><div class="fi__a-inner">You can repurpose virtually any content: blog posts, YouTube videos, podcast episodes, webinar recordings, PDF documents, newsletters, and even raw transcripts. Just paste a URL or upload a file and we handle the rest.</div></div></div>
      <div class="fi reveal"><button class="fi__q">How does the Brand Voice AI work?<span class="fi__icon">+</span></button><div class="fi__a"><div class="fi__a-inner">Upload 3-5 samples of your existing content, and our AI learns your unique tone, vocabulary, sentence structure, and style. Every output is then generated in your voice — so it sounds like you wrote it, not a machine.</div></div></div>
      <div class="fi reveal"><button class="fi__q">Which platforms are supported?<span class="fi__icon">+</span></button><div class="fi__a"><div class="fi__a-inner">We support over 50 output formats including X/Twitter threads, LinkedIn posts & carousels, Instagram captions & reels scripts, TikTok scripts, YouTube Shorts scripts, email newsletters, blog posts, Facebook posts, Pinterest pins, and more.</div></div></div>
      <div class="fi reveal"><button class="fi__q">Can I cancel my subscription anytime?<span class="fi__icon">+</span></button><div class="fi__a"><div class="fi__a-inner">Absolutely. No contracts, no commitments. Cancel anytime from your dashboard and you won't be charged again. Your content and settings are saved for 30 days in case you decide to come back.</div></div></div>
      <div class="fi reveal"><button class="fi__q">Is there an API for developers?<span class="fi__icon">+</span></button><div class="fi__a"><div class="fi__a-inner">Yes! Our Enterprise plan includes full REST API access with comprehensive documentation, SDKs for Python and JavaScript, and webhook support. You can integrate RepurposeAI directly into your existing workflows.</div></div></div>
    </div>
  </div>
</section>

<!-- CTA -->
<section class="cta" id="cta">
  <div class="container"><div class="cta__box reveal">
    <h2 class="cta__title">Ready to 10x Your<br>Content Output?</h2>
    <p class="cta__sub">Join 12,000+ creators and marketers who are saving 20+ hours every week with RepurposeAI.</p>
    <div class="cta__actions">
      <a href="${user ? '/dashboard' : '/signup'}" class="btn btn--p btn--l">Start Your Free Trial &rarr;</a>
      <a href="/contact" class="btn btn--g btn--l">Book a Demo</a>
    </div>
  </div></div>
</section>

<!-- FOOTER -->
<footer class="footer">
  <div class="container">
    <div class="footer__grid">
      <div><a href="/" class="nav__logo">Repurpose<span>AI</span></a><p class="footer__brand-desc">Transform one piece of content into dozens of high-performing assets, automatically. Powered by the latest AI.</p></div>
      <div><p class="footer__col-title">Product</p><a href="#features" class="footer__link">Features</a><a href="/pricing" class="footer__link">Pricing</a><a href="#" class="footer__link">Integrations</a><a href="#" class="footer__link">API Docs</a></div>
      <div><p class="footer__col-title">Company</p><a href="#" class="footer__link">About</a><a href="#" class="footer__link">Blog</a><a href="/contact" class="footer__link">Contact</a><a href="#" class="footer__link">Careers</a></div>
      <div><p class="footer__col-title">Legal</p><a href="#" class="footer__link">Privacy Policy</a><a href="#" class="footer__link">Terms of Service</a><a href="#" class="footer__link">Cookie Policy</a></div>
    </div>
    <div class="footer__bottom">
      <p>&copy; 2026 RepurposeAI. All rights reserved.</p>
      <div class="footer__socials">
        <a href="#" class="footer__social" aria-label="X">&#120143;</a>
        <a href="#" class="footer__social" aria-label="LinkedIn">in</a>
        <a href="#" class="footer__social" aria-label="YouTube">&#9654;</a>
      </div>
    </div>
  </div>
</footer>

<script>
const nav=document.getElementById('nav');
window.addEventListener('scroll',()=>nav.classList.toggle('scrolled',window.scrollY>50));
const mobToggle=document.getElementById('mobToggle'),navLinks=document.getElementById('navLinks');
mobToggle.addEventListener('click',()=>navLinks.classList.toggle('open'));
navLinks.querySelectorAll('a').forEach(l=>l.addEventListener('click',()=>navLinks.classList.remove('open')));
document.querySelectorAll('a[href^="#"]').forEach(a=>{a.addEventListener('click',function(e){e.preventDefault();const t=document.querySelector(this.getAttribute('href'));if(t)t.scrollIntoView({behavior:'smooth',block:'start'})})});
const obs=new IntersectionObserver(e=>{e.forEach((en,i)=>{if(en.isIntersecting){setTimeout(()=>en.target.classList.add('visible'),i*80);obs.unobserve(en.target)}})},{threshold:.1,rootMargin:'0px 0px -50px 0px'});
document.querySelectorAll('.reveal').forEach(el=>obs.observe(el));
document.querySelectorAll('.fi__q').forEach(b=>{b.addEventListener('click',()=>{const i=b.parentElement,a=i.classList.contains('active');document.querySelectorAll('.fi').forEach(x=>x.classList.remove('active'));if(!a)i.classList.add('active')})});
</script>
</body>
</html>`;
}

module.exports = router;
