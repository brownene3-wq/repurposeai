const express = require('express');
const router = express.Router();
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { userOps } = require('../db/database');

// GET /pricing (public page)
router.get('/pricing', optionalAuth, (req, res) => {
  res.send(renderPricingPage(req.user));
});

// POST /api/billing/create-checkout
router.post('/api/billing/create-checkout', requireAuth, async (req, res) => {
  try {
    const { plan } = req.body;
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    if (!['pro', 'enterprise'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const priceId = plan === 'pro' ? process.env.STRIPE_PRICE_PRO : process.env.STRIPE_PRICE_ENTERPRISE;

    // Create or retrieve Stripe customer
    let customerId = req.user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        name: req.user.name,
        metadata: { userId: req.user.id }
      });
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL}/pricing`,
      metadata: { userId: req.user.id, plan }
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    // Graceful fallback for demo mode
    if (err.message.includes('Invalid API Key') || err.message.includes('placeholder')) {
      return res.json({
        demo: true,
        message: 'Stripe is in demo mode. In production, you would be redirected to Stripe Checkout.',
        url: `/billing/demo-success?plan=${req.body.plan}`
      });
    }
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// GET /billing/success
router.get('/billing/success', requireAuth, async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.retrieve(req.query.session_id);

    if (session.payment_status === 'paid') {
      const plan = session.metadata.plan;
      userOps.updatePlan(req.user.id, plan, session.customer, session.subscription);
    }
  } catch (err) {
    console.error('Success page error:', err.message);
  }
  res.redirect('/dashboard');
});

// GET /billing/demo-success (demo mode)
router.get('/billing/demo-success', requireAuth, (req, res) => {
  const plan = req.query.plan || 'pro';
  userOps.updatePlan(req.user.id, plan, 'demo_customer', 'demo_subscription');
  res.send(renderSuccessPage(plan));
});

// POST /api/billing/webhook (Stripe webhook)
router.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const sig = req.headers['stripe-signature'];
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

    switch (event.type) {
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const userId = subscription.metadata?.userId;
        if (userId) {
          const status = subscription.status === 'active' ? subscription.metadata.plan : 'starter';
          userOps.updatePlan(userId, status, subscription.customer, subscription.id);
        }
        break;
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(400).json({ error: 'Webhook failed' });
  }
});

function renderSuccessPage(plan) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Upgrade Successful — RepurposeAI</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',sans-serif;background:#06060f;color:#f0f0ff;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}
.card{background:#11112a;border:1px solid rgba(124,58,237,0.2);border-radius:20px;padding:60px 40px;max-width:480px}
.icon{font-size:4rem;margin-bottom:20px}h1{font-size:1.8rem;font-weight:800;margin-bottom:10px}
p{color:#a0a0c0;margin-bottom:24px;line-height:1.7}
.btn{display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#7c3aed,#06b6d4);color:#fff;border-radius:99px;font-weight:700;text-decoration:none;transition:all .3s}
.btn:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(124,58,237,0.5)}
.plan{display:inline-block;padding:4px 16px;border-radius:99px;font-weight:700;font-size:0.85rem;margin-bottom:20px;background:rgba(124,58,237,0.15);color:#7c3aed}
</style></head><body>
<div class="card">
<div class="icon">&#127881;</div>
<span class="plan">${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan</span>
<h1>Upgrade Successful!</h1>
<p>Your account has been upgraded to the ${plan} plan. You now have access to all ${plan === 'pro' ? 'Pro' : 'Enterprise'} features.</p>
<a href="/dashboard" class="btn">Go to Dashboard &rarr;</a>
</div></body></html>`;
}

function renderPricingPage(user) {
  const currentPlan = user?.plan || 'none';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Pricing — RepurposeAI</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#06060f;--bg2:#0c0c1d;--bg3:#11112a;--accent:#7c3aed;--accent2:#06b6d4;--text:#f0f0ff;--text2:#a0a0c0;--text3:#6a6a8e;--border:rgba(124,58,237,0.15);--gradient:linear-gradient(135deg,#7c3aed,#06b6d4)}
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
.hero{padding:140px 0 60px;text-align:center;position:relative;z-index:1}
.hero h1{font-size:clamp(2rem,4vw,3rem);font-weight:800;letter-spacing:-1px;margin-bottom:12px}
.hero p{color:var(--text2);font-size:1.1rem;max-width:500px;margin:0 auto}
.toggle{display:flex;justify-content:center;gap:0;margin:40px auto 48px;background:var(--bg3);border:1px solid var(--border);border-radius:99px;padding:4px;width:fit-content}
.toggle button{padding:10px 24px;border:none;border-radius:99px;font-size:.9rem;font-weight:600;cursor:pointer;font-family:inherit;transition:all .3s;background:transparent;color:var(--text3)}
.toggle button.active{background:var(--gradient);color:#fff}
.pricing-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;position:relative;z-index:1;padding-bottom:100px}
.card{background:var(--bg3);border:1px solid var(--border);border-radius:20px;padding:40px;position:relative;transition:all .4s}
.card:hover{transform:translateY(-4px)}
.card.featured{border-color:var(--accent);background:linear-gradient(180deg,rgba(124,58,237,.08),var(--bg3));box-shadow:0 0 60px rgba(124,58,237,.2);transform:scale(1.03)}
.card.featured:hover{transform:scale(1.03) translateY(-4px)}
.badge{position:absolute;top:-14px;left:50%;transform:translateX(-50%);background:var(--gradient);padding:6px 20px;border-radius:99px;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:1px}
.plan-name{font-size:1rem;font-weight:600;color:var(--text2);margin-bottom:8px}
.price{font-size:3rem;font-weight:900;letter-spacing:-2px;margin-bottom:4px}
.price span{font-size:1rem;font-weight:400;color:var(--text3)}
.price-desc{font-size:.9rem;color:var(--text3);margin-bottom:28px}
.features{display:flex;flex-direction:column;gap:14px;margin-bottom:32px}
.feat{display:flex;align-items:center;gap:12px;font-size:.92rem;color:var(--text2)}
.chk{width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.7rem;flex-shrink:0}
.chk.y{background:rgba(52,211,153,.15);color:#34d399}.chk.n{background:rgba(100,100,130,.15);color:var(--text3)}
.btn{display:block;width:100%;padding:14px;border:none;border-radius:99px;font-size:.95rem;font-weight:700;cursor:pointer;font-family:inherit;transition:all .3s;text-align:center;text-decoration:none}
.btn-primary{background:var(--gradient);color:#fff;box-shadow:0 4px 20px rgba(124,58,237,.4)}
.btn-primary:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(124,58,237,.5)}
.btn-outline{background:transparent;color:var(--text);border:1px solid var(--border)}
.btn-outline:hover{border-color:var(--accent);background:rgba(124,58,237,.05)}
.btn-current{background:rgba(52,211,153,.1);color:#34d399;border:1px solid rgba(52,211,153,.3);cursor:default}
@media(max-width:968px){.pricing-grid{grid-template-columns:1fr;max-width:440px;margin:0 auto}.card.featured{transform:none}}
</style></head><body>
<div class="bg-orb bg-orb--1"></div><div class="bg-orb bg-orb--2"></div>
<nav><div class="nav-inner">
  <a href="/" class="logo">Repurpose<span>AI</span></a>
  <div class="nav-links">
    <a href="/">Home</a>
    <a href="/pricing">Pricing</a>
    <a href="/contact">Contact</a>
    ${user ? `<a href="/dashboard" class="btn-primary" style="padding:10px 24px;border-radius:99px;display:inline-block;font-weight:600;font-size:.85rem">Dashboard</a>` : `<a href="/login" style="color:var(--accent2);font-weight:600">Log In</a><a href="/signup" class="btn-primary" style="padding:10px 24px;border-radius:99px;display:inline-block;font-weight:600;font-size:.85rem">Get Started</a>`}
  </div>
</div></nav>
<section class="hero"><div class="container">
  <h1>Choose Your Plan</h1>
  <p>Start free. Upgrade when you're ready. Cancel anytime.</p>
  <div class="toggle"><button class="active" id="monthlyBtn" onclick="setMonthly()">Monthly</button><button id="yearlyBtn" onclick="setYearly()">Yearly (Save 20%)</button></div>
</div></section>
<div class="container">
<div class="pricing-grid">
  <div class="card">
    <p class="plan-name">Starter</p>
    <p class="price" data-monthly="$0" data-yearly="$0">$0 <span>/ month</span></p>
    <p class="price-desc">Perfect for getting started</p>
    <div class="features">
      <div class="feat"><span class="chk y">&#10003;</span> 5 repurposes / month</div>
      <div class="feat"><span class="chk y">&#10003;</span> 3 output formats</div>
      <div class="feat"><span class="chk y">&#10003;</span> Basic brand voice</div>
      <div class="feat"><span class="chk y">&#10003;</span> Community support</div>
      <div class="feat"><span class="chk n">&minus;</span> Visual asset generator</div>
      <div class="feat"><span class="chk n">&minus;</span> Team collaboration</div>
      <div class="feat"><span class="chk n">&minus;</span> API access</div>
    </div>
    ${currentPlan === 'starter' ? '<div class="btn btn-current">Current Plan</div>' : '<a href="/signup" class="btn btn-outline">Get Started Free</a>'}
  </div>
  <div class="card featured">
    <div class="badge">Most Popular</div>
    <p class="plan-name">Pro</p>
    <p class="price" data-monthly="$29" data-yearly="$23">$29 <span>/ month</span></p>
    <p class="price-desc">For creators who mean business</p>
    <div class="features">
      <div class="feat"><span class="chk y">&#10003;</span> Unlimited repurposes</div>
      <div class="feat"><span class="chk y">&#10003;</span> 50+ output formats</div>
      <div class="feat"><span class="chk y">&#10003;</span> Advanced brand voice AI</div>
      <div class="feat"><span class="chk y">&#10003;</span> Priority support</div>
      <div class="feat"><span class="chk y">&#10003;</span> Visual asset generator</div>
      <div class="feat"><span class="chk y">&#10003;</span> Smart scheduling</div>
      <div class="feat"><span class="chk n">&minus;</span> API access</div>
    </div>
    ${currentPlan === 'pro' ? '<div class="btn btn-current">Current Plan</div>' : `<button class="btn btn-primary" onclick="checkout('pro')">Start 14-Day Free Trial</button>`}
  </div>
  <div class="card">
    <p class="plan-name">Enterprise</p>
    <p class="price" data-monthly="$99" data-yearly="$79">$99 <span>/ month</span></p>
    <p class="price-desc">For teams and agencies</p>
    <div class="features">
      <div class="feat"><span class="chk y">&#10003;</span> Everything in Pro</div>
      <div class="feat"><span class="chk y">&#10003;</span> Unlimited team members</div>
      <div class="feat"><span class="chk y">&#10003;</span> Custom AI model training</div>
      <div class="feat"><span class="chk y">&#10003;</span> Dedicated account manager</div>
      <div class="feat"><span class="chk y">&#10003;</span> Full API access</div>
      <div class="feat"><span class="chk y">&#10003;</span> SSO & advanced security</div>
      <div class="feat"><span class="chk y">&#10003;</span> Custom integrations</div>
    </div>
    ${currentPlan === 'enterprise' ? '<div class="btn btn-current">Current Plan</div>' : `<button class="btn btn-outline" onclick="checkout('enterprise')">Contact Sales</button>`}
  </div>
</div></div>
<script>
let yearly=false;
function setMonthly(){yearly=false;document.getElementById('monthlyBtn').classList.add('active');document.getElementById('yearlyBtn').classList.remove('active');updatePrices()}
function setYearly(){yearly=true;document.getElementById('yearlyBtn').classList.add('active');document.getElementById('monthlyBtn').classList.remove('active');updatePrices()}
function updatePrices(){document.querySelectorAll('.price[data-monthly]').forEach(el=>{const p=yearly?el.dataset.yearly:el.dataset.monthly;el.innerHTML=p+' <span>/ month</span>'})}
async function checkout(plan){
  ${user ? '' : "window.location.href='/signup';return;"}
  try{
    const res=await fetch('/api/billing/create-checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan})});
    const data=await res.json();
    if(data.url) window.location.href=data.url;
    else if(data.demo) window.location.href='/billing/demo-success?plan='+plan;
  }catch(e){alert('Failed to start checkout')}
}
</script>
</body></html>`;
}

module.exports = router;
