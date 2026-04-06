// Middleware that injects the chat widget into all HTML responses
function injectChatWidget(req, res, next) {
  // Store the original send
  const originalSend = res.send;

  res.send = function (body) {
    // Only inject into HTML responses
    if (typeof body === 'string' && body.includes('</body>')) {
      body = body.replace('</body>', CHAT_WIDGET_HTML + '</body>');
    }
    return originalSend.call(this, body);
  };

  next();
}

const CHAT_WIDGET_HTML = `
<!-- Splicora Chat Widget -->
<style>
  .chat-widget-btn {
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: linear-gradient(135deg, #6C3AED 0%, #EC4899 100%);
    border: none;
    cursor: pointer;
    box-shadow: 0 4px 20px rgba(108, 58, 237, 0.4);
    z-index: 9998;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.3s, box-shadow 0.3s;
    color: white;
    font-size: 24px;
  }
  .chat-widget-btn:hover {
    transform: scale(1.1);
    box-shadow: 0 6px 28px rgba(108, 58, 237, 0.5);
  }
  .chat-widget-btn.open {
    display: none;
  }
  .chat-window {
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 380px;
    height: 520px;
    border-radius: 16px;
    overflow: hidden;
    display: none;
    flex-direction: column;
    z-index: 9999;
    box-shadow: 0 8px 40px rgba(0,0,0,0.3);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .chat-window.open {
    display: flex;
  }
  .chat-header {
    background: linear-gradient(135deg, #6C3AED 0%, #EC4899 100%);
    color: white;
    padding: 16px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .chat-header-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .chat-header-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: rgba(255,255,255,0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
  }
  .chat-header-info h4 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
  .chat-header-info p {
    margin: 0;
    font-size: 11px;
    opacity: 0.85;
  }
  .chat-close-btn {
    background: none;
    border: none;
    color: white;
    font-size: 20px;
    cursor: pointer;
    padding: 4px;
    opacity: 0.8;
  }
  .chat-close-btn:hover { opacity: 1; }
  .chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    background: #0f0f1a;
  }
  body.light .chat-messages {
    background: #f8f9fc;
  }
  .chat-msg {
    margin-bottom: 12px;
    display: flex;
  }
  .chat-msg.bot { justify-content: flex-start; }
  .chat-msg.user { justify-content: flex-end; }
  .chat-bubble {
    max-width: 80%;
    padding: 10px 14px;
    border-radius: 12px;
    font-size: 13px;
    line-height: 1.5;
    word-wrap: break-word;
  }
  .chat-msg.bot .chat-bubble {
    background: #1e1e32;
    color: #e0e0e0;
    border-bottom-left-radius: 4px;
  }
  body.light .chat-msg.bot .chat-bubble {
    background: #fff;
    color: #333;
    border: 1px solid #e0e0e0;
  }
  .chat-msg.user .chat-bubble {
    background: #6C3AED;
    color: white;
    border-bottom-right-radius: 4px;
  }
  .chat-typing {
    display: none;
    margin-bottom: 12px;
  }
  .chat-typing.show { display: flex; }
  .chat-typing .chat-bubble {
    background: #1e1e32;
    color: #888;
    border-bottom-left-radius: 4px;
    font-style: italic;
    font-size: 12px;
  }
  body.light .chat-typing .chat-bubble {
    background: #fff;
    color: #999;
    border: 1px solid #e0e0e0;
  }
  .chat-input-area {
    display: flex;
    padding: 12px;
    gap: 8px;
    background: #161616;
    border-top: 1px solid #222;
  }
  body.light .chat-input-area {
    background: #fff;
    border-top: 1px solid #e0e0e0;
  }
  .chat-input {
    flex: 1;
    border: 1px solid #333;
    background: #0f0f1a;
    color: #e0e0e0;
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 13px;
    outline: none;
    font-family: inherit;
  }
  body.light .chat-input {
    background: #f8f9fc;
    border-color: #ddd;
    color: #333;
  }
  .chat-input:focus { border-color: #6C3AED; }
  .chat-input::placeholder { color: #666; }
  .chat-send-btn {
    background: linear-gradient(135deg, #6C3AED 0%, #EC4899 100%);
    border: none;
    color: white;
    border-radius: 8px;
    padding: 0 16px;
    cursor: pointer;
    font-size: 16px;
    transition: opacity 0.2s;
  }
  .chat-send-btn:hover { opacity: 0.9; }
  .chat-send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  @media (max-width: 480px) {
    .chat-window {
      width: calc(100vw - 16px);
      height: calc(100vh - 80px);
      bottom: 8px;
      right: 8px;
      border-radius: 12px;
    }
  }
</style>

<button class="chat-widget-btn" id="chatWidgetBtn" onclick="toggleChat()" title="Chat with us">
  💬
</button>

<div class="chat-window" id="chatWindow">
  <div class="chat-header">
    <div class="chat-header-left">
      <div class="chat-header-avatar">⚡</div>
      <div class="chat-header-info">
        <h4>Splicora Assistant</h4>
        <p>Ask me anything about Splicora</p>
      </div>
    </div>
    <button class="chat-close-btn" onclick="toggleChat()">&times;</button>
  </div>
  <div class="chat-messages" id="chatMessages">
    <div class="chat-msg bot">
      <div class="chat-bubble">Hi! 👋 I'm the Splicora assistant. How can I help you today?</div>
    </div>
  </div>
  <div class="chat-input-area">
    <input type="text" class="chat-input" id="chatInput" placeholder="Type your message..." onkeydown="if(event.key==='Enter')sendChat()" />
    <button class="chat-send-btn" id="chatSendBtn" onclick="sendChat()">➤</button>
  </div>
</div>

<script>
(function() {
  var chatHistory = [];
  var chatOpen = false;

  window.toggleChat = function() {
    chatOpen = !chatOpen;
    document.getElementById('chatWindow').classList.toggle('open', chatOpen);
    document.getElementById('chatWidgetBtn').classList.toggle('open', chatOpen);
    if (chatOpen) {
      setTimeout(function() { document.getElementById('chatInput').focus(); }, 100);
    }
  };

  window.sendChat = function() {
    var input = document.getElementById('chatInput');
    var message = input.value.trim();
    if (!message) return;

    input.value = '';
    appendMessage('user', message);
    chatHistory.push({ role: 'user', content: message });

    var sendBtn = document.getElementById('chatSendBtn');
    sendBtn.disabled = true;

    // Show typing indicator
    var typing = document.createElement('div');
    typing.className = 'chat-msg bot chat-typing show';
    typing.innerHTML = '<div class="chat-bubble">Typing...</div>';
    var messagesEl = document.getElementById('chatMessages');
    messagesEl.appendChild(typing);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    fetch('/chatbot/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message, history: chatHistory.slice(-6) })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      typing.remove();
      var reply = data.reply || "Sorry, I couldn't process that. Please try again.";
      appendMessage('bot', reply);
      chatHistory.push({ role: 'assistant', content: reply });
      sendBtn.disabled = false;
      input.focus();
    })
    .catch(function() {
      typing.remove();
      appendMessage('bot', "I'm having trouble connecting. Please try again.");
      sendBtn.disabled = false;
      input.focus();
    });
  };

  function appendMessage(role, text) {
    var messagesEl = document.getElementById('chatMessages');
    var div = document.createElement('div');
    div.className = 'chat-msg ' + role;
    var bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.textContent = text;
    div.appendChild(bubble);
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
})();
</script>
<!-- End Chat Widget -->
`;

module.exports = { injectChatWidget };
