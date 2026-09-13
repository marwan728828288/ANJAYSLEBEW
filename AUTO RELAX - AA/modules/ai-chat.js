import { $ } from './shared.js';

const OR_KEY = localStorage.getItem('or_key') || '';
const GROQ_KEY = '';
let provider = 'gemini';
let messages = [];
let isStreaming = false;
let pendingFiles = [];


export function initAIChat() {
  const sendBtn = $('#ai-send-btn');
  const input = $('#ai-input');
  const container = $('#ai-messages');
  if (!sendBtn || !input || !container) return;

  loadMessages();
  updateModelIndicator();

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  input.addEventListener('paste', handlePaste);

  const uploadBtn = $('#ai-upload-btn');
  const fileInput = $('#ai-file-input');
  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', function() { fileInput.click(); });
    fileInput.addEventListener('change', handleFileSelect);
  }

  const modelBtn = $('#ai-model-btn');
  if (modelBtn) modelBtn.addEventListener('click', toggleModel);

  const clearBtn = $('#ai-clear-btn');
  if (clearBtn) clearBtn.addEventListener('click', clearChat);

  const imgModal = $('#ai-img-modal');
  const imgClose = $('#ai-img-close');
  const imgInner = $('#ai-img-modal-inner');
  if (imgModal && imgClose) {
    imgClose.addEventListener('click', function() { imgModal.style.display = 'none'; });
    const imgModalImg = $('#ai-img-modal-img');
  if (imgInner) {
      imgInner.addEventListener('click', function(e) { if (e.target === this) imgModal.style.display = 'none'; });
    }
  if (imgModalImg) {
    imgModalImg.addEventListener('click', function() {
      if (this.style.maxWidth === '100%') {
        this.style.maxWidth = '90%';
        this.style.maxHeight = '90%';
        this.style.cursor = 'zoom-in';
      } else {
        this.style.maxWidth = '100%';
        this.style.maxHeight = '100%';
        this.style.cursor = 'zoom-out';
      }
    });
  }
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && imgModal.style.display === 'block') imgModal.style.display = 'none';
    });
  }
}

function getGroqKey() {
  try { return localStorage.getItem('groq_key'); } catch (_) { return null; }
}

function toggleModel() {
  var order = ['openrouter', 'gemini', 'groq'];
  var idx = order.indexOf(provider);
  provider = order[(idx + 1) % order.length];
  var names = { openrouter: 'OpenRouter', gemini: 'Gemini 2.5 Flash', groq: 'GroqCloud' };
  updateModelIndicator();
  addSystemMsg('Berpindah ke ' + (names[provider] || provider));
}

function updateModelIndicator() {
  const ind = $('#ai-model-indicator');
  if (!ind) return;
  var names = { openrouter: 'OpenRouter', gemini: 'Gemini', groq: 'GroqCloud' };
  ind.textContent = names[provider] || 'OpenRouter';
}

function addSystemMsg(text) {
  const container = $('#ai-messages');
  if (!container) return;
  const div = document.createElement('div');
  div.style.cssText = 'text-align:center;font-size:11px;color:#6b7280;padding:6px 0;';
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function clearChat() {
  if (messages.length === 0) return;
  if (!confirm('Hapus semua percakapan?')) return;
  messages = [];
  saveMessages();
  renderMessages();
}

function handlePaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;
  let pasted = false;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      pasted = true;
      const file = item.getAsFile();
      if (!file || pendingFiles.length >= 5 || file.size > 10 * 1024 * 1024) continue;
      const reader = new FileReader();
      reader.onload = function(ev) {
        pendingFiles.push({ name: 'pasted.png', data: ev.target.result, type: file.type });
        renderPreviews();
      };
      reader.readAsDataURL(file);
    }
  }
  if (!pasted) {
    const items2 = e.clipboardData?.files;
    if (items2) {
      for (const file of items2) {
        if (file.type.startsWith('image/') && pendingFiles.length < 5 && file.size <= 10 * 1024 * 1024) {
          e.preventDefault();
          pasted = true;
          const reader = new FileReader();
          reader.onload = function(ev) {
            pendingFiles.push({ name: file.name, data: ev.target.result, type: file.type });
            renderPreviews();
          };
          reader.readAsDataURL(file);
        }
      }
    }
  }
}

function handleFileSelect(e) {
  const files = e.target.files;
  if (!files.length) return;
  for (const file of files) {
    if (pendingFiles.length >= 5) break;
    if (file.size > 10 * 1024 * 1024) continue;
    const reader = new FileReader();
    reader.onload = function(ev) {
      pendingFiles.push({ name: file.name, data: ev.target.result, type: file.type });
      renderPreviews();
    };
    reader.readAsDataURL(file);
  }
  e.target.value = '';
}

function renderPreviews() {
  const container = $('#ai-preview');
  if (!container) return;
  if (pendingFiles.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';
  container.innerHTML = '';
  pendingFiles.forEach(function(f, i) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;width:56px;height:56px;border-radius:6px;overflow:hidden;border:1px solid rgba(99,102,241,0.15);flex-shrink:0;';
    const img = document.createElement('img');
    img.src = f.data;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
    const close = document.createElement('span');
    close.textContent = '\u00d7';
    close.style.cssText = 'position:absolute;top:-1px;right:1px;cursor:pointer;color:#fff;font-size:15px;font-weight:700;text-shadow:0 0 4px rgba(0,0,0,0.8);line-height:1;';
    close.addEventListener('click', function() { pendingFiles.splice(i, 1); renderPreviews(); });
    wrap.appendChild(img);
    wrap.appendChild(close);
    container.appendChild(wrap);
  });
}

function loadMessages() {
  try {
    const saved = localStorage.getItem('ai_chat_messages');
    if (saved) {
      messages = JSON.parse(saved);
      renderMessages();
    }
  } catch (_) {}
}

function saveMessages() {
  try {
    localStorage.setItem('ai_chat_messages', JSON.stringify(messages));
  } catch (_) {}
}

function renderMessages() {
  const container = $('#ai-messages');
  if (!container) return;
  container.innerHTML = '';
  if (messages.length === 0) {
    container.innerHTML = '<div class="ai-empty">Mulai percakapan dengan AI</div>';
    return;
  }
  messages.forEach(function(msg, idx) {
    const wrap = document.createElement('div');
    wrap.className = 'ai-msg-wrap';
    const bubble = document.createElement('div');
    bubble.className = 'ai-msg ' + (msg.role === 'user' ? 'ai-user' : 'ai-assistant');
    if (msg.images && msg.images.length) {
      const imgsDiv = document.createElement('div');
      imgsDiv.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;';
      msg.images.forEach(function(imgData) {
        const img = document.createElement('img');
        img.src = imgData;
        img.className = 'ai-img-thumb';
        img.addEventListener('click', function() { openImagePreview(imgData); });
        imgsDiv.appendChild(img);
      });
      bubble.appendChild(imgsDiv);
    }
    if (msg.content) {
      const textDiv = document.createElement('div');
      if (msg.role === 'user') {
        textDiv.textContent = msg.content;
      } else {
        textDiv.innerHTML = marked(msg.content);
      }
      bubble.appendChild(textDiv);
    }
    wrap.appendChild(bubble);
    container.appendChild(wrap);
  });
  container.scrollTop = container.scrollHeight;
}

function openImagePreview(src) {
  const modal = $('#ai-img-modal');
  const img = $('#ai-img-modal-img');
  if (!modal || !img) return;
  img.src = src;
  modal.style.display = 'block';
}

async function sendMessage() {
  const input = $('#ai-input');
  const sendBtn = $('#ai-send-btn');
  const text = input.value.trim();
  if ((!text || text === '') && pendingFiles.length === 0) return;
  if (isStreaming) return;

  const files = pendingFiles.slice();
  pendingFiles = [];
  renderPreviews();

  input.value = '';
  messages.push({ role: 'user', content: text || '', images: files.map(function(f) { return f.data; }) });
  saveMessages();
  renderMessages();
  isStreaming = true;
  sendBtn.disabled = true;
  sendBtn.textContent = '...';

  const container = $('#ai-messages');
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'ai-msg ai-assistant ai-loading';
  loadingDiv.textContent = 'Mengetik...';
  container.appendChild(loadingDiv);
  container.scrollTop = container.scrollHeight;

  try {
    if (provider === 'groq') {
      await sendGroq(text, files);
    } else if (provider === 'gemini') {
      await sendGemini(text, files);
    } else {
      await sendOpenRouter(text, files);
    }
    saveMessages();
    renderMessages();
  } catch (err) {
    loadingDiv.remove();
    const errDiv = document.createElement('div');
    errDiv.className = 'ai-msg ai-assistant ai-error';
    errDiv.textContent = 'Error: ' + err.message;
    container.appendChild(errDiv);
    container.scrollTop = container.scrollHeight;
  } finally {
    isStreaming = false;
    sendBtn.disabled = false;
    sendBtn.textContent = 'Kirim';
  }
}

async function sendGroq(text, files) {
  var apiKey = GROQ_KEY || getGroqKey();
  if (!apiKey) {
    throw new Error('Belum ada API key GroqCloud. Dapatkan gratis di https://console.groq.com/keys lalu simpan: localStorage.setItem("groq_key", "key-anda")');
  }

  var groqMessages = messages.map(function(m) {
    if (m.images && m.images.length) {
      var parts = [];
      if (m.content) parts.push({ type: 'text', text: m.content });
      m.images.forEach(function(img) { parts.push({ type: 'image_url', image_url: { url: img } }); });
      return { role: m.role, content: parts };
    }
    return { role: m.role, content: m.content };
  });

  var model = files.length ? 'llama-3.2-90b-vision-preview' : 'llama-3.3-70b-versatile';

  var res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model,
      messages: groqMessages,
      max_tokens: 3000,
    }),
  });

  if (!res.ok) {
    var errText = await res.text();
    throw new Error('HTTP ' + res.status + ': ' + errText);
  }

  var data = await res.json();
  var reply = data.choices?.[0]?.message?.content || 'Tidak ada respons.';
  messages.push({ role: 'assistant', content: reply });
}

async function sendOpenRouter(text, files) {
  const chatMessages = messages.map(function(m) {
    if (m.images && m.images.length) {
      const parts = [];
      if (m.content) parts.push({ type: 'text', text: m.content });
      m.images.forEach(function(img) { parts.push({ type: 'image_url', image_url: { url: img } }); });
      return { role: m.role, content: parts };
    }
    return { role: m.role, content: m.content };
  });

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + OR_KEY,
      'HTTP-Referer': 'https://auto-relax-aa.app',
      'X-Title': 'AUTO RELAX by AA',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openrouter/free',
      messages: chatMessages,
      max_tokens: 3000,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error('HTTP ' + res.status + ': ' + errText);
  }

  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content || 'Tidak ada respons.';
  messages.push({ role: 'assistant', content: reply });
}

async function sendGemini(text, files) {
  const apiKey = await getGeminiKey();
  if (!apiKey) {
    throw new Error('Belum ada API key Gemini. Dapatkan gratis di https://aistudio.google.com/apikey lalu simpan: localStorage.setItem("gemini_key", "key-anda")');
  }

  const parts = [];
  if (text) parts.push({ text: text });
  files.forEach(function(f) {
    if (f.type && f.type.startsWith('image/')) {
      const mime = f.data.split(';')[0].split(':')[1];
      const b64 = f.data.split(',')[1];
      parts.push({ inline_data: { mime_type: mime, data: b64 } });
    } else {
      parts.push({ text: '[File: ' + f.name + ']' });
    }
  });

  const contents = [];
  for (const m of messages) {
    if (m === messages[messages.length - 1]) break;
    if (m.role === 'user') {
      const msgParts = [];
      if (m.content) msgParts.push({ text: m.content });
      if (m.images) {
        m.images.forEach(function(img) {
          const mime = img.split(';')[0].split(':')[1];
          const b64 = img.split(',')[1];
          msgParts.push({ inline_data: { mime_type: mime, data: b64 } });
        });
      }
      contents.push({ role: 'user', parts: msgParts.length ? msgParts : [{ text: '' }] });
    } else if (m.role === 'assistant') {
      contents.push({ role: 'model', parts: [{ text: m.content }] });
    }
  }
  contents.push({ role: 'user', parts: parts });

  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: contents }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error('HTTP ' + res.status + ': ' + errText);
  }

  const data = await res.json();
  const reply = data.candidates?.[0]?.content?.parts?.map(function(p) { return p.text; }).join('') || 'Tidak ada respons.';
  messages.push({ role: 'assistant', content: reply });
}

async function getGeminiKey() {
  try {
    const { GEMINI_API_KEY } = await import('../config.js');
    if (GEMINI_API_KEY) return GEMINI_API_KEY;
  } catch (_) {}
  try { return localStorage.getItem('gemini_key'); } catch (_) { return null; }
}

function marked(text) {
  if (!text) return '';
  var html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
  return html;
}
