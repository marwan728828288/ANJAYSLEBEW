export const $ = s => document.querySelector(s);
export const $$ = s => document.querySelectorAll(s);

export async function getData(keys) {
  return new Promise(r => chrome.storage.local.get(keys, r));
}
export async function setData(obj) {
  return new Promise(r => chrome.storage.local.set(obj, r));
}

var _idb;
function idbOpen() {
  if (_idb) return _idb;
  _idb = new Promise(function(resolve, reject) {
    var req = indexedDB.open('AUTO_RELAX_IMAGES', 1);
    req.onerror = function() { reject(req.error); };
    req.onsuccess = function() { resolve(req.result); };
    req.onupgradeneeded = function() { req.result.createObjectStore('images'); };
  });
  return _idb;
}
export function idbGet(key) {
  return idbOpen().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction('images', 'readonly');
      var req = tx.objectStore('images').get(key);
      req.onerror = function() { reject(req.error); };
      req.onsuccess = function() { resolve(req.result); };
    });
  });
}
export function idbSet(key, value) {
  return idbOpen().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction('images', 'readwrite');
      var req = tx.objectStore('images').put(value, key);
      req.onerror = function() { reject(req.error); };
      req.onsuccess = function() { resolve(); };
    });
  });
}
export function idbDelete(key) {
  return idbOpen().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction('images', 'readwrite');
      var req = tx.objectStore('images').delete(key);
      req.onerror = function() { reject(req.error); };
      req.onsuccess = function() { resolve(); };
    });
  });
}
export function idbClear() {
  return idbOpen().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction('images', 'readwrite');
      var req = tx.objectStore('images').clear();
      req.onerror = function() { reject(req.error); };
      req.onsuccess = function() { resolve(); };
    });
  });
}

export function showToast(msg, isError) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  t.classList.add('show');
  clearTimeout(t._hide);
  t._hide = setTimeout(() => t.classList.remove('show'), 3000);
}

export function v(val) {
  if (val && val !== '' && val !== null && val !== undefined) {
    return String(val).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  return '-';
}

export const state = {
  perPage: 10,
  currentPage: 1,
  searchText: '',
  statusFilter: '',
  bonusProcessing: false,
  cekbetProcessing: false,
  processingRows: {},
  isDualMode: false
};

export function parseUser(raw) {
  let s = (raw || '').trim();
  let tsMatch = s.match(/\s+(ts\s*.*)$/i);
  let tsPart = tsMatch ? tsMatch[1] : '';
  s = s.replace(/\s+ts\s*.*/i, '').replace(/\s+/g, '').trim();
  return { user: s, hasTS: !!tsMatch };
}

export function cleanKode(raw) {
  return (raw || '').replace(/[^a-zA-Z0-9]/g, '').trim();
}

export function validPanjangKode(kode) {
  return kode.length >= 19;
}

export function renderPagination(total) {
  var totalPages = Math.max(1, Math.ceil(total / state.perPage));
  if (state.currentPage > totalPages) state.currentPage = totalPages;
  var start = (state.currentPage - 1) * state.perPage + 1;
  var end = Math.min(state.currentPage * state.perPage, total);
  $('#page-info').textContent = total > 0 ? start + '-' + end + ' dari ' + total : '';
  var nav = $('#page-nav');
  var html = '';
  html += '<button class="page-btn" data-page="' + (state.currentPage - 1) + '"' + (state.currentPage <= 1 ? ' disabled' : '') + '>&laquo;</button>';
  var maxShow = 5;
  var from = Math.max(1, state.currentPage - Math.floor(maxShow / 2));
  var to = Math.min(totalPages, from + maxShow - 1);
  if (to - from < maxShow - 1) from = Math.max(1, to - maxShow + 1);
  for (var p = from; p <= to; p++) {
    html += '<button class="page-btn' + (p === state.currentPage ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>';
  }
  html += '<button class="page-btn" data-page="' + (state.currentPage + 1) + '"' + (state.currentPage >= totalPages ? ' disabled' : '') + '>&raquo;</button>';
  nav.innerHTML = html;
}

export function calcHadiah(bettingRaw, payoutRaw) {
  var bet = parseFloat(String(bettingRaw).replace(/[^0-9]/g, '')) || 0;
  var scat = parseInt(String(payoutRaw).replace(/[^0-9]/g, '')) || 0;
  if (scat === 3) {
    if (bet >= 20000) return 100000;
    if (bet >= 10000) return 50000;
    if (bet >= 4000) return 35000;
    if (bet >= 1600) return 15000;
    return 0;
  }
  if (scat === 4) {
    if (bet >= 20000) return 200000;
    if (bet >= 10000) return 100000;
    if (bet >= 4000) return 70000;
    if (bet >= 1600) return 30000;
    return 0;
  }
  if (scat === 5) {
    if (bet >= 20000) return 400000;
    if (bet >= 10000) return 200000;
    if (bet >= 4000) return 140000;
    if (bet >= 1600) return 75000;
    return 0;
  }
  return 0;
}

export function fmtHadiah(n) {
  return n ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '-';
}

export function escapeHtml(str) {
  if (!str) return '-';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function resetCekBet(row) {
  var wasPreserved = row.manualStatus === 'Ticket Not Found' || row.manualStatus === 'Session Timeout';
  row.autoStatus = '';
  row.autoCol9 = '';
  if (!wasPreserved) row.autoCol10 = '';
  if (!wasPreserved) row.manualStatus = '';
  row.betting = '';
  row.payout = '';
  row.totalFreeSpin = '';
  row.transactionId = '';
  row.profit = '';
  row.balance = '';
  row.spinType = '';
  row.symbols = [];
  row.payoutDetail = [];
  row.freeSpinDetail = [];
  row.updatedAt = Date.now();
}

export function resetBonus(row) {
  row.secureStatus = '';
  row.updatedAt = Date.now();
}

export function uncheckAll() {
  $('#select-all').checked = false;
  document.querySelectorAll('.bulk-cb').forEach(function(cb) { cb.checked = false; });
  updateBulkInfo();
}

export function getSelectedIds() {
  return Array.from(document.querySelectorAll('.bulk-cb:checked')).map(function(cb) { return parseInt(cb.value); });
}

export function updateBulkInfo() {
  const ids = getSelectedIds();
  $('#bulk-info').textContent = ids.length ? ids.length + ' terpilih' : '';
}

export function generatePassword() {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const all = upper + lower + digits;
  let pw = '';
  pw += upper[Math.floor(Math.random() * upper.length)];
  pw += lower[Math.floor(Math.random() * lower.length)];
  pw += digits[Math.floor(Math.random() * digits.length)];
  for (let i = 3; i < 8; i++) pw += all[Math.floor(Math.random() * all.length)];
  return pw.split('').sort(function() { return Math.random() - 0.5; }).join('');
}

export function csvEscape(val) {
  var s = String(val || '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function readImageFile(file, callback, maxWidth, quality) {
  var reader = new FileReader();
  reader.onload = function(e) {
    if (/\.gif$/i.test(file.name) || file.type === 'image/gif') {
      callback(e.target.result);
      return;
    }
    var img = new Image();
    img.onload = function() {
      var w = img.width, h = img.height;
      if (maxWidth && w > maxWidth) { h = h * maxWidth / w; w = maxWidth; }
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      callback(c.toDataURL('image/jpeg', quality || 0.7));
    };
    img.onerror = function() { callback(e.target.result); };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
