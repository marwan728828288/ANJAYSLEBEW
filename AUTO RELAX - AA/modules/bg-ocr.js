/* =====================================================================
 * OCR BRIDGE (Service Worker) — Offscreen document adalah host OCR
 *
 * Sebelumnya request OCR dari OCR Frame (LiveChat) diproses oleh
 * dashboard tab. Tab bisa di-discard Chrome saat idle → OCR lambat.
 * Sekarang:
 *   OCR Frame → storage _ocrBridgeReq_* → SW ini → offscreen document
 *   Offscreen document menjalankan Tesseract (tidak kena tab discarding)
 *   Hasil → SW tulis ke storage _ocrBridgeRes_* → OCR Frame polling
 * ===================================================================== */

var _creatingOffscreen = null;
var _versionChecked = false;
var _ensureLock = Promise.resolve();

/* Versi kode OCR engine — jika berubah, offscreen document (yang di-keep-alive
   tiap 25 detik & TIDAK pernah reload sendiri) ditutup agar dibuat ulang dengan
   kode terbaru. Tanpa ini, user yang hanya refresh halaman LiveChat (bukan reload
   extension) tetap menjalankan engine VERSI LAMA → hasil "masih sama saja". */
var OCR_CODE_VERSION = 'v3.46';

/* Tutup offscreen document dengan AMAN. closeDocument() mengembalikan Promise
   yang REJECT dengan "No current offscreen document." bila tidak ada dokumen
   (mis. SW baru bangun / extension baru di-reload). Rejection itu harus di-
   .catch() — kalau tidak jadi "Uncaught (in promise) Error" di console. */
async function safeCloseOffscreen() {
  try {
    if (chrome.offscreen && chrome.offscreen.closeDocument) {
      await Promise.resolve(chrome.offscreen.closeDocument()).catch(function() {});
    }
  } catch(e) {}
}

/* Version stamp + pembuatan dokumen dibuat ATOMIK di satu tempat: cek versi
   (sekali per SW start), kalau beda → tutup dokumen lama (jika ada) baru buat
   yang baru. Sebelumnya closeDocument() dipanggil terpisah via storage callback
   yang BERSAING dengan warmOffscreen() → bisa menutup dokumen yang baru saja
   dibuat → OCR_RUN gagal "No current offscreen document".

   SELURUH alur (versi → close → cek existing → create) diserialkan lewat
   _ensureLock: dua pemanggil bersamaan (mis. warmOffscreen() + OCR_RUN saat
   SW bangun) tidak boleh saling tumpang tindih — pemanggil kedua menunggu yang
   pertama selesai, sehingga tidak ada yang membaca getContexts di tengah
   closeDocument() berjalan (kalau sampai begitu, dokumen lama masih terlihat
   "existing" → create dilewati → error muncul lagi). */
async function ensureOffscreenDoc() {
  if (!chrome.offscreen) return;
  var run = _ensureLock.then(async function() {
    if (!_versionChecked) {
      _versionChecked = true;
      var ver = await new Promise(function(res) {
        chrome.storage.local.get('_ocrCodeVersion', function(r) { res(r._ocrCodeVersion); });
      });
      if (ver && ver !== OCR_CODE_VERSION) {
        chrome.storage.local.set({ _ocrCodeVersion: OCR_CODE_VERSION });
        await safeCloseOffscreen();
      }
    }
    var offscreenUrl = chrome.runtime.getURL('pages/offscreen.html');
    var existing = [];
    if (chrome.runtime.getContexts) {
      existing = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl]
      });
    }
    if (existing.length > 0) return;
    /* Lock _ensureLock menjamin hanya satu body yang jalan → tidak perlu guard
       _creatingOffscreen di sini (tidak akan pernah non-null). */
    _creatingOffscreen = chrome.offscreen.createDocument({
      url: 'pages/offscreen.html',
      reasons: ['WORKERS', 'BLOBS', 'DOM_SCRAPING'],
      justification: 'Menjalankan OCR Tesseract agar tidak bergantung pada tab yang bisa di-discard Chrome saat idle'
    });
    try { await _creatingOffscreen; }
    finally { _creatingOffscreen = null; }
  });
  /* rantai lock: pemanggil berikutnya menunggu yang ini selesai (termasuk
     rejection) — pastikan lock tidak pernah macet */
  _ensureLock = run.catch(function() {});
  return run;
}

async function warmOffscreen() {
  try {
    await ensureOffscreenDoc();
    await chrome.runtime.sendMessage({ type: 'OCR_WARM' });
  } catch(e) {}
}

function emptyResult(mode, msg) {
  var base = { error: msg || 'Gagal OCR', lines: [], allRaw: '', elapsed: '' };
  if (mode === 'all') return Object.assign({ text: '', codes: [] }, base);
  return Object.assign({
    codes: [], codeInfo: {}, bestCodes: [], lines: [], varLines: [], varRawLines: [], var0Lines: [], passages: [], text: ''
  }, base);
}

async function handleOcrRequest(reqData, reqId) {
  var resultKey = '_ocrBridgeRes_' + reqId;
  var mode = reqData.mode === 'all' ? 'all' : 'codes';
  try {
    await ensureOffscreenDoc();
    /* Zoom 'Perbesaran OCR' dibaca di SERVICE WORKER (chrome.storage terbukti jalan
       di sini) lalu dikirim EKSPLISIT ke offscreen. Offscreen doc TIDAK bisa diandalkan
       membaca storage — diagnostik src:fallback menunjukkan ia selalu jatuh ke default
       1.5 → livechat ≠ preview. Undefined bila baca gagal → engine fallback sendiri. */
    var cropScale = await new Promise(function(res) {
      chrome.storage.local.get('ocrCropScale', function(r) {
        var v = parseFloat(r && r.ocrCropScale);
        /* min ×1.0 (instruksi user) — sinkron dengan getCropScaleSetting di engine */
        res((!isNaN(v) && v >= 1.0 && v <= 4) ? v : undefined);
      });
    });
    /* Kebijakan SIMD (mode wajib SIMD): baca di SW (storage andal di sini) lalu
       kirim EKSPLISIT ke offscreen — offscreen tidak bisa diandalkan membaca storage
       (pola sama seperti ocrCropScale). false = wajib SIMD (blokir non-SIMD). */
    var allowNoSimd = await new Promise(function(res) {
      chrome.storage.local.get('ocrAllowNoSimd', function(r) {
        res(!!(r && r.ocrAllowNoSimd));
      });
    });
    var result = await chrome.runtime.sendMessage({
      type: 'OCR_RUN',
      reqId: reqId,
      url: reqData.url,
      mode: mode,
      cropScale: cropScale,
      allowNoSimd: allowNoSimd,
      /* isCrop (dari ocr-frame): true = hasil crop MANUAL user (jangan di-crop ulang);
         false/undefined = screenshot FULL (engine menerapkan strip kiri 50% + MANUAL_CROPS). */
      isCrop: typeof reqData.isCrop === 'boolean' ? reqData.isCrop : undefined,
      originalUrl: reqData.originalUrl || reqData.url
    });
    if (!result) throw new Error('Offscreen OCR tidak merespons');
    chrome.storage.local.set({ [resultKey]: result });
  } catch(e) {
    chrome.storage.local.set({ [resultKey]: emptyResult(mode, (e && e.message) || 'Gagal OCR') });
  }
}

export function initOcrBridge() {
  /* Request OCR dari OCR Frame / LiveChat */
  chrome.storage.onChanged.addListener(function(changes, area) {
    if (area !== 'local') return;
    for (var key in changes) {
      if (key.indexOf('_ocrBridgeReq_') !== 0) continue;
      var reqData = changes[key].newValue;
      if (!reqData || !reqData.url) {
        chrome.storage.local.remove(key);
        continue;
      }
      var reqId = key.replace('_ocrBridgeReq_', '');
      chrome.storage.local.remove(key);
      handleOcrRequest(reqData, reqId);
    }
  });

  /* Ping dari offscreen document — reset idle timeout service worker */
  chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (msg && msg.type === 'SW_KEEPALIVE') {
      try { sendResponse({ ok: true }); } catch(e) {}
      return true;
    }
  });

  /* Request crop (data URL besar) dari OCR Frame — kirim via message, bukan storage
     (storage.local lambat & punya batas 8MB/item untuk payload base64 yang besar) */
  chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (msg && msg.type === 'OCR_BRIDGE_REQ') {
      try {
        handleOcrRequest({ url: msg.url, mode: msg.mode, originalUrl: msg.originalUrl, isCrop: msg.isCrop }, msg.reqId);
      } catch(e) {}
      try { sendResponse({ ok: true }); } catch(e) {}
      return true;
    }
  });

  /* Version stamp kini ditangani di dalam ensureOffscreenDoc() — close-then-create
     ATOMIK (lihat komentar di atas). Tidak ada lagi callback storage yang beradu
     dengan warmOffscreen() saat SW bangun. */

  /* Pastikan offscreen document selalu ada + worker tetap hangat */
  chrome.alarms.create('offscreenKeepAlive', { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener(function(alarm) {
    if (alarm.name === 'offscreenKeepAlive') warmOffscreen();
  });

  /* Setiap SW bangun (setelah idle lama), langsung pastikan offscreen document
     ada & worker hangat — mencegah cold-start Tesseract pada scan pertama.
     (ensureOffscreenDoc memeriksa dokumen yang sudah ada, jadi murah bila hangat) */
  warmOffscreen();
}
