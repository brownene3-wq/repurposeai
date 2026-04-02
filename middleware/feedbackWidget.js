// Middleware that injects the feedback/bug report widget into all HTML responses
function injectFeedbackWidget(req, res, next) {
  const originalSend = res.send;

  res.send = function (body) {
    if (typeof body === 'string' && body.includes('</body>')) {
      body = body.replace('</body>', FEEDBACK_WIDGET_HTML + '</body>');
    }
    return originalSend.call(this, body);
  };

  next();
}

const FEEDBACK_WIDGET_HTML = `
<!-- RepurposeAI Feedback Widget -->
<style>
  .feedback-btn {
    position: fixed;
    bottom: 24px;
    right: 24px;
    height: 42px;
    padding: 0 16px;
    border-radius: 50px;
    background: #1e1e2e;
    border: 1px solid #333;
    cursor: pointer;
    box-shadow: 0 2px 12px rgba(0,0,0,0.3);
    z-index: 9997;
    display: flex;
    align-items: center;
    gap: 6px;
    color: #a0aec0;
    font-size: 13px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    transition: all 0.3s;
  }
  .feedback-btn:hover {
    background: #2a2a3e;
    color: #fff;
    border-color: #6C3AED;
    box-shadow: 0 4px 20px rgba(108,58,237,0.25);
  }
  body.light .feedback-btn {
    background: #fff;
    border-color: #ddd;
    color: #666;
    box-shadow: 0 2px 12px rgba(0,0,0,0.08);
  }
  body.light .feedback-btn:hover {
    border-color: #6C3AED;
    color: #6C3AED;
  }
  .feedback-btn .fb-icon { font-size: 15px; }
  .feedback-overlay {
    display: none;
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5);
    z-index: 10000;
    align-items: center;
    justify-content: center;
  }
  .feedback-overlay.open { display: flex; }
  .feedback-modal {
    background: #161616;
    border: 1px solid #222;
    border-radius: 16px;
    width: 420px;
    max-width: 92vw;
    max-height: 85vh;
    overflow-y: auto;
    box-shadow: 0 12px 48px rgba(0,0,0,0.5);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  body.light .feedback-modal {
    background: #fff;
    border-color: #e0e0e0;
    box-shadow: 0 12px 48px rgba(0,0,0,0.12);
  }
  .feedback-modal-header {
    padding: 20px 24px 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .feedback-modal-header h3 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 700;
    color: #fff;
  }
  body.light .feedback-modal-header h3 { color: #1a1a2e; }
  .feedback-modal-close {
    background: none;
    border: none;
    color: #888;
    font-size: 22px;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }
  .feedback-modal-close:hover { color: #fff; }
  body.light .feedback-modal-close:hover { color: #333; }
  .feedback-modal-body {
    padding: 16px 24px 24px;
  }
  .feedback-modal-body p {
    color: #a0aec0;
    font-size: 0.85rem;
    margin: 0 0 16px;
    line-height: 1.5;
  }
  body.light .feedback-modal-body p { color: #666; }
  .fb-field { margin-bottom: 14px; }
  .fb-field label {
    display: block;
    font-size: 0.8rem;
    font-weight: 600;
    color: #a0aec0;
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  body.light .fb-field label { color: #555; }
  .fb-field select,
  .fb-field input,
  .fb-field textarea {
    width: 100%;
    padding: 10px 12px;
    background: #0f0f1a;
    border: 1px solid #333;
    border-radius: 8px;
    color: #e0e0e0;
    font-size: 0.9rem;
    font-family: inherit;
    outline: none;
    transition: border-color 0.2s;
  }
  body.light .fb-field select,
  body.light .fb-field input,
  body.light .fb-field textarea {
    background: #f8f9fc;
    border-color: #ddd;
    color: #333;
  }
  .fb-field select:focus,
  .fb-field input:focus,
  .fb-field textarea:focus { border-color: #6C3AED; }
  .fb-field textarea { resize: vertical; min-height: 100px; }
  .fb-submit {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 24px;
    border-radius: 50px;
    font-weight: 600;
    font-size: 0.9rem;
    cursor: pointer;
    border: none;
    background: linear-gradient(135deg, #6C3AED 0%, #EC4899 100%);
    color: #fff;
    box-shadow: 0 4px 20px rgba(108,58,237,0.4);
    transition: all 0.3s;
    font-family: inherit;
    width: 100%;
    justify-content: center;
  }
  .fb-submit:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 30px rgba(108,58,237,0.5);
  }
  .fb-submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }
  .fb-success {
    display: none;
    text-align: center;
    padding: 30px 24px;
  }
  .fb-success .fb-check {
    font-size: 48px;
    margin-bottom: 12px;
  }
  .fb-success h4 {
    color: #fff;
    font-size: 1.1rem;
    margin: 0 0 8px;
  }
  body.light .fb-success h4 { color: #1a1a2e; }
  .fb-success p {
    color: #a0aec0;
    font-size: 0.85rem;
    margin: 0;
  }
  @media (max-width: 480px) {
    .feedback-btn {
      bottom: 16px;
      right: 16px;
      height: 38px;
      padding: 0 12px;
      font-size: 12px;
    }
    .feedback-modal { max-width: 95vw; }
  }
</style>

<button class="feedback-btn" id="feedbackBtn" onclick="openFeedback()" title="Report a bug or give feedback">
  <span class="fb-icon">&#x1F41B;</span> Feedback
</button>

<div class="feedback-overlay" id="feedbackOverlay">
  <div class="feedback-modal">
    <div class="feedback-modal-header">
      <h3>&#x1F4E3; Send Feedback</h3>
      <button class="feedback-modal-close" onclick="closeFeedback()">&times;</button>
    </div>
    <div class="feedback-modal-body">
      <p>Found a bug? Have a suggestion? Let us know and we'll look into it.</p>
      <div id="fbForm">
        <div class="fb-field">
          <label>Category</label>
          <select id="fbCategory">
            <option value="bug">&#x1F41B; Bug Report</option>
            <option value="feature">&#x1F4A1; Feature Request</option>
            <option value="ui">&#x1F3A8; UI/Design Issue</option>
            <option value="performance">&#x26A1; Performance</option>
            <option value="other">&#x1F4AC; Other</option>
          </select>
        </div>
        <div class="fb-field">
          <label>Page (optional)</label>
          <input type="text" id="fbPage" placeholder="e.g. Dashboard, Repurpose, Billing..." />
        </div>
        <div class="fb-field">
          <label>Description</label>
          <textarea id="fbDescription" placeholder="Describe the issue or suggestion in detail..."></textarea>
        </div>
        <button class="fb-submit" id="fbSubmitBtn" onclick="submitFeedback()">Submit Feedback</button>
      </div>
      <div class="fb-success" id="fbSuccess">
        <div class="fb-check">&#x2705;</div>
        <h4>Thank you!</h4>
        <p>Your feedback has been submitted. We'll look into it shortly.</p>
      </div>
    </div>
  </div>
</div>

<script>
(function() {
  window.openFeedback = function() {
    document.getElementById('feedbackOverlay').classList.add('open');
    // Auto-detect current page
    var page = document.getElementById('fbPage');
    if (page && !page.value) {
      var path = window.location.pathname.replace(/^\\//,'').replace(/\\//g,' > ') || 'Home';
      page.value = path.charAt(0).toUpperCase() + path.slice(1);
    }
  };

  window.closeFeedback = function() {
    document.getElementById('feedbackOverlay').classList.remove('open');
    // Reset form after close
    setTimeout(function() {
      document.getElementById('fbForm').style.display = '';
      document.getElementById('fbSuccess').style.display = 'none';
      document.getElementById('fbDescription').value = '';
      document.getElementById('fbCategory').value = 'bug';
      document.getElementById('fbSubmitBtn').disabled = false;
    }, 300);
  };

  // Close on overlay click
  document.getElementById('feedbackOverlay').addEventListener('click', function(e) {
    if (e.target === this) closeFeedback();
  });

  window.submitFeedback = function() {
    var desc = document.getElementById('fbDescription').value.trim();
    if (!desc) {
      document.getElementById('fbDescription').style.borderColor = '#EF4444';
      document.getElementById('fbDescription').setAttribute('placeholder', 'Please describe the issue...');
      return;
    }

    var btn = document.getElementById('fbSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    fetch('/feedback/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: document.getElementById('fbCategory').value,
        page: document.getElementById('fbPage').value,
        description: desc
      })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.success) {
        document.getElementById('fbForm').style.display = 'none';
        document.getElementById('fbSuccess').style.display = 'block';
        setTimeout(function() { closeFeedback(); }, 2500);
      } else {
        btn.disabled = false;
        btn.textContent = 'Submit Feedback';
        alert(data.error || 'Failed to submit. Please try again.');
      }
    })
    .catch(function() {
      btn.disabled = false;
      btn.textContent = 'Submit Feedback';
      alert('Connection error. Please try again.');
    });
  };
})();
</script>
<!-- End Feedback Widget -->
`;

module.exports = { injectFeedbackWidget };
