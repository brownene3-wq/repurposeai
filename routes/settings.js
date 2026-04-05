const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');
const { getDb } = require('../db/database');

// Helper to get or create user settings
async function getUserSettings(userId) {
  const db = getDb();
  let result = await db.query('SELECT * FROM user_settings WHERE user_id = $1', [userId]);
  if (result.rows.length === 0) {
    await db.query('INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
    result = await db.query('SELECT * FROM user_settings WHERE user_id = $1', [userId]);
  }
  return result.rows[0] || {};
}

router.get('/', requireAuth, async (req, res) => {
  const user = req.user;
  const hasGoogle = !!user.google_id;
  let settings = {};
  try { settings = await getUserSettings(user.id); } catch (e) { console.error('Settings load error:', e); }

  // Load ElevenLabs API key
  let elevenLabsKey = '';
  try {
    const bkResult = await getDb().query('SELECT elevenlabs_api_key FROM brand_kits WHERE user_id = $1', [user.id]);
    if (bkResult.rows.length > 0 && bkResult.rows[0].elevenlabs_api_key) {
      elevenLabsKey = bkResult.rows[0].elevenlabs_api_key;
    }
  } catch (e) { console.error('ElevenLabs key load error:', e); }

  const css = getBaseCSS();

  res.send(`
    ${getHeadHTML('Settings - RepurposeAI')}
    <style>${css}
      .settings-nav{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:2rem;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:1rem}
      body.light .settings-nav,html.light .settings-nav{border-bottom-color:rgba(0,0,0,0.08)}
      .settings-nav-btn{padding:.55rem 1.2rem;border-radius:50px;font-weight:600;font-size:.8rem;cursor:pointer;border:none;background:var(--dark-2);color:var(--text-muted);transition:all .25s}
      .settings-nav-btn:hover{background:var(--surface);color:var(--text)}
      .settings-nav-btn.active{background:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);color:#fff}
      body.light .settings-nav-btn,html.light .settings-nav-btn{background:#e8e8ef}
      body.light .settings-nav-btn.active,html.light .settings-nav-btn.active{background:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);color:#fff}
      .settings-section{display:none}
      .settings-section.active{display:block}
      .settings-card{background:var(--surface);border-radius:16px;padding:2rem;border:var(--border-subtle);margin-bottom:1.5rem}
      .settings-card h2{font-size:1.15rem;font-weight:700;margin-bottom:.3rem;display:flex;align-items:center;gap:.5rem}
      .settings-card h2 .icon{font-size:1.1rem}
      .settings-card p.desc{color:var(--text-muted);font-size:.83rem;margin-bottom:1.5rem}
      .form-group{margin-bottom:1.2rem}
      .form-group label{display:block;font-size:.83rem;font-weight:600;margin-bottom:.4rem;color:var(--text-muted)}
      .form-group input[type="text"],.form-group input[type="password"],.form-group input[type="email"],.form-group select{width:100%;max-width:400px;padding:.65rem 1rem;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:var(--dark-2);color:var(--text);font-size:.88rem;outline:none;transition:border .2s}
      .form-group input:focus,.form-group select:focus{border-color:#6C3AED}
      body.light .form-group input,html.light .form-group input,body.light .form-group select,html.light .form-group select{border-color:rgba(0,0,0,0.12);background:#f8f9fc}
      .btn-save{padding:.6rem 1.6rem;border-radius:50px;font-weight:600;font-size:.83rem;cursor:pointer;border:none;background:linear-gradient(135deg,#6C3AED 0%,#EC4899 100%);color:#fff;transition:all .3s;box-shadow:0 4px 15px rgba(108,58,237,0.3)}
      .btn-save:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(108,58,237,0.4)}
      .btn-save:disabled{opacity:.5;cursor:not-allowed;transform:none}
      .btn-outline{padding:.6rem 1.6rem;border-radius:50px;font-weight:600;font-size:.83rem;cursor:pointer;border:1px solid rgba(255,255,255,0.15);background:transparent;color:var(--text);transition:all .3s}
      .btn-outline:hover{border-color:#6C3AED;color:#6C3AED}
      .btn-danger{padding:.6rem 1.6rem;border-radius:50px;font-weight:600;font-size:.83rem;cursor:pointer;border:1px solid rgba(239,68,68,0.3);background:transparent;color:#ef4444;transition:all .3s}
      .btn-danger:hover{background:rgba(239,68,68,0.1);border-color:#ef4444}
      .badge-google{display:inline-flex;align-items:center;gap:.4rem;background:rgba(66,133,244,0.12);color:#4285F4;font-size:.72rem;font-weight:600;padding:3px 10px;border-radius:20px}
      .badge-email{display:inline-flex;align-items:center;gap:.4rem;background:rgba(16,185,129,0.12);color:#10B981;font-size:.72rem;font-weight:600;padding:3px 10px;border-radius:20px}
      .toast{display:none;position:fixed;bottom:2rem;right:2rem;padding:1rem 1.5rem;border-radius:12px;font-size:.88rem;font-weight:500;z-index:9999;box-shadow:0 8px 30px rgba(0,0,0,0.3)}
      .toast.success{background:#10B981;color:#fff}
      .toast.error{background:#EF4444;color:#fff}
      .divider{height:1px;background:rgba(255,255,255,0.06);margin:1.5rem 0}
      body.light .divider,html.light .divider{background:rgba(0,0,0,0.08)}
      .info-row{display:flex;align-items:center;gap:.8rem;margin-bottom:.8rem}
      .info-row .label{font-size:.83rem;color:var(--text-muted);min-width:100px}
      .info-row .value{font-size:.88rem;color:var(--text);font-weight:500}
      .toggle-row{display:flex;align-items:center;justify-content:space-between;padding:.85rem 0;border-bottom:1px solid rgba(255,255,255,0.04)}
      .toggle-row:last-child{border-bottom:none}
      body.light .toggle-row,html.light .toggle-row{border-bottom-color:rgba(0,0,0,0.04)}
      .toggle-row .toggle-info{flex:1}
      .toggle-row .toggle-label{font-size:.88rem;font-weight:600;color:var(--text);margin-bottom:.15rem}
      .toggle-row .toggle-desc{font-size:.78rem;color:var(--text-muted)}
      .toggle-switch{position:relative;width:44px;height:24px;flex-shrink:0}
      .toggle-switch input{opacity:0;width:0;height:0}
      .toggle-slider{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:rgba(255,255,255,0.12);border-radius:24px;transition:.3s}
      body.light .toggle-slider,html.light .toggle-slider{background:rgba(0,0,0,0.12)}
      .toggle-slider:before{content:'';position:absolute;height:18px;width:18px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:.3s}
      .toggle-switch input:checked+.toggle-slider{background:#6C3AED}
      .toggle-switch input:checked+.toggle-slider:before{transform:translateX(20px)}
      .select-group{display:grid;grid-template-columns:1fr 1fr;gap:1rem;max-width:500px}
      @media(max-width:600px){.select-group{grid-template-columns:1fr}.settings-nav{gap:.3rem}}
      .danger-zone{border-color:rgba(239,68,68,0.2)}
      .danger-zone h2{color:#ef4444}
      .account-meta{display:flex;gap:2rem;flex-wrap:wrap;margin-top:.5rem}
      .account-meta-item{font-size:.78rem;color:var(--text-muted)}
      .account-meta-item strong{color:var(--text);font-weight:600}
    </style>
    </head><body>
    <div class="dashboard">
      ${getSidebar('settings', user, req.teamPermissions)}
      ${getThemeToggle()}
      <div class="main-content">
        <div class="page-header">
          <h1>Settings</h1>
          <p>Manage your account, preferences, and notifications</p>
        </div>

        <!-- Settings Navigation -->
        <div class="settings-nav">
          <button class="settings-nav-btn active" data-section="profile" onclick="switchSection('profile',this)">Profile</button>
          <button class="settings-nav-btn" data-section="notifications" onclick="switchSection('notifications',this)">Notifications</button>
          <button class="settings-nav-btn" data-section="export" onclick="switchSection('export',this)">Export Defaults</button>
          <button class="settings-nav-btn" data-section="captions" onclick="switchSection('captions',this)">Captions</button>
          <button class="settings-nav-btn" data-section="appearance" onclick="switchSection('appearance',this)">Appearance</button>
          <button class="settings-nav-btn" data-section="privacy" onclick="switchSection('privacy',this)">Data & Privacy</button>
          <button class="settings-nav-btn" data-section="apikeys" onclick="switchSection('apikeys',this)">API Keys</button>
        </div>

        <!-- ===== PROFILE SECTION ===== -->
        <div class="settings-section active" id="section-profile">
          <div class="settings-card">
            <h2><span class="icon">&#x1F464;</span> Profile Information</h2>
            <p class="desc">Your account details and login method</p>
            <div class="info-row">
              <span class="label">Email</span>
              <span class="value">${user.email}</span>
              ${hasGoogle ? '<span class="badge-google">&#x1F310; Google</span>' : '<span class="badge-email">&#x2709; Email</span>'}
            </div>
            <div class="info-row">
              <span class="label">Member since</span>
              <span class="value">${user.created_at ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'N/A'}</span>
            </div>
            <div class="divider"></div>
            <div class="form-group">
              <label>Display Name</label>
              <input type="text" id="nameInput" value="${(user.name || '').replace(/"/g, '&quot;')}" placeholder="Your name">
            </div>
            <button class="btn-save" onclick="saveName()">Save Name</button>
          </div>

          <div class="settings-card">
            ${hasGoogle ? `
              <h2><span class="icon">&#x1F512;</span> Create Password</h2>
              <p class="desc">You signed up with Google. Add a password so you can also log in via email.</p>
              <div class="form-group">
                <label>New Password</label>
                <input type="password" id="newPassword" placeholder="Min 6 characters" minlength="6">
              </div>
              <div class="form-group">
                <label>Confirm Password</label>
                <input type="password" id="confirmPassword" placeholder="Confirm your password">
              </div>
              <button class="btn-save" onclick="setPassword()">Create Password</button>
            ` : `
              <h2><span class="icon">&#x1F512;</span> Change Password</h2>
              <p class="desc">Update your login password</p>
              <div class="form-group">
                <label>Current Password</label>
                <input type="password" id="currentPassword" placeholder="Enter current password">
              </div>
              <div class="form-group">
                <label>New Password</label>
                <input type="password" id="newPassword" placeholder="Min 6 characters" minlength="6">
              </div>
              <div class="form-group">
                <label>Confirm New Password</label>
                <input type="password" id="confirmPassword" placeholder="Confirm new password">
              </div>
              <button class="btn-save" onclick="changePassword()">Change Password</button>
            `}
          </div>

          <div class="settings-card">
            <h2><span class="icon">&#x1F4B3;</span> Subscription</h2>
            <p class="desc">Your current plan and billing</p>
            <div class="info-row">
              <span class="label">Plan</span>
              <span class="value" style="text-transform:capitalize">${user.plan || 'Free'}</span>
            </div>
            <a href="/billing" style="color:#6C3AED;font-size:.85rem;font-weight:600;text-decoration:none">Manage Billing &rarr;</a>
          </div>
        </div>

        <!-- ===== NOTIFICATIONS SECTION ===== -->
        <div class="settings-section" id="section-notifications">
          <div class="settings-card">
            <h2><span class="icon">&#x1F514;</span> Email Notifications</h2>
            <p class="desc">Choose which emails you'd like to receive</p>

            <div class="toggle-row">
              <div class="toggle-info">
                <div class="toggle-label">Processing Complete</div>
                <div class="toggle-desc">Get notified when your video is done processing</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" data-setting="email_processing_complete" ${settings.email_processing_complete !== false ? 'checked' : ''} onchange="saveSetting(this)">
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div class="toggle-row">
              <div class="toggle-info">
                <div class="toggle-label">Weekly Summary</div>
                <div class="toggle-desc">Receive a weekly report of your content performance</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" data-setting="email_weekly_summary" ${settings.email_weekly_summary ? 'checked' : ''} onchange="saveSetting(this)">
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div class="toggle-row">
              <div class="toggle-info">
                <div class="toggle-label">Product Updates</div>
                <div class="toggle-desc">Stay informed about new features and improvements</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" data-setting="email_product_updates" ${settings.email_product_updates !== false ? 'checked' : ''} onchange="saveSetting(this)">
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div class="toggle-row">
              <div class="toggle-info">
                <div class="toggle-label">Tips & Tutorials</div>
                <div class="toggle-desc">Helpful guides on getting the most out of RepurposeAI</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" data-setting="email_tips_tutorials" ${settings.email_tips_tutorials ? 'checked' : ''} onchange="saveSetting(this)">
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>

        <!-- ===== EXPORT DEFAULTS SECTION ===== -->
        <div class="settings-section" id="section-export">
          <div class="settings-card">
            <h2><span class="icon">&#x1F4E4;</span> Default Export Settings</h2>
            <p class="desc">Set default preferences for exporting videos</p>

            <div class="select-group">
              <div class="form-group">
                <label>Video Quality</label>
                <select data-setting="default_video_quality" onchange="saveSetting(this)">
                  <option value="720p" ${settings.default_video_quality === '720p' ? 'selected' : ''}>720p (HD)</option>
                  <option value="1080p" ${(settings.default_video_quality || '1080p') === '1080p' ? 'selected' : ''}>1080p (Full HD)</option>
                  <option value="1440p" ${settings.default_video_quality === '1440p' ? 'selected' : ''}>1440p (2K)</option>
                  <option value="2160p" ${settings.default_video_quality === '2160p' ? 'selected' : ''}>2160p (4K)</option>
                </select>
              </div>
              <div class="form-group">
                <label>Video Format</label>
                <select data-setting="default_video_format" onchange="saveSetting(this)">
                  <option value="mp4" ${(settings.default_video_format || 'mp4') === 'mp4' ? 'selected' : ''}>MP4</option>
                  <option value="mov" ${settings.default_video_format === 'mov' ? 'selected' : ''}>MOV</option>
                  <option value="webm" ${settings.default_video_format === 'webm' ? 'selected' : ''}>WebM</option>
                </select>
              </div>
            </div>

            <div class="form-group" style="margin-top:.5rem">
              <label>Default Aspect Ratio</label>
              <select data-setting="default_aspect_ratio" onchange="saveSetting(this)" style="max-width:200px">
                <option value="16:9" ${(settings.default_aspect_ratio || '16:9') === '16:9' ? 'selected' : ''}>16:9 (Landscape)</option>
                <option value="9:16" ${settings.default_aspect_ratio === '9:16' ? 'selected' : ''}>9:16 (Vertical)</option>
                <option value="1:1" ${settings.default_aspect_ratio === '1:1' ? 'selected' : ''}>1:1 (Square)</option>
                <option value="4:5" ${settings.default_aspect_ratio === '4:5' ? 'selected' : ''}>4:5 (Portrait)</option>
              </select>
            </div>
          </div>
        </div>

        <!-- ===== CAPTIONS SECTION ===== -->
        <div class="settings-section" id="section-captions">
          <div class="settings-card">
            <h2><span class="icon">&#x1F4DD;</span> Caption Preferences</h2>
            <p class="desc">Default settings for auto-generated captions</p>

            <div class="toggle-row">
              <div class="toggle-info">
                <div class="toggle-label">Auto-Generate Captions</div>
                <div class="toggle-desc">Automatically add captions when processing videos</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" data-setting="auto_generate_captions" ${settings.auto_generate_captions !== false ? 'checked' : ''} onchange="saveSetting(this)">
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div class="divider"></div>

            <div class="select-group">
              <div class="form-group">
                <label>Default Caption Style</label>
                <select data-setting="default_caption_style" onchange="saveSetting(this)">
                  <option value="bold-pop" ${(settings.default_caption_style || 'bold-pop') === 'bold-pop' ? 'selected' : ''}>Bold Pop</option>
                  <option value="karaoke" ${settings.default_caption_style === 'karaoke' ? 'selected' : ''}>Karaoke</option>
                  <option value="minimal" ${settings.default_caption_style === 'minimal' ? 'selected' : ''}>Minimal</option>
                  <option value="neon-glow" ${settings.default_caption_style === 'neon-glow' ? 'selected' : ''}>Neon Glow</option>
                  <option value="cinematic" ${settings.default_caption_style === 'cinematic' ? 'selected' : ''}>Cinematic</option>
                  <option value="hormozi" ${settings.default_caption_style === 'hormozi' ? 'selected' : ''}>Hormozi</option>
                  <option value="mrbeast" ${settings.default_caption_style === 'mrbeast' ? 'selected' : ''}>MrBeast</option>
                  <option value="clean-modern" ${settings.default_caption_style === 'clean-modern' ? 'selected' : ''}>Clean Modern</option>
                  <option value="classic-subtitle" ${settings.default_caption_style === 'classic-subtitle' ? 'selected' : ''}>Classic Subtitle</option>
                </select>
              </div>
              <div class="form-group">
                <label>Caption Language</label>
                <select data-setting="default_caption_language" onchange="saveSetting(this)">
                  <option value="en" ${(settings.default_caption_language || 'en') === 'en' ? 'selected' : ''}>English</option>
                  <option value="es" ${settings.default_caption_language === 'es' ? 'selected' : ''}>Spanish</option>
                  <option value="fr" ${settings.default_caption_language === 'fr' ? 'selected' : ''}>French</option>
                  <option value="de" ${settings.default_caption_language === 'de' ? 'selected' : ''}>German</option>
                  <option value="pt" ${settings.default_caption_language === 'pt' ? 'selected' : ''}>Portuguese</option>
                  <option value="it" ${settings.default_caption_language === 'it' ? 'selected' : ''}>Italian</option>
                  <option value="ja" ${settings.default_caption_language === 'ja' ? 'selected' : ''}>Japanese</option>
                  <option value="ko" ${settings.default_caption_language === 'ko' ? 'selected' : ''}>Korean</option>
                  <option value="zh" ${settings.default_caption_language === 'zh' ? 'selected' : ''}>Chinese</option>
                  <option value="ar" ${settings.default_caption_language === 'ar' ? 'selected' : ''}>Arabic</option>
                  <option value="hi" ${settings.default_caption_language === 'hi' ? 'selected' : ''}>Hindi</option>
                </select>
              </div>
            </div>
            <p style="font-size:.78rem;color:var(--text-muted);margin-top:.5rem">You can also set a default style from the <a href="/caption-presets" style="color:#6C3AED;text-decoration:none;font-weight:600">Caption Styles</a> page.</p>
          </div>
        </div>

        <!-- ===== APPEARANCE SECTION ===== -->
        <div class="settings-section" id="section-appearance">
          <div class="settings-card">
            <h2><span class="icon">&#x1F3A8;</span> Appearance</h2>
            <p class="desc">Customize how RepurposeAI looks for you</p>

            <div class="form-group">
              <label>Theme</label>
              <select data-setting="theme" onchange="saveSetting(this);applyTheme(this.value)" style="max-width:200px">
                <option value="dark" ${(settings.theme || 'dark') === 'dark' ? 'selected' : ''}>Dark Mode</option>
                <option value="light" ${settings.theme === 'light' ? 'selected' : ''}>Light Mode</option>
              </select>
            </div>

            <div class="toggle-row" style="margin-top:.5rem">
              <div class="toggle-info">
                <div class="toggle-label">Compact Sidebar</div>
                <div class="toggle-desc">Use a narrower sidebar with icon-only navigation</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" data-setting="compact_sidebar" ${settings.compact_sidebar ? 'checked' : ''} onchange="saveSetting(this)">
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="settings-card">
            <h2><span class="icon">&#x1F310;</span> Language & Region</h2>
            <p class="desc">Set your preferred language and timezone</p>

            <div class="select-group">
              <div class="form-group">
                <label>Language</label>
                <select data-setting="language" onchange="saveSetting(this)">
                  <option value="en" ${(settings.language || 'en') === 'en' ? 'selected' : ''}>English</option>
                  <option value="es" ${settings.language === 'es' ? 'selected' : ''}>Spanish</option>
                  <option value="fr" ${settings.language === 'fr' ? 'selected' : ''}>French</option>
                  <option value="de" ${settings.language === 'de' ? 'selected' : ''}>German</option>
                  <option value="pt" ${settings.language === 'pt' ? 'selected' : ''}>Portuguese</option>
                </select>
              </div>
              <div class="form-group">
                <label>Timezone</label>
                <select data-setting="timezone" onchange="saveSetting(this)">
                  <option value="UTC" ${(settings.timezone || 'UTC') === 'UTC' ? 'selected' : ''}>UTC</option>
                  <option value="America/New_York" ${settings.timezone === 'America/New_York' ? 'selected' : ''}>Eastern (ET)</option>
                  <option value="America/Chicago" ${settings.timezone === 'America/Chicago' ? 'selected' : ''}>Central (CT)</option>
                  <option value="America/Denver" ${settings.timezone === 'America/Denver' ? 'selected' : ''}>Mountain (MT)</option>
                  <option value="America/Los_Angeles" ${settings.timezone === 'America/Los_Angeles' ? 'selected' : ''}>Pacific (PT)</option>
                  <option value="Europe/London" ${settings.timezone === 'Europe/London' ? 'selected' : ''}>London (GMT)</option>
                  <option value="Europe/Paris" ${settings.timezone === 'Europe/Paris' ? 'selected' : ''}>Paris (CET)</option>
                  <option value="Europe/Berlin" ${settings.timezone === 'Europe/Berlin' ? 'selected' : ''}>Berlin (CET)</option>
                  <option value="Asia/Tokyo" ${settings.timezone === 'Asia/Tokyo' ? 'selected' : ''}>Tokyo (JST)</option>
                  <option value="Asia/Shanghai" ${settings.timezone === 'Asia/Shanghai' ? 'selected' : ''}>Shanghai (CST)</option>
                  <option value="Asia/Kolkata" ${settings.timezone === 'Asia/Kolkata' ? 'selected' : ''}>India (IST)</option>
                  <option value="Australia/Sydney" ${settings.timezone === 'Australia/Sydney' ? 'selected' : ''}>Sydney (AEST)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <!-- ===== DATA & PRIVACY SECTION ===== -->
        <div class="settings-section" id="section-privacy">
          <div class="settings-card">
            <h2><span class="icon">&#x1F6E1;</span> Privacy</h2>
            <p class="desc">Control how your data is used</p>

            <div class="toggle-row">
              <div class="toggle-info">
                <div class="toggle-label">Usage Analytics</div>
                <div class="toggle-desc">Help us improve RepurposeAI by sharing anonymous usage data</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" data-setting="share_usage_analytics" ${settings.share_usage_analytics !== false ? 'checked' : ''} onchange="saveSetting(this)">
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="settings-card">
            <h2><span class="icon">&#x1F4E6;</span> Your Data</h2>
            <p class="desc">Export or manage your account data</p>
            <div style="display:flex;gap:1rem;flex-wrap:wrap">
              <button class="btn-outline" onclick="exportData()">Export My Data</button>
            </div>
          </div>

          <div class="settings-card danger-zone">
            <h2><span class="icon">&#x26A0;</span> Danger Zone</h2>
            <p class="desc">Irreversible actions — proceed with caution</p>
            <button class="btn-danger" onclick="confirmDeleteAccount()">Delete My Account</button>
          </div>
        </div>

        <!-- ===== API KEYS SECTION ===== -->
        <div class="settings-section" id="section-apikeys">
          <div class="settings-card">
            <h2><span class="icon">&#x1F511;</span> API Keys</h2>
            <p class="desc">Manage your third-party API keys for enhanced features</p>

            <div style="margin-top:1.5rem">
              <div style="margin-bottom:1.5rem;padding:1.2rem;border-radius:12px;background:rgba(108,58,237,0.06);border:1px solid rgba(108,58,237,0.15)">
                <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.8rem">
                  <span style="font-size:1.3rem">&#x1F3A4;</span>
                  <h3 style="margin:0;font-size:1rem;font-weight:600;color:var(--text)">ElevenLabs</h3>
                  <a href="https://elevenlabs.io" target="_blank" style="font-size:.75rem;color:var(--primary,#6C3AED);text-decoration:none;margin-left:auto">Get API Key &rarr;</a>
                </div>
                <p style="font-size:.8rem;color:var(--text-muted);margin:0 0 .8rem 0">Used for AI Voiceover in the Video Editor. Get your key from elevenlabs.io &rarr; Profile &rarr; API Keys.</p>
                <div style="display:flex;gap:.6rem;align-items:center">
                  <input type="password" id="elevenLabsKeyInput" value="${elevenLabsKey}" placeholder="Enter your ElevenLabs API key..." style="flex:1;padding:.6rem .9rem;border-radius:8px;border:1px solid var(--border-subtle,rgba(255,255,255,0.1));background:var(--dark-2);color:var(--text);font-size:.85rem;outline:none">
                  <button onclick="toggleKeyVisibility('elevenLabsKeyInput', this)" style="padding:.6rem .8rem;border-radius:8px;border:1px solid var(--border-subtle,rgba(255,255,255,0.1));background:var(--dark-2);color:var(--text-muted);cursor:pointer;font-size:.8rem">Show</button>
                  <button onclick="saveElevenLabsKey()" style="padding:.6rem 1.2rem;border-radius:8px;border:none;background:linear-gradient(135deg,#6C3AED,#8B5CF6);color:#fff;font-weight:600;cursor:pointer;font-size:.85rem">Save</button>
                </div>
              </div>

              <div style="margin-bottom:1.5rem;padding:1.2rem;border-radius:12px;background:rgba(108,58,237,0.06);border:1px solid rgba(108,58,237,0.15)">
                <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.8rem">
                  <span style="font-size:1.3rem">&#x1F4E6;</span>
                  <h3 style="margin:0;font-size:1rem;font-weight:600;color:var(--text)">Dropbox</h3>
                  <a href="https://www.dropbox.com/developers" target="_blank" style="font-size:.75rem;color:var(--primary,#6C3AED);text-decoration:none;margin-left:auto">Get App Key &rarr;</a>
                </div>
                <p style="font-size:.8rem;color:var(--text-muted);margin:0 0 .8rem 0">Used for Dropbox file imports. Create an app at dropbox.com/developers to get your App Key.</p>
                <div style="display:flex;gap:.6rem;align-items:center">
                  <input type="password" id="dropboxKeyInput" value="" placeholder="Enter your Dropbox App Key..." style="flex:1;padding:.6rem .9rem;border-radius:8px;border:1px solid var(--border-subtle,rgba(255,255,255,0.1));background:var(--dark-2);color:var(--text);font-size:.85rem;outline:none">
                  <button onclick="toggleKeyVisibility('dropboxKeyInput', this)" style="padding:.6rem .8rem;border-radius:8px;border:1px solid var(--border-subtle,rgba(255,255,255,0.1));background:var(--dark-2);color:var(--text-muted);cursor:pointer;font-size:.8rem">Show</button>
                  <button onclick="saveDropboxKey()" style="padding:.6rem 1.2rem;border-radius:8px;border:none;background:linear-gradient(135deg,#6C3AED,#8B5CF6);color:#fff;font-weight:600;cursor:pointer;font-size:.85rem">Save</button>
                </div>
              </div>
            </div>

            <p style="font-size:.75rem;color:var(--text-muted);margin-top:.5rem">&#x1F512; Your API keys are encrypted and stored securely. They are never shared with third parties.</p>
          </div>

      </div>
    </div>

    <div class="toast" id="toast"></div>

    <!-- Delete Account Confirmation Modal -->
    <div id="deleteModal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:10000;display:none;align-items:center;justify-content:center">
      <div style="background:var(--surface);border-radius:16px;padding:2rem;max-width:420px;width:90%;border:1px solid rgba(239,68,68,0.3)">
        <h3 style="color:#ef4444;margin-bottom:.5rem">Delete Account</h3>
        <p style="color:var(--text-muted);font-size:.88rem;margin-bottom:1.5rem">This will permanently delete your account, all your content, brand voices, calendar entries, and settings. This action cannot be undone.</p>
        <p style="font-size:.85rem;margin-bottom:1rem;color:var(--text)">Type <strong>DELETE</strong> to confirm:</p>
        <input type="text" id="deleteConfirmInput" placeholder="Type DELETE" style="width:100%;padding:.65rem 1rem;border-radius:10px;border:1px solid rgba(239,68,68,0.3);background:var(--dark-2);color:var(--text);font-size:.88rem;margin-bottom:1rem;outline:none">
        <div style="display:flex;gap:.8rem;justify-content:flex-end">
          <button class="btn-outline" onclick="closeDeleteModal()">Cancel</button>
          <button class="btn-danger" onclick="deleteAccount()">Delete Forever</button>
        </div>
      </div>
    </div>

    <script>
      ${getThemeScript()}

      function showToast(msg, type) {
        var t = document.getElementById('toast');
        t.textContent = msg;
        t.className = 'toast ' + (type || 'success');
        t.style.display = 'block';
        setTimeout(function() { t.style.display = 'none'; }, 4000);
      }

      // Section navigation
      function switchSection(name, btn) {
        document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'));
        document.querySelectorAll('.settings-nav-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('section-' + name).classList.add('active');
        btn.classList.add('active');
      }

      // Save individual setting via API
      async function saveSetting(el) {
        var key = el.dataset.setting;
        var value = el.type === 'checkbox' ? el.checked : el.value;
        try {
          var res = await fetch('/settings/api/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: key, value: value })
          });
          var data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to save');
          showToast('Setting saved', 'success');
        } catch (e) {
          showToast(e.message || 'Failed to save setting', 'error');
        }
      }

      // Apply theme live
      function applyTheme(theme) {
        var isLight = theme === 'light';
        document.body.classList.toggle('light', isLight);
        document.documentElement.classList.toggle('light', isLight);
        document.documentElement.setAttribute('data-theme', isLight ? 'light' : 'dark');
        localStorage.setItem('theme', theme);
        // Update the moon/sun toggle button in the top-right
        var btn = document.querySelector('.theme-toggle');
        if (btn) btn.innerHTML = isLight ? '&#x2600;&#xFE0F;' : '&#x1F319;';
      }

      // Profile functions
      async function saveName() {
        var name = document.getElementById('nameInput').value.trim();
        if (!name) { showToast('Please enter a name', 'error'); return; }
        try {
          var res = await fetch('/auth/api/update-name', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name })
          });
          var data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed');
          showToast(data.message || 'Name updated!', 'success');
        } catch (e) {
          showToast(e.message || 'Failed to update name', 'error');
        }
      }

      async function setPassword() {
        var pw = document.getElementById('newPassword').value;
        var cpw = document.getElementById('confirmPassword').value;
        if (!pw || pw.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }
        if (pw !== cpw) { showToast('Passwords do not match', 'error'); return; }
        try {
          var res = await fetch('/auth/api/set-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pw, confirmPassword: cpw })
          });
          var data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed');
          showToast(data.message || 'Password created!', 'success');
          document.getElementById('newPassword').value = '';
          document.getElementById('confirmPassword').value = '';
        } catch (e) {
          showToast(e.message || 'Failed to set password', 'error');
        }
      }

      async function changePassword() {
        var cur = document.getElementById('currentPassword').value;
        var pw = document.getElementById('newPassword').value;
        var cpw = document.getElementById('confirmPassword').value;
        if (!cur) { showToast('Please enter your current password', 'error'); return; }
        if (!pw || pw.length < 6) { showToast('New password must be at least 6 characters', 'error'); return; }
        if (pw !== cpw) { showToast('New passwords do not match', 'error'); return; }
        try {
          var res = await fetch('/auth/api/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword: cur, newPassword: pw, confirmPassword: cpw })
          });
          var data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed');
          showToast(data.message || 'Password changed!', 'success');
          document.getElementById('currentPassword').value = '';
          document.getElementById('newPassword').value = '';
          document.getElementById('confirmPassword').value = '';
        } catch (e) {
          showToast(e.message || 'Failed to change password', 'error');
        }
      }

      // Export data
      async function exportData() {
        showToast('Preparing your data export...', 'success');
        try {
          var res = await fetch('/settings/api/export-data');
          if (!res.ok) throw new Error('Export failed');
          var blob = await res.blob();
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'repurposeai-data-export.json';
          a.click();
          URL.revokeObjectURL(url);
          showToast('Data exported successfully!', 'success');
        } catch (e) {
          showToast(e.message || 'Failed to export data', 'error');
        }
      }

      // Delete account
      function confirmDeleteAccount() {
        var modal = document.getElementById('deleteModal');
        modal.style.display = 'flex';
      }
      function closeDeleteModal() {
        document.getElementById('deleteModal').style.display = 'none';
        document.getElementById('deleteConfirmInput').value = '';
      }
      async function deleteAccount() {
        var input = document.getElementById('deleteConfirmInput').value.trim();
        if (input !== 'DELETE') {
          showToast('Please type DELETE to confirm', 'error');
          return;
        }
        try {
          var res = await fetch('/settings/api/delete-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: 'DELETE' })
          });
          var data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed');
          window.location.href = '/';
        } catch (e) {
          showToast(e.message || 'Failed to delete account', 'error');
        }
      }
    
      // API Keys functions
      function toggleKeyVisibility(inputId, btn) {
        var inp = document.getElementById(inputId);
        if (inp.type === 'password') {
          inp.type = 'text';
          btn.textContent = 'Hide';
        } else {
          inp.type = 'password';
          btn.textContent = 'Show';
        }
      }

      async function saveElevenLabsKey() {
        var key = document.getElementById('elevenLabsKeyInput').value.trim();
        if (!key) { showToast('Please enter an API key', 'error'); return; }
        try {
          var res = await fetch('/video-editor/save-elevenlabs-key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: key })
          });
          var data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to save');
          showToast('ElevenLabs API key saved successfully!', 'success');
        } catch (e) {
          showToast(e.message || 'Failed to save API key', 'error');
        }
      }

      async function saveDropboxKey() {
        var key = document.getElementById('dropboxKeyInput').value.trim();
        if (!key) { showToast('Please enter a Dropbox App Key', 'error'); return; }
        try {
          var res = await fetch('/settings/save-dropbox-key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: key })
          });
          var data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to save');
          showToast('Dropbox App Key saved successfully!', 'success');
        } catch (e) {
          showToast(e.message || 'Failed to save Dropbox key', 'error');
        }
      }

</script>
    </body></html>
  `);
});

// API: Update a single setting
router.post('/api/update', requireAuth, async (req, res) => {
  try {
    const { key, value } = req.body;
    const allowedKeys = [
      'email_processing_complete', 'email_weekly_summary', 'email_product_updates', 'email_tips_tutorials',
      'default_video_quality', 'default_video_format', 'default_aspect_ratio',
      'default_caption_style', 'default_caption_language', 'auto_generate_captions',
      'theme', 'compact_sidebar', 'language', 'timezone', 'share_usage_analytics'
    ];

    if (!allowedKeys.includes(key)) {
      return res.status(400).json({ error: 'Invalid setting key' });
    }

    const db = getDb();
    // Ensure row exists
    await db.query('INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [req.user.id]);
    // Update the specific column
    await db.query(`UPDATE user_settings SET ${key} = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2`, [value, req.user.id]);

    res.json({ success: true });
  } catch (error) {
    console.error('Settings update error:', error);
    res.status(500).json({ error: 'Failed to save setting' });
  }
});

// API: Export user data
router.get('/api/export-data', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;

    const [user, settings, content, outputs, brandVoices, calendar] = await Promise.all([
      db.query('SELECT id, email, name, plan, created_at FROM users WHERE id = $1', [userId]),
      db.query('SELECT * FROM user_settings WHERE user_id = $1', [userId]),
      db.query('SELECT * FROM content_items WHERE user_id = $1', [userId]),
      db.query('SELECT * FROM generated_outputs WHERE user_id = $1', [userId]),
      db.query('SELECT * FROM brand_voices WHERE user_id = $1', [userId]),
      db.query('SELECT * FROM calendar_entries WHERE user_id = $1', [userId])
    ]);

    const exportData = {
      exported_at: new Date().toISOString(),
      user: user.rows[0] || {},
      settings: settings.rows[0] || {},
      content_items: content.rows,
      generated_outputs: outputs.rows,
      brand_voices: brandVoices.rows,
      calendar_entries: calendar.rows
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=repurposeai-data-export.json');
    res.json(exportData);
  } catch (error) {
    console.error('Data export error:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// API: Delete account
router.post('/api/delete-account', requireAuth, async (req, res) => {
  try {
    const { confirm } = req.body;
    if (confirm !== 'DELETE') {
      return res.status(400).json({ error: 'Please type DELETE to confirm' });
    }

    const db = getDb();
    const userId = req.user.id;

    // Delete in order of foreign key dependencies
    await db.query('DELETE FROM user_settings WHERE user_id = $1', [userId]);
    await db.query('DELETE FROM calendar_entries WHERE user_id = $1', [userId]);
    await db.query('DELETE FROM brand_voices WHERE user_id = $1', [userId]);
    await db.query('DELETE FROM generated_outputs WHERE user_id = $1', [userId]);
    await db.query('DELETE FROM content_items WHERE user_id = $1', [userId]);
    await db.query('DELETE FROM team_members WHERE user_id = $1 OR added_by = $1', [userId]);
    await db.query('DELETE FROM team_invitations WHERE invited_by = $1', [userId]);
    await db.query('DELETE FROM smart_shorts WHERE user_id = $1', [userId]);
    await db.query('DELETE FROM users WHERE id = $1', [userId]);

    // Destroy session
    req.session.destroy(() => {
      res.json({ success: true, message: 'Account deleted' });
    });
  } catch (error) {
    console.error('Account deletion error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// Save Dropbox App Key
router.post('/save-dropbox-key', requireAuth, async (req, res) => {
  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'API key is required' });
    const db = getDb();
    // Store in user_settings table
    await db.query('UPDATE user_settings SET dropbox_app_key = $1 WHERE user_id = $2', [key, req.session.userId || req.user.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Save Dropbox key error:', error);
    res.status(500).json({ error: 'Failed to save key' });
  }
});

module.exports = router;
