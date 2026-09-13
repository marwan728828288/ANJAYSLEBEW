(function () {
  'use strict';

  const URGENT_MS = 180000;
  const SCAN_INTERVAL = 1000;
  const TOAST_LIFETIME_MS = 8000;
  const UNIQ_BEFORE_REPEAT = 4;

  let scanTimer = null;
  let initialized = false;

  const chatState = new Map();
  const urgentToasted = new Set();
  let lastActiveChatId = null;

  const escapeHtml = (text) =>
    String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const hashText = (t) => t.toLowerCase().replace(/\s+/g, ' ').trim();

  const formatDuration = (ms) => {
    const totalSec = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSec / 60);
    const seconds = totalSec % 60;
    if (minutes === 0) return seconds + 'd';
    return minutes + 'm ' + seconds + 'd';
  };

  const ensureToastHost = () => {
    let host = document.querySelector('.ad-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.className = 'ad-toast-host';
      document.body.appendChild(host);
    }
    return host;
  };

  const showToast = (message, accent, onClick) => {
    accent = accent || '#818cf8';
    const host = ensureToastHost();
    const toast = document.createElement('div');
    toast.className = 'ad-toast';
    toast.style.setProperty('--toast-accent', accent);
    toast.innerHTML = '<span class="ad-toast-msg">' + escapeHtml(message) + '</span><button class="ad-toast-close" type="button">&times;</button>';
    host.appendChild(toast);
    const close = () => { toast.classList.add('hide'); setTimeout(() => toast.remove(), 200); };
    toast.querySelector('.ad-toast-close').addEventListener('click', (e) => { e.stopPropagation(); close(); });
    toast.addEventListener('click', () => { close(); if (onClick) onClick(); });
    setTimeout(close, TOAST_LIFETIME_MS);
  };

  const getOrCreateChatState = (chatId) => {
    if (!chatState.has(chatId)) {
      chatState.set(chatId, { customerWaitStart: null, agentMsgHashes: [], lastSpamMsgCount: 0 });
    }
    return chatState.get(chatId);
  };

  const parseStartedTime = () => {
    const allEls = document.querySelectorAll('p, span, div');
    for (const el of allEls) {
      const text = (el.textContent || '').trim();
      if (!/^Started\s*[-–—]\s*/i.test(text)) continue;
      const timePart = text.replace(/^Started\s*[-–—]\s*/i, '').trim();
      if (!timePart) return null;
      const m = timePart.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
      if (m) {
        let hours = parseInt(m[1], 10);
        const mins = parseInt(m[2], 10);
        const ampm = m[3].toLowerCase();
        if (ampm === 'pm' && hours < 12) hours += 12;
        if (ampm === 'am' && hours === 12) hours = 0;
        const now = new Date();
        const started = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, mins, 0);
        return started.getTime();
      }
      const parsed = new Date(timePart);
      if (!isNaN(parsed.getTime())) return parsed.getTime();
    }
    return null;
  };

  const getActiveChatId = () => {
    const m = location.pathname.match(/\/chats\/(?:[^/]+\/)?([^/]+)/i);
    return m ? m[1] : null;
  };

  const monitorActiveChat = () => {
    const chatId = getActiveChatId();
    if (!chatId) return;

    if (lastActiveChatId && lastActiveChatId !== chatId) {
      urgentToasted.delete(lastActiveChatId);
    }
    lastActiveChatId = chatId;

    const state = getOrCreateChatState(chatId);

    const startedTime = parseStartedTime();
    if (startedTime) {
      if (!state.customerWaitStart) {
        state.customerWaitStart = startedTime;
        state.agentMsgHashes = [];
        state.lastSpamMsgCount = 0;
      }
    }

    const msgs = document.querySelector('[data-testid="messages-list"]');
    if (msgs) {
      const agentMsgs = msgs.querySelectorAll('[data-testid="agent-message"]');
      if (agentMsgs.length > state.lastSpamMsgCount) {
        const lastAgentMsg = agentMsgs[agentMsgs.length - 1];
        const textEl = lastAgentMsg.querySelector('[data-testid="message-text"],[data-testid="text-message"],.css-1j1ougx,.message-text');
        if (textEl && textEl.textContent) {
          const hash = hashText(textEl.textContent);
          if (hash.length >= 3) {
            const recentHashes = state.agentMsgHashes.slice(-(UNIQ_BEFORE_REPEAT - 1));
            if (recentHashes.includes(hash)) {
              const bubble = lastAgentMsg.querySelector('[data-testid="message-bubble"],.css-3dz5hy,.message-bubble');
              if (bubble && !lastAgentMsg.classList.contains('ad-spam')) {
                lastAgentMsg.classList.add('ad-spam');
                showToast('Spam detected! Balasan sama dengan yang baru-baru ini.', '#ff3b30');
              }
            }
            state.agentMsgHashes.push(hash);
            if (state.agentMsgHashes.length > UNIQ_BEFORE_REPEAT) {
              state.agentMsgHashes.shift();
            }
          }
        }
        state.lastSpamMsgCount = agentMsgs.length;
      }
    }
  };

  const findLongestWaitingChat = () => {
    let longestChatId = null;
    let longestWait = 0;
    chatState.forEach((state, chatId) => {
      if (state.customerWaitStart) {
        const wait = Date.now() - state.customerWaitStart;
        if (wait > longestWait) {
          longestWait = wait;
          longestChatId = chatId;
        }
      }
    });
    return longestChatId;
  };

  const navigateToChat = (chatId) => {
    if (!chatId) return;
    const link = document.querySelector('a[href*="/chats/' + chatId + '"]');
    if (link) { link.click(); return; }
    window.location.href = '/chats/' + chatId;
  };

  const getChatIdFromItem = (item) => {
    if (!item) return null;
    if (item.dataset.chatId) return item.dataset.chatId;
    const holder = item.closest('li[data-testid^="chat-item-"]') || item;
    const tid = holder.getAttribute('data-testid') || '';
    const m = tid.match(/chat-item-([^/]+)/i);
    if (m) { item.dataset.chatId = m[1]; return m[1]; }
    const a = item.querySelector('a[href*="/chats/"]');
    if (a) {
      const m2 = (a.getAttribute('href') || '').match(/\/chats\/(?:[^/]+\/)?([^/]+)/i);
      if (m2) { item.dataset.chatId = m2[1]; return m2[1]; }
    }
    return null;
  };

  const applySidebarStyling = () => {
    document.querySelectorAll('.chat-item, [data-testid="chat-item"], [class*="chat-item"], [role="listitem"]').forEach(item => {
      try {
        const chatId = getChatIdFromItem(item);
        if (!chatId) return;

        const state = chatState.get(chatId);
        const timerBadge = item.querySelector('.ad-timer-badge');
        const fill = item.querySelector('.ad-bg-fill');

        if (state && state.customerWaitStart) {
          const elapsed = Date.now() - state.customerWaitStart;

          let badge = timerBadge;
          if (!badge) {
            badge = document.createElement('span');
            badge.className = 'ad-timer-badge';
            item.appendChild(badge);
          }
          badge.textContent = formatDuration(elapsed);

          if (elapsed >= URGENT_MS) {
            item.classList.add('ad-box-card', 'ad-lined');
            item.style.setProperty('--ad-left-color', '#e31010');
            item.style.setProperty('--ad-left-rgb', '227,16,16');
            item.style.backgroundColor = 'rgba(227,16,16,0.06)';
            item.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08), inset 0 0 0 1px rgba(227,16,16,0.3)';

            let fl = fill;
            if (!fl) {
              fl = document.createElement('div');
              fl.className = 'ad-bg-fill';
              item.insertBefore(fl, item.firstChild);
            }
            fl.style.width = '100%';

            if (!urgentToasted.has(chatId)) {
              urgentToasted.add(chatId);
              showToast('Chat ' + chatId + ' menunggu ' + formatDuration(elapsed), '#ff3b30', () => {
                navigateToChat(chatId);
              });
            }
          } else {
            item.classList.remove('ad-box-card', 'ad-lined');
            item.style.removeProperty('--ad-left-color');
            item.style.removeProperty('--ad-left-rgb');
            item.style.removeProperty('background-color');
            item.style.removeProperty('box-shadow');
            const fillEl = item.querySelector('.ad-bg-fill');
            if (fillEl) fillEl.remove();
          }
        } else {
          clearItemStyling(item);
        }
      } catch (e) {}
    });
  };

  const clearItemStyling = (item) => {
    item.classList.remove('ad-box-card', 'ad-lined');
    item.style.removeProperty('--ad-left-color');
    item.style.removeProperty('--ad-left-rgb');
    item.style.removeProperty('background-color');
    item.style.removeProperty('box-shadow');
    const badge = item.querySelector('.ad-timer-badge');
    if (badge) badge.remove();
    const fill = item.querySelector('.ad-bg-fill');
    if (fill) fill.remove();
  };

  const injectStyles = () => {
    if (document.getElementById('ad-assist-styles')) return;
    const s = document.createElement('style');
    s.id = 'ad-assist-styles';
    s.textContent =
      '.lc-unread-dot,.lc-typing-dot{display:none!important}' +
      '.chat-item.ad-box-card{margin:4px 6px!important;border-radius:8px!important;overflow:hidden;transition:background-color .2s,box-shadow .2s}' +
      '.chat-item.ad-box-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--ad-left-color,currentColor);border-radius:4px 0 0 4px;z-index:1;pointer-events:none}' +
      '.ad-bg-fill{position:absolute;top:0;left:0;bottom:0;width:0%;background:linear-gradient(90deg,rgba(227,16,16,0.15) 0%,rgba(227,16,16,0.08) 80%,transparent 100%);transition:width 1s linear;pointer-events:none;z-index:0;border-radius:8px}' +
      '.ad-timer-badge{position:absolute;top:4px;right:6px;background:rgba(100,100,120,0.75);color:#fff;font-size:9px;font-weight:700;line-height:1;padding:2px 5px;border-radius:4px;pointer-events:none;z-index:5;font-family:Consolas,monospace;backdrop-filter:blur(2px);transition:background .3s}' +
      '.chat-item.ad-box-card.ad-lined .ad-timer-badge{background:rgba(227,16,16,0.85)}' +
      '[data-testid="agent-message"].ad-spam [data-testid="message-bubble"],[data-testid="agent-message"].ad-spam .css-3dz5hy,[data-testid="agent-message"].ad-spam .message-bubble{background:#ff0000!important;color:#fff!important;box-shadow:0 0 0 2px #990000!important}' +
      '.ad-toast-host{position:fixed;top:16px;right:20px;display:flex;flex-direction:column;gap:10px;z-index:99999;pointer-events:none;width:max-content;max-width:calc(100vw - 40px)}' +
      '.ad-toast{position:relative;pointer-events:auto;cursor:pointer;display:inline-flex;align-items:center;gap:10px;padding:12px 36px 12px 16px;border-radius:12px;background:rgba(34,37,44,0.96);color:#e6e7eb;border:2px solid var(--toast-accent,#818cf8);box-shadow:0 8px 24px rgba(0,0,0,0.25);width:280px;max-width:280px;overflow:hidden;animation:adToastIn 160ms ease-out both}' +
      '.ad-toast::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--toast-accent,#818cf8);border-radius:2px 0 0 2px}' +
      '.ad-toast .ad-toast-msg{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px;line-height:1.25;padding-right:6px}' +
      '.ad-toast .ad-toast-close{position:absolute;right:8px;top:8px;width:24px;height:24px;border-radius:6px;border:1px solid var(--toast-accent,#818cf8);background:transparent;color:var(--toast-accent,#818cf8);font-size:16px;display:grid;place-items:center;cursor:pointer}' +
      '.ad-toast .ad-toast-close:hover{background:rgba(255,255,255,0.06)}' +
      '.ad-toast.hide{animation:adToastOut 140ms ease-in both}' +
      '@keyframes adToastIn{from{opacity:0;transform:translateY(-8px) scale(.98)}to{opacity:1;transform:none}}' +
      '@keyframes adToastOut{from{opacity:1;transform:none}to{opacity:0;transform:translateY(-8px) scale(.98)}}';
    document.head.appendChild(s);
  };

  const scan = () => {
    monitorActiveChat();
    applySidebarStyling();
  };

  const startScanning = () => {
    stopScanning();
    scan();
    scanTimer = setInterval(scan, SCAN_INTERVAL);
  };

  const stopScanning = () => {
    if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  };

  const resetAll = () => {
    chatState.clear();
    urgentToasted.clear();
    lastActiveChatId = null;

    document.querySelectorAll('.ad-box-card').forEach(item => {
      item.classList.remove('ad-box-card', 'ad-lined');
      item.style.removeProperty('--ad-left-color');
      item.style.removeProperty('--ad-left-rgb');
      item.style.removeProperty('background-color');
      item.style.removeProperty('box-shadow');
      const badge = item.querySelector('.ad-timer-badge');
      if (badge) badge.remove();
      const fill = item.querySelector('.ad-bg-fill');
      if (fill) fill.remove();
    });

    document.querySelectorAll('.ad-spam').forEach(m => {
      m.classList.remove('ad-spam');
      const b = m.querySelector('[data-testid="message-bubble"],.css-3dz5hy,.message-bubble');
      if (b) { b.style.removeProperty('background-color'); b.style.removeProperty('color'); b.style.removeProperty('box-shadow'); }
    });
  };

  const init = () => {
    if (initialized) return;
    initialized = true;
    injectStyles();
    startScanning();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1000));
  } else {
    setTimeout(init, 1000);
  }

  window.scanAllChats = scan;
  window.resetAllHighlights = resetAll;
  window.stopAssistScanning = stopScanning;
  window.resetAssistHighlights = resetAll;
})();
