import {
  $, $$, getData, setData, showToast, state, v, escapeHtml,
  parseUser, cleanKode, validPanjangKode, renderPagination,
  calcHadiah, fmtHadiah, resetCekBet, resetBonus,
  uncheckAll, getSelectedIds, updateBulkInfo,
  generatePassword, csvEscape
} from './shared.js';
import { renderLogs } from './logs.js';
import { autoStartTyping } from './typing.js';

export async function renderData() {
  const { rows = [] } = await getData('rows');
  const tbody = $('#data-table-body');
  const checkedIds = Array.from(document.querySelectorAll('.bulk-cb:checked')).map(function(cb) {
    return parseInt(cb.value);
  });
  const selectAllWas = $('#select-all').checked;
  updateStats(rows);
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty"><p>Belum ada data. Isi User ID &amp; Kode Tiket di atas</p></td></tr>';
    renderPagination(0);
    return;
  }
  var filtered = rows;
  if (state.searchText) {
    var q = state.searchText.toLowerCase();
    filtered = rows.filter(function(r) {
      return (r.user && r.user.toLowerCase().includes(q)) || ((r.kodeTiket || r.kode) && (r.kodeTiket || r.kode).toLowerCase().includes(q)) || (r.transactionId && r.transactionId.toLowerCase().includes(q));
    });
  }
  if (state.statusFilter) {
    filtered = filtered.filter(function(r) {
      if (state.statusFilter === 'APPROVED') return r.autoStatus === 'APPROVED';
      if (state.statusFilter === 'REJECTED') return r.autoStatus === 'REJECTED';
      if (state.statusFilter === 'PENDING') return !r.autoStatus;
      if (state.statusFilter === 'NOTFOUND') return r.manualStatus === 'Ticket Not Found' || r.manualStatus === 'Session Timeout' || r.autoCol10 === 'Tidak Ditemukan Scatter' || r.autoCol10 === 'Scatter Not Found';
      return true;
    });
  }
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty"><p>Tidak ada hasil untuk "' + state.searchText + '"</p></td></tr>';
    renderPagination(0);
    return;
  }
  var sorted = filtered.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  var total = sorted.length;
  renderPagination(total);
  var start = (state.currentPage - 1) * state.perPage;
  var pageRows = sorted.slice(start, start + state.perPage);
  tbody.innerHTML = pageRows.map(function(r, i) {
    var idx = start + i + 1;
    var isMaxClaim = r.secureStatus && r.secureStatus.includes('User ID ini sudah mencapai maksimal klaim 2 kali untuk Livechat');
    var autoBadge = isMaxClaim ? '-' : !r.autoStatus ? '<span class="badge badge-muted">Antri</span>' : r.autoStatus === 'APPROVED' ? '<span class="badge badge-success">Approve</span>' : r.autoStatus === 'REJECTED' ? '<span class="badge badge-danger">Reject</span>' : '<span class="badge badge-warning">' + escapeHtml(r.autoStatus) + '</span>';
    var secBadge = !r.secureStatus ? '-' : r.secureStatus === 'PROCESSING' ? '<span class="badge badge-info">Proses</span>' : r.secureStatus.includes('Error') ? '<span class="badge badge-danger">Error</span>' : r.secureStatus.toLowerCase().includes('terganggu') ? '<span class="badge badge-danger">' + escapeHtml(r.secureStatus) + '</span>' : r.secureStatus.toLowerCase().includes('berhasil') ? '<span class="badge badge-success">' + escapeHtml(r.secureStatus) + '</span>' : '<span class="badge badge-warning">' + escapeHtml(r.secureStatus) + '</span>';
    var rowClass = '';
    if (r.manualStatus === 'Ticket Not Found' || r.manualStatus === 'Session Timeout' || r.autoCol10 === 'Tidak Ditemukan Scatter' || r.autoCol10 === 'Scatter Not Found') {
      rowClass = 'class="row-notfound"';
    } else if (r.autoStatus === 'APPROVED') {
      rowClass = 'class="row-approved"';
    }
    return '<tr id="row-' + r.id + '" ' + rowClass + '>' +
      '<td><div class="cb-wrap"><span class="row-num" style="font-size:9px;">' + (r.createdAt ? new Date(r.createdAt).toLocaleString('en-GB', { day:'2-digit', month:'short' }).replace(',','') + ' (' + new Date(r.createdAt).toLocaleTimeString('en-GB') + ')' : '-') + '</span><input type="checkbox" class="bulk-cb" value="' + r.id + '"></div></td>' +
      '<td>' + v(r.user) + (r.hasTS ? ' <span class="badge badge-info">TS</span>' : '') + '</td>' +
      '<td>' + v(r.kodeTiket || r.kode) + '</td>' +
      '<td><span style="color:#86efac">' + v(r.betting) + '</span></td>' +
      '<td>' + v(r.payout) + '</td>' +
      '<td style="color:#fbbf24;font-weight:600;">' + fmtHadiah(calcHadiah(r.betting, r.payout)) + '</td>' +
      '<td>' + autoBadge + '</td>' +
      '<td style="font-size:12px;color:#94a3b8;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(r.autoCol10) + '">' + v(r.autoCol10) + '</td>' +
      '<td title="' + escapeHtml(r.secureStatus || '') + '">' + secBadge + '</td>' +
      '<td class="actions">' +
      '<button class="btn btn-sm btn-warning btn-retry-cekbet" data-id="' + r.id + '">Cek Ulang</button>' +
      '<button class="btn btn-sm btn-success btn-retry-bonus" data-id="' + r.id + '">Input Bonus</button>' +
      '<button class="btn btn-sm btn-secondary btn-edit" data-id="' + r.id + '">Edit</button>' +
      '<button class="btn btn-sm btn-danger btn-delete" data-id="' + r.id + '">X</button>' +
      '</td></tr>';
  }).join('');
  checkedIds.forEach(function(id) {
    var cb = document.querySelector('.bulk-cb[value="' + id + '"]');
    if (cb) cb.checked = true;
  });
  $('#select-all').checked = selectAllWas;
  updateBulkInfo();
}

async function updateStats(rows) {
  var total = rows.length;
  var approved = rows.filter(function(r) { return r.autoStatus === 'APPROVED'; }).length;
  var rejected = rows.filter(function(r) { return r.autoStatus === 'REJECTED'; }).length;
  var pending = rows.filter(function(r) { return !r.autoStatus && r.autoCol10 !== 'Tidak Ditemukan Scatter' && r.autoCol10 !== 'Scatter Not Found' && r.autoCol10 !== 'Ticket Not Found' && r.autoCol10 !== 'Session Timeout'; }).length;
  var notfound = rows.filter(function(r) { return r.manualStatus === 'Ticket Not Found' || r.manualStatus === 'Session Timeout' || r.autoCol10 === 'Tidak Ditemukan Scatter' || r.autoCol10 === 'Scatter Not Found'; }).length;
  $('#stat-total').textContent = total;
  $('#stat-approved').textContent = approved;
  $('#stat-rejected').textContent = rejected;
  $('#stat-pending').textContent = pending;
  $('#stat-notfound').textContent = notfound;

  var warn = $('#stat-warn');
  if (warn) {
    if (rejected > 0 || notfound > 0) {
      warn.style.display = '';
      warn.innerHTML = '&#9888;';
      warn.title = rejected + ' Reject, ' + notfound + ' Not Found';
      warn.style.animation = 'blinkGreen 1.5s ease-in-out infinite';
    } else {
      warn.style.display = 'none';
      warn.style.animation = '';
    }
  }

  var rEl = $('#stat-rejected').closest('.stat-filter');
  var nEl = $('#stat-notfound').closest('.stat-filter');
  if (rEl) rEl.classList.toggle('stat-blink', rejected > 0);
  if (nEl) nEl.classList.toggle('stat-blink', notfound > 0);

  highlightActiveFilter();
}

function highlightActiveFilter() {
  document.querySelectorAll('.stat-filter').forEach(function(el) {
    var active = state.statusFilter === el.dataset.filter;
    el.style.fontWeight = active ? '700' : 'normal';
    el.style.borderBottom = active ? '2px solid currentColor' : '2px solid transparent';
    el.style.paddingBottom = active ? '2px' : '0';
  });
}

async function retryCekBet(id) {
  if (state.processingRows[id]) return;
  state.processingRows[id] = true;
  try {
    const { rows = [] } = await getData('rows');
    const row = rows.find(r => r.id === id);
    if (!row) return;
    resetCekBet(row);
    row.manualStatus = '';
    row.autoCol10 = '';
    row.autoRetryCount = 0;
    await setData({ rows });
    chrome.runtime.sendMessage({ type: "FORCE_RECHECK", priorityIds: [id] });
    showToast('Cek Ulang baris #' + id);
    renderData();
    uncheckAll();
  } finally {
    delete state.processingRows[id];
  }
}

async function retryBonus(id) {
  if (state.processingRows[id]) return;
  state.processingRows[id] = true;
  try {
    const { rows = [] } = await getData('rows');
    const row = rows.find(r => r.id === id);
    if (!row) return;
    resetBonus(row);
    await setData({ rows });
    chrome.runtime.sendMessage({ type: "TRIGGER_SECURE_ROW", rowId: id });
    showToast('Bonus baris #' + id + ' — diproses');
    renderData();
    uncheckAll();
  } finally {
    delete state.processingRows[id];
  }
}

async function quickAddRow(userRaw, kodeRaw, statusEl) {
  const kodeTiket = cleanKode(kodeRaw);
  if (!kodeTiket) {
    showToast('Kode Tiket wajib diisi', true);
    return false;
  }
  if (!validPanjangKode(kodeTiket)) {
    showToast('Kode Tiket minimal 19 karakter!', true);
    return false;
  }
  const parsed = parseUser(userRaw);
  const result = await getData(['rows', 'nextRowId']);
  let rows = result.rows || [];
  const existing = rows.find(function(r) { return (r.kodeTiket || r.kode) === kodeTiket; });
  if (existing) {
    if (statusEl) {
      statusEl.textContent = 'Kode SUDAH ADA di baris #' + existing.id;
      statusEl.className = 'dup';
    }
    showToast('Kode Tiket sudah ada (baris #' + existing.id + ')!', true);
    return false;
  }
  let nextRowId = result.nextRowId || 1;
  rows.push({
    id: nextRowId,
    user: parsed.user,
    kodeTiket: kodeTiket,
    hasTS: parsed.hasTS,
    autoStatus: '',
    autoCol9: '',
    autoCol10: '',
    manualStatus: '',
    betting: '',
    payout: '',
    totalFreeSpin: '',
    transactionId: '',
    profit: '',
    balance: '',
    spinType: '',
    symbols: [],
    payoutDetail: [],
    freeSpinDetail: [],
    secureStatus: '',
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  await setData({ rows: rows, nextRowId: nextRowId + 1 });
  showToast('Baris #' + nextRowId + ' ditambahkan');
  renderData();
  chrome.runtime.sendMessage({ type: "TRIGGER_MANUAL", priorityIds: [nextRowId] });
  return true;
}

async function quickAddDual(userRaw, kodeRaw1, kodeRaw2, statusEl) {
  const kode1 = cleanKode(kodeRaw1);
  const kode2 = cleanKode(kodeRaw2);
  const parsed = parseUser(userRaw);
  if (!parsed.user) {
    showToast('User ID wajib diisi', true);
    return false;
  }
  if (!kode1 && !kode2) {
    showToast('Isi minimal 1 Kode Tiket', true);
    return false;
  }
  const result = await getData(['rows', 'nextRowId']);
  let rows = result.rows || [];
  let nextRowId = result.nextRowId || 1;
  const base = {
    user: parsed.user,
    hasTS: parsed.hasTS,
    autoStatus: '',
    autoCol9: '',
    autoCol10: '',
    manualStatus: '',
    betting: '',
    payout: '',
    totalFreeSpin: '',
    transactionId: '',
    profit: '',
    balance: '',
    spinType: '',
    symbols: [],
    payoutDetail: [],
    freeSpinDetail: [],
    secureStatus: '',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  var added = 0;
  var prioIds = [];
  var errors = [];
  function tryAdd(kode, label) {
    if (!kode) return;
    if (!validPanjangKode(kode)) { errors.push(label + ' < 19 karakter'); return; }
    var exist = rows.find(function(r) { return (r.kodeTiket || r.kode) === kode; });
    if (exist) { errors.push(label + ' sudah ada (#' + exist.id + ')'); return; }
    var row = { id: nextRowId, kodeTiket: kode, ...base };
    nextRowId++;
    rows.push(row);
    prioIds.push(row.id);
    added++;
  }
  tryAdd(kode1, 'Kode 1');
  tryAdd(kode2, 'Kode 2');
  if (added === 0) {
    showToast(errors.join('; '), true);
    return false;
  }
  await setData({ rows: rows, nextRowId: nextRowId });
  var msg = added + ' baris ditambahkan';
  if (errors.length) msg += ' (' + errors.join(', ') + ')';
  showToast(msg);
  if (statusEl && errors.length) {
    statusEl.textContent = errors.join('; ');
    statusEl.className = 'dup';
  }
  renderData();
  chrome.runtime.sendMessage({ type: "TRIGGER_MANUAL", priorityIds: prioIds });
  return true;
}

function initQuickAdd() {
  const userIn = $('#qa-user');
  const kodeIn = $('#qa-kode');
  const kode2In = $('#qa-kode-2');
  const status = $('#qa-status');
  let adding = false;

  function doAdd() {
    if (adding) return;
    const u = userIn.value;
    const k = kodeIn.value;
    if (!u.trim()) return;
    if (state.isDualMode) {
      const k2 = kode2In ? kode2In.value : '';
      if (!k.trim() || !k2.trim()) return;
      if (!validPanjangKode(cleanKode(k)) || !validPanjangKode(cleanKode(k2))) return;
      adding = true;
      status.textContent = 'Menambah...';
      status.className = '';
      quickAddDual(u, k, k2, status).then(function(ok) {
          if (ok) {
            userIn.value = '';
            kodeIn.value = '';
            if (kode2In) kode2In.value = '';
            status.textContent = '';
            state.isDualMode = false;
            $('#btn-2x').classList.remove('active');
            var wrap = document.getElementById('kode-2-wrap');
            if (wrap) wrap.style.display = 'none';
            clearScanUI();
            setData({ formState: { user: '', kode: '', kode2: '', dualMode: false } });
          }
        adding = false;
      });
    } else {
      if (!cleanKode(k)) return;
      adding = true;
      status.textContent = 'Menambah...';
      status.className = '';
      quickAddRow(u, k, status).then(function(ok) {
        if (ok) {
          userIn.value = '';
          kodeIn.value = '';
          status.textContent = '';
          clearScanUI();
          setData({ formState: { user: '', kode: '', kode2: '', dualMode: false } });
        } else if (status.textContent === 'Menambah...') status.textContent = '';
        adding = false;
      });
    }
  }

  function onInput() {
    if (status.textContent && status.textContent !== 'Menambah...' && !status.textContent.startsWith('Menambah 2')) {
      status.textContent = '';
      status.className = '';
    }
    doAdd();
  }
  userIn.addEventListener('input', onInput);
  kodeIn.addEventListener('input', onInput);
  if (kode2In) kode2In.addEventListener('input', onInput);
}

function initPasswordGen() {
  const userInput = $('#gen-user');
  const resultDiv = $('#gen-result');
  let copiedTimeout = null;

  function buildHtml(userId, password) {
    return '<div class="pw-line"><span class="pw-label">User ID :</span><span class="pw-value">' + escapeHtml(userId) + '</span></div>' +
      '<div class="pw-line"><span class="pw-label">Password :</span><span class="pw-value" id="pw-display">' + escapeHtml(password) + '</span>' +
      '<button class="pw-copy-btn" id="pw-copy-btn">Salin Sandi</button></div>' +
      '<div class="pw-message">Silahkan dicoba login dan segera diganti passwordnya ya bosku</div>' +
      '<button class="pw-copy-btn" id="pw-copy-all" style="margin-top:8px;background:linear-gradient(135deg,#a78bfa,#7c3aed);">Salin Data</button>';
  }

  function showPassword(userId) {
    const password = generatePassword();
    resultDiv.innerHTML = buildHtml(userId, password);
    resultDiv.style.display = 'block';

    function copyText(text, btn) {
      if (copiedTimeout) clearTimeout(copiedTimeout);
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      btn.textContent = 'Tersalin!';
      btn.classList.add('copied');
      copiedTimeout = setTimeout(function() {
        btn.textContent = btn === copyBtn ? 'Salin Sandi' : 'Salin Data';
        btn.classList.remove('copied');
      }, 2000);
    }
    var copyBtn = $('#pw-copy-btn');
    if (copyBtn) copyBtn.addEventListener('click', function() { copyText(password, copyBtn); });
    var copyAll = $('#pw-copy-all');
    if (copyAll) {
      var fullText = 'User ID : ' + userId + '\nPassword : ' + password + '\n\nSilahkan dicoba login dan segera diganti passwordnya ya bosku';
      copyAll.addEventListener('click', function() { copyText(fullText, copyAll); });
    }
  }
  userInput.addEventListener('input', function() {
    const val = userInput.value.trim();

    var userIn = $('#qa-user');
    if (userIn && userIn.value.trim()) {
      userIn.value = '';
      userIn.dispatchEvent(new Event('input', { bubbles: true }));
    }

    if (val) showPassword(val);
    else resultDiv.style.display = 'none';
  });
}

function initNote() {
  var note = $('#qa-note');
  if (!note) return;
  getData('quickNote').then(function(result) {
    if (result.quickNote) note.value = result.quickNote;
  });
  var saveTimer = null;
  note.addEventListener('input', function() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function() { setData({ quickNote: note.value }); }, 500);
  });
}

export function initData() {
  initQuickAdd();
  initPasswordGen();
  initNote();

  $('#select-all').addEventListener('change', function() {
    const checked = this.checked;
    document.querySelectorAll('.bulk-cb').forEach(function(cb) { cb.checked = checked; });
    updateBulkInfo();
  });

  document.addEventListener('change', function(e) {
    if (e.target.classList.contains('bulk-cb')) updateBulkInfo();
  });

  document.addEventListener('click', async function(e) {
    if (e.target.classList.contains('btn-delete')) {
      const id = parseInt(e.target.dataset.id);
      if (!confirm('Hapus baris #' + id + '?')) return;
      let { rows = [] } = await getData('rows');
      rows = rows.filter(function(r) { return r.id !== id; });
      await setData({ rows });
      showToast('Baris #' + id + ' dihapus');
      renderData();
    }
    if (e.target.classList.contains('btn-retry-cekbet')) {
      retryCekBet(parseInt(e.target.dataset.id));
    }
    if (e.target.classList.contains('btn-retry-bonus')) {
      retryBonus(parseInt(e.target.dataset.id));
    }
    if (e.target.classList.contains('btn-edit')) {
      const id = parseInt(e.target.dataset.id);
      const { rows = [] } = await getData('rows');
      const row = rows.find(function(r) { return r.id === id; });
      if (!row) return;
      const newUser = prompt('User ID (tambah "TS" untuk tanggal mundur 1 hari):', row.user + (row.hasTS ? ' TS' : '') || '');
      if (newUser === null) return;
      const newKode = prompt('Kode Tiket:', row.kodeTiket || row.kode || '');
      if (newKode === null) return;
      const cleanedKode = cleanKode(newKode);
      if (!validPanjangKode(cleanedKode)) {
        showToast('Kode Tiket minimal 19 karakter!', true);
        return;
      }
      const parsed = parseUser(newUser);
      row.user = parsed.user;
      row.hasTS = parsed.hasTS;
      row.kodeTiket = cleanKode(newKode);
      resetCekBet(row);
      resetBonus(row);
      row.manualStatus = '';
      row.autoCol10 = '';
      row.autoRetryCount = 0;
      await setData({ rows: rows });
      showToast('Baris #' + id + ' diupdate — diproses');
      renderData();
      chrome.runtime.sendMessage({ type: "FORCE_RECHECK", priorityIds: [id] });
    }
  });

  $('#btn-2x').addEventListener('click', function() {
    state.isDualMode = !state.isDualMode;
    this.classList.toggle('active', state.isDualMode);
    var wrap = document.getElementById('kode-2-wrap');
    if (wrap) wrap.style.display = state.isDualMode ? 'block' : 'none';
    if (!state.isDualMode) {
      var k2 = $('#qa-kode-2');
      if (k2) {
        k2.value = '';
        var u = $('#qa-user'), k = $('#qa-kode'), s = $('#qa-status');
        if (u && k && u.value.trim() && k.value.trim()) quickAddRow(u.value, k.value, s);
      }
    }
    $('#qa-status').textContent = state.isDualMode ? 'Mode 2x aktif' : '';
    $('#qa-status').className = state.isDualMode ? '' : '';
  });

  $('#btn-submit-note').addEventListener('click', async function() {
    const note = $('#qa-note').value.trim();
    if (!note) { showToast('Note kosong', true); return; }
    this.disabled = true;
    try {
      const lines = note.split('\n').map(l => l.trim()).filter(Boolean);
      const result = await getData(['rows', 'nextRowId']);
      let rows = result.rows || [];
      let nextRowId = result.nextRowId || 1;
      const existing = new Set(rows.map(r => r.kodeTiket || r.kode));
      let added = 0, skipped = 0, tooShort = 0, failed = [];
      for (const line of lines) {
        let userRaw, kodeRaw;
        if (line.includes(',')) {
          const idx = line.indexOf(',');
          userRaw = line.substring(0, idx).trim();
          kodeRaw = line.substring(idx + 1).trim();
        } else {
          const words = line.split(/\s+/);
          kodeRaw = words.pop();
          userRaw = words.join(' ');
        }
        kodeRaw = cleanKode(kodeRaw);
        if (!userRaw || !kodeRaw) { failed.push(line); continue; }
        if (!validPanjangKode(kodeRaw)) { tooShort++; failed.push(line); continue; }
        if (existing.has(kodeRaw)) { skipped++; continue; }
        const parsed = parseUser(userRaw);
        rows.push({
          id: nextRowId++,
          user: parsed.user,
          kodeTiket: kodeRaw,
          hasTS: parsed.hasTS,
          autoStatus: '',
          autoCol9: '',
          autoCol10: '',
          manualStatus: '',
          betting: '',
          payout: '',
          totalFreeSpin: '',
          transactionId: '',
          profit: '',
          balance: '',
          spinType: '',
          symbols: [],
          payoutDetail: [],
          freeSpinDetail: [],
          secureStatus: '',
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
        existing.add(kodeRaw);
        added++;
      }
      if (added === 0) { showToast('Tidak ada data baru', true); return; }
      const newIds = [];
      for (let i = 0; i < added; i++) newIds.push(result.nextRowId + i);
      await setData({ rows, nextRowId });
      $('#qa-note').value = '';
      setData({ quickNote: '' });
      let summary = added + ' ditambahkan';
      if (skipped) summary += ', ' + skipped + ' duplikat';
      if (tooShort) summary += ', ' + tooShort + ' < 19 karakter';
      showToast(summary);
      renderData();
      chrome.runtime.sendMessage({ type: "TRIGGER_MANUAL", priorityIds: newIds });
    } finally {
      this.disabled = false;
    }
  });

  $('#btn-cekbet-selected').addEventListener('click', async function() {
    if (state.cekbetProcessing) return;
    const ids = getSelectedIds();
    if (!ids.length) { showToast('Pilih baris terlebih dahulu', true); return; }
    state.cekbetProcessing = true;
    this.disabled = true;
    try {
      const { rows = [] } = await getData('rows');
      for (const row of rows) {
        if (ids.includes(row.id)) {
          resetCekBet(row);
          row.manualStatus = '';
          row.autoCol10 = '';
          row.autoRetryCount = 0;
        }
      }
      await setData({ rows });
      chrome.runtime.sendMessage({ type: "FORCE_RECHECK", priorityIds: ids });
      showToast('Cek Ulang ' + ids.length + ' baris');
      renderData();
      uncheckAll();
    } finally {
      state.cekbetProcessing = false;
      this.disabled = false;
    }
  });

  $('#btn-bonus-selected').addEventListener('click', async function() {
    if (state.bonusProcessing) return;
    const ids = getSelectedIds();
    if (!ids.length) { showToast('Pilih baris terlebih dahulu', true); return; }
    state.bonusProcessing = true;
    this.disabled = true;
    try {
      const { rows = [] } = await getData('rows');
      for (const row of rows) {
        if (ids.includes(row.id)) resetBonus(row);
      }
      await setData({ rows });
      chrome.runtime.sendMessage({ type: "TRIGGER_SECURE" });
      showToast('Bonus ' + ids.length + ' baris — diproses');
      renderData();
      uncheckAll();
    } finally {
      state.bonusProcessing = false;
      this.disabled = false;
    }
  });

  $('#btn-delete-selected').addEventListener('click', async function() {
    const ids = getSelectedIds();
    if (!ids.length) { showToast('Pilih baris terlebih dahulu', true); return; }
    if (!confirm('Hapus ' + ids.length + ' baris terpilih?')) return;
    let { rows = [] } = await getData('rows');
    rows = rows.filter(function(r) { return !ids.includes(r.id); });
    await setData({ rows });
    showToast(ids.length + ' baris dihapus');
    renderData();
  });

  $('#search-input').addEventListener('input', function() {
    state.searchText = this.value;
    state.currentPage = 1;
    renderData();
  });

  $('#filter-status').addEventListener('change', function() {
    state.statusFilter = this.value;
    state.currentPage = 1;
    renderData();
  });

  document.addEventListener('click', function(e) {
    var stat = e.target.closest('.stat-filter');
    if (!stat) return;
    var filter = stat.dataset.filter;
    if (state.statusFilter === filter) {
      state.statusFilter = '';
    } else {
      state.statusFilter = filter;
    }
    var sel = $('#filter-status');
    if (sel) sel.value = state.statusFilter;
    state.currentPage = 1;
    renderData();
  });

  $('#btn-export').addEventListener('click', async function() {
    const data = await getData(null);
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'auto-relax-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Data diexport');
  });

  $('#btn-import').addEventListener('click', function() {
    $('#import-file-input').click();
  });

  $('#import-file-input').addEventListener('change', async function(e) {
    var file = e.target.files[0];
    if (!file) return;
    try {
      var text = await file.text();
      var data = JSON.parse(text);
      if (typeof data !== 'object' || data === null) throw new Error('Invalid');
      if (data.rows && Array.isArray(data.rows)) {
        var existing = await getData('rows');
        var existMap = {};
        for (var i = 0; i < existing.length; i++) existMap[existing[i].id] = i;
        for (var j = 0; j < data.rows.length; j++) {
          var r = data.rows[j];
          if (existMap[r.id] !== undefined) {
            existing[existMap[r.id]] = r;
          } else {
            existing.push(r);
          }
        }
        data.rows = existing;
      }
      await setData(data);
      renderData();
      showToast('Data berhasil diimport');
    } catch (err) {
      showToast('File JSON tidak valid', true);
    }
    this.value = '';
  });

  $('#btn-csv').addEventListener('click', async function() {
    const { rows = [] } = await getData('rows');
    if (!rows.length) { showToast('Tidak ada data', true); return; }
    var headers = ['User ID', 'Kode Tiket', 'Betting', 'SCATTER', 'HADIAH', 'Status', 'Keterangan', 'Transaction ID'];
    var csv = headers.map(csvEscape).join(',');
    rows.forEach(function(r) {
      var status = r.autoStatus === 'APPROVED' ? 'Approve' : r.autoStatus === 'REJECTED' ? 'Reject' : r.autoCol10 === 'Tidak Ditemukan Scatter' ? 'Scatter Not Found' : r.autoCol10 === 'Scatter Not Found' ? 'Scatter Not Found' : r.manualStatus === 'Session Timeout' ? 'Session Timeout' : r.manualStatus === 'Ticket Not Found' ? 'Ticket Not Found' : 'Pending';
      var line = [r.user, r.kodeTiket || r.kode, r.betting, r.payout, fmtHadiah(calcHadiah(r.betting, r.payout)), status, r.autoCol10, r.transactionId];
      csv += '\n' + line.map(csvEscape).join(',');
    });
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'auto-relax-data-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast('CSV diexport');
  });

  $('#btn-delete-all').addEventListener('click', async function() {
    if (!confirm('Hapus SEMUA data termasuk rows & logs? Ini tidak bisa dibatalkan!')) return;
    if (!confirm('Yakin? Semua data akan hilang permanen.')) return;
    await setData({ rows: [], logs: [], nextRowId: 1 });
    renderData();
    showToast('Semua data dihapus');
  });

  $('#per-page').addEventListener('change', function() {
    state.perPage = parseInt(this.value);
    state.currentPage = 1;
    renderData();
  });

  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.page-btn');
    if (!btn || btn.disabled) return;
    var p = parseInt(btn.dataset.page);
    if (!isNaN(p) && p >= 1) state.currentPage = p;
    renderData();
  });
}

export function initTabSwitching() {
  var saved = localStorage.getItem('activeTab') || 'data';
  var savedBtn = document.querySelector('.tab-btn[data-tab="' + saved + '"]');
  if (savedBtn) {
    $$('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
    $$('.tab-pane').forEach(function(p) { p.classList.remove('active'); });
    savedBtn.classList.add('active');
    var pane = $('#pane-' + saved);
    if (pane) pane.classList.add('active');
  }

  document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      var tabs = Array.from(document.querySelectorAll('.tab-btn'));
      var current = document.querySelector('.tab-btn.active');
      var idx = tabs.indexOf(current);
      var next = tabs[(idx + 1) % tabs.length];
      next.click();
    }
  });

  $$('.tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      $$('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
      $$('.tab-pane').forEach(function(p) { p.classList.remove('active'); });
      this.classList.add('active');
      const pane = $('#pane-' + this.dataset.tab);
      if (pane) pane.classList.add('active');
      localStorage.setItem('activeTab', this.dataset.tab);
      if (this.dataset.tab === 'data') renderData();
      if (this.dataset.tab === 'logs') renderLogs();
      if (this.dataset.tab === 'typing') autoStartTyping();
    });
  });
}

function clearScanUI() {
  chrome.storage.local.remove('scanResult');
  var su = document.getElementById('scan-url');
  var su2 = document.getElementById('scan-url-2');
  var ss = document.getElementById('scan-status');
  var pw = document.getElementById('scan-preview-wrap');
  var pb1 = document.getElementById('scan-preview-box-1');
  var pb2 = document.getElementById('scan-preview-box-2');
  if (su) { su.value = ''; }
  if (su2) { su2.value = ''; }
  if (ss) { ss.textContent = ''; ss.className = ''; }
  if (pw) { pw.style.display = 'none'; }
  if (pb1) { pb1.style.display = 'none'; }
  if (pb2) { pb2.style.display = 'none'; }
  chrome.storage.local.set({ scanUrlPersist: '', scanUrl2Persist: '' });
}
