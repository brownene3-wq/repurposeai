const express = require('express');
const router = express.Router();
const { optionalAuth } = require('../middleware/auth');
const { contactOps } = require('../db/database');

router.get('/', optionalAuth, (req, res) => {
  res.send(renderContactPage(req.user));
});

router.post('/submit', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email, and message are required' });
    }
    contactOps.create(name, email, subject || 'General Inquiry', message);
    res.json({ success: true, message: 'Message sent successfully! We\'ll get back to you within 24 hours.' });
  } catch (err) {
    console.error('Contact error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

function renderContactPage(user) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Contact — RepurposeAI</title>
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
.container{max-width:1200px;margin:0 auto;padding:0 24px}

.contact{padding:140px 0 80px;position:relative;z-index:1}
.contact__grid{display:grid;grid-template-columns:1fr 1.2fr;gap:60px;align-items:start}
.contact__info h1{font-size:clamp(2rem,4vw,2.8rem);font-weight:800;letter-spacing:-1px;margin-bottom:16px}
.contact__info p{color:var(--text2);font-size:1.05rem;line-height:1.8;margin-bottom:32px}
.info-cards{display:flex;flex-direction:column;gap:16px}
.info-card{display:flex;align-items:center;gap:16px;padding:20px;background:var(--bg3);border:1px solid var(--border);border-radius:14px;transition:all .3s}
.info-card:hover{border-color:rgba(124,58,237,.3);transform:translateX(4px)}
.info-card__icon{width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0}
.info-card__icon--purple{background:rgba(124,58,237,.15);color:var(--accent)}
.info-card__icon--cyan{background:rgba(6,182,212,.15);color:var(--accent2)}
.info-card__icon--pink{background:rgba(244,114,182,.15);color:var(--accent3)}
.info-card__title{font-size:.85rem;font-weight:600;margin-bottom:2px}
.info-card__text{font-size:.9rem;color:var(--text2)}

.contact-form{background:var(--bg3);border:1px solid var(--border);border-radius:20px;padding:40px}
.contact-form h2{font-size:1.3rem;font-weight:700;margin-bottom:24px}
.form-row{display:flex;gap:16px;margin-bottom:16px}
.form-group{flex:1;display:flex;flex-direction:column;gap:6px}
.form-group label{font-size:.8rem;font-weight:600;color:var(--text2)}
.form-group input,.form-group textarea,.form-group select{width:100%;padding:13px 16px;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:12px;color:var(--text);font-size:.92rem;font-family:inherit;outline:none;transition:all .3s;resize:vertical}
.form-group input:focus,.form-group textarea:focus,.form-group select:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(124,58,237,.1)}
.form-group select option{background:var(--bg3)}
.form-group input::placeholder,.form-group textarea::placeholder{color:var(--text3)}
.btn-submit{width:100%;padding:15px;border:none;border-radius:99px;background:var(--gradient);color:#fff;font-size:1rem;font-weight:700;cursor:pointer;transition:all .3s;font-family:inherit;box-shadow:0 4px 20px rgba(124,58,237,.4);margin-top:8px}
.btn-submit:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(124,58,237,.5)}
.btn-submit:disabled{opacity:.5;cursor:not-allowed;transform:none}
.success-msg{background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.3);color:#34d399;padding:16px 20px;border-radius:12px;display:none;text-align:center;margin-top:16px}
.success-msg.visible{display:block}
.error-msg{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);color:#f87171;padding:12px 16px;border-radius:10px;font-size:.85rem;display:none;margin-bottom:16px}
.error-msg.visible{display:block}

@media(max-width:768px){
  .contact__grid{grid-template-columns:1fr}
  .form-row{flex-direction:column}
}
</style></head><body>
<div class="bg-orb bg-orb--1"></div><div class="bg-orb bg-orb--2"></div>
<nav><div class="nav-inner">
  <a href="/" class="logo">Repurpose<span>AI</span></a>
  <div class="nav-links">
    <a href="/">Home</a>
    <a href="/pricing">Pricing</a>
    <a href="/contact">Contact</a>
    ${user ? `<a href="/dashboard" style="padding:10px 24px;border-radius:99px;background:linear-gradient(135deg,#7c3aed,#06b6d4);color:#fff;font-weight:600;font-size:.85rem">Dashboard</a>` : `<a href="/login" style="color:var(--accent2);font-weight:600">Log In</a>`}
  </div>
</div></nav>

<section class="contact"><div class="container"><div class="contact__grid">
  <div class="contact__info">
    <h1>Get in Touch</h1>
    <p>Have a question, feedback, or interested in our Enterprise plan? We'd love to hear from you. Our team typically responds within 24 hours.</p>
    <div class="info-cards">
      <div class="info-card">
        <div class="info-card__icon info-card__icon--purple">&#9993;</div>
        <div><div class="info-card__title">Email</div><div class="info-card__text">hello@repurposeai.com</div></div>
      </div>
      <div class="info-card">
        <div class="info-card__icon info-card__icon--cyan">&#128172;</div>
        <div><div class="info-card__title">Live Chat</div><div class="info-card__text">Available Mon-Fri, 9am-6pm EST</div></div>
      </div>
      <div class="info-card">
        <div class="info-card__icon info-card__icon--pink">&#127758;</div>
        <div><div class="info-card__title">Community</div><div class="info-card__text">Join 5,000+ creators on Discord</div></div>
      </div>
    </div>
  </div>

  <div class="contact-form">
    <h2>Send us a message</h2>
    <div id="errorMsg" class="error-msg"></div>
    <form id="contactForm" onsubmit="handleContact(event)">
      <div class="form-row">
        <div class="form-group"><label>Full Name</label><input type="text" name="name" placeholder="John Doe" required value="${user?.name || ''}"></div>
        <div class="form-group"><label>Email</label><input type="email" name="email" placeholder="you@example.com" required value="${user?.email || ''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Subject</label>
          <select name="subject">
            <option>General Inquiry</option>
            <option>Sales / Enterprise</option>
            <option>Technical Support</option>
            <option>Partnership</option>
            <option>Bug Report</option>
            <option>Feature Request</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Message</label><textarea name="message" rows="5" placeholder="Tell us how we can help..." required></textarea></div>
      </div>
      <button type="submit" class="btn-submit" id="submitBtn">Send Message &rarr;</button>
    </form>
    <div id="successMsg" class="success-msg">
      &#10003; Message sent successfully! We'll get back to you within 24 hours.
    </div>
  </div>
</div></div></section>

<script>
async function handleContact(e) {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const errEl = document.getElementById('errorMsg');
  const succEl = document.getElementById('successMsg');
  btn.disabled = true; btn.textContent = 'Sending...';
  errEl.classList.remove('visible'); succEl.classList.remove('visible');

  const fd = new FormData(document.getElementById('contactForm'));
  const data = Object.fromEntries(fd);

  try {
    // Send to our API (saves to DB)
    const res = await fetch('/contact/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);

    // Also try Formspree if configured
    const formspreeEndpoint = '${process.env.FORMSPREE_ENDPOINT || ''}';
    if (formspreeEndpoint && !formspreeEndpoint.includes('YOUR_FORM_ID')) {
      fetch(formspreeEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(data)
      }).catch(() => {});
    }

    succEl.classList.add('visible');
    document.getElementById('contactForm').style.display = 'none';
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add('visible');
    btn.disabled = false; btn.textContent = 'Send Message →';
  }
}
</script>
</body></html>`;
}

module.exports = router;
