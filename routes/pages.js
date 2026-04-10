const express = require('express');
const router = express.Router();

const BRAND = { name: 'Splicora', tagline: 'Turn One Video Into Unlimited Content' };

function getStyles() {
  return `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Playfair+Display:wght@700;800;900&display=swap');
:root{--primary:#6C3AED;--primary-light:#8B5CF6;--primary-dark:#5B21B6;--accent:#F59E0B;--dark:#0F0F1A;--dark-2:#1A1A2E;--surface:#1E1E32;--surface-light:#2A2A40;--text:#FFF;--text-muted:#A0AEC0;--text-dim:#718096;--gradient-1:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);--gradient-2:linear-gradient(135deg,#F59E0B 0%,#EF4444 100%);--gradient-3:linear-gradient(135deg,#6C3AED 0%,#3B82F6 50%,#EC4899 100%);--shadow-glow:0 0 60px rgba(108,58,237,0.3);--border-subtle:1px solid rgba(255,255,255,0.06)}
[data-theme="light"],body.light{--dark:#F8F9FC;--dark-2:#EDF0F7;--surface:#FFFFFF;--surface-light:#F1F5F9;--text:#1A1A2E;--text-muted:#4A5568;--text-dim:#718096;--border-subtle:1px solid rgba(0,0,0,0.08);--shadow-glow:0 0 60px rgba(108,58,237,0.15);--gradient-3:linear-gradient(135deg,#5B21B6 0%,#7C3AED 30%,#DB2777 100%)}
[data-theme="light"] .nav,body.light .nav{background:rgba(248,249,252,0.85);border-bottom:1px solid rgba(0,0,0,0.08)}
[data-theme="light"] .nav-links a,body.light .nav-links a{color:#374151;font-weight:600}
[data-theme="light"] .nav-links a:hover,body.light .nav-links a:hover{color:#5B21B6}
[data-theme="light"] .nav-links .btn-outline,body.light .nav-links .btn-outline{border-color:rgba(0,0,0,0.2);color:#1A1A2E}
[data-theme="light"] .nav-links .btn-outline:hover,body.light .nav-links .btn-outline:hover{border-color:#5B21B6;color:#5B21B6}
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
.hero-input-group{display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;margin-bottom:3rem;max-width:700px;margin-left:auto;margin-right:auto}
.hero-input{flex:1;min-width:250px;padding:1rem 1.5rem;background:var(--surface);border:1px solid rgba(108,58,237,0.3);border-radius:50px;color:var(--text);font-size:.95rem}
.carousel-container{position:relative;margin-top:4rem;max-width:980px;margin-left:50%;transform:translateX(-50%);width:85vw;padding:0 40px;box-sizing:border-box}
.carousel{display:flex;overflow:hidden}
.carousel-slide{flex:0 0 100%;display:flex;justify-content:center;align-items:center;min-height:530px}
.carousel-showcase{width:100%;display:flex;align-items:center;justify-content:center;gap:32px;padding:20px}
.carousel-showcase.layout-editor{flex-direction:column;gap:0}
.carousel-showcase.layout-beforeafter{flex-direction:row;gap:40px}
.carousel-showcase.layout-centered{flex-direction:column;align-items:center}
.carousel-screen{background:#111118;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;position:relative;box-shadow:0 25px 80px rgba(0,0,0,0.6),0 0 0 1px rgba(255,255,255,0.05)}
.carousel-screen-main{width:100%;max-width:820px;aspect-ratio:16/9;display:flex;flex-direction:column}
.carousel-screen-topbar{height:36px;background:#1a1a28;display:flex;align-items:center;padding:0 14px;gap:8px;border-bottom:1px solid rgba(255,255,255,0.06)}
.carousel-screen-dot{width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,0.1)}
.carousel-screen-dot:nth-child(1){background:#ff5f57}
.carousel-screen-dot:nth-child(2){background:#ffbd2e}
.carousel-screen-dot:nth-child(3){background:#28c840}
.carousel-screen-body{flex:1;display:flex;position:relative;overflow:hidden}
.carousel-video-area{flex:1;background:#0d0d14;position:relative;display:flex;align-items:center;justify-content:center}
.carousel-video-placeholder{width:100%;height:100%;background:linear-gradient(135deg,#151525 0%,#1a1a30 50%,#151525 100%);display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}
.carousel-video-placeholder img,.carousel-video-placeholder video{width:100%;height:100%;object-fit:cover}
.carousel-video-play{width:64px;height:64px;border-radius:50%;background:rgba(108,58,237,0.9);display:flex;align-items:center;justify-content:center;font-size:1.5rem;color:#fff;box-shadow:0 8px 30px rgba(108,58,237,0.4);position:absolute;z-index:2;cursor:pointer;transition:transform .2s}
.carousel-video-play:hover{transform:scale(1.1)}
.carousel-caption-bar{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);backdrop-filter:blur(12px);padding:10px 20px;border-radius:8px;font-size:.95rem;color:#fff;font-weight:600;z-index:3;white-space:nowrap;border:1px solid rgba(255,255,255,0.08)}
.carousel-caption-bar .highlight{color:#f59e0b;text-transform:uppercase}
.carousel-sidebar{width:200px;background:#141420;border-left:1px solid rgba(255,255,255,0.06);display:flex;flex-direction:column;gap:8px;padding:12px;overflow:hidden}
.carousel-sidebar-item{height:44px;border-radius:8px;display:flex;align-items:center;gap:8px;padding:0 10px;font-size:.75rem;color:var(--text-muted);border:1px solid rgba(255,255,255,0.06);background:rgba(108,58,237,0.06)}
.carousel-sidebar-thumb{width:32px;height:32px;border-radius:6px;background:linear-gradient(135deg,rgba(108,58,237,0.3),rgba(236,72,153,0.2));flex-shrink:0}
.carousel-sidebar-badge{padding:2px 8px;border-radius:4px;background:rgba(108,58,237,0.2);color:var(--primary-light);font-size:.65rem;font-weight:700;margin-left:auto}
.carousel-timeline-bar{height:80px;background:#141420;border-top:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:4px;padding:10px 14px;overflow:hidden}
.carousel-timeline-clip{height:56px;border-radius:6px;flex:1;min-width:80px;position:relative;overflow:hidden;border:1px solid rgba(255,255,255,0.08)}
.carousel-timeline-clip.active{border-color:rgba(108,58,237,0.6);box-shadow:0 0 12px rgba(108,58,237,0.3)}
.carousel-timeline-clip-inner{width:100%;height:100%;background:linear-gradient(135deg,rgba(108,58,237,0.15),rgba(59,130,246,0.1))}
.carousel-timeline-scrubber{position:absolute;top:0;bottom:0;width:2px;background:#fff;left:40%;z-index:2;box-shadow:0 0 6px rgba(255,255,255,0.5)}
.cs-before-after{display:flex;gap:40px;align-items:flex-end}
.cs-device{border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);background:#111118;box-shadow:0 25px 80px rgba(0,0,0,0.6)}
.cs-device-landscape{width:520px;aspect-ratio:16/10}
.cs-device-portrait{width:240px;aspect-ratio:9/16}
.cs-device-inner{width:100%;height:100%;background:linear-gradient(135deg,#151525,#1a1a30);display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}
.cs-device-inner img,.cs-device-inner video{width:100%;height:100%;object-fit:cover}
.cs-device-label{text-align:center;margin-top:12px;font-size:.85rem;color:var(--text-muted);font-weight:600}
.cs-device-caption{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);font-size:1.1rem;font-weight:800;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,0.8);white-space:nowrap;z-index:2}
.cs-device-caption .highlight{color:#f59e0b;text-transform:uppercase}
.cs-arrow{font-size:2rem;color:var(--primary-light);flex-shrink:0}
.carousel-dots{display:flex;gap:8px;justify-content:center;margin-top:1rem}
.carousel-dot{width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,0.15);cursor:pointer;transition:all .3s}
.carousel-dot.active{background:var(--primary);box-shadow:0 0 10px rgba(108,58,237,0.5)}
.carousel-nav{position:absolute;top:50%;transform:translateY(-50%);width:56px;height:56px;border-radius:50%;background:rgba(15,15,25,0.55);border:1px solid rgba(255,255,255,0.12);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:transform .35s cubic-bezier(.34,1.56,.64,1),background .3s,border-color .3s,box-shadow .35s;z-index:20;backdrop-filter:blur(14px) saturate(1.4);-webkit-backdrop-filter:blur(14px) saturate(1.4);box-shadow:0 10px 30px rgba(0,0,0,0.35),inset 0 0 0 1px rgba(255,255,255,0.04)}
.carousel-nav svg{width:22px;height:22px;stroke:#fff;stroke-width:2.5;fill:none;stroke-linecap:round;stroke-linejoin:round;transition:transform .3s}
.carousel-nav::before{content:"";position:absolute;inset:-2px;border-radius:50%;padding:2px;background:linear-gradient(135deg,rgba(108,58,237,.85),rgba(236,72,153,.85));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;opacity:0;transition:opacity .35s}
.carousel-nav:hover{transform:translateY(-50%) scale(1.08);background:rgba(20,18,38,0.75);box-shadow:0 16px 42px rgba(108,58,237,0.45),0 0 0 1px rgba(255,255,255,0.12)}
.carousel-nav:hover::before{opacity:1}
.carousel-nav:hover svg{transform:scale(1.1)}
.carousel-nav.prev{left:-8px}
.carousel-nav.next{right:-8px}
.carousel-nav.prev:hover svg{transform:scale(1.1) translateX(-2px)}
.carousel-nav.next:hover svg{transform:scale(1.1) translateX(2px)}
.carousel-nav:active{transform:translateY(-50%) scale(.96)}
.carousel-counter{display:inline-flex;align-items:center;gap:10px;margin-top:20px;padding:8px 18px;background:rgba(20,20,36,0.55);border:1px solid rgba(255,255,255,0.08);border-radius:50px;font-size:.78rem;color:var(--text-muted);font-weight:500;backdrop-filter:blur(10px);letter-spacing:.3px}
.carousel-counter-dot{width:6px;height:6px;border-radius:50%;background:linear-gradient(135deg,#6C3AED,#EC4899);box-shadow:0 0 8px rgba(108,58,237,.6)}
.carousel-counter-wrap{display:flex;justify-content:center}
.carousel-slide-label{text-align:center;margin-top:16px;font-size:.85rem;color:var(--text-muted);font-weight:500}
.carousel-cta{display:flex;align-items:center;gap:12px;justify-content:center;margin-top:24px;padding:14px 24px;background:rgba(20,20,36,0.6);border-radius:50px;border:1px solid rgba(255,255,255,0.08);max-width:500px;margin-left:auto;margin-right:auto}
.carousel-cta-input{flex:1;background:none;border:none;color:var(--text-muted);font-size:.9rem;outline:none}
.carousel-cta-btn{padding:10px 24px;border-radius:50px;background:#fff;color:#000;font-weight:700;font-size:.85rem;border:none;cursor:pointer;white-space:nowrap}
.carousel-labels{display:flex;gap:1rem;flex-wrap:wrap;justify-content:center;margin-top:2rem}
.carousel-label{padding:.6rem 1.2rem;border-radius:50px;background:rgba(108,58,237,0.1);border:1px solid rgba(108,58,237,0.2);color:var(--text-muted);font-size:.85rem;cursor:pointer;transition:all .3s}
.carousel-label.active{background:var(--gradient-1);color:#fff;border-color:var(--primary)}
.stats-marquee{overflow:hidden;background:linear-gradient(180deg,rgba(108,58,237,0.06) 0%,var(--dark-2) 50%,rgba(108,58,237,0.06) 100%);padding:2.5rem 0;margin:4rem 0;border-top:1px solid rgba(108,58,237,0.15);border-bottom:1px solid rgba(108,58,237,0.15)}
.marquee-content{display:flex;gap:4rem;animation:scroll-marquee 25s linear infinite;white-space:nowrap}
.marquee-item{display:flex;align-items:center;gap:1rem;font-weight:700;font-size:1.05rem;color:var(--text);letter-spacing:.02em}
.marquee-item .marquee-num{background:var(--gradient-1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-weight:800;font-size:1.15rem}
.marquee-item::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--gradient-1);margin-right:.5rem;flex-shrink:0}
@keyframes scroll-marquee{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
.feature-showcase{display:grid;gap:0;margin:6rem 0}
.feature-row{display:grid;grid-template-columns:1fr 1fr;gap:4rem;align-items:center;padding:5rem 3rem;border-bottom:1px solid rgba(108,58,237,0.08);position:relative}
.feature-row:nth-child(even){background:linear-gradient(180deg,rgba(108,58,237,0.03) 0%,rgba(30,30,50,0.5) 50%,rgba(108,58,237,0.03) 100%)}
.feature-row:hover{background:rgba(108,58,237,0.02)}
.feature-row.reverse{grid-template-columns:1fr 1fr;direction:rtl}
.feature-row.reverse>*{direction:ltr}
.feature-content h3{font-size:.85rem;font-weight:700;letter-spacing:.2em;text-transform:uppercase;background:var(--gradient-1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:1rem;display:inline-block}
.feature-content h2{font-family:'Playfair Display',serif;font-size:2.2rem;font-weight:800;margin-bottom:1.5rem;line-height:1.2}
.feature-content p{font-size:1.05rem;color:var(--text-muted);line-height:1.8;margin-bottom:2rem}
.feature-content .feature-tag{display:inline-flex;align-items:center;gap:.4rem;padding:.4rem 1rem;border-radius:50px;background:rgba(108,58,237,0.1);border:1px solid rgba(108,58,237,0.2);color:var(--primary-light);font-size:.8rem;font-weight:600}
.feature-mockup{width:100%;aspect-ratio:4/3;background:#1c1c32;border-radius:16px;border:1px solid rgba(108,58,237,0.25);position:relative;overflow:hidden;box-shadow:0 20px 70px rgba(0,0,0,0.5),0 0 40px rgba(108,58,237,0.1)}
.feature-mockup::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(108,58,237,0.08) 0%,rgba(236,72,153,0.04) 50%,rgba(59,130,246,0.06) 100%);z-index:1}
.feature-mockup::after{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(108,58,237,0.3),transparent);z-index:1}
.feature-mock-inner{position:relative;z-index:2;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;padding:0}
.feature-mock-inner .fm-icon{display:none}
.feature-mock-inner .fm-label{display:none}
.feature-mock-inner .fm-preview{display:none}
.feature-mock-inner .fm-bar{display:none}
.feature-mock-inner .fm-dot{display:none}
.feature-mockup-content{width:100%;height:100%;display:flex;align-items:center;justify-content:center;position:relative}
.feature-video-timeline{display:flex;flex-direction:column;gap:12px;width:100%;height:100%;padding:20px;box-sizing:border-box}
.feature-timeline-item{display:flex;gap:10px;align-items:center;height:50px;background:rgba(108,58,237,0.08);border-radius:8px;padding:0 12px;border:1px solid rgba(108,58,237,0.15)}
.feature-timeline-thumb{width:60px;height:40px;background:linear-gradient(135deg,rgba(108,58,237,0.3),rgba(236,72,153,0.2));border-radius:4px;flex-shrink:0}
.feature-timeline-label{font-size:.8rem;color:var(--text-muted);flex:1}
.feature-timeline-marker{width:20px;height:20px;border-radius:50%;background:var(--primary);flex-shrink:0;box-shadow:0 0 8px rgba(108,58,237,0.4)}
.feature-reframe-preview{display:flex;gap:20px;align-items:center;justify-content:center;width:100%;height:100%;padding:20px}
.feature-reframe-card{display:flex;flex-direction:column;gap:8px;align-items:center}
.feature-reframe-video{width:120px;height:80px;background:linear-gradient(135deg,rgba(108,58,237,0.2),rgba(59,130,246,0.15));border-radius:8px;border:1px solid rgba(108,58,237,0.25)}
.feature-reframe-label{font-size:.75rem;color:var(--text-muted);font-weight:500}
.feature-caption-styles{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;width:100%;height:100%;padding:20px;box-sizing:border-box}
.feature-caption-item{background:rgba(108,58,237,0.1);border:1px solid rgba(108,58,237,0.2);border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:12px;gap:6px}
.feature-caption-item-text{font-size:.7rem;color:var(--text-muted);font-weight:500;text-align:center}
.feature-broll-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;width:100%;height:100%;padding:20px;box-sizing:border-box}
.feature-broll-item{background:linear-gradient(135deg,rgba(108,58,237,0.15),rgba(236,72,153,0.1));border-radius:8px;border:1px solid rgba(108,58,237,0.2);display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}
.feature-calendar-grid{display:grid;grid-template-columns:repeat(7,1fr);grid-template-rows:auto repeat(4,1fr);gap:6px;width:100%;height:100%;padding:16px;box-sizing:border-box}
.feature-calendar-day{font-size:.65rem;color:var(--text-muted);font-weight:600;text-align:center;padding:4px}
.feature-calendar-cell{background:rgba(108,58,237,0.12);border-radius:4px;border:1px solid rgba(108,58,237,0.15);min-height:24px}
.feature-calendar-cell.active{background:rgba(108,58,237,0.3);border-color:rgba(108,58,237,0.4)}
.feature-voice-layout{display:flex;flex-direction:column;gap:16px;width:100%;height:100%;padding:20px;box-sizing:border-box;justify-content:center}
.feature-voice-slider{display:flex;flex-direction:column;gap:6px}
.feature-voice-slider-label{font-size:.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}
.feature-voice-slider-bar{height:6px;background:rgba(108,58,237,0.15);border-radius:3px;overflow:hidden;border:1px solid rgba(108,58,237,0.2)}
.feature-voice-slider-fill{height:100%;background:linear-gradient(90deg,var(--primary),var(--accent));width:55%}
.workflow-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:3rem;margin-top:3rem;max-width:1000px;margin-left:auto;margin-right:auto}
.workflow-card{text-align:center}
.workflow-number{width:60px;height:60px;border-radius:50%;background:var(--gradient-1);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.5rem;margin:0 auto 1.5rem}
.workflow-card h3{font-size:1.3rem;font-weight:700;margin-bottom:.8rem}
.workflow-card p{color:var(--text-muted);line-height:1.7}
.teams-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:2.5rem;margin-top:3rem}
.team-card{background:var(--surface);border-radius:20px;border:var(--border-subtle);padding:2.5rem;transition:all .3s}
.team-card:hover{transform:translateY(-4px);border-color:rgba(108,58,237,0.3)}
.team-card-icon{font-size:2.5rem;margin-bottom:1.5rem}
.team-card h3{font-size:1.1rem;font-weight:700;margin-bottom:.8rem}
.team-card p{color:var(--text-muted);font-size:.95rem;line-height:1.6;margin-bottom:2rem}
.team-card{background:linear-gradient(145deg,#222240 0%,#282850 100%);border:1px solid rgba(108,58,237,0.2)}
.team-card:hover{border-color:rgba(108,58,237,0.5);box-shadow:0 10px 40px rgba(108,58,237,0.2)}
.team-card-mockup{width:100%;height:200px;background:linear-gradient(145deg,rgba(108,58,237,0.15) 0%,rgba(236,72,153,0.08) 50%,rgba(59,130,246,0.1) 100%);border-radius:12px;border:1px solid rgba(108,58,237,0.2);display:flex;align-items:center;justify-content:center;font-size:3rem;color:var(--text-muted);position:relative;overflow:hidden}
.team-card-mockup::before{content:'';position:absolute;top:0;left:15%;right:15%;height:1px;background:linear-gradient(90deg,transparent,rgba(108,58,237,0.4),transparent)}
.marquee-testimonials{overflow:hidden;padding:4rem 0;margin:4rem 0}
.marquee-container{display:flex;gap:2rem;animation:scroll-marquee 30s linear infinite}
.testimonial-marquee-card{flex:0 0 350px;background:linear-gradient(145deg,#222240 0%,#282850 100%);border-radius:16px;border:1px solid rgba(108,58,237,0.18);padding:2rem;transition:border-color .3s}
.testimonial-marquee-card:hover{border-color:rgba(108,58,237,0.4)}
.testimonial-stars{color:var(--accent);margin-bottom:1rem;font-size:1.1rem}
.testimonial-quote{color:var(--text-muted);font-size:.95rem;line-height:1.7;margin-bottom:1.5rem;font-style:italic}
.testimonial-author-name{font-weight:600;font-size:.9rem}
.testimonial-author-role{font-size:.8rem;color:var(--text-dim)}
.faq-container{max-width:700px;margin:0 auto;margin-top:3rem}
.faq-item{background:linear-gradient(145deg,#222240 0%,#282850 100%);border-radius:12px;border:1px solid rgba(108,58,237,0.15);margin-bottom:1.5rem;overflow:hidden;transition:border-color .3s}
.faq-item:hover{border-color:rgba(108,58,237,0.35)}
.faq-header{padding:1.5rem;cursor:pointer;display:flex;justify-content:space-between;align-items:center;transition:all .3s}
.faq-header:hover{background:rgba(108,58,237,0.05)}
.faq-header h3{font-size:1rem;font-weight:600;margin:0}
.faq-toggle{font-size:1.5rem;transition:transform .3s}
.faq-item.open .faq-toggle{transform:rotate(45deg)}
.faq-content{max-height:0;overflow:hidden;transition:max-height .3s ease-out;padding:0 1.5rem}
.faq-item.open .faq-content{max-height:300px;padding:0 1.5rem 1.5rem}
.faq-content p{color:var(--text-muted);font-size:.95rem;line-height:1.7}
section{padding:6rem 2rem}.section-inner{max-width:1200px;margin:0 auto}
.section-label{display:inline-block;font-size:.8rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--primary-light);margin-bottom:1rem}
.section-title{font-family:'Playfair Display',serif;font-size:clamp(2rem,4vw,3rem);font-weight:800;margin-bottom:1rem;line-height:1.2}
.section-subtitle{font-size:1.1rem;color:var(--text-muted);max-width:600px;line-height:1.7}
.section-header{text-align:center;margin-bottom:4rem}.section-header .section-subtitle{margin:0 auto}
.pricing-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1.5rem;align-items:start}
.price-card{background:linear-gradient(145deg,#222240 0%,#282850 100%);border-radius:20px;padding:2.5rem;border:1px solid rgba(108,58,237,0.15);transition:all .3s;position:relative}
.price-card:hover{border-color:rgba(108,58,237,0.35);transform:translateY(-2px)}
.price-card.featured{border-color:var(--primary);box-shadow:var(--shadow-glow),0 0 80px rgba(108,58,237,0.15);transform:scale(1.02)}
.price-card.featured::before{content:'MOST POPULAR';position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:var(--gradient-1);padding:.3rem 1.2rem;border-radius:50px;font-size:.7rem;font-weight:700;letter-spacing:.1em}
.price-card h3{font-size:1.2rem;font-weight:700;margin-bottom:.5rem}
.price-card .price{font-size:3rem;font-weight:800;margin:1rem 0}.price-card .price span{font-size:1rem;font-weight:400;color:var(--text-muted)}
.price-card .price-desc{color:var(--text-muted);font-size:.9rem;margin-bottom:1.5rem}
.price-features{list-style:none;margin-bottom:2rem}
.price-features li{padding:.5rem 0;color:var(--text-muted);font-size:.9rem;display:flex;align-items:center;gap:.7rem}
.price-features li::before{content:'✓';color:var(--primary-light);font-weight:700}
.price-card .btn{width:100%;justify-content:center}
.cta-section{text-align:center;padding:6rem 2rem;background:linear-gradient(180deg,transparent 0%,rgba(108,58,237,0.08) 50%,transparent 100%)}
.footer{padding:4rem 2rem 2rem;border-top:var(--border-subtle);background:var(--dark-2)}
.footer-grid{max-width:1200px;margin:0 auto;display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:3rem;margin-bottom:3rem}
.footer-brand p{color:var(--text-dim);font-size:.9rem;line-height:1.7;margin-top:1rem}
.footer h4{font-size:.85rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:1.2rem;color:var(--text-muted)}
.footer a{display:block;color:var(--text-dim);text-decoration:none;font-size:.9rem;padding:.3rem 0;transition:color .3s}.footer a:hover{color:var(--primary-light)}
.footer-bottom{max-width:1200px;margin:0 auto;padding-top:2rem;border-top:var(--border-subtle);display:flex;justify-content:space-between;align-items:center;font-size:.85rem;color:var(--text-dim)}
.theme-toggle{background:var(--surface);border:1px solid rgba(255,255,255,0.1);border-radius:50%;width:32px;height:32px;padding:0;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:.9rem;color:var(--text-muted);transition:all .3s;flex-shrink:0}[data-theme="light"] .theme-toggle,body.light .theme-toggle{border-color:rgba(0,0,0,0.1)}.theme-toggle:hover{border-color:var(--primary-light);color:var(--text)}.theme-toggle .toggle-track{display:none}.theme-toggle .toggle-thumb{display:none}
@media(max-width:1024px){.pricing-grid{grid-template-columns:repeat(2,1fr)}.feature-row,.feature-row.reverse{grid-template-columns:1fr},.feature-row.reverse{direction:ltr}}
.mobile-nav-toggle{display:none;background:none;border:none;color:var(--text);font-size:1.5rem;cursor:pointer;padding:4px}
@media(max-width:768px){
  .nav-links{display:none;position:absolute;top:100%;left:0;right:0;background:rgba(6,6,15,.97);backdrop-filter:blur(20px);flex-direction:column;padding:1.5rem 2rem;gap:1rem;border-bottom:1px solid var(--border)}
  .nav-links.mobile-open{display:flex}
  .mobile-nav-toggle{display:block}
  .pricing-grid{grid-template-columns:1fr}
  .footer-grid{grid-template-columns:1fr 1fr}
  .hero h1{font-size:2rem}
  .hero-content p{font-size:.95rem}
  .price-card.featured{transform:none}
  .footer-bottom{flex-direction:column;gap:.5rem;text-align:center}
  section{padding:4rem 0 !important}
  .section-title{font-size:1.6rem}
  .feature-row{gap:2rem;padding:2rem 0}
  .carousel-container{padding:0 40px}
  .carousel-slide{min-height:350px}
  .carousel-btn-side{width:36px;height:36px;font-size:1rem}
  .carousel-btn-side.prev{left:-4px}
  .carousel-btn-side.next{right:-4px}
  .cs-before-after{flex-direction:column;gap:20px;align-items:center}
  .cs-device-landscape{width:100%;max-width:340px}
  .cs-device-portrait{width:160px}
  .carousel-showcase{padding:10px}
  .carousel-screen-main{max-width:100%}
  .carousel-sidebar{display:none}
  .carousel-cta{flex-direction:column;gap:8px;padding:12px}
  .feature-row{padding:3rem 1.5rem}
  .workflow-grid{grid-template-columns:1fr;gap:2rem}
  .teams-grid{grid-template-columns:1fr}
  .carousel-labels{gap:.5rem}
  .carousel-label{padding:.5rem 1rem;font-size:.8rem}
  .marquee-testimonials{padding:2rem 0}
  .testimonial-marquee-card{flex:0 0 90vw}
}
`;
}

router.get('/', (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${BRAND.name} - ${BRAND.tagline}</title>
  <meta name="description" content="AI-powered video creation platform. 10 tools in one: Smart Shorts, Video Editor, AI Captions, AI Hooks, B-Roll, Music Library, Reframe, Brand Voice, Repurposing &amp; Content Calendar. Turn one video into unlimited content.">
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#x26A1;</text></svg>">
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#0a0a0a">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Splicora">
  <link rel="apple-touch-icon" href="/icons/icon-192.png">
  <style>${getStyles()}</style>
</head>
<body>
 <nav class="nav"><div class="nav-inner">
    <a href="/" class="nav-logo">&#x26A1; ${BRAND.name}</a>
    <button class="mobile-nav-toggle" onclick="document.querySelector('.nav-links').classList.toggle('mobile-open')">&#9776;</button>
    <div class="nav-links">
      <a href="#features">Features</a>
      <a href="#how-it-works">How It Works</a>
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
      <p>10 AI tools in one platform. Smart Shorts, Video Editor, AI Captions, Hooks, B-Roll, Music Library, Reframe, Brand Voice, Content Repurposing, and Calendar. Paste a link and let AI do the rest.</p>
      <div class="hero-input-group">
        <input class="hero-input" type="text" placeholder="Paste your YouTube link here..." value="">
        <button class="btn btn-primary">Create &#x26A1;</button>
        <button class="btn btn-outline">Upload Files</button>
      </div>
      <div class="carousel-container">
        <button class="carousel-nav prev" onclick="prevSlide()" aria-label="Previous slide"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"></polyline></svg></button>
        <button class="carousel-nav next" onclick="nextSlide()" aria-label="Next slide"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"></polyline></svg></button>
        <div class="carousel" id="carousel">
          <!-- Slide 1: Smart Shorts / AI Clipping (Full Cinema) -->
          <div class="carousel-slide"><div class="carousel-showcase layout-centered"><div class="carousel-screen carousel-screen-main"><div class="carousel-screen-topbar"><div class="carousel-screen-dot"></div><div class="carousel-screen-dot"></div><div class="carousel-screen-dot"></div><span style="flex:1;text-align:center;font-size:.7rem;color:var(--text-muted)">Smart Shorts — AI Clipping</span></div><div style="flex:1;overflow:hidden;background:#0d0d14"><video data-src="/public/videos/ai-clipping-v3.mp4" muted playsinline preload="none" style="width:100%;height:100%;object-fit:cover;display:block"></video></div><div style="display:flex;align-items:center;gap:12px;padding:10px 20px;background:#141420;border-top:1px solid rgba(255,255,255,0.06)"><div style="display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:6px;background:rgba(108,58,237,0.25);border:1px solid rgba(108,58,237,0.4);font-size:.7rem;font-weight:700;color:#a78bfa;white-space:nowrap">&#x2702;&#xFE0F; AI-Powered Clipping</div><div style="font-size:.78rem;color:var(--text-muted);font-weight:500">Drop a long video &#x2192; Get viral-ready shorts for every platform</div></div></div></div></div>
          <!-- Slide 2: AI Captions (Full Cinema) -->
          <div class="carousel-slide"><div class="carousel-showcase layout-centered"><div class="carousel-screen carousel-screen-main"><div class="carousel-screen-topbar"><div class="carousel-screen-dot"></div><div class="carousel-screen-dot"></div><div class="carousel-screen-dot"></div><span style="flex:1;text-align:center;font-size:.7rem;color:var(--text-muted)">AI Captions — Animated Subtitles</span></div><div style="flex:1;overflow:hidden;background:#0d0d14"><video data-src="/public/videos/ai-captions-v1.mp4" muted playsinline preload="none" style="width:100%;height:100%;object-fit:cover;display:block"></video></div><div style="display:flex;align-items:center;gap:12px;padding:10px 20px;background:#141420;border-top:1px solid rgba(255,255,255,0.06)"><div style="display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:6px;background:rgba(236,72,153,0.25);border:1px solid rgba(236,72,153,0.4);font-size:.7rem;font-weight:700;color:#f472b6;white-space:nowrap">&#x1F4DD; 6 Animated Styles</div><div style="font-size:.78rem;color:var(--text-muted);font-weight:500">Auto-generated captions with karaoke, neon, cinematic &amp; more</div></div></div></div></div>
          <!-- Slide 3: Video Editor -->
          <div class="carousel-slide"><div class="carousel-showcase layout-editor"><div class="carousel-screen carousel-screen-main"><div class="carousel-screen-topbar"><div class="carousel-screen-dot"></div><div class="carousel-screen-dot"></div><div class="carousel-screen-dot"></div><span style="flex:1;text-align:center;font-size:.7rem;color:var(--text-muted)">Video Editor — Full Timeline</span></div><div class="carousel-screen-body"><div class="carousel-video-area"><div class="carousel-video-placeholder" style="background:linear-gradient(135deg,#111827 0%,#1e1b4b 50%,#111827 100%)"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px"><div style="font-size:2.5rem">&#x1F3AC;</div><div style="font-size:.9rem;font-weight:700;color:#fff">Professional Video Editor</div><div style="font-size:.75rem;color:var(--text-muted)">Timeline, waveform, music &amp; effects</div></div></div></div><div class="carousel-sidebar"><div class="carousel-sidebar-item"><div class="carousel-sidebar-thumb" style="background:linear-gradient(135deg,rgba(16,185,129,0.3),rgba(59,130,246,0.2))"></div><span>Music</span><span class="carousel-sidebar-badge">123</span></div><div class="carousel-sidebar-item"><div class="carousel-sidebar-thumb" style="background:linear-gradient(135deg,rgba(245,158,11,0.3),rgba(236,72,153,0.2))"></div><span>Filters</span><span class="carousel-sidebar-badge">NEW</span></div><div class="carousel-sidebar-item"><div class="carousel-sidebar-thumb" style="background:linear-gradient(135deg,rgba(108,58,237,0.3),rgba(59,130,246,0.2))"></div><span>Captions</span><span class="carousel-sidebar-badge">AI</span></div><div class="carousel-sidebar-item"><div class="carousel-sidebar-thumb" style="background:linear-gradient(135deg,rgba(239,68,68,0.3),rgba(245,158,11,0.2))"></div><span>Export</span><span class="carousel-sidebar-badge">HD</span></div></div></div><div class="carousel-timeline-bar"><div style="display:flex;flex-direction:column;gap:3px;width:100%"><div style="display:flex;align-items:center;gap:4px"><span style="font-size:.55rem;color:var(--text-muted);width:32px">Video</span><div class="carousel-timeline-clip active" style="flex:1"><div class="carousel-timeline-clip-inner"></div><div class="carousel-timeline-scrubber" style="left:35%"></div></div></div><div style="display:flex;align-items:center;gap:4px"><span style="font-size:.55rem;color:var(--text-muted);width:32px">Audio</span><div class="carousel-timeline-clip" style="flex:1;height:28px"><div class="carousel-timeline-clip-inner" style="background:linear-gradient(135deg,rgba(16,185,129,0.2),rgba(59,130,246,0.15))"></div></div></div></div></div></div></div></div>
          <!-- Slide 4: AI Hook Generator -->
          <div class="carousel-slide"><div class="carousel-showcase layout-centered"><div class="carousel-screen carousel-screen-main" style="max-width:680px"><div class="carousel-screen-topbar"><div class="carousel-screen-dot"></div><div class="carousel-screen-dot"></div><div class="carousel-screen-dot"></div><span style="flex:1;text-align:center;font-size:.7rem;color:var(--text-muted)">AI Hook Generator</span></div><div class="carousel-screen-body"><div class="carousel-video-area"><div class="carousel-video-placeholder" style="background:linear-gradient(135deg,#1a0a2e 0%,#2d1454 50%,#1a0a2e 100%)"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:20px"><div style="font-size:2.5rem">&#x1F3A4;</div><div style="font-size:.9rem;font-weight:700;color:#fff">Scroll-Stopping Hooks in Seconds</div><div style="display:flex;gap:8px;margin-top:4px"><span style="padding:5px 12px;border-radius:6px;background:rgba(108,58,237,0.4);color:#c4b5fd;font-size:.7rem;font-weight:600">Free AI Voice</span><span style="padding:5px 12px;border-radius:6px;background:rgba(236,72,153,0.3);color:#f9a8d4;font-size:.7rem;font-weight:600">ElevenLabs</span></div><div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 16px;margin-top:8px;max-width:380px;width:100%"><div style="font-size:.7rem;color:var(--text-muted);margin-bottom:4px">Generated Hook:</div><div style="font-size:.82rem;color:#fff;font-weight:600;line-height:1.5">"You've been doing this wrong your entire life — here's the fix nobody talks about"</div></div><div style="display:flex;gap:6px;margin-top:6px"><span style="padding:3px 8px;border-radius:4px;background:rgba(59,130,246,0.2);color:#93c5fd;font-size:.6rem">6 Voice Options</span><span style="padding:3px 8px;border-radius:4px;background:rgba(16,185,129,0.2);color:#6ee7b7;font-size:.6rem">5 Hook Styles</span><span style="padding:3px 8px;border-radius:4px;background:rgba(245,158,11,0.2);color:#fcd34d;font-size:.6rem">Audio Export</span></div></div></div></div></div></div></div></div>
          <!-- Slide 5: AI B-Roll -->
          <div class="carousel-slide"><div class="carousel-showcase layout-centered"><div class="carousel-screen carousel-screen-main" style="max-width:680px"><div class="carousel-screen-topbar"><div class="carousel-screen-dot"></div><div class="carousel-screen-dot"></div><div class="carousel-screen-dot"></div><span style="flex:1;text-align:center;font-size:.7rem;color:var(--text-muted)">AI B-Roll — Stock Footage</span></div><div class="carousel-screen-body"><div class="carousel-video-area"><div class="carousel-video-placeholder" style="background:linear-gradient(135deg,#0d1117 0%,#162030 50%,#0d1117 100%)"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px"><div style="font-size:2.5rem">&#x1F3AC;</div><div style="font-size:.9rem;font-weight:700;color:#fff">Millions of Stock Video Clips</div><div style="font-size:.75rem;color:var(--text-muted)">Powered by Pixabay Video API</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px;width:80%;max-width:300px"><div style="aspect-ratio:16/9;border-radius:6px;background:linear-gradient(135deg,rgba(108,58,237,0.2),rgba(59,130,246,0.15));border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;font-size:.8rem">&#x25B6;</div><div style="aspect-ratio:16/9;border-radius:6px;background:linear-gradient(135deg,rgba(236,72,153,0.2),rgba(245,158,11,0.15));border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;font-size:.8rem">&#x25B6;</div><div style="aspect-ratio:16/9;border-radius:6px;background:linear-gradient(135deg,rgba(16,185,129,0.2),rgba(59,130,246,0.15));border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;font-size:.8rem">&#x25B6;</div><div style="aspect-ratio:16/9;border-radius:6px;background:linear-gradient(135deg,rgba(245,158,11,0.2),rgba(239,68,68,0.15));border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;font-size:.8rem">&#x25B6;</div><div style="aspect-ratio:16/9;border-radius:6px;background:linear-gradient(135deg,rgba(59,130,246,0.2),rgba(108,58,237,0.15));border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;font-size:.8rem">&#x25B6;</div><div style="aspect-ratio:16/9;border-radius:6px;background:linear-gradient(135deg,rgba(239,68,68,0.2),rgba(236,72,153,0.15));border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;font-size:.8rem">&#x25B6;</div></div></div></div></div></div></div></div></div>
          <!-- Slide 6: AI Reframe (Full Cinema) -->
          <div class="carousel-slide"><div class="carousel-showcase layout-centered"><div class="carousel-screen carousel-screen-main"><div class="carousel-screen-topbar"><div class="carousel-screen-dot"></div><div class="carousel-screen-dot"></div><div class="carousel-screen-dot"></div><span style="flex:1;text-align:center;font-size:.7rem;color:var(--text-muted)">AI Reframe — Auto Resize</span></div><div style="flex:1;overflow:hidden;background:#0d0d14"><video data-src="/public/videos/ai-reframe-v1.mp4" muted playsinline preload="none" style="width:100%;height:100%;object-fit:cover;display:block"></video></div><div style="display:flex;align-items:center;gap:12px;padding:10px 20px;background:#141420;border-top:1px solid rgba(255,255,255,0.06)"><div style="display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:6px;background:rgba(59,130,246,0.25);border:1px solid rgba(59,130,246,0.4);font-size:.7rem;font-weight:700;color:#60a5fa;white-space:nowrap">&#x1F4D0; Smart Reframe</div><div style="font-size:.78rem;color:var(--text-muted);font-weight:500">Turn 16:9 into 9:16 or 1:1 — perfect for TikTok, Reels &amp; Shorts</div></div></div></div></div>
          <!-- Slide 7: Music Library -->
          <div class="carousel-slide"><div class="carousel-showcase layout-centered"><div class="carousel-screen carousel-screen-main" style="max-width:720px"><div class="carousel-screen-topbar"><div class="carousel-screen-dot"></div><div class="carousel-screen-dot"></div><div class="carousel-screen-dot"></div><span style="flex:1;text-align:center;font-size:.7rem;color:var(--text-muted)">Music Library — 123 Royalty-Free Tracks</span></div><div class="carousel-screen-body"><div class="carousel-video-area"><div class="carousel-video-placeholder" style="background:linear-gradient(135deg,#0a1628 0%,#1a1040 50%,#0a1628 100%)"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;padding:16px"><div style="font-size:2.5rem">&#x1F3B5;</div><div style="font-size:.9rem;font-weight:700;color:#fff">123 Curated Tracks</div><div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:center;max-width:400px"><span style="padding:3px 8px;border-radius:12px;background:rgba(108,58,237,0.25);color:#c4b5fd;font-size:.6rem">Ambient</span><span style="padding:3px 8px;border-radius:12px;background:rgba(236,72,153,0.25);color:#f9a8d4;font-size:.6rem">Lo-Fi</span><span style="padding:3px 8px;border-radius:12px;background:rgba(59,130,246,0.25);color:#93c5fd;font-size:.6rem">Corporate</span><span style="padding:3px 8px;border-radius:12px;background:rgba(245,158,11,0.25);color:#fcd34d;font-size:.6rem">Cinematic</span><span style="padding:3px 8px;border-radius:12px;background:rgba(16,185,129,0.25);color:#6ee7b7;font-size:.6rem">Upbeat</span><span style="padding:3px 8px;border-radius:12px;background:rgba(239,68,68,0.25);color:#fca5a5;font-size:.6rem">Hip-Hop</span><span style="padding:3px 8px;border-radius:12px;background:rgba(168,85,247,0.25);color:#d8b4fe;font-size:.6rem">Electronic</span><span style="padding:3px 8px;border-radius:12px;background:rgba(20,184,166,0.25);color:#5eead4;font-size:.6rem">Acoustic</span><span style="padding:3px 8px;border-radius:12px;background:rgba(251,146,60,0.25);color:#fdba74;font-size:.6rem">Jazz</span><span style="padding:3px 8px;border-radius:12px;background:rgba(129,140,248,0.25);color:#a5b4fc;font-size:.6rem">Classical</span><span style="padding:3px 8px;border-radius:12px;background:rgba(52,211,153,0.25);color:#6ee7b7;font-size:.6rem">Nature</span></div><div style="display:flex;gap:6px;align-items:center;margin-top:8px"><div style="width:28px;height:28px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;font-size:.7rem;color:#fff">&#x25B6;</div><div style="flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,0.1);max-width:200px"><div style="width:45%;height:100%;border-radius:2px;background:var(--gradient-1)"></div></div><span style="font-size:.6rem;color:var(--text-muted)">Preview tracks before adding</span></div></div></div></div></div></div></div></div>
          <!-- Slide 8: Brand Voice -->
          <div class="carousel-slide"><div class="carousel-showcase layout-centered"><div class="carousel-screen carousel-screen-main" style="max-width:680px"><div class="carousel-screen-topbar"><div class="carousel-screen-dot"></div><div class="carousel-screen-dot"></div><div class="carousel-screen-dot"></div><span style="flex:1;text-align:center;font-size:.7rem;color:var(--text-muted)">Brand Voice — AI That Sounds Like You</span></div><div class="carousel-screen-body"><div class="carousel-video-area"><div class="carousel-video-placeholder" style="background:linear-gradient(135deg,#1a0a2e 0%,#0d1117 50%,#1a0a2e 100%)"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;padding:16px"><div style="font-size:2.5rem">&#x1F399;&#xFE0F;</div><div style="font-size:.9rem;font-weight:700;color:#fff">Train AI on Your Content Style</div><div style="width:80%;max-width:300px;display:flex;flex-direction:column;gap:8px;margin-top:6px"><div style="display:flex;align-items:center;gap:8px"><span style="font-size:.65rem;color:var(--text-muted);width:60px">Tone</span><div style="flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,0.08)"><div style="width:65%;height:100%;border-radius:3px;background:linear-gradient(90deg,#6C3AED,#EC4899)"></div></div></div><div style="display:flex;align-items:center;gap:8px"><span style="font-size:.65rem;color:var(--text-muted);width:60px">Energy</span><div style="flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,0.08)"><div style="width:80%;height:100%;border-radius:3px;background:linear-gradient(90deg,#6C3AED,#3B82F6)"></div></div></div><div style="display:flex;align-items:center;gap:8px"><span style="font-size:.65rem;color:var(--text-muted);width:60px">Formality</span><div style="flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,0.08)"><div style="width:45%;height:100%;border-radius:3px;background:linear-gradient(90deg,#F59E0B,#EF4444)"></div></div></div></div><div style="font-size:.7rem;color:var(--text-muted);margin-top:6px">Every post matches your unique voice</div></div></div></div></div></div></div></div>
          <!-- Slide 9: Content Repurposing -->
          <div class="carousel-slide"><div class="carousel-showcase layout-centered"><div class="carousel-screen carousel-screen-main" style="max-width:680px"><div class="carousel-screen-topbar"><div class="carousel-screen-dot"></div><div class="carousel-screen-dot"></div><div class="carousel-screen-dot"></div><span style="flex:1;text-align:center;font-size:.7rem;color:var(--text-muted)">Content Repurposing — One Link, Every Platform</span></div><div class="carousel-screen-body"><div class="carousel-video-area"><div class="carousel-video-placeholder" style="background:linear-gradient(135deg,#0d1117 0%,#1a1030 50%,#0d1117 100%)"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;padding:16px"><div style="font-size:2.5rem">&#x1F504;</div><div style="font-size:.9rem;font-weight:700;color:#fff">Paste a Link, Get Content for Every Platform</div><div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-top:4px"><span style="padding:4px 10px;border-radius:4px;background:rgba(236,72,153,0.3);color:#f472b6;font-size:.65rem;font-weight:700">INSTAGRAM</span><span style="padding:4px 10px;border-radius:4px;background:rgba(59,130,246,0.3);color:#60a5fa;font-size:.65rem;font-weight:700">TWITTER/X</span><span style="padding:4px 10px;border-radius:4px;background:rgba(108,58,237,0.3);color:#a78bfa;font-size:.65rem;font-weight:700">TIKTOK</span><span style="padding:4px 10px;border-radius:4px;background:rgba(59,130,246,0.3);color:#93c5fd;font-size:.65rem;font-weight:700">LINKEDIN</span><span style="padding:4px 10px;border-radius:4px;background:rgba(16,185,129,0.3);color:#34d399;font-size:.65rem;font-weight:700">FACEBOOK</span></div><div style="display:flex;gap:6px;margin-top:8px"><span style="padding:3px 8px;border-radius:4px;background:rgba(245,158,11,0.2);color:#fcd34d;font-size:.6rem">Professional</span><span style="padding:3px 8px;border-radius:4px;background:rgba(236,72,153,0.2);color:#f9a8d4;font-size:.6rem">Casual</span><span style="padding:3px 8px;border-radius:4px;background:rgba(108,58,237,0.2);color:#c4b5fd;font-size:.6rem">Humorous</span><span style="padding:3px 8px;border-radius:4px;background:rgba(16,185,129,0.2);color:#6ee7b7;font-size:.6rem">Inspirational</span><span style="padding:3px 8px;border-radius:4px;background:rgba(59,130,246,0.2);color:#93c5fd;font-size:.6rem">Educational</span></div></div></div></div></div></div></div></div>
          <!-- Slide 10: Content Calendar -->
          <div class="carousel-slide"><div class="carousel-showcase layout-centered"><div class="carousel-screen carousel-screen-main" style="max-width:680px"><div class="carousel-screen-topbar"><div class="carousel-screen-dot"></div><div class="carousel-screen-dot"></div><div class="carousel-screen-dot"></div><span style="flex:1;text-align:center;font-size:.7rem;color:var(--text-muted)">Content Calendar — Plan &amp; Schedule</span></div><div class="carousel-screen-body"><div class="carousel-video-area"><div class="carousel-video-placeholder" style="background:linear-gradient(135deg,#0d1117 0%,#1a1a30 50%,#0d1117 100%)"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px"><div style="font-size:2.5rem">&#x1F4C5;</div><div style="font-size:.9rem;font-weight:700;color:#fff">Plan Your Content Calendar</div><div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;width:70%;max-width:280px;margin-top:6px"><span style="height:20px;border-radius:3px;background:rgba(108,58,237,.2);display:flex;align-items:center;justify-content:center;font-size:.5rem;color:var(--text-muted)">M</span><span style="height:20px;border-radius:3px;background:rgba(108,58,237,.2);display:flex;align-items:center;justify-content:center;font-size:.5rem;color:var(--text-muted)">T</span><span style="height:20px;border-radius:3px;background:rgba(108,58,237,.2);display:flex;align-items:center;justify-content:center;font-size:.5rem;color:var(--text-muted)">W</span><span style="height:20px;border-radius:3px;background:rgba(108,58,237,.35);display:flex;align-items:center;justify-content:center;font-size:.5rem;color:#c4b5fd">T</span><span style="height:20px;border-radius:3px;background:rgba(108,58,237,.2);display:flex;align-items:center;justify-content:center;font-size:.5rem;color:var(--text-muted)">F</span><span style="height:20px;border-radius:3px;background:rgba(236,72,153,.25);display:flex;align-items:center;justify-content:center;font-size:.5rem;color:#f9a8d4">S</span><span style="height:20px;border-radius:3px;background:rgba(108,58,237,.15);display:flex;align-items:center;justify-content:center;font-size:.5rem;color:var(--text-muted)">S</span></div><div style="display:flex;gap:6px;margin-top:8px"><span style="padding:3px 8px;border-radius:4px;background:rgba(108,58,237,0.2);color:#c4b5fd;font-size:.6rem">30 min before</span><span style="padding:3px 8px;border-radius:4px;background:rgba(245,158,11,0.2);color:#fcd34d;font-size:.6rem">1 hour before</span><span style="padding:3px 8px;border-radius:4px;background:rgba(236,72,153,0.2);color:#f9a8d4;font-size:.6rem">1 day before</span></div><div style="font-size:.7rem;color:var(--text-muted);margin-top:6px">Email reminders so you never miss a post</div></div></div></div></div></div></div></div>
        </div>
      </div>
      <div class="carousel-counter-wrap">
        <div class="carousel-counter"><span class="carousel-counter-dot"></span><span id="slideCounter">1 / 10</span></div>
      </div>
      <div class="carousel-labels">
        <div class="carousel-label active" onclick="goToSlide(0)">Smart Shorts</div>
        <div class="carousel-label" onclick="goToSlide(1)">AI Captions</div>
        <div class="carousel-label" onclick="goToSlide(2)">Video Editor</div>
        <div class="carousel-label" onclick="goToSlide(3)">AI Hooks</div>
        <div class="carousel-label" onclick="goToSlide(4)">AI B-Roll</div>
        <div class="carousel-label" onclick="goToSlide(5)">AI Reframe</div>
        <div class="carousel-label" onclick="goToSlide(6)">Music Library</div>
        <div class="carousel-label" onclick="goToSlide(7)">Brand Voice</div>
        <div class="carousel-label" onclick="goToSlide(8)">Repurpose</div>
        <div class="carousel-label" onclick="goToSlide(9)">Calendar</div>
      </div>
    </div>
  </section>

  <div class="stats-marquee">
    <div class="marquee-content">
      <div class="marquee-item"><span class="marquee-num">10,000+</span> Videos Created</div>
      <div class="marquee-item"><span class="marquee-num">50,000+</span> Posts Generated</div>
      <div class="marquee-item"><span class="marquee-num">7</span> Platforms Supported</div>
      <div class="marquee-item"><span class="marquee-num">99%</span> Time Saved</div>
      <div class="marquee-item"><span class="marquee-num">AI-Powered</span> Engine</div>
      <div class="marquee-item"><span class="marquee-num">10,000+</span> Videos Created</div>
      <div class="marquee-item"><span class="marquee-num">50,000+</span> Posts Generated</div>
      <div class="marquee-item"><span class="marquee-num">7</span> Platforms Supported</div>
      <div class="marquee-item"><span class="marquee-num">99%</span> Time Saved</div>
      <div class="marquee-item"><span class="marquee-num">AI-Powered</span> Engine</div>
    </div>
  </div>

  <section id="features">
    <div class="section-inner">
      <div class="section-header">
        <div class="section-label">Complete Platform</div>
        <h2 class="section-title">Everything You Need to Dominate Every Platform</h2>
        <p class="section-subtitle">9 powerful AI tools designed for creators, agencies, and businesses who refuse to be limited to one platform.</p>
      </div>
      <div class="feature-showcase">

        <!-- Feature 1: Smart Shorts -->
        <div class="feature-row">
          <div class="feature-content">
            <h3>Smart Shorts</h3>
            <h2>AI that finds viral moments in any video</h2>
            <p>Upload any long-form video or paste a YouTube link. Our AI analyzes engagement patterns, detects the most compelling moments, and automatically cuts them into perfectly timed short-form clips optimized for TikTok, Instagram Reels, and YouTube Shorts. Each clip is scored by viral potential so you know which ones to post first.</p>
            <span class="feature-tag">&#x2728; Most Popular</span>
          </div>
          <div class="feature-mockup"><div class="feature-mock-inner"><div class="feature-mockup-content"><div class="feature-video-timeline"><div class="feature-timeline-item"><div class="feature-timeline-thumb"></div><div class="feature-timeline-label">0:00 - 0:15 <span style="color:#10B981;font-size:.7rem;margin-left:4px">&#x1F525; 92%</span></div><div class="feature-timeline-marker"></div></div><div class="feature-timeline-item"><div class="feature-timeline-thumb"></div><div class="feature-timeline-label">1:30 - 1:45 <span style="color:#F59E0B;font-size:.7rem;margin-left:4px">&#x1F525; 87%</span></div><div class="feature-timeline-marker"></div></div><div class="feature-timeline-item"><div class="feature-timeline-thumb"></div><div class="feature-timeline-label">3:20 - 3:35 <span style="color:#6C3AED;font-size:.7rem;margin-left:4px">&#x1F525; 81%</span></div><div class="feature-timeline-marker"></div></div></div></div></div></div>
        </div>

        <!-- Feature 2: Video Editor -->
        <div class="feature-row reverse">
          <div class="feature-content">
            <h3>Video Editor</h3>
            <h2>A full professional editor right in your browser</h2>
            <p>No more switching between apps. Our built-in video editor features a full multi-track timeline with real audio waveform visualization, a curated music library with 123 royalty-free tracks across 11 genres, AI-powered captions, and precision playhead seeking. Trim, add music, overlay captions, and export — all without leaving Splicora.</p>
            <span class="feature-tag">&#x1F3AC; Full Editor</span>
          </div>
          <div class="feature-mockup"><div class="feature-mock-inner"><div class="feature-mockup-content" style="display:flex;flex-direction:column;gap:10px;padding:10px"><div style="flex:1;background:linear-gradient(135deg,#151525 0%,#1a1a30 100%);border-radius:8px;display:flex;align-items:center;justify-content:center;min-height:100px;position:relative"><div style="font-size:1.5rem">&#x25B6;</div><div style="position:absolute;bottom:8px;left:50%;transform:translateX(-50%);font-size:.7rem;color:#fff;background:rgba(0,0,0,0.7);padding:3px 10px;border-radius:4px">Timeline with real waveform</div></div><div style="display:flex;gap:6px"><div style="flex:1;height:24px;border-radius:4px;background:linear-gradient(90deg,rgba(108,58,237,0.3),rgba(59,130,246,0.2));position:relative"><span style="position:absolute;left:6px;top:50%;transform:translateY(-50%);font-size:.55rem;color:var(--text-muted)">Video</span></div></div><div style="display:flex;gap:6px"><div style="flex:1;height:18px;border-radius:4px;background:linear-gradient(90deg,rgba(16,185,129,0.25),rgba(59,130,246,0.15));position:relative"><span style="position:absolute;left:6px;top:50%;transform:translateY(-50%);font-size:.55rem;color:var(--text-muted)">Audio</span></div></div></div></div></div>
        </div>

        <!-- Feature 3: AI Captions -->
        <div class="feature-row">
          <div class="feature-content">
            <h3>AI Captions</h3>
            <h2>Trendy animated subtitles that boost engagement by 40%</h2>
            <p>Powered by OpenAI Whisper with word-level timestamp accuracy. Choose from 6 stunning caption presets — Karaoke, Bold Pop, Minimal, Neon Glow, Typewriter, and Cinematic — each with unique animations. Upload your own video or paste a YouTube URL. Position captions anywhere on screen and preview them in real-time before exporting.</p>
            <span class="feature-tag">&#x1F4C8; +40% Engagement</span>
          </div>
          <div class="feature-mockup"><div class="feature-mock-inner"><div class="feature-mockup-content"><div class="feature-caption-styles"><div class="feature-caption-item"><span style="font-size:0.65rem;font-weight:700;letter-spacing:0.05em">KARAOKE</span><div class="feature-caption-item-text">Highlighted words</div></div><div class="feature-caption-item" style="background:rgba(236,72,153,0.12);border-color:rgba(236,72,153,0.3)"><span style="font-size:0.65rem;font-weight:700;letter-spacing:0.05em;color:#EC4899">BOLD POP</span><div class="feature-caption-item-text">Strong impact</div></div><div class="feature-caption-item" style="background:rgba(245,158,11,0.12);border-color:rgba(245,158,11,0.3)"><span style="font-size:0.65rem;font-weight:700;letter-spacing:0.05em;color:#F59E0B">MINIMAL</span><div class="feature-caption-item-text">Clean &amp; simple</div></div><div class="feature-caption-item" style="background:rgba(59,130,246,0.12);border-color:rgba(59,130,246,0.3)"><span style="font-size:0.65rem;font-weight:700;letter-spacing:0.05em;color:#3B82F6">NEON GLOW</span><div class="feature-caption-item-text">Glowing text</div></div><div class="feature-caption-item" style="background:rgba(16,185,129,0.12);border-color:rgba(16,185,129,0.3)"><span style="font-size:0.65rem;font-weight:700;letter-spacing:0.05em;color:#10B981">TYPEWRITER</span><div class="feature-caption-item-text">Letter by letter</div></div><div class="feature-caption-item" style="background:rgba(239,68,68,0.12);border-color:rgba(239,68,68,0.3)"><span style="font-size:0.65rem;font-weight:700;letter-spacing:0.05em;color:#EF4444">CINEMATIC</span><div class="feature-caption-item-text">Movie style</div></div></div></div></div></div>
        </div>

        <!-- Feature 4: AI Hook Generator -->
        <div class="feature-row reverse">
          <div class="feature-content">
            <h3>AI Hook Generator</h3>
            <h2>Scroll-stopping hooks that grab attention in 2 seconds</h2>
            <p>Generate irresistible video hooks in 5 styles: Controversial, Question, Story, Statistic, and Bold Statement. Each hook is crafted for your specific platform and content. Choose from 6 free built-in AI voices or connect your own ElevenLabs account for premium voice synthesis. Get the hook text and audio file ready to drop into your video.</p>
            <span class="feature-tag">&#x1F3A4; Free AI Voices</span>
          </div>
          <div class="feature-mockup"><div class="feature-mock-inner"><div class="feature-mockup-content" style="display:flex;flex-direction:column;gap:12px;padding:12px"><div style="display:flex;gap:6px"><span style="padding:5px 14px;border-radius:20px;background:var(--gradient-1);color:#fff;font-size:.7rem;font-weight:600">Free AI Voice</span><span style="padding:5px 14px;border-radius:20px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:var(--text-muted);font-size:.7rem;font-weight:600">ElevenLabs</span></div><div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px"><div style="font-size:.65rem;color:var(--text-muted);margin-bottom:6px">&#x2728; Generated Hook:</div><div style="font-size:.8rem;color:#fff;font-weight:600;line-height:1.6">"Nobody is talking about this — and it's costing you thousands"</div></div><div style="display:flex;gap:8px;align-items:center"><div style="width:24px;height:24px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;font-size:.6rem;color:#fff">&#x25B6;</div><div style="flex:1;height:3px;border-radius:2px;background:rgba(255,255,255,0.08)"><div style="width:60%;height:100%;border-radius:2px;background:var(--gradient-1)"></div></div><span style="font-size:.6rem;color:var(--text-muted)">0:04</span></div></div></div></div>
        </div>

        <!-- Feature 5: AI B-Roll -->
        <div class="feature-row">
          <div class="feature-content">
            <h3>AI B-Roll</h3>
            <h2>Millions of stock clips, found instantly by AI</h2>
            <p>Stop spending hours searching for the perfect B-roll. Paste a YouTube link or describe your scene, and our AI searches millions of HD stock clips from the Pixabay Video library. Preview clips with full video player, see metadata like resolution and duration, and insert them directly into your project with one click.</p>
            <span class="feature-tag">&#x1F3AC; Pixabay HD Library</span>
          </div>
          <div class="feature-mockup"><div class="feature-mock-inner"><div class="feature-mockup-content"><div class="feature-broll-grid"><div class="feature-broll-item" style="position:relative"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:1.2rem">&#x25B6;</div></div><div class="feature-broll-item" style="position:relative;background:linear-gradient(135deg,rgba(236,72,153,0.15),rgba(245,158,11,0.1))"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:1.2rem">&#x25B6;</div></div><div class="feature-broll-item" style="position:relative;background:linear-gradient(135deg,rgba(16,185,129,0.15),rgba(59,130,246,0.1))"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:1.2rem">&#x25B6;</div></div><div class="feature-broll-item" style="position:relative;background:linear-gradient(135deg,rgba(245,158,11,0.15),rgba(239,68,68,0.1))"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:1.2rem">&#x25B6;</div></div><div class="feature-broll-item" style="position:relative;background:linear-gradient(135deg,rgba(59,130,246,0.15),rgba(108,58,237,0.1))"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:1.2rem">&#x25B6;</div></div><div class="feature-broll-item" style="position:relative;background:linear-gradient(135deg,rgba(239,68,68,0.15),rgba(236,72,153,0.1))"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:1.2rem">&#x25B6;</div></div></div></div></div></div>
        </div>

        <!-- Feature 6: Music Library -->
        <div class="feature-row reverse">
          <div class="feature-content">
            <h3>Music Library</h3>
            <h2>123 royalty-free tracks across 11 genres</h2>
            <p>Find the perfect background music for any content. Browse our curated library of 123 tracks spanning Ambient, Lo-Fi, Corporate, Cinematic, Upbeat, Hip-Hop, Electronic, Acoustic, Jazz, Classical, and Nature. Preview every track before adding it to your video. All tracks are 100% royalty-free — use them on any platform without copyright worries.</p>
            <span class="feature-tag">&#x1F3B5; Royalty-Free</span>
          </div>
          <div class="feature-mockup"><div class="feature-mock-inner"><div class="feature-mockup-content" style="display:flex;flex-direction:column;gap:8px;padding:10px"><div style="display:flex;gap:4px;flex-wrap:wrap"><span style="padding:3px 8px;border-radius:12px;background:rgba(108,58,237,0.2);color:#c4b5fd;font-size:.6rem">Ambient</span><span style="padding:3px 8px;border-radius:12px;background:rgba(236,72,153,0.2);color:#f9a8d4;font-size:.6rem">Lo-Fi</span><span style="padding:3px 8px;border-radius:12px;background:rgba(59,130,246,0.2);color:#93c5fd;font-size:.6rem">Corporate</span><span style="padding:3px 8px;border-radius:12px;background:rgba(245,158,11,0.2);color:#fcd34d;font-size:.6rem">Cinematic</span><span style="padding:3px 8px;border-radius:12px;background:rgba(16,185,129,0.2);color:#6ee7b7;font-size:.6rem">+7 more</span></div><div style="display:flex;flex-direction:column;gap:5px"><div style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:6px;padding:6px 10px"><div style="width:22px;height:22px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;font-size:.5rem;color:#fff;flex-shrink:0">&#x25B6;</div><div style="flex:1"><div style="font-size:.7rem;font-weight:600;color:var(--text)">Sunset Vibes</div><div style="font-size:.55rem;color:var(--text-muted)">Lo-Fi &middot; 2:45</div></div></div><div style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:6px;padding:6px 10px"><div style="width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;font-size:.5rem;color:var(--text-muted);flex-shrink:0">&#x25B6;</div><div style="flex:1"><div style="font-size:.7rem;font-weight:600;color:var(--text)">Corporate Rise</div><div style="font-size:.55rem;color:var(--text-muted)">Corporate &middot; 3:12</div></div></div><div style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:6px;padding:6px 10px"><div style="width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;font-size:.5rem;color:var(--text-muted);flex-shrink:0">&#x25B6;</div><div style="flex:1"><div style="font-size:.7rem;font-weight:600;color:var(--text)">Night Drive</div><div style="font-size:.55rem;color:var(--text-muted)">Electronic &middot; 4:01</div></div></div></div></div></div></div>
        </div>

        <!-- Feature 7: AI Reframe -->
        <div class="feature-row">
          <div class="feature-content">
            <h3>AI Reframe</h3>
            <h2>Resize any video for every platform in 1 click</h2>
            <p>Automatically convert your 16:9 landscape videos to 9:16 vertical for TikTok and Reels, 1:1 square for Instagram feed, 4:5 for Facebook, and any custom ratio you need. Our AI intelligently tracks the main subject so faces and key content stay perfectly centered — no manual cropping needed.</p>
            <span class="feature-tag">&#x1F680; One Click</span>
          </div>
          <div class="feature-mockup"><div class="feature-mock-inner"><div class="feature-mockup-content"><div class="feature-reframe-preview"><div class="feature-reframe-card"><div class="feature-reframe-video" style="width:100px;height:150px"></div><div class="feature-reframe-label">9:16 Vertical</div></div><div class="feature-reframe-card"><div class="feature-reframe-video" style="width:120px;height:120px"></div><div class="feature-reframe-label">1:1 Square</div></div><div class="feature-reframe-card"><div class="feature-reframe-video" style="width:150px;height:80px"></div><div class="feature-reframe-label">16:9 Wide</div></div></div></div></div></div>
        </div>

        <!-- Feature 8: Brand Voice -->
        <div class="feature-row">
          <div class="feature-content">
            <h3>Brand Voice</h3>
            <h2>Every piece of content sounds like you</h2>
            <p>Train our AI on your best-performing content, and it learns your unique tone, vocabulary, and style. Every created post — whether it's a tweet, LinkedIn article, or Instagram caption — comes out sounding authentically you. Set up custom tone profiles for different brands, clients, or content types.</p>
            <span class="feature-tag">&#x1F399; Custom AI Voice</span>
          </div>
          <div class="feature-mockup"><div class="feature-mock-inner"><div class="feature-mockup-content"><div class="feature-voice-layout"><div class="feature-voice-slider"><div class="feature-voice-slider-label">Tone</div><div class="feature-voice-slider-bar"><div class="feature-voice-slider-fill" style="width:60%"></div></div></div><div class="feature-voice-slider"><div class="feature-voice-slider-label">Engagement</div><div class="feature-voice-slider-bar"><div class="feature-voice-slider-fill" style="width:75%"></div></div></div><div class="feature-voice-slider"><div class="feature-voice-slider-label">Formality</div><div class="feature-voice-slider-bar"><div class="feature-voice-slider-fill" style="width:50%"></div></div></div></div></div></div></div>
        </div>

        <!-- Feature 9: Content Repurposing -->
        <div class="feature-row reverse">
          <div class="feature-content">
            <h3>Content Repurposing</h3>
            <h2>One link becomes content for every platform</h2>
            <p>Paste any YouTube link and our AI generates platform-optimized posts for Instagram, TikTok, Twitter/X, LinkedIn, Facebook, YouTube, and your blog. Choose from 5 content tones — Professional, Casual, Humorous, Inspirational, or Educational — or use your Brand Voice for perfectly consistent messaging across all platforms.</p>
            <span class="feature-tag">&#x1F504; Multi-Platform AI</span>
          </div>
          <div class="feature-mockup"><div class="feature-mock-inner"><div class="feature-mockup-content"><div style="display:flex;flex-direction:column;gap:8px;padding:8px"><div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center"><span style="padding:6px 12px;border-radius:8px;background:rgba(236,72,153,0.15);border:1px solid rgba(236,72,153,0.3);color:#f472b6;font-size:.7rem;font-weight:600">Instagram</span><span style="padding:6px 12px;border-radius:8px;background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;font-size:.7rem;font-weight:600">Twitter/X</span><span style="padding:6px 12px;border-radius:8px;background:rgba(108,58,237,0.15);border:1px solid rgba(108,58,237,0.3);color:#a78bfa;font-size:.7rem;font-weight:600">TikTok</span><span style="padding:6px 12px;border-radius:8px;background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);color:#93c5fd;font-size:.7rem;font-weight:600">LinkedIn</span><span style="padding:6px 12px;border-radius:8px;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);color:#34d399;font-size:.7rem;font-weight:600">Facebook</span></div><div style="display:flex;gap:4px;justify-content:center;margin-top:4px"><span style="padding:4px 8px;border-radius:4px;background:rgba(245,158,11,0.15);color:#fcd34d;font-size:.6rem">Professional</span><span style="padding:4px 8px;border-radius:4px;background:rgba(236,72,153,0.15);color:#f9a8d4;font-size:.6rem">Casual</span><span style="padding:4px 8px;border-radius:4px;background:rgba(108,58,237,0.15);color:#c4b5fd;font-size:.6rem">Humorous</span><span style="padding:4px 8px;border-radius:4px;background:rgba(16,185,129,0.15);color:#6ee7b7;font-size:.6rem">Inspirational</span><span style="padding:4px 8px;border-radius:4px;background:rgba(59,130,246,0.15);color:#93c5fd;font-size:.6rem">Educational</span></div></div></div></div></div>
        </div>

        <!-- Feature 10: Content Calendar -->
        <div class="feature-row">
          <div class="feature-content">
            <h3>Content Calendar</h3>
            <h2>Plan your uploads and never miss a post</h2>
            <p>Organize all your content on a visual calendar. Pick the exact date and time you want to upload to each platform, and choose to receive email reminders 30 minutes before, 1 hour before, or 1 day before. Stay on top of your content schedule without needing a separate planning tool.</p>
            <span class="feature-tag">&#x1F4C5; Email Reminders</span>
          </div>
          <div class="feature-mockup"><div class="feature-mock-inner"><div class="feature-mockup-content"><div class="feature-calendar-grid"><div class="feature-calendar-day">M</div><div class="feature-calendar-day">T</div><div class="feature-calendar-day">W</div><div class="feature-calendar-day">T</div><div class="feature-calendar-day">F</div><div class="feature-calendar-day">S</div><div class="feature-calendar-day">S</div><div class="feature-calendar-cell"></div><div class="feature-calendar-cell"></div><div class="feature-calendar-cell"></div><div class="feature-calendar-cell"></div><div class="feature-calendar-cell active"></div><div class="feature-calendar-cell"></div><div class="feature-calendar-cell"></div><div class="feature-calendar-cell"></div><div class="feature-calendar-cell active"></div><div class="feature-calendar-cell"></div><div class="feature-calendar-cell"></div><div class="feature-calendar-cell"></div><div class="feature-calendar-cell"></div><div class="feature-calendar-cell active"></div><div class="feature-calendar-cell"></div><div class="feature-calendar-cell"></div><div class="feature-calendar-cell"></div><div class="feature-calendar-cell"></div><div class="feature-calendar-cell"></div><div class="feature-calendar-cell active"></div><div class="feature-calendar-cell"></div><div class="feature-calendar-cell active"></div></div></div></div></div>
        </div>

      </div>
    </div>
  </section>

  <section id="how-it-works" style="background:var(--dark-2)">
    <div class="section-inner">
      <div class="section-header">
        <div class="section-label">How It Works</div>
        <h2 class="section-title">Four Steps to Everywhere</h2>
        <p class="section-subtitle">From a single video to a full week of content in under 5 minutes. No editing skills required.</p>
      </div>
      <div class="workflow-grid">
        <div class="workflow-card">
          <div class="workflow-number">1</div>
          <h3>Upload or Paste</h3>
          <p>Drop any YouTube URL, upload a video file (MP4, MOV, WebM), or paste a transcript. Splicora extracts everything it needs — transcripts, key moments, and visual context — automatically.</p>
        </div>
        <div class="workflow-card">
          <div class="workflow-number">2</div>
          <h3>AI Creates Everything</h3>
          <p>Our AI generates Smart Shorts clips, animated captions, scroll-stopping hooks with voice audio, platform-optimized text posts, and finds B-roll footage — all customized to your brand voice.</p>
        </div>
        <div class="workflow-card">
          <div class="workflow-number">3</div>
          <h3>Edit &amp; Perfect</h3>
          <p>Fine-tune everything in our built-in video editor. Adjust the timeline, add royalty-free music from 123 tracks, tweak captions, try different hook styles, and preview before publishing.</p>
        </div>
        <div class="workflow-card">
          <div class="workflow-number">4</div>
          <h3>Repurpose &amp; Schedule</h3>
          <p>Repurpose your content into platform-ready posts for Instagram, TikTok, Twitter/X, LinkedIn, and Facebook in 5 different tones. Schedule uploads on your Content Calendar and get email reminders so you never miss a post.</p>
        </div>
      </div>
    </div>
  </section>

  <section style="background:var(--dark)">
    <div class="section-inner">
      <div class="section-header">
        <div class="section-label">Why Splicora</div>
        <h2 class="section-title">The Only Platform You Need</h2>
        <p class="section-subtitle">Everything other tools charge extra for, we include in one powerful suite.</p>
      </div>
      <div class="teams-grid">
        <div class="team-card">
          <div class="team-card-icon">&#x1F3AC;</div>
          <h3>10 AI Tools in One</h3>
          <p>Smart Shorts, Video Editor, AI Captions, AI Hooks, AI B-Roll, Music Library, AI Reframe, Brand Voice, Content Repurposing, and Content Calendar — all under one roof. No juggling between 5 different apps.</p>
          <div class="team-card-mockup">&#x26A1;</div>
        </div>
        <div class="team-card">
          <div class="team-card-icon">&#x1F4B0;</div>
          <h3>No Hidden Costs</h3>
          <p>Free AI voices built in. 123 royalty-free music tracks included. Millions of stock B-roll clips. You bring your own ElevenLabs key only if you want premium voices — everything else is included.</p>
          <div class="team-card-mockup">&#x2705;</div>
        </div>
        <div class="team-card">
          <div class="team-card-icon">&#x1F46B;</div>
          <h3>Built for Teams</h3>
          <p>Invite your team, assign brand voices, share content libraries, and publish from one workspace. From solo creators to agencies managing 20+ clients — Splicora scales with you.</p>
          <div class="team-card-mockup">&#x1F680;</div>
        </div>
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
          <h3>Free</h3><div class="price">$0<span>/month</span></div>
          <p class="price-desc">Get started with AI content creation</p>
          <ul class="price-features"><li>3 videos per month</li><li>5 creations/month</li><li>1 brand voice</li><li>7-day history</li></ul>
          <a href="/auth/register" class="btn btn-outline">Start Free</a>
        </div>
        <div class="price-card featured">
          <h3>Starter</h3><div class="price">$19<span>/month</span></div>
          <p class="price-desc">Everything you need to grow</p>
          <ul class="price-features"><li>15 videos/month</li><li>30 creations/month</li><li>3 brand voices</li><li>Quick Narrate (your API key)</li><li>10 AI thumbnails/month</li><li>30 clips/month</li><li>Analytics &amp; calendar</li><li>No watermark</li></ul>
          <a href="/auth/register?plan=starter" class="btn btn-primary">Get Started</a>
        </div>
        <div class="price-card">
          <h3>Pro</h3><div class="price">$39<span>/month</span></div>
          <p class="price-desc">For creators serious about growth</p>
          <ul class="price-features"><li>50 videos/month</li><li>100 creations/month</li><li>10 brand voices</li><li>Unlimited narrations</li><li>50 thumbnails/month</li><li>150 clips/month</li><li>A/B testing &amp; batch analysis</li><li>Unlimited history</li><li>Full analytics &amp; calendar</li></ul>
          <a href="/auth/register?plan=pro" class="btn btn-primary">Go Pro</a>
        </div>
        <div class="price-card">
          <h3>Teams</h3><div class="price">$79<span>/month</span></div>
          <p class="price-desc">Scale with your whole team</p>
          <ul class="price-features"><li>200 videos/month</li><li>500 creations/month</li><li>25 brand voices</li><li>Unlimited narrations</li><li>150 thumbnails/month</li><li>500 clips/month</li><li>5 team seats</li><li>Priority processing</li><li>A/B thumbnail testing</li><li>Batch content analysis</li><li>Full analytics &amp; calendar</li><li>Unlimited history</li></ul>
          <a href="/auth/register?plan=teams" class="btn btn-primary">Start Teams</a>
        </div>
      </div>
    </div>
  </section>

  <section style="background:var(--dark-2)">
    <div class="section-inner">
      <div class="section-header">
        <div class="section-label">Testimonials</div>
        <h2 class="section-title">Loved by Creators</h2>
        <p class="section-subtitle">See what our users are saying about Splicora.</p>
      </div>
      <div class="marquee-testimonials">
        <div class="marquee-container">
          <div class="testimonial-marquee-card">
            <div class="testimonial-stars">⭐⭐⭐⭐⭐</div>
            <p class="testimonial-quote">"Splicora saves me 10+ hours every week. I paste my YouTube link and get perfect content for all my socials instantly."</p>
            <div class="testimonial-author-name">Jake Morrison</div>
            <div class="testimonial-author-role">YouTube Creator, 500K subs</div>
          </div>
          <div class="testimonial-marquee-card">
            <div class="testimonial-stars">⭐⭐⭐⭐⭐</div>
            <p class="testimonial-quote">"Our agency manages 20+ clients. Splicora turned a 3-person job into something one person handles easily."</p>
            <div class="testimonial-author-name">Sarah Rodriguez</div>
            <div class="testimonial-author-role">Digital Agency Owner</div>
          </div>
          <div class="testimonial-marquee-card">
            <div class="testimonial-stars">⭐⭐⭐⭐⭐</div>
            <p class="testimonial-quote">"The AI understands my brand voice perfectly. The captions it generates get more engagement than what I wrote manually."</p>
            <div class="testimonial-author-name">David Kim</div>
            <div class="testimonial-author-role">E-commerce Entrepreneur</div>
          </div>
          <div class="testimonial-marquee-card">
            <div class="testimonial-stars">⭐⭐⭐⭐⭐</div>
            <p class="testimonial-quote">"I went from 2-3 posts per week to 15+ posts. The time I save is incredible and the quality is just as good."</p>
            <div class="testimonial-author-name">Alex Turner</div>
            <div class="testimonial-author-role">Content Creator</div>
          </div>
          <div class="testimonial-marquee-card">
            <div class="testimonial-stars">⭐⭐⭐⭐⭐</div>
            <p class="testimonial-quote">"Finally, a tool that understands platform differences. No more manual resizing and editing for each platform."</p>
            <div class="testimonial-author-name">Maria Chen</div>
            <div class="testimonial-author-role">Marketing Manager</div>
          </div>
          <div class="testimonial-marquee-card">
            <div class="testimonial-stars">⭐⭐⭐⭐⭐</div>
            <p class="testimonial-quote">"The ROI was immediate. We cut production costs by 60% while actually increasing output quality and quantity."</p>
            <div class="testimonial-author-name">James Wilson</div>
            <div class="testimonial-author-role">Startup Founder</div>
          </div>
          <div class="testimonial-marquee-card">
            <div class="testimonial-stars">⭐⭐⭐⭐⭐</div>
            <p class="testimonial-quote">"Splicora saves me 10+ hours every week. I paste my YouTube link and get perfect content for all my socials instantly."</p>
            <div class="testimonial-author-name">Jake Morrison</div>
            <div class="testimonial-author-role">YouTube Creator, 500K subs</div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section>
    <div class="section-inner">
      <div class="section-header">
        <div class="section-label">FAQ</div>
        <h2 class="section-title">Got Questions?</h2>
        <p class="section-subtitle">Find answers to common questions about Splicora.</p>
      </div>
      <div class="faq-container">
        <div class="faq-item" onclick="toggleFaq(this)">
          <div class="faq-header">
            <h3>How does Splicora work?</h3>
            <span class="faq-toggle">+</span>
          </div>
          <div class="faq-content">
            <p>Paste a YouTube link, upload a video file, or enter a transcript. Our AI analyzes the content and generates optimized short clips, captions, hooks, text posts, and more for every major platform. Edit everything in our built-in video editor, add music, then schedule and publish — all from one dashboard.</p>
          </div>
        </div>
        <div class="faq-item" onclick="toggleFaq(this)">
          <div class="faq-header">
            <h3>What formats and platforms do you support?</h3>
            <span class="faq-toggle">+</span>
          </div>
          <div class="faq-content">
            <p>Upload MP4, MOV, WebM, AVI, and QuickTime videos of any length. We generate content optimized for Instagram Reels, TikTok, YouTube Shorts, Facebook, LinkedIn, Twitter/X, Pinterest, and more. Each output is automatically formatted for that platform's unique requirements.</p>
          </div>
        </div>
        <div class="faq-item" onclick="toggleFaq(this)">
          <div class="faq-header">
            <h3>What AI tools are included?</h3>
            <span class="faq-toggle">+</span>
          </div>
          <div class="faq-content">
            <p>You get access to 10 powerful tools: Smart Shorts (AI clipping), a full Video Editor with timeline, AI Captions (6 animated styles), AI Hook Generator (with free built-in voices), AI B-Roll (millions of stock clips), a Music Library (123 royalty-free tracks), AI Reframe (auto-resize), Brand Voice AI, Content Repurposing (turn any video into posts for every platform), and a Content Calendar with email reminders.</p>
          </div>
        </div>
        <div class="faq-item" onclick="toggleFaq(this)">
          <div class="faq-header">
            <h3>Do I need an ElevenLabs API key?</h3>
            <span class="faq-toggle">+</span>
          </div>
          <div class="faq-content">
            <p>No! Our AI Hook Generator includes 6 high-quality free AI voices built in — you can generate scroll-stopping hooks with audio immediately, no API key needed. If you want premium ElevenLabs voices, you can optionally connect your own key in Settings.</p>
          </div>
        </div>
        <div class="faq-item" onclick="toggleFaq(this)">
          <div class="faq-header">
            <h3>Is the music really royalty-free?</h3>
            <span class="faq-toggle">+</span>
          </div>
          <div class="faq-content">
            <p>Yes! All 123 tracks in our Music Library are 100% royalty-free. Use them on YouTube, TikTok, Instagram, or any other platform without worrying about copyright claims. Browse across 11 genres including Ambient, Lo-Fi, Corporate, Cinematic, Hip-Hop, and more.</p>
          </div>
        </div>
        <div class="faq-item" onclick="toggleFaq(this)">
          <div class="faq-header">
            <h3>How do AI Captions work?</h3>
            <span class="faq-toggle">+</span>
          </div>
          <div class="faq-content">
            <p>Upload a video or paste a YouTube link. Our AI uses OpenAI Whisper to transcribe speech with word-level timing accuracy, then generates animated captions. Choose from 6 styles — Karaoke, Bold Pop, Minimal, Neon Glow, Typewriter, and Cinematic — position them anywhere on screen, and export the final video.</p>
          </div>
        </div>
        <div class="faq-item" onclick="toggleFaq(this)">
          <div class="faq-header">
            <h3>Is there a free plan?</h3>
            <span class="faq-toggle">+</span>
          </div>
          <div class="faq-content">
            <p>Yes! Our Free plan lets you try Splicora with 3 videos per month. You get access to all core tools including the video editor, AI captions, and free AI voices. Upgrade to unlock more videos, clips, and premium features.</p>
          </div>
        </div>
        <div class="faq-item" onclick="toggleFaq(this)">
          <div class="faq-header">
            <h3>How do I get help?</h3>
            <span class="faq-toggle">+</span>
          </div>
          <div class="faq-content">
            <p>We offer email support for all users and live chat support for Premium and Teams plans. Check out our help center, video tutorials, and community forum for tips, guides, and best practices.</p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="cta-section">
    <div class="section-inner">
      <h2 class="section-title">Stop Wasting Hours on One Platform</h2>
      <p class="section-subtitle" style="margin:1rem auto 2rem">10 AI tools. Every platform. One subscription. Join thousands of creators who turn a single video into a week of content in under 5 minutes.</p>
      <div class="hero-input-group" style="margin-bottom:1rem">
        <input class="hero-input" type="text" placeholder="Paste your YouTube link here..." value="">
        <button class="btn btn-primary">Create &#x26A1;</button>
      </div>
      <p style="color:var(--text-dim);font-size:.85rem">Free plan available &middot; No credit card required</p>
    </div>
  </section>

  <!-- Get the App Section -->
  <section id="get-app" style="padding:80px 2rem;text-align:center;background:linear-gradient(180deg,var(--dark) 0%,rgba(108,58,237,0.08) 50%,var(--dark) 100%);">
    <div style="max-width:700px;margin:0 auto;">
      <div style="font-size:3rem;margin-bottom:1rem;">&#x1F4F1;</div>
      <h2 class="section-title" style="margin-bottom:.8rem;">Get the Splicora App</h2>
      <p style="color:var(--text-dim);font-size:1.05rem;line-height:1.8;margin-bottom:2rem;">
        Install Splicora on your phone for the full app experience — no app store needed. Access all features, get notifications, and create content on the go.
      </p>
      <div style="display:flex;gap:1.5rem;justify-content:center;flex-wrap:wrap;margin-bottom:2.5rem;">
        <div style="background:var(--surface);border:var(--border-subtle);border-radius:16px;padding:24px 28px;flex:1;min-width:250px;max-width:320px;text-align:left;">
          <div style="font-size:1.8rem;margin-bottom:.8rem;">&#xF8FF;</div>
          <div style="font-weight:700;font-size:1rem;margin-bottom:.5rem;color:var(--text);">iPhone / iPad</div>
          <ol style="color:var(--text-muted);font-size:.88rem;line-height:2;padding-left:1.2rem;">
            <li>Open <strong style="color:var(--text)">splicora.ai</strong> in Safari</li>
            <li>Tap the <strong style="color:var(--text)">Share</strong> button &#x2191;</li>
            <li>Tap <strong style="color:var(--text)">Add to Home Screen</strong></li>
          </ol>
        </div>
        <div style="background:var(--surface);border:var(--border-subtle);border-radius:16px;padding:24px 28px;flex:1;min-width:250px;max-width:320px;text-align:left;">
          <div style="font-size:1.8rem;margin-bottom:.8rem;">&#x1F4F1;</div>
          <div style="font-weight:700;font-size:1rem;margin-bottom:.5rem;color:var(--text);">Android</div>
          <ol style="color:var(--text-muted);font-size:.88rem;line-height:2;padding-left:1.2rem;">
            <li>Open <strong style="color:var(--text)">splicora.ai</strong> in Chrome</li>
            <li>Tap the <strong style="color:var(--text)">menu</strong> &#x22EE; (three dots)</li>
            <li>Tap <strong style="color:var(--text)">Install app</strong> or <strong style="color:var(--text)">Add to Home Screen</strong></li>
          </ol>
        </div>
      </div>
      <p style="color:var(--text-dim);font-size:.85rem;">Works like a native app — no download from the App Store or Google Play required.</p>
    </div>
  </section>

  <footer class="footer">
    <div class="footer-grid">
      <div class="footer-brand">
        <a href="/" class="nav-logo">&#x26A1; ${BRAND.name}</a>
        <p>AI-powered content creation platform. Turn one YouTube video into optimized content for every major social platform.</p>
      </div>
      <div><h4>Product</h4><a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#how-it-works">How It Works</a><a href="/dashboard">Dashboard</a><a href="#get-app" style="color:var(--primary-light)">&#x1F4F1; Get the App</a></div>
      <div><h4>Company</h4><a href="/contact">Contact</a><a href="/about">About</a><a href="/blog">Blog</a><a href="/careers">Careers</a></div>
      <div><h4>Legal</h4><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a><a href="/cookies">Cookie Policy</a></div>
    </div>
    <div class="footer-bottom">
      <span>&copy; 2026 ${BRAND.name}. All rights reserved.</span>
      <span>Built with &#x2764;&#xFE0F; and AI</span>
    </div>
  </footer>

  <!-- Mobile Install Banner -->
  <div id="installBanner" style="display:none;position:fixed;bottom:0;left:0;right:0;z-index:9999;background:linear-gradient(135deg,#6C3AED,#EC4899);padding:14px 20px;text-align:center;box-shadow:0 -4px 20px rgba(0,0,0,0.3);">
    <div style="display:flex;align-items:center;justify-content:center;gap:12px;max-width:600px;margin:0 auto;">
      <div style="font-size:1.5rem;">&#x26A1;</div>
      <div style="flex:1;text-align:left;">
        <div style="font-weight:700;font-size:.9rem;color:#fff;">Get the Splicora App</div>
        <div style="font-size:.75rem;color:rgba(255,255,255,0.8);" id="installHint">Install for the best experience</div>
      </div>
      <button id="installBtn" onclick="installApp()" style="padding:8px 20px;background:#fff;color:#6C3AED;border:none;border-radius:50px;font-weight:700;font-size:.82rem;cursor:pointer;white-space:nowrap;">Install</button>
      <button onclick="dismissInstallBanner()" style="background:none;border:none;color:rgba(255,255,255,0.7);font-size:1.2rem;cursor:pointer;padding:4px;">&#x2715;</button>
    </div>
  </div>

  <script>
    // Carousel functionality
    let currentSlide = 0;
    const carousel = document.getElementById('carousel');
    const totalSlides = 10;

    // Generate dots
    (function() {
      var dotsEl = document.getElementById('carouselDots');
      if (!dotsEl) return;
      for (var i = 0; i < totalSlides; i++) {
        var dot = document.createElement('span');
        dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
        dot.setAttribute('onclick', 'goToSlide(' + i + ')');
        dotsEl.appendChild(dot);
      }
    })();

    var slideTimer = null;
    var NON_VIDEO_SLIDE_MS = 6000;

    function clearSlideTimer() {
      if (slideTimer) { clearTimeout(slideTimer); slideTimer = null; }
    }

    function updateCarousel() {
      // Shift slides by setting margin-left on the first slide. This avoids
      // the transform-on-clipping-element trap: the carousel itself (which has
      // overflow:hidden) stays put while its children slide inside it.
      var firstSlide = document.querySelector('.carousel-slide');
      if (firstSlide) {
        firstSlide.style.marginLeft = (-currentSlide * 100) + '%';
      }
      updateCarouselLabels();
      document.querySelectorAll('.carousel-dot').forEach(function(dot, idx) {
        dot.classList.toggle('active', idx === currentSlide);
      });
      var counter = document.getElementById('slideCounter');
      if (counter) counter.textContent = (currentSlide + 1) + ' / ' + totalSlides;
      updateCarouselVideos();
      scheduleNextAdvance();
    }

    function updateCarouselVideos() {
      var slides = document.querySelectorAll('.carousel-slide');
      slides.forEach(function(slide, idx) {
        var video = slide.querySelector('video[data-src]');
        if (!video) return;
        if (idx === currentSlide) {
          if (!video.src) {
            video.src = video.dataset.src;
            try { video.load(); } catch (e) {}
          }
          try { video.currentTime = 0; } catch (e) {}
          var p = video.play();
          if (p && p.catch) p.catch(function(){});
        } else {
          try { video.pause(); } catch (e) {}
        }
      });
    }

    function scheduleNextAdvance() {
      clearSlideTimer();
      var activeSlide = document.querySelectorAll('.carousel-slide')[currentSlide];
      var activeVideo = activeSlide ? activeSlide.querySelector('video[data-src]') : null;
      if (activeVideo) {
        // Wait for this specific video to finish, then advance
        var advanced = false;
        var onEnded = function() {
          if (advanced) return;
          advanced = true;
          activeVideo.removeEventListener('ended', onEnded);
          nextSlide();
        };
        activeVideo.addEventListener('ended', onEnded);
        // Fallback timeout in case 'ended' never fires (stalled video, etc.)
        slideTimer = setTimeout(function() {
          if (advanced) return;
          advanced = true;
          activeVideo.removeEventListener('ended', onEnded);
          nextSlide();
        }, 15000);
      } else {
        slideTimer = setTimeout(nextSlide, NON_VIDEO_SLIDE_MS);
      }
    }

    // Kick off the carousel once the DOM is ready
    updateCarouselVideos();
    scheduleNextAdvance();

    function updateCarouselLabels() {
      document.querySelectorAll('.carousel-label').forEach((label, idx) => {
        label.classList.toggle('active', idx === currentSlide);
      });
    }

    function nextSlide() {
      currentSlide = (currentSlide + 1) % totalSlides;
      updateCarousel();
    }

    function prevSlide() {
      currentSlide = (currentSlide - 1 + totalSlides) % totalSlides;
      updateCarousel();
    }

    function goToSlide(n) {
      currentSlide = n;
      updateCarousel();
    }

    // FAQ accordion functionality
    function toggleFaq(item) {
      const isOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item').forEach(el => el.classList.remove('open'));
      if (!isOpen) item.classList.add('open');
    }

    // PWA Install Banner Logic
    var deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', function(e) {
      e.preventDefault();
      deferredPrompt = e;
      showInstallBanner();
    });

    function showInstallBanner() {
      if (localStorage.getItem('installDismissed')) return;
      if (window.matchMedia('(display-mode: standalone)').matches) return;
      var banner = document.getElementById('installBanner');
      var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      var isAndroid = /Android/.test(navigator.userAgent);
      if (isIOS) {
        document.getElementById('installHint').textContent = 'Tap Share ↑ then "Add to Home Screen"';
        document.getElementById('installBtn').textContent = 'How To';
        document.getElementById('installBtn').onclick = function() { document.getElementById('get-app').scrollIntoView({behavior:'smooth'}); };
        banner.style.display = 'block';
      } else if (deferredPrompt || isAndroid) {
        banner.style.display = 'block';
      }
    }

    function installApp() {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function(result) {
          deferredPrompt = null;
          document.getElementById('installBanner').style.display = 'none';
        });
      } else {
        document.getElementById('get-app').scrollIntoView({behavior:'smooth'});
      }
    }

    function dismissInstallBanner() {
      document.getElementById('installBanner').style.display = 'none';
      localStorage.setItem('installDismissed', '1');
    }

    // Show banner on mobile after a short delay
    setTimeout(function() {
      var isMobile = window.innerWidth <= 768;
      if (isMobile && !window.matchMedia('(display-mode: standalone)').matches && !localStorage.getItem('installDismissed')) {
        showInstallBanner();
      }
    }, 3000);

    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(function(){});
    }

    function toggleTheme(){var isLight=!document.body.classList.contains('light');document.body.classList.toggle('light',isLight);document.documentElement.setAttribute('data-theme',isLight?'light':'dark');localStorage.setItem('theme',isLight?'light':'dark');var btn=document.querySelector('.theme-toggle');if(btn)btn.textContent=isLight?'☀️':'🌙'}(function(){var s=localStorage.getItem('theme');if(s==='light'){document.body.classList.add('light');document.documentElement.setAttribute('data-theme','light');var btn=document.querySelector('.theme-toggle');if(btn)btn.textContent='☀️'}})();
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', e => { e.preventDefault(); const t = document.querySelector(a.getAttribute('href')); if(t) t.scrollIntoView({behavior:'smooth',block:'start'}); });
    });
    window.addEventListener('scroll', () => { var isLight = document.body.classList.contains('light'); var nav = document.querySelector('.nav'); if(isLight){ nav.style.background = window.scrollY > 50 ? 'rgba(248,249,252,0.95)' : 'rgba(248,249,252,0.85)'; } else { nav.style.background = window.scrollY > 50 ? 'rgba(15,15,26,0.95)' : 'rgba(15,15,26,0.8)'; } });
  </script>
<script src="/public/js/media-panel-fix.js"></script>
</body>
</html>`;
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.send(html);
});

module.exports = router;
