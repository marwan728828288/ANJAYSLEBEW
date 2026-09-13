(() => {
  const DOT_CLASS = 'lc-unread-dot';
  const TYPING_DOT_CLASS = 'lc-typing-dot';
  const TYPING_TIMEOUT = 120000;

  let typingTimer = null;
  let isTyping = false;

  const css = document.createElement('style');
  css.textContent = `
    .${DOT_CLASS} {
      position: absolute !important;
      left: 6px !important;
      top: 50% !important;
      transform: translateY(-50%) !important;
      width: 16px !important;
      height: 16px !important;
      border-radius: 50% !important;
      background: #ff3b30 !important;
      box-shadow: 0 0 8px rgba(255, 59, 48, 0.7) !important;
      pointer-events: none !important;
      z-index: 999 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    }
    .${DOT_CLASS}::after {
      content: '' !important;
      width: 6px !important;
      height: 6px !important;
      border-radius: 50% !important;
      background: #fff !important;
    }
    .${TYPING_DOT_CLASS} {
      position: absolute !important;
      left: 6px !important;
      top: 50% !important;
      transform: translateY(-50%) !important;
      width: 16px !important;
      height: 16px !important;
      border-radius: 50% !important;
      background: #ff3b30 !important;
      box-shadow: 0 0 8px rgba(255, 59, 48, 0.7) !important;
      pointer-events: none !important;
      z-index: 999 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    }
    .${TYPING_DOT_CLASS}::after {
      content: '' !important;
      width: 6px !important;
      height: 6px !important;
      border-radius: 50% !important;
      background: #fff !important;
    }
  `;
  document.head.appendChild(css);

  function hasForwardIcon(el) {
    return !!el.querySelector('svg path[d="m9 14-4-4 4-4"], svg path[d="M19 19v-6a3 3 0 0 0-3-3H5"]');
  }

  function getDot(item) {
    return item.querySelector('.' + DOT_CLASS);
  }

  function isArchived(item) {
    return item.textContent.includes('Archived');
  }

  function isTransferred(item) {
    return item.textContent.includes('Transferred');
  }

  function hasCloseButton(item) {
    return !!item.querySelector('[data-testid="close-chat"]');
  }

  function processItem(item) {
    item.style.position = item.style.position || 'relative';
    const dot = getDot(item);
    if (hasForwardIcon(item) || isArchived(item) || isTransferred(item) || hasCloseButton(item)) {
      if (dot) dot.remove();
    } else {
      if (!dot) {
        const el = document.createElement('span');
        el.className = DOT_CLASS;
        item.appendChild(el);
      }
    }
  }

  function scan() {
    const selectors = [
      '[data-testid="chat-item"]',
      '[data-testid="chat-list-item"]',
      '[data-testid="chat-row"]',
      'a[href*="/chats/"][class*="chat"]',
      '[class*="chat-list"] > div > div > div',
      '[class*="ChatListItem"]',
      '[class*="chat-item"]',
      '[role="listitem"]',
    ];
    for (const sel of selectors) {
      const items = document.querySelectorAll(sel);
      if (items.length) {
        items.forEach(processItem);
        break;
      }
    }
  }

  // --- Typing indicator dot ---
  function getActiveChatItem() {
    const m = window.location.pathname.match(/\/chats\/(\d+)/);
    if (m) {
      const link = document.querySelector(`a[href*="/chats/${m[1]}"]`);
      if (link) {
        const item = link.closest('[class*="chat-item"], [class*="ChatListItem"], [data-testid="chat-item"], [role="listitem"]');
        if (item) return item;
      }
    }
    const selectors = [
      '[data-testid="chat-item"][class*="active"]',
      '[data-testid="chat-list-item"][class*="active"]',
      '[class*="ChatListItem"][class*="active"]',
      '[data-testid="chat-item"][class*="selected"]',
      '[class*="chat-item"][class*="active"]',
      '[class*="chat-item"][aria-selected="true"]',
      '[class*="chat-item"][data-selected]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return document.querySelector('[class*="chat-item"], [data-testid="chat-item"]');
  }

  function addTypingDot() {
    const item = getActiveChatItem();
    if (!item) return;
    removeTypingDot();
    const regularDot = item.querySelector('.' + DOT_CLASS);
    if (regularDot) regularDot.style.display = 'none';
    const dot = document.createElement('span');
    dot.className = TYPING_DOT_CLASS;
    item.style.position = item.style.position || 'relative';
    item.appendChild(dot);
  }

  function removeTypingDot() {
    document.querySelectorAll('.' + TYPING_DOT_CLASS).forEach(el => el.remove());
    document.querySelectorAll('.' + DOT_CLASS).forEach(el => el.style.display = '');
  }

  function isTypingActive() {
    const activeItem = getActiveChatItem();
    if (!activeItem) return false;
    const indicator = activeItem.querySelector('[data-test="typing-indicator"]');
    if (!indicator || !indicator.isConnected) return false;
    if (indicator.offsetParent === null) return false;
    const style = window.getComputedStyle(indicator);
    if (style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
    return true;
  }

  function checkTyping() {
    const active = isTypingActive();

    if (active) {
      if (!isTyping) {
        isTyping = true;
        typingTimer = setTimeout(() => {
          if (isTyping) addTypingDot();
        }, TYPING_TIMEOUT);
      }
    } else {
      if (isTyping) {
        isTyping = false;
        if (typingTimer) { clearTimeout(typingTimer); typingTimer = null; }
        removeTypingDot();
      }
    }
  }

  function init() {
    if (!document.head) return requestAnimationFrame(init);
    scan();
    let timer;
    const obs = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(scan, 100);
    });
    obs.observe(document.body, { childList: true, subtree: true });

    const typingObs = new MutationObserver(() => checkTyping());
    typingObs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    setInterval(checkTyping, 1000);
    checkTyping();
  }

  init();
})();
