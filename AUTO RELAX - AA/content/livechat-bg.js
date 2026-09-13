(() => {
  const KEY = 'livechatBgImage';

  const b = (bg) => `background:${bg}!important`;
  const t = 'background:transparent!important';

  function injectStyle(dataUrl) {
    const bg = dataUrl ? `url('${dataUrl}') center/cover no-repeat fixed` : null;
    let el = document.getElementById('livechat-bg');
    if (!el) {
      el = document.createElement('style');
      el.id = 'livechat-bg';
      document.head.appendChild(el);
    }
    if (!bg) { el.textContent = ''; return; }

    el.textContent = [
      `[class*="page-content-container__content-wrapper"]{${b(bg)}}`,
      `#customer-details-column{${b(bg)}}#customer-details-column>*{${t}}`,
      `#chats-list-column{${b(bg)}}`,
      `[data-testid="details-panel"]{${b(bg)}}[data-testid="details-panel"] *{${t}}`,
      `[data-testid="messages-list"]{${b(bg)}}`,
      `[data-testid="chat-list"]{${b(bg)}}`,
      `[data-testid="chat-feed"]{${b(bg)}}`,
      `[data-testid="feed-container"]{${b(bg)}}`,
      `[data-testid="messages-list"]>*{${t}}[data-testid="chat-list"]>*{${t}}`,
      `[data-testid="chat-feed"]>*{${t}}[data-testid="feed-container"]>*{${t}}`,
      `[data-testid="skeleton-container"]>*{${t}}`,
      `#tags{${b(bg)}}#tags>*{${t}}`,
      `[class*="SystemMessage"]{${t}}`,
      `[class*="css-zjs6fg"]{${b(bg)}}`,
      `[class*="DetailsCard-module__details-card__content"]{${t}}`,
      `[data-testid="general-info"]{${t}}[data-testid="general-info"]>*{${t}}`,
    ].join('');
  }

  function init() {
    if (!document.head) return requestAnimationFrame(init);
    chrome.storage.local.get(KEY, (result) => {
      if (result[KEY]) injectStyle(result[KEY]);
    });
  }

  init();

  chrome.storage.onChanged.addListener((changes) => {
    if (changes[KEY]) injectStyle(changes[KEY].newValue || null);
  });
})();
