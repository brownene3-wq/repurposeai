const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

const STRIPE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';

router.get('/', requireAuth, (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Billing - RepurposeAI</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#x26A1;</text></svg>">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Playfair+Display:wght@700;800&display=swap');
    :root{--primary:#6C3AED;--primary-light:#8B5CF6;--dark:#0F0F1A;--dark-2:#1A1A2E;--surface:#1E1E32;--text:#FFF;--text-muted:#A0AEC0;--text-dim:#718096;--gradient-1:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);--border-subtle:1px solid rgba(255,255,255,0.06);--success:#10B981}
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',sans-serif;background:var(--dark);color:var(--text);min-height:100vh}
    .billing-page{max-width:900px;margin:0 auto;padding:3rem 2rem}
    .back-link{color:var(--primary-light);text-decoration:none;font-size:.9rem;font-weight:500;display:inline-flex;align-items:center;gap:.5rem;margin-bottom:2rem}
    .back-link:hover{text-decoration:underline}
    .page-header{margin-bottom:3rem}
    .page-header h1{font-family:'Playfair Display',serif;font-size:2.2rem;font-weight:800;margin-bottom:.5rem}
    .page-header p{color:var(--text-muted);font-size:1rem}
    .current-plan{background:var(--surface);border-radius:16px;padding:2rem;border:var(--border-subtle);margin-bottom:2rem;display:flex;justify-content:space-between;align-items:center}
    .plan-info h3{font-size:1.1rem;font-weight:700;margin-bottom:.3rem}
    .plan-info p{color:var(--text-muted);font-size:.9rem}
    .plan-badge{padding:.4rem 1rem;border-radius:50px;font-size:.8rem;font-weight:600;background:rgba(16,185,129,0.15);color:var(--success);border:1px solid rgba(16,185,129,0.3)}
    .pricing-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1.5rem;margin-bottom:3rem}
    .price-card{background:var(--surface);border-radius:16px;padding:2rem;border:var(--border-subtle);transition:all .3s;position:relative}
    .price-card.featured{border-color:var(--primary);box-shadow:0 0 40px rgba(108,58,237,0.2);transform:scale(1.02)}
    .price-card.featured::before{content:'RECOMMENDED';position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:var(--gradient-1);padding:.25rem 1rem;border-radius:50px;font-size:.7rem;font-weight:700;letter-spacing:.08em}
    .price-card h3{font-size:1.1rem;font-weight:700;margin-bottom:.5rem}
    .price-card .price{font-size:2.5rem;font-weight:800;margin:.8rem 0}
    .price-card .price span{font-size:.9rem;font-weight:400;color:var(--text-muted)}
    .price-card .desc{color:var(--text-muted);font-size:.85rem;margin-bottom:1.2rem}
    .features-list{list-style:none;margin-bottom:1.5rem}
    .features-list li{padding:.4rem 0;color:var(--text-muted);font-size:.85rem;display:flex;align-items:center;gap:.5rem}
    .features-list li::before{content:'✓';color:var(--primary-light);font-weight:700;font-size:.9rem}
    .btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;width:100%;padding:.8rem;border-radius:50px;font-weight:600;font-size:.9rem;cursor:pointer;border:none;transition:all .3s;font-family:'Inter',sans-serif;text-decoration:none}
    .btn-primary{background:var(--gradient-1);color:#fff;box-shadow:0 4px 15px rgba(108,58,237,0.3)}
    .btn-primary:hover{transform:translateY(-1px)}
    .btn-outline{background:transparent;color:var(--text);border:1px solid rgba(255,255,255,0.15)}
    .btn-outline:hover{border-color:var(--primary-light);color:var(--primary-light)}
    .btn-current{background:rgba(16,185,129,0.15);color:var(--success);border:1px solid rgba(16,185,129,0.3);cursor:default}
    @media(max-width:768px){.pricing-grid{grid-template-columns:1fr}.price-card.featured{transform:none}.current-plan{flex-direction:column;gap:1rem;text-align:center}}
  </style>
</head>
<body>
  <div class="billing-page">
    <a href="/dashboard" class="back-link">&#x2190; Back to Dashboard</a>
    <div class="page-header">
      <h1>&#x1F4B3; Billing & Plans</h1>
      <p>Choose the plan that fits your content needs.</p>
    </div>

    <div class="current-plan">
      <div class="plan-info">
        <h3>Current Plan: Free Starter</h3>
        <p>3 videos per month, 3 platforms</p>
      </div>
      <span class="plan-badge">Active</span>
    </div>

    <div class="pricing-grid">
      <div class="price-card">
        <h3>Starter</h3>
        <div class="price">Free</div>
        <p class="desc">Perfect for getting started</p>
        <ul class="features-list">
          <li>3 videos per month</li>
          <li>3 platforms</li>
          <li>Basic AI captions</li>
          <li>Download content</li>
          <li>Email support</li>
        </ul>
        <button class="btn btn-current">&#x2713; Current Plan</button>
      </div>
      <div class="price-card featured">
        <h3>Pro</h3>
        <div class="price">$29<span>/month</span></div>
        <p class="desc">For creators serious about growth</p>
        <ul class="features-list">
          <li>Unlimited videos</li>
          <li>All 5 platforms</li>
          <li>Advanced AI + tone control</li>
          <li>Smart scheduling</li>
          <li>Hashtag optimization</li>
          <li>Analytics dashboard</li>
          <li>Priority support</li>
        </ul>
        <button class="btn btn-primary" onclick="upgradePlan('pro')">Upgrade to Pro &#x2192;</button>
      </div>
      <div class="price-card">
        <h3>Enterprise</h3>
        <div class="price">$99<span>/month</span></div>
        <p class="desc">For agencies and teams</p>
        <ul class="features-list">
          <li>Everything in Pro</li>
          <li>Batch processing (50+)</li>
          <li>Team collaboration</li>
          <li>White-label exports</li>
          <li>API access</li>
          <li>Custom AI training</li>
          <li>Dedicated manager</li>
        </ul>
        <button class="btn btn-outline" onclick="upgradePlan('enterprise')">Contact Sales &#x2192;</button>
      </div>
    </div>
  </div>

  <script>
    async function upgradePlan(plan) {
      try {
        const res = await fetch('/billing/create-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan })
        });
        const data = await res.json();
        if (data.url) {
          window.location.href = data.url;
        } else if (data.message) {
          alert(data.message);
        } else {
          alert('Could not start checkout. Please try again.');
        }
      } catch (err) {
        alert('Error connecting to payment system. Please try again.');
      }
    }
  </script>
</body>
</html>`;
  res.send(html);
});

// Create Stripe Checkout Session
router.post('/create-checkout', requireAuth, async (req, res) => {
  try {
    const { plan } = req.body;
    
    if (!STRIPE_SECRET) {
      return res.json({ message: 'Payment system is being configured. Please check back soon!' });
    }
    
    const stripe = require('stripe')(STRIPE_SECRET);
    const priceId = plan === 'pro' ? process.env.STRIPE_PRICE_PRO : process.env.STRIPE_PRICE_ENTERPRISE;
    
    if (!priceId) {
      return res.json({ message: 'This plan is being set up. Please contact support.' });
    }
    
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: (process.env.APP_URL || 'https://repurposeai.ai') + '/billing?success=true',
      cancel_url: (process.env.APP_URL || 'https://repurposeai.ai') + '/billing?canceled=true',
      customer_email: req.user.email
    });
    
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Stripe webhook
router.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  // Handle Stripe webhooks for subscription updates
  res.json({ received: true });
});

module.exports = router;
