import { $, getData, setData, showToast, idbGet, idbSet, idbDelete, readImageFile } from './shared.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

var decoSideTarget = 'left';
var decoEditTarget = 'left';

function getDecoArr(side) {
  var key = 'deco' + side.charAt(0).toUpperCase() + side.slice(1) + 'Arr';
  return idbGet(key).then(function(v) { return v || []; });
}

function setDecoArr(side, arr) {
  var key = 'deco' + side.charAt(0).toUpperCase() + side.slice(1) + 'Arr';
  return idbSet(key, arr).then(function() {
    applyDecoImgs(side, arr);
    renderDecoPanel(side);
  });
}

function applyDecoImgs(side, arr) {
  var container = document.getElementById('deco-imgs-' + side);
  var sideEl = document.getElementById('side-deco-' + side);
  container.innerHTML = '';
  if (!arr || arr.length === 0) {
    sideEl.classList.remove('has-imgs');
    return;
  }
  sideEl.classList.add('has-imgs');
  arr.forEach(function(dataUrl) {
    var img = document.createElement('img');
    img.src = dataUrl;
    img.classList.add('show');
    container.appendChild(img);
  });
}

export async function loadDecoImages() {
  var left = await getDecoArr('left');
  var right = await getDecoArr('right');
  if (!left.length) {
    var old = await getData('decoLeftArr');
    if (old.decoLeftArr) {
      left = old.decoLeftArr;
      idbSet('decoLeftArr', left);
      setData({ decoLeftArr: undefined });
    }
  }
  if (!right.length) {
    var old = await getData('decoRightArr');
    if (old.decoRightArr) {
      right = old.decoRightArr;
      idbSet('decoRightArr', right);
      setData({ decoRightArr: undefined });
    }
  }
  applyDecoImgs('left', left);
  applyDecoImgs('right', right);
}

function addDecoImage(side, dataUrl) {
  return getDecoArr(side).then(function(arr) {
    if (arr.length >= 10) {
      showToast('Maks 10 gambar per sisi!', true);
      return;
    }
    arr.push(dataUrl);
    return setDecoArr(side, arr);
  });
}

function removeDecoImage(side, index) {
  return getDecoArr(side).then(function(arr) {
    arr.splice(index, 1);
    return setDecoArr(side, arr);
  });
}

export function renderDecoPanel(side) {
  getDecoArr(side).then(function(arr) {
    var listEl = document.getElementById('deco-list-' + side);
    var countEl = document.getElementById('deco-count-' + side);
    var addBtn = document.getElementById('deco-add-' + side);
    listEl.innerHTML = '';
    arr.forEach(function(dataUrl, i) {
      var item = document.createElement('div');
      item.className = 'deco-list-item';
      item.innerHTML = '<img src="' + dataUrl + '">' +
        '<span class="dli-info">Gambar ' + (i + 1) + '</span>' +
        '<button class="btn btn-sm btn-danger" data-side="' + side + '" data-idx="' + i + '" style="padding:2px 8px;font-size:10px;">×</button>';
      listEl.appendChild(item);
    });
    countEl.textContent = arr.length + ' / 10';
    addBtn.style.display = arr.length >= 10 ? 'none' : 'block';
  });
}

function handlePasteDeco(side, e) {
  var items = e.clipboardData.items;
  for (var i = 0; i < items.length; i++) {
    if (items[i].type.startsWith('image/')) {
      e.preventDefault();
      var blob = items[i].getAsFile();
      readImageFile(blob, function(dataUrl) {
        addDecoImage(side, dataUrl);
      }, 300, 0.7);
      break;
    }
  }
}

export async function loadBackground() {
  var bg = await idbGet('bgImage');
  if (!bg) {
    var old = await getData('bgImage');
    bg = old.bgImage;
    if (bg) {
      idbSet('bgImage', bg);
      setData({ bgImage: undefined });
    }
  }
  if (!bg) return;
  applyBackground(bg);
}

function applyBackground(dataUrl) {
  var el = document.getElementById('bg-image');
  var preview = document.getElementById('bg-preview');
  var removeBtn = document.getElementById('bg-remove-btn');
  el.style.backgroundImage = 'url(' + dataUrl + ')';
  document.body.classList.add('has-bg');
  if (preview) {
    preview.style.backgroundImage = 'url(' + dataUrl + ')';
    preview.style.display = 'block';
  }
  if (removeBtn) removeBtn.style.display = 'inline-block';
}

function removeBackground() {
  var el = document.getElementById('bg-image');
  var preview = document.getElementById('bg-preview');
  var removeBtn = document.getElementById('bg-remove-btn');
  el.style.backgroundImage = '';
  document.body.classList.remove('has-bg');
  if (preview) {
    preview.style.backgroundImage = '';
    preview.style.display = 'none';
  }
  if (removeBtn) removeBtn.style.display = 'none';
  idbDelete('bgImage');
}

function applyLiveChatBg(dataUrl) {
  var preview = document.getElementById('lc-bg-preview');
  var removeBtn = document.getElementById('lc-bg-remove-btn');
  if (preview) {
    preview.style.backgroundImage = 'url(' + dataUrl + ')';
    preview.style.display = 'block';
  }
  if (removeBtn) removeBtn.style.display = 'inline-block';
  setData({ livechatBgImage: dataUrl });
}

function removeLiveChatBg() {
  var preview = document.getElementById('lc-bg-preview');
  var removeBtn = document.getElementById('lc-bg-remove-btn');
  if (preview) {
    preview.style.backgroundImage = '';
    preview.style.display = 'none';
  }
  if (removeBtn) removeBtn.style.display = 'none';
  setData({ livechatBgImage: '' });
}

export async function loadLiveChatBg() {
  var result = await getData('livechatBgImage');
  if (result.livechatBgImage) applyLiveChatBg(result.livechatBgImage);
}

export async function updateOnlineStats() {
  var dot = $('#onlineDot');
  var num = $('#onlineNum');
  var emailsEl = $('#onlineEmails');
  if (!dot || !num) return;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    dot.className = 'online-dot offline';
    num.textContent = '—';
    return;
  }
  try {
    var cutoff = Date.now() - 4200000;
    var res = await fetch(SUPABASE_URL + '/rest/v1/devices?select=device_id,email&last_ping=gt.' + cutoff, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY
      }
    });
    var rows = await res.json();
    var emails = [...new Set((rows || []).map(function(r) { return r.email; }).filter(Boolean))];
    var online = emails.length;
    dot.className = 'online-dot';
    num.textContent = online;
    if (emailsEl && emails.length) {
      var result = await new Promise(function(r) { chrome.storage.local.get('userEmail', r); });
      var userEmail = result.userEmail;
      emailsEl.innerHTML = emails.map(function(e) {
        var isMe = e === userEmail;
        return '<span style="display:inline-flex;align-items:center;gap:3px;background:' + (isMe ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.04)') + ';padding:2px 10px;border-radius:10px;margin:2px 4px;color:' + (isMe ? '#818cf8' : '#94a3b8') + '">' + (isMe ? '⭐ ' : '▸ ') + e + '</span>';
      }).join('');
    } else if (emailsEl) {
      emailsEl.style.display = 'none';
    }
  } catch (e) {
    dot.className = 'online-dot offline';
    num.textContent = '0';
  }
}

export async function showSessionEmail() {
  var emailEl = $('#sessionEmail');
  var logoutBtn = $('#logoutBtn');
  if (!emailEl) return;
  var result = await new Promise(function(r) { chrome.storage.local.get('userEmail', r); });
  emailEl.textContent = result.userEmail ? '\uD83D\uDCE7 ' + result.userEmail : '';
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async function(e) {
      e.preventDefault();
      var allData = await new Promise(function(r) { chrome.storage.local.get(null, r); });
      var blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'auto-relax-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(url);
      await new Promise(function(r) { chrome.storage.local.remove(['loginSession', 'userEmail'], r); });
      location.reload();
    });
  }
}

export function initDeco() {
  document.getElementById('deco-file-input').addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) return;
    readImageFile(file, function(dataUrl) {
      addDecoImage(decoEditTarget, dataUrl);
    }, 300, 0.7);
    this.value = '';
  });

  document.getElementById('deco-add-left').addEventListener('click', function() {
    decoEditTarget = 'left';
    document.getElementById('deco-file-input').click();
  });
  document.getElementById('deco-add-right').addEventListener('click', function() {
    decoEditTarget = 'right';
    document.getElementById('deco-file-input').click();
  });

  document.getElementById('deco-add-left').addEventListener('paste', function(e) {
    e.preventDefault();
    handlePasteDeco('left', e);
  });
  document.getElementById('deco-add-right').addEventListener('paste', function(e) {
    e.preventDefault();
    handlePasteDeco('right', e);
  });

  ['left', 'right'].forEach(function(side) {
    var btn = document.getElementById('deco-add-' + side);
    btn.addEventListener('dragover', function(e) {
      e.preventDefault();
      this.classList.add('drag-over');
    });
    btn.addEventListener('dragleave', function() {
      this.classList.remove('drag-over');
    });
    btn.addEventListener('drop', function(e) {
      e.preventDefault();
      this.classList.remove('drag-over');
      var file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) {
        readImageFile(file, function(dataUrl) {
          addDecoImage(side, dataUrl);
        }, 300, 0.7);
      }
    });
  });

  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.deco-list-item .btn-danger');
    if (btn) {
      var side = btn.dataset.side;
      var idx = parseInt(btn.dataset.idx, 10);
      removeDecoImage(side, idx);
    }
  });

  document.getElementById('deco-edit-btn').addEventListener('click', function() {
    renderDecoPanel('left');
    renderDecoPanel('right');
    document.getElementById('deco-overlay').style.display = 'flex';
  });

  document.getElementById('deco-close').addEventListener('click', function() {
    document.getElementById('deco-overlay').style.display = 'none';
  });

  document.getElementById('bg-add-btn').addEventListener('click', function() {
    document.getElementById('bg-file-input').click();
  });

  document.getElementById('bg-file-input').addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) return;
    readImageFile(file, function(dataUrl) {
      applyBackground(dataUrl);
      idbSet('bgImage', dataUrl);
    }, 1920, 0.6);
    this.value = '';
  });

  document.getElementById('bg-remove-btn').addEventListener('click', removeBackground);

  document.getElementById('lc-bg-add-btn').addEventListener('click', function() {
    document.getElementById('lc-bg-file-input').click();
  });
  document.getElementById('lc-bg-file-input').addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) return;
    readImageFile(file, function(dataUrl) {
      applyLiveChatBg(dataUrl);
    }, 3840, 0.92);
    this.value = '';
  });
  document.getElementById('lc-bg-remove-btn').addEventListener('click', removeLiveChatBg);
  document.getElementById('lc-bg-url-btn').addEventListener('click', function() {
    var url = document.getElementById('lc-bg-url-input').value.trim();
    if (url) applyLiveChatBg(url);
  });
  document.getElementById('lc-bg-url-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      var url = this.value.trim();
      if (url) applyLiveChatBg(url);
    }
  });
  document.getElementById('lc-bg-add-btn').addEventListener('dragover', function(e) {
    e.preventDefault();
    this.classList.add('drag-over');
  });
  document.getElementById('lc-bg-add-btn').addEventListener('dragleave', function() {
    this.classList.remove('drag-over');
  });
  document.getElementById('lc-bg-add-btn').addEventListener('drop', function(e) {
    e.preventDefault();
    this.classList.remove('drag-over');
    var file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      readImageFile(file, function(dataUrl) {
        applyLiveChatBg(dataUrl);
      }, 3840, 0.92);
    }
  });

  document.getElementById('bg-add-btn').addEventListener('dragover', function(e) {
    e.preventDefault();
    this.classList.add('drag-over');
  });
  document.getElementById('bg-add-btn').addEventListener('dragleave', function() {
    this.classList.remove('drag-over');
  });
  document.getElementById('bg-add-btn').addEventListener('drop', function(e) {
    e.preventDefault();
    this.classList.remove('drag-over');
    var file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      readImageFile(file, function(dataUrl) {
        applyBackground(dataUrl);
        idbSet('bgImage', dataUrl);
      }, 1920, 0.6);
    }
  });

  document.addEventListener('DOMContentLoaded', function() {
    var indicator = document.querySelector('.online-indicator');
    var emailsEl = document.getElementById('onlineEmails');
    if (indicator && emailsEl) {
      indicator.style.cursor = 'pointer';
      indicator.addEventListener('click', function() {
        if (emailsEl.style.display === 'block') {
          emailsEl.style.display = 'none';
        } else {
          emailsEl.style.display = 'block';
        }
      });
    }
  });
}
