const express = require('express');
const router = express.Router();
const { userOps } = require('../db/database');
const { generateToken, redirectIfAuth } = require('../middleware/auth');

// GET /login
router.get('/login', redirectIfAuth, (req, res) => {
  res.send(renderAuthPage('login'));
});

// GET /signup
router.get('/signup', redirectIfAuth, (req, res) => {
  res.send(renderAuthPage('signup'));
});

// POST /api/auth/signup
router.post('/api/auth/signup', (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const existing = userOps.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const user = userOps.create(email, password, name);
    const token = generateToken(user);

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, plan: user.plan }, redirect: '/dashboard' });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// POST /api/auth/login
router.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = userOps.findByEmail(email);
    if (!user || !userOps.verifyPassword(user, password)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken(user);

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    const safeUser = userOps.findById(user.id);
    res.json({ success: true, user: safeUser, redirect: '/dashboard' });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// POST /api/auth/logout
router.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, redirect: '/' });
});

// GET /logout
router.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/');
});

function renderAuthPage(mode) {
  const isLogin = mode === 'login';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${isLogin ? 'Log In' : 'Sign Up'} — RepurposeAI</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --bg: #06060f; --bg-card: #11112a; --accent: #7c3aed; --accent2: #06b6d4;
  --text: #f0f0ff; --text2: #a0a0c0; --text3: #6a6a8e; --border: rgba(124,58,237,0.15);
  --gradient: linear-gradient(135deg, #7c3aed, #06b6d4);
}
body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.bg-orb { position: fixed; border-radius: 50%; filter: blur(120px); opacity: 0.3; pointer-events: none; animation: float 20s ease-in-out infinite; }
.bg-orb--1 { width: 500px; height: 500px; background: #7c3aed; top: -150px; right: -100px; }
.bg-orb--2 { width: 400px; height: 400px; background: #06b6d4; bottom: -100px; left: -100px; animation-delay: -7s; }
@keyframes float { 0%,100% { transform: translate(0,0); } 50% { transform: translate(20px,-20px); } }

.auth-container { position: relative; z-index: 1; width: 100%; max-width: 440px; padding: 20px; }
.auth-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 20px; padding: 48px 40px; }
.logo { font-size: 1.6rem; font-weight: 800; text-align: center; margin-bottom: 8px; background: var(--gradient); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.logo span { font-weight: 400; -webkit-text-fill-color: var(--text2); }
.auth-title { text-align: center; font-size: 1.5rem; font-weight: 700; margin: 20px 0 8px; }
.auth-subtitle { text-align: center; color: var(--text2); font-size: 0.9rem; margin-bottom: 32px; }

.form-group { margin-bottom: 20px; }
.form-label { display: block; font-size: 0.85rem; font-weight: 600; color: var(--text2); margin-bottom: 8px; }
.form-input {
  width: 100%; padding: 14px 16px; background: rgba(255,255,255,0.04);
  border: 1px solid var(--border); border-radius: 12px; color: var(--text);
  font-size: 0.95rem; font-family: inherit; transition: all 0.3s; outline: none;
}
.form-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(124,58,237,0.15); }
.form-input::placeholder { color: var(--text3); }

.btn-submit {
  width: 100%; padding: 15px; border: none; border-radius: 9999px;
  background: var(--gradient); color: #fff; font-size: 1rem; font-weight: 700;
  cursor: pointer; transition: all 0.3s; font-family: inherit;
  box-shadow: 0 4px 20px rgba(124,58,237,0.4); margin-top: 8px;
}
.btn-submit:hover { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(124,58,237,0.5); }
.btn-submit:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

.auth-footer { text-align: center; margin-top: 24px; font-size: 0.9rem; color: var(--text2); }
.auth-footer a { color: var(--accent2); font-weight: 600; text-decoration: none; }
.auth-footer a:hover { text-decoration: underline; }

.error-msg { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #f87171; padding: 12px 16px; border-radius: 10px; font-size: 0.85rem; margin-bottom: 16px; display: none; }
.error-msg.visible { display: block; }

.divider { display: flex; align-items: center; gap: 16px; margin: 24px 0; color: var(--text3); font-size: 0.8rem; }
.divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--border); }

.social-btns { display: flex; gap: 12px; margin-bottom: 24px; }
.social-btn {
  flex: 1; padding: 12px; border: 1px solid var(--border); border-radius: 12px;
  background: rgba(255,255,255,0.03); color: var(--text); font-size: 0.85rem;
  font-weight: 500; cursor: pointer; font-family: inherit; transition: all 0.3s;
  display: flex; align-items: center; justify-content: center; gap: 8px;
}
.social-btn:hover { border-color: rgba(124,58,237,0.4); background: rgba(124,58,237,0.05); }

.back-link { display: block; text-align: center; margin-top: 20px; color: var(--text3); font-size: 0.85rem; text-decoration: none; }
.back-link:hover { color: var(--text2); }

.password-strength { height: 3px; border-radius: 2px; margin-top: 8px; transition: all 0.3s; }
</style>
</head>
<body>
<div class="bg-orb bg-orb--1"></div>
<div class="bg-orb bg-orb--2"></div>
<div class="auth-container">
  <div class="auth-card">
    <div class="logo">Repurpose<span>AI</span></div>
    <h1 class="auth-title">${isLogin ? 'Welcome back' : 'Create your account'}</h1>
    <p class="auth-subtitle">${isLogin ? 'Log in to your account to continue' : 'Start repurposing content in seconds'}</p>

    <div id="errorMsg" class="error-msg"></div>

    <div class="social-btns">
      <button class="social-btn" onclick="alert('Google OAuth — connect your Google Cloud credentials in .env')">G &nbsp;Google</button>
      <button class="social-btn" onclick="alert('GitHub OAuth — connect your GitHub OAuth credentials in .env')">&#9679; GitHub</button>
    </div>
    <div class="divider">or continue with email</div>

    <form id="authForm" onsubmit="handleSubmit(event)">
      ${!isLogin ? `
      <div class="form-group">
        <label class="form-label">Full Name</label>
        <input type="text" name="name" class="form-input" placeholder="John Doe" required autocomplete="name">
      </div>` : ''}
      <div class="form-group">
        <label class="form-label">Email Address</label>
        <input type="email" name="email" class="form-input" placeholder="you@example.com" required autocomplete="email">
      </div>
      <div class="form-group">
        <label class="form-label">Password</label>
        <input type="password" name="password" class="form-input" placeholder="${isLogin ? 'Enter your password' : 'Min. 8 characters'}" required autocomplete="${isLogin ? 'current-password' : 'new-password'}" minlength="8">
        ${!isLogin ? '<div id="pwStrength" class="password-strength"></div>' : ''}
      </div>
      <button type="submit" class="btn-submit" id="submitBtn">${isLogin ? 'Log In' : 'Create Account'}</button>
    </form>

    <p class="auth-footer">
      ${isLogin
        ? 'Don\'t have an account? <a href="/signup">Sign up free</a>'
        : 'Already have an account? <a href="/login">Log in</a>'}
    </p>
  </div>
  <a href="/" class="back-link">&larr; Back to home</a>
</div>

<script>
const form = document.getElementById('authForm');
const errorMsg = document.getElementById('errorMsg');
const submitBtn = document.getElementById('submitBtn');
const isLogin = ${isLogin};

${!isLogin ? `
const pwInput = document.querySelector('input[name="password"]');
const pwStrength = document.getElementById('pwStrength');
pwInput.addEventListener('input', () => {
  const val = pwInput.value;
  let strength = 0;
  if (val.length >= 8) strength++;
  if (/[A-Z]/.test(val)) strength++;
  if (/[0-9]/.test(val)) strength++;
  if (/[^A-Za-z0-9]/.test(val)) strength++;
  const colors = ['#ef4444','#f59e0b','#f59e0b','#34d399','#34d399'];
  const widths = ['0%','25%','50%','75%','100%'];
  pwStrength.style.background = colors[strength];
  pwStrength.style.width = widths[strength];
});` : ''}

async function handleSubmit(e) {
  e.preventDefault();
  errorMsg.classList.remove('visible');
  submitBtn.disabled = true;
  submitBtn.textContent = isLogin ? 'Logging in...' : 'Creating account...';

  const formData = new FormData(form);
  const data = Object.fromEntries(formData);

  try {
    const res = await fetch('/api/auth/' + (isLogin ? 'login' : 'signup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();

    if (!res.ok) {
      throw new Error(result.error || 'Something went wrong');
    }

    window.location.href = result.redirect || '/dashboard';
  } catch (err) {
    errorMsg.textContent = err.message;
    errorMsg.classList.add('visible');
    submitBtn.disabled = false;
    submitBtn.textContent = isLogin ? 'Log In' : 'Create Account';
  }
}
</script>
</body>
</html>`;
}

module.exports = router;
