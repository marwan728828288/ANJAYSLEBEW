import initAuth from '../modules/auth.js';
import { initData, initTabSwitching, renderData } from '../modules/data.js';
import { renderLogs, initLogs } from '../modules/logs.js';
import { initDeco, loadDecoImages, loadBackground, loadLiveChatBg, updateOnlineStats, showSessionEmail } from '../modules/deco.js';
import { initPrediksi } from '../modules/prediksi.js';
import { initPanduan } from '../modules/panduan.js';
import { initAIChat } from '../modules/ai-chat.js';
import { initParlay } from '../modules/parlay.js';
import { initHadiah } from '../modules/hadiah.js';
import { initJadwal } from '../modules/jadwal.js';
import { initMemo } from '../modules/memo.js';
import { initTyping } from '../modules/typing.js';
import { $, $$, getData, setData, showToast, escapeHtml } from '../modules/shared.js';
import { APP_VERSION } from '../config.js';
import { initOcrEngine, VARIANTS } from '../modules/ocr-engine.js';
initAuth();
initData();
initLogs();
initDeco();
initPrediksi();
initParlay();
initHadiah();
initJadwal();
initPanduan();
if (typeof window.initGeneratorBola === 'function') window.initGeneratorBola();
initAIChat();
initMemo();
initTyping();
initTabSwitching();
initLiteMode();

getData('postedUpdateVersions').then(function(d) {
  var posted = d.postedUpdateVersions || [];
  if (posted.includes(APP_VERSION)) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = '<div style="background:linear-gradient(135deg,#0f172a,#1e293b);border:1px solid rgba(16,185,129,0.3);border-radius:12px;padding:28px 32px;max-width:380px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.5);"><div style="color:#a7f3d0;font-size:15px;font-weight:600;margin-bottom:8px;">Update v' + APP_VERSION + '</div><div style="color:#94a3b8;font-size:13px;margin-bottom:20px;">Refresh LiveChat agar fitur terbaru aktif</div><button id="aa-update-ok" style="background:#10b981;color:#fff;border:none;padding:8px 32px;border-radius:8px;cursor:pointer;font-weight:600;font-size:13px;">OK</button></div>';
    document.body.appendChild(overlay);
    document.getElementById('aa-update-ok').addEventListener('click', function() { overlay.remove(); });
    posted = posted.filter(function(v) { return v !== APP_VERSION; });
    setData({ postedUpdateVersions: posted });
  }
});

async function renderAll() {
  await Promise.all([renderData(), renderLogs(), loadDecoImages(), loadBackground(), loadLiveChatBg()]);
}
renderAll();
updateOnlineStats();
showSessionEmail();

var _selfFs = false;
var _fsSuppressSave = false;
chrome.storage.onChanged.addListener(function(changes) {
  if (changes.rows && $('#pane-data') && $('#pane-data').classList.contains('active')) renderData();
  if (changes.logs && $('#pane-logs') && $('#pane-logs').classList.contains('active')) renderLogs();
  if (_selfFs) { _selfFs = false; return; }
  if (changes.formState) {
    var fs = changes.formState.newValue;
    var userIn = $('#qa-user'), kodeIn = $('#qa-kode'), kode2In = $('#qa-kode-2'), btn2x = $('#btn-2x');
    if (!fs) {
      if (userIn && (userIn.value || (kodeIn && kodeIn.value))) {
        if (userIn) userIn.value = '';
        if (kodeIn) kodeIn.value = '';
        if (kode2In) kode2In.value = '';
        if (btn2x && btn2x.classList.contains('active')) btn2x.click();
        saveDashboardState();
      }
      return;
    }
    _fsSuppressSave = true;
    if ('user' in fs && userIn && fs.user !== userIn.value) { userIn.value = fs.user; userIn.dispatchEvent(new Event('input', { bubbles: true })); }
    if ('kode' in fs && kodeIn && fs.kode !== kodeIn.value) { kodeIn.value = fs.kode; kodeIn.dispatchEvent(new Event('input', { bubbles: true })); }
    if ('kode2' in fs && kode2In && fs.kode2 !== kode2In.value) {
      if (fs.kode2 && btn2x && !btn2x.classList.contains('active')) btn2x.click();
      kode2In.value = fs.kode2;
      kode2In.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if ('dualMode' in fs && btn2x) {
      var isActive = btn2x.classList.contains('active');
      if (fs.dualMode && !isActive) btn2x.click();
      else if (!fs.dualMode && isActive) btn2x.click();
    }
    _fsSuppressSave = false;
    saveDashboardState();
  }
});
/* restore user from formState on page load (jangan restore kode biar gak ganggu scan pick) */
getData('formState').then(function(r) {
  var fs = r.formState;
  if (!fs) return;
  var userIn = $('#qa-user');
  if (fs.user && userIn) userIn.value = fs.user;
});
function saveDashboardState() {
  var userIn = $('#qa-user'), kodeIn = $('#qa-kode'), kode2In = $('#qa-kode-2'), btn2x = $('#btn-2x');
  var dual = btn2x && btn2x.classList.contains('active');
  _selfFs = true;
  setData({ formState: { user: userIn ? userIn.value : '', kode: kodeIn ? kodeIn.value : '', kode2: dual && kode2In ? kode2In.value : '', dualMode: dual } });
}
document.addEventListener('input', function(e) {
  if ((e.target.id === 'qa-user' || e.target.id === 'qa-kode' || e.target.id === 'qa-kode-2') && !_fsSuppressSave) saveDashboardState();
});
setInterval(function () {
  if ($('#pane-data') && $('#pane-data').classList.contains('active')) renderData();
  if ($('#pane-logs') && $('#pane-logs').classList.contains('active')) renderLogs();
}, 10000);
setInterval(function () { if (!document.hidden) updateOnlineStats(); }, 600000);

function initLiteMode() {
  const toggle = $('#lite-toggle');
  if (!toggle) return;
  getData('liteMode').then(function (result) {
    toggle.checked = !!result.liteMode;
  });
  toggle.addEventListener('change', function () {
    const val = this.checked;
    setData({ liteMode: val });
    chrome.runtime.sendMessage({ type: 'SET_LITE_MODE' });
    if (val) {
      showToast('Mode Lite aktif \u2014 klik icon extension untuk popup cepat');
    } else {
      showToast('Mode Lite nonaktif');
    }
  });
}

(function initOcrToggle() {
  var toggle = $('#livechat-ocr-toggle');
  if (!toggle) return;
  getData('liveChatOcr').then(function(r) { toggle.checked = r.liveChatOcr !== false; });
  toggle.addEventListener('change', function() { setData({ liveChatOcr: this.checked }); });
})();

/* Tombol OCR Preview → buka halaman preview pipeline (crop + preprocessing).
   Hanya tampil untuk email resmi ('fibiogenio121@gmail.com') — pengguna lain
   tombolnya disembunyikan (akses halaman juga di-guard di ocr-preview.js).
   Dihitung ulang setiap userEmail berubah (login) supaya tombol langsung muncul
   tanpa reload — auth menyimpan userEmail ASYNC setelah load, jadi cek tunggal
   di awal bisa kena race. */
(function initOcrPreviewBtn() {
  var btn = $('#ocr-preview-btn');
  if (!btn) return;
  var ALLOWED_EMAIL = 'fibiogenio121@gmail.com';
  function applyOcrPreviewAccess() {
    getData('userEmail').then(function(r) {
      var email = String((r && r.userEmail) || '').toLowerCase().trim();
      btn.style.display = (email === ALLOWED_EMAIL) ? '' : 'none';
    });
  }
  applyOcrPreviewAccess();
  chrome.storage.onChanged.addListener(function(changes, area) {
    if (area === 'local' && changes.userEmail) applyOcrPreviewAccess();
  });
  btn.addEventListener('mouseenter', function() { this.style.background = 'rgba(99,102,241,0.2)'; });
  btn.addEventListener('mouseleave', function() { this.style.background = 'rgba(99,102,241,0.1)'; });
  btn.addEventListener('click', function() {
    try { chrome.tabs.create({ url: chrome.runtime.getURL('pages/ocr-preview.html') }); }
    catch (e) { console.error('Gagal buka OCR preview:', e); }
  });
})();

var pasteToggle = $('#paste-toggle');
if (pasteToggle) {
  var lastClip = '';
  getData('autoPasteDashboard').then(function (r) { pasteToggle.checked = r.autoPasteDashboard === true; });
  pasteToggle.addEventListener('change', function () { setData({ autoPasteDashboard: this.checked }); });

  function readClip() {
    if (!pasteToggle.checked) return;
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function (t) { processClip(t); }).catch(function () {});
    }
  }

  function processClip(text) {
    var genIn = $('#gen-user');
    if (genIn && document.activeElement === genIn) { if (text && text.trim()) lastClip = text.trim(); return; }
    if (!text || !text.trim() || text.trim() === lastClip) return;
    lastClip = text.trim();
    var genPw = $('#pw-display');
    if (genPw && genPw.textContent === lastClip) return;
    var t = lastClip;
    var userIn = $('#qa-user');
    var kodeIn = $('#qa-kode');
    var kode2In = $('#qa-kode-2');
    var scanUrl = $('#scan-url');
    if (!userIn || !kodeIn) return;
    var btn2x = $('#btn-2x');
    var changed = [];
    if (t.indexOf('https://') === 0 || t.indexOf('http://') === 0) {
      if (scanUrl) {
        var scanUrl2 = $('#scan-url-2');
        if (scanUrl.value.trim() && scanUrl2 && !scanUrl2.value.trim()) {
          scanUrl2.value = t; scanUrl2.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          scanUrl.value = t; scanUrl.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      return;
    }
    var parts = t.split(/\n|\r\n| {2,}/).filter(Boolean);
    if (parts.length >= 2 && parts[0].length >= 19 && parts[1].length >= 19 && !/[a-zA-Z]/.test(parts[0]) && !/[a-zA-Z]/.test(parts[1])) {
      if (kodeIn.value === parts[0] && kode2In && kode2In.value === parts[1]) return;
      kodeIn.value = parts[0];
      changed.push('kode');
      if (btn2x && !btn2x.classList.contains('active')) btn2x.click();
      if (kode2In) { kode2In.value = parts[1]; changed.push('kode2'); }
    } else if (t.length >= 19 && !/[a-zA-Z]/.test(t)) {
      if (kodeIn.value && t !== kodeIn.value) {
        if (kode2In && kode2In.value === t) return;
        if (btn2x && !btn2x.classList.contains('active')) btn2x.click();
        if (kode2In) { kode2In.value = t; changed.push('kode2'); }
      } else {
        if (kodeIn.value === t) return;
        kodeIn.value = t;
        changed.push('kode');
      }
    } else if ((t.indexOf('U') === 0 || t.length >= 4) && t.indexOf(' ') === -1) {
      if (userIn.value === t) return;
      if (genIn && genIn.value.trim() && t === genIn.value.trim()) return;
      userIn.value = t;
      changed.push('user');
    } else {
      return;
    }
    if (changed.includes('user')) userIn.dispatchEvent(new Event('input', { bubbles: true }));
    if (changed.includes('kode')) kodeIn.dispatchEvent(new Event('input', { bubbles: true }));
    if (changed.includes('kode2') && kode2In) kode2In.dispatchEvent(new Event('input', { bubbles: true }));
  }

  setInterval(function() { if (!document.hidden) readClip(); }, 300);
  window.addEventListener('focus', readClip);
  document.addEventListener('paste', function(e) {
    var text = (e.clipboardData || window.clipboardData).getData('text');
    if (!text || !pasteToggle.checked) return;
    var genIn = $('#gen-user');
    if (genIn && document.activeElement === genIn) return;
    if (text.trim()) lastClip = text.trim();
  });

  chrome.storage.onChanged.addListener(function(changes, area) {
    if (area !== 'local') return;
    if (changes.ocrPickedCode) {
      var code = changes.ocrPickedCode.newValue;
      if (!code || code.length < 19) return;
      chrome.storage.local.remove('ocrPickedCode');
      var kodeIn = $('#qa-kode');
      var btn2x = $('#btn-2x');
      if (!kodeIn) return;
      if (kodeIn.value === code) return;
      if (kodeIn.value && btn2x && !btn2x.classList.contains('active')) btn2x.click();
      var target = kodeIn.value ? $('#qa-kode-2') : kodeIn;
      if (target) { target.value = code; target.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    if (changes.ocrRemoveCode) {
      var code = changes.ocrRemoveCode.newValue;
      if (!code) return;
      chrome.storage.local.remove('ocrRemoveCode');
      var kodeIn = $('#qa-kode'), kode2In = $('#qa-kode-2');
      if (kodeIn && kodeIn.value === code) { kodeIn.value = ''; kodeIn.dispatchEvent(new Event('input', { bubbles: true })); }
      if (kode2In && kode2In.value === code) { kode2In.value = ''; kode2In.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    if (changes.sendScanUrl) {
      var url = changes.sendScanUrl.newValue;
      if (!url || (!url.startsWith('http') && !url.startsWith('data:'))) return;
      chrome.storage.local.remove('sendScanUrl');
      var scanInput = $('#scan-url');
      var scanInput2 = $('#scan-url-2');
      if (!scanInput) return;
      if (scanInput.value.trim() && scanInput2 && !scanInput2.value.trim()) {
        scanInput2.value = url; scanInput2.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        scanInput.value = url; scanInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  });
  chrome.storage.local.get('ocrPickedCode', function(r) {
    if (!r.ocrPickedCode) return;
    var code = r.ocrPickedCode;
    chrome.storage.local.remove('ocrPickedCode');
    if (code.length < 19) return;
    var kodeIn = $('#qa-kode');
    var btn2x = $('#btn-2x');
    if (!kodeIn) return;
    if (kodeIn.value === code) return;
    if (kodeIn.value && btn2x && !btn2x.classList.contains('active')) btn2x.click();
    var target = kodeIn.value ? $('#qa-kode-2') : kodeIn;
    if (target) { target.value = code; target.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  chrome.storage.local.get('sendScanUrl', function(r) {
    if (!r.sendScanUrl || (!r.sendScanUrl.startsWith('http') && !r.sendScanUrl.startsWith('data:'))) return;
    chrome.storage.local.remove('sendScanUrl');
    var scanInput = $('#scan-url');
    var scanInput2 = $('#scan-url-2');
    if (!scanInput) return;
    if (scanInput.value.trim() && scanInput2 && !scanInput2.value.trim()) {
      scanInput2.value = r.sendScanUrl; scanInput2.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      scanInput.value = r.sendScanUrl; scanInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}

// --- OCR Scan Gambar ---
(function() {
  var scanUrl = $('#scan-url');
  var scanUrl2 = $('#scan-url-2');
  var scanStatus = $('#scan-status');
  var scanPreviewBox1 = $('#scan-preview-box-1');
  var scanPreviewBox2 = $('#scan-preview-box-2');
  var scanPreviewWrap = $('#scan-preview-wrap');
  if (!scanUrl || !scanStatus) return;
  var kodeIn = $('#qa-kode');
  var kode2In = $('#qa-kode-2');
  var btn2x = $('#btn-2x');
  var scanTimer = null;
  var scanTimer2 = null;
  var scanSelections = [];
  var _skipAutoPick = false;
  var _dashAutoAmbil = false;
  var slotResults = {};
  var _lastSeq = 0;
  var slotStartTimes = [0, 0];
  var _lastRawData = null;
  var _debugBtn = null;
  var _slotStatusMsg = ['', ''];
  var _pastedBlobUrl = null;
  var _pastedBlobUrl2 = null;

  function hasRenderedResults() {
    for (var k in slotResults) {
      if (slotResults[k] && slotResults[k].allCodes && slotResults[k].allCodes.length) return true;
    }
    return false;
  }

  function showStatusIfEmpty() {
    if (hasRenderedResults()) return; // jangan timpa HTML hasil render
    var parts = [];
    if (_slotStatusMsg[0]) parts.push('<span style="font-family:Arial,sans-serif;font-size:11px;color:#64748b;">Slot 1: </span>' + _slotStatusMsg[0]);
    if (_slotStatusMsg[1]) parts.push('<span style="font-family:Arial,sans-serif;font-size:11px;color:#64748b;">Slot 2: </span>' + _slotStatusMsg[1]);
    scanStatus.innerHTML = parts.join('<span style="color:#64748b;font-family:Arial,sans-serif;font-size:10px;"> \u2022 </span>') || '';
  }

  /* ---- OCR via shared engine (modules/ocr-engine.js) — murni, tanpa UI ---- */
  var engine = initOcrEngine();

  /* Wrapper: panggil engine murni + update UI dashboard */
  async function detectFromImage(url, slotIdx, pool, silent, blob, noAutoCrop) {
    /* noAutoCrop (crop manual user) juga menonaktifkan PHONE_CROP — area sudah dipilih
       manual, jangan di-crop ulang ke strip kiri 50% oleh aturan crop generik.
       allowCorner SELALU true (konsisten dengan preview & livechat): untuk crop engine
       melewati corner-pass kecuali flag ini ada — tanpa flag kode tiket di strip atas
       bisa terlewat. Non-crop (opts undefined) corner-pass sudah otomatis jalan. */
    var opts = noAutoCrop ? { noAutoCrop: true, noPhoneCrop: true, allowCorner: true } : undefined;
    if (silent) return engine.detectFromImage(url, pool || 0, blob, opts);
    setSlotStatus(slotIdx, 'Memproses...');
    var res;
    try {
      res = await engine.detectFromImage(url, pool || 0, blob, opts);
    } catch (e) {
      slotResults[slotIdx] = null;
      renderCombined();
      setSlotStatus(slotIdx, (e && e.message) || 'Gagal OCR', true);
      return;
    }
    if (res && res.error) {
      slotResults[slotIdx] = null;
      renderCombined();
      setSlotStatus(slotIdx, res.error, true);
      return res;
    }
    var tStart = slotStartTimes[slotIdx] || Date.now();
    var elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
    var rawTexts = (res && res.rawTexts) || [];
    var allRaw = (res && res.allRaw) || '';
    if (!allRaw && rawTexts.length) {
      allRaw = rawTexts.map(function(t, idx) { return '\n\u2500\u2500 ' + (VARIANTS[idx] ? VARIANTS[idx].label : ('var ' + idx)) + ' \u2500\u2500\n' + t; }).join('');
    }
    _lastRawData = {
      rawTexts: rawTexts,
      variants: VARIANTS.map(function(v) { return v.label; }),
      elapsed: elapsed,
      url: url,
      allRaw: allRaw,
      codesFound: !!(res && res.codes && res.codes.length > 0)
    };
    if (_debugBtn) _debugBtn.style.display = 'inline-flex';
    if (res && res.codes && res.codes.length > 0) {
      slotResults[slotIdx] = {
        allCodeMap: res.codeInfo || {},
        bestCodes: res.bestCodes || [],
        allCodes: res.codes,
        allRaw: allRaw,
        rawTexts: rawTexts,
        elapsed: elapsed
      };
      renderCombined();
    } else {
      slotResults[slotIdx] = null;
      renderCombined();
      setSlotStatus(slotIdx, 'Tidak ditemukan kode tiket', true);
    }
    return res;
  }

  /* ---- Debug button: show raw OCR text ---- */
  function initDebugBtn() {
    if (_debugBtn) return;
    _debugBtn = document.createElement('button');
    _debugBtn.id = 'btn-ocr-debug';
    _debugBtn.textContent = '\u{1F50D}';
    _debugBtn.title = 'Lihat teks mentah hasil OCR';
    _debugBtn.style.cssText = 'display:none;padding:2px 7px;font-size:11px;border:none;border-radius:4px;background:rgba(99,102,241,0.12);color:#818cf8;cursor:pointer;vertical-align:middle;transition:background .2s;line-height:1.4;';
    _debugBtn.addEventListener('mouseenter', function() { this.style.background = 'rgba(99,102,241,0.2)'; });
    _debugBtn.addEventListener('mouseleave', function() { this.style.background = 'rgba(99,102,241,0.12)'; });
    _debugBtn.addEventListener('click', showDebugModal);
    // Insert after scan-status
    if (scanStatus && scanStatus.parentNode) {
      scanStatus.parentNode.insertBefore(_debugBtn, scanStatus.nextSibling);
    }
  }

  function showDebugModal() {
    if (!_lastRawData) return;
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);';
    var html = '<div style="background:#0f172a;border:1px solid rgba(99,102,241,0.15);border-radius:12px;padding:20px;max-width:90%;max-height:85vh;overflow:auto;box-shadow:0 8px 32px rgba(0,0,0,0.5);">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">';
    html += '<h3 style="color:#e2e8f0;font-size:14px;margin:0;">\u{1F50D} Debug OCR \u2014 Teks Mentah</h3>';
    html += '<button id="debug-modal-close" style="background:none;border:none;color:#94a3b8;font-size:18px;cursor:pointer;padding:4px;">\u2715</button>';
    html += '</div>';

    if (_lastRawData.url) {
      html += '<div style="font-size:10px;color:#64748b;margin-bottom:8px;word-break:break-all;">URL: ' + escapeHtml(_lastRawData.url) + '</div>';
    }

    var statusColor = _lastRawData.codesFound ? '#22c55e' : '#ef4444';
    html += '<div style="font-size:10px;color:' + statusColor + ';margin-bottom:8px;font-weight:600;">' + (_lastRawData.codesFound ? 'Kode ditemukan' : 'Tidak ada kode valid') + ' \u00B7 ' + (_lastRawData.elapsed || '') + 's</div>';

    _lastRawData.rawTexts.forEach(function(text, idx) {
      html += '<div style="margin-bottom:10px;">';
      html += '<div style="font-size:10px;color:#64748b;margin-bottom:3px;font-weight:600;letter-spacing:.3px;">' + escapeHtml(_lastRawData.variants[idx]) + '</div>';
      html += '<pre style="background:rgba(8,11,20,0.9);border:1px solid rgba(99,102,241,0.08);border-radius:6px;padding:10px;font-family:Consolas,monospace;font-size:11px;color:#d1d5db;white-space:pre-wrap;word-break:break-all;margin:0;line-height:1.5;max-height:220px;overflow:auto;">' + escapeHtml(text || '(kosong)') + '</pre>';
      html += '</div>';
    });

    if (_lastRawData.allRaw) {
      html += '<div style="margin-bottom:6px;">';
      html += '<div style="font-size:10px;color:#64748b;margin-bottom:3px;font-weight:600;letter-spacing:.3px;">Gabungan (allRaw)</div>';
      html += '<pre style="background:rgba(8,11,20,0.9);border:1px solid rgba(99,102,241,0.08);border-radius:6px;padding:10px;font-family:Consolas,monospace;font-size:11px;color:#d1d5db;white-space:pre-wrap;word-break:break-all;margin:0;line-height:1.5;max-height:220px;overflow:auto;">' + escapeHtml(_lastRawData.allRaw) + '</pre>';
      html += '</div>';
    }

    html += '</div>';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);

    var closeBtn = overlay.querySelector('#debug-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  }

  initDebugBtn();

  /* ---- Helper: set status message per-slot (TIDAK timpa HTML hasil render) ---- */
  function setSlotStatus(slotIdx, msg, isError) {
    _slotStatusMsg[slotIdx] = msg;
    showStatusIfEmpty();
    if (isError) scanStatus.className = 'scan-err';
  }

  function renderCombined() {
    var hasAny = false;
    for (var k in slotResults) { if (slotResults[k]) { hasAny = true; break; } }
    if (!hasAny) {
      return;
    }

    window._scanSources = {};
    window._seqCount = (window._seqCount || 0) + 1;
    var htmlParts = [];

    [0, 1].forEach(function(si) {
      var sr = slotResults[si];
      if (!sr || !sr.allCodes || sr.allCodes.length === 0) return;

      var codeMap = sr.allCodeMap;
      var codes = sr.allCodes;
      var bestCodes = sr.bestCodes || [];

      Object.keys(codeMap).forEach(function(c) {
        if (!window._scanSources[c]) window._scanSources[c] = { count: 0, sources: [] };
        window._scanSources[c].count += codeMap[c].count;
        codeMap[c].sources.forEach(function(s) { if (window._scanSources[c].sources.indexOf(s) === -1) window._scanSources[c].sources.push(s); });
      });

      var kodeEl = si === 0 ? kodeIn : kode2In;
      if (_dashAutoAmbil && !_skipAutoPick && kodeEl && bestCodes.length > 0) {
        var pick = bestCodes[0];
        if (kodeEl.value !== pick) { kodeEl.value = pick; kodeEl.dispatchEvent(new Event('input', { bubbles: true })); }
        if (scanSelections.indexOf(pick) === -1) scanSelections.push(pick);
        if (si === 1 && !btn2x.classList.contains('active')) btn2x.click();
      }

      var slotLabel = '<div style="font-size:10px;color:#64748b;margin-bottom:2px;">' + (si === 0 ? 'Slot 1' : 'Slot 2') + (sr.elapsed ? ' <span style="color:#94a3b8;">&middot;</span> ' + sr.elapsed + 's' : '') + '</div>';
      var btns = codes.map(function(c, idx) {
        var isBest = bestCodes.indexOf(c) >= 0;
        var isPicked = scanSelections.indexOf(c) >= 0;
        var btnLabel = isPicked ? '\u2715' : (isBest ? '+Ambil' : 'Ambil');
        var btnBg = isPicked ? '#ef4444' : (isBest ? '#facc15' : '#22c55e');
        var btnColor = isPicked ? '#fff' : (isBest ? '#000' : '#fff');
        var sources = (codeMap[c] && codeMap[c].sources) || [];
        var srcHtml = sources.length ? '<span style="font-size:8px;color:#64748b;margin-left:4px;">' + sources.join(', ') + '</span>' : '';
        return '<div style="margin:2px 0;display:flex;align-items:center;"><button class="btn btn-sm scan-pick" data-code="' + c + '" style="font-family:monospace;font-size:11px;flex:1;text-align:left;padding:4px 8px;">' + (idx+1) + '. ' + c.slice(0, 16) + '<span style="font-size:20px;font-weight:bold">' + c.slice(-3) + '</span>' + srcHtml + '</button><span class="scan-pick-ambil' + (isBest ? ' scan-best' : '') + '" data-code="' + c + '" style="cursor:pointer;background:' + btnBg + ';color:' + btnColor + ';padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;white-space:nowrap;margin:0 2px;">' + btnLabel + '</span></div>';
      }).join('');

      var rawHtml = '<div style="margin-top:4px;"><span class="scan-raw-toggle" data-slot="' + si + '" style="cursor:pointer;font-size:10px;color:#64748b;user-select:none;">&#9660; Raw</span><pre class="scan-raw-text" data-slot="' + si + '" style="display:none;margin:4px 0 0;font-size:10px;color:#94a3b8;white-space:pre-wrap;word-break:break-word;max-height:200px;overflow-y:auto;font-family:Consolas,monospace;line-height:1.4;background:rgba(0,0,0,0.2);border-radius:4px;padding:6px 8px;">' + escapeHtml(sr.allRaw || '') + '</pre></div>';
      htmlParts.push(slotLabel + btns + rawHtml);
    });

    if (htmlParts.length === 0) return;

    scanStatus.innerHTML = htmlParts.join('<div style="border-top:1px dashed rgba(99,102,241,0.15);margin:6px 0;"></div>');
    scanStatus.className = 'scan-ok';
    chrome.storage.local.get('_scanCounter', function(sc) {
      var seq = ((sc._scanCounter || 0) + 1);
      chrome.storage.local.set({ _scanCounter: seq });
      setData({ scanResult: { codes: Object.keys(window._scanSources), url: 'dashboard', selected: [kodeIn.value, kode2In ? kode2In.value : ''].filter(Boolean), source: 'dashboard', codeInfo: window._scanSources, timestamp: new Date().toLocaleString('id-ID'), seq: seq } });
    });
  }

  /* ---- Helper: dapatkan URL asli (untuk pasted image gunakan blob URL) ---- */
  function getScanUrl(slotIdx) {
    if (slotIdx === 0) {
      var v = scanUrl.value.trim();
      return v === '[image]' ? _pastedBlobUrl : v;
    }
    if (!scanUrl2) return '';
    var v = scanUrl2.value.trim();
    return v === '[image]' ? _pastedBlobUrl2 : v;
  }

  function isUrlValid(url) {
    if (!url) return false;
    if (url.startsWith('http') || url.startsWith('blob:') || url.startsWith('data:')) return true;
    return false;
  }

  /* ---- Crop Modal (inline dashboard) ---- */
  var _cropModal = null;
  var _cropImage = null;
  var _cropContainer = null;
  var _cropSel = null;
  var _cropSizeLabel = null;
  var _cropStartX = 0, _cropStartY = 0;
  var _cropDragging = false;
  var _cropTargetUrl = '';
  var _cropTargetSlot = 0;
  var _cropZoom = 1;
  var _cropBaseW = 0, _cropBaseH = 0;
  var _cropGuideL = null, _cropGuideR = null, _cropGuideT = null, _cropGuideB = null;

  function ensureCropBtn(slot, url) {
    var box = slot === 0 ? scanPreviewBox1 : scanPreviewBox2;
    if (!box) return;
    var existing = box.querySelector('.dash-crop-btn');
    if (existing) {
      existing.dataset.url = url;
      return;
    }
    if (!isUrlValid(url)) return;
    if (slot !== 0 && slot !== 1) return;
    var btn = document.createElement('div');
    btn.className = 'dash-crop-btn';
    btn.innerHTML = '&#9986;';
    btn.title = 'Crop manual';
    btn.dataset.url = url;
    btn.dataset.slot = slot;
    btn.style.cssText = 'position:absolute;bottom:8px;right:8px;z-index:20;width:24px;height:24px;background:#f59e0b;color:#000;border:none;border-radius:4px;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.4);opacity:0.85;line-height:1;pointer-events:auto;';
    btn.addEventListener('mouseenter', function() { this.style.opacity = '1'; });
    btn.addEventListener('mouseleave', function() { this.style.opacity = '0.85'; });
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      showCropModal(parseInt(this.dataset.slot), this.dataset.url);
    });
    box.style.position = box.style.position || 'relative';
    box.appendChild(btn);
  }

  function buildCropModal() {
    if (_cropModal) { _cropModal.style.opacity = '1'; _cropModal.style.visibility = 'visible'; return; }
    _cropModal = document.createElement('div');
    _cropModal.style.cssText = 'display:flex;position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.85);flex-direction:column;align-items:center;justify-content:center;opacity:0;visibility:hidden;transition:opacity .3s ease,visibility .3s;';
    _cropModal.innerHTML = [
      '<div style="position:absolute;top:12px;left:50%;transform:translateX(-50%);display:flex;gap:8px;align-items:center;z-index:10;background:rgba(15,23,42,0.92);backdrop-filter:blur(8px);padding:10px 18px;border-radius:10px;border:1px solid rgba(99,102,241,0.15);box-shadow:0 4px 24px rgba(0,0,0,0.5);">',
        '<span style="font-size:11px;color:#94a3b8;margin-right:4px;">&#9678; Seret untuk memilih area crop</span>',
        '<span id="dash-crop-zoom-display" style="font-size:11px;color:#94a3b8;min-width:40px;text-align:center;">100%</span>',
        '<button id="dash-crop-zoom-out" style="padding:4px 10px;border:none;border-radius:4px;font-size:14px;font-weight:700;cursor:pointer;background:rgba(99,102,241,0.12);color:#818cf8;">âˆ’</button>',
        '<button id="dash-crop-zoom-in" style="padding:4px 10px;border:none;border-radius:4px;font-size:14px;font-weight:700;cursor:pointer;background:rgba(99,102,241,0.12);color:#818cf8;">+</button>',
        '<button id="dash-crop-confirm" style="padding:6px 16px;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;background:linear-gradient(135deg,#6366f1,#818cf8);color:#fff;box-shadow:0 2px 8px rgba(99,102,241,0.3);transition:all .2s;">&#128270; CROP KODE TIKET</button>',
        '<button id="dash-crop-cancel" style="padding:6px 16px;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;background:rgba(239,68,68,0.15);color:#fca5a5;border:1px solid rgba(239,68,68,0.2);transition:all .2s;">&#10005; Batal</button>',
      '</div>',
      '<div id="dash-crop-container" style="position:relative;overflow:hidden;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.6);background:#0f1322;cursor:crosshair;user-select:none;">',
        '<img id="dash-crop-img" style="display:block;" alt="">',
        '<div class="dash-crop-guide v" id="dash-guide-l" style="position:absolute;pointer-events:none;z-index:3;display:none;width:1px;top:0;bottom:0;background:repeating-linear-gradient(0deg,#facc15 0px,#facc15 8px,transparent 8px,transparent 16px);"></div>',
        '<div class="dash-crop-guide v" id="dash-guide-r" style="position:absolute;pointer-events:none;z-index:3;display:none;width:1px;top:0;bottom:0;background:repeating-linear-gradient(0deg,#facc15 0px,#facc15 8px,transparent 8px,transparent 16px);"></div>',
        '<div class="dash-crop-guide h" id="dash-guide-t" style="position:absolute;pointer-events:none;z-index:3;display:none;height:1px;left:0;right:0;background:repeating-linear-gradient(90deg,#facc15 0px,#facc15 8px,transparent 8px,transparent 16px);"></div>',
        '<div class="dash-crop-guide h" id="dash-guide-b" style="position:absolute;pointer-events:none;z-index:3;display:none;height:1px;left:0;right:0;background:repeating-linear-gradient(90deg,#facc15 0px,#facc15 8px,transparent 8px,transparent 16px);"></div>',
        '<div id="dash-crop-selection" style="position:absolute;border:2px solid #facc15;background:rgba(250,204,21,0.08);cursor:move;display:none;pointer-events:auto;">',
          '<span class="handle" style="position:absolute;width:12px;height:12px;background:#facc15;border:2px solid #000;border-radius:2px;z-index:5;top:-6px;left:-6px;cursor:nw-resize;"></span>',
          '<span class="handle" style="position:absolute;width:12px;height:12px;background:#facc15;border:2px solid #000;border-radius:2px;z-index:5;top:-6px;right:-6px;cursor:ne-resize;"></span>',
          '<span class="handle" style="position:absolute;width:12px;height:12px;background:#facc15;border:2px solid #000;border-radius:2px;z-index:5;bottom:-6px;left:-6px;cursor:sw-resize;"></span>',
          '<span class="handle" style="position:absolute;width:12px;height:12px;background:#facc15;border:2px solid #000;border-radius:2px;z-index:5;bottom:-6px;right:-6px;cursor:se-resize;"></span>',
          '<span id="dash-crop-size" style="position:absolute;bottom:-24px;left:50%;transform:translateX(-50%);font-size:10px;color:#facc15;background:rgba(0,0,0,0.7);padding:2px 8px;border-radius:4px;white-space:nowrap;pointer-events:none;">0&times;0</span>',
        '</div>',
      '</div>'
    ].join('');
    document.body.appendChild(_cropModal);

    _cropImage = _cropModal.querySelector('#dash-crop-img');
    _cropContainer = _cropModal.querySelector('#dash-crop-container');
    _cropSel = _cropModal.querySelector('#dash-crop-selection');
    _cropSizeLabel = _cropModal.querySelector('#dash-crop-size');
    _cropGuideL = _cropModal.querySelector('#dash-guide-l');
    _cropGuideR = _cropModal.querySelector('#dash-guide-r');
    _cropGuideT = _cropModal.querySelector('#dash-guide-t');
    _cropGuideB = _cropModal.querySelector('#dash-guide-b');

    /* ---- Zoom-to-fit seperti frame: auto-scale gambar muat di viewport ---- */
    // Pakai setTimeout agar jalan SETELAH showCropModal's onload handler
    // (addEventListener jalan sebelum onload, tapi setTimeout dijadwalkan setelahnya)
    _cropImage.addEventListener('load', function onCropImgLoad() {
      setTimeout(function() {
        if (!_cropImage.naturalWidth) return;
        _cropBaseW = _cropImage.naturalWidth;
        _cropBaseH = _cropImage.naturalHeight;
        var fw = window.innerWidth - 40, fh = window.innerHeight - 90;
        _cropZoom = Math.min(fw / _cropBaseW, fh / _cropBaseH);
        if (_cropZoom > 1) _cropZoom = 1;
        if (_cropZoom < 0.2) _cropZoom = 0.2;
        applyDashZoom();
        document.getElementById('dash-crop-zoom-display').textContent = Math.round(_cropZoom * 100) + '%';
      }, 0);
    });

    function applyDashZoom() {
      if (!_cropBaseW || !_cropBaseH) return;
      _cropImage.style.width = (_cropBaseW * _cropZoom) + 'px';
      _cropImage.style.height = (_cropBaseH * _cropZoom) + 'px';
      _cropContainer.style.width = (_cropBaseW * _cropZoom) + 'px';
      _cropContainer.style.height = (_cropBaseH * _cropZoom) + 'px';
      // Scale selection jika ada dan memiliki ukuran > 0
      if (_cropSel && _cropSel.style.display !== 'none') {
        var selW = parseFloat(_cropSel.style.width);
        if (selW > 0) {
          updateDashCropSize();
          updateDashGuides();
        } else {
          // Selection visible tapi width=0 (mousedown baru mulai) - sembunyikan guides
          if (_cropGuideL) _cropGuideL.style.display = 'none';
          if (_cropGuideR) _cropGuideR.style.display = 'none';
          if (_cropGuideT) _cropGuideT.style.display = 'none';
          if (_cropGuideB) _cropGuideB.style.display = 'none';
        }
      }
    }

    _cropModal.querySelector('#dash-crop-confirm').addEventListener('click', doDashCrop);
    _cropModal.querySelector('#dash-crop-cancel').addEventListener('click', function() {
      if (_cropGuideL) _cropGuideL.style.display = 'none';
      if (_cropGuideR) _cropGuideR.style.display = 'none';
      if (_cropGuideT) _cropGuideT.style.display = 'none';
      if (_cropGuideB) _cropGuideB.style.display = 'none';
      _cropSel.style.boxShadow = '';
      _cropModal.style.opacity = '0';
      _cropModal.style.visibility = 'hidden';
      _cropSel.style.display = 'none';
    });
    _cropModal.querySelector('#dash-crop-zoom-in').addEventListener('click', function() {
      var newZoom = Math.min(5, _cropZoom * 1.25);
      var scale = newZoom / _cropZoom;
      var cx = _cropContainer.scrollLeft + _cropContainer.clientWidth / 2;
      var cy = _cropContainer.scrollTop + _cropContainer.clientHeight / 2;
      _cropZoom = newZoom;
      applyDashZoom();
      _cropContainer.scrollLeft = (cx * scale) - _cropContainer.clientWidth / 2;
      _cropContainer.scrollTop = (cy * scale) - _cropContainer.clientHeight / 2;
      document.getElementById('dash-crop-zoom-display').textContent = Math.round(_cropZoom * 100) + '%';
    });
    _cropModal.querySelector('#dash-crop-zoom-out').addEventListener('click', function() {
      var newZoom = Math.max(0.2, _cropZoom / 1.25);
      var scale = newZoom / _cropZoom;
      var cx = _cropContainer.scrollLeft + _cropContainer.clientWidth / 2;
      var cy = _cropContainer.scrollTop + _cropContainer.clientHeight / 2;
      _cropZoom = newZoom;
      applyDashZoom();
      _cropContainer.scrollLeft = (cx * scale) - _cropContainer.clientWidth / 2;
      _cropContainer.scrollTop = (cy * scale) - _cropContainer.clientHeight / 2;
      document.getElementById('dash-crop-zoom-display').textContent = Math.round(_cropZoom * 100) + '%';
    });
    _cropContainer.addEventListener('wheel', function(e) {
      e.preventDefault();
      var rect = _cropContainer.getBoundingClientRect();
      var cursorX = e.clientX - rect.left + _cropContainer.scrollLeft;
      var cursorY = e.clientY - rect.top + _cropContainer.scrollTop;
      var factor = e.deltaY < 0 ? 1.25 : 0.8;
      var newZoom = Math.max(0.2, Math.min(5, _cropZoom * factor));
      var scale = newZoom / _cropZoom;
      _cropZoom = newZoom;
      applyDashZoom();
      _cropContainer.scrollLeft = (cursorX * scale) - _cropContainer.clientWidth / 2;
      _cropContainer.scrollTop = (cursorY * scale) - _cropContainer.clientHeight / 2;
      document.getElementById('dash-crop-zoom-display').textContent = Math.round(_cropZoom * 100) + '%';
    }, { passive: false });

    /* Mouse handlers */
    _cropContainer.addEventListener('mousedown', function(e) {
      var rect = _cropContainer.getBoundingClientRect();
      // Gunakan content coordinates (viewport + scroll offset)
      _cropStartX = e.clientX - rect.left + _cropContainer.scrollLeft;
      _cropStartY = e.clientY - rect.top + _cropContainer.scrollTop;

      // Check if clicking on handle
      if (e.target.classList.contains('handle')) return;

      // Check if clicking inside existing selection (move) - pakai viewport coordinates
      if (_cropSel.style.display !== 'none') {
        var sR = _cropSel.getBoundingClientRect();
        if (e.clientX >= sR.left && e.clientX <= sR.right && e.clientY >= sR.top && e.clientY <= sR.bottom) {
          _cropDragging = 'move';
          return;
        }
      }

      // New selection - gunakan content coordinates
      _cropSel.style.left = _cropStartX + 'px';
      _cropSel.style.top = _cropStartY + 'px';
      _cropSel.style.width = '0px';
      _cropSel.style.height = '0px';
      _cropSel.style.display = 'block';
      _cropDragging = 'resize';
      updateDashGuides();
    });

    document.addEventListener('mousemove', function(e) {
      if (!_cropDragging) return;
      if (!_cropContainer || !_cropSel) return;
      var rect = _cropContainer.getBoundingClientRect();
      // Gunakan content coordinates
      var mx = e.clientX - rect.left + _cropContainer.scrollLeft;
      var my = e.clientY - rect.top + _cropContainer.scrollTop;

      // Clamp ke content dimensions
      var contentW = _cropContainer.scrollWidth;
      var contentH = _cropContainer.scrollHeight;
      mx = Math.max(0, Math.min(mx, contentW));
      my = Math.max(0, Math.min(my, contentH));

      if (_cropDragging === 'move') {
        var dx = mx - _cropStartX;
        var dy = my - _cropStartY;
        var l = parseFloat(_cropSel.style.left) + dx;
        var t = parseFloat(_cropSel.style.top) + dy;
        var cw = parseFloat(_cropSel.style.width);
        var ch = parseFloat(_cropSel.style.height);
        _cropSel.style.left = Math.max(0, Math.min(l, contentW - cw)) + 'px';
        _cropSel.style.top = Math.max(0, Math.min(t, contentH - ch)) + 'px';
        _cropStartX = mx;
        _cropStartY = my;
        updateDashCropSize();
        updateDashGuides();
        return;
      }

      var x1 = Math.min(_cropStartX, mx);
      var y1 = Math.min(_cropStartY, my);
      var x2 = Math.max(_cropStartX, mx);
      var y2 = Math.max(_cropStartY, my);
      _cropSel.style.left = x1 + 'px';
      _cropSel.style.top = y1 + 'px';
      _cropSel.style.width = (x2 - x1) + 'px';
      _cropSel.style.height = (y2 - y1) + 'px';
      updateDashCropSize();
      updateDashGuides();
      // Dynamic shadow - jangan render shadow besar saat selection masih 0x0
      if ((x2 - x1) > 20 && (y2 - y1) > 20) {
        _cropSel.style.boxShadow = '0 0 0 9999px rgba(0,0,0,0.5)';
      } else {
        _cropSel.style.boxShadow = '';
      }
    });

    document.addEventListener('mouseup', function() {
      _cropDragging = false;
    });

    function updateDashGuides() {
      var sel = _cropSel;
      if (!sel || sel.style.display === 'none') {
        if (_cropGuideL) _cropGuideL.style.display = 'none';
        if (_cropGuideR) _cropGuideR.style.display = 'none';
        if (_cropGuideT) _cropGuideT.style.display = 'none';
        if (_cropGuideB) _cropGuideB.style.display = 'none';
        return;
      }
      var l = parseFloat(sel.style.left) || 0;
      var t = parseFloat(sel.style.top) || 0;
      var w = parseFloat(sel.style.width) || 0;
      var h = parseFloat(sel.style.height) || 0;
      var r = l + w;
      var b = t + h;
      if (w < 10 && h < 10) {
        if (_cropGuideL) _cropGuideL.style.display = 'none';
        if (_cropGuideR) _cropGuideR.style.display = 'none';
        if (_cropGuideT) _cropGuideT.style.display = 'none';
        if (_cropGuideB) _cropGuideB.style.display = 'none';
        return;
      }
      _cropGuideL.style.left = l + 'px';
      _cropGuideL.style.display = 'block';
      _cropGuideR.style.left = r + 'px';
      _cropGuideR.style.display = 'block';
      _cropGuideT.style.top = t + 'px';
      _cropGuideT.style.display = 'block';
      _cropGuideB.style.top = b + 'px';
      _cropGuideB.style.display = 'block';
    }

    function updateDashCropSize() {
      if (!_cropSel || !_cropImage) return;
      var w = parseFloat(_cropSel.style.width);
      var h = parseFloat(_cropSel.style.height);
      if (w > 0 && h > 0) {
        var scaleX = _cropImage.naturalWidth / _cropImage.offsetWidth;
        var scaleY = _cropImage.naturalHeight / _cropImage.offsetHeight;
        _cropSizeLabel.textContent = Math.round(w * scaleX) + '\u00d7' + Math.round(h * scaleY) + ' px';
      } else {
        _cropSizeLabel.textContent = '0\u00d70';
      }
    }
  }

  function applyDashCropZoom() {
    var dw = Math.round(_cropBaseW * _cropZoom);
    var dh = Math.round(_cropBaseH * _cropZoom);
    _cropImage.style.width = dw + 'px';
    _cropImage.style.height = dh + 'px';
    // Container tetap di ukuran base - hanya image yang membesar
    _cropContainer.style.width = _cropBaseW + 'px';
    _cropContainer.style.height = _cropBaseH + 'px';
  }

  function updateDashZoomDisplay() {
    var el = document.getElementById('dash-crop-zoom-display');
    if (el) el.textContent = Math.round(_cropZoom * 100) + '%';
  }

  function zoomDashCrop(delta, cursorX, cursorY) {
    if (_cropModal.style.display !== 'flex') return;
    var oldZoom = _cropZoom;
    var oldSx = _cropContainer.scrollLeft;
    var oldSy = _cropContainer.scrollTop;
    _cropZoom = Math.max(1.0, Math.min(8, _cropZoom + delta));
    applyDashCropZoom();
    updateDashZoomDisplay();
    // Scroll toward cursor - container tetap, hanya image membesar
    if (cursorX !== undefined && cursorY !== undefined && oldZoom > 0) {
      var cvpX = cursorX - oldSx;
      var cvpY = cursorY - oldSy;
      var factor = delta / oldZoom;
      _cropContainer.scrollLeft = Math.round(oldSx + factor * (cvpX + oldSx));
      _cropContainer.scrollTop = Math.round(oldSy + factor * (cvpY + oldSy));
    }
  }

  function showCropModal(slot, url) {
    if (!url) return;
    _cropTargetSlot = slot;
    _cropTargetUrl = url;
    _cropZoom = 1;
    buildCropModal();
    _cropImage.removeAttribute('src');
    _cropSel.style.display = 'none';
    _cropImage.onload = function() {
      var maxW = Math.min(window.innerWidth * 0.9, 1400);
      var maxH = window.innerHeight * 0.85;
      var fitScale = Math.min(1, maxW / _cropImage.naturalWidth, maxH / _cropImage.naturalHeight);
      _cropBaseW = Math.round(_cropImage.naturalWidth * fitScale);
      _cropBaseH = Math.round(_cropImage.naturalHeight * fitScale);
      _cropModal.style.opacity = '1'; _cropModal.style.visibility = 'visible';
      applyDashCropZoom();
      _cropSel.style.display = 'none';
      updateDashZoomDisplay();
    };
    _cropImage.onerror = function() {
      showToast('Gagal memuat gambar untuk crop', true);
      _cropModal.style.opacity = '0'; _cropModal.style.visibility = 'hidden';
    };
    _cropImage.src = url;
  }

  async function doDashCrop() {
    if (!_cropImage || _cropSel.style.display === 'none') {
      showToast('Pilih area crop terlebih dahulu', true);
      return;
    }
    var w = parseFloat(_cropSel.style.width);
    var h = parseFloat(_cropSel.style.height);
    if (w < 10 || h < 10) {
      showToast('Area crop terlalu kecil', true);
      return;
    }
    var scaleX = _cropImage.naturalWidth / _cropImage.offsetWidth;
    var scaleY = _cropImage.naturalHeight / _cropImage.offsetHeight;
    var rect = {
      x: Math.round(parseFloat(_cropSel.style.left) * scaleX),
      y: Math.round(parseFloat(_cropSel.style.top) * scaleY),
      w: Math.round(w * scaleX),
      h: Math.round(h * scaleY),
    };

    var cw = rect.w, ch = rect.h;
    var CAP = 2000;
    if (Math.max(cw, ch) > CAP) {
      var s = CAP / Math.max(cw, ch);
      cw = Math.round(cw * s); ch = Math.round(ch * s);
    }
    var c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    var ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(_cropImage, rect.x, rect.y, rect.w, rect.h, 0, 0, cw, ch);

    var blob = await new Promise(function(resolve) {
      c.toBlob(function(b) { resolve(b); }, 'image/png');
    });
    c.width = 0; c.height = 0;

    if (!blob) {
      showToast('Gagal crop gambar', true);
      return;
    }

    _cropModal.style.opacity = '0'; _cropModal.style.visibility = 'hidden';
    _cropSel.style.display = 'none';

    var blobUrl = URL.createObjectURL(blob);
    showToast('Memproses crop...');

    // OCR langsung dengan flag noAutoCrop — hasil crop TIDAK boleh kena
    // auto-crop screenshot lagi (penyebab hasil salah untuk crop tinggi).
    if (_cropTargetSlot === 0 && scanTimer) clearTimeout(scanTimer);
    if (_cropTargetSlot === 1 && scanTimer2) clearTimeout(scanTimer2);
    detectFromImage(blobUrl, _cropTargetSlot, _cropTargetSlot, false, blob, true);

    // Simpan blob URL + tampilkan preview manual (tanpa trigger OCR ulang)
    var targetInput = _cropTargetSlot === 0 ? scanUrl : scanUrl2;
    if (targetInput) {
      if (_cropTargetSlot === 0) {
        if (_pastedBlobUrl) URL.revokeObjectURL(_pastedBlobUrl);
        _pastedBlobUrl = blobUrl;
      } else {
        if (_pastedBlobUrl2) URL.revokeObjectURL(_pastedBlobUrl2);
        _pastedBlobUrl2 = blobUrl;
      }
      targetInput.value = '[image]';
    }
    var cropBox = _cropTargetSlot === 0 ? scanPreviewBox1 : scanPreviewBox2;
    var cropPimg = cropBox ? cropBox.querySelector('.scan-preview') : null;
    if (cropPimg) { cropPimg.src = blobUrl; cropBox.style.display = 'block'; scanPreviewWrap.style.display = 'block'; }
  }

  scanUrl.addEventListener('input', function() {
    var val = this.value.trim();
    var val2 = scanUrl2 ? scanUrl2.value.trim() : '';
    var actualUrl = getScanUrl(0);
    var actualUrl2 = getScanUrl(1);
    
    if (!val) {
      if (_pastedBlobUrl) { URL.revokeObjectURL(_pastedBlobUrl); _pastedBlobUrl = null; }
      scanStatus.textContent = ''; scanStatus.className = ''; _slotStatusMsg[0] = ''; 
      scanPreviewWrap.style.display = 'none'; scanPreviewBox1.style.display = 'none'; scanPreviewBox2.style.display = 'none'; 
      scanSelections = []; slotResults[0] = undefined; renderCombined(); 
      chrome.storage.local.remove('scanResult'); 
      chrome.storage.local.set({ scanUrlPersist: '', scanUrl2Persist: val2 }); 
      return; 
    }
    
    // Jika user mengetik sesuatu selain [image], hapus blob URL
    if (val !== '[image]' && _pastedBlobUrl) {
      URL.revokeObjectURL(_pastedBlobUrl);
      _pastedBlobUrl = null;
    }
    
    if (!actualUrl || !isUrlValid(actualUrl)) { 
      scanPreviewBox1.style.display = 'none'; 
      if (!isUrlValid(actualUrl2)) scanPreviewWrap.style.display = 'none'; 
      slotResults[0] = null; _slotStatusMsg[0] = ''; 
      renderCombined(); 
      return; 
    }
    chrome.storage.local.set({ scanUrlPersist: val, scanUrl2Persist: val2 });
    
    var p1img = scanPreviewBox1.querySelector('.scan-preview');
    p1img.src = actualUrl;
    scanPreviewBox1.style.display = 'block';
    scanPreviewWrap.style.display = 'block';
    p1img.onerror = function() { scanPreviewBox1.style.display = 'none'; if (!isUrlValid(actualUrl2)) scanPreviewWrap.style.display = 'none'; };
    p1img.onclick = function() { if (actualUrl) showCropModal(0, actualUrl); };
    // Crop button
    ensureCropBtn(0, actualUrl);
    
    if (actualUrl2 && isUrlValid(actualUrl2)) {
      var p2img = scanPreviewBox2.querySelector('.scan-preview');
      p2img.src = actualUrl2;
      scanPreviewBox2.style.display = 'block';
      p2img.onerror = function() { scanPreviewBox2.style.display = 'none'; };
      p2img.onclick = function() { if (actualUrl2) showCropModal(1, actualUrl2); };
      ensureCropBtn(1, actualUrl2);
    } else {
      scanPreviewBox2.style.display = 'none';
    }
    scanStatus.className = '';
    slotResults[0] = undefined;
    _slotStatusMsg = ['', ''];
    if (scanTimer) clearTimeout(scanTimer);
    var isPasted = actualUrl && actualUrl.startsWith('blob:');
    setSlotStatus(0, isPasted ? 'Memproses gambar...' : 'Mengunduh...');
    
    if (actualUrl2 && isUrlValid(actualUrl2)) {
      var isPasted2 = actualUrl2 && actualUrl2.startsWith('blob:');
      setSlotStatus(1, isPasted2 ? 'Memproses gambar...' : 'Mengunduh...');
      slotResults[1] = undefined;
      if (scanTimer2) clearTimeout(scanTimer2);
      slotStartTimes[0] = Date.now();
      slotStartTimes[1] = Date.now();
      detectFromImage(actualUrl, 0, 0);
      detectFromImage(actualUrl2, 1, 1);
    } else {
      slotStartTimes[0] = Date.now();
      scanTimer = setTimeout(function() { detectFromImage(actualUrl, 0, 0); }, 600);
    }
  });
  
  /* ---- Paste image handler untuk slot 1 ---- */
  scanUrl.addEventListener('paste', function(e) {
    var items = e.clipboardData.items;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        var blob = items[i].getAsFile();
        if (!blob) return;
        if (_pastedBlobUrl) URL.revokeObjectURL(_pastedBlobUrl);
        _pastedBlobUrl = URL.createObjectURL(blob);
        this.value = '[image]';
        this.dispatchEvent(new Event('input', { bubbles: true }));
        showToast('Gambar ditempel \u2014 OCR berjalan');
        return;
      }
    }
  });

  if (scanUrl2) {
    scanUrl2.addEventListener('input', function() {
      var val = scanUrl.value.trim();
      var val2 = this.value.trim();
      var actualUrl = getScanUrl(0);
      var actualUrl2 = getScanUrl(1);
      chrome.storage.local.set({ scanUrlPersist: val, scanUrl2Persist: val2 });
      
      if (!val2) {
        if (_pastedBlobUrl2) { URL.revokeObjectURL(_pastedBlobUrl2); _pastedBlobUrl2 = null; }
        scanPreviewBox2.style.display = 'none'; slotResults[1] = undefined; _slotStatusMsg[1] = ''; 
        renderCombined(); if (!actualUrl) scanPreviewWrap.style.display = 'none'; 
        return; 
      }
      
      // Jika user mengetik sesuatu selain [image], hapus blob URL
      if (val2 !== '[image]' && _pastedBlobUrl2) {
        URL.revokeObjectURL(_pastedBlobUrl2);
        _pastedBlobUrl2 = null;
      }
      
      if (!actualUrl2 || !isUrlValid(actualUrl2)) { 
        slotResults[1] = null; _slotStatusMsg[1] = ''; 
        renderCombined(); 
        return; 
      }
      var p2img = scanPreviewBox2.querySelector('.scan-preview');
      p2img.src = actualUrl2;
      scanPreviewBox2.style.display = 'block';
      scanPreviewWrap.style.display = 'block';
      p2img.onerror = function() { scanPreviewBox2.style.display = 'none'; };
      p2img.onclick = function() { if (actualUrl2) showCropModal(1, actualUrl2); };
      ensureCropBtn(1, actualUrl2);
      slotResults[1] = undefined;
      _slotStatusMsg[1] = '';
      if (scanTimer2) clearTimeout(scanTimer2);
      slotStartTimes[1] = Date.now();
      var isPasted2 = actualUrl2 && actualUrl2.startsWith('blob:');
      setSlotStatus(1, isPasted2 ? 'Memproses gambar...' : 'Mengunduh...');
      scanTimer2 = setTimeout(function() { detectFromImage(actualUrl2, 1, 1); }, 600);
    });
    
    /* ---- Paste image handler untuk slot 2 ---- */
    scanUrl2.addEventListener('paste', function(e) {
      var items = e.clipboardData.items;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          e.preventDefault();
          var blob = items[i].getAsFile();
          if (!blob) return;
          if (_pastedBlobUrl2) URL.revokeObjectURL(_pastedBlobUrl2);
          _pastedBlobUrl2 = URL.createObjectURL(blob);
          this.value = '[image]';
          this.dispatchEvent(new Event('input', { bubbles: true }));
          showToast('Gambar ditempel (slot 2) \u2014 OCR berjalan');
          return;
        }
      }
    });
  }

  setInterval(function() {
    if (document.hidden) return;
    var val = scanUrl.value.trim();
    var val2 = scanUrl2 ? scanUrl2.value.trim() : '';
    if (!val) { scanPreviewBox1.style.display = 'none'; }
    if (!val2) { scanPreviewBox2.style.display = 'none'; }
    if (!val && !val2) { scanPreviewWrap.style.display = 'none'; }
  }, 500);

  $('#btn-scan-clear').addEventListener('click', function() {
    if (_pastedBlobUrl) { URL.revokeObjectURL(_pastedBlobUrl); _pastedBlobUrl = null; }
    if (_pastedBlobUrl2) { URL.revokeObjectURL(_pastedBlobUrl2); _pastedBlobUrl2 = null; }
    scanUrl.value = '';
    if (scanUrl2) scanUrl2.value = '';
    scanStatus.textContent = '';
    scanStatus.className = '';
    _slotStatusMsg = ['', ''];
    scanPreviewWrap.style.display = 'none';
    scanPreviewBox1.style.display = 'none';
    scanPreviewBox2.style.display = 'none';
    scanSelections = [];
    slotResults = {};
    _lastRawData = null;
    if (_debugBtn) _debugBtn.style.display = 'none';
    chrome.storage.local.remove('scanResult');
    chrome.storage.local.set({ scanUrlPersist: '', scanUrl2Persist: '' });
  });

  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('scan-raw-toggle')) {
      var pre = e.target.parentElement.querySelector('.scan-raw-text');
      if (pre) {
        var hidden = pre.style.display === 'none';
        pre.style.display = hidden ? 'block' : 'none';
        e.target.innerHTML = hidden ? '&#9650; Raw' : '&#9660; Raw';
      }
      return;
    }
    var ambil = e.target.closest('.scan-pick-ambil');
    if (ambil) {
      var code = ambil.dataset.code;
      var alreadyPicked = scanSelections.indexOf(code) >= 0;
      if (alreadyPicked) {
        scanSelections = scanSelections.filter(function(c) { return c !== code; });
        kodeIn.value = scanSelections[0] || '';
        if (scanSelections.length < 2 && kode2In) kode2In.value = '';
        else if (scanSelections[1] && kode2In) kode2In.value = scanSelections[1];
        kodeIn.dispatchEvent(new Event('input', { bubbles: true }));
        if (kode2In) kode2In.dispatchEvent(new Event('input', { bubbles: true }));
        getData('scanResult').then(function(r) {
          var sr = r.scanResult;
          if (sr) setData({ scanResult: { codes: sr.codes, url: sr.url, selected: scanSelections.slice(), source: 'dashboard', rawText: sr.rawText, codeInfo: sr.codeInfo, bestCodes: sr.bestCodes, timestamp: sr.timestamp, seq: sr.seq } });
        });
        _skipAutoPick = true;
        renderCombined();
        _skipAutoPick = false;
      } else {
        var btn = ambil.parentElement.querySelector('.scan-pick');
        if (btn) { btn.click(); }
      }
      return;
    }
    var ambil = e.target.closest('.scan-pick-ambil');
    if (ambil) {
      var btn = ambil.parentElement.querySelector('.scan-pick');
      if (btn) { btn.click(); return; }
    }
    var btn = e.target.closest('.scan-pick');
    if (!btn) return;
    var code = btn.dataset.code;
    if (!kodeIn || !code) return;
    if (kodeIn.value && kode2In && code !== kodeIn.value) {
      if (!btn2x.classList.contains('active')) btn2x.click();
      if (scanSelections[0] === code) { scanSelections = []; kodeIn.value = ''; kodeIn.dispatchEvent(new Event('input')); kode2In.value = ''; kode2In.dispatchEvent(new Event('input')); }
      else if (scanSelections.length < 2) scanSelections = [kodeIn.value, code];
      else scanSelections = [kodeIn.value, code];
      kodeIn.value = scanSelections[0] || '';
      kode2In.value = scanSelections[1] || '';
      kodeIn.dispatchEvent(new Event('input', { bubbles: true }));
      if (kode2In) kode2In.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      scanSelections = [code];
      kodeIn.value = code;
      kodeIn.dispatchEvent(new Event('input', { bubbles: true }));
    }
    document.querySelectorAll('.scan-pick').forEach(function(b) {
      var isSel = scanSelections.indexOf(b.dataset.code) >= 0;
      b.style.background = isSel ? '#818cf8' : '';
      b.style.color = isSel ? '#fff' : '';
      b.style.borderColor = isSel ? '#818cf8' : '';
    });
    getData('scanResult').then(function(r) {
      var sr = r.scanResult;
      if (sr) setData({ scanResult: { codes: sr.codes, url: sr.url, selected: scanSelections.slice(), source: 'dashboard', rawText: sr.rawText, codeInfo: sr.codeInfo, bestCodes: sr.bestCodes, timestamp: sr.timestamp, seq: sr.seq } });
    });
    renderCombined();
  });

  (function initDashAutoAmbil() {
    var toggle = $('#dash-auto-ambil');
    var dot = $('#dash-auto-ambil-dot');
    if (!toggle) return;
    function updateUI() {
      if (_dashAutoAmbil) {
        toggle.checked = true;
        if (dot) { dot.style.left = '11px'; dot.style.background = 'var(--primary)'; }
        toggle.parentElement.querySelector('span:first-of-type').style.background = 'rgba(99,102,241,0.4)';
      } else {
        toggle.checked = false;
        if (dot) { dot.style.left = '1px'; dot.style.background = '#64748b'; }
        toggle.parentElement.querySelector('span:first-of-type').style.background = 'rgba(99,102,241,0.15)';
      }
    }
    getData('dashAutoAmbil').then(function(r) { _dashAutoAmbil = r.dashAutoAmbil === true; updateUI(); });
    toggle.addEventListener('change', function() { _dashAutoAmbil = this.checked; setData({ dashAutoAmbil: _dashAutoAmbil }); updateUI(); });
  })();

  getData('scanResult').then(function(r) {
    var sr = r.scanResult;
    if (sr && Array.isArray(sr.codes) && sr.codes.length > 0) {
      scanSelections = Array.isArray(sr.selected) ? sr.selected : (sr.selected ? [sr.selected] : []);
      var bestCodes = Array.isArray(sr.bestCodes) ? sr.bestCodes : (sr.bestCode ? [sr.bestCode] : []);
      var info = '<div style="font-size:10px;color:#94a3b8;margin-bottom:4px;">#<b>' + (sr.seq || '?') + '</b> &middot; ' + (sr.timestamp || '') + '</div>';
      var btns = info + sr.codes.map(function(c, idx) {
        var isBest = bestCodes.indexOf(c) >= 0;
        return '<div style="margin:2px 0;display:flex;align-items:center;"><button class="btn btn-sm scan-pick' + (isBest ? ' scan-best' : '') + '" data-code="' + c + '" style="font-family:monospace;font-size:11px;flex:1;text-align:left;padding:4px 8px;background:' + (isBest ? '#facc15' : '') + ';color:' + (isBest ? '#000' : '') + ';">' + (idx+1) + '. ' + c.slice(0, 16) + '<span style="font-size:20px;font-weight:bold">' + c.slice(-3) + '</span> <span style="font-size:9px;opacity:0.7;">' + (isBest ? '+Ambil' : 'Ambil') + '</span></button><span class="scan-remove" data-code="' + c + '" style="cursor:pointer;color:#ef4444;font-size:12px;font-weight:700;padding:4px 6px;margin-left:2px;border-radius:4px;">\u2715</span></div>';
      }).join('');
      scanStatus.innerHTML = btns;
      scanStatus.className = 'scan-ok';
      getData('dashAutoAmbil').then(function(d) {
        var isAuto = d.dashAutoAmbil === true;
        if (isAuto && scanSelections[0]) { kodeIn.value = scanSelections[0]; kodeIn.dispatchEvent(new Event('input', { bubbles: true })); }
        if (isAuto && scanSelections[1] && kode2In) { kode2In.value = scanSelections[1]; kode2In.dispatchEvent(new Event('input', { bubbles: true })); }
      });
      if (sr.url && sr.url.startsWith('http')) {
        scanUrl.value = sr.url;
        var p1img = scanPreviewBox1.querySelector('.scan-preview');
        p1img.src = sr.url;
        p1img.onerror = function() { scanPreviewBox1.style.display = 'none'; };
        scanPreviewBox1.style.display = 'block';
        scanPreviewWrap.style.display = 'block';
        p1img.onclick = function() { showCropModal(0, sr.url); };
        ensureCropBtn(0, sr.url);
      }
    }
  });

  chrome.storage.onChanged.addListener(function(changes, area) {
    if (area !== 'local') return;
    if (changes.scanResult && !changes.scanResult.newValue) {
      slotResults = {};
      scanSelections = [];
      scanStatus.textContent = '';
      scanStatus.className = '';
    }
  });

  chrome.storage.local.get(['scanUrlPersist', 'scanUrl2Persist'], function(r) {
    var savedUrl = r.scanUrlPersist || '';
    var savedUrl2 = r.scanUrl2Persist || '';
    if (!savedUrl && !savedUrl2) return;
    if (scanUrl.value.trim() && !savedUrl) return;
    scanUrl.value = savedUrl;
    if (scanUrl2 && savedUrl2) scanUrl2.value = savedUrl2;
    if (savedUrl && savedUrl.startsWith('http')) {
      var p1img = scanPreviewBox1.querySelector('.scan-preview');
      p1img.src = savedUrl;
      scanPreviewBox1.style.display = 'block';
      scanPreviewWrap.style.display = 'block';
      p1img.onerror = function() { scanPreviewBox1.style.display = 'none'; if (!savedUrl2) scanPreviewWrap.style.display = 'none'; };
      p1img.onclick = function() { showCropModal(0, savedUrl); };
      ensureCropBtn(0, savedUrl);
      slotResults[0] = undefined;
      slotResults[1] = undefined;
      if (savedUrl2 && savedUrl2.startsWith('http')) {
        var p2img = scanPreviewBox2.querySelector('.scan-preview');
        p2img.src = savedUrl2;
        scanPreviewBox2.style.display = 'block';
        scanPreviewWrap.style.display = 'block';
        p2img.onerror = function() { scanPreviewBox2.style.display = 'none'; };
        p2img.onclick = function() { showCropModal(1, savedUrl2); };
        ensureCropBtn(1, savedUrl2);
        setTimeout(function() {
          detectFromImage(savedUrl, 0, 0);
          detectFromImage(savedUrl2, 1, 1);
        }, 600);
      } else {
        scanTimer = setTimeout(function() { detectFromImage(savedUrl, 0, 0); }, 600);
      }
    }
  });

  /* ---- Silent OCR pool (digunakan oleh detectFromImage pool 2) ---- */
  var _silentWorkers = [];

  chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (msg.type === 'OCR_RUN_SILENT' && msg.url) {
      detectFromImage(msg.url, -1, 2, true, msg.blob).then(function(result) {
        if (!result) result = { codes: [], error: 'Gagal', lines: [], codeInfo: {}, bestCodes: [], passages: [], allRaw: '', elapsed: '' };
        sendResponse({
          type: 'OCR_RESULT_SILENT',
          reqId: msg.reqId,
          codes: result.codes || [],
          codeInfo: result.codeInfo || {},
          bestCodes: result.bestCodes || [],
          lines: result.lines || [],
          passages: result.passages || [],
          allRaw: result.allRaw || '',
          elapsed: result.elapsed || '',
          error: result.error || '',
        });
      }).catch(function(err) {
        /* Mode wajib SIMD bisa melempar (blokir non-SIMD) — jangan biarkan unhandled
           rejection; kirim balasan dengan pesan error agar peminta tidak menggantung. */
        sendResponse({
          type: 'OCR_RESULT_SILENT',
          reqId: msg.reqId,
          codes: [], codeInfo: {}, bestCodes: [], lines: [], passages: [],
          allRaw: '', elapsed: '',
          error: (err && err.message) || 'Gagal OCR',
        });
      });
      return true;
    }
  });

  /* Pre-warm pool best (semua jalur) + standar (fallback) agar scan pertama langsung cepat */
  setTimeout(function() {
    try { engine.initWorkers(0); engine.initBestWorkers(); } catch(e) {}
  }, 1500);
  setTimeout(function() {
    try { engine.initWorkers(0); engine.initBestWorkers(); } catch(e) {}
  }, 10000);

  /* Jaga worker tetap hangat saat idle (cegah cold-start setelah lama tidak dipakai) */
  setInterval(function() {
    try { engine.warmWorkers(); } catch(e) {}
  }, 30000);
  chrome.runtime.onMessage.addListener(function(msg) {
    if (msg && msg.type === 'KEEPALIVE_WARM') { try { engine.warmWorkers(); } catch(e) {} }
  });
})();
