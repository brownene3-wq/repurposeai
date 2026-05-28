const { Resend } = require('resend');

// Initialize Resend client
let resend = null;

function getResend() {
  if (resend) return resend;
  
    const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
          console.warn('[Email] RESEND_API_KEY not configured');
              return null;
                }
                
                  resend = new Resend(apiKey);
                    return resend;
                    }
                    
                    const FROM = () => process.env.SENDER_EMAIL || 'support@splicora.ai';
                    const FROM_NAME = 'Splicora';
                    
                    async function sendEmail({ to, subject, html }) {
  try {
    const r = getResend();
    if (!r) {
      // No API key configured. Return an explicit failure so the
      // caller (e.g. the reminder cron) can surface it instead of
      // silently flipping the entry to 'sent'.
      return { ok: false, error: 'Email provider not configured (RESEND_API_KEY missing)' };
    }
    await r.emails.send({
      from: `${FROM_NAME} <${FROM()}>`,
      to,
      subject,
      html
    });
    console.log(`[Email] Sent "${subject}" to ${to}`);
    return { ok: true, error: null };
  } catch (err) {
    const msg = (err && err.message) || 'Unknown email error';
    console.error(`[Email] Failed "${subject}" to ${to}:`, msg);
    return { ok: false, error: msg };
  }
}
                                                                          
                                                                          function sendWelcomeEmail(user) {
                                                                            return sendEmail({
                                                                                to: user.email,
                                                                                    subject: 'Welcome to Splicora!',
                                                                                        html: `
                                                                                              <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
                                                                                                      <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:32px;text-align:center">
                                                                                                                <h1 style="color:#fff;margin:0;font-size:28px">Welcome to Splicora</h1>
                                                                                                                        </div>
                                                                                                                                <div style="padding:32px">
                                                                                                                                          <p style="font-size:16px;color:#333">Hi ${user.name},</p>
                                                                                                                                                    <p style="font-size:16px;color:#555;line-height:1.6">Thanks for joining Splicora! You're all set to start turning your YouTube videos into engaging content for multiple platforms.</p>
                                                                                                                                                              <div style="text-align:center;margin:32px 0">
                                                                                                                                                                          <a href="https://splicora.ai/repurpose" style="background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;display:inline-block">Start Creating</a>
                                                                                                                                                                                    </div>
                                                                                                                                                                                            </div>
                                                                                                                                                                                                    <div style="background:#f9fafb;padding:20px;text-align:center;border-top:1px solid #eee">
                                                                                                                                                                                                              <p style="font-size:13px;color:#999;margin:0">&copy; ${new Date().getFullYear()} Splicora. All rights reserved.</p>
                                                                                                                                                                                                                      </div>
                                                                                                                                                                                                                            </div>
                                                                                                                                                                                                                                `
                                                                                                                                                                                                                                  });
                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                  
                                                                                                                                                                                                                                  function sendContactNotification({ name, email, subject, message }) {
                                                                                                                                                                                                                                    return sendEmail({
                                                                                                                                                                                                                                        to: FROM(),
                                                                                                                                                                                                                                            subject: `[Contact Form] ${subject || 'New Message'} from ${name}`,
                                                                                                                                                                                                                                                html: `
                                                                                                                                                                                                                                                      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
                                                                                                                                                                                                                                                              <div style="background:#1e293b;padding:24px;text-align:center">
                                                                                                                                                                                                                                                                        <h2 style="color:#fff;margin:0;font-size:22px">New Contact Form Submission</h2>
                                                                                                                                                                                                                                                                                </div>
                                                                                                                                                                                                                                                                                        <div style="padding:28px">
                                                                                                                                                                                                                                                                                                  <table style="width:100%;border-collapse:collapse;font-size:15px">
                                                                                                                                                                                                                                                                                                              <tr><td style="padding:8px 12px;color:#666;font-weight:600">From:</td><td style="padding:8px 12px;color:#333">${name}</td></tr>
                                                                                                                                                                                                                                                                                                                          <tr><td style="padding:8px 12px;color:#666;font-weight:600">Email:</td><td style="padding:8px 12px;color:#333">${email}</td></tr>
                                                                                                                                                                                                                                                                                                                                      <tr><td style="padding:8px 12px;color:#666;font-weight:600">Subject:</td><td style="padding:8px 12px;color:#333">${subject || 'General Inquiry'}</td></tr>
                                                                                                                                                                                                                                                                                                                                                </table>
                                                                                                                                                                                                                                                                                                                                                          <div style="margin-top:20px;padding:16px;background:#f8fafc;border-radius:8px;border-left:4px solid #7c3aed">
                                                                                                                                                                                                                                                                                                                                                                      <p style="font-size:15px;color:#333;line-height:1.6;margin:0;white-space:pre-wrap">${message}</p>
                                                                                                                                                                                                                                                                                                                                                                                </div>
                                                                                                                                                                                                                                                                                                                                                                                        </div>
                                                                                                                                                                                                                                                                                                                                                                                              </div>
                                                                                                                                                                                                                                                                                                                                                                                                  `
                                                                                                                                                                                                                                                                                                                                                                                                    });
                                                                                                                                                                                                                                                                                                                                                                                                    }
                                                                                                                                                                                                                                                                                                                                                                                                    
                                                                                                                                                                                                                                                                                                                                                                                                    function sendContactConfirmation({ name, email }) {
                                                                                                                                                                                                                                                                                                                                                                                                      return sendEmail({
                                                                                                                                                                                                                                                                                                                                                                                                          to: email,
                                                                                                                                                                                                                                                                                                                                                                                                              subject: 'We received your message — Splicora',
                                                                                                                                                                                                                                                                                                                                                                                                                  html: `
                                                                                                                                                                                                                                                                                                                                                                                                                        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
                                                                                                                                                                                                                                                                                                                                                                                                                                <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:28px;text-align:center">
                                                                                                                                                                                                                                                                                                                                                                                                                                          <h2 style="color:#fff;margin:0;font-size:22px">Message Received</h2>
                                                                                                                                                                                                                                                                                                                                                                                                                                                  </div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                          <div style="padding:28px">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                    <p style="font-size:16px;color:#333">Hi ${name},</p>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                              <p style="font-size:16px;color:#555;line-height:1.6">Thanks for reaching out! We've received your message and will get back to you within 24 hours.</p>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        <p style="font-size:14px;color:#999;margin-top:24px">— The Splicora Team</p>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                </div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      </div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          `
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            });
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            function sendUpgradeConfirmation(user, plan) {
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              const planName = ({ free: 'Free', starter: 'Starter', pro: 'Pro', teams: 'Teams' })[plan] || plan;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                return sendEmail({
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    to: user.email,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        subject: `You're now on the ${planName} plan — Splicora`,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            html: `
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:28px;text-align:center">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    <h2 style="color:#fff;margin:0;font-size:22px">Upgrade Confirmed!</h2>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            </div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    <div style="padding:28px">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              <p style="font-size:16px;color:#333">Hi ${user.name},</p>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        <p style="font-size:16px;color:#555;line-height:1.6">Your account has been upgraded to the <strong>${planName}</strong> plan. You now have access to all ${planName} features!</p>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  <div style="text-align:center;margin:28px 0">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              <a href="https://splicora.ai/repurpose" style="background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;display:inline-block">Start Creating</a>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        </div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  <p style="font-size:14px;color:#999;text-align:center">Thank you for supporting Splicora!</p>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          </div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                </div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    `
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      });
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      
function sendPostingReminder({ email, title, platform, scheduledDate, scheduledTime }) {
  const platformNames = { tiktok: 'TikTok', instagram: 'Instagram', shorts: 'YouTube Shorts', twitter: 'Twitter/X', linkedin: 'LinkedIn', blog: 'Blog', newsletter: 'Newsletter' };
  const platformName = platformNames[platform] || platform || 'your platform';
  const dateObj = new Date(scheduledDate + 'T' + (scheduledTime || '12:00') + ':00');
  const timeStr = dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return sendEmail({
    to: email,
    subject: `Reminder: Post "${title}" on ${platformName} soon!`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#f39c12,#e67e22);padding:28px;text-align:center">
          <h2 style="color:#fff;margin:0;font-size:22px">Time to Post!</h2>
        </div>
        <div style="padding:28px">
          <p style="font-size:16px;color:#333;margin-bottom:20px;">Your scheduled post is coming up soon:</p>
          <div style="background:#f8fafc;border-radius:8px;padding:20px;border-left:4px solid #f39c12;margin-bottom:20px;">
            <h3 style="margin:0 0 8px 0;color:#333;font-size:18px;">${title}</h3>
            <p style="margin:4px 0;font-size:14px;color:#555;"><strong>Platform:</strong> ${platformName}</p>
            <p style="margin:4px 0;font-size:14px;color:#555;"><strong>Scheduled:</strong> ${dateStr} at ${timeStr}</p>
          </div>
          <div style="text-align:center;margin:24px 0">
            <a href="https://splicora.ai/shorts" style="background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;display:inline-block">Open Splicora</a>
          </div>
          <p style="font-size:13px;color:#999;text-align:center;margin-top:20px;">This reminder was set from your Content Calendar.</p>
        </div>
      </div>
    `
  });
}

function sendPasswordResetEmail({ email, name, resetUrl }) {
  return sendEmail({
    to: email,
    subject: 'Reset Your Password — Splicora',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:28px;text-align:center">
          <h2 style="color:#fff;margin:0;font-size:22px">Password Reset</h2>
        </div>
        <div style="padding:28px">
          <p style="font-size:16px;color:#333">Hi ${name || 'there'},</p>
          <p style="font-size:16px;color:#555;line-height:1.6">We received a request to reset your password. Click the button below to create a new password. This link expires in 1 hour.</p>
          <div style="text-align:center;margin:28px 0">
            <a href="${resetUrl}" style="background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;display:inline-block">Reset Password</a>
          </div>
          <p style="font-size:14px;color:#999;line-height:1.6">If you didn't request this, you can safely ignore this email. Your password won't be changed.</p>
          <p style="font-size:13px;color:#bbb;margin-top:20px;word-break:break-all">Or copy this link: ${resetUrl}</p>
        </div>
      </div>
    `
  });
}


// Premium clip-ready notification — sent the moment a clip finishes
// encoding and is safely uploaded to R2. Includes a styled hero, the
// moment's title + source video, file size, and a one-click jump to
// My Clips.
function sendClipReadyEmail({ user, clip, unsubscribeUrl }) {
  const momentTitle = (clip && clip.moment_title) || 'Your clip';
  const videoTitle = (clip && clip.video_title) || '';
  const sizeMb = clip && clip.file_size ? (Number(clip.file_size) / 1024 / 1024).toFixed(1) + ' MB' : '';
  const downloadUrl = 'https://splicora.ai/shorts/clips';
  const directDownloadUrl = clip && clip.filename
    ? 'https://splicora.ai/shorts/clip/download/' + encodeURIComponent(clip.filename)
    : downloadUrl;
  const escape = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const userName = escape(user.name ? String(user.name).split(/\s+/)[0] : 'friend');
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your clip is ready</title></head>
<body style="margin:0;padding:0;background:#0f0a1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2937;">
  <div style="display:none;max-height:0;overflow:hidden;color:transparent;">Your Splicora clip "${escape(momentTitle)}" is ready to download.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0f0a1a;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(108,58,237,0.18);">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#6c3aed 0%,#a855f7 50%,#ec4899 100%);padding:40px 32px;text-align:center;">
          <div style="display:inline-block;background:rgba(255,255,255,0.18);padding:10px 18px;border-radius:999px;font-size:11px;color:#fff;letter-spacing:0.12em;font-weight:700;text-transform:uppercase;margin-bottom:18px;">Clip ready</div>
          <h1 style="margin:0;color:#ffffff;font-size:30px;font-weight:800;letter-spacing:-0.02em;">Hi ${userName}, your clip just landed.</h1>
          <p style="margin:12px 0 0;color:rgba(255,255,255,0.92);font-size:15px;line-height:1.5;">Encoded, captioned, and waiting in My Clips.</p>
        </td></tr>
        <!-- Clip details card -->
        <tr><td style="padding:32px 32px 8px;">
          <div style="border:1px solid #ece5fa;border-radius:14px;padding:24px;background:linear-gradient(180deg,#faf7ff 0%,#fff 100%);">
            <div style="font-size:11px;letter-spacing:0.10em;font-weight:700;color:#a855f7;text-transform:uppercase;margin-bottom:8px;">Moment</div>
            <div style="font-size:22px;font-weight:700;color:#0f0a1a;line-height:1.25;margin-bottom:14px;">${escape(momentTitle)}</div>
            ${videoTitle ? `<div style="font-size:13px;color:#6b7280;line-height:1.4;margin-bottom:18px;">From: <span style="color:#3f3552;font-weight:500;">${escape(videoTitle)}</span></div>` : ''}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #ece5fa;padding-top:14px;">
              <tr>
                ${sizeMb ? `<td style="font-size:13px;color:#6b7280;">File size</td><td style="text-align:right;font-size:13px;font-weight:600;color:#1f2937;">${escape(sizeMb)}</td>` : ''}
              </tr>
            </table>
          </div>
        </td></tr>
        <!-- CTA -->
        <tr><td style="padding:24px 32px 8px;text-align:center;">
          <a href="${escape(directDownloadUrl)}" style="display:inline-block;background:linear-gradient(135deg,#ff0050,#ff4500);color:#ffffff;padding:16px 42px;border-radius:999px;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:0.02em;box-shadow:0 8px 24px rgba(255,0,80,0.30);">⬇ Download clip</a>
          <div style="margin-top:14px;">
            <a href="${escape(downloadUrl)}" style="color:#7c3aed;text-decoration:none;font-size:13px;font-weight:600;">or open My Clips →</a>
          </div>
        </td></tr>
        <!-- Tips -->
        <tr><td style="padding:24px 32px 28px;">
          <div style="border-top:1px solid #ece5fa;padding-top:24px;">
            <div style="font-size:11px;letter-spacing:0.10em;font-weight:700;color:#9ca3af;text-transform:uppercase;margin-bottom:10px;">What's next</div>
            <ul style="padding:0 0 0 18px;margin:0;color:#4b5563;font-size:14px;line-height:1.7;">
              <li>Publish directly to TikTok, Instagram, YouTube Shorts, and more from My Clips.</li>
              <li>Send the file straight to Google Drive or Dropbox with one click.</li>
              <li>The clip is stored on our servers — re-download or re-publish any time.</li>
            </ul>
          </div>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f6f3fd;padding:22px 32px;text-align:center;border-top:1px solid #ece5fa;">
          <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">You're getting this because your clip finished rendering on Splicora.</div>
          <div style="font-size:12px;color:#9ca3af;">
            <a href="${escape(unsubscribeUrl)}" style="color:#9ca3af;text-decoration:underline;">Turn these off</a>
            &nbsp;·&nbsp;
            <a href="https://splicora.ai" style="color:#9ca3af;text-decoration:underline;">splicora.ai</a>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  return sendEmail({
    to: user.email,
    subject: '🎬 Your clip "' + (momentTitle.length > 60 ? momentTitle.slice(0, 60) + '…' : momentTitle) + '" is ready',
    html
  });
}

module.exports = {
  sendEmail,
  sendWelcomeEmail,
  sendClipReadyEmail,
  sendContactNotification,
  sendContactConfirmation,
  sendUpgradeConfirmation,
  sendPostingReminder,
  sendPasswordResetEmail
};
