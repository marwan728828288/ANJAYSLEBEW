/* =====================================================================
 * OFFSCREEN OCR — Host mesin OCR Tesseract di offscreen document
 *
 * Offscreen document TIDAK kena Chrome Memory Saver / tab discarding
 * dan (dengan reason selain AUDIO_PLAYBACK) tidak punya batas umur,
 * jadi worker Tesseract bisa tinggal hidup selama extension ada.
 *
 * Hanya chrome.runtime yang tersedia di konteks ini — komunikasi lewat
 * runtime message dari service worker.
 * ===================================================================== */

import { initOcrEngine } from '../modules/ocr-engine.js';

var engine = initOcrEngine();

/* Round-robin pool worker (0/1): dua gambar LiveChat bersamaan memakai pool
   worker BERBEDA (masing-masing 2 worker) sehingga OCR 2 gambar berjalan
   PARALEL — bukan mengantre di 2 worker yang sama. */
var _ocrPoolRR = 0;
function nextPool() {
  _ocrPoolRR = 1 - _ocrPoolRR;
  return _ocrPoolRR;
}

/* Pre-warm worker pool kode tiket (model best — semua jalur) saat dokumen dimuat
   + 3s kemudian (fallback bila load pertama masih sibuk). Kedua pool best di-warm
   agar round-robin tidak kena cold-start di pool kedua. (Pool standar tidak
   di-warm — hanya fallback bila model best gagal dimuat.) */
engine.ensureReady();
setTimeout(function() {
  try { engine.initBestWorkers(0); engine.initBestWorkers(1); } catch(e) {}
}, 50);

/* Jaga service worker tetap hidup: ping tiap 25 detik (reset idle timeout 30s).
   sendMessage MV3 mengembalikan Promise — kalau SW sedang tidur/restart,
   Promise-nya reject → wajib .catch() agar tidak jadi unhandled rejection. */
setInterval(function() {
  try { Promise.resolve(chrome.runtime.sendMessage({ type: 'SW_KEEPALIVE' })).catch(function() {}); } catch(e) {}
}, 25000);

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (!msg) return;

  if (msg.type === 'OCR_WARM') {
    try { engine.warmWorkers(); } catch(e) {}
    try { sendResponse({ ok: true }); } catch(e) {}
    return;
  }

  if (msg.type !== 'OCR_RUN' || !msg.url) return;

  var mode = msg.mode === 'all' ? 'all' : 'codes';
  var reqId = msg.reqId;
  var originalUrl = msg.originalUrl || msg.url;
  /* isCrop: hasil crop MANUAL user (dari UI crop ocr-frame) → true, jangan di-crop
     ulang. Screenshot FULL LiveChat juga datang sebagai data: URL tapi dikirim dengan
     isCrop=false eksplisit (lihat ocr-frame.js) → engine menerapkan strip kiri 50% +
     MANUAL_CROPS. Fallback lama: data: URL dianggap crop (aman untuk pemanggil lama). */
  var isCrop = (typeof msg.isCrop === 'boolean') ? msg.isCrop : msg.url.indexOf('data:') === 0;

  (async function() {
    try {
      var pool = nextPool();
      if (mode === 'all') {
        var allOpts = { noAutoCrop: isCrop, pool: pool };
        if (msg.cropScale) allOpts.cropScale = msg.cropScale;
        if (typeof msg.allowNoSimd === 'boolean') allOpts.allowNoSimd = msg.allowNoSimd; /* kebijakan SIMD dari SW (storage andal di SW) */
        var allRes = await engine.processAllText(msg.url, allOpts);
        sendResponse({
          text: allRes.text || '',
          allRaw: allRes.allRaw || '',
          lines: allRes.lines || [],
          elapsed: allRes.elapsed || '',
          error: allRes.error || '',
          url: originalUrl
        });
      } else {
        // Konversi data URL → blob bila perlu (engine hanya terima http:/blob:).
        // Semua data: URL (screenshot FULL maupun crop manual) harus dikonversi —
        // isCrop hanya menentukan apakah engine memotong ulang / menerapkan strip.
        var runUrl = msg.url;
        var blob;
        if (msg.url.indexOf('data:') === 0) {
          blob = await engine.dataUrlToBlob(msg.url);
          if (!blob) throw new Error('Gagal konversi data URL');
          runUrl = URL.createObjectURL(blob);
        }
        /* allowCorner SELALU true (sama dengan preview): untuk isCrop engine melewati
           corner-pass kecuali flag ini ada — tanpa flag, scan LiveChat bisa ketinggalan
           kode tiket di strip atas yang justru ditemukan preview. Non-crop sudah otomatis. */
        var opts = { noAutoCrop: isCrop, noPhoneCrop: isCrop, allowCorner: true };
        if (msg.cropScale) opts.cropScale = msg.cropScale; /* zoom dari SW (baca storage di SW — offscreen tidak bisa diandalkan baca storage) */
        if (typeof msg.allowNoSimd === 'boolean') opts.allowNoSimd = msg.allowNoSimd; /* kebijakan SIMD dari SW (storage andal di SW) */
        var res = await engine.detectFromImage(runUrl, pool, blob, opts);
        var passages = res.passages || [];
        var varLines = passages.map(function(p) { return p.lines || []; });
        var var0Lines = passages.length > 0 && passages[0].lines ? passages[0].lines : [];
        sendResponse({
          codes: res.codes || [],
          codeInfo: res.codeInfo || {},
          bestCodes: res.bestCodes || [],
          lines: res.lines || [],
          varLines: varLines,
          varRawLines: varLines,
          var0Lines: var0Lines,
          passages: passages,
          elapsed: res.elapsed || '',
          allRaw: res.allRaw || '',
          error: res.error || '',
          engineVersion: res.engineVersion || '',
          procInfo: res.procInfo || null,
          climbInfo: res.climbInfo || null,
          url: originalUrl
        });
      }
    } catch(e) {
      sendResponse({
        codes: [], text: '', lines: [], allRaw: '', elapsed: '',
        error: (e && e.message) || 'Gagal OCR',
        url: originalUrl
      });
    }
  })();

  return true; // async response
});
