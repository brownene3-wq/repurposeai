# Splicora — Complete Deployment Guide

## Step 1: Push to GitHub

First, create a GitHub repository and push your code:

```bash
cd repurposeai
git init
git add -A
git commit -m "Initial commit — Splicora full-stack SaaS"
```

Then go to https://github.com/new, create a new repository called `repurposeai`, and:

```bash
git remote add origin https://github.com/YOUR_USERNAME/repurposeai.git
git branch -M main
git push -u origin main
```

---

## Step 2: Deploy to Railway

1. Go to **https://railway.com** and sign in with GitHub
2. Click **"New Project"** → **"Deploy from GitHub Repo"**
3. Select your `repurposeai` repository
4. Railway will auto-detect Node.js and start deploying

### Add Environment Variables

In Railway dashboard → your project → **Variables** tab, add:

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | *(generate a random 64-char string — see below)* |
| `STRIPE_SECRET_KEY` | `sk_live_...` *(your Stripe secret key)* |
| `STRIPE_PUBLISHABLE_KEY` | `pk_live_...` *(your Stripe publishable key)* |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` *(from Stripe webhook setup — Step 3)* |
| `STRIPE_PRICE_PRO` | *(price ID from Stripe — Step 3)* |
| `STRIPE_PRICE_ENTERPRISE` | *(price ID from Stripe — Step 3)* |
| `FORMSPREE_ENDPOINT` | `https://formspree.io/f/YOUR_ID` |
| `APP_URL` | *(your Railway URL, e.g. https://repurposeai-production.up.railway.app)* |

**Generate a JWT secret** — run this in your terminal:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Railway will auto-redeploy when you add variables.

---

## Step 3: Set Up Stripe Products & Pricing

### 3a. Create Products in Stripe Dashboard

1. Go to https://dashboard.stripe.com/products
2. Click **"+ Add product"**

**Product 1 — Pro Plan:**
- Name: `Splicora Pro`
- Price: **$29.00 / month** (recurring)
- Click "Add product"
- Copy the **Price ID** (starts with `price_...`)
- Set this as `STRIPE_PRICE_PRO` in Railway

**Product 2 — Enterprise Plan:**
- Name: `Splicora Enterprise`
- Price: **$99.00 / month** (recurring)
- Click "Add product"
- Copy the **Price ID** (starts with `price_...`)
- Set this as `STRIPE_PRICE_ENTERPRISE` in Railway

### 3b. Set Up Stripe Webhook

1. Go to https://dashboard.stripe.com/webhooks
2. Click **"+ Add endpoint"**
3. Endpoint URL: `https://YOUR_RAILWAY_URL/api/billing/webhook`
4. Select events:
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `checkout.session.completed`
5. Click "Add endpoint"
6. Copy the **Signing secret** (starts with `whsec_...`)
7. Set this as `STRIPE_WEBHOOK_SECRET` in Railway

---

## Step 4: Set Up Formspree (Contact Form)

1. Go to https://formspree.io and create a free account
2. Click **"+ New Form"**
3. Name it "Splicora Contact"
4. Copy the form endpoint (looks like `https://formspree.io/f/xyzabc`)
5. Set this as `FORMSPREE_ENDPOINT` in Railway

---

## Step 5: Connect Your Custom Domain

### 5a. Buy a domain

Recommended registrars:
- **Namecheap** (https://namecheap.com) — cheapest .com domains
- **Cloudflare Registrar** (https://cloudflare.com) — at-cost pricing
- **GoDaddy** (https://godaddy.com) — largest selection

Suggested domain names to search for:
- `repurposeai.com`
- `repurpose.ai` (premium .ai domain)
- `getrepurpose.ai`
- `repurposecontent.ai`
- `contentrepurpose.com`
- `repurposeapp.com`
- `tryrepurpose.ai`
- `userepurpose.com`

### 5b. Connect domain to Railway

1. In Railway dashboard → your project → **Settings** → **Networking**
2. Click **"+ Custom Domain"**
3. Enter your domain (e.g. `repurposeai.com`)
4. Railway will give you a **CNAME record** to add
5. Go to your domain registrar's DNS settings
6. Add a **CNAME record**:
   - Host: `@` (or leave blank for root domain)
   - Value: the CNAME from Railway (e.g. `abc123.up.railway.app`)
7. Wait 5-30 minutes for DNS to propagate
8. Railway auto-provisions an SSL certificate

### 5c. Update APP_URL

Once your domain is connected, update the `APP_URL` environment variable in Railway:
```
APP_URL=https://repurposeai.com
```

---

## Step 6: Go Live Checklist

- [ ] Railway deployment is green (check Deployments tab)
- [ ] Can sign up and log in on the live URL
- [ ] Stripe checkout redirects correctly
- [ ] Stripe webhook is receiving events (check Stripe dashboard → Webhooks → Recent events)
- [ ] Contact form sends messages (check Formspree dashboard)
- [ ] Custom domain loads with HTTPS
- [ ] Update `APP_URL` to your final domain
- [ ] Switch Stripe from test mode to live mode when ready

---

## Ongoing: Monitoring & Updates

- **Railway logs**: Dashboard → your project → **Deployments** → click latest → view logs
- **Auto-deploy**: Every `git push` to `main` triggers a new deployment
- **Stripe test mode**: Use `sk_test_...` keys for testing, `sk_live_...` for real payments
- **Database**: SQLite data persists in the Railway volume. For production scale, consider upgrading to PostgreSQL (Railway offers managed Postgres)
