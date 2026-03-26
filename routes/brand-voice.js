const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const { brandVoiceOps } = require('../db/database');

// GET - Brand voice management page
router.get('/', requireAuth, (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Brand Voice - Content Repurpose SaaS</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          background: #0a0a0a;
          color: #e0e0e0;
          transition: background 0.3s, color 0.3s;
        }

        body.light {
          background: #f5f5f5;
          color: #1a1a1a;
        }

        .container {
          display: flex;
          min-height: 100vh;
        }

        .sidebar {
          width: 250px;
          background: #111;
          padding: 30px 20px;
          border-right: 1px solid #222;
          position: fixed;
          height: 100vh;
          overflow-y: auto;
        }

        body.light .sidebar {
          background: #f0f0f0;
          border-right: 1px solid #e0e0e0;
        }

        .logo {
          font-size: 24px;
          font-weight: bold;
          color: #6c5ce7;
          margin-bottom: 40px;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .sidebar a {
          display: block;
          padding: 12px 16px;
          color: #b0b0b0;
          text-decoration: none;
          border-radius: 8px;
          margin-bottom: 8px;
          transition: all 0.3s;
          font-size: 14px;
        }

        body.light .sidebar a {
          color: #666;
        }

        .sidebar a:hover {
          background: #1a1a1a;
          color: #6c5ce7;
        }

        body.light .sidebar a:hover {
          background: #e0e0e0;
          color: #6c5ce7;
        }

        .sidebar a.active {
          background: #6c5ce7;
          color: white;
        }

        .theme-toggle {
          width: 36px;
          height: 36px;
          border: 1px solid #333;
          background: #222;
          border-radius: 50%;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          transition: all 0.3s;
          color: #fff;
          flex-shrink: 0;
        }

        body.light .theme-toggle {
          background: #fff;
          border: 1px solid #ddd;
        }

        .theme-toggle:hover {
          border-color: #6c5ce7;
          color: #6c5ce7;
        }

        .main-content {
          margin-left: 250px;
          flex: 1;
          padding: 40px;
        }

        .header {
          margin-bottom: 40px;
        }

        .header h1 {
          font-size: 32px;
          margin-bottom: 10px;
          background: linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .header p {
          color: #888;
          font-size: 16px;
        }

        body.light .header p {
          color: #999;
        }

        .content-wrapper {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 40px;
          max-width: 1200px;
        }

        .form-section {
          background: #161616;
          border: 1px solid #222;
          border-radius: 12px;
          padding: 30px;
          backdrop-filter: blur(10px);
        }

        body.light .form-section {
          background: #fff;
          border: 1px solid #e0e0e0;
        }

        .form-section h2 {
          font-size: 20px;
          margin-bottom: 25px;
          color: #e0e0e0;
        }

        body.light .form-section h2 {
          color: #1a1a1a;
        }

        .form-group {
          margin-bottom: 20px;
        }

        .form-group label {
          display: block;
          margin-bottom: 8px;
          font-size: 14px;
          color: #b0b0b0;
          font-weight: 500;
        }

        body.light .form-group label {
          color: #666;
        }

        .form-group input,
        .form-group textarea,
        .form-group select {
          width: 100%;
          padding: 12px;
          background: #0a0a0a;
          border: 1px solid #333;
          border-radius: 8px;
          color: #e0e0e0;
          font-size: 14px;
          font-family: inherit;
          transition: all 0.3s;
        }

        body.light .form-group input,
        body.light .form-group textarea,
        body.light .form-group select {
          background: #f5f5f5;
          border: 1px solid #ddd;
          color: #1a1a1a;
        }

        .form-group input:focus,
        .form-group textarea:focus,
        .form-group select:focus {
          outline: none;
          border-color: #6c5ce7;
          box-shadow: 0 0 0 3px rgba(108, 92, 231, 0.1);
        }

        .form-group textarea {
          resize: vertical;
          min-height: 80px;
        }

        .btn {
          padding: 12px 20px;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
          width: 100%;
        }

        .btn-primary {
          background: linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%);
          color: white;
        }

        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 30px rgba(108, 92, 231, 0.3);
        }

        .btn-secondary {
          background: #222;
          color: #e0e0e0;
          border: 1px solid #333;
          margin-top: 10px;
        }

        body.light .btn-secondary {
          background: #f0f0f0;
          color: #1a1a1a;
          border: 1px solid #ddd;
        }

        .btn-secondary:hover {
          background: #333;
        }

        body.light .btn-secondary:hover {
          background: #e0e0e0;
        }

        .voices-section {
          display: flex;
          flex-direction: column;
        }

        .voices-grid {
          display: grid;
          gap: 15px;
        }

        .voice-card {
          background: #0a0a0a;
          border: 1px solid #333;
          border-radius: 8px;
          padding: 20px;
          transition: all 0.3s;
          position: relative;
        }

        body.light .voice-card {
          background: #f5f5f5;
          border: 1px solid #ddd;
        }

        .voice-card:hover {
          border-color: #6c5ce7;
          box-shadow: 0 4px 12px rgba(108, 92, 231, 0.1);
        }

        .voice-card.default {
          border-color: #6c5ce7;
          background: rgba(108, 92, 231, 0.05);
        }

        body.light .voice-card.default {
          background: rgba(108, 92, 231, 0.02);
        }

        .voice-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;
        }

        .voice-name {
          font-weight: 600;
          color: #e0e0e0;
        }

        body.light .voice-name {
          color: #1a1a1a;
        }

        .default-badge {
          background: #6c5ce7;
          color: white;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
        }

        .voice-tone {
          display: inline-block;
          background: #161616;
          color: #6c5ce7;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          margin-bottom: 10px;
        }

        body.light .voice-tone {
          background: #f0f0f0;
        }

        .voice-description {
          color: #b0b0b0;
          font-size: 13px;
          line-height: 1.5;
          margin-bottom: 10px;
        }

        body.light .voice-description {
          color: #666;
        }

        .voice-actions {
          display: flex;
          gap: 8px;
          margin-top: 15px;
          padding-top: 15px;
          border-top: 1px solid #222;
        }

        body.light .voice-actions {
          border-top: 1px solid #ddd;
        }

        .voice-action-btn {
          flex: 1;
          padding: 8px;
          border: 1px solid #333;
          background: transparent;
          color: #b0b0b0;
          border-radius: 6px;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.3s;
        }

        body.light .voice-action-btn {
          border: 1px solid #ddd;
          color: #666;
        }

        .voice-action-btn:hover {
          border-color: #6c5ce7;
          color: #6c5ce7;
        }

        .empty-voices {
          text-align: center;
          padding: 40px 20px;
          color: #888;
        }

        .empty-voices p {
          margin-bottom: 20px;
        }

        .modal {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          z-index: 1000;
          align-items: center;
          justify-content: center;
        }

        .modal.show {
          display: flex;
        }

        .modal-content {
          background: #161616;
          border: 1px solid #222;
          border-radius: 12px;
          padding: 30px;
          max-width: 500px;
          width: 90%;
          max-height: 90vh;
          overflow-y: auto;
        }

        body.light .modal-content {
          background: #fff;
          border: 1px solid #e0e0e0;
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 25px;
          padding-bottom: 15px;
          border-bottom: 1px solid #222;
        }

        body.light .modal-header {
          border-bottom: 1px solid #e0e0e0;
        }

        .modal-header h2 {
          margin: 0;
          font-size: 20px;
        }

        .modal-close {
          background: none;
          border: none;
          color: #888;
          font-size: 24px;
          cursor: pointer;
          transition: color 0.3s;
        }

        .modal-close:hover {
          color: #e0e0e0;
        }

        .success-feedback {
          position: fixed;
          bottom: 20px;
          right: 20px;
          background: #2a7a2a;
          color: #6bff6b;
          padding: 15px 20px;
          border-radius: 8px;
          animation: slideInRight 0.3s ease-out;
          display: none;
          z-index: 1001;
        }

        .success-feedback.show {
          display: block;
        }

        @keyframes slideInRight {
          from {
            opacity: 0;
            transform: translateX(300px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @media (max-width: 768px) {
          .content-wrapper {
            grid-template-columns: 1fr;
          }

          .sidebar {
            width: 100%;
            height: auto;
            position: relative;
            border-right: none;
            border-bottom: 1px solid #222;
          }

          .main-content {
            margin-left: 0;
          }

          .theme-toggle {
            position: static;
            margin-top: 20px;
          }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="sidebar">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:0 20px 20px;margin-bottom:20px">
            <div class="logo" style="padding:0;margin-bottom:0">🎬 Repurpose</div>
            <button class="theme-toggle" onclick="toggleTheme()" style="position:static;width:36px;height:36px;padding:0;margin:0;border:1px solid #222;background:#161616;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:20px;transition:all 0.3s">🌙</button>
          </div>
          <a href="/dashboard">Dashboard</a>
          <a href="/repurpose">Repurpose</a>
          <a href="/repurpose/history">Library</a>
          <a href="/dashboard/calendar">Calendar</a>
          <a href="/brand-voice" class="active">Brand Voice</a>
          <a href="/dashboard/analytics">Analytics</a>
          <a href="/billing">Billing</a>
          <a href="/auth/logout" style="margin-top:auto;color:#ef4444;opacity:0.7;font-size:0.85rem;padding:12px 16px;display:block;text-decoration:none">Sign Out</a>
        </div>

        <div class="main-content">
          <div class="header">
            <h1>Brand Voice</h1>
            <p>Create and manage your unique brand voice profiles</p>
          </div>

          <div class="content-wrapper">
            <div class="form-section">
              <h2>Create New Voice</h2>
              <form onsubmit="handleCreateVoice(event)">
                <div class="form-group">
                  <label>Voice Name</label>
                  <input type="text" id="voiceName" placeholder="e.g., Professional Expert" required />
                </div>

                <div class="form-group">
                  <label>Tone</label>
                  <select id="voiceTone" required>
                    <option value="">Select tone...</option>
                    <option value="Professional">Professional</option>
                    <option value="Casual">Casual</option>
                    <option value="Humorous">Humorous</option>
                    <option value="Inspirational">Inspirational</option>
                    <option value="Educational">Educational</option>
                  </select>
                </div>

                <div class="form-group">
                  <label>Description</label>
                  <textarea id="voiceDescription" placeholder="Describe this brand voice..." required></textarea>
                </div>

                <div class="form-group">
                  <label>Example Content</label>
                  <textarea id="voiceExample" placeholder="Paste examples of your writing style..." required></textarea>
                </div>

                <button type="submit" class="btn btn-primary">Create Voice</button>
              </form>
            </div>

            <div class="form-section voices-section">
              <h2>Your Brand Voices</h2>
              <div class="voices-grid" id="voicesGrid">
                <div class="empty-voices">
                  <p>No brand voices yet</p>
                  <p style="font-size: 12px; color: #666;">Create your first voice to get started</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div id="editModal" class="modal">
        <div class="modal-content">
          <div class="modal-header">
            <h2>Edit Voice</h2>
            <button class="modal-close" onclick="closeEditModal()">&times;</button>
          </div>
          <form onsubmit="handleUpdateVoice(event)">
            <input type="hidden" id="editVoiceId" />
            <div class="form-group">
              <label>Voice Name</label>
              <input type="text" id="editVoiceName" placeholder="Voice name" required />
            </div>

            <div class="form-group">
              <label>Tone</label>
              <select id="editVoiceTone" required>
                <option value="">Select tone...</option>
                <option value="Professional">Professional</option>
                <option value="Casual">Casual</option>
                <option value="Humorous">Humorous</option>
                <option value="Inspirational">Inspirational</option>
                <option value="Educational">Educational</option>
              </select>
            </div>

            <div class="form-group">
              <label>Description</label>
              <textarea id="editVoiceDescription" placeholder="Describe this brand voice..." required></textarea>
            </div>

            <div class="form-group">
              <label>Example Content</label>
              <textarea id="editVoiceExample" placeholder="Paste examples of your writing style..." required></textarea>
            </div>

            <button type="submit" class="btn btn-primary">Save Changes</button>
            <button type="button" class="btn btn-secondary" onclick="closeEditModal()">Cancel</button>
          </form>
        </div>
      </div>

      <div class="success-feedback" id="successFeedback">✓ Success!</div>

      <script>
        let allVoices = [];

        async function loadVoices() {
          try {
            const response = await fetch('/api/brand-voices');
            if (response.ok) {
              allVoices = await response.json();
              renderVoices();
            }
          } catch (error) {
            console.error('Error loading voices:', error);
          }
        }

        function renderVoices() {
          const grid = document.getElementById('voicesGrid');

          if (allVoices.length === 0) {
            grid.innerHTML = \`
              <div class="empty-voices">
                <p>No brand voices yet</p>
                <p style="font-size: 12px; color: #666;">Create your first voice to get started</p>
              </div>
            \`;
            return;
          }

          grid.innerHTML = allVoices.map(voice => \`
            <div class="voice-card \${voice.is_default ? 'default' : ''}">
              <div class="voice-header">
                <div class="voice-name">\${escapeHtml(voice.name)}</div>
                \${voice.is_default ? '<div class="default-badge">Default</div>' : ''}
              </div>
              <div class="voice-tone">\${voice.tone}</div>
              <div class="voice-description">\${escapeHtml(voice.description)}</div>
              <div class="voice-actions">
                <button class="voice-action-btn" onclick="openEditModal('\${voice.id}')">✏️ Edit</button>
                \${!voice.is_default ? \`<button class="voice-action-btn" onclick="setDefault('\${voice.id}')">⭐ Set Default</button>\` : ''}
                <button class="voice-action-btn" onclick="deleteVoice('\${voice.id}')">🗑️ Delete</button>
              </div>
            </div>
          \`).join('');
        }

        async function handleCreateVoice(event) {
          event.preventDefault();

          const name = document.getElementById('voiceName').value;
          const tone = document.getElementById('voiceTone').value;
          const description = document.getElementById('voiceDescription').value;
          const exampleContent = document.getElementById('voiceExample').value;

          try {
            const response = await fetch('/brand-voice/create', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name, tone, description, exampleContent })
            });

            const data = await response.json();

            if (!response.ok) {
              alert('Error creating voice: ' + (data.error || 'Unknown error'));
              return;
            }

            showSuccess('Brand voice created!');
            event.target.reset();
            await loadVoices();
          } catch (error) {
            console.error('Error creating voice:', error);
            alert('Failed to create voice');
          }
        }

        async function openEditModal(voiceId) {
          const voice = allVoices.find(v => v.id === voiceId);
          if (!voice) return;

          document.getElementById('editVoiceId').value = voiceId;
          document.getElementById('editVoiceName').value = voice.name;
          document.getElementById('editVoiceTone').value = voice.tone;
          document.getElementById('editVoiceDescription').value = voice.description;
          document.getElementById('editVoiceExample').value = voice.example_content;

          document.getElementById('editModal').classList.add('show');
        }

        function closeEditModal() {
          document.getElementById('editModal').classList.remove('show');
        }

        async function handleUpdateVoice(event) {
          event.preventDefault();

          const voiceId = document.getElementById('editVoiceId').value;
          const name = document.getElementById('editVoiceName').value;
          const tone = document.getElementById('editVoiceTone').value;
          const description = document.getElementById('editVoiceDescription').value;
          const exampleContent = document.getElementById('editVoiceExample').value;

          try {
            const response = await fetch('/brand-voice/update', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ voiceId, name, tone, description, exampleContent })
            });

            const data = await response.json();

            if (!response.ok) {
              alert('Error updating voice: ' + (data.error || 'Unknown error'));
              return;
            }

            showSuccess('Brand voice updated!');
            closeEditModal();
            await loadVoices();
          } catch (error) {
            console.error('Error updating voice:', error);
            alert('Failed to update voice');
          }
        }

        async function setDefault(voiceId) {
          try {
            const response = await fetch('/brand-voice/set-default', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ voiceId })
            });

            if (!response.ok) {
              alert('Error setting default voice');
              return;
            }

            showSuccess('Default voice updated!');
            await loadVoices();
          } catch (error) {
            console.error('Error setting default:', error);
            alert('Failed to set default voice');
          }
        }

        async function deleteVoice(voiceId) {
          if (!confirm('Are you sure you want to delete this brand voice?')) return;

          try {
            const response = await fetch('/brand-voice/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ voiceId })
            });

            if (!response.ok) {
              alert('Error deleting voice');
              return;
            }

            showSuccess('Brand voice deleted!');
            await loadVoices();
          } catch (error) {
            console.error('Error deleting voice:', error);
            alert('Failed to delete voice');
          }
        }

        function showSuccess(message) {
          const feedback = document.getElementById('successFeedback');
          feedback.textContent = message;
          feedback.classList.add('show');
          setTimeout(() => feedback.classList.remove('show'), 3000);
        }

        function escapeHtml(text) {
          const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
          };
          return text.replace(/[&<>"']/g, m => map[m]);
        }

        function toggleTheme() {
          document.body.classList.toggle('light');
          localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark');
          const btn = document.querySelector('.theme-toggle');
          btn.textContent = document.body.classList.contains('light') ? '🌙' : '☀️';
        }

        if (localStorage.getItem('theme') === 'light') {
          document.body.classList.add('light');
          document.querySelector('.theme-toggle').textContent = '☀️';
        }

        loadVoices();
      </script>
    </body>
    </html>
  `);
});

// POST - Create brand voice
router.post('/create', requireAuth, async (req, res) => {
  try {
    const { name, tone, description, exampleContent } = req.body;

    if (!name || !tone || !description || !exampleContent) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const voice = await brandVoiceOps.create(
      req.user.id,
      name,
      description,
      exampleContent,
      tone
    );

    res.json({ success: true, voice });
  } catch (error) {
    console.error('Error creating brand voice:', error);
    res.status(500).json({ error: 'Failed to create brand voice' });
  }
});

// POST - Update brand voice
router.post('/update', requireAuth, async (req, res) => {
  try {
    const { voiceId, name, tone, description, exampleContent } = req.body;

    if (!voiceId || !name || !tone || !description || !exampleContent) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const voice = await brandVoiceOps.getById(voiceId);
    if (!voice || voice.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Brand voice not found' });
    }

    const updated = await brandVoiceOps.update(voiceId, name, description, exampleContent, tone);
    res.json({ success: true, voice: updated });
  } catch (error) {
    console.error('Error updating brand voice:', error);
    res.status(500).json({ error: 'Failed to update brand voice' });
  }
});

// POST - Delete brand voice
router.post('/delete', requireAuth, async (req, res) => {
  try {
    const { voiceId } = req.body;

    const voice = await brandVoiceOps.getById(voiceId);
    if (!voice || voice.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Brand voice not found' });
    }

    await brandVoiceOps.delete(voiceId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting brand voice:', error);
    res.status(500).json({ error: 'Failed to delete brand voice' });
  }
});

// POST - Set default brand voice
router.post('/set-default', requireAuth, async (req, res) => {
  try {
    const { voiceId } = req.body;

    const voice = await brandVoiceOps.getById(voiceId);
    if (!voice || voice.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Brand voice not found' });
    }

    const updated = await brandVoiceOps.setDefault(voiceId, req.user.id);
    res.json({ success: true, voice: updated });
  } catch (error) {
    console.error('Error setting default brand voice:', error);
    res.status(500).json({ error: 'Failed to set default brand voice' });
  }
});

// GET - API endpoint for brand voices
router.get('/api', requireAuth, async (req, res) => {
  try {
    const voices = await brandVoiceOps.getByUserId(req.user.id);
    res.json(voices);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch brand voices' });
  }
});

module.exports = router;
